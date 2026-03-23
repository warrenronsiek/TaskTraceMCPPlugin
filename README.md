# TaskTraceMCPPlugin

`TaskTraceMCPPlugin` is the standalone public packaging repo for connecting the local TaskTrace desktop app to MCP-capable clients.

Full documentation — resources, tools, installation, and configuration — is at **[tasktrace.com/docs](https://tasktrace.com/docs)**.

It currently includes packaging for:

- OpenClaw native plugins
- Claude Code local plugins
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

- `.mcp.json`
  Reusable project-scope MCP config in standard `mcpServers` format.

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

```bash
openclaw plugins install tasktrace-mcp-plugin
openclaw plugins info tasktrace-mcp-plugin
```

Or install directly from the GitHub repo (tracks latest commit, no version pinning):

```bash
openclaw plugins install tasktrace-mcp-plugin --marketplace warrenronsiek/TaskTraceMCPPlugin
```

Optional OpenClaw config:

```json
{
  "tools": {
    "allow": ["tasktrace-mcp-plugin"]
  },
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

Direct MCP registration:

```bash
claude mcp add --transport stdio --scope project tasktrace -- /Applications/TaskTrace.app/Contents/MacOS/TaskTrace --mcp-stdio
```

Local plugin loading from the repo root:

```bash
claude --plugin-dir .
```

Inside Claude Code:

```text
/reload-plugins
/mcp
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

1. Update `index.js`, `openclaw.plugin.json`, `.claude-plugin/plugin.json`, `.cursor-plugin/plugin.json`, `.mcp.json`, and this README as needed.
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
openclaw plugins install ./tasktrace-mcp-plugin-<version>.tgz
openclaw plugins info tasktrace-mcp-plugin
```

6. Smoke test the Claude plugin layout locally:

```bash
claude --plugin-dir .
```

7. Publish through the intended distribution channel.

Current practical guidance:

- for OpenClaw, install from ClawHub (`openclaw plugins install tasktrace-mcp-plugin`) or directly from the GitHub repo
- for Claude, direct MCP registration or local plugin layout from a clone

## CircleCI Release Flow

This repo includes a CircleCI release pipeline in `.circleci/config.yml`:

1. fetch full git history and tags
2. run `semantic-release`
3. stop cleanly when there is no release
4. sync manifest versions with `versionUpdate.mjs` and build the tarball (`npm pack`)
5. commit version-bumped files back to the branch and push the release tag

The `.tgz` is stored as a CircleCI artifact and manually uploaded to ClawHub to publish a versioned release there.

Branch behavior matches TaskTrace:

- `master`: stable releases
- `dev`: prereleases

The CI job derives the npm dist-tag from the release version:

- stable versions publish with `latest`
- prereleases publish with the prerelease identifier, for example `dev`
