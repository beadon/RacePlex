/**
 * A hardcoded "/tracks.json" resolves outside the deployment on a GitHub Pages
 * project site (github.io/tracks.json, not github.io/RacePlex/tracks.json) — a
 * 404 that leaves the track list silently empty. assetUrl is what prevents that,
 * so it has to hold for both the root and a subpath.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { assetUrl } from "./basePath";

/** Vite replaces import.meta.env.BASE_URL at build; stub it to test both deploys. */
function withBase<T>(base: string, fn: () => T): T {
  vi.stubEnv("BASE_URL", base);
  try {
    return fn();
  } finally {
    vi.unstubAllEnvs();
  }
}

afterEach(() => vi.unstubAllEnvs());

describe("assetUrl", () => {
  it("is a no-op at the root, where most deploys live", () => {
    withBase("/", () => {
      expect(assetUrl("tracks.json")).toBe("/tracks.json");
      expect(assetUrl("samples/racebox-eskate-session.csv")).toBe("/samples/racebox-eskate-session.csv");
    });
  });

  it("prefixes the subpath on a GitHub Pages project site", () => {
    withBase("/RacePlex/", () => {
      expect(assetUrl("tracks.json")).toBe("/RacePlex/tracks.json");
      expect(assetUrl("drawings.json")).toBe("/RacePlex/drawings.json");
      expect(assetUrl("samples/vesc-tool-ride.csv")).toBe("/RacePlex/samples/vesc-tool-ride.csv");
    });
  });

  it("does not double the slash when a caller keeps the leading one", () => {
    // BASE_URL always ends in "/", so "/tracks.json" would give "//tracks.json"
    // — which resolves to the protocol-relative host //tracks.json. Not a typo
    // that fails loudly; a request to a different origin entirely.
    withBase("/RacePlex/", () => {
      expect(assetUrl("/tracks.json")).toBe("/RacePlex/tracks.json");
    });
    withBase("/", () => {
      expect(assetUrl("/tracks.json")).toBe("/tracks.json");
    });
  });

  it("keeps a query string intact — versionCheck busts the cache with one", () => {
    withBase("/RacePlex/", () => {
      expect(assetUrl("version.json?t=123")).toBe("/RacePlex/version.json?t=123");
    });
  });
});
