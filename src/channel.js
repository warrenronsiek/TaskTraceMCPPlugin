const DEFAULT_ACCOUNT_ID = "default";
const PLUGIN_ID = "tasktrace-mcp";

function buildAccountState(socketBridge, cfg, accountId) {
  const bridge = socketBridge.status();
  const resolvedAccountId = accountId?.trim() || DEFAULT_ACCOUNT_ID;
  const enabled = cfg?.plugins?.entries?.[PLUGIN_ID]?.enabled !== false;

  return {
    accountId: resolvedAccountId,
    name: "TaskTrace",
    configured: true,
    enabled,
    linked: bridge.connected,
    connected: bridge.connected,
    running: bridge.running,
    reconnectAttempts: bridge.reconnectAttempts,
    lastInboundAt: bridge.lastInboundAt,
    socketPath: bridge.socketPath,
    mode: "unix-socket"
  };
}

export function tasktraceChannelPlugin(socketBridge, logger) {
  return {
    id: "tasktrace",
    meta: {
      id: "tasktrace",
      label: "TaskTrace",
      selectionLabel: "TaskTrace",
      docsPath: "/channels/tasktrace",
      blurb: "Routes OpenClaw channel traffic over a local Unix socket into TaskTrace.",
      aliases: ["tasktrace-local"]
    },
    capabilities: {
      chatTypes: ["direct"]
    },
    config: {
      defaultAccountId: () => DEFAULT_ACCOUNT_ID,
      listAccountIds: () => [DEFAULT_ACCOUNT_ID],
      resolveAccount: (cfg, accountId) => buildAccountState(socketBridge, cfg, accountId),
      inspectAccount: (cfg, accountId) => buildAccountState(socketBridge, cfg, accountId),
      isConfigured: () => true,
      isEnabled: (account) => account?.enabled !== false
    },
    status: {
      buildAccountSnapshot: ({ accountId, account }) => {
        const bridge = socketBridge.status();

        return {
          accountId,
          name: account?.name ?? "TaskTrace",
          configured: true,
          enabled: account?.enabled !== false,
          linked: bridge.connected,
          connected: bridge.connected,
          running: bridge.running,
          reconnectAttempts: bridge.reconnectAttempts,
          lastInboundAt: bridge.lastInboundAt,
          socketPath: bridge.socketPath,
          mode: "unix-socket"
        };
      },
      buildChannelSummary: () => {
        const bridge = socketBridge.status();

        return {
          configured: true,
          linked: bridge.connected
        };
      }
    },
    outbound: {
      deliveryMode: "direct",
      sendText: async (input) => {
        const text = typeof input === "string"
          ? input
          : input?.text ?? input?.message?.text ?? input?.body ?? "";

        if (!text.trim()) {
          return { ok: false, error: "No outbound text was provided." };
        }

        const sent = socketBridge.send(text);

        if (!sent) {
          logger?.warn?.("TaskTrace outbound send failed because the socket is not connected.");
          return { ok: false, error: "TaskTrace socket is not connected." };
        }

        return { ok: true };
      }
    }
  };
}
