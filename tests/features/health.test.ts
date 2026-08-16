import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { startCore, type CoreHandle } from "../dsl/world.ts";

async function fetchFromCore(handle: CoreHandle, path: string): Promise<Response> {
  return fetch(`${handle.httpUrl}${path}`);
}

describe("core server health endpoint", () => {
  let core: CoreHandle;

  afterEach(async () => {
    await core.stop();
  });

  it("responds to GET /healthz with 200 ok", async () => {
    core = await startCore();

    const response = await fetchFromCore(core, "/healthz");

    assert.equal(response.status, 200);
    assert.equal(await response.text(), "ok");
  });

  it("responds to an unknown path with 404", async () => {
    core = await startCore();

    const response = await fetchFromCore(core, "/nope");

    assert.equal(response.status, 404);
  });
});
