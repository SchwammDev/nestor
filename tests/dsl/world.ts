import { WebSocket } from "ws";
import { startCoreServer, type CoreServer, type CoreServerOptions } from "../../src/server.ts";
import { createFakeStreamFn, fakeModel } from "../fakes/stream-fn.ts";

export const TEST_AUTH_TOKEN = "test-token";

export interface CoreHandle {
  url: string;
  httpUrl: string;
  stop(): Promise<void>;
}

function defaultAgentProvision(): CoreServerOptions["agent"] {
  return {
    model: fakeModel,
    streamFn: createFakeStreamFn({}).streamFn,
    systemPrompt: "You are a test assistant.",
  };
}

export async function startCore(overrides: Partial<CoreServerOptions> = {}): Promise<CoreHandle> {
  const server: CoreServer = await startCoreServer({
    port: 0,
    authToken: TEST_AUTH_TOKEN,
    agent: defaultAgentProvision(),
    ...overrides,
  });

  return {
    url: `ws://localhost:${server.port}`,
    httpUrl: `http://localhost:${server.port}`,
    stop: () => server.close(),
  };
}

export interface TestClient {
  send(message: unknown): void;
  sendRaw(text: string): void;
  nextMessage(): Promise<unknown>;
  waitForClose(): Promise<number>;
  close(): void;
}

export function connect(url: string): TestClient {
  const socket = new WebSocket(url);
  const outgoingQueue: string[] = [];
  const pendingMessages: unknown[] = [];
  const pendingReceivers: Array<(message: unknown) => void> = [];
  let closeCode: number | undefined;
  const closeWaiters: Array<(code: number) => void> = [];

  socket.on("open", () => {
    for (const text of outgoingQueue.splice(0)) socket.send(text);
  });

  socket.on("message", (data) => {
    const message = JSON.parse(data.toString());
    const receiver = pendingReceivers.shift();
    if (receiver) receiver(message);
    else pendingMessages.push(message);
  });

  socket.on("close", (code) => {
    closeCode = code;
    for (const waiter of closeWaiters.splice(0)) waiter(code);
  });

  function sendText(text: string): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(text);
    else outgoingQueue.push(text);
  }

  return {
    send(message: unknown): void {
      sendText(JSON.stringify(message));
    },
    sendRaw(text: string): void {
      sendText(text);
    },
    nextMessage(): Promise<unknown> {
      if (pendingMessages.length > 0) return Promise.resolve(pendingMessages.shift());
      return new Promise((resolve) => pendingReceivers.push(resolve));
    },
    waitForClose(): Promise<number> {
      if (closeCode !== undefined) return Promise.resolve(closeCode);
      return new Promise((resolve) => closeWaiters.push(resolve));
    },
    close(): void {
      socket.close();
    },
  };
}

export interface StreamedReply {
  deltaTexts: string[];
  doneFrame: unknown;
}

export async function collectUntilDone(client: TestClient): Promise<StreamedReply> {
  const deltaTexts: string[] = [];

  while (true) {
    const message = await client.nextMessage();
    const frame = message as { type: string; text?: string };
    if (frame.type === "done") return { deltaTexts, doneFrame: message };
    deltaTexts.push(frame.text ?? "");
  }
}

export interface StreamedReplyWithErrors extends StreamedReply {
  errorFrames: unknown[];
}

export async function collectUntilDoneCapturingErrors(
  client: TestClient,
  onFrame?: (frame: unknown) => void,
): Promise<StreamedReplyWithErrors> {
  const deltaTexts: string[] = [];
  const errorFrames: unknown[] = [];

  while (true) {
    const message = await client.nextMessage();
    onFrame?.(message);
    const frame = message as { type: string; text?: string };
    if (frame.type === "done") return { deltaTexts, doneFrame: message, errorFrames };
    if (frame.type === "error") {
      errorFrames.push(message);
      continue;
    }
    deltaTexts.push(frame.text ?? "");
  }
}
