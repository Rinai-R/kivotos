import path from "node:path";

import { resolveKivotosHome } from "../../../kivotos-home.js";

const OPENCODE_HOME_DIRNAME = "opencode-home";

export function resolveOpenCodeHomeDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveKivotosHome(env), OPENCODE_HOME_DIRNAME);
}
