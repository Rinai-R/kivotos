import type { PluginServerContext } from "@kivotos/plugin/server";
import { runAcpProvider } from "@kivotos/plugin/server/acp";
import { vendorEditTransformer } from "./server/vendor-edit.js";

export default function contribute(server: PluginServerContext) {
  server.registerProvider(
    runAcpProvider({
      id: "example-acp",
      label: "Example ACP",
      description: "An ACP command adapted to Kivotos's provider boundary",
      icon: "icon.svg",
      command: ["example-acp", "--stdio"],
      transformers: [vendorEditTransformer],
    }),
  );
  return () => {};
}
