// Package config is the relay's configuration: its shape, defaults, and the
// checks a configuration must pass before the relay starts.
package config

import (
	"errors"
	"fmt"
	"path/filepath"
	"time"
)

// Config is everything the relay can be told. The mapstructure tags are the
// keys in the config file; the environment form is KIVOTOS_RELAY_<KEY> with
// dots and dashes as underscores.
type Config struct {
	// Listen is the HTTP address whose /v1/connect devices and hosts open as
	// a WebSocket.
	Listen string `mapstructure:"listen"`
	// BehindProxy says a reverse proxy you run is the only way in, so the
	// peer's address is the last X-Forwarded-For entry. Leave it off when the
	// relay is reachable directly: the header would then be the peer's to forge.
	BehindProxy bool `mapstructure:"behind-proxy"`
	// DataDir holds the registry file and, by default, the admin socket.
	DataDir string `mapstructure:"data-dir"`
	// AdminSocket overrides the admin socket path.
	AdminSocket string `mapstructure:"admin-socket"`
	// TLS serves HTTPS when both files are set. Without it the relay serves
	// plain HTTP, for a reverse proxy to put TLS in front. Served bare, traffic
	// stays end-to-end encrypted, but who talks to whom, and pairing codes,
	// are visible on the network.
	TLS TLS `mapstructure:"tls"`
	// HandshakeTimeout bounds the challenge and hello exchange.
	HandshakeTimeout time.Duration `mapstructure:"handshake-timeout"`
	// AcceptTimeout is how long a device waits for a host to dial back.
	AcceptTimeout time.Duration `mapstructure:"accept-timeout"`
	// PingInterval is how often hosts are pinged; three missed drop the host.
	PingInterval time.Duration `mapstructure:"ping-interval"`
	// MaxStreamsPerHost caps concurrent streams to one host.
	MaxStreamsPerHost int `mapstructure:"max-streams-per-host"`
}

// TLS names the relay's own certificate and key files (PEM).
type TLS struct {
	Cert string `mapstructure:"cert"`
	Key  string `mapstructure:"key"`
}

// Defaults lists every key with its default, so that a value given only in
// the environment is still seen when the configuration is decoded.
func Defaults() map[string]any {
	return map[string]any{
		"listen":               ":7443",
		"behind-proxy":         false,
		"data-dir":             ".",
		"admin-socket":         "",
		"tls.cert":             "",
		"tls.key":              "",
		"handshake-timeout":    10 * time.Second,
		"accept-timeout":       15 * time.Second,
		"ping-interval":        20 * time.Second,
		"max-streams-per-host": 64,
	}
}

// Validate reports the first setting the relay cannot run with.
func (c Config) Validate() error {
	if c.Listen == "" {
		return errors.New("listen must not be empty")
	}
	if (c.TLS.Cert == "") != (c.TLS.Key == "") {
		return errors.New("tls.cert and tls.key must be set together")
	}
	durations := []struct {
		name  string
		value time.Duration
	}{
		{"handshake-timeout", c.HandshakeTimeout},
		{"accept-timeout", c.AcceptTimeout},
		{"ping-interval", c.PingInterval},
	}
	for _, d := range durations {
		if d.value <= 0 {
			return fmt.Errorf("%s must be positive", d.name)
		}
	}
	if c.MaxStreamsPerHost < 1 {
		return errors.New("max-streams-per-host must be at least 1")
	}
	return nil
}

// RegistryPath is where enrolled hosts and their grants are stored.
func (c Config) RegistryPath() string {
	return filepath.Join(c.DataDir, "registry.json")
}

// SocketPath is where the admin API listens.
func (c Config) SocketPath() string {
	if c.AdminSocket != "" {
		return c.AdminSocket
	}
	return filepath.Join(c.DataDir, "admin.sock")
}
