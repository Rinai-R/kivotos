// Package wire defines what travels between the relay and its peers before a
// connection becomes an opaque byte stream: the challenge, the signed hello,
// the reply, and the control messages on a host's long-lived connection.
//
// Every message is one line of JSON. The package does no network I/O beyond
// reading and writing those lines.
package wire

import (
	"bufio"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
)

// Version is the protocol version the relay announces in its challenge.
const Version = 1

// MaxLine bounds one JSON line, newline included.
const MaxLine = 4096

// signingContext separates relay hello signatures from any other use of a device key.
const signingContext = "kivotos-relay-v1"

// Role says what a connection is for.
type Role string

const (
	// RoleHost is a computer's long-lived control connection.
	RoleHost Role = "host"
	// RoleAccept is a computer's data connection answering one "open".
	RoleAccept Role = "accept"
	// RoleClient is a paired device asking for a stream to a host.
	RoleClient Role = "client"
	// RolePair is an unpaired device presenting a one-time pairing ticket.
	RolePair Role = "pair"
)

// Key is a device identity: an Ed25519 public key in unpadded base64url.
type Key string

// NewKey encodes a public key.
func NewKey(pub ed25519.PublicKey) Key {
	return Key(base64.RawURLEncoding.EncodeToString(pub))
}

// ParseKey validates s as a Key.
func ParseKey(s string) (Key, error) {
	if _, err := Key(s).public(); err != nil {
		return "", err
	}
	return Key(s), nil
}

func (k Key) public() (ed25519.PublicKey, error) {
	raw, err := base64.RawURLEncoding.DecodeString(string(k))
	if err != nil {
		return nil, fmt.Errorf("decoding key: %w", err)
	}
	if len(raw) != ed25519.PublicKeySize {
		return nil, fmt.Errorf("key is %d bytes, want %d", len(raw), ed25519.PublicKeySize)
	}
	return raw, nil
}

// Challenge is the relay's first line on every connection.
type Challenge struct {
	V         int    `json:"v"`
	Challenge string `json:"challenge"`
}

// NewChallenge returns a challenge with a fresh random nonce.
func NewChallenge() Challenge {
	nonce := make([]byte, 32)
	rand.Read(nonce) // never fails (Go 1.24+)
	return Challenge{V: Version, Challenge: base64.RawURLEncoding.EncodeToString(nonce)}
}

// Hello is a peer's answer to the challenge. Which fields are set depends on Role.
type Hello struct {
	Role Role `json:"role"`
	// Key is the sender's identity.
	Key Key `json:"key"`
	// Host is the computer a client or pairing device wants to reach.
	Host Key `json:"host,omitempty"`
	// Conn names the "open" an accept connection answers.
	Conn string `json:"conn,omitempty"`
	// Ticket is the one-time pairing code (RolePair only).
	Ticket string `json:"ticket,omitempty"`
	// Sig signs the challenge and every field above with Key.
	Sig string `json:"sig"`
}

func (h Hello) signingInput(challenge string) []byte {
	return fmt.Appendf(nil, "%s\n%s\n%s\n%s\n%s\n%s\n%s",
		signingContext, challenge, h.Role, h.Key, h.Host, h.Conn, h.Ticket)
}

// Sign fills in Key and Sig for the given challenge.
func (h *Hello) Sign(priv ed25519.PrivateKey, challenge string) {
	h.Key = NewKey(priv.Public().(ed25519.PublicKey))
	h.Sig = base64.RawURLEncoding.EncodeToString(ed25519.Sign(priv, h.signingInput(challenge)))
}

// Verify checks that the hello is well formed for its role and that Key
// signed it for this challenge.
func (h Hello) Verify(challenge string) error {
	pub, err := h.Key.public()
	if err != nil {
		return err
	}
	switch h.Role {
	case RoleHost:
	case RoleAccept:
		if h.Conn == "" {
			return errors.New("accept hello without conn")
		}
	case RoleClient, RolePair:
		if _, err := h.Host.public(); err != nil {
			return fmt.Errorf("host: %w", err)
		}
		if h.Role == RolePair && h.Ticket == "" {
			return errors.New("pair hello without ticket")
		}
	default:
		return fmt.Errorf("unknown role %q", h.Role)
	}
	sig, err := base64.RawURLEncoding.DecodeString(h.Sig)
	if err != nil {
		return fmt.Errorf("decoding signature: %w", err)
	}
	if !ed25519.Verify(pub, h.signingInput(challenge), sig) {
		return errors.New("signature does not match")
	}
	return nil
}

// Reply codes a peer may see in Reply.Error.
const (
	ErrCodeBadHello    = "bad_hello"
	ErrCodeDenied      = "denied"
	ErrCodeRateLimited = "rate_limited"
	ErrCodeHostOffline = "host_offline"
	ErrCodeBusy        = "busy"
	ErrCodeTimeout     = "timeout"
	ErrCodeUnknownConn = "unknown_conn"
)

// Reply ends the handshake. After an OK reply to a client, pair or accept
// hello, the connection carries raw bytes to the other side.
type Reply struct {
	OK    bool   `json:"ok"`
	Error string `json:"error,omitempty"`
}

// Control message types on a host's control connection.
const (
	// Relay to host.
	TypeOpen   = "open"   // a device wants a stream: dial back with RoleAccept and Conn
	TypePing   = "ping"   // answer with pong
	TypeResult = "result" // outcome of the request with the same ID

	// Host to relay.
	TypePong   = "pong"
	TypeGrant  = "grant"  // let Client reach this host
	TypeRevoke = "revoke" // stop letting Client reach this host
	TypeTicket = "ticket" // admit one unpaired device that presents the code hashing to Ticket
)

// Control is one message on a host's control connection.
type Control struct {
	Type string `json:"type"`
	// ID pairs a request with its result.
	ID uint64 `json:"id,omitempty"`
	// Conn names a stream (open).
	Conn string `json:"conn,omitempty"`
	// Client is the device asking (open) or being granted or revoked.
	Client Key `json:"client,omitempty"`
	// Name labels a granted device for people.
	Name string `json:"name,omitempty"`
	// Pair marks an open that came in on a pairing ticket, not a grant.
	Pair bool `json:"pair,omitempty"`
	// Ticket is TicketHash of the pairing code (ticket).
	Ticket string `json:"ticket,omitempty"`
	// TTL is the ticket's lifetime in seconds.
	TTL   int    `json:"ttl,omitempty"`
	OK    bool   `json:"ok,omitempty"`
	Error string `json:"error,omitempty"`
}

// TicketHash is what a host registers for a pairing code, so the relay never
// stores the code itself.
func TicketHash(code string) string {
	sum := sha256.Sum256([]byte(code))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

// NewReader returns a reader sized so that ReadJSON rejects longer lines.
func NewReader(r io.Reader) *bufio.Reader {
	return bufio.NewReaderSize(r, MaxLine)
}

// ReadJSON reads one line from a reader made by NewReader and decodes it into v.
func ReadJSON(r *bufio.Reader, v any) error {
	line, err := r.ReadSlice('\n')
	if errors.Is(err, bufio.ErrBufferFull) {
		return fmt.Errorf("line longer than %d bytes", MaxLine)
	}
	if err != nil {
		return err
	}
	if err := json.Unmarshal(line, v); err != nil {
		return fmt.Errorf("decoding line: %w", err)
	}
	return nil
}

// WriteJSON writes v as one line in a single Write.
func WriteJSON(w io.Writer, v any) error {
	line, err := json.Marshal(v)
	if err != nil {
		return err
	}
	_, err = w.Write(append(line, '\n'))
	return err
}
