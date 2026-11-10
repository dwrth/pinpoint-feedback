#!/usr/bin/env node
// Usage: npm run version:bump -- <x.y.z | patch | minor | major>
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const PACKAGES = ["core", "server", "react", "nextjs", "pinpoint-feedback"];

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const manifests = PACKAGES.map((dir) => ({ path: `${root}packages/${dir}/package.json` }));
for (const m of manifests) m.json = readJson(m.path);

const current = manifests[0].json.version;
const mismatched = manifests.filter((m) => m.json.version !== current);
if (mismatched.length) {
  console.error(`Package versions differ: ${manifests.map((m) => `${m.json.name}@${m.json.version}`).join(", ")}`);
  process.exit(1);
}

function nextVersion(version, input) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`Unsupported current version "${version}"`);
  const [major, minor, patch] = match.slice(1).map(Number);
  if (input === "patch") return `${major}.${minor}.${patch + 1}`;
  if (input === "minor") return `${major}.${minor + 1}.0`;
  if (input === "major") return `${major + 1}.0.0`;
  if (/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(input ?? "")) return input;
  throw new Error(`Expected x.y.z, patch, minor or major; got "${input}"`);
}

const next = nextVersion(current, process.argv[2]);
const names = new Set(manifests.map((m) => m.json.name));

for (const m of manifests) {
  m.json.version = next;
  for (const field of ["dependencies", "peerDependencies", "devDependencies"]) {
    for (const dep of Object.keys(m.json[field] ?? {})) {
      if (names.has(dep)) m.json[field][dep] = next;
    }
  }
  writeFileSync(m.path, `${JSON.stringify(m.json, null, 2)}\n`);
}

const example = `${root}examples/nextjs-app/package.json`;
const exampleJson = readJson(example);
if (exampleJson.dependencies?.["pinpoint-feedback"]) {
  exampleJson.dependencies["pinpoint-feedback"] = next;
  writeFileSync(example, `${JSON.stringify(exampleJson, null, 2)}\n`);
}

execFileSync("npm", ["install", "--package-lock-only", "--ignore-scripts"], { cwd: root, stdio: "inherit" });
console.log(`\n${current} → ${next}\nNext: commit, push, then gh release create v${next}`);
