import { QueryClientProvider } from "@tanstack/react-query";
import { KivotosApiProvider, PluginRpcProvider } from "@kivotos/plugin/client/host";
import React, { type ReactNode } from "react";
import type { InstalledPlugin } from "./types";

/** Every plugin surface renders under its installation: one query cache, one Kivotos client, RPCs. */
export function PluginInstallationProvider({
  plugin,
  children,
}: {
  plugin: InstalledPlugin;
  children: ReactNode;
}) {
  return (
    <QueryClientProvider client={plugin.queryClient}>
      <KivotosApiProvider kivotos={plugin.kivotos}>
        <PluginRpcProvider invoke={plugin.invoke}>{children}</PluginRpcProvider>
      </KivotosApiProvider>
    </QueryClientProvider>
  );
}
