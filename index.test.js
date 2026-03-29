import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import plugin, { __testHooks } from "./index.js";

afterEach(() => {
  __testHooks.reset();
});

function createMockRuntime(clientOverrides = {}) {
  const createTransportCalls = [];
  const createClientCalls = [];
  const transport = {
    stderr: {
      on() {},
    },
    onclose: null,
    closeCalls: 0,
    async close() {
      this.closeCalls += 1;
      if (typeof this.onclose === "function") {
        this.onclose();
      }
    },
  };
  const client = {
    connectCalls: [],
    closeCalls: 0,
    async connect(receivedTransport, options) {
      this.connectCalls.push({ transport: receivedTransport, options });
    },
    async close() {
      this.closeCalls += 1;
    },
    ...clientOverrides,
  };

  return {
    client,
    transport,
    createTransportCalls,
    createClientCalls,
    runtimeDependencies: {
      createTransport(options) {
        createTransportCalls.push(options);
        return transport;
      },
      createClient(clientInfo, options) {
        createClientCalls.push({ clientInfo, options });
        return client;
      },
    },
  };
}

function registerPlugin(pluginConfig = {}) {
  const tools = {};

  plugin.register({
    pluginConfig,
    registerTool(tool) {
      tools[tool.name] = tool;
    },
  });

  return tools;
}

test("registers the expected OpenClaw tools", () => {
  const tools = registerPlugin();

  assert.deepEqual(Object.keys(tools).sort(), [
    "tasktrace_list_resources",
    "tasktrace_read_resource",
    "tasktrace_search",
  ]);
});

test("creates a session on first use and reuses it on the second call", async () => {
  const runtime = createMockRuntime();
  __testHooks.setRuntimeDependencies(runtime.runtimeDependencies);

  const firstCall = await __testHooks.withTaskTraceClient(
    { startupTimeoutMs: 4321 },
    async ({ binaryPath, requestOptions, client }) => ({
      binaryPath,
      requestOptions,
      client,
    }),
  );
  const secondCallClient = await __testHooks.withTaskTraceClient(
    { startupTimeoutMs: 4321 },
    async ({ client }) => client,
  );

  assert.equal(runtime.createTransportCalls.length, 1);
  assert.equal(runtime.createClientCalls.length, 1);
  assert.equal(runtime.client.connectCalls.length, 1);
  assert.equal(firstCall.binaryPath, "/Applications/TaskTrace.app/Contents/MacOS/TaskTrace");
  assert.deepEqual(firstCall.requestOptions, { timeout: 4321 });
  assert.equal(firstCall.client, runtime.client);
  assert.equal(secondCallClient, runtime.client);
});

test("tasktrace_list_resources returns mocked MCP resources", async () => {
  const runtime = createMockRuntime({
    async listResources(_params, options) {
      assert.deepEqual(options, { timeout: 2500 });
      return {
        resources: [{ uri: "tasktrace://overviews/active-day", name: "Active day" }],
      };
    },
    async listResourceTemplates(_params, options) {
      assert.deepEqual(options, { timeout: 2500 });
      return {
        resourceTemplates: [{ uriTemplate: "tasktrace://activity/{id}/screenshot/{screenshotId}" }],
      };
    },
  });
  __testHooks.setRuntimeDependencies(runtime.runtimeDependencies);

  const tools = registerPlugin({ startupTimeoutMs: 2500 });
  const result = await tools.tasktrace_list_resources.execute();

  assert.deepEqual(result.details, {
    binaryPath: "/Applications/TaskTrace.app/Contents/MacOS/TaskTrace",
    resources: [{ uri: "tasktrace://overviews/active-day", name: "Active day" }],
    templates: [{ uriTemplate: "tasktrace://activity/{id}/screenshot/{screenshotId}" }],
  });
  assert.match(result.content[0].text, /tasktrace:\/\/overviews\/active-day/);
});

test("tasktrace_read_resource maps text and image payloads into OpenClaw content blocks", async () => {
  const runtime = createMockRuntime({
    async readResource(request, options) {
      assert.deepEqual(request, { uri: "tasktrace://activity/123/screenshot/456" });
      assert.deepEqual(options, { timeout: 10000 });
      return {
        contents: [
          { uri: request.uri, text: "Screenshot metadata" },
          { uri: request.uri, mimeType: "image/png", blob: "ZmFrZS1pbWFnZQ==" },
        ],
      };
    },
  });
  __testHooks.setRuntimeDependencies(runtime.runtimeDependencies);

  const tools = registerPlugin();
  const result = await tools.tasktrace_read_resource.execute("call-1", {
    uri: "tasktrace://activity/123/screenshot/456",
  });

  assert.deepEqual(result.content, [
    { type: "text", text: "Screenshot metadata" },
    { type: "image", mimeType: "image/png", data: "ZmFrZS1pbWFnZQ==" },
    { type: "text", text: "Read TaskTrace image resource tasktrace://activity/123/screenshot/456." },
  ]);
  assert.deepEqual(result.details, {
    binaryPath: "/Applications/TaskTrace.app/Contents/MacOS/TaskTrace",
    uri: "tasktrace://activity/123/screenshot/456",
    contents: [
      {
        uri: "tasktrace://activity/123/screenshot/456",
        mimeType: null,
        hasText: true,
        hasBlob: false,
      },
      {
        uri: "tasktrace://activity/123/screenshot/456",
        mimeType: "image/png",
        hasText: false,
        hasBlob: true,
      },
    ],
  });
});
