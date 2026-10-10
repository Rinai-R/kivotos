package cmd

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"time"

	"github.com/spf13/cobra"
	"github.com/spf13/viper"

	"github.com/Rinai-R/kivotos/packages/relay/admin"
	"github.com/Rinai-R/kivotos/packages/relay/admission"
	"github.com/Rinai-R/kivotos/packages/relay/config"
	"github.com/Rinai-R/kivotos/packages/relay/registry"
	"github.com/Rinai-R/kivotos/packages/relay/tunnel"
)

func newServeCmd(v *viper.Viper) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "serve",
		Short: "Run the relay",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			cfg, err := loadConfig(v)
			if err != nil {
				return err
			}
			log, err := newLogger(cmd, v)
			if err != nil {
				return err
			}
			return serve(cmd.Context(), cfg, log)
		},
	}
	cmd.Flags().String("listen", ":7443", "HTTP address; devices and hosts open /v1/connect as a WebSocket")
	cmd.Flags().Bool("behind-proxy", false, "trust X-Forwarded-For from a reverse proxy that is the only way in")
	cmd.Flags().String("tls.cert", "", "relay certificate file (PEM)")
	cmd.Flags().String("tls.key", "", "relay private key file (PEM)")
	return cmd
}

// serve assembles the relay from its parts and runs it until ctx is done.
func serve(ctx context.Context, cfg config.Config, log *slog.Logger) error {
	reg, err := registry.Open(cfg.RegistryPath())
	if err != nil {
		return err
	}
	tickets := &admission.Tickets{}
	hub := tunnel.NewHub(reg, tickets, tunnel.Limits{
		AcceptTimeout:     cfg.AcceptTimeout,
		PingInterval:      cfg.PingInterval,
		MaxStreamsPerHost: cfg.MaxStreamsPerHost,
	}, log)
	connections := &tunnel.Server{
		Hub:         hub,
		Gate:        admission.NewGate(reg, tickets, cfg.HandshakeTimeout),
		Log:         log,
		BehindProxy: cfg.BehindProxy,
	}

	// ctx ending stops both servers, and so does either one failing.
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	mux := http.NewServeMux()
	mux.Handle("GET /v1/connect", connections)
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
	public := &http.Server{
		Handler: mux,
		// Connections live as long as ctx: canceling it ends every WebSocket.
		BaseContext:       func(net.Listener) context.Context { return ctx },
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       time.Minute,
		// No ReadTimeout or WriteTimeout: they would cut long-lived WebSockets.
	}
	operator := &http.Server{
		Handler:           admin.NewHandler(reg, hub),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       time.Minute,
	}

	publicLn, err := net.Listen("tcp", cfg.Listen)
	if err != nil {
		return err
	}
	defer publicLn.Close()
	operatorLn, err := admin.Listen(cfg.SocketPath())
	if err != nil {
		return fmt.Errorf("opening admin socket: %w", err)
	}
	defer operatorLn.Close()

	log.Info("relay listening", "addr", publicLn.Addr(), "tls", cfg.TLS.Cert != "", "admin", cfg.SocketPath())
	if cfg.TLS.Cert == "" && !cfg.BehindProxy {
		log.Warn("serving plain HTTP with no proxy in front: connection metadata and pairing codes are visible on the network")
	}

	failed := make(chan error, 2)
	go func() {
		if cfg.TLS.Cert != "" {
			failed <- public.ServeTLS(publicLn, cfg.TLS.Cert, cfg.TLS.Key)
			return
		}
		failed <- public.Serve(publicLn)
	}()
	go func() { failed <- operator.Serve(operatorLn) }()

	select {
	case err = <-failed:
	case <-ctx.Done():
	}
	cancel()
	shutdownCtx, done := context.WithTimeout(context.Background(), 5*time.Second)
	defer done()
	public.Shutdown(shutdownCtx)
	operator.Shutdown(shutdownCtx)
	hub.Close()
	connections.Wait()
	if errors.Is(err, http.ErrServerClosed) {
		err = nil
	}
	return err
}
