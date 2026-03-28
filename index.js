import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const execFileAsync = promisify(execFile);

const PLUGIN_ID = "tasktrace-mcp-plugin";
const PLUGIN_VERSION = "1.5.0";
const DEFAULT_TASKTRACE_APP_PATH = "/Applications/TaskTrace.app";
const DEFAULT_STARTUP_TIMEOUT_MS = 10000;
const TASKTRACE_BUNDLE_ID = "com.tasktrace.TaskTrace";
const TASKTRACE_MCP_ARGUMENT = "--mcp-stdio";

let sharedSessionState = null;

const plugin = {
  id: PLUGIN_ID,
  name: "TaskTrace MCP Plugin",
  description: "Proxy TaskTrace MCP resources into OpenClaw tools.",
  configSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      tasktracePath: {
        type: "string",
        description: "Optional TaskTrace .app bundle path or direct TaskTrace executable path.",
      },
      startupTimeoutMs: {
        type: "number",
        minimum: 1000,
        maximum: 30000,
        description: "Timeout for launching TaskTrace and completing MCP requests.",
      },
    },
  },
  register(api) {
    const resolveConfig = () => {
      const raw = api.pluginConfig && typeof api.pluginConfig === "object" ? api.pluginConfig : {};
      const tasktracePath =
        typeof raw.tasktracePath === "string" && raw.tasktracePath.trim().length > 0
          ? raw.tasktracePath.trim()
          : "";
      const startupTimeoutMs =
        typeof raw.startupTimeoutMs === "number" &&
        Number.isFinite(raw.startupTimeoutMs) &&
        raw.startupTimeoutMs >= 1000 &&
        raw.startupTimeoutMs <= 30000
          ? raw.startupTimeoutMs
          : DEFAULT_STARTUP_TIMEOUT_MS;

      return { tasktracePath, startupTimeoutMs };
    };

    api.registerTool({
      name: "tasktrace_list_resources",
      label: "TaskTrace List Resources",
      description:
        "List the enabled TaskTrace MCP resources and screenshot templates currently exposed by the local TaskTrace desktop app.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
      async execute() {
        const payload = await withTaskTraceClient(resolveConfig(), async ({ client, binaryPath, requestOptions }) => {
          const resources = await client.listResources(undefined, requestOptions);
          const templates = await client.listResourceTemplates(undefined, requestOptions);

          return {
            binaryPath,
            resources: Array.isArray(resources?.resources) ? resources.resources : [],
            templates: Array.isArray(templates?.resourceTemplates)
              ? templates.resourceTemplates
              : Array.isArray(templates?.templates)
                ? templates.templates
                : [],
          };
        });

        return {
          content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
          details: payload,
        };
      },
    });

    api.registerTool({
      name: "tasktrace_read_resource",
      label: "TaskTrace Read Resource",
      description:
        "Read a specific TaskTrace MCP resource URI. Text resources are returned as text, and screenshot resources are returned as image content blocks when possible.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          uri: {
            type: "string",
            description:
              "TaskTrace resource URI. Named resources: tasktrace://overviews/active-day (overview), tasktrace://activities/high-level (summary-only activity list), tasktrace://activities/detailed (eager feed with keystrokes, OCR, transcripts, and screenshot metadata). Screenshot bytes: tasktrace://activity/{activityId}/screenshot/{screenshotId} — URIs are embedded in the detailed activity feed.",
          },
        },
        required: ["uri"],
      },
      async execute(_toolCallId, params) {
        const payload = await withTaskTraceClient(resolveConfig(), async ({ client, binaryPath, requestOptions }) => {
          const result = await client.readResource({ uri: params.uri }, requestOptions);

          return {
            binaryPath,
            uri: params.uri,
            contents: Array.isArray(result?.contents) ? result.contents : [],
          };
        });

        const content = payload.contents.flatMap((entry) => {
          if (typeof entry?.text === "string") {
            return [{ type: "text", text: entry.text }];
          }

          if (typeof entry?.blob === "string" && typeof entry?.mimeType === "string" && entry.mimeType.startsWith("image/")) {
            return [
              {
                type: "image",
                mimeType: entry.mimeType,
                data: entry.blob,
              },
              {
                type: "text",
                text: `Read TaskTrace image resource ${entry.uri ?? params.uri}.`,
              },
            ];
          }

          if (typeof entry?.blob === "string") {
            return [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    uri: entry.uri ?? params.uri,
                    mimeType: entry.mimeType ?? null,
                    blobBase64: entry.blob,
                  },
                  null,
                  2,
                ),
              },
            ];
          }

          return [
            {
              type: "text",
              text: JSON.stringify(entry ?? null, null, 2),
            },
          ];
        });

        const details = {
          binaryPath: payload.binaryPath,
          uri: payload.uri,
          contents: payload.contents.map((entry) => ({
            uri: entry?.uri ?? payload.uri,
            mimeType: entry?.mimeType ?? null,
            hasText: typeof entry?.text === "string",
            hasBlob: typeof entry?.blob === "string",
          })),
        };

        return {
          content:
            content.length > 0
              ? content
              : [{ type: "text", text: `TaskTrace resource ${params.uri} returned no content.` }],
          details,
        };
      },
    });
  },
};

async function withTaskTraceClient(config, run) {
  let lastError;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const session = await getTaskTraceSession(config);

    try {
      return await run({
        client: session.client,
        binaryPath: session.binaryPath,
        requestOptions: { timeout: config.startupTimeoutMs },
      });
    } catch (error) {
      lastError = error;

      if (!shouldRetryTaskTraceError(error) || attempt === 1) {
        throw wrapTaskTraceError(error, session);
      }

      await invalidateTaskTraceSession(session);
    }
  }

  throw wrapTaskTraceError(lastError);
}

async function getTaskTraceSession(config) {
  const binaryPath = await resolveTaskTraceBinary(config.tasktracePath);

  if (sharedSessionState?.binaryPath === binaryPath) {
    return sharedSessionState.promise;
  }

  const state = {
    binaryPath,
    promise: null,
    session: null,
  };
  const sessionPromise = createTaskTraceSession(binaryPath, config)
    .then((session) => {
      if (sharedSessionState === state) {
        sharedSessionState.session = session;
      }
      return session;
    })
    .catch((error) => {
      if (sharedSessionState === state) {
        sharedSessionState = null;
      }
      throw error;
    });

  state.promise = sessionPromise;
  sharedSessionState = state;

  return sessionPromise;
}

async function createTaskTraceSession(binaryPath, config) {
  const transport = new StdioClientTransport({
    command: binaryPath,
    args: [TASKTRACE_MCP_ARGUMENT],
    env: buildTaskTraceEnvironment(),
    stderr: "pipe",
  });
  let stderrText = "";

  transport.stderr?.on("data", (chunk) => {
    stderrText = `${stderrText}${chunk.toString("utf8")}`.slice(-8000);
  });

  const client = new Client(
    {
      name: "TaskTraceMCPPlugin",
      version: PLUGIN_VERSION,
    },
    {
      capabilities: {},
    },
  );
  const session = {
    binaryPath,
    client,
    transport,
    getStderr: () => stderrText,
  };

  transport.onclose = () => {
    if (sharedSessionState?.session === session) {
      sharedSessionState = null;
    }
  };

  await client.connect(transport, { timeout: config.startupTimeoutMs });

  return session;
}

function buildTaskTraceEnvironment() {
  return Object.fromEntries(
    Object.entries(process.env).filter(([, value]) => typeof value === "string"),
  );
}

function shouldRetryTaskTraceError(error) {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();

  return (
    normalized.includes("timed out") ||
    normalized.includes("closed") ||
    normalized.includes("econnreset") ||
    normalized.includes("broken pipe") ||
    normalized.includes("epipe") ||
    normalized.includes("sigabrt") ||
    normalized.includes("spawn")
  );
}

async function invalidateTaskTraceSession(session) {
  if (sharedSessionState?.session === session) {
    sharedSessionState = null;
  }

  try {
    await session.client.close();
  } catch {}

  try {
    await session.transport.close();
  } catch {}
}

function wrapTaskTraceError(error, session) {
  const stderr = typeof session?.getStderr === "function" ? session.getStderr().trim() : "";
  const message = error instanceof Error ? error.message : String(error);

  return new Error(
    stderr.length > 0
      ? `${message}\n\nTaskTrace stderr:\n${stderr}`
      : message,
  );
}

async function resolveTaskTraceBinary(configuredPath) {
  const candidates = [
    configuredPath,
    typeof process.env.TASKTRACE_APP_PATH === "string" ? process.env.TASKTRACE_APP_PATH : "",
    await findInstalledTaskTraceAppPath(),
    DEFAULT_TASKTRACE_APP_PATH,
  ].filter((value) => typeof value === "string" && value.trim().length > 0);

  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    if (trimmed.endsWith("/Contents/MacOS/TaskTrace")) {
      return trimmed;
    }

    if (trimmed.endsWith(".app")) {
      return `${trimmed}/Contents/MacOS/TaskTrace`;
    }

    return trimmed;
  }

  return `${DEFAULT_TASKTRACE_APP_PATH}/Contents/MacOS/TaskTrace`;
}

async function findInstalledTaskTraceAppPath() {
  try {
    const { stdout } = await execFileAsync("mdfind", [`kMDItemCFBundleIdentifier == '${TASKTRACE_BUNDLE_ID}'`], {
      timeout: 2000,
    });

    return stdout
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0);
  } catch {
    return "";
  }
}

export default plugin;
