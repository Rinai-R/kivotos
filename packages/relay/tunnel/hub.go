// Package tunnel joins devices to hosts. A host keeps one control connection
// open to the relay; when a device asks for that host, the hub tells the host
// to dial back, pairs the two connections, and copies bytes between them
// without looking at them.
//
// Every connection is a WebSocket carrying one byte stream in binary
// messages; message boundaries mean nothing.
package tunnel

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/base64"
	"io"
	"log/slog"
	"net"
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

// Grants records which devices a host lets in. *registry.Registry implements it.
type Grants interface {
	Grant(host, client wire.Key, name string) error
	Revoke(host, client wire.Key) error
}

// Tickets registers pairing tickets. *admission.Tickets implements it.
type Tickets interface {
	Issue(host wire.Key, hash string, ttl time.Duration) error
	Forget(host wire.Key)
}

// Limits bounds what one host and its devices can ask of the relay.
type Limits struct {
	// AcceptTimeout is how long a device waits for the host to dial back.
	AcceptTimeout time.Duration
	// PingInterval is how often the relay pings a host. A host silent for
	// three intervals is dropped.
	PingInterval time.Duration
	// MaxStreamsPerHost caps concurrent streams to one host.
	MaxStreamsPerHost int
}

// peer is an admitted connection. Reads go through r, which may already hold
// bytes that arrived behind the hello.
type peer struct {
	conn net.Conn
	r    *bufio.Reader
}

// Hub tracks the hosts that are online and the streams to them. It is safe
// for concurrent use.
type Hub struct {
	grants  Grants
	tickets Tickets
	limits  Limits
	log     *slog.Logger

	mu     sync.Mutex
	hosts  map[wire.Key]*session
	closed bool
}

// NewHub returns an empty Hub.
func NewHub(grants Grants, tickets Tickets, limits Limits, log *slog.Logger) *Hub {
	return &Hub{grants: grants, tickets: tickets, limits: limits, log: log, hosts: map[wire.Key]*session{}}
}

// Session describes one online host.
type Session struct {
	Host    wire.Key
	Since   time.Time
	Streams int
}

// Sessions lists the hosts that are online.
func (h *Hub) Sessions() []Session {
	h.mu.Lock()
	defer h.mu.Unlock()
	out := make([]Session, 0, len(h.hosts))
	for _, s := range h.hosts {
		out = append(out, Session{Host: s.host, Since: s.since, Streams: s.count()})
	}
	return out
}

// Kick drops a host's control connection and all its streams. It reports
// whether the host was online.
func (h *Hub) Kick(host wire.Key) bool {
	s := h.lookup(host)
	if s == nil {
		return false
	}
	s.close()
	return true
}

// DropClient closes every stream client has open to host.
func (h *Hub) DropClient(host, client wire.Key) {
	if s := h.lookup(host); s != nil {
		s.drop(client)
	}
}

// Close drops every host and refuses new ones.
func (h *Hub) Close() {
	h.mu.Lock()
	h.closed = true
	sessions := make([]*session, 0, len(h.hosts))
	for _, s := range h.hosts {
		sessions = append(sessions, s)
	}
	h.mu.Unlock()
	for _, s := range sessions {
		s.close()
	}
}

func (h *Hub) lookup(host wire.Key) *session {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.hosts[host]
}

// serveHost runs a host's control connection until it ends. A second control
// connection from the same host replaces the first.
func (h *Hub) serveHost(ctx context.Context, p peer, host wire.Key) error {
	s := newSession(host, p.conn)
	h.mu.Lock()
	if h.closed {
		h.mu.Unlock()
		return refusal(wire.ErrCodeBusy)
	}
	old := h.hosts[host]
	h.hosts[host] = s
	h.mu.Unlock()
	if old != nil {
		old.close()
	}
	defer func() {
		h.mu.Lock()
		current := h.hosts[host] == s
		if current {
			delete(h.hosts, host)
		}
		h.mu.Unlock()
		s.close()
		if current {
			// A replacement session keeps the tickets it issued.
			h.tickets.Forget(host)
		}
	}()
	stop := context.AfterFunc(ctx, s.close)
	defer stop()

	p.conn.SetDeadline(time.Now().Add(writeTimeout))
	if err := wire.WriteJSON(p.conn, wire.Reply{OK: true}); err != nil {
		return err
	}
	p.conn.SetDeadline(time.Time{})
	h.log.Info("host online", "host", host)
	defer h.log.Info("host offline", "host", host)

	go s.ping(h.limits.PingInterval)
	for {
		p.conn.SetReadDeadline(time.Now().Add(3 * h.limits.PingInterval))
		var msg wire.Control
		if err := wire.ReadJSON(p.r, &msg); err != nil {
			return err
		}
		if err := h.control(s, msg); err != nil {
			return err
		}
	}
}

// control handles one message from a host. A returned error ends the session.
func (h *Hub) control(s *session, msg wire.Control) error {
	var err error
	switch msg.Type {
	case wire.TypePong:
		return nil
	case wire.TypeGrant:
		err = h.grants.Grant(s.host, msg.Client, msg.Name)
	case wire.TypeRevoke:
		err = h.grants.Revoke(s.host, msg.Client)
		s.drop(msg.Client)
	case wire.TypeTicket:
		err = h.tickets.Issue(s.host, msg.Ticket, time.Duration(msg.TTL)*time.Second)
	default:
		return nil // a newer host may send types this relay does not know
	}
	result := wire.Control{Type: wire.TypeResult, ID: msg.ID, OK: err == nil}
	if err != nil {
		result.Error = err.Error()
		h.log.Warn("host request failed", "host", s.host, "type", msg.Type, "err", err)
	}
	return s.send(result)
}

// connect asks host to dial back for client, then copies bytes between the
// two until either side closes.
func (h *Hub) connect(ctx context.Context, p peer, host, client wire.Key, pair bool) error {
	s := h.lookup(host)
	if s == nil {
		return refusal(wire.ErrCodeHostOffline)
	}
	id, st, err := s.begin(client, h.limits.MaxStreamsPerHost)
	if err != nil {
		return err
	}
	defer s.end(id, st)

	p.conn.SetDeadline(time.Time{})
	if err := s.send(wire.Control{Type: wire.TypeOpen, Conn: id, Client: client, Pair: pair}); err != nil {
		return refusal(wire.ErrCodeHostOffline)
	}
	timeout := time.NewTimer(h.limits.AcceptTimeout)
	defer timeout.Stop()
	var hp peer
	select {
	case hp = <-st.accepted:
	case <-timeout.C:
		return refusal(wire.ErrCodeTimeout)
	case <-s.done:
		return refusal(wire.ErrCodeHostOffline)
	case <-ctx.Done():
		return refusal(wire.ErrCodeHostOffline)
	}
	if !s.attach(st, p.conn, hp.conn) {
		return refusal(wire.ErrCodeHostOffline)
	}

	deadline := time.Now().Add(writeTimeout)
	for _, c := range []net.Conn{hp.conn, p.conn} {
		c.SetDeadline(deadline)
		if err := wire.WriteJSON(c, wire.Reply{OK: true}); err != nil {
			return err
		}
		c.SetDeadline(time.Time{})
	}
	splice(p, hp)
	return nil
}

// accept hands a host's data connection to the stream waiting for it and
// returns when that stream ends.
func (h *Hub) accept(p peer, host wire.Key, id string) error {
	s := h.lookup(host)
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

// session is one host's control connection and the streams that go through it.
type session struct {
	host  wire.Key
	conn  net.Conn
	since time.Time
	done  chan struct{}

	wmu sync.Mutex // serializes control writes

	mu      sync.Mutex
	streams map[string]*stream
	closed  bool
}

// stream is one device-to-host stream, from the device's request to its end.
type stream struct {
	client   wire.Key
	accepted chan peer     // the host's data connection, sent at most once
	finished chan struct{} // closed when the stream ends, however it ends
	taken    bool          // a host connection has claimed this stream
	dead     bool          // revoked before the connections were attached
	conns    []net.Conn    // both ends, once attached
}

func newSession(host wire.Key, conn net.Conn) *session {
	return &session{
		host: host, conn: conn, since: time.Now(),
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

// begin registers a new stream for client.
func (s *session) begin(client wire.Key, limit int) (string, *stream, error) {
	raw := make([]byte, 16)
	rand.Read(raw) // never fails (Go 1.24+)
	id := base64.RawURLEncoding.EncodeToString(raw)
	st := &stream{client: client, accepted: make(chan peer, 1), finished: make(chan struct{})}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return "", nil, refusal(wire.ErrCodeHostOffline)
	}
	if len(s.streams) >= limit {
		return "", nil, refusal(wire.ErrCodeBusy)
	}
	s.streams[id] = st
	return id, st, nil
}

// take claims the stream id for a host data connection. It returns nil when
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

// attach records both ends of a stream so close and drop can end it. It
// reports false when the stream must not start.
func (s *session) attach(st *stream, conns ...net.Conn) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed || st.dead {
		return false
	}
	st.conns = conns
	return true
}

// end forgets a stream and releases the host connection waiting on it.
func (s *session) end(id string, st *stream) {
	s.mu.Lock()
	delete(s.streams, id)
	s.mu.Unlock()
	close(st.finished)
}

// drop ends every stream client has through this session.
func (s *session) drop(client wire.Key) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, st := range s.streams {
		if st.client != client {
			continue
		}
		st.dead = true
		for _, c := range st.conns {
			c.Close()
		}
	}
}
