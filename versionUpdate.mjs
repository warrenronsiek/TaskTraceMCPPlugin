import { writeFile } from "node:fs/promises";
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
await updateJsonVersion(new URL("./.codex-plugin/plugin.json", import.meta.url));
await updateJsonVersion(new URL("./.cursor-plugin/plugin.json", import.meta.url));

const distTag = semver.prerelease(nextVersion)?.[0] ?? "latest";
const releaseMetadata = [
  `RELEASE_VERSION=${nextVersion}`,
  `NPM_DIST_TAG=${distTag}`,
  `PACKAGE_TARBALL=tasktrace-mcp-plugin-${nextVersion}.tgz`,
].join("\n") + "\n";

await writeFile(new URL("./.release-version.env", import.meta.url), releaseMetadata);

console.log(`Updated plugin version to ${nextVersion}`);
console.log(`NPM_DIST_TAG=${distTag}`);
