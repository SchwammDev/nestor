import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createFakeStreamFn, fakeModel, failWith, type ScriptedReply } from "../fakes/stream-fn.ts";
import {
  startCore,
  connect,
  collectUntilDone,
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

async function startCoreWithReplies(replies: Record<string, ScriptedReply>): Promise<CoreHandle> {
  const { streamFn } = createFakeStreamFn(replies);
  return startCore({ agent: { model: fakeModel, streamFn, systemPrompt: DEFAULT_SYSTEM_PROMPT } });
}

function assertErrorFrame(message: unknown, expectedCode: string): void {
  const frame = message as { type: string; code: string; message: string };
  assert.equal(frame.type, "error");
  assert.equal(frame.code, expectedCode);
  assert.equal(typeof frame.message, "string");
}

async function assertSocketStillUsable(client: TestClient, promptText: string, expectedReply: string): Promise<void> {
  const { deltaTexts, doneFrame } = await promptAndAwaitDone(client, promptText);
  assert.equal(deltaTexts.join(""), expectedReply);
  assert.deepEqual(doneFrame, { type: "done" });
}

const RECOVERY_REPLY = "Recovered fine.";
const FAILING_AND_RECOVERY_REPLIES = {
  "cause a failure": failWith("upstream exploded"),
  "try again": RECOVERY_REPLY,
};

describe("protocol errors after auth", () => {
  let core: CoreHandle;
  let clients: TestClient[];

  beforeEach(() => {
    clients = [];
  });

  afterEach(async () => {
    for (const client of clients) client.close();
    await core.stop();
  });

  it("invalid JSON is rejected without closing the connection", async () => {
    core = await startCoreWithReplies({ "hi again": "Still here." });
    const client = await connectAndAuthenticate(core, "signal", clients);

    client.sendRaw("not json");

    assertErrorFrame(await client.nextMessage(), "invalid_json");
    await assertSocketStillUsable(client, "hi again", "Still here.");
  });

  it("an unrecognized frame type is rejected without closing the connection", async () => {
    core = await startCoreWithReplies({});
    const client = await connectAndAuthenticate(core, "signal", clients);

    client.send({ type: "cancel" });

    assertErrorFrame(await client.nextMessage(), "unknown_type");
  });

  it("a provider failure surfaces as provider_error and leaves the channel usable", async () => {
    core = await startCoreWithReplies(FAILING_AND_RECOVERY_REPLIES);
    const client = await connectAndAuthenticate(core, "signal", clients);
    sendPrompt(client, "cause a failure");

    assertErrorFrame(await client.nextMessage(), "provider_error");

    await assertSocketStillUsable(client, "try again", RECOVERY_REPLY);
  });
});
