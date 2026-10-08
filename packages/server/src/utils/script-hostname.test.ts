import { describe, expect, it } from "vitest";
import {
  buildPublicScriptHostname,
  buildPublicScriptProxyUrl,
  buildScriptHostname,
} from "./script-hostname.js";

describe("buildScriptHostname", () => {
  it("builds default branch hostnames with script and project labels", () => {
    expect(
      buildScriptHostname({
        projectSlug: "kivotos",
        branchName: null,
        scriptName: "web",
      }),
    ).toBe("web--kivotos.localhost");
  });

  it("omits the branch label for main and master", () => {
    expect(
      buildScriptHostname({
        projectSlug: "kivotos",
        branchName: "main",
        scriptName: "web",
      }),
    ).toBe("web--kivotos.localhost");
    expect(
      buildScriptHostname({
        projectSlug: "kivotos",
        branchName: "master",
        scriptName: "web",
      }),
    ).toBe("web--kivotos.localhost");
  });

  it("builds non-default branch hostnames with script, branch, and project labels", () => {
    expect(
      buildScriptHostname({
        projectSlug: "kivotos",
        branchName: "feature-auth",
        scriptName: "web",
      }),
    ).toBe("web--feature-auth--kivotos.localhost");
  });

  it("slugifies script, default branch project, and non-default branch labels", () => {
    expect(
      buildScriptHostname({
        projectSlug: "Kivotos App",
        branchName: "Feature/Auth Flow",
        scriptName: "Web/API @ Dev",
      }),
    ).toBe("web-api-dev--feature-auth-flow--kivotos-app.localhost");
  });

  it("accepts already slugified labels because slugify is idempotent", () => {
    expect(
      buildScriptHostname({
        projectSlug: "kivotos-app",
        branchName: "feature-auth-flow",
        scriptName: "web-api-dev",
      }),
    ).toBe("web-api-dev--feature-auth-flow--kivotos-app.localhost");
  });

  it("uses untitled as the hostname-label fallback when labels collapse to empty", () => {
    expect(
      buildScriptHostname({
        projectSlug: "日本語",
        branchName: "***",
        scriptName: "---",
      }),
    ).toBe("untitled--untitled--untitled.localhost");
  });
});

describe("buildPublicScriptHostname", () => {
  it("uses one combined service label under the configured public base host", () => {
    expect(
      buildPublicScriptHostname({
        publicBaseUrl: "https://services.example.com",
        projectSlug: "kivotos",
        branchName: "feature-auth",
        scriptName: "web",
      }),
    ).toBe("web--feature-auth--kivotos.services.example.com");
  });

  it("omits default branch names from the public service label", () => {
    expect(
      buildPublicScriptHostname({
        publicBaseUrl: "https://services.example.com",
        projectSlug: "kivotos",
        branchName: "main",
        scriptName: "web",
      }),
    ).toBe("web--kivotos.services.example.com");
  });

  it("caps the public service label to the DNS label length limit", () => {
    const hostname = buildPublicScriptHostname({
      publicBaseUrl: "https://services.example.com",
      projectSlug: "project-".repeat(10),
      branchName: "branch-".repeat(10),
      scriptName: "script-".repeat(10),
    });
    const [serviceLabel] = hostname.split(".");

    expect(serviceLabel.length).toBeLessThanOrEqual(63);
    expect(serviceLabel).toMatch(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/);
    expect(hostname).toBe(`${serviceLabel}.services.example.com`);
  });
});

describe("buildPublicScriptProxyUrl", () => {
  it("preserves the configured public base protocol and port", () => {
    expect(
      buildPublicScriptProxyUrl({
        publicBaseUrl: "https://services.example.com:8443/base-is-ignored",
        projectSlug: "kivotos",
        branchName: "feature-auth",
        scriptName: "web",
      }),
    ).toBe("https://web--feature-auth--kivotos.services.example.com:8443");
  });
});
