import fs from "node:fs";
import net from "node:net";

const EXPLICIT_SOCKET_PATH = typeof process.env.TASKTRACE_SOCKET_PATH === "string"
  ? process.env.TASKTRACE_SOCKET_PATH.trim()
  : "";
const KNOWN_SOCKET_PATHS = [
  "/tmp/tasktrace-tasktrace-openclaw.sock",
  "/tmp/tasktrace-tasktrace-local-openclaw.sock",
  "/tmp/tasktrace-tasktrace-dev-openclaw.sock"
];

export function createTaskTraceSocketBridge({
  socketPath = EXPLICIT_SOCKET_PATH || null,
  reconnectDelayMs = 1000
} = {}) {
  let socket = null;
  let reconnectTimer = null;
  let logger = null;
  let onMessage = null;
  let stopping = false;
  let reconnectAttempts = 0;
  let lastInboundAt = null;
  let lastOutboundAt = null;
  let inboundChain = Promise.resolve();
  let connectedSocketPath = null;
  let attemptedSocketPath = socketPath;

  const listCandidateSocketPaths = () => {
    const discoveredSocketPaths = (() => {
      try {
        return fs.readdirSync("/tmp")
          .filter((entry) => entry.startsWith("tasktrace-") && entry.endsWith("-openclaw.sock"))
          .map((entry) => `/tmp/${entry}`);
      } catch {
        return [];
      }
    })();

    return [
      socketPath,
      EXPLICIT_SOCKET_PATH || null,
      connectedSocketPath,
      ...KNOWN_SOCKET_PATHS,
      ...discoveredSocketPaths
    ].filter((value, index, values) => typeof value === "string" && value.length > 0 && values.indexOf(value) === index);
  };

  const clearReconnectTimer = () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const scheduleReconnect = () => {
    clearReconnectTimer();

    if (stopping) {
      return;
    }

    logger?.info?.(`[tasktrace-channel] scheduling reconnect in ${reconnectDelayMs}ms for ${socketPath}`);
    reconnectTimer = setTimeout(connect, reconnectDelayMs);
  };

  const write = (message) => {
    if (!socket || socket.destroyed) {
      return false;
    }

    socket.write(message);
    lastOutboundAt = Date.now();
    return true;
  };

  const handleIncomingData = (chunk) => {
    const message = chunk.toString("utf8");
    lastInboundAt = Date.now();
    logger?.info?.(`[tasktrace-channel] received socket message: ${message}`);
    inboundChain = inboundChain.then(async () => {
      if (!onMessage) {
        logger?.warn?.("[tasktrace-channel] no socket message handler is registered");
        return;
      }

      try {
        const response = await onMessage(message);

        if (typeof response !== "string" || !response.trim()) {
          logger?.warn?.("[tasktrace-channel] handler returned no response payload");
          return;
        }

        logger?.info?.(`[tasktrace-channel] writing handler response: ${response}`);
        write(response);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger?.error?.(`[tasktrace-channel] socket message handler failed: ${errorMessage}`);
        write(`TaskTrace OpenClaw error: ${errorMessage}`);
      }
    });
  };

  const handleDisconnect = (reason) => {
    logger?.warn?.(`[tasktrace-channel] socket disconnected: ${reason} socketPath=${connectedSocketPath ?? attemptedSocketPath ?? "unknown"}`);
    socket = null;
    connectedSocketPath = null;
    scheduleReconnect();
  };

  const connect = () => {
    clearReconnectTimer();

    if (stopping || (socket && !socket.destroyed)) {
      logger?.debug?.(`[tasktrace-channel] connect skipped stopping=${stopping} socketActive=${Boolean(socket && !socket.destroyed)}`);
      return;
    }

    const candidateSocketPaths = listCandidateSocketPaths();

    if (candidateSocketPaths.length === 0) {
      reconnectAttempts += 1;
      logger?.warn?.("[tasktrace-channel] no TaskTrace socket candidates are available");
      scheduleReconnect();
      return;
    }

    let candidateIndex = 0;

    const tryNextCandidate = () => {
      if (stopping || (socket && !socket.destroyed)) {
        return;
      }

      if (candidateIndex >= candidateSocketPaths.length) {
        reconnectAttempts += 1;
        logger?.warn?.(`[tasktrace-channel] exhausted socket candidates: ${candidateSocketPaths.join(", ")}`);
        scheduleReconnect();
        return;
      }

      const candidateSocketPath = candidateSocketPaths[candidateIndex];
      candidateIndex += 1;
      attemptedSocketPath = candidateSocketPath;
      logger?.info?.(`[tasktrace-channel] attempting socket connection to ${candidateSocketPath}`);

      const nextSocket = net.createConnection(candidateSocketPath);
      let shouldAdvanceCandidate = false;
      socket = nextSocket;

      nextSocket.on("connect", () => {
        reconnectAttempts = 0;
        connectedSocketPath = candidateSocketPath;
        socketPath = candidateSocketPath;
        logger?.info?.(`[tasktrace-channel] connected to ${candidateSocketPath}`);
      });
      nextSocket.on("data", handleIncomingData);
      nextSocket.on("error", (error) => {
        shouldAdvanceCandidate = ["ENOENT", "ECONNREFUSED"].includes(error?.code ?? "");

        if (shouldAdvanceCandidate) {
          logger?.warn?.(`[tasktrace-channel] socket candidate failed path=${candidateSocketPath} code=${error.code} message=${error.message}`);
          return;
        }

        reconnectAttempts += 1;
        logger?.warn?.(`[tasktrace-channel] socket error path=${candidateSocketPath}: ${error.message}`);
      });
      nextSocket.on("close", () => {
        if (socket !== nextSocket) {
          return;
        }

        socket = null;

        if (shouldAdvanceCandidate) {
          tryNextCandidate();
          return;
        }

        handleDisconnect("close");
      });
      nextSocket.on("end", () => {
        if (socket === nextSocket) {
          handleDisconnect("end");
        }
      });
    };

    tryNextCandidate();
  };

  return {
    start(nextLogger, nextOnMessage) {
      logger = nextLogger ?? console;
      onMessage = typeof nextOnMessage === "function" ? nextOnMessage : null;
      stopping = false;
      logger?.info?.(
        `[tasktrace-channel] service start socketPath=${socketPath ?? "auto"} candidates=${listCandidateSocketPaths().join(", ")}`
      );
      connect();
    },
    stop() {
      stopping = true;
      clearReconnectTimer();
      logger?.info?.(`[tasktrace-channel] service stop socketPath=${socketPath}`);

      if (socket && !socket.destroyed) {
        socket.end();
        socket.destroy();
      }

      socket = null;
      onMessage = null;
    },
    send(message) {
      return write(message);
    },
    status() {
      return {
        socketPath: connectedSocketPath ?? attemptedSocketPath ?? socketPath ?? KNOWN_SOCKET_PATHS[0],
        connected: Boolean(socket && !socket.destroyed),
        running: !stopping,
        reconnectAttempts,
        lastInboundAt,
        lastOutboundAt,
        connectedSocketPath
      };
    }
  };
}
