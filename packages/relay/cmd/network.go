package cmd

import (
	"fmt"
	"text/tabwriter"

	"github.com/spf13/cobra"
	"github.com/spf13/viper"

	"github.com/Rinai-R/kivotos/packages/relay/admin"
	"github.com/Rinai-R/kivotos/packages/relay/wire"
)

// newNetworkCmd groups the commands that manage networks on a running relay.
func newNetworkCmd(v *viper.Viper) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "network",
		Short: "Register, list and remove networks on the running relay",
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
		Use:   "add <registration>",
		Short: "Let a network use this relay, from the registration Kivotos shows its creator",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			c, err := client()
			if err != nil {
				return err
			}
			name, _ := cmd.Flags().GetString("name")
			added, err := c.AddNetwork(cmd.Context(), args[0], name)
			if err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "registered network %s\n", added.ID)
			return nil
		},
	}
	add.Flags().StringP("name", "n", "", "a name for people, shown in listings")

	list := &cobra.Command{
		Use:   "list",
		Short: "Show registered networks and their computers that are online",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			c, err := client()
			if err != nil {
				return err
			}
			networks, err := c.Networks(cmd.Context())
			if err != nil {
				return err
			}
			w := tabwriter.NewWriter(cmd.OutOrStdout(), 0, 4, 2, ' ', 0)
			fmt.Fprintln(w, "NETWORK\tNAME\tONLINE\tSTREAMS")
			for _, n := range networks {
				fmt.Fprintf(w, "%s\t%s\t%d\t\n", n.ID, n.Name, len(n.Nodes))
				for _, node := range n.Nodes {
					fmt.Fprintf(w, "  node %s\t%s\t\t%d\n", node.ID, node.Name, node.Streams)
				}
			}
			return w.Flush()
		},
	}

	remove := &cobra.Command{
		Use:   "remove <network-id>",
		Short: "Stop a network from using this relay and drop its connections",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			c, err := client()
			if err != nil {
				return err
			}
			if err := c.RemoveNetwork(cmd.Context(), wire.NetworkID(args[0])); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "removed network %s\n", args[0])
			return nil
		},
	}

	cmd.AddCommand(add, list, remove)
	return cmd
}
