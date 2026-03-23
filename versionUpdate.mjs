import { readFile, writeFile } from "node:fs/promises";
import semver from "semver";

const nextVersion = process.argv[2];

if (!semver.valid(nextVersion)) {
  console.error("Expected a valid semver version, for example 0.1.1");
  process.exit(1);
}

const updateJsonVersion = async (path) => {
  const parsed = JSON.parse(await readFile(path, "utf8"));
  parsed.version = nextVersion;
  await writeFile(path, `${JSON.stringify(parsed, null, 2)}\n`);
};

await updateJsonVersion(new URL("./package.json", import.meta.url));
await updateJsonVersion(new URL("./.claude-plugin/plugin.json", import.meta.url));
await updateJsonVersion(new URL("./.cursor-plugin/plugin.json", import.meta.url));

const indexUrl = new URL("./index.js", import.meta.url);
const indexSource = await readFile(indexUrl, "utf8");
const updatedIndexSource = indexSource.replace(
  /const PLUGIN_VERSION = "[^"]+";/,
  `const PLUGIN_VERSION = "${nextVersion}";`,
);

if (updatedIndexSource === indexSource) {
  console.error("Could not find PLUGIN_VERSION in index.js");
  process.exit(1);
}

await writeFile(indexUrl, updatedIndexSource);

const distTag = semver.prerelease(nextVersion)?.[0] ?? "latest";
const releaseMetadata = [
  `RELEASE_VERSION=${nextVersion}`,
  `NPM_DIST_TAG=${distTag}`,
  `PACKAGE_TARBALL=tasktrace-mcp-plugin-${nextVersion}.tgz`,
].join("\n") + "\n";

await writeFile(new URL("./.release-version.env", import.meta.url), releaseMetadata);

console.log(`Updated plugin version to ${nextVersion}`);
console.log(`NPM_DIST_TAG=${distTag}`);
