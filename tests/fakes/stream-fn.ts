import { setImmediate } from "node:timers/promises";
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type Api,
} from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";

export const fakeModel: Model<Api> = {
  id: "fake-model",
  name: "Fake Model",
  api: "anthropic-messages",
  provider: "fake-provider",
  baseUrl: "",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100_000,
  maxTokens: 4_096,
};

const EMPTY_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

export interface ScriptedFailure {
  failureMessage: string;
}

export type ScriptedReply = string | ScriptedFailure;

export function failWith(failureMessage: string): ScriptedFailure {
  return { failureMessage };
}

function isScriptedFailure(reply: ScriptedReply): reply is ScriptedFailure {
  return typeof reply !== "string";
}

export interface FakeStream {
  streamFn: StreamFn;
  recordedContexts: Context[];
}

export function createFakeStreamFn(replies: Record<string, ScriptedReply>): FakeStream {
  const recordedContexts: Context[] = [];

  const streamFn: StreamFn = (model, context) => {
    recordedContexts.push(context);
    const stream = createAssistantMessageEventStream();
    void emitScriptedReplyWithYields(stream, model, replyFor(context, replies));
    return stream;
  };

  return { streamFn, recordedContexts };
}

function replyFor(context: Context, replies: Record<string, ScriptedReply>): ScriptedReply {
  const promptText = lastUserMessageText(context);
  return replies[promptText] ?? "";
}

export function lastUserMessageText(context: Context): string {
  const lastUserMessage = [...context.messages].reverse().find((message) => message.role === "user");
  if (!lastUserMessage) return "";
  if (typeof lastUserMessage.content === "string") return lastUserMessage.content;
  return lastUserMessage.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
}

function wordDeltas(text: string): string[] {
  return text.match(/\S+\s*|\s+/g) ?? [];
}

function baseMessage(model: Model<Api>): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: EMPTY_USAGE,
    stopReason: "pending",
    timestamp: Date.now(),
  };
}

async function emitScriptedReplyWithYields(
  stream: AssistantMessageEventStream,
  model: Model<Api>,
  reply: ScriptedReply,
): Promise<void> {
  await setImmediate();

  const start = baseMessage(model);
  stream.push({ type: "start", partial: start });

  if (isScriptedFailure(reply)) {
    await setImmediate();
    const failed: AssistantMessage = { ...start, stopReason: "error", errorMessage: reply.failureMessage };
    stream.push({ type: "error", reason: "error", error: failed });
    return;
  }

  await setImmediate();

  const textStarted: AssistantMessage = { ...start, content: [{ type: "text", text: "" }] };
  stream.push({ type: "text_start", contentIndex: 0, partial: textStarted });

  let text = "";
  for (const delta of wordDeltas(reply)) {
    await setImmediate();
    text += delta;
    const partial: AssistantMessage = { ...textStarted, content: [{ type: "text", text }] };
    stream.push({ type: "text_delta", contentIndex: 0, delta, partial });
  }

  await setImmediate();

  const textEnded: AssistantMessage = { ...textStarted, content: [{ type: "text", text }] };
  stream.push({ type: "text_end", contentIndex: 0, content: text, partial: textEnded });

  await setImmediate();

  const done: AssistantMessage = { ...textEnded, stopReason: "stop" };
  stream.push({ type: "done", reason: "stop", message: done });
}
