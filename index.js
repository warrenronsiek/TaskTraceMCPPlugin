import { tasktraceChannelPlugin } from "./src/channel.js";
import { createTaskTraceSocketBridge } from "./src/socket-bridge.js";
import { createTaskTraceSocketMessageHandler } from "./src/tasktrace-agent.js";

const socketBridge = createTaskTraceSocketBridge();
let startedByGatewayRegister = false;
let registeredProcessCleanup = false;

export default function register(api) {
  const handleSocketMessage = createTaskTraceSocketMessageHandler(api);

  api.registerChannel({ plugin: tasktraceChannelPlugin(socketBridge, api.logger) });
  api.registerService({
    id: "tasktrace-socket-bridge",
    start: () => {
      socketBridge.start(api.logger, handleSocketMessage);
    },
    stop: () => {
      socketBridge.stop();
    }
  });

  if (
    api.registrationMode === "full" &&
    process.env.OPENCLAW_SERVICE_KIND === "gateway" &&
    !startedByGatewayRegister
  ) {
    startedByGatewayRegister = true;
    socketBridge.start(api.logger, handleSocketMessage);
  }

  if (!registeredProcessCleanup) {
    registeredProcessCleanup = true;
    process.once("exit", () => {
      socketBridge.stop();
    });
  }
}
