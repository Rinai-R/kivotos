import type { AgentSessionConfig, McpServerConfig } from "./agent-sdk-types.js";

const KIVOTOS_MCP_SERVER_NAME = "kivotos";
const KIVOTOS_MCP_PATHNAME = "/mcp/agents";

export function stripInternalKivotosMcpServer(config: AgentSessionConfig): AgentSessionConfig {
  const mcpServers = config.mcpServers;
  if (!mcpServers) {
    return config;
  }

  const kivotosServer = mcpServers[KIVOTOS_MCP_SERVER_NAME];
  if (!kivotosServer || !isInternalKivotosMcpServer(kivotosServer)) {
    return config;
  }

  const nextMcpServers = { ...mcpServers };
  delete nextMcpServers[KIVOTOS_MCP_SERVER_NAME];

  const next = { ...config };
  if (Object.keys(nextMcpServers).length > 0) {
    next.mcpServers = nextMcpServers;
  } else {
    delete next.mcpServers;
  }
  return next;
}

export function withRuntimeKivotosMcpServer(params: {
  config: AgentSessionConfig;
  agentId: string;
  mcpBaseUrl: string | null;
  /**
   * Capability token authenticating the injected connection to the daemon's
   * Agent MCP endpoint. The daemon password is gated off this route, so without
   * this header the agent's MCP requests are rejected when a password is set.
   */
  mcpAuthToken: string | null;
}): AgentSessionConfig {
  const storedConfig = stripInternalKivotosMcpServer(params.config);
  if (!params.mcpBaseUrl || storedConfig.mcpServers?.[KIVOTOS_MCP_SERVER_NAME]) {
    return storedConfig;
  }

  return {
    ...storedConfig,
    mcpServers: {
      [KIVOTOS_MCP_SERVER_NAME]: {
        type: "http",
        url: `${params.mcpBaseUrl}?callerAgentId=${params.agentId}`,
        ...(params.mcpAuthToken
          ? { headers: { Authorization: `Bearer ${params.mcpAuthToken}` } }
          : {}),
      },
      ...storedConfig.mcpServers,
    },
  };
}

function isInternalKivotosMcpServer(config: McpServerConfig): boolean {
  if (config.type !== "http" && config.type !== "sse") {
    return false;
  }

  try {
    return new URL(config.url).pathname === KIVOTOS_MCP_PATHNAME;
  } catch {
    return false;
  }
}
