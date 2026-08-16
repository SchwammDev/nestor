import { createServer, type Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import { createAgentRegistry, type AgentProvision, type AgentRegistry } from "./registry.ts";

export interface CoreServerOptions {
  port: number;
  authToken: string;
  authTimeoutMs?: number;
  agent: AgentProvision;
}

export interface CoreServer {
  port: number;
  close(): Promise<void>;
}

const DEFAULT_AUTH_TIMEOUT_MS = 10_000;
const AUTH_FAILED_CLOSE_CODE = 4401;

type HelloFrame = { type: "hello"; token: string; channel: string };
type PromptFrame = { type: "prompt"; text: string };

export function startCoreServer(options: CoreServerOptions): Promise<CoreServer> {
  const authTimeoutMs = options.authTimeoutMs ?? DEFAULT_AUTH_TIMEOUT_MS;
  const httpServer = createServer();
  const wss = new WebSocketServer({ server: httpServer });
  const registry = createAgentRegistry(options.agent);
  const channelOwners = new Map<string, WebSocket>();

  wss.on("connection", (socket) => {
    authenticateConnection(socket, options.authToken, authTimeoutMs, registry, channelOwners);
  });

  return new Promise((resolve) => {
    httpServer.listen(options.port, () => {
      resolve({
        port: resolvePort(httpServer),
        close: () => closeServer(httpServer, wss),
      });
    });
  });
}

function authenticateConnection(
  socket: WebSocket,
  authToken: string,
  authTimeoutMs: number,
  registry: AgentRegistry,
  channelOwners: Map<string, WebSocket>,
): void {
  const authTimeout = setTimeout(() => socket.close(AUTH_FAILED_CLOSE_CODE), authTimeoutMs);

  socket.once("message", (data) => {
    clearTimeout(authTimeout);
    handleFirstFrame(socket, data, authToken, registry, channelOwners);
  });
}

function handleFirstFrame(
  socket: WebSocket,
  data: RawData,
  authToken: string,
  registry: AgentRegistry,
  channelOwners: Map<string, WebSocket>,
): void {
  const hello = parseHelloFrame(data);

  if (hello && hello.token === authToken && hello.channel.length > 0) {
    socket.send(JSON.stringify({ type: "ready" }));
    attachChannel(socket, registry.getOrCreate(hello.channel), hello.channel, channelOwners);
    return;
  }

  rejectAuth(socket, hello === undefined ? "malformed first frame" : "invalid token or channel");
}

function attachChannel(
  socket: WebSocket,
  channelAgent: ReturnType<AgentRegistry["getOrCreate"]>,
  channelId: string,
  channelOwners: Map<string, WebSocket>,
): void {
  channelOwners.set(channelId, socket);
  channelAgent.setSink((text) => socket.send(JSON.stringify({ type: "delta", text })));

  socket.on("message", (data) => {
    const prompt = parsePromptFrame(data);
    if (!prompt) return;
    void channelAgent.run(prompt.text).then(() => socket.send(JSON.stringify({ type: "done" })));
  });

  socket.on("close", () => {
    if (channelOwners.get(channelId) !== socket) return;
    channelAgent.clearSink();
    channelOwners.delete(channelId);
  });
}

function parsePromptFrame(data: RawData): PromptFrame | undefined {
  let frame: unknown;
  try {
    frame = JSON.parse(data.toString());
  } catch {
    return undefined;
  }

  if (!isPromptFrame(frame)) return undefined;
  return frame;
}

function isPromptFrame(frame: unknown): frame is PromptFrame {
  if (typeof frame !== "object" || frame === null) return false;
  const candidate = frame as Record<string, unknown>;
  return candidate.type === "prompt" && typeof candidate.text === "string";
}

function parseHelloFrame(data: RawData): HelloFrame | undefined {
  let frame: unknown;
  try {
    frame = JSON.parse(data.toString());
  } catch {
    return undefined;
  }

  if (!isHelloFrame(frame)) return undefined;
  return frame;
}

function isHelloFrame(frame: unknown): frame is HelloFrame {
  if (typeof frame !== "object" || frame === null) return false;
  const candidate = frame as Record<string, unknown>;
  return (
    candidate.type === "hello" &&
    typeof candidate.token === "string" &&
    typeof candidate.channel === "string"
  );
}

function rejectAuth(socket: WebSocket, message: string): void {
  socket.send(JSON.stringify({ type: "error", code: "auth_failed", message }));
  socket.close(AUTH_FAILED_CLOSE_CODE);
}

function resolvePort(httpServer: HttpServer): number {
  const address = httpServer.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected the http server to be bound to a network address");
  }
  return address.port;
}

function closeServer(httpServer: HttpServer, wss: WebSocketServer): Promise<void> {
  for (const client of wss.clients) client.terminate();

  return new Promise((resolve, reject) => {
    wss.close(() => {
      httpServer.close((error) => (error ? reject(error) : resolve()));
    });
  });
}
