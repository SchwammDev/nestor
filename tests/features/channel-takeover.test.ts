import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createFakeStreamFn, fakeModel } from "../fakes/stream-fn.ts";
import {
  startCore,
  connect,
  collectUntilDone,
  TEST_AUTH_TOKEN,
  type CoreHandle,
  type TestClient,
} from "../dsl/world.ts";

const DEFAULT_SYSTEM_PROMPT = "You are Nestor.";
const SUPERSEDED_CLOSE_CODE = 4000;

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

function assertReplyReconstructed(deltaTexts: string[], expectedReply: string): void {
  assert.equal(deltaTexts.join(""), expectedReply);
}

function assertStreamEndedWithDone(doneFrame: unknown): void {
  assert.deepEqual(doneFrame, { type: "done" });
}

async function startCoreForTakeoverScenario(reply: string): Promise<CoreHandle> {
  const { streamFn } = createFakeStreamFn({ "hi from B": reply });
  return startCore({ agent: { model: fakeModel, streamFn, systemPrompt: DEFAULT_SYSTEM_PROMPT } });
}

async function assertPromptStreamsReply(client: TestClient, text: string, expectedReply: string): Promise<void> {
  sendPrompt(client, text);
  const { deltaTexts, doneFrame } = await collectUntilDone(client);
  assertReplyReconstructed(deltaTexts, expectedReply);
  assertStreamEndedWithDone(doneFrame);
}

describe("channel takeover", () => {
  let core: CoreHandle;
  let clients: TestClient[];

  beforeEach(() => {
    clients = [];
  });

  afterEach(async () => {
    for (const client of clients) client.close();
    await core.stop();
  });

  it("a second connection for a channel supersedes the first", async () => {
    const reply = "Hello, second client.";
    core = await startCoreForTakeoverScenario(reply);
    const clientA = await connectAndAuthenticate(core, "signal", clients);

    const clientB = await connectAndAuthenticate(core, "signal", clients);
    assert.equal(await clientA.waitForClose(), SUPERSEDED_CLOSE_CODE);

    await assertPromptStreamsReply(clientB, "hi from B", reply);
  });
});
