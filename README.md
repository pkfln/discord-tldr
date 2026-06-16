# discord-tldr

A small Discord bot that adds `/tldr` for summarizing recent channel activity with an OpenAI-compatible chat completions API.

## Features

- Bun + strict TypeScript
- `discord.js` v14
- Configurable OpenAI-compatible LLM provider
- Slash command modes:
  - `since_last_message`: messages after your most recent message in the channel
  - `since_timestamp`: messages after an ISO, Unix, or Discord timestamp
  - `last_messages`: last N messages
- In-memory per-user and per-channel rate limiting
- Bounded message scans and prompt sizes for cost control
- Optional Dockerfile

## Discord Setup

1. Open the [Discord Developer Portal](https://discord.com/developers/applications).
2. Create an application.
3. Go to **Bot** and create a bot.
4. Copy the bot token into `DISCORD_TOKEN`.
5. Enable **Message Content Intent** under privileged gateway intents. This is required because the bot must read normal message content to summarize it.
6. Go to **OAuth2 > URL Generator**.
7. Select scopes:
   - `bot`
   - `applications.commands`
8. Select bot permissions:
   - View Channels
   - Read Message History
   - Send Messages
9. Open the generated URL and invite the bot to your server.
10. Copy the application ID into `DISCORD_CLIENT_ID`.

## LLM Setup

Create an API key for an OpenAI-compatible provider and set it as `LLM_API_KEY`.

The default API URL is OpenAI:

```sh
LLM_API_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini
```

For OpenRouter:

```sh
LLM_API_URL=https://openrouter.ai/api/v1
LLM_MODEL=openrouter/free
```

For Groq:

```sh
LLM_API_URL=https://api.groq.com/openai/v1
LLM_MODEL=llama-3.1-8b-instant
```

## Configuration

Copy the example env file:

```sh
cp .env.example .env
```

Fill in:

```sh
DISCORD_TOKEN=your_bot_token
DISCORD_CLIENT_ID=your_application_id
LLM_API_KEY=your_llm_api_key
```

Optional limits:

```sh
USER_RATE_LIMIT=3
USER_RATE_WINDOW_MINUTES=15
USER_DAILY_LIMIT=25
CHANNEL_COOLDOWN_SECONDS=30
MAX_SCAN_MESSAGES=500
MAX_PROMPT_MESSAGES=300
ADMIN_USER_ID=
DISCORD_GUILD_ID=
LLM_API_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini
LLM_TEMPERATURE=0.2
```

`ADMIN_USER_ID` bypasses per-user limits, but the channel cooldown still protects shared channels from spam.
`DISCORD_GUILD_ID` is optional. If set, command registration targets that guild for faster development updates. If omitted, command registration is global and works in any guild where the bot is installed.

## Install

```sh
bun install
```

## Register Slash Commands

This registers `/tldr` globally by default:

```sh
bun run register
```

Global command updates can take a while to appear in Discord. For faster development in one server, set `DISCORD_GUILD_ID` before running `bun run register`; the script will register the command only in that guild.

## Run Locally

```sh
bun run start
```

Development mode:

```sh
bun run dev
```

Typecheck:

```sh
bun run typecheck
```

## Docker

Build and run:

```sh
docker build -t discord-tldr .
docker run --env-file .env discord-tldr
```

## Command Usage

Default:

```text
/tldr
```

After a timestamp:

```text
/tldr mode:since_timestamp timestamp:2026-05-21T10:00:00Z
```

Last 100 messages:

```text
/tldr mode:last_messages count:100
```


## Limitations

- Discord bots cannot see Discord's client-side unread marker.
- `since_last_message` means "messages after your most recent sent message in this channel."
- Very long histories are capped by `MAX_SCAN_MESSAGES` and `MAX_PROMPT_MESSAGES` for cost control.
- Rate limit state is in memory, so it resets when the process restarts.
