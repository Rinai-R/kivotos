// Install the lefthook git hooks, but only in a git checkout: an install from
// a copied tree or tarball has no .git, and that is not an error. A failure
// inside a checkout still fails the install.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

if (existsSync(".git")) {
  execFileSync("npx", ["--no-install", "lefthook", "install", "--force"], { stdio: "inherit" });
}
