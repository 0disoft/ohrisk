import { describe, expect, test } from "bun:test";

import type { ArtifactFetcher } from "../src/evidence/artifact-response";
import {
  createCachingArtifactHostResolver,
  withRegistryAuthorization
} from "../src/evidence/artifact-transport";

describe("artifact transport", () => {
  test("coalesces normalized DNS lookups until the cache entry expires", async () => {
    let currentTime = 0;
    let resolutionCount = 0;
    const resolveArtifactHost = createCachingArtifactHostResolver(
      async (hostname) => {
        resolutionCount += 1;
        expect(hostname).toBe("registry.example.test");
        return [{ address: "93.184.216.34", family: 4 }];
      },
      () => currentTime
    );

    const [first, second] = await Promise.all([
      resolveArtifactHost("Registry.Example.Test."),
      resolveArtifactHost("registry.example.test")
    ]);

    expect(first).toEqual([{ address: "93.184.216.34", family: 4 }]);
    expect(second).toEqual(first);
    expect(resolutionCount).toBe(1);

    currentTime = 60_001;
    expect(await resolveArtifactHost("registry.example.test")).toEqual(first);
    expect(resolutionCount).toBe(2);
  });

  test("does not retain failed DNS resolutions", async () => {
    let resolutionCount = 0;
    let failResolution = true;
    const resolveArtifactHost = createCachingArtifactHostResolver(async () => {
      resolutionCount += 1;
      if (failResolution) {
        throw new Error("DNS unavailable");
      }
      return [{ address: "93.184.216.34", family: 4 }];
    });

    let firstFailure: unknown;
    try {
      await resolveArtifactHost("registry.example.test");
    } catch (cause) {
      firstFailure = cause;
    }

    expect(firstFailure).toBeInstanceOf(Error);
    if (!(firstFailure instanceof Error)) {
      throw new Error("Expected DNS resolution failure.");
    }
    expect(firstFailure.message).toBe("DNS unavailable");

    failResolution = false;
    expect(await resolveArtifactHost("registry.example.test")).toEqual([
      { address: "93.184.216.34", family: 4 }
    ]);
    expect(resolutionCount).toBe(2);
  });

  test("attaches registry authorization only to the exact HTTPS host", async () => {
    const requests: Array<{
      url: string;
      headers: Record<string, string> | undefined;
    }> = [];
    const fetchArtifact: ArtifactFetcher = async (url, options) => {
      requests.push({
        url,
        headers: options?.headers
      });
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        arrayBuffer: async () => new ArrayBuffer(0)
      };
    };
    const originalHeaders = { "x-request-id": "fixture" };
    const authorizedFetch = withRegistryAuthorization(
      fetchArtifact,
      new Map([["Registry.Example.Test.", "registry-token"]])
    );

    await authorizedFetch("https://registry.example.test/package", {
      headers: originalHeaders
    });
    await authorizedFetch("https://cdn.registry.example.test/package");
    await authorizedFetch("http://registry.example.test/package");

    expect(originalHeaders).toEqual({ "x-request-id": "fixture" });
    expect(requests).toEqual([
      {
        url: "https://registry.example.test/package",
        headers: {
          "x-request-id": "fixture",
          authorization: "Bearer registry-token"
        }
      },
      {
        url: "https://cdn.registry.example.test/package",
        headers: undefined
      },
      {
        url: "http://registry.example.test/package",
        headers: undefined
      }
    ]);
  });
});
