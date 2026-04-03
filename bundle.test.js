import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(await readFile(new URL("./package.json", import.meta.url), "utf8"));
const mcpConfig = JSON.parse(await readFile(new URL("./.mcp.json", import.meta.url), "utf8"));
const codexPlugin = JSON.parse(await readFile(new URL("./.codex-plugin/plugin.json", import.meta.url), "utf8"));
const claudePlugin = JSON.parse(await readFile(new URL("./.claude-plugin/plugin.json", import.meta.url), "utf8"));
const openclawPlugin = JSON.parse(await readFile(new URL("./openclaw.plugin.json", import.meta.url), "utf8"));

test("package exposes the OpenClaw runtime bridge alongside the shared MCP bundle metadata", () => {
  assert.deepEqual(packageJson.openclaw, {
    extensions: ["./index.js"],
    channel: {
      id: "tasktrace",
      label: "TaskTrace",
      blurb: "Local Unix-socket bridge to a running TaskTrace app.",
    },
  });
  assert.equal(packageJson.files.includes("openclaw.plugin.json"), true);
  assert.equal(packageJson.files.includes("index.js"), true);
  assert.equal(packageJson.files.includes("src"), true);
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

test("native OpenClaw manifest keeps the official plugin identity and channel registration", () => {
  assert.equal(openclawPlugin.id, "tasktrace-mcp");
  assert.equal(openclawPlugin.name, "TaskTrace MCP");
  assert.deepEqual(openclawPlugin.channels, ["tasktrace"]);
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
