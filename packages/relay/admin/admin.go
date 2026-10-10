// Package admin is the operator's interface to a running relay: register and
// remove networks and see which of their computers are online. It is served
// on a unix socket only, so access is whoever may open that file.
package admin

import (
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"time"

	"github.com/Rinai-R/kivotos/packages/relay/registry"
	"github.com/Rinai-R/kivotos/packages/relay/tunnel"
	"github.com/Rinai-R/kivotos/packages/relay/wire"
)

// Network is a registered network with its live state.
type Network struct {
	ID    wire.NetworkID `json:"id"`
	Name  string         `json:"name,omitzero"`
	Added time.Time      `json:"added"`
	Nodes []Node         `json:"nodes"`
}

// Node is a computer of a network that is online now.
type Node struct {
	ID      wire.NodeID `json:"id"`
	Name    string      `json:"name,omitzero"`
	Since   time.Time   `json:"since"`
	Streams int         `json:"streams"`
}

type addRequest struct {
	Registration string `json:"registration"`
	Name         string `json:"name"`
}

type errorResponse struct {
	Error string `json:"error"`
}

// NewHandler serves the admin API over reg and hub.
func NewHandler(reg *registry.Registry, hub *tunnel.Hub) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /networks", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, list(reg, hub))
	})
	mux.HandleFunc("POST /networks", func(w http.ResponseWriter, r *http.Request) {
		var req addRequest
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		registration, err := wire.ParseRegistration(req.Registration)
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		if err := reg.Add(registration, req.Name); err != nil {
			writeError(w, statusOf(err), err)
			return
		}
		writeJSON(w, http.StatusCreated, Network{ID: registration.Network, Name: req.Name})
	})
	mux.HandleFunc("DELETE /networks/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := wire.NetworkID(r.PathValue("id"))
		if err := reg.Remove(id); err != nil {
			writeError(w, statusOf(err), err)
			return
		}
		hub.Kick(id)
		w.WriteHeader(http.StatusNoContent)
	})
	return mux
}

func list(reg *registry.Registry, hub *tunnel.Hub) []Network {
	networks := reg.Networks()
	out := make([]Network, 0, len(networks))
	for _, n := range networks {
		online := hub.Nodes(n.ID)
		view := Network{ID: n.ID, Name: n.Name, Added: n.Added, Nodes: make([]Node, len(online))}
		for i, node := range online {
			view.Nodes[i] = Node{ID: node.Node, Name: node.Name, Since: node.Since, Streams: node.Streams}
		}
		out = append(out, view)
	}
	return out
}

func statusOf(err error) int {
	switch {
	case errors.Is(err, registry.ErrExists):
		return http.StatusConflict
	case errors.Is(err, registry.ErrNotFound):
		return http.StatusNotFound
	}
	return http.StatusInternalServerError
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, errorResponse{Error: err.Error()})
}

// Listen opens the admin socket at path, readable and writable by its owner
// only. A socket file left behind by a dead relay is replaced; a live one is
// an error.
func Listen(path string) (net.Listener, error) {
	if conn, err := net.DialTimeout("unix", path, time.Second); err == nil {
		conn.Close()
		return nil, fmt.Errorf("a relay is already serving %s", path)
	}
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, fmt.Errorf("removing stale admin socket: %w", err)
	}
	ln, err := net.Listen("unix", path)
	if err != nil {
		return nil, err
	}
	if err := os.Chmod(path, 0o600); err != nil {
		ln.Close()
		return nil, err
	}
	return ln, nil
}
