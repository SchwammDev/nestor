import { createModels, createProvider, type Model } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import type { Config } from "./config.ts";
import type { AgentProvision } from "./registry.ts";

export function buildAqueductProvider(config: Config): AgentProvision {
  const { baseUrl, apiKey, model: modelId } = config.aqueduct;

  const model: Model<"openai-completions"> = {
    id: modelId,
    name: `${modelId} (Aqueduct)`,
    api: "openai-completions",
    provider: "aqueduct",
    baseUrl: `${baseUrl}/v1`,
    // reasoning: true is required for thinkingFormat handling to engage at all;
    // omitting reasoningEffort per request is what actually disables Qwen thinking
    // (reasoning: false silently leaves it ON). Re-verify on pi-ai upgrades.
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 32000,
    compat: {
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      thinkingFormat: "qwen-chat-template",
    },
  };

  const provider = createProvider({
    id: "aqueduct",
    name: "Aqueduct",
    baseUrl: `${baseUrl}/v1`,
    auth: { apiKey: { name: "Aqueduct", resolve: async () => ({ auth: { apiKey } }) } },
    models: [model],
    api: openAICompletionsApi(),
  });

  const models = createModels();
  models.setProvider(provider);

  const resolvedModel = models.getModel("aqueduct", modelId);
  if (!resolvedModel) throw new Error(`Model ${modelId} not found on aqueduct provider`);

  return {
    model: resolvedModel,
    streamFn: models.streamSimple.bind(models),
    systemPrompt: config.systemPrompt,
  };
}
