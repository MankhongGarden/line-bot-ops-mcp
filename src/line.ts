import { requireEnv } from "./env.js";

const API = "https://api.line.me/v2/bot";

async function call(path: string, body?: unknown, method = "POST") {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${requireEnv("LINE_CHANNEL_ACCESS_TOKEN")}`,
    },
    body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
  });
  if (!res.ok) {
    throw new Error(`LINE ${path} ${res.status}: ${await res.text()}`);
  }
  return res;
}

export async function get<T = unknown>(path: string): Promise<T> {
  const res = await call(path, undefined, "GET");
  return res.json() as Promise<T>;
}

export function post(path: string, body?: unknown) {
  return call(path, body);
}

export function del(path: string) {
  return call(path, undefined, "DELETE");
}

export function push(to: string, messages: unknown[]) {
  return call("/message/push", { to, messages });
}

export function text(value: string) {
  return { type: "text", text: value };
}
