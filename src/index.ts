import { loadConfig } from "./config.ts";
import { buildAqueductProvider } from "./provider.ts";
import { startCoreServer } from "./server.ts";

const config = loadConfig();
const provision = buildAqueductProvider(config);
const server = await startCoreServer({ port: config.port, authToken: config.authToken, agent: provision });

console.log(`nestor listening on ws://127.0.0.1:${server.port}`);

async function shutdown(): Promise<void> {
  await server.close();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
