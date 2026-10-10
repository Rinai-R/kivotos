// Package admission decides whether a new connection may use the relay: it
// reads the hello, checks its shape, and checks its token against the
// registry.
//
// Admission keeps strangers off the relay and out of a network's node list.
// It is not what protects the traffic: members authenticate each other and
// encrypt end to end, with a key the relay is never shown.
package admission

import (
	"bufio"
	"errors"
	"fmt"
	"net"
	"sync"
	"time"

	"github.com/Rinai-R/kivotos/packages/relay/wire"
)

const (
	// A source address is refused outright after failureLimit refused
	// hellos within failureWindow.
	failureLimit  = 10
	failureWindow = time.Minute
	// failureSweepAt is the table size that triggers dropping expired entries.
	failureSweepAt = 4096
)

// Directory answers whether a token belongs to a registered network.
// *registry.Registry implements it.
type Directory interface {
	Member(network wire.NetworkID, token wire.Token) bool
}

// Gate admits connections. It is safe for concurrent use.
type Gate struct {
	dir     Directory
	timeout time.Duration
	fails   failures
}

// NewGate returns a Gate that waits at most timeout for a hello.
func NewGate(dir Directory, timeout time.Duration) *Gate {
	return &Gate{dir: dir, timeout: timeout}
}

// Admit reads the hello from conn and returns it once its token is accepted.
// remote is the peer's address, used to slow down a source that keeps being
// refused.
//
// On refusal it tells the peer why with a wire.Reply and returns an error;
// the caller only has to close conn. On success it writes nothing: the caller
// replies once it knows whether the hello can be served. The hello deadline
// stays set on conn for the caller to extend or clear.
func (g *Gate) Admit(conn net.Conn, r *bufio.Reader, remote string) (wire.Hello, error) {
	conn.SetDeadline(time.Now().Add(g.timeout))
	if g.fails.blocked(remote) {
		return wire.Hello{}, refuse(conn, wire.ErrCodeRateLimited, errors.New("too many refused hellos"))
	}
	var hello wire.Hello
	if err := wire.ReadJSON(r, &hello); err != nil {
		// Scanners and dropped connections end here; they are not counted.
		return wire.Hello{}, fmt.Errorf("reading hello: %w", err)
	}
	if err := hello.Validate(); err != nil {
		g.fails.record(remote)
		return wire.Hello{}, refuse(conn, wire.ErrCodeBadHello, err)
	}
	// An unknown network and a wrong token look the same to the peer.
	if !g.dir.Member(hello.Network, hello.Token) {
		g.fails.record(remote)
		return wire.Hello{}, refuse(conn, wire.ErrCodeDenied,
			fmt.Errorf("network %s: unknown, or wrong token", hello.Network))
	}
	return hello, nil
}

func refuse(conn net.Conn, code string, cause error) error {
	// Best effort: the peer may already be gone.
	wire.WriteJSON(conn, wire.Reply{Error: code})
	return fmt.Errorf("%s: %w", code, cause)
}

// failures counts refused hellos per source address. The zero value is ready
// to use.
type failures struct {
	mu   sync.Mutex
	byIP map[string]*failureCount
}

type failureCount struct {
	n     int
	until time.Time
}

func (f *failures) blocked(ip string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	c := f.byIP[ip]
	return c != nil && time.Now().Before(c.until) && c.n >= failureLimit
}

func (f *failures) record(ip string) {
	now := time.Now()
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.byIP) >= failureSweepAt {
		for k, c := range f.byIP {
			if now.After(c.until) {
				delete(f.byIP, k)
			}
		}
	}
	c := f.byIP[ip]
	if c == nil || now.After(c.until) {
		if f.byIP == nil {
			f.byIP = map[string]*failureCount{}
		}
		f.byIP[ip] = &failureCount{n: 1, until: now.Add(failureWindow)}
		return
	}
	c.n++
}
