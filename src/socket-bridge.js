import net from "node:net";

const DEFAULT_SOCKET_PATH = process.env.TASKTRACE_SOCKET_PATH ?? "/tmp/tasktrace-tasktrace-local-openclaw.sock";

export function createTaskTraceSocketBridge({
  socketPath = DEFAULT_SOCKET_PATH,
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
    logger?.warn?.(`[tasktrace-channel] socket disconnected: ${reason}`);
    socket = null;
    scheduleReconnect();
  };

  const connect = () => {
    clearReconnectTimer();

    if (stopping || (socket && !socket.destroyed)) {
      logger?.debug?.(`[tasktrace-channel] connect skipped stopping=${stopping} socketActive=${Boolean(socket && !socket.destroyed)}`);
      return;
    }

    logger?.info?.(`[tasktrace-channel] attempting socket connection to ${socketPath}`);
    const nextSocket = net.createConnection(socketPath);
    socket = nextSocket;

    nextSocket.on("connect", () => {
      reconnectAttempts = 0;
      logger?.info?.(`[tasktrace-channel] connected to ${socketPath}`);
    });
    nextSocket.on("data", handleIncomingData);
    nextSocket.on("error", (error) => {
      reconnectAttempts += 1;
      logger?.warn?.(`[tasktrace-channel] socket error: ${error.message}`);
    });
    nextSocket.on("close", () => {
      if (socket === nextSocket) {
        handleDisconnect("close");
      }
    });
    nextSocket.on("end", () => {
      if (socket === nextSocket) {
        handleDisconnect("end");
      }
    });
  };

  return {
    start(nextLogger, nextOnMessage) {
      logger = nextLogger ?? console;
      onMessage = typeof nextOnMessage === "function" ? nextOnMessage : null;
      stopping = false;
      logger?.info?.(`[tasktrace-channel] service start socketPath=${socketPath}`);
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
        socketPath,
        connected: Boolean(socket && !socket.destroyed),
        running: !stopping,
        reconnectAttempts,
        lastInboundAt,
        lastOutboundAt
      };
    }
  };
}
