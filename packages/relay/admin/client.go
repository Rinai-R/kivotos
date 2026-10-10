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

// Networks lists the registered networks and their online computers.
func (c *Client) Networks(ctx context.Context) ([]Network, error) {
	var networks []Network
	err := c.do(ctx, http.MethodGet, "/networks", nil, &networks)
	return networks, err
}

// AddNetwork registers a network from the registration its creator was shown.
func (c *Client) AddNetwork(ctx context.Context, registration, name string) (Network, error) {
	var added Network
	err := c.do(ctx, http.MethodPost, "/networks", addRequest{Registration: registration, Name: name}, &added)
	return added, err
}

// RemoveNetwork unregisters a network and drops its live connections.
func (c *Client) RemoveNetwork(ctx context.Context, id wire.NetworkID) error {
	return c.do(ctx, http.MethodDelete, "/networks/"+url.PathEscape(string(id)), nil, nil)
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
