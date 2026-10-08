import { createKivotosClient, type KivotosClient } from "@kivotos/client";

export function createClient(url: string): KivotosClient {
  return createKivotosClient({
    url,
  });
}

export async function createOpenAndArchiveWorkspace(url: string, cwd: string): Promise<void> {
  const client = createClient(url);

  try {
    await client.connect();

    const created = await client.workspaces.create({
      source: { kind: "directory", path: cwd },
      title: "Fresh SDK workspace",
    });
    const opened = await client.workspaces.open(cwd);

    await opened.refresh();
    await created.archive();
  } finally {
    await client.close();
  }
}
