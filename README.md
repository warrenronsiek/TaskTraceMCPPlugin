# TaskTraceMCPPlugin

`TaskTraceMCPPlugin` is the standalone public packaging repo for connecting the local TaskTrace desktop app to MCP-capable clients.

Full documentation — resources, tools, installation, and configuration — is at **[tasktrace.com/docs](https://tasktrace.com/docs)**.

It currently includes packaging for:

- OpenClaw native plugins
- Claude Code local plugins
- Codex local plugins
- Cursor-compatible bundle metadata
- generic `.mcp.json` stdio server wiring

The server itself is still the TaskTrace desktop app. Every client path here launches:

```bash
/Applications/TaskTrace.app/Contents/MacOS/TaskTrace --mcp-stdio
```

## Repository layout

- `index.js`
  Native OpenClaw plugin runtime that proxies TaskTrace MCP resources into OpenClaw tools.

- `openclaw.plugin.json`
  Native OpenClaw manifest.

- `package.json`
  Package metadata for local install, `npm pack`, and publication.

- `.claude-plugin/plugin.json`
  Claude Code plugin manifest with inline `mcpServers` config.

- `.cursor-plugin/plugin.json`
  Cursor-compatible plugin marker.

- `.codex-plugin/plugin.json`
  Codex plugin manifest that registers TaskTrace as an MCP server.

- `.codex-plugin/marketplace.json`
  Reference marketplace entry for a home-local Codex install.

- `.mcp.json`
  Reusable MCP server config in standard `mcpServers` format, including the Codex plugin install.

- `scripts/set-version.mjs`
  Semver-backed helper that validates a version and syncs it across package metadata and manifests.

## Docs reviewed

- OpenClaw bundle docs: https://docs.openclaw.ai/plugins/bundles
- OpenClaw native plugin docs: https://docs.openclaw.ai/plugins/building-plugins
- OpenClaw plugin manifest reference: https://docs.openclaw.ai/plugins/manifest
- OpenClaw plugin CLI docs: https://docs.openclaw.ai/cli/plugins
- Claude MCP docs: https://code.claude.com/docs/en/mcp
- Claude plugin docs: https://code.claude.com/docs/en/plugins
- MCP lifecycle spec: https://modelcontextprotocol.io/specification/2024-11-05/basic/lifecycle
- TaskTrace MCP server docs: https://tasktrace.com/docs

## Current packaging state

What was verified locally on March 22, 2026:

- `openclaw plugins install .` succeeded on `OpenClaw 2026.3.13`
- `openclaw plugins info tasktrace-mcp-plugin` showed the plugin loaded with `tasktrace_list_resources` and `tasktrace_read_resource`
- `npm pack` produced a working install artifact and `openclaw plugins install ./tasktrace-mcp-plugin-0.1.0.tgz` also succeeded
- `claude --plugin-dir . --version` accepted the local plugin layout

What still needs product-level QA on a normal TaskTrace machine:

- a full end-to-end OpenClaw resource read against a running MCP-enabled TaskTrace app
- a full end-to-end Claude plugin session using this standalone repo
- runtime validation on a machine where TaskTrace launches cleanly from `/Applications`

## Install and test

### OpenClaw

Install from ClawHub:

~~openclaw plugins install tasktrace-mcp-plugin~~
Clawhub isn't working - https://github.com/openclaw/clawhub/issues/1088

Or install directly from a local checkout of this repo:

```bash
git clone https://github.com/warrenronsiek/TaskTraceMCPPlugin.git
cd TaskTraceMCPPlugin
openclaw plugins install .
openclaw config set tools.profile '"full"' --strict-json
openclaw gateway restart
openclaw plugins inspect tasktrace-mcp-plugin
```

Optional OpenClaw config:

```json
{
  "plugins": {
    "entries": {
      "tasktrace-mcp-plugin": {
        "config": {
          "tasktracePath": "/Applications/TaskTrace.app",
          "startupTimeoutMs": 10000
        }
      }
    }
  }
}
```

### Claude Code

Install via the plugin marketplace (automatically registers the MCP server):

```text
/plugin marketplace add warrenronsiek/TaskTraceMCPPlugin
/plugin install tasktrace-mcp-plugin@tasktrace-mcp
```

Or register the MCP server directly:

```bash
claude mcp add --transport stdio --scope project tasktrace -- /Applications/TaskTrace.app/Contents/MacOS/TaskTrace --mcp-stdio
```

### Codex

Install the plugin locally on your machine:

```bash
npm run install:codex-local
```

That command is idempotent. Each run:

- refreshes the staged plugin source bundle under the local Codex marketplace root
- removes the old legacy `~/.codex/plugins/tasktrace-mcp-plugin` location used by earlier installer versions
- removes any cached installed copy for this plugin under `~/.codex/plugins/cache/...` so the next install uses the latest staged files
- creates or updates the local marketplace entry

The staged source bundle lives at:

```text
~/.agents/plugins/.codex/plugins/tasktrace-mcp-plugin
```

and creates or updates:

```text
~/.agents/plugins/marketplace.json
```

with a marketplace entry whose `source.path` is the documented marketplace-root-relative path:

```json
"./.codex/plugins/tasktrace-mcp-plugin"
```

After running the installer:

1. Restart Codex.
2. Confirm the plugin appears in the local marketplace.
3. Install `tasktrace-mcp-plugin` from that marketplace.

Codex then creates the actual installed copy under its plugin cache. If the plugin was previously installed, the installer will already have removed the stale cached copy so this install behaves like a clean reinstall. The staged source bundle includes `.codex-plugin/plugin.json`, `.mcp.json`, and the required `assets/` files, and registers the same local stdio server:

```bash
/Applications/TaskTrace.app/Contents/MacOS/TaskTrace --mcp-stdio
```

### Generic `.mcp.json`

Use the included `.mcp.json` as a starting point for clients that support project-scoped MCP server config files.

## Versioning

This repo includes `semver` and a version sync helper.

To set a new release version:

```bash
npm install
npm run set-version -- 0.1.1
```

That command validates the input as semver and syncs:

- `package.json`
- `.claude-plugin/plugin.json`
- `.cursor-plugin/plugin.json`
- `index.js` `PLUGIN_VERSION`

The same script also writes `.release-version.env` for CI with:

- `RELEASE_VERSION`
- `NPM_DIST_TAG`
- `PACKAGE_TARBALL`

## Deploying changes

1. Update `index.js`, `openclaw.plugin.json`, `.claude-plugin/plugin.json`, `.cursor-plugin/plugin.json`, `.codex-plugin/plugin.json`, `.codex-plugin/marketplace.json`, `.mcp.json`, and this README as needed.
2. Install dependencies:

```bash
npm install
```

3. If you are cutting a release, bump the version with semver validation:

```bash
npm run set-version -- 0.1.1
```

4. Build the release artifact:

```bash
npm pack
```

5. Smoke test the generated archive with OpenClaw:

```bash
openclaw plugins install .
openclaw gateway restart
openclaw plugins inspect tasktrace-mcp-plugin
```

6. Smoke test the Claude plugin layout locally:

```bash
claude --plugin-dir .
```
