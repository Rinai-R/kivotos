// Package wire defines what travels between the relay and its peers before a
// connection becomes an opaque byte stream: the hello, the reply, and the
// control messages on a node's long-lived connection.
//
// Every message is one line of JSON. The package does no network I/O beyond
// reading and writing those lines.
//
// A federation ("network") is identified by values its members derive from
// one shared secret, with HKDF-SHA256 (no salt) and these info strings:
//
//	"kivotos network id"   16 bytes  NetworkID, public
//	"kivotos relay token"  32 bytes  Token, shown to the relay to be let in
//	"kivotos peer proof"   32 bytes  never sent to the relay; members prove
//	                                 it to each other inside their own TLS
//
// The relay therefore learns who may use it, but nothing that lets it pose
// as a member.
package wire

import (
	"bufio"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"
	"unicode/utf8"
)

// Version is the protocol version a hello must carry.
const Version = 2

// MaxLine bounds one JSON line, newline included. It has room for a reply
// listing every node of a full network.
const MaxLine = 16 << 10

// MaxName bounds a node's display name, in bytes.
const MaxName = 64

// Role says what a connection is for.
type Role string

const (
	// RoleNode is a computer's long-lived control connection. The computer
	// becomes visible to its network and can be dialed.
	RoleNode Role = "node"
	// RoleAccept is a computer's data connection answering one "open".
	RoleAccept Role = "accept"
	// RoleDial asks for a stream to the node named by Target.
	RoleDial Role = "dial"
	// RolePeers asks which nodes of the network are online.
	RolePeers Role = "peers"
)

// NetworkID names a federation: 16 bytes in unpadded base64url.
type NetworkID string

// Token lets its holder use the relay as a member of one network: 32 bytes
// in unpadded base64url.
type Token string

// NodeID names a member: the SHA-256 of the certificate it presents to other
// members, 32 bytes in unpadded base64url. The relay cannot check it and does
// not need to: the member dialing verifies it end to end.
type NodeID string

func checkLen(what, s string, n int) error {
	raw, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return fmt.Errorf("%s: %w", what, err)
	}
	if len(raw) != n {
		return fmt.Errorf("%s is %d bytes, want %d", what, len(raw), n)
	}
	return nil
}

// Registration is what a network's creator hands the relay operator:
// "<network id>.<token>".
type Registration struct {
	Network NetworkID
	Token   Token
}

// ParseRegistration validates s as a Registration.
func ParseRegistration(s string) (Registration, error) {
	id, token, ok := strings.Cut(s, ".")
	if !ok {
		return Registration{}, errors.New(`registration must look like "<network id>.<token>"`)
	}
	if err := checkLen("network id", id, 16); err != nil {
		return Registration{}, err
	}
	if err := checkLen("token", token, 32); err != nil {
		return Registration{}, err
	}
	return Registration{Network: NetworkID(id), Token: Token(token)}, nil
}

// Hello is the first line a peer sends. Which fields are set depends on Role.
type Hello struct {
	V       int       `json:"v"`
	Role    Role      `json:"role"`
	Network NetworkID `json:"network"`
	Token   Token     `json:"token"`
	// Node is the sender.
	Node NodeID `json:"node"`
	// Name labels a node for people (RoleNode).
	Name string `json:"name,omitempty"`
	// Target is the node to reach (RoleDial).
	Target NodeID `json:"target,omitempty"`
	// Conn names the "open" an accept connection answers (RoleAccept).
	Conn string `json:"conn,omitempty"`
}

// Validate checks that the hello is well formed for its role. It says nothing
// about whether the token is right.
func (h Hello) Validate() error {
	if h.V != Version {
		return fmt.Errorf("protocol version %d, want %d", h.V, Version)
	}
	if err := checkLen("network id", string(h.Network), 16); err != nil {
		return err
	}
	if err := checkLen("token", string(h.Token), 32); err != nil {
		return err
	}
	if err := checkLen("node id", string(h.Node), 32); err != nil {
		return err
	}
	switch h.Role {
	case RoleNode:
		if len(h.Name) > MaxName || !utf8.ValidString(h.Name) {
			return fmt.Errorf("name must be valid UTF-8 of at most %d bytes", MaxName)
		}
	case RoleAccept:
		if h.Conn == "" {
			return errors.New("accept hello without conn")
		}
	case RoleDial:
		if err := checkLen("target", string(h.Target), 32); err != nil {
			return err
		}
	case RolePeers:
	default:
		return fmt.Errorf("unknown role %q", h.Role)
	}
	return nil
}

// Reply codes a peer may see in Reply.Error.
const (
	ErrCodeBadHello    = "bad_hello"
	ErrCodeDenied      = "denied"
	ErrCodeRateLimited = "rate_limited"
	ErrCodeOffline     = "offline"
	ErrCodeBusy        = "busy"
	ErrCodeTimeout     = "timeout"
	ErrCodeUnknownConn = "unknown_conn"
)

// Peer is one online node of a network.
type Peer struct {
	Node  NodeID    `json:"node"`
	Name  string    `json:"name,omitempty"`
	Since time.Time `json:"since"`
}

// Reply answers a hello. After an OK reply to a dial or accept hello, the
// connection carries raw bytes to the other side. The reply to a peers hello
// carries Peers and ends the connection.
type Reply struct {
	OK    bool   `json:"ok"`
	Error string `json:"error,omitempty"`
	Peers []Peer `json:"peers,omitempty"`
}

// Control message types on a node's control connection.
const (
	// Relay to node.
	TypeOpen = "open" // a member wants a stream: dial back with RoleAccept and Conn
	TypePing = "ping" // answer with pong

	// Node to relay.
	TypePong = "pong"
)

// Control is one message on a node's control connection.
type Control struct {
	Type string `json:"type"`
	// Conn names a stream (open).
	Conn string `json:"conn,omitempty"`
	// From is the member asking (open), as it named itself.
	From NodeID `json:"from,omitempty"`
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
