import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { del, get, post, push, text } from "./line.js";
import { admin } from "./db.js";

export const VERSION = "0.2.0";

type Result = { content: { type: "text"; text: string }[]; isError?: boolean };

function run(fn: () => Promise<unknown>): Promise<Result> {
  return fn().then(
    (value) => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }] }),
    (error) => ({
      content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
      isError: true,
    })
  );
}

// LINE IDs are a type prefix plus 32 hex chars; validating them keeps arbitrary text out of API paths.
export const userId = z.string().regex(/^U[0-9a-f]{32}$/, "LINE userId: U followed by 32 hex characters");
export const pushTarget = z
  .string()
  .regex(/^[UCR][0-9a-f]{32}$/, "LINE userId (U...), groupId (C...) or roomId (R...) with 32 hex characters");
export const richMenuId = z.string().regex(/^richmenu-[0-9a-f]{32}$/, "richmenu- followed by 32 hex characters");

const lineRead = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;
const dbRead = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

function yesterdayInJapan(): string {
  const jst = new Date(Date.now() + 9 * 3600_000 - 24 * 3600_000);
  return jst.toISOString().slice(0, 10).replace(/-/g, "");
}

export function createServer(env: NodeJS.ProcessEnv = process.env): McpServer {
  const server = new McpServer({ name: "line-bot-ops-mcp", version: VERSION });

  server.registerTool(
    "line_bot_info",
    {
      title: "Bot info",
      description: "Basic info about the LINE Official Account this bot runs on: display name, basic ID, chat mode.",
      inputSchema: {},
      annotations: lineRead,
    },
    () => run(() => get("/info"))
  );

  server.registerTool(
    "line_message_quota",
    {
      title: "Message quota",
      description: "Monthly push/broadcast message quota and how much of it has been used this month.",
      inputSchema: {},
      annotations: lineRead,
    },
    () =>
      run(async () => ({
        quota: await get("/message/quota"),
        consumption: await get("/message/quota/consumption"),
      }))
  );

  server.registerTool(
    "line_followers_insight",
    {
      title: "Follower insight",
      description:
        "Follower statistics for one day: followers, targeted reaches, blocks. LINE computes these per day in UTC+9 and only after the day ends.",
      inputSchema: {
        date: z
          .string()
          .regex(/^\d{8}$/)
          .optional()
          .describe("yyyyMMdd in UTC+9. Defaults to yesterday."),
      },
      annotations: lineRead,
    },
    ({ date }) => run(() => get(`/insight/followers?date=${date ?? yesterdayInJapan()}`))
  );

  server.registerTool(
    "line_get_profile",
    {
      title: "User profile",
      description: "Display name, picture and status message of a user who has added the bot as a friend.",
      inputSchema: { userId },
      annotations: lineRead,
    },
    ({ userId }) => run(() => get(`/profile/${userId}`))
  );

  server.registerTool(
    "line_richmenu_list",
    {
      title: "List Rich Menus",
      description: "All Rich Menus on the channel, plus which one is the default for every user.",
      inputSchema: {},
      annotations: lineRead,
    },
    () =>
      run(async () => {
        const { richmenus } = await get<{ richmenus: { richMenuId: string; name: string; chatBarText: string }[] }>(
          "/richmenu/list"
        );
        const defaultId = await get<{ richMenuId: string }>("/user/all/richmenu").then(
          (r) => r.richMenuId,
          () => null
        );
        return richmenus.map((m) => ({
          richMenuId: m.richMenuId,
          name: m.name,
          chatBarText: m.chatBarText,
          isDefault: m.richMenuId === defaultId,
        }));
      })
  );

  server.registerTool(
    "line_queue_health",
    {
      title: "Queue health",
      description:
        "Health of the webhook job queue (line_jobs): count per status, age of the oldest pending job, and jobs stuck in processing. Use this first when users say the bot is not replying.",
      inputSchema: {},
      annotations: dbRead,
    },
    () =>
      run(async () => {
        const db = admin();
        const statuses = ["pending", "processing", "done", "failed"] as const;
        const counts: Record<string, number> = {};
        for (const status of statuses) {
          const { count, error } = await db
            .from("line_jobs")
            .select("id", { count: "exact", head: true })
            .eq("status", status);
          if (error) throw new Error(error.message);
          counts[status] = count ?? 0;
        }

        const { data: oldest } = await db
          .from("line_jobs")
          .select("created_at")
          .eq("status", "pending")
          .order("created_at")
          .limit(1);

        const stuckBefore = new Date(Date.now() - 5 * 60_000).toISOString();
        const { count: stuck } = await db
          .from("line_jobs")
          .select("id", { count: "exact", head: true })
          .eq("status", "processing")
          .lt("claimed_at", stuckBefore);

        const oldestPending = oldest?.[0]?.created_at ?? null;
        return {
          counts,
          oldestPending,
          oldestPendingAgeSeconds: oldestPending
            ? Math.round((Date.now() - new Date(oldestPending).getTime()) / 1000)
            : null,
          stuckProcessing: stuck ?? 0,
        };
      })
  );

  server.registerTool(
    "line_failed_jobs",
    {
      title: "Failed jobs",
      description: "Most recent failed jobs with their error, event type and message text.",
      inputSchema: { limit: z.number().int().min(1).max(50).default(10) },
      annotations: dbRead,
    },
    ({ limit }) =>
      run(async () => {
        const { data, error } = await admin()
          .from("line_jobs")
          .select("id, attempts, last_error, created_at, finished_at, payload")
          .eq("status", "failed")
          .order("finished_at", { ascending: false })
          .limit(limit);
        if (error) throw new Error(error.message);
        return (data ?? []).map(({ payload, ...job }) => ({
          ...job,
          eventType: payload?.type,
          userId: payload?.source?.userId,
          text: payload?.message?.text,
        }));
      })
  );

  server.registerTool(
    "line_find_users",
    {
      title: "Find users",
      description: "Search linked users (line_users) by display name and/or role.",
      inputSchema: {
        name: z.string().max(100).optional().describe("Case-insensitive substring of display_name"),
        role: z.string().max(50).optional(),
        limit: z.number().int().min(1).max(100).default(20),
      },
      annotations: dbRead,
    },
    ({ name, role, limit }) =>
      run(async () => {
        let query = admin()
          .from("line_users")
          .select("line_user_id, display_name, role, created_at")
          .order("created_at", { ascending: false })
          .limit(limit);
        if (name) query = query.ilike("display_name", `%${name.replace(/[\\%_]/g, "\\$&")}%`);
        if (role) query = query.eq("role", role);
        const { data, error } = await query;
        if (error) throw new Error(error.message);
        return data;
      })
  );

  server.registerTool(
    "line_retry_job",
    {
      title: "Retry failed job",
      description:
        "Put a failed job back to pending so the next worker run picks it up. Overwrites the job's recorded error. Reply tokens expire soon after the event, so a job that replies may fail again; push is the fallback.",
      inputSchema: { jobId: z.string().uuid() },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    ({ jobId }) =>
      run(async () => {
        const { data, error } = await admin()
          .from("line_jobs")
          .update({ status: "pending", last_error: null, finished_at: null })
          .eq("id", jobId)
          .eq("status", "failed")
          .select("id, status");
        if (error) throw new Error(error.message);
        if (!data?.length) throw new Error(`No failed job with id ${jobId}`);
        return data[0];
      })
  );

  server.registerTool(
    "line_push_text",
    {
      title: "Push text",
      description:
        "Send a text message to one user, group or room. Counts against the monthly message quota and cannot be unsent.",
      inputSchema: {
        to: pushTarget,
        message: z.string().min(1).max(5000),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    ({ to, message }) =>
      run(async () => {
        await push(to, [text(message)]);
        return { sent: true, to };
      })
  );

  server.registerTool(
    "line_link_richmenu",
    {
      title: "Link Rich Menu to user",
      description:
        "Show a specific Rich Menu to one user, e.g. after a role change. Pass richMenuId null to remove the per-user menu so the default shows again.",
      inputSchema: {
        userId,
        richMenuId: richMenuId.nullable(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    ({ userId, richMenuId }) =>
      run(async () => {
        if (richMenuId) await post(`/user/${userId}/richmenu/${richMenuId}`);
        else await del(`/user/${userId}/richmenu`);
        return { userId, richMenuId };
      })
  );

  if (env.LINE_MCP_ALLOW_BROADCAST === "true") {
    server.registerTool(
      "line_broadcast",
      {
        title: "Broadcast to all friends",
        description:
          "Send a text message to EVERY friend of the account. Uses one message of quota per recipient and cannot be undone.",
        inputSchema: { message: z.string().min(1).max(5000) },
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
      },
      ({ message }) =>
        run(async () => {
          await post("/message/broadcast", { messages: [text(message)] });
          return { broadcast: true };
        })
    );
  }

  return server;
}
