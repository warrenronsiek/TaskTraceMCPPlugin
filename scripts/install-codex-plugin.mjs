import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const pluginName = "tasktrace-mcp-plugin";
const sourcePluginDir = repoRoot;
const targetPluginDir = path.join(os.homedir(), ".codex", "plugins", pluginName);
const targetMarketplacePath = path.join(
  os.homedir(),
  ".agents",
  "plugins",
  "marketplace.json",
);

async function copyIntoTarget(relativePath) {
  const src = path.join(sourcePluginDir, relativePath);
  const dest = path.join(targetPluginDir, relativePath);
  await fs.cp(src, dest, { recursive: true, force: true });
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function readJsonIfExists(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function buildMarketplaceEntry() {
  return {
    name: pluginName,
    source: {
      source: "local",
      path: targetPluginDir,
    },
    policy: {
      installation: "AVAILABLE",
      authentication: "ON_INSTALL",
    },
    category: "Productivity",
  };
}

async function installPluginBundle() {
  await ensureDir(targetPluginDir);
  await ensureDir(path.join(targetPluginDir, ".codex-plugin"));
  await fs.copyFile(
    path.join(sourcePluginDir, ".codex-plugin", "plugin.json"),
    path.join(targetPluginDir, ".codex-plugin", "plugin.json"),
  );
  await copyIntoTarget(".mcp.json");
  await copyIntoTarget("assets");
}

async function updateMarketplace() {
  await ensureDir(path.dirname(targetMarketplacePath));

  const marketplace =
    (await readJsonIfExists(targetMarketplacePath)) ?? {
      name: "local-plugins",
      interface: {
        displayName: "Local Plugins",
      },
      plugins: [],
    };

  if (!Array.isArray(marketplace.plugins)) {
    marketplace.plugins = [];
  }

  const entry = buildMarketplaceEntry();
  const existingIndex = marketplace.plugins.findIndex(
    (plugin) => plugin?.name === pluginName,
  );

  if (existingIndex >= 0) {
    marketplace.plugins[existingIndex] = entry;
  } else {
    marketplace.plugins.push(entry);
  }

  await fs.writeFile(
    targetMarketplacePath,
    `${JSON.stringify(marketplace, null, 2)}\n`,
    "utf8",
  );
}

async function main() {
  await installPluginBundle();
  await updateMarketplace();

  console.log(`Installed Codex plugin to ${targetPluginDir}`);
  console.log(`Updated marketplace entry at ${targetMarketplacePath}`);
}

await main();
