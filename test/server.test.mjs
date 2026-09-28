import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../dist/server.js";

const USER = "U" + "a".repeat(32);
const MENU = "richmenu-" + "b".repeat(32);
const HINTS = ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"];

async function connect(env = {}) {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer(env).connect(serverSide);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientSide);
  return client;
}

let calls;
const realFetch = globalThis.fetch;

beforeEach(() => {
  calls = [];
  process.env.LINE_CHANNEL_ACCESS_TOKEN = "test-token";
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

test("registers 11 tools and hides broadcast by default", async () => {
  const { tools } = await (await connect()).listTools();
  assert.equal(tools.length, 11);
  assert.ok(!tools.some((t) => t.name === "line_broadcast"));
});

test("broadcast only appears when LINE_MCP_ALLOW_BROADCAST=true", async () => {
  const { tools } = await (await connect({ LINE_MCP_ALLOW_BROADCAST: "true" })).listTools();
  assert.equal(tools.length, 12);
  assert.ok(tools.some((t) => t.name === "line_broadcast"));
});

test("every tool declares a title, an input schema and all four hints", async () => {
  const { tools } = await (await connect({ LINE_MCP_ALLOW_BROADCAST: "true" })).listTools();
  for (const tool of tools) {
    assert.ok(tool.annotations?.title ?? tool.title, `${tool.name} has no title`);
    assert.equal(tool.inputSchema?.type, "object", `${tool.name} has no input schema`);
    for (const hint of HINTS) {
      assert.equal(typeof tool.annotations?.[hint], "boolean", `${tool.name} is missing ${hint}`);
    }
  }
});

test("tools that change state are not marked read-only", async () => {
  const { tools } = await (await connect({ LINE_MCP_ALLOW_BROADCAST: "true" })).listTools();
  const byName = Object.fromEntries(tools.map((t) => [t.name, t.annotations]));
  for (const name of ["line_retry_job", "line_link_richmenu", "line_broadcast"]) {
    assert.equal(byName[name].readOnlyHint, false, name);
    assert.equal(byName[name].destructiveHint, true, name);
  }
  assert.equal(byName.line_push_text.readOnlyHint, false);
});

test("rejects a malformed userId before any network call", async () => {
  const client = await connect();
  const result = await client.callTool({ name: "line_get_profile", arguments: { userId: "U123/../../message/broadcast" } });
  assert.equal(result.isError, true);
  assert.equal(calls.length, 0);
});

test("rejects a malformed push target and rich menu id", async () => {
  const client = await connect();
  const push = await client.callTool({ name: "line_push_text", arguments: { to: "someone", message: "hi" } });
  const link = await client.callTool({ name: "line_link_richmenu", arguments: { userId: USER, richMenuId: "x/y" } });
  assert.equal(push.isError, true);
  assert.equal(link.isError, true);
  assert.equal(calls.length, 0);
});

test("the channel token is only sent to api.line.me", async () => {
  const client = await connect();
  await client.callTool({ name: "line_get_profile", arguments: { userId: USER } });
  await client.callTool({ name: "line_link_richmenu", arguments: { userId: USER, richMenuId: MENU } });
  await client.callTool({ name: "line_push_text", arguments: { to: USER, message: "hi" } });
  assert.equal(calls.length, 3);
  for (const { url, init } of calls) {
    assert.equal(new URL(url).origin, "https://api.line.me");
    assert.equal(init.headers.authorization, "Bearer test-token");
  }
  assert.equal(calls[0].url, `https://api.line.me/v2/bot/profile/${USER}`);
  assert.equal(calls[1].url, `https://api.line.me/v2/bot/user/${USER}/richmenu/${MENU}`);
});

test("reports a missing token as a tool error, not a crash", async () => {
  delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const result = await (await connect()).callTool({ name: "line_bot_info", arguments: {} });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /LINE_CHANNEL_ACCESS_TOKEN/);
  assert.equal(calls.length, 0);
});

test("database tools fail cleanly without Supabase credentials", async () => {
  for (const name of ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) delete process.env[name];
  const result = await (await connect()).callTool({ name: "line_queue_health", arguments: {} });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /SUPABASE/);
});
