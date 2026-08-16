import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { startCore, connect, TEST_AUTH_TOKEN, type CoreHandle, type TestClient } from "../dsl/world.ts";

const AUTH_FAILED_CLOSE_CODE = 4401;

function assertReady(message: unknown): void {
  assert.deepEqual(message, { type: "ready" });
}

function assertAuthFailed(message: unknown): void {
  const errorMessage = message as { type: string; code: string };
  assert.equal(errorMessage.type, "error");
  assert.equal(errorMessage.code, "auth_failed");
}

async function assertRejectedWithAuthFailed(client: TestClient): Promise<void> {
  const reply = await client.nextMessage();
  const closeCode = await client.waitForClose();

  assertAuthFailed(reply);
  assert.equal(closeCode, AUTH_FAILED_CLOSE_CODE);
}

async function assertClosedWithoutErrorFrame(client: TestClient): Promise<void> {
  const closeCode = await client.waitForClose();

  assert.equal(closeCode, AUTH_FAILED_CLOSE_CODE);
}

function sendHello(client: TestClient, hello: Record<string, unknown>): void {
  client.send({ type: "hello", ...hello });
}

describe("core server authentication", () => {
  let core: CoreHandle;
  let clients: TestClient[];

  beforeEach(() => {
    clients = [];
  });

  afterEach(async () => {
    for (const client of clients) client.close();
    await core.stop();
  });

  async function startCoreForTest(overrides?: Parameters<typeof startCore>[0]): Promise<CoreHandle> {
    core = await startCore(overrides);
    return core;
  }

  function connectClient(handle: CoreHandle): TestClient {
    const client = connect(handle.url);
    clients.push(client);
    return client;
  }

  it("a correct hello is answered with ready", async () => {
    const client = connectClient(await startCoreForTest());

    sendHello(client, { token: TEST_AUTH_TOKEN, channel: "signal" });

    assertReady(await client.nextMessage());
  });

  it("a wrong token is rejected with auth_failed and the connection is closed with 4401", async () => {
    const client = connectClient(await startCoreForTest());

    sendHello(client, { token: "wrong-token", channel: "signal" });

    await assertRejectedWithAuthFailed(client);
  });

  it("a first frame that is not hello closes the connection with 4401", async () => {
    const client = connectClient(await startCoreForTest());

    client.send({ type: "prompt", text: "hi" });

    await assertClosedWithoutErrorFrame(client);
  });

  it("invalid JSON as the first frame closes the connection with 4401", async () => {
    const client = connectClient(await startCoreForTest());

    client.sendRaw("not json");

    await assertClosedWithoutErrorFrame(client);
  });

  it("a client that never sends hello is disconnected after the auth timeout", async () => {
    const client = connectClient(await startCoreForTest({ authTimeoutMs: 50 }));

    await assertClosedWithoutErrorFrame(client);
  });
});
