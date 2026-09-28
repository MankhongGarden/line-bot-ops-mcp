# Privacy Policy

Last updated: 2026-09-28

line-bot-ops-mcp is a local MCP server. It runs on your machine, inside the MCP client you start it
from, with credentials you supply through environment variables.

## What it collects

Nothing. The maintainer operates no server, analytics, telemetry or crash reporting for this
package, and receives no data from it.

## Where your data goes

When a tool is called, the server talks to exactly two places:

| Destination | What is sent | Why |
| --- | --- | --- |
| `https://api.line.me` | Your `LINE_CHANNEL_ACCESS_TOKEN` and the tool's arguments (user IDs, message text, Rich Menu IDs) | To read or act on your LINE Official Account |
| Your own `SUPABASE_URL` | Your `SUPABASE_SERVICE_ROLE_KEY` and queries on `line_jobs` / `line_users` | To read queue health, failed jobs and linked users, and to retry jobs |

Tool results (for example profiles, failed job payloads and message text from your bot's users) are
returned to your MCP client, and from there to whatever AI model that client uses. That model
provider's own privacy policy applies to what it receives.

## Your users' data

Data about the people who message your bot belongs to your LINE Official Account and your Supabase
project. You are the controller of that data; this package only reads or changes it when you call
a tool.

## Contact

Open an issue at https://github.com/MankhongGarden/line-bot-ops-mcp/issues.
