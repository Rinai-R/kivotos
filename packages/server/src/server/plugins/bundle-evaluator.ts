import { createRequire } from "node:module";
import * as pluginSharedRuntime from "@kivotos/plugin";
import * as pluginProviderRuntime from "@kivotos/plugin/server/provider";
import * as pluginAcpRuntime from "@kivotos/plugin/server/acp";
import * as pluginUsageRuntime from "@kivotos/plugin/server/usage";
import * as pluginServerRuntime from "@kivotos/plugin/server";
import type { PluginServerContribution } from "@kivotos/plugin/server";
import * as zod from "zod";
import { isPluginClientOnlySdkSpecifier } from "./plugin-sdk-specifiers.js";

const nodeRequire = createRequire(import.meta.url);

function runtimeRequire(name: string): unknown {
  if (isPluginClientOnlySdkSpecifier(name)) {
    throw new Error(`${name} is available only in plugin client code`);
  }
  if (name === "@kivotos/plugin") return pluginSharedRuntime;
  if (name === "@kivotos/plugin/server") return pluginServerRuntime;
  if (name === "@kivotos/plugin/server/provider") return pluginProviderRuntime;
  if (name === "@kivotos/plugin/server/acp") return pluginAcpRuntime;
  if (name === "@kivotos/plugin/server/usage") return pluginUsageRuntime;
  if (name === "zod") return zod;
  if (name === "@kivotos/plugin/client/host")
    throw new Error(`${name} is private to the app host`);
  return nodeRequire(name);
}

export function evaluateBundle(bundle: string): PluginServerContribution {
  const evaluate: (source: string) => unknown = globalThis.eval;
  const factory = evaluate(bundle);
  if (typeof factory !== "function") throw new Error("Plugin server bundle is not executable");
  const exports = factory(runtimeRequire);
  const setup =
    exports !== null && typeof exports === "object" ? Reflect.get(exports, "default") : undefined;
  if (typeof setup !== "function") {
    throw new Error("Plugin server bundle must default export a function");
  }
  return setup as PluginServerContribution;
}
