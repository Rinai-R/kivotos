import type { PluginClientContext } from "@kivotos/plugin/client";
import { issueAttachments } from "./shared/issues";

export default function contribute(client: PluginClientContext) {
  client.addAttachmentSource(issueAttachments);
  return () => {};
}
