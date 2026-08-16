import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hasApi, type Api, type Model } from "@earendil-works/pi-ai";
import { buildAqueductProvider } from "../../src/provider.ts";
import type { Config } from "../../src/config.ts";

function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    port: 8790,
    authToken: "test-token",
    systemPrompt: "You are a test assistant.",
    provider: {
      baseUrl: "https://aqueduct.example.com",
      apiKey: "aqueduct-key",
      model: "qwen-3.6-35b",
    },
    ...overrides,
  };
}

function assertThinkingDisabledTheQwenWay(model: Model<Api>): void {
  assert.equal(model.reasoning, true);
  if (!hasApi(model, "openai-completions")) throw new Error("expected an openai-completions model");
  assert.equal(model.compat?.thinkingFormat, "qwen-chat-template");
  assert.equal(model.compat?.supportsReasoningEffort, false);
}

describe("buildAqueductProvider", () => {
  it("the aqueduct model keeps thinking disabled the qwen way", () => {
    const provision = buildAqueductProvider(testConfig());

    assertThinkingDisabledTheQwenWay(provision.model);
  });

  it("the model streams against the configured gateway under /v1", () => {
    const provision = buildAqueductProvider(testConfig());

    assert.equal(provision.model.baseUrl, "https://aqueduct.example.com/v1");
    assert.equal(provision.model.id, "qwen-3.6-35b");
  });

  it("the provision carries the configured system prompt", () => {
    const provision = buildAqueductProvider(testConfig({ systemPrompt: "You are a pirate." }));

    assert.equal(provision.systemPrompt, "You are a pirate.");
    assert.equal(typeof provision.streamFn, "function");
  });
});
