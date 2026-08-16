import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Context } from "@earendil-works/pi-ai";
import { createFakeStreamFn, fakeModel, lastUserMessageText } from "../fakes/stream-fn.ts";
import {
  startCore,
  connect,
  collectUntilDone,
  TEST_AUTH_TOKEN,
  type CoreHandle,
  type TestClient,
  type StreamedReply,
} from "../dsl/world.ts";

const DEFAULT_SYSTEM_PROMPT = "You are Nestor.";

function sendHello(client: TestClient, channel: string): void {
  client.send({ type: "hello", token: TEST_AUTH_TOKEN, channel });
}

function sendPrompt(client: TestClient, text: string): void {
  client.send({ type: "prompt", text });
}

function assertReady(message: unknown): void {
  assert.deepEqual(message, { type: "ready" });
}

function assertReplyReconstructed(deltaTexts: string[], expectedReply: string): void {
  assert.equal(deltaTexts.join(""), expectedReply);
}

function assertEachChannelReconstructedItsOwnReply(
  results: [StreamedReply, string][],
): void {
  for (const [result, expectedReply] of results) assertReplyReconstructed(result.deltaTexts, expectedReply);
}

function assertStreamEndedWithDone(doneFrame: unknown): void {
  assert.deepEqual(doneFrame, { type: "done" });
}

function assertContextReceivedPrompt(context: Context, systemPrompt: string, text: string): void {
  assert.equal(context.systemPrompt, systemPrompt);
  assert.equal(lastUserMessageText(context), text);
}

async function startCoreWithReplies(replies: Record<string, string>, systemPrompt = DEFAULT_SYSTEM_PROMPT): Promise<CoreHandle> {
  const { streamFn } = createFakeStreamFn(replies);
  return startCore({ agent: { model: fakeModel, streamFn, systemPrompt } });
}

async function startCoreCapturingContext(
  replies: Record<string, string>,
  systemPrompt: string,
): Promise<{ core: CoreHandle; recordedContexts: Context[] }> {
  const { streamFn, recordedContexts } = createFakeStreamFn(replies);
  const core = await startCore({ agent: { model: fakeModel, streamFn, systemPrompt } });
  return { core, recordedContexts };
}

async function connectAndAuthenticate(handle: CoreHandle, channel: string, clients: TestClient[]): Promise<TestClient> {
  const client = connect(handle.url);
  clients.push(client);
  sendHello(client, channel);
  assertReady(await client.nextMessage());
  return client;
}

async function promptAndAwaitDone(client: TestClient, text: string): Promise<StreamedReply> {
  sendPrompt(client, text);
  return collectUntilDone(client);
}

async function promptConcurrently(exchanges: [TestClient, string][]): Promise<StreamedReply[]> {
  const results = exchanges.map(([client]) => collectUntilDone(client));
  for (const [client, text] of exchanges) sendPrompt(client, text);
  return Promise.all(results);
}

async function startTwoChannelExchange(
  clients: TestClient[],
  signalReply: string,
  voiceReply: string,
): Promise<{ core: CoreHandle; promptBoth(): Promise<StreamedReply[]> }> {
  const signalText = "ping signal";
  const voiceText = "ping voice";
  const core = await startCoreWithReplies({ [signalText]: signalReply, [voiceText]: voiceReply });
  const signalClient = await connectAndAuthenticate(core, "signal", clients);
  const voiceClient = await connectAndAuthenticate(core, "voice", clients);

  return {
    core,
    promptBoth: () =>
      promptConcurrently([
        [signalClient, signalText],
        [voiceClient, voiceText],
      ]),
  };
}

describe("prompt streaming", () => {
  let core: CoreHandle;
  let clients: TestClient[];

  beforeEach(() => {
    clients = [];
  });

  afterEach(async () => {
    for (const client of clients) client.close();
    await core.stop();
  });

  it("a prompt streams deltas that concatenate to the reply followed by done", async () => {
    const reply = "Hello! How can I help you today?";
    core = await startCoreWithReplies({ "hi there": reply });
    const client = await connectAndAuthenticate(core, "signal", clients);

    const { deltaTexts, doneFrame } = await promptAndAwaitDone(client, "hi there");

    assertReplyReconstructed(deltaTexts, reply);
    assertStreamEndedWithDone(doneFrame);
  });

  it("the model receives the system prompt and the user message", async () => {
    const systemPrompt = "You are Nestor, a personal assistant.";
    const { core: started, recordedContexts } = await startCoreCapturingContext({ "what's the weather": "Sunny today." }, systemPrompt);
    core = started;
    const client = await connectAndAuthenticate(core, "signal", clients);

    await promptAndAwaitDone(client, "what's the weather");

    assertContextReceivedPrompt(recordedContexts[0]!, systemPrompt, "what's the weather");
  });

  it("two channels streaming concurrently each receive only their own deltas", async () => {
    const signalReply = "On my way to the signal channel.";
    const voiceReply = "Speaking through the voice channel.";
    const exchange = await startTwoChannelExchange(clients, signalReply, voiceReply);
    core = exchange.core;
    const [signalResult, voiceResult] = await exchange.promptBoth();

    assertEachChannelReconstructedItsOwnReply([[signalResult!, signalReply], [voiceResult!, voiceReply]]);
  });
});
