import type { PluginServerContext } from "@kivotos/plugin/server";
import { createDirectExampleProvider } from "./server/provider";

export default function contribute(server: PluginServerContext) {
  server.registerProvider(createDirectExampleProvider());
  return () => {};
}
