import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(await readFile(new URL("./package.json", import.meta.url), "utf8"));
const mcpConfig = JSON.parse(await readFile(new URL("./.mcp.json", import.meta.url), "utf8"));
const codexPlugin = JSON.parse(await readFile(new URL("./.codex-plugin/plugin.json", import.meta.url), "utf8"));
const claudePlugin = JSON.parse(await readFile(new URL("./.claude-plugin/plugin.json", import.meta.url), "utf8"));

test("package is bundle-only for OpenClaw", () => {
  assert.equal("openclaw" in packageJson, false);
  assert.equal(packageJson.files.includes("openclaw.plugin.json"), false);
  assert.equal(packageJson.files.includes("index.js"), false);
});

test("shared mcp config points at the canonical TaskTrace stdio command", () => {
  assert.deepEqual(mcpConfig, {
    mcpServers: {
      tasktrace: {
        command: "/Applications/TaskTrace.app/Contents/MacOS/TaskTrace",
        args: ["--mcp-stdio"],
      },
    },
  });
});

test("bundle manifests keep the TaskTrace MCP wiring", () => {
  assert.equal(codexPlugin.mcpServers, "./.mcp.json");
  assert.deepEqual(claudePlugin.mcpServers, {
    tasktrace: {
      command: "/Applications/TaskTrace.app/Contents/MacOS/TaskTrace",
      args: ["--mcp-stdio"],
    },
  });
});
