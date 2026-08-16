import { Agent } from "@earendil-works/pi-agent-core";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";

export interface AgentProvision {
  model: Model<Api>;
  streamFn: StreamFn;
  systemPrompt: string;
}

export type DeltaSink = (text: string) => void;

export class ProviderError extends Error {}

export interface ChannelAgent {
  setSink(sink: DeltaSink): void;
  clearSink(): void;
  isBusy(): boolean;
  run(text: string): Promise<void>;
}

export interface AgentRegistry {
  getOrCreate(channelId: string): ChannelAgent;
}

const NO_SINK: DeltaSink = () => {};

export function createAgentRegistry(provision: AgentProvision): AgentRegistry {
  const channels = new Map<string, ChannelAgent>();

  return {
    getOrCreate(channelId: string): ChannelAgent {
      const existing = channels.get(channelId);
      if (existing) return existing;

      const created = createChannelAgent(provision);
      channels.set(channelId, created);
      return created;
    },
  };
}

function createChannelAgent(provision: AgentProvision): ChannelAgent {
  const agent = new Agent({
    initialState: { systemPrompt: provision.systemPrompt, model: provision.model },
    streamFn: provision.streamFn,
  });

  let sink: DeltaSink = NO_SINK;
  let busy = false;

  agent.subscribe((event) => {
    if (event.type !== "message_update") return;
    if (event.assistantMessageEvent.type !== "text_delta") return;
    sink(event.assistantMessageEvent.delta);
  });

  return {
    setSink(nextSink: DeltaSink): void {
      sink = nextSink;
    },
    clearSink(): void {
      sink = NO_SINK;
    },
    isBusy(): boolean {
      return busy;
    },
    async run(text: string): Promise<void> {
      busy = true;
      try {
        await agent.prompt(text);
        if (agent.state.errorMessage) {
          throw new ProviderError(agent.state.errorMessage);
        }
      } finally {
        busy = false;
      }
    },
  };
}
