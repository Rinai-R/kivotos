// Package admission decides whether a new connection may use the relay. It
// runs the challenge and hello exchange, verifies the device's signature, and
// checks the device against the registry or a pairing ticket.
//
// Admission protects the relay and the hosts' tunnels from strangers. It is
// not what protects the traffic: that is the end-to-end TLS between device
// and host, which the relay never sees inside.
package admission

import (
	"bufio"
	"errors"
	"fmt"
	"net"
	"time"

	"github.com/Rinai-R/kivotos/packages/relay/wire"
)

// Directory answers who is enrolled. *registry.Registry implements it.
type Directory interface {
	HostKnown(host wire.Key) bool
	ClientAllowed(host, client wire.Key) bool
}

// Gate admits connections. It is safe for concurrent use.
type Gate struct {
	dir     Directory
	tickets *Tickets
	timeout time.Duration
	fails   failures
}

// NewGate returns a Gate whose whole handshake must finish within timeout.
func NewGate(dir Directory, tickets *Tickets, timeout time.Duration) *Gate {
	return &Gate{dir: dir, tickets: tickets, timeout: timeout}
}

// Admit runs the handshake on conn and returns the verified hello. remote is
// the peer's address, used to slow down a source that keeps being refused.
//
// On refusal it tells the peer why with a wire.Reply and returns an error;
// the caller only has to close conn. On success it writes nothing: the caller
// replies once it knows whether the hello can be served. The handshake
// deadline stays set on conn for the caller to extend or clear.
func (g *Gate) Admit(conn net.Conn, r *bufio.Reader, remote string) (wire.Hello, error) {
	ip := remote
	conn.SetDeadline(time.Now().Add(g.timeout))
	if g.fails.blocked(ip) {
		return wire.Hello{}, g.refuse(conn, wire.ErrCodeRateLimited, errors.New("too many refused handshakes"))
	}
	challenge := wire.NewChallenge()
	if err := wire.WriteJSON(conn, challenge); err != nil {
		return wire.Hello{}, fmt.Errorf("sending challenge: %w", err)
	}
	var hello wire.Hello
	if err := wire.ReadJSON(r, &hello); err != nil {
		// Scanners and dropped connections end here; they are not counted.
		return wire.Hello{}, fmt.Errorf("reading hello: %w", err)
	}
	if err := hello.Verify(challenge.Challenge); err != nil {
		g.fails.record(ip)
		return wire.Hello{}, g.refuse(conn, wire.ErrCodeBadHello, err)
	}
	if !g.allowed(hello) {
		g.fails.record(ip)
		return wire.Hello{}, g.refuse(conn, wire.ErrCodeDenied,
			fmt.Errorf("%s %s is not allowed", hello.Role, hello.Key))
	}
	return hello, nil
}

func (g *Gate) allowed(h wire.Hello) bool {
	switch h.Role {
	case wire.RoleHost, wire.RoleAccept:
		return g.dir.HostKnown(h.Key)
	case wire.RoleClient:
		return g.dir.ClientAllowed(h.Host, h.Key)
	case wire.RolePair:
		return g.dir.HostKnown(h.Host) && g.tickets.Redeem(h.Host, h.Ticket)
	}
	return false
}

func (g *Gate) refuse(conn net.Conn, code string, cause error) error {
	// Best effort: the peer may already be gone.
	wire.WriteJSON(conn, wire.Reply{Error: code})
	return fmt.Errorf("%s: %w", code, cause)
}
