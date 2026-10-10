package tunnel_test

import (
	"bufio"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"io"
	"log/slog"
	"net"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
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
	tickets := &admission.Tickets{}
	log := slog.New(slog.DiscardHandler)
	hub := tunnel.NewHub(reg, tickets, tunnel.Limits{
		AcceptTimeout:     300 * time.Millisecond,
		PingInterval:      200 * time.Millisecond,
		MaxStreamsPerHost: 4,
	}, log)
	server := &tunnel.Server{Hub: hub, Gate: admission.NewGate(reg, tickets, 2*time.Second), Log: log}
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

type device struct {
	priv ed25519.PrivateKey
	key  wire.Key
}

func newDevice(t *testing.T) device {
	t.Helper()
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return device{priv: priv, key: wire.NewKey(pub)}
}

// hello dials the relay, answers its challenge with h signed by d, and
// returns the connection with the relay's reply. tamper, when set, edits the
// hello after signing.
func (r *relay) hello(t *testing.T, d device, h wire.Hello, tamper func(*wire.Hello)) (net.Conn, *bufio.Reader, wire.Reply) {
	t.Helper()
	ws, _, err := websocket.Dial(t.Context(), r.url, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ws.CloseNow() })
	conn := websocket.NetConn(context.Background(), ws, websocket.MessageBinary)
	conn.SetDeadline(time.Now().Add(5 * time.Second))
	br := wire.NewReader(conn)
	var challenge wire.Challenge
	if err := wire.ReadJSON(br, &challenge); err != nil {
		t.Fatalf("reading challenge: %v", err)
	}
	h.Sign(d.priv, challenge.Challenge)
	if tamper != nil {
		tamper(&h)
	}
	if err := wire.WriteJSON(conn, h); err != nil {
		t.Fatal(err)
	}
	var reply wire.Reply
	if err := wire.ReadJSON(br, &reply); err != nil {
		t.Fatalf("reading reply: %v", err)
	}
	return conn, br, reply
}

// host is a fake computer: it holds a control connection and answers every
// "open" by dialing back and echoing what the device sends.
type host struct {
	device
	conn    net.Conn
	opens   chan wire.Control
	results chan wire.Control
	wmu     sync.Mutex
	// ignoreOpens makes the host stay silent when asked to dial back.
	ignoreOpens bool
}

func (r *relay) startHost(t *testing.T, d device, ignoreOpens bool) *host {
	t.Helper()
	conn, br, reply := r.hello(t, d, wire.Hello{Role: wire.RoleHost}, nil)
	if !reply.OK {
		t.Fatalf("host refused: %s", reply.Error)
	}
	conn.SetDeadline(time.Time{})
	h := &host{
		device: d, conn: conn, ignoreOpens: ignoreOpens,
		opens: make(chan wire.Control, 8), results: make(chan wire.Control, 8),
	}
	go func() {
		for {
			var msg wire.Control
			if wire.ReadJSON(br, &msg) != nil {
				close(h.results)
				return
			}
			switch msg.Type {
			case wire.TypePing:
				h.send(wire.Control{Type: wire.TypePong})
			case wire.TypeResult:
				h.results <- msg
			case wire.TypeOpen:
				h.opens <- msg
				if !h.ignoreOpens {
					go r.echo(t, d, msg.Conn)
				}
			}
		}
	}()
	return h
}

func (h *host) send(msg wire.Control) {
	h.wmu.Lock()
	defer h.wmu.Unlock()
	wire.WriteJSON(h.conn, msg)
}

// request sends msg and returns the relay's result for it.
func (h *host) request(t *testing.T, msg wire.Control) wire.Control {
	t.Helper()
	msg.ID = 1
	h.send(msg)
	select {
	case res, ok := <-h.results:
		if !ok {
			t.Fatal("control connection closed before the result")
		}
		return res
	case <-time.After(5 * time.Second):
		t.Fatal("no result from the relay")
		return wire.Control{}
	}
}

func (r *relay) echo(t *testing.T, d device, id string) {
	conn, br, reply := r.hello(t, d, wire.Hello{Role: wire.RoleAccept, Conn: id}, nil)
	if !reply.OK {
		return
	}
	conn.SetDeadline(time.Time{})
	io.Copy(conn, br)
	conn.Close()
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

func TestGrantedDeviceReachesItsHost(t *testing.T) {
	r := startRelay(t)
	hostDev, phone := newDevice(t), newDevice(t)
	if err := r.reg.AddHost(hostDev.key, "desk"); err != nil {
		t.Fatal(err)
	}
	if err := r.reg.Grant(hostDev.key, phone.key, "phone"); err != nil {
		t.Fatal(err)
	}
	h := r.startHost(t, hostDev, false)

	conn, br, reply := r.hello(t, phone, wire.Hello{Role: wire.RoleClient, Host: hostDev.key}, nil)
	if !reply.OK {
		t.Fatalf("client refused: %s", reply.Error)
	}
	open := <-h.opens
	if open.Client != phone.key || open.Pair {
		t.Fatalf("open = %+v, want client %s and no pair flag", open, phone.key)
	}
	roundTrip(t, conn, br)

	// One stream must not disturb another to the same host.
	conn2, br2, reply := r.hello(t, phone, wire.Hello{Role: wire.RoleClient, Host: hostDev.key}, nil)
	if !reply.OK {
		t.Fatalf("second stream refused: %s", reply.Error)
	}
	conn.Close()
	roundTrip(t, conn2, br2)

	// The device leaving must end its stream on the relay, not leave it counted.
	deadline := time.Now().Add(5 * time.Second)
	for r.hub.Sessions()[0].Streams != 1 {
		if time.Now().After(deadline) {
			t.Fatalf("streams = %d after one of two closed, want 1", r.hub.Sessions()[0].Streams)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestRelayRefusesWhoItShould(t *testing.T) {
	r := startRelay(t)
	hostDev, phone, stranger := newDevice(t), newDevice(t), newDevice(t)
	offlineHost := newDevice(t)
	for _, d := range []device{hostDev, offlineHost} {
		if err := r.reg.AddHost(d.key, ""); err != nil {
			t.Fatal(err)
		}
	}
	for _, d := range []device{hostDev, offlineHost} {
		if err := r.reg.Grant(d.key, phone.key, ""); err != nil {
			t.Fatal(err)
		}
	}
	r.startHost(t, hostDev, false)

	tests := []struct {
		name   string
		from   device
		hello  wire.Hello
		tamper func(*wire.Hello)
		want   string
	}{
		{"device the host never granted", stranger,
			wire.Hello{Role: wire.RoleClient, Host: hostDev.key}, nil, wire.ErrCodeDenied},
		{"host nobody enrolled", stranger,
			wire.Hello{Role: wire.RoleHost}, nil, wire.ErrCodeDenied},
		{"data connection from a non-host", stranger,
			wire.Hello{Role: wire.RoleAccept, Conn: "x"}, nil, wire.ErrCodeDenied},
		{"granted device claiming another host after signing", phone,
			wire.Hello{Role: wire.RoleClient, Host: offlineHost.key},
			func(h *wire.Hello) { h.Host = hostDev.key }, wire.ErrCodeBadHello},
		{"stranger presenting a granted device's key", stranger,
			wire.Hello{Role: wire.RoleClient, Host: hostDev.key},
			func(h *wire.Hello) { h.Key = phone.key }, wire.ErrCodeBadHello},
		{"pairing without a ticket the host issued", stranger,
			wire.Hello{Role: wire.RolePair, Host: hostDev.key, Ticket: "guess"}, nil, wire.ErrCodeDenied},
		{"host is enrolled but not connected", phone,
			wire.Hello{Role: wire.RoleClient, Host: offlineHost.key}, nil, wire.ErrCodeHostOffline},
		{"host answering a stream nobody asked for", hostDev,
			wire.Hello{Role: wire.RoleAccept, Conn: "never-opened"}, nil, wire.ErrCodeUnknownConn},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, _, reply := r.hello(t, tt.from, tt.hello, tt.tamper)
			if reply.OK || reply.Error != tt.want {
				t.Fatalf("reply = %+v, want error %q", reply, tt.want)
			}
		})
	}
}

func TestPairingTicketAdmitsOneDeviceOnce(t *testing.T) {
	r := startRelay(t)
	hostDev, phone, thief := newDevice(t), newDevice(t), newDevice(t)
	if err := r.reg.AddHost(hostDev.key, ""); err != nil {
		t.Fatal(err)
	}
	h := r.startHost(t, hostDev, false)

	const code = "one-time pairing code"
	if res := h.request(t, wire.Control{Type: wire.TypeTicket, Ticket: wire.TicketHash(code), TTL: 60}); !res.OK {
		t.Fatalf("ticket refused: %s", res.Error)
	}
	pair := wire.Hello{Role: wire.RolePair, Host: hostDev.key, Ticket: code}

	conn, br, reply := r.hello(t, phone, pair, nil)
	if !reply.OK {
		t.Fatalf("pairing refused: %s", reply.Error)
	}
	if open := <-h.opens; !open.Pair || open.Client != phone.key {
		t.Fatalf("open = %+v, want pair flag and client %s", open, phone.key)
	}
	roundTrip(t, conn, br)

	// Someone who saw the code cannot use it again.
	if _, _, reply := r.hello(t, thief, pair, nil); reply.OK || reply.Error != wire.ErrCodeDenied {
		t.Fatalf("second use of the ticket: reply = %+v, want denied", reply)
	}

	// Pairing alone grants nothing: the device gets in later only once the host says so.
	client := wire.Hello{Role: wire.RoleClient, Host: hostDev.key}
	if _, _, reply := r.hello(t, phone, client, nil); reply.OK {
		t.Fatal("paired but ungranted device was admitted as a client")
	}
	if res := h.request(t, wire.Control{Type: wire.TypeGrant, Client: phone.key, Name: "phone"}); !res.OK {
		t.Fatalf("grant refused: %s", res.Error)
	}
	if _, _, reply := r.hello(t, phone, client, nil); !reply.OK {
		t.Fatalf("granted device refused: %s", reply.Error)
	}
}

func TestRevokeEndsLiveStreamsAndBlocksNewOnes(t *testing.T) {
	r := startRelay(t)
	hostDev, phone := newDevice(t), newDevice(t)
	if err := r.reg.AddHost(hostDev.key, ""); err != nil {
		t.Fatal(err)
	}
	if err := r.reg.Grant(hostDev.key, phone.key, ""); err != nil {
		t.Fatal(err)
	}
	h := r.startHost(t, hostDev, false)
	client := wire.Hello{Role: wire.RoleClient, Host: hostDev.key}
	conn, br, reply := r.hello(t, phone, client, nil)
	if !reply.OK {
		t.Fatalf("client refused: %s", reply.Error)
	}
	roundTrip(t, conn, br)

	if res := h.request(t, wire.Control{Type: wire.TypeRevoke, Client: phone.key}); !res.OK {
		t.Fatalf("revoke refused: %s", res.Error)
	}
	conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	if _, err := br.ReadByte(); err == nil {
		t.Fatal("stream of a revoked device stayed open")
	} else if ne, ok := err.(net.Error); ok && ne.Timeout() {
		t.Fatal("stream of a revoked device was not closed")
	}
	if _, _, reply := r.hello(t, phone, client, nil); reply.OK || reply.Error != wire.ErrCodeDenied {
		t.Fatalf("revoked device: reply = %+v, want denied", reply)
	}
}

func TestDeviceIsToldWhenTheHostDoesNotDialBack(t *testing.T) {
	r := startRelay(t)
	hostDev, phone := newDevice(t), newDevice(t)
	if err := r.reg.AddHost(hostDev.key, ""); err != nil {
		t.Fatal(err)
	}
	if err := r.reg.Grant(hostDev.key, phone.key, ""); err != nil {
		t.Fatal(err)
	}
	r.startHost(t, hostDev, true)

	_, _, reply := r.hello(t, phone, wire.Hello{Role: wire.RoleClient, Host: hostDev.key}, nil)
	if reply.OK || reply.Error != wire.ErrCodeTimeout {
		t.Fatalf("reply = %+v, want timeout", reply)
	}
	// The abandoned stream must not keep counting against the host's limit.
	if s := r.hub.Sessions(); len(s) != 1 || s[0].Streams != 0 {
		t.Fatalf("sessions = %+v, want one host with no streams", s)
	}
}

func TestStreamLimitPerHost(t *testing.T) {
	r := startRelay(t) // MaxStreamsPerHost is 4
	hostDev, phone := newDevice(t), newDevice(t)
	if err := r.reg.AddHost(hostDev.key, ""); err != nil {
		t.Fatal(err)
	}
	if err := r.reg.Grant(hostDev.key, phone.key, ""); err != nil {
		t.Fatal(err)
	}
	r.startHost(t, hostDev, false)
	client := wire.Hello{Role: wire.RoleClient, Host: hostDev.key}
	for i := range 4 {
		if _, _, reply := r.hello(t, phone, client, nil); !reply.OK {
			t.Fatalf("stream %d refused: %s", i, reply.Error)
		}
	}
	if _, _, reply := r.hello(t, phone, client, nil); reply.OK || reply.Error != wire.ErrCodeBusy {
		t.Fatalf("fifth stream: reply = %+v, want busy", reply)
	}
}

func TestRemovedHostLosesItsConnection(t *testing.T) {
	r := startRelay(t)
	hostDev := newDevice(t)
	if err := r.reg.AddHost(hostDev.key, ""); err != nil {
		t.Fatal(err)
	}
	h := r.startHost(t, hostDev, false)
	if !r.hub.Kick(hostDev.key) {
		t.Fatal("Kick reported the host offline")
	}
	select {
	case _, ok := <-h.results:
		if ok {
			t.Fatal("unexpected result")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("control connection stayed open after Kick")
	}
}
