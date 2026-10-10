package cmd

import (
	"fmt"
	"text/tabwriter"

	"github.com/spf13/cobra"
	"github.com/spf13/viper"

	"github.com/Rinai-R/kivotos/packages/relay/admin"
	"github.com/Rinai-R/kivotos/packages/relay/wire"
)

// newHostCmd groups the commands that manage hosts on a running relay.
func newHostCmd(v *viper.Viper) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "host",
		Short: "Enroll, list and remove hosts on the running relay",
	}
	// The admin socket follows the same settings the relay was started with.
	client := func() (*admin.Client, error) {
		cfg, err := loadConfig(v)
		if err != nil {
			return nil, err
		}
		return admin.NewClient(cfg.SocketPath()), nil
	}

	add := &cobra.Command{
		Use:   "add <host-key>",
		Short: "Enroll a computer, by the key its Kivotos plugin shows",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			key, err := wire.ParseKey(args[0])
			if err != nil {
				return fmt.Errorf("host key: %w", err)
			}
			c, err := client()
			if err != nil {
				return err
			}
			name, _ := cmd.Flags().GetString("name")
			if err := c.AddHost(cmd.Context(), key, name); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "enrolled %s\n", key)
			return nil
		},
	}
	add.Flags().StringP("name", "n", "", "a name for people, shown in listings")

	list := &cobra.Command{
		Use:   "list",
		Short: "Show enrolled hosts, whether they are online, and their devices",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			c, err := client()
			if err != nil {
				return err
			}
			hosts, err := c.Hosts(cmd.Context())
			if err != nil {
				return err
			}
			w := tabwriter.NewWriter(cmd.OutOrStdout(), 0, 4, 2, ' ', 0)
			fmt.Fprintln(w, "HOST\tNAME\tSTATE\tSTREAMS\tDEVICES")
			for _, h := range hosts {
				state := "offline"
				if h.Online {
					state = "online"
				}
				fmt.Fprintf(w, "%s\t%s\t%s\t%d\t%d\n", h.Key, h.Name, state, h.Streams, len(h.Devices))
				for _, d := range h.Devices {
					fmt.Fprintf(w, "  device %s\t%s\t\t\t\n", d.Key, d.Name)
				}
			}
			return w.Flush()
		},
	}

	remove := &cobra.Command{
		Use:   "remove <host-key>",
		Short: "Remove a computer, its devices, and its live connections",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			c, err := client()
			if err != nil {
				return err
			}
			if err := c.RemoveHost(cmd.Context(), wire.Key(args[0])); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "removed %s\n", args[0])
			return nil
		},
	}

	revoke := &cobra.Command{
		Use:   "revoke <host-key> <device-key>",
		Short: "Stop a device from reaching a computer and end its streams",
		Args:  cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			c, err := client()
			if err != nil {
				return err
			}
			if err := c.RevokeDevice(cmd.Context(), wire.Key(args[0]), wire.Key(args[1])); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "revoked %s\n", args[1])
			return nil
		},
	}

	cmd.AddCommand(add, list, remove, revoke)
	return cmd
}
