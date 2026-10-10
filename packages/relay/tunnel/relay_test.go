package tunnel_test

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/base64"
	"io"
	"log/slog"
	"net"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/Rinai-R/kivotos/packages/relay/admission"
	"github.com/Rinai-R/kivotos/packages/relay/registry"
	"github.com/Rinai-R/kivotos/packages/relay/tunnel"
	"github.com/Rinai-R/kivotos/packages/relay/wire"
)

// relay is a real relay on a loopback port, assembled as the serve command does.
type relay struct {
	url string
	reg *registry.Registry
	hub *tunnel.Hub
}

func startRelay(t *testing.T) *relay {
	t.Helper()
	reg, err := registry.Open(filepath.Join(t.TempDir(), "registry.json"))
	if err != nil {
		t.Fatal(err)
	}
	log := slog.New(slog.DiscardHandler)
	hub := tunnel.NewHub(tunnel.Limits{
		AcceptTimeout:      300 * time.Millisecond,
		PingInterval:       200 * time.Millisecond,
		MaxNodesPerNetwork: 2,
		MaxStreamsPerNode:  4,
	}, log)
	server := &tunnel.Server{Hub: hub, Gate: admission.NewGate(reg, 2*time.Second), Log: log}
	web := httptest.NewUnstartedServer(server)
	// t.Context is canceled before cleanups run, which ends every connection.
	web.Config.BaseContext = func(net.Listener) context.Context { return t.Context() }
	web.Start()
	t.Cleanup(func() {
		web.Close()
		hub.Close()
		server.Wait()
	})
	return &relay{url: "ws" + strings.TrimPrefix(web.URL, "http"), reg: reg, hub: hub}
}

func random(t *testing.T, n int) string {
	t.Helper()
	raw := make([]byte, n)
	rand.Read(raw)
	return base64.RawURLEncoding.EncodeToString(raw)
}

// network is a federation registered on the relay, as its members know it.
type network struct {
	id    wire.NetworkID
	token wire.Token
}

func (r *relay) register(t *testing.T) network {
	t.Helper()
	n := network{id: wire.NetworkID(random(t, 16)), token: wire.Token(random(t, 32))}
	if err := r.reg.Add(wire.Registration{Network: n.id, Token: n.token}, "home"); err != nil {
		t.Fatal(err)
	}
	return n
}

func newNode(t *testing.T) wire.NodeID { return wire.NodeID(random(t, 32)) }

// hello opens a connection, sends h, and returns the connection with the
// relay's reply. Unset version, network and token come from n.
func (r *relay) hello(t *testing.T, n network, h wire.Hello) (net.Conn, *bufio.Reader, wire.Reply) {
	t.Helper()
	ws, _, err := websocket.Dial(t.Context(), r.url, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ws.CloseNow() })
	conn := websocket.NetConn(context.Background(), ws, websocket.MessageBinary)
	conn.SetDeadline(time.Now().Add(5 * time.Second))
	if h.V == 0 {
		h.V = wire.Version
	}
	if h.Network == "" {
		h.Network = n.id
	}
	if h.Token == "" {
		h.Token = n.token
	}
	if err := wire.WriteJSON(conn, h); err != nil {
		t.Fatal(err)
	}
	br := wire.NewReader(conn)
	var reply wire.Reply
	if err := wire.ReadJSON(br, &reply); err != nil {
		t.Fatalf("reading reply: %v", err)
	}
	return conn, br, reply
}

// node is a fake computer: it holds a control connection and answers every
// "open" by dialing back and echoing what the other member sends.
type node struct {
	id     wire.NodeID
	opens  chan wire.Control
	closed chan struct{}
}

// startNode brings a computer online. With ignoreOpens it stays silent when
// asked to dial back.
func (r *relay) startNode(t *testing.T, n network, id wire.NodeID, name string, ignoreOpens bool) *node {
	t.Helper()
	conn, br, reply := r.hello(t, n, wire.Hello{Role: wire.RoleNode, Node: id, Name: name})
	if !reply.OK {
		t.Fatalf("node refused: %s", reply.Error)
	}
	conn.SetDeadline(time.Time{})
	nd := &node{id: id, opens: make(chan wire.Control, 8), closed: make(chan struct{})}
	go func() {
		defer close(nd.closed)
		for {
			var msg wire.Control
			if wire.ReadJSON(br, &msg) != nil {
				return
			}
			switch msg.Type {
			case wire.TypePing:
				wire.WriteJSON(conn, wire.Control{Type: wire.TypePong})
			case wire.TypeOpen:
				nd.opens <- msg
				if !ignoreOpens {
					go r.echo(t, n, id, msg.Conn)
				}
			}
		}
	}()
	return nd
}

func (r *relay) echo(t *testing.T, n network, id wire.NodeID, conn string) {
	c, br, reply := r.hello(t, n, wire.Hello{Role: wire.RoleAccept, Node: id, Conn: conn})
	if !reply.OK {
		return
	}
	c.SetDeadline(time.Time{})
	io.Copy(c, br)
	c.Close()
}

// roundTrip proves bytes cross the relay both ways on an open stream.
func roundTrip(t *testing.T, conn net.Conn, br *bufio.Reader) {
	t.Helper()
	const msg = "end-to-end bytes the relay must not touch\x00\xff"
	if _, err := conn.Write([]byte(msg)); err != nil {
		t.Fatal(err)
	}
	got := make([]byte, len(msg))
	if _, err := io.ReadFull(br, got); err != nil {
		t.Fatalf("reading echo: %v", err)
	}
	if string(got) != msg {
		t.Fatalf("echo = %q, want %q", got, msg)
	}
}

func TestMemberReachesANodeOfItsNetwork(t *testing.T) {
	r := startRelay(t)
	home := r.register(t)
	desk, phone := newNode(t), newNode(t)
	nd := r.startNode(t, home, desk, "desk", false)
	dial := wire.Hello{Role: wire.RoleDial, Node: phone, Target: desk}

	conn, br, reply := r.hello(t, home, dial)
	if !reply.OK {
		t.Fatalf("dial refused: %s", reply.Error)
	}
	if open := <-nd.opens; open.From != phone {
		t.Fatalf("open.From = %s, want the dialing member %s", open.From, phone)
	}
	roundTrip(t, conn, br)

	// One stream must not disturb another to the same node.
	conn2, br2, reply := r.hello(t, home, dial)
	if !reply.OK {
		t.Fatalf("second stream refused: %s", reply.Error)
	}
	conn.Close()
	roundTrip(t, conn2, br2)

	// The member leaving must end its stream on the relay, not leave it counted.
	deadline := time.Now().Add(5 * time.Second)
	for r.hub.Nodes(home.id)[0].Streams != 1 {
		if time.Now().After(deadline) {
			t.Fatalf("streams = %d after one of two closed, want 1", r.hub.Nodes(home.id)[0].Streams)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestNodesAreVisibleOnlyInsideTheirNetwork(t *testing.T) {
	r := startRelay(t)
	home, other := r.register(t), r.register(t)
	desk, laptop, phone := newNode(t), newNode(t), newNode(t)
	r.startNode(t, home, desk, "desk", false)
	r.startNode(t, home, laptop, "laptop", false)

	_, _, reply := r.hello(t, home, wire.Hello{Role: wire.RolePeers, Node: phone})
	if !reply.OK || len(reply.Peers) != 2 || reply.Peers[0].Name != "desk" || reply.Peers[1].Node != laptop {
		t.Fatalf("peers in the network = %+v, want desk then laptop", reply)
	}
	if _, _, reply := r.hello(t, other, wire.Hello{Role: wire.RolePeers, Node: phone}); !reply.OK || len(reply.Peers) != 0 {
		t.Fatalf("peers seen from another network = %+v, want none", reply)
	}
	// Knowing a node's ID is not enough: it cannot be dialed from another network.
	_, _, reply = r.hello(t, other, wire.Hello{Role: wire.RoleDial, Node: phone, Target: desk})
	if reply.OK || reply.Error != wire.ErrCodeOffline {
		t.Fatalf("dial across networks: reply = %+v, want offline", reply)
	}
}

func TestRelayRefusesWhoItShould(t *testing.T) {
	r := startRelay(t)
	home, other := r.register(t), r.register(t)
	desk, phone := newNode(t), newNode(t)
	r.startNode(t, home, desk, "desk", false)
	unregistered := network{id: wire.NetworkID(random(t, 16)), token: wire.Token(random(t, 32))}

	tests := []struct {
		name  string
		as    network
		hello wire.Hello
		want  string
	}{
		{"network the operator never registered", unregistered,
			wire.Hello{Role: wire.RoleNode, Node: desk}, wire.ErrCodeDenied},
		{"right network, wrong token", home,
			wire.Hello{Role: wire.RoleDial, Node: phone, Target: desk, Token: wire.Token(random(t, 32))}, wire.ErrCodeDenied},
		{"another network's token", home,
			wire.Hello{Role: wire.RoleDial, Node: phone, Target: desk, Token: other.token}, wire.ErrCodeDenied},
		{"older protocol version", home,
			wire.Hello{V: 1, Role: wire.RoleDial, Node: phone, Target: desk}, wire.ErrCodeBadHello},
		{"dial without a target", home,
			wire.Hello{Role: wire.RoleDial, Node: phone}, wire.ErrCodeBadHello},
		{"target that is not online", home,
			wire.Hello{Role: wire.RoleDial, Node: phone, Target: newNode(t)}, wire.ErrCodeOffline},
		{"node answering a stream nobody asked for", home,
			wire.Hello{Role: wire.RoleAccept, Node: desk, Conn: "never-opened"}, wire.ErrCodeUnknownConn},
		{"member answering a stream of a node it is not", home,
			wire.Hello{Role: wire.RoleAccept, Node: phone, Conn: "x"}, wire.ErrCodeUnknownConn},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, _, reply := r.hello(t, tt.as, tt.hello)
			if reply.OK || reply.Error != tt.want {
				t.Fatalf("reply = %+v, want error %q", reply, tt.want)
			}
		})
	}
}

func TestMemberIsToldWhenTheNodeDoesNotDialBack(t *testing.T) {
	r := startRelay(t)
	home := r.register(t)
	desk := newNode(t)
	r.startNode(t, home, desk, "desk", true)

	_, _, reply := r.hello(t, home, wire.Hello{Role: wire.RoleDial, Node: newNode(t), Target: desk})
	if reply.OK || reply.Error != wire.ErrCodeTimeout {
		t.Fatalf("reply = %+v, want timeout", reply)
	}
	// The abandoned stream must not keep counting against the node's limit.
	if nodes := r.hub.Nodes(home.id); len(nodes) != 1 || nodes[0].Streams != 0 {
		t.Fatalf("nodes = %+v, want one node with no streams", nodes)
	}
}

func TestLimitsPerNetworkAndPerNode(t *testing.T) {
	r := startRelay(t) // 2 nodes per network, 4 streams per node
	home := r.register(t)
	desk := newNode(t)
	r.startNode(t, home, desk, "desk", false)
	r.startNode(t, home, newNode(t), "laptop", false)

	_, _, reply := r.hello(t, home, wire.Hello{Role: wire.RoleNode, Node: newNode(t)})
	if reply.OK || reply.Error != wire.ErrCodeBusy {
		t.Fatalf("third node: reply = %+v, want busy", reply)
	}
	// A node reconnecting takes its own place, even with the network full.
	r.startNode(t, home, desk, "desk", false)

	dial := wire.Hello{Role: wire.RoleDial, Node: newNode(t), Target: desk}
	for i := range 4 {
		if _, _, reply := r.hello(t, home, dial); !reply.OK {
			t.Fatalf("stream %d refused: %s", i, reply.Error)
		}
	}
	if _, _, reply := r.hello(t, home, dial); reply.OK || reply.Error != wire.ErrCodeBusy {
		t.Fatalf("fifth stream: reply = %+v, want busy", reply)
	}
}

func TestReconnectingNodeReplacesItsOldConnection(t *testing.T) {
	r := startRelay(t)
	home := r.register(t)
	desk := newNode(t)
	first := r.startNode(t, home, desk, "desk", true)
	r.startNode(t, home, desk, "desk", false)

	select {
	case <-first.closed:
	case <-time.After(5 * time.Second):
		t.Fatal("the replaced control connection stayed open")
	}
	// Streams go to the new connection, which answers; the old one would not.
	conn, br, reply := r.hello(t, home, wire.Hello{Role: wire.RoleDial, Node: newNode(t), Target: desk})
	if !reply.OK {
		t.Fatalf("dial after reconnect refused: %s", reply.Error)
	}
	roundTrip(t, conn, br)
}

func TestRemovedNetworkLosesItsConnections(t *testing.T) {
	r := startRelay(t)
	home := r.register(t)
	desk := newNode(t)
	nd := r.startNode(t, home, desk, "desk", false)
	conn, br, reply := r.hello(t, home, wire.Hello{Role: wire.RoleDial, Node: newNode(t), Target: desk})
	if !reply.OK {
		t.Fatalf("dial refused: %s", reply.Error)
	}
	roundTrip(t, conn, br)

	// What the admin API does on "network remove".
	if err := r.reg.Remove(home.id); err != nil {
		t.Fatal(err)
	}
	r.hub.Kick(home.id)

	select {
	case <-nd.closed:
	case <-time.After(5 * time.Second):
		t.Fatal("control connection stayed open after the network was removed")
	}
	conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	if _, err := br.ReadByte(); err == nil {
		t.Fatal("stream stayed open after the network was removed")
	} else if ne, ok := err.(net.Error); ok && ne.Timeout() {
		t.Fatal("stream was not closed after the network was removed")
	}
	if _, _, reply := r.hello(t, home, wire.Hello{Role: wire.RolePeers, Node: desk}); reply.OK {
		t.Fatal("removed network was still admitted")
	}
}
