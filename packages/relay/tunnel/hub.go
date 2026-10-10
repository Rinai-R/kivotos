// Package tunnel joins the members of a network. A computer keeps one control
// connection open to the relay; when a member asks for that computer, the hub
// tells it to dial back, pairs the two connections, and copies bytes between
// them without looking at them.
//
// Every connection is a WebSocket carrying one byte stream in binary
// messages; message boundaries mean nothing.
package tunnel

import (
	"bufio"
	"cmp"
	"context"
	"crypto/rand"
	"encoding/base64"
	"io"
	"log/slog"
	"maps"
	"net"
	"slices"
	"sync"
	"time"

	"github.com/Rinai-R/kivotos/packages/relay/wire"
)

// writeTimeout bounds one handshake or control write.
const writeTimeout = 10 * time.Second

// refusal is a failure the peer is told about: its text is the wire.Reply
// error code. A Hub method returns one only before any OK reply was written.
type refusal string

func (r refusal) Error() string { return string(r) }

// Limits bounds what one network and its members can ask of the relay.
type Limits struct {
	// AcceptTimeout is how long a dialing member waits for the node to dial back.
	AcceptTimeout time.Duration
	// PingInterval is how often the relay pings a node. A node silent for
	// three intervals is dropped.
	PingInterval time.Duration
	// MaxNodesPerNetwork caps the nodes one network can have online.
	MaxNodesPerNetwork int
	// MaxStreamsPerNode caps concurrent streams to one node.
	MaxStreamsPerNode int
}

// peer is an admitted connection. Reads go through r, which may already hold
// bytes that arrived behind the hello.
type peer struct {
	conn net.Conn
	r    *bufio.Reader
}

// Hub tracks the nodes that are online and the streams to them. It is safe
// for concurrent use.
type Hub struct {
	limits Limits
	log    *slog.Logger

	mu       sync.Mutex
	networks map[wire.NetworkID]map[wire.NodeID]*session
	closed   bool
}

// NewHub returns an empty Hub.
func NewHub(limits Limits, log *slog.Logger) *Hub {
	return &Hub{limits: limits, log: log, networks: map[wire.NetworkID]map[wire.NodeID]*session{}}
}

// Node describes one online node.
type Node struct {
	wire.Peer
	Streams int
}

// Nodes lists the online nodes of a network, ordered by name, then ID.
func (h *Hub) Nodes(network wire.NetworkID) []Node {
	h.mu.Lock()
	out := make([]Node, 0, len(h.networks[network]))
	for _, s := range h.networks[network] {
		out = append(out, Node{Peer: wire.Peer{Node: s.node, Name: s.name, Since: s.since}, Streams: s.count()})
	}
	h.mu.Unlock()
	slices.SortFunc(out, func(a, b Node) int {
		return cmp.Or(cmp.Compare(a.Name, b.Name), cmp.Compare(a.Node, b.Node))
	})
	return out
}

// Kick drops every node and stream of a network.
func (h *Hub) Kick(network wire.NetworkID) {
	h.mu.Lock()
	sessions := slices.Collect(maps.Values(h.networks[network]))
	h.mu.Unlock()
	for _, s := range sessions {
		s.close()
	}
}

// Close drops every node and refuses new ones.
func (h *Hub) Close() {
	h.mu.Lock()
	h.closed = true
	var sessions []*session
	for _, nodes := range h.networks {
		sessions = slices.AppendSeq(sessions, maps.Values(nodes))
	}
	h.mu.Unlock()
	for _, s := range sessions {
		s.close()
	}
}

func (h *Hub) lookup(network wire.NetworkID, node wire.NodeID) *session {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.networks[network][node]
}

// serveNode runs a node's control connection until it ends. A second control
// connection from the same node replaces the first.
func (h *Hub) serveNode(ctx context.Context, p peer, hello wire.Hello) error {
	s := newSession(hello.Node, hello.Name, p.conn)
	h.mu.Lock()
	nodes := h.networks[hello.Network]
	old := nodes[hello.Node]
	if h.closed || (old == nil && len(nodes) >= h.limits.MaxNodesPerNetwork) {
		h.mu.Unlock()
		return refusal(wire.ErrCodeBusy)
	}
	if nodes == nil {
		nodes = map[wire.NodeID]*session{}
		h.networks[hello.Network] = nodes
	}
	nodes[hello.Node] = s
	h.mu.Unlock()
	if old != nil {
		old.close()
	}
	defer func() {
		h.mu.Lock()
		if nodes := h.networks[hello.Network]; nodes[hello.Node] == s {
			delete(nodes, hello.Node)
			if len(nodes) == 0 {
				delete(h.networks, hello.Network)
			}
		}
		h.mu.Unlock()
		s.close()
	}()
	stop := context.AfterFunc(ctx, s.close)
	defer stop()

	p.conn.SetDeadline(time.Now().Add(writeTimeout))
	if err := wire.WriteJSON(p.conn, wire.Reply{OK: true}); err != nil {
		return err
	}
	p.conn.SetDeadline(time.Time{})
	h.log.Info("node online", "network", hello.Network, "node", hello.Node, "name", hello.Name)
	defer h.log.Info("node offline", "network", hello.Network, "node", hello.Node)

	go s.ping(h.limits.PingInterval)
	for {
		p.conn.SetReadDeadline(time.Now().Add(3 * h.limits.PingInterval))
		var msg wire.Control
		if err := wire.ReadJSON(p.r, &msg); err != nil {
			return err
		}
		// Only pong is defined; a newer node may send types this relay does
		// not know. Any message shows the node is alive.
	}
}

// peers answers which nodes of a network are online.
func (h *Hub) peers(p peer, network wire.NetworkID) error {
	nodes := h.Nodes(network)
	reply := wire.Reply{OK: true, Peers: make([]wire.Peer, len(nodes))}
	for i, n := range nodes {
		reply.Peers[i] = n.Peer
	}
	p.conn.SetDeadline(time.Now().Add(writeTimeout))
	return wire.WriteJSON(p.conn, reply)
}

// connect asks target to dial back for the member from, then copies bytes
// between the two until either side closes.
func (h *Hub) connect(ctx context.Context, p peer, network wire.NetworkID, target, from wire.NodeID) error {
	s := h.lookup(network, target)
	if s == nil {
		return refusal(wire.ErrCodeOffline)
	}
	id, st, err := s.begin(h.limits.MaxStreamsPerNode)
	if err != nil {
		return err
	}
	defer s.end(id, st)

	p.conn.SetDeadline(time.Time{})
	if err := s.send(wire.Control{Type: wire.TypeOpen, Conn: id, From: from}); err != nil {
		return refusal(wire.ErrCodeOffline)
	}
	timeout := time.NewTimer(h.limits.AcceptTimeout)
	defer timeout.Stop()
	var np peer
	select {
	case np = <-st.accepted:
	case <-timeout.C:
		return refusal(wire.ErrCodeTimeout)
	case <-s.done:
		return refusal(wire.ErrCodeOffline)
	case <-ctx.Done():
		return refusal(wire.ErrCodeOffline)
	}
	if !s.attach(st, p.conn, np.conn) {
		return refusal(wire.ErrCodeOffline)
	}

	deadline := time.Now().Add(writeTimeout)
	for _, c := range []net.Conn{np.conn, p.conn} {
		c.SetDeadline(deadline)
		if err := wire.WriteJSON(c, wire.Reply{OK: true}); err != nil {
			return err
		}
		c.SetDeadline(time.Time{})
	}
	splice(p, np)
	return nil
}

// accept hands a node's data connection to the stream waiting for it and
// returns when that stream ends.
func (h *Hub) accept(p peer, network wire.NetworkID, node wire.NodeID, id string) error {
	s := h.lookup(network, node)
	if s == nil {
		return refusal(wire.ErrCodeUnknownConn)
	}
	st := s.take(id, p)
	if st == nil {
		return refusal(wire.ErrCodeUnknownConn)
	}
	<-st.finished
	return nil
}

// splice copies both ways until either side ends, then closes both: a
// WebSocket cannot be half-closed, so one side finishing ends the stream.
func splice(a, b peer) {
	var wg sync.WaitGroup
	wg.Go(func() { copyThenClose(a.conn, b.r) })
	wg.Go(func() { copyThenClose(b.conn, a.r) })
	wg.Wait()
}

func copyThenClose(dst net.Conn, src io.Reader) {
	io.Copy(dst, src)
	dst.Close()
}

// session is one node's control connection and the streams that go through it.
type session struct {
	node  wire.NodeID
	name  string
	conn  net.Conn
	since time.Time
	done  chan struct{}

	wmu sync.Mutex // serializes control writes

	mu      sync.Mutex
	streams map[string]*stream
	closed  bool
}

// stream is one member-to-node stream, from the member's request to its end.
type stream struct {
	accepted chan peer     // the node's data connection, sent at most once
	finished chan struct{} // closed when the stream ends, however it ends
	taken    bool          // a node connection has claimed this stream
	conns    []net.Conn    // both ends, once attached
}

func newSession(node wire.NodeID, name string, conn net.Conn) *session {
	return &session{
		node: node, name: name, conn: conn, since: time.Now().UTC(),
		done: make(chan struct{}), streams: map[string]*stream{},
	}
}

func (s *session) count() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.streams)
}

func (s *session) send(msg wire.Control) error {
	s.wmu.Lock()
	defer s.wmu.Unlock()
	s.conn.SetWriteDeadline(time.Now().Add(writeTimeout))
	return wire.WriteJSON(s.conn, msg)
}

// ping keeps the control connection alive until the session closes.
func (s *session) ping(every time.Duration) {
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-s.done:
			return
		case <-t.C:
			if s.send(wire.Control{Type: wire.TypePing}) != nil {
				s.close()
				return
			}
		}
	}
}

// close ends the control connection and every stream. It is idempotent.
func (s *session) close() {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return
	}
	s.closed = true
	close(s.done)
	for _, st := range s.streams {
		for _, c := range st.conns {
			c.Close()
		}
	}
	s.mu.Unlock()
	s.conn.Close()
}

// begin registers a new stream.
func (s *session) begin(limit int) (string, *stream, error) {
	raw := make([]byte, 16)
	rand.Read(raw) // never fails (Go 1.24+)
	id := base64.RawURLEncoding.EncodeToString(raw)
	st := &stream{accepted: make(chan peer, 1), finished: make(chan struct{})}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return "", nil, refusal(wire.ErrCodeOffline)
	}
	if len(s.streams) >= limit {
		return "", nil, refusal(wire.ErrCodeBusy)
	}
	s.streams[id] = st
	return id, st, nil
}

// take claims the stream id for a node data connection. It returns nil when
// no stream is waiting under that id.
func (s *session) take(id string, p peer) *stream {
	s.mu.Lock()
	defer s.mu.Unlock()
	st := s.streams[id]
	if st == nil || st.taken {
		return nil
	}
	st.taken = true
	st.accepted <- p // buffered; sent under mu so end cannot miss it
	return st
}

// attach records both ends of a stream so close can end it. It reports false
// when the session is already closed.
func (s *session) attach(st *stream, conns ...net.Conn) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return false
	}
	st.conns = conns
	return true
}

// end forgets a stream and releases the node connection waiting on it.
func (s *session) end(id string, st *stream) {
	s.mu.Lock()
	delete(s.streams, id)
	s.mu.Unlock()
	close(st.finished)
}
