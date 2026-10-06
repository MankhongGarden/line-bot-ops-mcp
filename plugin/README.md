# LINE Bot Ops (Claude Code plugin)

Operate your own LINE bot from Claude Code. Ask *why the bot stopped replying*, see the failed
jobs in its webhook queue and put them back, check push quota and followers, and switch a user's
Rich Menu, without leaving the terminal.

The plugin bundles:

- **The `line-bot-ops` MCP server** ([line-bot-ops-mcp](https://github.com/MankhongGarden/line-bot-ops-mcp),
  pinned to `0.2.0` and started with `npx`). Tool list and safety notes are in that README.
- **`line-bot-triage` skill**: a step-by-step diagnosis for a bot that is silent, slow or replies twice.
- **`new-line-bot` skill**: starts a new bot with [create-line-bot](https://github.com/MankhongGarden/create-line-bot),
  whose queue the tools can read.

## Where it works

The MCP server runs locally, so the tools work in Claude Code (and in Cowork sessions that run on
your computer). On claude.ai chat only the skills load.

## Settings

Claude Code asks for these when you enable the plugin. Secrets go to your system's credential store.

| Setting | Needed for |
|---|---|
| LINE channel access token | LINE tools (profile, quota, insight, push, Rich Menu) |
| Supabase URL + service role key | Queue tools (`line_queue_health`, `line_failed_jobs`, `line_retry_job`, `line_find_users`). Leave empty if your bot has no queue |
| Allow broadcast | Off by default. Turning it on registers `line_broadcast`, which messages every friend |

## What it runs and where data goes

- On first use, `npx` downloads `line-bot-ops-mcp@0.2.0` and its dependencies from the public npm
  registry and runs it on your machine.
- When a tool is called, the server talks to exactly two places: `https://api.line.me` with your
  channel access token, and your own Supabase URL with your service role key.
- Tool results (profiles, failed job payloads, message text) are returned to Claude.
- The maintainer runs no server and collects nothing. Details: [PRIVACY.md](https://github.com/MankhongGarden/line-bot-ops-mcp/blob/main/PRIVACY.md).

## License

MIT
