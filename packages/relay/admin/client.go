package admin

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"time"

	"github.com/Rinai-R/kivotos/packages/relay/wire"
)

// Client calls the admin API of the relay serving a socket.
type Client struct {
	http *http.Client
}

// NewClient returns a Client for the relay serving the admin socket at path.
func NewClient(path string) *Client {
	dialer := net.Dialer{Timeout: 5 * time.Second}
	return &Client{http: &http.Client{
		Timeout: 30 * time.Second,
		Transport: &http.Transport{
			DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
				return dialer.DialContext(ctx, "unix", path)
			},
		},
	}}
}

// Hosts lists the enrolled hosts and their live state.
func (c *Client) Hosts(ctx context.Context) ([]Host, error) {
	var hosts []Host
	err := c.do(ctx, http.MethodGet, "/hosts", nil, &hosts)
	return hosts, err
}

// AddHost enrolls a host.
func (c *Client) AddHost(ctx context.Context, key wire.Key, name string) error {
	return c.do(ctx, http.MethodPost, "/hosts", addHostRequest{Key: string(key), Name: name}, nil)
}

// RemoveHost drops a host, its grants, and its live connections.
func (c *Client) RemoveHost(ctx context.Context, key wire.Key) error {
	return c.do(ctx, http.MethodDelete, "/hosts/"+url.PathEscape(string(key)), nil, nil)
}

// RevokeDevice stops a device from reaching a host and ends its streams.
func (c *Client) RevokeDevice(ctx context.Context, host, device wire.Key) error {
	path := "/hosts/" + url.PathEscape(string(host)) + "/devices/" + url.PathEscape(string(device))
	return c.do(ctx, http.MethodDelete, path, nil, nil)
}

func (c *Client) do(ctx context.Context, method, path string, in, out any) error {
	var body io.Reader
	if in != nil {
		data, err := json.Marshal(in)
		if err != nil {
			return err
		}
		body = bytes.NewReader(data)
	}
	// The host is a placeholder: the transport always dials the socket.
	req, err := http.NewRequestWithContext(ctx, method, "http://relay"+path, body)
	if err != nil {
		return err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("reaching the relay (is it running?): %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		var failure errorResponse
		if json.NewDecoder(resp.Body).Decode(&failure) == nil && failure.Error != "" {
			return fmt.Errorf("relay: %s", failure.Error)
		}
		return fmt.Errorf("relay: %s", resp.Status)
	}
	if out == nil {
		return nil
	}
	return json.NewDecoder(resp.Body).Decode(out)
}
