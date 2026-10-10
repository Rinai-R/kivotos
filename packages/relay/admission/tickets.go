package admission

import (
	"crypto/subtle"
	"errors"
	"sync"
	"time"

	"github.com/Rinai-R/kivotos/packages/relay/wire"
)

const (
	// MaxTicketTTL caps how long a pairing code stays valid.
	MaxTicketTTL = 10 * time.Minute
	// MaxTicketsPerHost caps the pairing codes one host can have outstanding.
	MaxTicketsPerHost = 8

	// A source address is refused outright after failureLimit refused
	// handshakes within failureWindow.
	failureLimit  = 10
	failureWindow = time.Minute
	// failureSweepAt is the table size that triggers dropping expired entries.
	failureSweepAt = 4096
)

var (
	ErrTicketTTL     = errors.New("ticket lifetime is out of range")
	ErrTooManyTicket = errors.New("too many outstanding pairing tickets")
)

// Tickets holds outstanding pairing tickets in memory. A ticket lets one
// device that is not yet granted open one stream to the host that issued it.
// The zero value is ready to use.
type Tickets struct {
	mu     sync.Mutex
	byHost map[wire.Key]map[string]time.Time // hash -> expiry
}

// Issue registers the hash of a pairing code for host.
func (t *Tickets) Issue(host wire.Key, hash string, ttl time.Duration) error {
	if ttl <= 0 || ttl > MaxTicketTTL {
		return ErrTicketTTL
	}
	now := time.Now()
	t.mu.Lock()
	defer t.mu.Unlock()
	held := t.byHost[host]
	for h, expiry := range held {
		if now.After(expiry) {
			delete(held, h)
		}
	}
	if len(held) >= MaxTicketsPerHost {
		return ErrTooManyTicket
	}
	if held == nil {
		held = map[string]time.Time{}
		if t.byHost == nil {
			t.byHost = map[wire.Key]map[string]time.Time{}
		}
		t.byHost[host] = held
	}
	held[hash] = now.Add(ttl)
	return nil
}

// Redeem reports whether code is an unexpired ticket for host, and uses it up.
func (t *Tickets) Redeem(host wire.Key, code string) bool {
	want := wire.TicketHash(code)
	now := time.Now()
	t.mu.Lock()
	defer t.mu.Unlock()
	held := t.byHost[host]
	for hash, expiry := range held {
		if subtle.ConstantTimeCompare([]byte(hash), []byte(want)) != 1 {
			continue
		}
		delete(held, hash)
		if len(held) == 0 {
			delete(t.byHost, host)
		}
		return now.Before(expiry)
	}
	return false
}

// Forget drops every ticket host issued.
func (t *Tickets) Forget(host wire.Key) {
	t.mu.Lock()
	defer t.mu.Unlock()
	delete(t.byHost, host)
}

// failures counts refused handshakes per source address. The zero value is
// ready to use.
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
