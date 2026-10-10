// Package admin is the operator's interface to a running relay: enroll and
// remove hosts, revoke devices, and see who is online. It is served on a unix
// socket only, so access is whoever may open that file.
package admin

import (
	"cmp"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"slices"
	"time"

	"github.com/Rinai-R/kivotos/packages/relay/registry"
	"github.com/Rinai-R/kivotos/packages/relay/tunnel"
	"github.com/Rinai-R/kivotos/packages/relay/wire"
)

// Host is an enrolled host with its live state.
type Host struct {
	Key     wire.Key  `json:"key"`
	Name    string    `json:"name,omitzero"`
	Added   time.Time `json:"added"`
	Online  bool      `json:"online"`
	Streams int       `json:"streams"`
	Devices []Device  `json:"devices"`
}

// Device is a device a host has granted.
type Device struct {
	Key   wire.Key  `json:"key"`
	Name  string    `json:"name,omitzero"`
	Added time.Time `json:"added"`
}

type addHostRequest struct {
	Key  string `json:"key"`
	Name string `json:"name"`
}

type errorResponse struct {
	Error string `json:"error"`
}

// NewHandler serves the admin API over reg and hub.
func NewHandler(reg *registry.Registry, hub *tunnel.Hub) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /hosts", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, listHosts(reg, hub))
	})
	mux.HandleFunc("POST /hosts", func(w http.ResponseWriter, r *http.Request) {
		var req addHostRequest
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, wire.MaxLine)).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		key, err := wire.ParseKey(req.Key)
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		if err := reg.AddHost(key, req.Name); err != nil {
			writeError(w, statusOf(err), err)
			return
		}
		w.WriteHeader(http.StatusCreated)
	})
	mux.HandleFunc("DELETE /hosts/{host}", func(w http.ResponseWriter, r *http.Request) {
		host := wire.Key(r.PathValue("host"))
		if err := reg.RemoveHost(host); err != nil {
			writeError(w, statusOf(err), err)
			return
		}
		hub.Kick(host)
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("DELETE /hosts/{host}/devices/{device}", func(w http.ResponseWriter, r *http.Request) {
		host, client := wire.Key(r.PathValue("host")), wire.Key(r.PathValue("device"))
		if err := reg.Revoke(host, client); err != nil {
			writeError(w, statusOf(err), err)
			return
		}
		hub.DropClient(host, client)
		w.WriteHeader(http.StatusNoContent)
	})
	return mux
}

func listHosts(reg *registry.Registry, hub *tunnel.Hub) []Host {
	online := map[wire.Key]tunnel.Session{}
	for _, s := range hub.Sessions() {
		online[s.Host] = s
	}
	hosts := reg.Hosts()
	out := make([]Host, 0, len(hosts))
	for _, h := range hosts {
		session, isOnline := online[h.Key]
		view := Host{
			Key: h.Key, Name: h.Name, Added: h.Added,
			Online: isOnline, Streams: session.Streams,
			Devices: make([]Device, 0, len(h.Clients)),
		}
		for key, c := range h.Clients {
			view.Devices = append(view.Devices, Device{Key: key, Name: c.Name, Added: c.Added})
		}
		slices.SortFunc(view.Devices, func(a, b Device) int { return cmp.Compare(a.Key, b.Key) })
		out = append(out, view)
	}
	return out
}

func statusOf(err error) int {
	switch {
	case errors.Is(err, registry.ErrHostExists):
		return http.StatusConflict
	case errors.Is(err, registry.ErrHostNotFound):
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
