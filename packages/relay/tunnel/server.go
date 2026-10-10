package tunnel

import (
	"bufio"
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"

	"github.com/Rinai-R/kivotos/packages/relay/wire"
)

// keepaliveInterval is how often the relay pings an open WebSocket, so
// proxies in between do not drop a stream that is merely quiet.
const keepaliveInterval = 30 * time.Second

// Admitter authenticates a new connection. *admission.Gate implements it.
type Admitter interface {
	Admit(conn net.Conn, r *bufio.Reader, remote string) (wire.Hello, error)
}

// Server is the relay's WebSocket endpoint: it upgrades a request, admits
// the connection, and hands it to the Hub. Serve it with an http.Server whose
// BaseContext ends when the relay stops.
type Server struct {
	Hub  *Hub
	Gate Admitter
	Log  *slog.Logger
	// BehindProxy takes the peer's address from the last X-Forwarded-For
	// entry. Set it only when a reverse proxy you run is the sole way in.
	BehindProxy bool

	wg sync.WaitGroup
}

// ServeHTTP runs one connection until it ends.
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.wg.Add(1)
	defer s.wg.Done()
	// Accept refuses a browser page on another origin; devices and hosts send no Origin.
	ws, err := websocket.Accept(w, r, nil)
	if err != nil {
		s.Log.Debug("upgrade refused", "remote", r.RemoteAddr, "err", err)
		return
	}
	defer ws.CloseNow()
	ctx := r.Context()
	conn := &wsConn{Conn: websocket.NetConn(ctx, ws, websocket.MessageBinary), ws: ws}
	go keepalive(ctx, ws)
	s.handle(ctx, conn, s.remote(r))
}

// wsConn is a WebSocket as a net.Conn whose Close never blocks. The hub
// closes connections while holding its locks, and a WebSocket close waits
// for the peer to acknowledge.
type wsConn struct {
	net.Conn
	ws   *websocket.Conn
	once sync.Once
}

// Close starts the closing handshake and returns. Reads and writes fail from
// then on; the socket is released when the peer answers or after the
// library's handshake timeout.
func (c *wsConn) Close() error {
	c.once.Do(func() { go c.ws.Close(websocket.StatusNormalClosure, "") })
	return nil
}

// Wait returns when every connection has ended. Call it after stopping the
// http.Server and closing the Hub.
func (s *Server) Wait() { s.wg.Wait() }

func (s *Server) remote(r *http.Request) string {
	if s.BehindProxy {
		forwarded := r.Header.Values("X-Forwarded-For")
		if len(forwarded) > 0 {
			hops := strings.Split(forwarded[len(forwarded)-1], ",")
			return strings.TrimSpace(hops[len(hops)-1])
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// keepalive pings until the connection or ctx ends. A peer that does not
// answer within one interval is gone, and its connection is dropped.
func keepalive(ctx context.Context, ws *websocket.Conn) {
	t := time.NewTicker(keepaliveInterval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			pingCtx, cancel := context.WithTimeout(ctx, keepaliveInterval)
			err := ws.Ping(pingCtx)
			cancel()
			if err != nil {
				ws.CloseNow()
				return
			}
		}
	}
}

func (s *Server) handle(ctx context.Context, conn net.Conn, remote string) {
	defer conn.Close()
	r := wire.NewReader(conn)
	hello, err := s.Gate.Admit(conn, r, remote)
	if err != nil {
		s.Log.Debug("connection refused", "remote", remote, "err", err)
		return
	}
	p := peer{conn: conn, r: r}
	switch hello.Role {
	case wire.RoleNode:
		err = s.Hub.serveNode(ctx, p, hello)
	case wire.RoleAccept:
		err = s.Hub.accept(p, hello.Network, hello.Node, hello.Conn)
	case wire.RoleDial:
		err = s.Hub.connect(ctx, p, hello.Network, hello.Target, hello.Node)
	case wire.RolePeers:
		err = s.Hub.peers(p, hello.Network)
	}
	var refused refusal
	if errors.As(err, &refused) {
		conn.SetWriteDeadline(time.Now().Add(writeTimeout))
		wire.WriteJSON(conn, wire.Reply{Error: string(refused)}) // best effort
		s.Log.Debug("request refused", "role", hello.Role, "node", hello.Node, "code", string(refused))
	}
}
