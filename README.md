# TaskTrace for Claude Code (and Codex, OpenClaw, any MCP client)

Give your AI agent access to what you were actually doing. Ask Claude *"what did I do today"*, *"find when I worked on billing"*, or *"help me finish what I was on before lunch"* — and get real answers from your own desktop activity, screenshots, transcripts, and notes.

Everything runs locally against the TaskTrace desktop app on your machine. There is no cloud service to sign up for and nothing leaves your computer unless you send it.

## What this solves

Every AI conversation starts from zero. You re-explain the task, the state, the context, every time. TaskTrace holds a rolling record of what you actually did — so the assistant can look it up instead of asking.

With this plugin installed and TaskTrace running, Claude can:

- **Recap your day** — "what did I do today" reads grouped summaries of today's work.
- **Pick up threads** — "continue what I was doing on the ingest pipeline" searches your history and reads the in-progress activity for exact state.
- **Find past work** — "when did I last touch the OAuth flow", "find everything about migrations from the last month".
- **Surface what you know** — "what do I know about PDF parsing" queries a knowledge graph built from your notes, documents, and captures.
- **Read the screen** — "what's on my screen right now" for current context, or fetch a specific past screenshot if needed.

You control which feeds are shared from TaskTrace's **Preferences → MCP** pane. Turn any of them off and Claude simply does not see that data.

## Install for Claude Code

**One-line install** via the plugin marketplace:

```bash
/plugin marketplace add warrenronsiek/TaskTraceMCPPlugin
/plugin install tasktrace-mcp@tasktrace-mcp
```

Then in Claude Code:

```bash
/mcp
```

You should see `tasktrace` listed. That is it.

**Don't have TaskTrace yet?** Download the desktop app from [tasktrace.com](https://tasktrace.com), drop it in `/Applications`, launch it once, and open **Preferences → MCP** to turn on the feeds you want to share.

**Stuck?** Run `/tasktrace-mcp:setup` inside Claude Code. The setup skill checks your install, reports what is missing, and walks through the fix.

### Manual MCP registration (no plugin)

If you prefer to skip the plugin and just register the MCP server directly:

```bash
claude mcp add --transport stdio --scope project tasktrace -- /Applications/TaskTrace.app/Contents/MacOS/TaskTrace --mcp-stdio
claude mcp list
```

You get the tools and resources, but not the skills that teach Claude when to use them.

## What's inside the Claude plugin

The plugin contributes three skills on top of the MCP wiring:

- **`tasktrace-context`** — auto-triggers on questions about your own work ("what did I do today", "find when I worked on X", "help me with this"). Teaches Claude which tool or resource to use for each query pattern.
- **`tasktrace-knowledge`** — auto-triggers on questions about what you know ("what do I know about X", "find claims about Y"). Routes to the graph search tool.
- **`tasktrace-setup`** — user-invoked via `/tasktrace-mcp:setup`. Runs install checks, identifies missing permissions, and walks you through fixes.

The MCP server itself exposes:

- `tasktrace_search` — ranked natural-language search across your entire activity history.
- `tasktrace_graph_search` — structured retrieval over your selected knowledge directory (communities, nodes, claims).
- `tasktrace://overviews/active-day` — today's grouped work with summaries and durations.
- `tasktrace://activities/high-level` — recent completed activities with summaries.
- `tasktrace://activities/detailed` — eager feed including keystrokes, transcripts, screenshot metadata (off by default).
- `tasktrace://activity/{activityId}/screenshot/{screenshotId}` — binary WebP screenshots on demand.

## What stays on your machine

TaskTrace captures what you ask it to capture. The MCP server only surfaces the feeds and tools you enable in the app. There is no remote endpoint. The MCP launcher is just a subprocess of the TaskTrace app you already have running:

```bash
/Applications/TaskTrace.app/Contents/MacOS/TaskTrace --mcp-stdio
```

When you turn off a feed in **Preferences → MCP**, Claude stops seeing it. There is nothing cached outside the app.

## Other clients

### Codex

Stage and install from the local Codex marketplace:

```bash
npm install
npm run install:codex-local
```

Then restart Codex, open the local marketplace, and install `tasktrace-mcp`.

### OpenClaw

```bash
openclaw plugins install .
openclaw mcp set tasktrace '{"command":"/Applications/TaskTrace.app/Contents/MacOS/TaskTrace","args":["--mcp-stdio"]}'
openclaw config unset tools.allow
openclaw gateway restart
openclaw plugins inspect tasktrace-mcp
openclaw channels list
```

OpenClaw also gets the native `tasktrace` channel bridge over a local Unix socket, which lets agents exchange live messages with the running TaskTrace app on the `tasktrace` channel.

### Generic `.mcp.json`

Use the included `.mcp.json` as a starting point for any client that supports project-scoped MCP server config files.

## Troubleshooting

Run `/tasktrace-mcp:setup` first — it diagnoses most problems.

Common issues and fixes:

| Symptom | Fix |
|---|---|
| `/mcp` does not list `tasktrace` | Restart your Claude Code session after installing the plugin. |
| Claude says it can't see your activity | Open TaskTrace → Preferences → MCP, turn on **Enable MCP server**, enable the specific resources and tools. |
| Screenshots are blank | macOS → System Settings → Privacy & Security → Screen & System Audio Recording → grant TaskTrace. |
| Keystrokes missing from detailed feed | macOS → System Settings → Privacy & Security → Input Monitoring → grant TaskTrace. |
| Transcripts missing | macOS → System Settings → Privacy & Security → Microphone → grant TaskTrace, and enable transcription in TaskTrace. |
| Resource returns empty | That feed may be disabled in TaskTrace, or you haven't worked today. Both are fine. |

---

## Development and packaging

*The rest of this file is for contributors and packagers. End users can stop here.*

### Repository layout

- `.claude-plugin/plugin.json` — Claude Code plugin manifest with inline `mcpServers` config
- `.claude-plugin/marketplace.json` — Claude Code marketplace entry
- `skills/` — Claude Code skills (`tasktrace-context`, `tasktrace-knowledge`, `tasktrace-setup`)
- `.codex-plugin/plugin.json` — Codex plugin manifest
- `.codex-plugin/marketplace.json` — reference marketplace entry for a home-local Codex install
- `.cursor-plugin/plugin.json` — Cursor-compatible plugin marker
- `openclaw.plugin.json` — OpenClaw plugin manifest for the TaskTrace channel bridge
- `.mcp.json` — reusable MCP server config in standard `mcpServers` format
- `index.js` and `src/` — native OpenClaw runtime entrypoint plus the Unix-socket bridge and TaskTrace agent session handler
- `package.json` — package metadata for local install, `npm pack`, publication, and OpenClaw runtime registration
- `scripts/set-version.mjs` — semver-backed helper that validates a version and syncs it across manifests
- `scripts/install-codex-plugin.mjs` — stages this bundle into the local Codex marketplace

### OpenClaw channel bridge

The channel bridge auto-discovers the standard TaskTrace socket paths for prod, local, and dev builds. To force a specific app instance, set `TASKTRACE_SOCKET_PATH` before starting the OpenClaw gateway.

OpenClaw exposes these resource-backed tools on top of the native channel:

- `tasktrace_list_resources`
- `tasktrace_list_resource_templates`
- `tasktrace_get_active_day_overviews`
- `tasktrace_get_high_level_activities`
- `tasktrace_get_detailed_activities`
- `tasktrace_read_resource`

These are powered by the already-registered TaskTrace stdio MCP server, so OpenClaw reads the real TaskTrace resources rather than a duplicate data path.

### Versioning

```bash
npm install
npm run set-version -- 0.1.1
```

Validates input as semver and syncs:

- `package.json`
- `.codex-plugin/plugin.json`
- `.claude-plugin/plugin.json`
- `.cursor-plugin/plugin.json`

Also writes `.release-version.env` with `RELEASE_VERSION`, `NPM_DIST_TAG`, and `PACKAGE_TARBALL`.

### Release checklist

1. Update manifests and this README as needed.
2. `npm install`.
3. `npm run set-version -- <new-version>`.
4. `npm pack`.
5. Smoke test OpenClaw: `openclaw plugins install .` → `openclaw gateway restart` → confirm `openclaw mcp list` shows `tasktrace`.
6. Smoke test Claude: `claude --plugin-dir .`, ask *"what did I do today"*, and verify Claude reads from TaskTrace.

### Docs

- Claude plugin docs: https://code.claude.com/docs/en/plugins
- Claude MCP docs: https://code.claude.com/docs/en/mcp
- MCP lifecycle spec: https://modelcontextprotocol.io/specification/2024-11-05/basic/lifecycle
- OpenClaw plugin manifest: https://docs.openclaw.ai/plugins/manifest
- TaskTrace docs: https://tasktrace.com/docs

### License

MIT. See `LICENSE`.
