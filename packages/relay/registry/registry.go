// Package registry is the relay's durable record of which federations
// ("networks") may use it. For each it keeps a salted hash of the network's
// relay token, never the token.
package registry

import (
	"cmp"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"sync"
	"time"

	"github.com/Rinai-R/kivotos/packages/relay/wire"
)

var (
	ErrExists   = errors.New("network is already registered")
	ErrNotFound = errors.New("network is not registered")
)

// Network is a registered federation.
type Network struct {
	ID    wire.NetworkID `json:"id"`
	Name  string         `json:"name,omitzero"`
	Added time.Time      `json:"added"`
	// Salt and Hash verify the network's token: Hash is SHA-256(Salt || token).
	// The token is 32 random bytes, so a fast hash is enough.
	Salt []byte `json:"salt"`
	Hash []byte `json:"hash"`
}

func hashToken(salt []byte, token wire.Token) []byte {
	h := sha256.New()
	h.Write(salt)
	h.Write([]byte(token))
	return h.Sum(nil)
}

// Registry holds every Network in memory and rewrites its file on each
// change. It is safe for concurrent use.
type Registry struct {
	path     string
	mu       sync.RWMutex
	networks map[wire.NetworkID]*Network
}

type file struct {
	Networks []*Network `json:"networks"`
}

// Open loads the registry at path; a missing file is an empty registry.
func Open(path string) (*Registry, error) {
	r := &Registry{path: path, networks: map[wire.NetworkID]*Network{}}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return r, nil
	}
	if err != nil {
		return nil, fmt.Errorf("reading registry: %w", err)
	}
	var f file
	if err := json.Unmarshal(data, &f); err != nil {
		return nil, fmt.Errorf("decoding registry %s: %w", path, err)
	}
	for _, n := range f.Networks {
		if n.ID == "" || len(n.Salt) == 0 || len(n.Hash) != sha256.Size {
			return nil, fmt.Errorf("registry %s: network %q is incomplete", path, n.ID)
		}
		r.networks[n.ID] = n
	}
	return r, nil
}

// save writes the registry next to its file, syncs it to disk, and renames it
// into place, so neither a crash nor a power loss leaves a half-written
// registry. Callers hold mu.
func (r *Registry) save() error {
	f := file{Networks: slices.SortedFunc(maps.Values(r.networks), func(a, b *Network) int {
		return cmp.Compare(a.ID, b.ID)
	})}
	data, err := json.MarshalIndent(f, "", "  ")
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(r.path), ".registry-*")
	if err != nil {
		return fmt.Errorf("saving registry: %w", err)
	}
	defer os.Remove(tmp.Name()) // no-op after the rename
	_, err = tmp.Write(data)
	if err == nil {
		// Without this, a power loss after the rename could leave an empty file.
		err = tmp.Sync()
	}
	if closeErr := tmp.Close(); err == nil {
		err = closeErr
	}
	if err == nil {
		err = os.Rename(tmp.Name(), r.path)
	}
	if err != nil {
		return fmt.Errorf("saving registry: %w", err)
	}
	// The rename itself lives in the directory. Not every filesystem can sync
	// one, and the registry is already complete either way.
	if dir, err := os.Open(filepath.Dir(r.path)); err == nil {
		dir.Sync()
		dir.Close()
	}
	return nil
}

// Add registers a network. Only the salted hash of its token is kept.
func (r *Registry) Add(reg wire.Registration, name string) error {
	salt := make([]byte, 16)
	rand.Read(salt) // never fails (Go 1.24+)
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.networks[reg.Network]; ok {
		return ErrExists
	}
	r.networks[reg.Network] = &Network{
		ID: reg.Network, Name: name, Added: time.Now().UTC(),
		Salt: salt, Hash: hashToken(salt, reg.Token),
	}
	if err := r.save(); err != nil {
		delete(r.networks, reg.Network)
		return err
	}
	return nil
}

// Remove unregisters a network.
func (r *Registry) Remove(id wire.NetworkID) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	n, ok := r.networks[id]
	if !ok {
		return ErrNotFound
	}
	delete(r.networks, id)
	if err := r.save(); err != nil {
		r.networks[id] = n
		return err
	}
	return nil
}

// Networks returns a copy of every network, ordered by ID.
func (r *Registry) Networks() []Network {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]Network, 0, len(r.networks))
	for _, n := range r.networks {
		out = append(out, *n)
	}
	slices.SortFunc(out, func(a, b Network) int { return cmp.Compare(a.ID, b.ID) })
	return out
}

// Member reports whether token is the token of the registered network id.
func (r *Registry) Member(id wire.NetworkID, token wire.Token) bool {
	r.mu.RLock()
	n, ok := r.networks[id]
	r.mu.RUnlock()
	if !ok {
		return false
	}
	return subtle.ConstantTimeCompare(hashToken(n.Salt, token), n.Hash) == 1
}
