export const meta = {
  name: "kivotos-project-inspection",
  description: "Inspect Kivotos and explain what the project does",
  whenToUse: "Kivotos real-provider workflow detail QA",
  phases: [{ title: "Inspect", detail: "Read the product and architecture sources" }],
};

phase("Inspect");
let input = args;
if (typeof input === "string") input = JSON.parse(input);
const repoPath = input?.repoPath;
if (typeof repoPath !== "string" || repoPath.length === 0) {
  throw new Error("repoPath is required");
}
const report = await agent(
  `Inspect the Kivotos repository at ${JSON.stringify(repoPath)}.

Read README.md, docs/product.md, docs/architecture.md, and package.json. Do not edit anything. Return a concise plain-text report with exactly these headings:

What Kivotos is
Who it is for
How it works
Repository structure

Under each heading, give 1-3 concrete sentences grounded in those files. Mention the supported coding agents and the local-code/privacy model.`,
  {
    label: "project-inspector",
    phase: "Inspect",
  },
);

return { report };
