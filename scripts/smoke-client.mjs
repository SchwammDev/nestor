// Throwaway smoke-test client. The Signal adapter is the first real client;
// this script exists only to prove the daemon end-to-end from the CLI.
import { WebSocket } from "ws";

function usageAndExit() {
  console.error("usage: NESTOR_TOKEN=<token> node scripts/smoke-client.mjs <ws-url> <channel> <prompt text>");
  process.exit(2);
}

function parseArgs() {
  const [wsUrl, channel, ...promptParts] = process.argv.slice(2);
  const token = process.env.NESTOR_TOKEN;

  if (!wsUrl || !channel || promptParts.length === 0 || !token) usageAndExit();

  return { wsUrl, channel, token, promptText: promptParts.join(" ") };
}

function runSmokeClient({ wsUrl, channel, token, promptText }) {
  const socket = new WebSocket(wsUrl);
  let done = false;

  socket.on("open", () => {
    socket.send(JSON.stringify({ type: "hello", token, channel }));
  });

  socket.on("message", (data) => {
    const frame = JSON.parse(data.toString());

    if (frame.type === "ready") {
      socket.send(JSON.stringify({ type: "prompt", text: promptText }));
      return;
    }

    if (frame.type === "delta") {
      process.stdout.write(frame.text);
      return;
    }

    if (frame.type === "done") {
      done = true;
      process.stdout.write("\n");
      socket.close();
      process.exit(0);
    }

    if (frame.type === "error") {
      console.error(frame.message);
      socket.close();
      process.exit(1);
    }
  });

  socket.on("close", () => {
    if (!done) process.exit(1);
  });

  socket.on("error", (error) => {
    console.error(error.message);
    process.exit(1);
  });
}

runSmokeClient(parseArgs());
