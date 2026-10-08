import { describe, expect, it } from "vitest";

import { getKivotosToolLeafName, isKivotosToolName } from "@kivotos/protocol/tool-name-normalization";

describe("isKivotosToolName", () => {
  it("detects Claude Code format", () => {
    expect(isKivotosToolName("mcp__kivotos__create_agent")).toBe(true);
    expect(isKivotosToolName("mcp__kivotos__list_agents")).toBe(true);
  });

  it("detects kivotos_voice variant", () => {
    expect(isKivotosToolName("mcp__kivotos_voice__create_agent")).toBe(true);
    expect(isKivotosToolName("kivotos_voice.create_agent")).toBe(true);
  });

  it("excludes speak tools", () => {
    expect(isKivotosToolName("mcp__kivotos_voice__speak")).toBe(false);
    expect(isKivotosToolName("mcp__kivotos__speak")).toBe(false);
    expect(isKivotosToolName("kivotos.speak")).toBe(false);
  });

  it("detects Codex dot format", () => {
    expect(isKivotosToolName("kivotos.create_agent")).toBe(true);
  });

  it("rejects non-kivotos tools", () => {
    expect(isKivotosToolName("Bash")).toBe(false);
    expect(isKivotosToolName("Read")).toBe(false);
    expect(isKivotosToolName("mcp__other_server__some_tool")).toBe(false);
  });
});

describe("getKivotosToolLeafName", () => {
  it("extracts leaf from Claude Code format", () => {
    expect(getKivotosToolLeafName("mcp__kivotos__create_agent")).toBe("create_agent");
  });

  it("extracts leaf from Codex format", () => {
    expect(getKivotosToolLeafName("kivotos.create_agent")).toBe("create_agent");
    expect(getKivotosToolLeafName("kivotos.list_agents")).toBe("list_agents");
  });

  it("returns null for non-kivotos tools", () => {
    expect(getKivotosToolLeafName("Bash")).toBeNull();
  });
});
