import { randomUUID } from "node:crypto";

const DEFAULT_ACCOUNT_ID = "default";
const DEFAULT_AGENT_ID = "main";
const DEFAULT_CHANNEL_ID = "tasktrace";
const DEFAULT_DM_SCOPE = "per-channel-peer";

export function createTaskTraceSocketMessageHandler(api) {
  return async (rawMessage) => {
    const request = (() => {
      let parsed;

      try {
        parsed = JSON.parse(rawMessage);
      } catch (error) {
        throw new Error(`invalid TaskTrace channel payload: ${error instanceof Error ? error.message : String(error)}`);
      }

      const kind = typeof parsed?.kind === "string" ? parsed.kind.trim() : "agent_action";
      const message = typeof parsed?.message === "string"
        ? parsed.message.trim()
        : (typeof parsed?.instructions === "string"
            ? parsed.instructions.trim()
            : (typeof parsed?.content === "string" ? parsed.content.trim() : ""));
      const conversationID = typeof parsed?.conversationID === "string" ? parsed.conversationID.trim() : "";
      const eventType = typeof parsed?.eventType === "string" ? parsed.eventType.trim() : "";
      const eventPayload = parsed?.eventPayload ?? null;
      const queuedEventPayloads = Array.isArray(parsed?.queuedEventPayloads)
        ? parsed.queuedEventPayloads.filter((value) => typeof value === "string" && value.trim().length > 0)
        : [];

      if (!conversationID) {
        throw new Error("TaskTrace request is missing conversationID");
      }

      if (kind === "agent_action" && !message) {
        throw new Error("TaskTrace request is missing message");
      }

      if (kind === "agent_action" && !eventType) {
        throw new Error("TaskTrace request is missing eventType");
      }

      if (kind === "chat_message" && !message) {
        throw new Error("TaskTrace chat request is missing message");
      }

      return {
        kind,
        message,
        conversationID,
        eventType,
        eventPayload,
        queuedEventPayloads
      };
    })();

    const cfg = api.runtime.config.loadConfig();
    const sessionKey = api.runtime.channel.routing.buildAgentSessionKey({
      agentId: DEFAULT_AGENT_ID,
      channel: DEFAULT_CHANNEL_ID,
      accountId: DEFAULT_ACCOUNT_ID,
      dmScope: DEFAULT_DM_SCOPE,
      peer: {
        kind: "direct",
        id: request.conversationID
      }
    });
    const storePath = api.runtime.agent.session.resolveStorePath(cfg.session?.store, { agentId: DEFAULT_AGENT_ID });
    const sessionStore = api.runtime.agent.session.loadSessionStore(storePath);
    const now = Date.now();
    const sessionEntry = (() => {
      const existingEntry = sessionStore[sessionKey];

      if (existingEntry) {
        return existingEntry;
      }

      const nextEntry = {
        sessionId: randomUUID(),
        updatedAt: now
      };

      sessionStore[sessionKey] = nextEntry;
      return nextEntry;
    })();

    if (!sessionEntry.sessionId) {
      sessionEntry.sessionId = randomUUID();
      sessionEntry.updatedAt = now;
      sessionStore[sessionKey] = sessionEntry;
    }

    await api.runtime.agent.session.saveSessionStore(storePath, sessionStore);

    const sessionId = sessionEntry.sessionId;
    const sessionFile = api.runtime.agent.session.resolveSessionFilePath(sessionId, sessionEntry, { agentId: DEFAULT_AGENT_ID });
    const workspaceDir = api.runtime.agent.resolveAgentWorkspaceDir(cfg, DEFAULT_AGENT_ID);
    const agentDir = api.runtime.agent.resolveAgentDir(cfg, DEFAULT_AGENT_ID);

    await api.runtime.agent.ensureAgentWorkspace({ dir: workspaceDir });

    api.logger.info(
      `[tasktrace-channel] dispatching agent run eventType=${request.eventType} conversationID=${request.conversationID} sessionKey=${sessionKey}`
    );

    const result = await api.runtime.agent.runEmbeddedPiAgent({
      sessionId,
      sessionKey,
      messageChannel: DEFAULT_CHANNEL_ID,
      messageProvider: DEFAULT_CHANNEL_ID,
      agentAccountId: DEFAULT_ACCOUNT_ID,
      messageTo: request.conversationID,
      sessionFile,
      workspaceDir,
      agentDir,
      config: cfg,
      prompt: request.kind === "chat_message"
        ? [
            "TaskTrace user chat message.",
            "Return ONLY valid JSON.",
            "The JSON must have exactly these keys:",
            '{ "importance": "low" | "medium" | "high", "content": "what you want to say" }',
            "Do not include markdown fences.",
            "Do not include any extra keys.",
            "",
            "USER_MESSAGE:",
            request.message
          ].join("\n")
        : [
            "TaskTrace triggered an AgentAction.",
            "Return ONLY valid JSON.",
            "The JSON must have exactly these keys:",
            '{ "importance": "low" | "medium" | "high", "content": "what you want to say" }',
            "Do not include markdown fences.",
            "Do not include any extra keys.",
            "",
            "MESSAGE:",
            request.message,
            "",
            `EVENT_TYPE: ${request.eventType}`,
            "QUEUED_EVENT_PAYLOADS_JSON:",
            JSON.stringify(
              request.queuedEventPayloads.length > 0 ? request.queuedEventPayloads : [request.eventPayload],
              null,
              2
            ),
            "",
            "Respond with the useful final answer only."
          ].join("\n"),
      extraSystemPrompt: [
        "The TaskTrace app is sending structured automation events.",
        "Do not ask the user to resend prior context if it is already in the conversation history.",
        "Treat repeated calls with the same conversation identity as the same ongoing thread."
      ].join("\n"),
      timeoutMs: api.runtime.agent.resolveAgentTimeoutMs({ cfg }),
      runId: `tasktrace-${request.conversationID}-${Date.now()}`,
      disableMessageTool: true
    });

    const responseText = (result.payloads ?? [])
      .filter((payload) => !payload.isError && typeof payload.text === "string")
      .map((payload) => payload.text?.trim() ?? "")
      .filter(Boolean)
      .join("\n\n")
      .trim();

    const structuredResponse = (() => {
      const strippedResponse = responseText
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();
      const validImportances = new Set(["low", "medium", "high"]);

      if (!strippedResponse) {
        return JSON.stringify({
          importance: result.meta?.aborted ? "high" : "medium",
          content: result.meta?.aborted
            ? "OpenClaw did not finish the TaskTrace request before the run ended."
            : "OpenClaw completed the TaskTrace request without a text response."
        });
      }

      try {
        const parsed = JSON.parse(strippedResponse);
        const importance = typeof parsed?.importance === "string" ? parsed.importance.trim().toLowerCase() : "";
        const content = typeof parsed?.content === "string" ? parsed.content.trim() : "";

        if (validImportances.has(importance) && content) {
          return JSON.stringify({ importance, content });
        }
      } catch {
        // Fall through to coercion below.
      }

      return JSON.stringify({
        importance: "medium",
        content: strippedResponse
      });
    })();

    api.logger.info(
      `[tasktrace-channel] normalized structured response eventType=${request.eventType} conversationID=${request.conversationID} sessionKey=${sessionKey} payload=${structuredResponse}`
    );

    api.logger.info(
      `[tasktrace-channel] completed agent run eventType=${request.eventType} conversationID=${request.conversationID} sessionKey=${sessionKey}`
    );

    return structuredResponse;
  };
}
