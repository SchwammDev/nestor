import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createFakeStreamFn, fakeModel } from "../fakes/stream-fn.ts";
import {
  startCore,
  connect,
  collectUntilDone,
  collectUntilDoneCapturingErrors,
  TEST_AUTH_TOKEN,
  type CoreHandle,
  type TestClient,
} from "../dsl/world.ts";

const DEFAULT_SYSTEM_PROMPT = "You are Nestor.";

function sendHello(client: TestClient, channel: string): void {
  client.send({ type: "hello", token: TEST_AUTH_TOKEN, channel });
}

function sendPrompt(client: TestClient, text: string): void {
  client.send({ type: "prompt", text });
}

async function connectAndAuthenticate(handle: CoreHandle, channel: string, clients: TestClient[]): Promise<TestClient> {
  const client = connect(handle.url);
  clients.push(client);
  sendHello(client, channel);
  await client.nextMessage();
  return client;
}

async function promptAndAwaitDone(client: TestClient, text: string) {
  sendPrompt(client, text);
  return collectUntilDone(client);
}

async function startCoreWithReplies(replies: Record<string, string>): Promise<CoreHandle> {
  const { streamFn } = createFakeStreamFn(replies);
  return startCore({ agent: { model: fakeModel, streamFn, systemPrompt: DEFAULT_SYSTEM_PROMPT } });
}

function assertReplyReconstructed(deltaTexts: string[], expectedReply: string): void {
  assert.equal(deltaTexts.join(""), expectedReply);
}

function assertStreamEndedWithDone(doneFrame: unknown): void {
  assert.deepEqual(doneFrame, { type: "done" });
}

function assertStreamedReplyMatches(result: { deltaTexts: string[]; doneFrame: unknown }, expectedReply: string): void {
  assertReplyReconstructed(result.deltaTexts, expectedReply);
  assertStreamEndedWithDone(result.doneFrame);
}

function assertBusyError(message: unknown): void {
  const frame = message as { type: string; code: string; message: string };
  assert.equal(frame.type, "error");
  assert.equal(frame.code, "busy");
  assert.equal(typeof frame.message, "string");
}

async function promptInterruptedMidStreamByAnotherPrompt(client: TestClient, promptText: string, interruptingText: string) {
  let interruptSent = false;
  sendPrompt(client, promptText);
  return collectUntilDoneCapturingErrors(client, () => {
    if (interruptSent) return;
    interruptSent = true;
    sendPrompt(client, interruptingText);
  });
}

function assertRunningTurnCompletedDespiteBusyRejection(
  result: { deltaTexts: string[]; doneFrame: unknown; errorFrames: unknown[] },
  expectedReply: string,
): void {
  assertStreamedReplyMatches(result, expectedReply);
  assert.equal(result.errorFrames.length, 1);
  assertBusyError(result.errorFrames[0]);
}

describe("turn serialization", () => {
  let core: CoreHandle;
  let clients: TestClient[];

  beforeEach(() => {
    clients = [];
  });

  afterEach(async () => {
    for (const client of clients) client.close();
    await core.stop();
  });

  it("a prompt sent mid-turn is rejected as busy while the running turn streams to completion", async () => {
    const reply = "one two three four five";
    core = await startCoreWithReplies({ "first prompt": reply });
    const client = await connectAndAuthenticate(core, "signal", clients);

    const result = await promptInterruptedMidStreamByAnotherPrompt(client, "first prompt", "second prompt");

    assertRunningTurnCompletedDespiteBusyRejection(result, reply);
  });

  it("a prompt after the previous turn finished is accepted", async () => {
    const secondReply = "second turn reply";
    core = await startCoreWithReplies({ "first prompt": "first turn reply", "second prompt": secondReply });
    const client = await connectAndAuthenticate(core, "signal", clients);

    await promptAndAwaitDone(client, "first prompt");
    const result = await promptAndAwaitDone(client, "second prompt");

    assertStreamedReplyMatches(result, secondReply);
  });
});
