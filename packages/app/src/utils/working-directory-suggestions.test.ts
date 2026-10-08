import { describe, expect, it } from "vitest";
import { buildWorkingDirectorySuggestions } from "./working-directory-suggestions";

describe("buildWorkingDirectorySuggestions", () => {
  it("returns de-duplicated recommendations when query is empty", () => {
    const results = buildWorkingDirectorySuggestions({
      recommendedPaths: ["/Users/me/projects/kivotos", "/Users/me/projects/kivotos"],
      serverPaths: ["/Users/me/projects/playground"],
      query: "",
    });

    expect(results).toEqual(["/Users/me/projects/kivotos"]);
  });

  it("keeps fuzzy recommendation matches before de-duplicated daemon suggestions", () => {
    const results = buildWorkingDirectorySuggestions({
      recommendedPaths: ["/Users/me/projects/kivotos-desktop", "/Users/me/documents"],
      serverPaths: ["/Users/me/projects/kivotos-plan", "/Users/me/projects/kivotos-desktop"],
      query: "pso",
    });

    expect(results).toEqual(["/Users/me/projects/kivotos-desktop", "/Users/me/projects/kivotos-plan"]);
  });

  it("does not reinterpret daemon-ranked suggestions", () => {
    const results = buildWorkingDirectorySuggestions({
      recommendedPaths: [],
      serverPaths: ["/Users/me/projects/kivotos-desktop"],
      query: "a-query-ranked-by-the-daemon",
    });

    expect(results).toEqual(["/Users/me/projects/kivotos-desktop"]);
  });

  it("matches recommended paths using the complete path text", () => {
    const results = buildWorkingDirectorySuggestions({
      recommendedPaths: [
        "/Users/me/archive/projects/kivotos-desktop",
        "/Users/me/projects/kivotos-desktop",
      ],
      serverPaths: [],
      query: "projects/pso",
    });

    expect(results).toEqual([
      "/Users/me/archive/projects/kivotos-desktop",
      "/Users/me/projects/kivotos-desktop",
    ]);
  });

  it("fuzzy-matches recommended paths using their full path", () => {
    const results = buildWorkingDirectorySuggestions({
      recommendedPaths: ["/Users/me/projects/blankpage/editor"],
      serverPaths: [],
      query: "blank page editor",
    });

    expect(results).toEqual(["/Users/me/projects/blankpage/editor"]);
  });

  it("treats '~' as an active query and includes daemon suggestions", () => {
    const results = buildWorkingDirectorySuggestions({
      recommendedPaths: ["/Users/me/projects/kivotos"],
      serverPaths: ["/Users/me/documents", "/Users/me/projects"],
      query: "~",
    });

    expect(results).toEqual([
      "/Users/me/projects/kivotos",
      "/Users/me/documents",
      "/Users/me/projects",
    ]);
  });
});
