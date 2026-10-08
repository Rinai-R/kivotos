import { describe, expect, it } from "vitest";
import { availableStarterTriggerConnections } from "./starter-trigger.js";

describe("starter trigger connections", () => {
  it("returns only concrete connections that can back the generated trigger", () => {
    expect(
      availableStarterTriggerConnections(
        {
          github: [
            {
              slug: "github-getkivotos",
              accountLogin: "getkivotos",
              accountType: "Organization",
              repositories: ["getpaseo/paseo"],
            },
          ],
          slack: [{ slug: "kivotos", teamName: "Kivotos" }],
          discord: [{ slug: "kivotos-discord", guildName: "Kivotos Discord" }],
          daemons: [],
          linear: [],
        },
        "getpaseo/paseo",
      ),
    ).toEqual([
      {
        id: "github:getpaseo/paseo",
        label: "GitHub — getpaseo/paseo",
        provider: "github",
        filters: { connection: "github-getkivotos", repo: "getpaseo/paseo" },
      },
      {
        id: "slack:kivotos",
        label: "Slack — Kivotos",
        provider: "slack",
        filters: { connection: "kivotos" },
      },
      {
        id: "discord:kivotos-discord",
        label: "Discord — Kivotos Discord",
        provider: "discord",
        filters: { connection: "kivotos-discord" },
      },
    ]);
  });

  it("does not offer GitHub when the current repository is not connected", () => {
    expect(
      availableStarterTriggerConnections(
        {
          github: [
            {
              slug: "github-getkivotos",
              accountLogin: "getkivotos",
              accountType: "Organization",
              repositories: ["getkivotos/hub"],
            },
          ],
          slack: [],
          discord: [],
          daemons: [],
          linear: [],
        },
        "getpaseo/paseo",
      ),
    ).toEqual([]);
  });
});
