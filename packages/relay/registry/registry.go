// Package registry is the relay's durable record of who may use it: the
// enrolled hosts and, per host, the devices that host has granted.
package registry

import (
	"cmp"
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

// MaxClientsPerHost bounds what one host can make the relay store.
const MaxClientsPerHost = 64

var (
	ErrHostExists   = errors.New("host is already enrolled")
	ErrHostNotFound = errors.New("host is not enrolled")
	ErrTooMany      = fmt.Errorf("host already has %d granted devices", MaxClientsPerHost)
)

// Client is a device a host has granted.
type Client struct {
	Name  string    `json:"name,omitzero"`
	Added time.Time `json:"added"`
}

// Host is an enrolled computer.
type Host struct {
	Key     wire.Key            `json:"key"`
	Name    string              `json:"name,omitzero"`
	Added   time.Time           `json:"added"`
	Clients map[wire.Key]Client `json:"clients,omitzero"`
}

// Registry holds every Host in memory and rewrites its file on each change.
// It is safe for concurrent use.
type Registry struct {
	path  string
	mu    sync.RWMutex
	hosts map[wire.Key]*Host
}

type file struct {
	Hosts []*Host `json:"hosts"`
}

// Open loads the registry at path; a missing file is an empty registry.
func Open(path string) (*Registry, error) {
	r := &Registry{path: path, hosts: map[wire.Key]*Host{}}
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
	for _, h := range f.Hosts {
		if _, err := wire.ParseKey(string(h.Key)); err != nil {
			return nil, fmt.Errorf("registry %s: host %q: %w", path, h.Key, err)
		}
		r.hosts[h.Key] = h
	}
	return r, nil
}

// save writes the registry next to its file, syncs it to disk, and renames it
// into place, so neither a crash nor a power loss leaves a half-written
// registry. Callers hold mu.
func (r *Registry) save() error {
	f := file{Hosts: slices.SortedFunc(maps.Values(r.hosts), func(a, b *Host) int {
		return cmp.Compare(a.Key, b.Key)
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

// AddHost enrolls a computer.
func (r *Registry) AddHost(key wire.Key, name string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.hosts[key]; ok {
		return ErrHostExists
	}
	r.hosts[key] = &Host{Key: key, Name: name, Added: time.Now().UTC()}
	if err := r.save(); err != nil {
		delete(r.hosts, key)
		return err
	}
	return nil
}

// RemoveHost drops a computer and every grant it made.
func (r *Registry) RemoveHost(key wire.Key) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	host, ok := r.hosts[key]
	if !ok {
		return ErrHostNotFound
	}
	delete(r.hosts, key)
	if err := r.save(); err != nil {
		r.hosts[key] = host
		return err
	}
	return nil
}

// Hosts returns a copy of every host, ordered by key.
func (r *Registry) Hosts() []Host {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]Host, 0, len(r.hosts))
	for _, h := range r.hosts {
		c := *h
		c.Clients = maps.Clone(h.Clients)
		out = append(out, c)
	}
	slices.SortFunc(out, func(a, b Host) int { return cmp.Compare(a.Key, b.Key) })
	return out
}

// HostKnown reports whether key is an enrolled host.
func (r *Registry) HostKnown(key wire.Key) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	_, ok := r.hosts[key]
	return ok
}

// ClientAllowed reports whether host has granted client.
func (r *Registry) ClientAllowed(host, client wire.Key) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	h, ok := r.hosts[host]
	if !ok {
		return false
	}
	_, ok = h.Clients[client]
	return ok
}

// Grant lets client reach host. Granting again updates the name.
func (r *Registry) Grant(host, client wire.Key, name string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	h, ok := r.hosts[host]
	if !ok {
		return ErrHostNotFound
	}
	prev, had := h.Clients[client]
	if !had && len(h.Clients) >= MaxClientsPerHost {
		return ErrTooMany
	}
	if h.Clients == nil {
		h.Clients = map[wire.Key]Client{}
	}
	next := Client{Name: name, Added: time.Now().UTC()}
	if had {
		next.Added = prev.Added
	}
	h.Clients[client] = next
	if err := r.save(); err != nil {
		if had {
			h.Clients[client] = prev
		} else {
			delete(h.Clients, client)
		}
		return err
	}
	return nil
}

// Revoke stops client from reaching host. Revoking an unknown client is not an error.
func (r *Registry) Revoke(host, client wire.Key) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	h, ok := r.hosts[host]
	if !ok {
		return ErrHostNotFound
	}
	prev, had := h.Clients[client]
	if !had {
		return nil
	}
	delete(h.Clients, client)
	if err := r.save(); err != nil {
		h.Clients[client] = prev
		return err
	}
	return nil
}
