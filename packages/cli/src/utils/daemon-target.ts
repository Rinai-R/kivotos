import { resolveKivotosHome } from "@kivotos/server/daemon-control";

export type DaemonTarget = { kind: "instance"; home: string } | { kind: "endpoint"; host: string };

export function selectDaemonTarget(
  options: { home?: string; host?: string },
  env: NodeJS.ProcessEnv = process.env,
  localOnly = false,
): DaemonTarget {
  for (const key of ["home", "host"] as const) {
    if (options[key] !== undefined && !options[key]!.trim())
      throw { code: "TARGET_INVALID", message: `--${key} requires a non-empty value.` };
  }
  if (options.home !== undefined && options.host !== undefined)
    throw { code: "TARGET_AMBIGUOUS", message: "Choose either --home or --host, not both." };
  if (localOnly) {
    if (options.host !== undefined)
      throw {
        code: "LOCAL_OPERATION",
        message: "This is a local operation; use --home. --host is not supported.",
      };
    return {
      kind: "instance",
      home: resolveKivotosHome({ KIVOTOS_HOME: options.home ?? env.KIVOTOS_HOME }),
    };
  }
  if (options.home !== undefined)
    return { kind: "instance", home: resolveKivotosHome({ KIVOTOS_HOME: options.home }) };
  if (options.host !== undefined) return { kind: "endpoint", host: options.host };
  if (env.KIVOTOS_HOME && env.KIVOTOS_HOST)
    throw {
      code: "TARGET_AMBIGUOUS",
      message: "KIVOTOS_HOME and KIVOTOS_HOST are both set. Choose --home or --host explicitly.",
    };
  if (env.KIVOTOS_HOST) return { kind: "endpoint", host: env.KIVOTOS_HOST };
  return { kind: "instance", home: resolveKivotosHome({ KIVOTOS_HOME: env.KIVOTOS_HOME }) };
}

export function describeDaemonTarget(target: DaemonTarget): string {
  if (target.kind === "instance") return `home ${target.home}`;
  try {
    const url = new URL(target.host);
    if (url.password) url.password = "REDACTED";
    for (const key of url.searchParams.keys())
      if (/password|token|secret/i.test(key)) url.searchParams.set(key, "REDACTED");
    if (url.hash) url.hash = "REDACTED";
    return url.toString();
  } catch {
    return target.host.replace(/([?&](?:password|token|secret)=)[^&]*/gi, "$1REDACTED");
  }
}
