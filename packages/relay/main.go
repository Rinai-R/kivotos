// Command kivotos-relay joins Kivotos devices to hosts over the public
// internet. It forwards end-to-end encrypted streams and cannot read them.
package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/Rinai-R/kivotos/packages/relay/cmd"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := cmd.NewRootCmd().ExecuteContext(ctx); err != nil {
		fmt.Fprintln(os.Stderr, "kivotos-relay:", err)
		os.Exit(1)
	}
}
