// Package cmd is the relay's command line: it parses flags and configuration
// and calls into the packages that do the work.
package cmd

import (
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/spf13/cobra"
	"github.com/spf13/viper"

	"github.com/Rinai-R/kivotos/packages/relay/config"
)

// version is set at build time with -ldflags "-X .../cmd.version=...".
var version = "dev"

// NewRootCmd builds the whole command tree with its own configuration state.
func NewRootCmd() *cobra.Command {
	v := viper.New()
	root := &cobra.Command{
		Use:           "kivotos-relay",
		Short:         "Relay that joins the members of a Kivotos network without seeing their traffic",
		Version:       version,
		SilenceUsage:  true,
		SilenceErrors: true,
		PersistentPreRunE: func(cmd *cobra.Command, _ []string) error {
			return initConfig(v, cmd)
		},
	}
	root.PersistentFlags().String("config", "", "config file (default ./kivotos-relay.yaml)")
	root.PersistentFlags().String("data-dir", ".", "directory for the registry and the admin socket")
	root.PersistentFlags().String("admin-socket", "", "admin socket path (default <data-dir>/admin.sock)")
	root.PersistentFlags().String("log-level", "info", "log level: debug, info, warn or error")

	root.AddCommand(newServeCmd(v), newNetworkCmd(v))
	return root
}

func initConfig(v *viper.Viper, cmd *cobra.Command) error {
	for key, value := range config.Defaults() {
		v.SetDefault(key, value)
	}
	if file, _ := cmd.Flags().GetString("config"); file != "" {
		v.SetConfigFile(file)
	} else {
		v.AddConfigPath(".")
		v.SetConfigName("kivotos-relay")
		v.SetConfigType("yaml")
	}
	v.SetEnvPrefix("KIVOTOS_RELAY")
	v.SetEnvKeyReplacer(strings.NewReplacer("-", "_", ".", "_"))
	v.AutomaticEnv()
	if err := v.ReadInConfig(); err != nil {
		var notFound viper.ConfigFileNotFoundError
		if !errors.As(err, &notFound) {
			return fmt.Errorf("reading config: %w", err)
		}
	}
	return v.BindPFlags(cmd.Flags())
}

func loadConfig(v *viper.Viper) (config.Config, error) {
	var cfg config.Config
	if err := v.Unmarshal(&cfg); err != nil {
		return cfg, fmt.Errorf("decoding config: %w", err)
	}
	return cfg, cfg.Validate()
}

func newLogger(cmd *cobra.Command, v *viper.Viper) (*slog.Logger, error) {
	var level slog.Level
	if err := level.UnmarshalText([]byte(v.GetString("log-level"))); err != nil {
		return nil, fmt.Errorf("log-level: %w", err)
	}
	return slog.New(slog.NewTextHandler(cmd.ErrOrStderr(), &slog.HandlerOptions{Level: level})), nil
}
