import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const PLUGIN_ID = "tasktrace-mcp-plugin";
const PLUGIN_VERSION = "1.3.0";
const MCP_PROTOCOL_VERSION = "2024-11-05";
const DEFAULT_TASKTRACE_APP_PATH = "/Applications/TaskTrace.app";
const DEFAULT_STARTUP_TIMEOUT_MS = 10000;
const TASKTRACE_BUNDLE_ID = "com.tasktrace.TaskTrace";
const TASKTRACE_MCP_ARGUMENT = "--mcp-stdio";

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

    api.registerTool(
      {
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
          const payload = await withTaskTraceSession(resolveConfig(), async ({ request, binaryPath }) => {
            const resources = await request("resources/list", {});
            const templates = await request("resources/templates/list", {});

            return {
              binaryPath,
              resources: Array.isArray(resources?.resources) ? resources.resources : [],
              templates: Array.isArray(templates?.templates) ? templates.templates : [],
            };
          });

          return {
            content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
            details: payload,
          };
        },
      },
      { optional: true },
    );

    api.registerTool(
      {
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
          const payload = await withTaskTraceSession(resolveConfig(), async ({ request, binaryPath }) => {
            const result = await request("resources/read", { uri: params.uri });

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
      },
      { optional: true },
    );
  },
};

async function withTaskTraceSession(config, run) {
  const binaryPath = await resolveTaskTraceBinary(config.tasktracePath);
  const child = spawn(binaryPath, [TASKTRACE_MCP_ARGUMENT], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  const pending = new Map();
  let nextId = 1;
  let stdoutBuffer = Buffer.alloc(0);
  let stderrText = "";
  let isClosed = false;

  const rejectPending = (error) => {
    if (pending.size === 0) {
      return;
    }

    const entries = [...pending.values()];
    pending.clear();
    entries.forEach(({ reject, timeout }) => {
      clearTimeout(timeout);
      reject(error);
    });
  };

  const buildClosedError = () => {
    const stderr = stderrText.trim();

    return new Error(
      stderr.length > 0
        ? stderr
        : "TaskTrace exited before the MCP request completed. Make sure TaskTrace is installed and the MCP server is enabled in the app.",
    );
  };

  const parseMessages = () => {
    while (true) {
      const headerEnd = stdoutBuffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) {
        return;
      }

      const headerText = stdoutBuffer.subarray(0, headerEnd).toString("utf8");
      const lengthMatch = headerText.match(/Content-Length:\s*(\d+)/i);
      if (!lengthMatch) {
        rejectPending(new Error(`Invalid MCP frame headers from TaskTrace: ${headerText}`));
        child.kill();
        return;
      }

      const contentLength = Number(lengthMatch[1]);
      const messageStart = headerEnd + 4;
      const messageEnd = messageStart + contentLength;

      if (stdoutBuffer.length < messageEnd) {
        return;
      }

      const messageText = stdoutBuffer.subarray(messageStart, messageEnd).toString("utf8");
      stdoutBuffer = stdoutBuffer.subarray(messageEnd);

      let message;
      try {
        message = JSON.parse(messageText);
      } catch (error) {
        rejectPending(
          new Error(`TaskTrace returned invalid MCP JSON: ${error instanceof Error ? error.message : String(error)}`),
        );
        child.kill();
        return;
      }

      if (Object.prototype.hasOwnProperty.call(message, "id") && pending.has(message.id)) {
        const pendingRequest = pending.get(message.id);
        pending.delete(message.id);
        clearTimeout(pendingRequest.timeout);

        if (message.error) {
          pendingRequest.reject(new Error(message.error.message ?? JSON.stringify(message.error)));
        } else {
          pendingRequest.resolve(message.result);
        }
      }
    }
  };

  child.stdout.on("data", (chunk) => {
    stdoutBuffer = Buffer.concat([stdoutBuffer, chunk]);
    parseMessages();
  });

  child.stderr.on("data", (chunk) => {
    stderrText = `${stderrText}${chunk.toString("utf8")}`.slice(-8000);
  });

  child.on("error", (error) => {
    isClosed = true;
    rejectPending(error);
  });

  child.on("exit", () => {
    isClosed = true;
    rejectPending(buildClosedError());
  });

  const send = (message) => {
    if (!child.stdin.writable || isClosed) {
      throw buildClosedError();
    }

    const payload = JSON.stringify(message);
    child.stdin.write(`Content-Length: ${Buffer.byteLength(payload, "utf8")}\r\n\r\n${payload}`);
  };

  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timed out waiting for TaskTrace MCP method ${method}.`));
      }, config.startupTimeoutMs);

      pending.set(id, { resolve, reject, timeout });

      try {
        send({
          jsonrpc: "2.0",
          id,
          method,
          params,
        });
      } catch (error) {
        clearTimeout(timeout);
        pending.delete(id);
        reject(error);
      }
    });

  const notify = (method, params) => {
    send({
      jsonrpc: "2.0",
      method,
      params,
    });
  };

  try {
    await request("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: "TaskTraceMCPPlugin",
        version: PLUGIN_VERSION,
      },
    });
    notify("notifications/initialized", {});

    return await run({ request, binaryPath });
  } finally {
    try {
      if (!isClosed) {
        await request("shutdown", {});
      }
    } catch {}

    try {
      if (!isClosed) {
        notify("exit", {});
      }
    } catch {}

    child.kill();
  }
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
