import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Context, Message } from "@earendil-works/pi-ai";
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

async function promptAndAwaitDone(client: TestClient, text: string): Promise<void> {
  sendPrompt(client, text);
  await collectUntilDone(client);
}

async function startCoreCapturingContext(
  replies: Record<string, string>,
): Promise<{ core: CoreHandle; recordedContexts: Context[] }> {
  const { streamFn, recordedContexts } = createFakeStreamFn(replies);
  const core = await startCore({ agent: { model: fakeModel, streamFn, systemPrompt: DEFAULT_SYSTEM_PROMPT } });
  return { core, recordedContexts };
}

function textOf(message: Message): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
}

function assertHistoryCarriesFirstTurnBeforeSecondPrompt(messages: Context["messages"]): void {
  const transcript = messages.map((message) => `${message.role}:${textOf(message)}`);
  assert.deepEqual(transcript, [
    `user:${FIRST_PROMPT_TEXT}`,
    `assistant:${FIRST_REPLY}`,
    `user:${SECOND_PROMPT_TEXT}`,
  ]);
}

const FIRST_PROMPT_TEXT = "hello there";
const FIRST_REPLY = "Nice to meet you.";
const SECOND_PROMPT_TEXT = "do you remember me";
const SECOND_REPLY = "I remember our first exchange.";

async function reconnectAndContinueConversation(core: CoreHandle, clients: TestClient[]): Promise<void> {
  const firstConnection = await connectAndAuthenticate(core, "signal", clients);
  await promptAndAwaitDone(firstConnection, FIRST_PROMPT_TEXT);
  firstConnection.close();

  const secondConnection = await connectAndAuthenticate(core, "signal", clients);
  await promptAndAwaitDone(secondConnection, SECOND_PROMPT_TEXT);
}

async function startCoreForReconnectScenario(): Promise<{ core: CoreHandle; recordedContexts: Context[] }> {
  return startCoreCapturingContext({
    [FIRST_PROMPT_TEXT]: FIRST_REPLY,
    [SECOND_PROMPT_TEXT]: SECOND_REPLY,
  });
}

describe("channel continuity", () => {
  let core: CoreHandle;
  let clients: TestClient[];

  beforeEach(() => {
    clients = [];
  });

  afterEach(async () => {
    for (const client of clients) client.close();
    await core.stop();
  });

  it("a reconnecting channel continues its conversation history", async () => {
    const { core: started, recordedContexts } = await startCoreForReconnectScenario();
    core = started;

    await reconnectAndContinueConversation(core, clients);

    assertHistoryCarriesFirstTurnBeforeSecondPrompt(recordedContexts[1]!.messages);
  });
});
