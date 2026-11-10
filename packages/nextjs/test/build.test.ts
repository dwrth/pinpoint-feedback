import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dist = (file: string) => fileURLToPath(new URL(`../dist/${file}`, import.meta.url));
const built = existsSync(dist("index.js")) && existsSync(dist("server.js"));

describe.skipIf(!built)("built output", () => {
  it('marks only the client entry with "use client"', () => {
    expect(readFileSync(dist("index.js"), "utf8")).toMatch(/^["']use client["'];?/);
    expect(readFileSync(dist("server.js"), "utf8")).not.toMatch(/use client/);
  });

  it('keeps "server-only" as the first import of the server entry', () => {
    const server = readFileSync(dist("server.js"), "utf8");
    expect(server).toMatch(/^import\s+["']server-only["'];?/m);
    expect(server.indexOf("server-only")).toBeLessThan(server.indexOf("@pinpoint-feedback/server"));
  });

  it("does not bundle dependencies", () => {
    for (const file of ["index.js", "server.js"]) {
      const code = readFileSync(dist(file), "utf8");
      expect(code).not.toMatch(/@notionhq\/client/);
      expect(code.length).toBeLessThan(10_000);
    }
  });

  it("never re-exports with export * from the client boundary", () => {
    expect(readFileSync(dist("index.js"), "utf8")).not.toMatch(/export\s*\*/);
  });

  it("client entry does not reference server code", () => {
    const code = readFileSync(dist("index.js"), "utf8");
    expect(code).not.toMatch(/@pinpoint-feedback\/server|server-only/);
  });
});
