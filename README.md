# Telegram Music Bot

A Telegram bot built with [Telegraf](https://telegraf.js.org/) that searches
YouTube ([`yt-search`](https://www.npmjs.com/package/yt-search)), downloads audio
([`ytdl-core`](https://www.npmjs.com/package/ytdl-core)), and sends tracks to the
chat with a per-chat queue.

## Important limitation

Telegram **Bot API** bots cannot join or stream into voice chats — that requires
an MTProto *userbot* plus a calls library (e.g. `tgcalls`), which is outside the
scope of `telegraf`. This bot therefore "plays" music by sending each queued
track to the chat as an **audio file**. The `/skip`, `/pause`, `/resume`, and
`/stop` commands control that download/send queue. Telegram caps bot uploads at
50 MB, so long tracks may fail (see `MAX_DURATION_SECONDS`).

## Setup

```bash
cd musicbot
npm install
cp .env.example .env   # then edit .env and set BOT_TOKEN from @BotFather
npm start
```

## Commands

| Command            | Description                                        |
| ------------------ | -------------------------------------------------- |
| `/start`, `/help`  | Show the command list                              |
| `/play <query>`    | Search YouTube (or accept a URL) and queue a track |
| `/skip`            | Skip the current track                             |
| `/pause`           | Pause the queue (stop starting new tracks)         |
| `/resume`          | Resume a paused queue                              |
| `/stop`            | Clear the queue                                    |
| `/queue`           | Show the current queue                             |

## Configuration

| Variable               | Default | Description                              |
| ---------------------- | ------- | ---------------------------------------- |
| `BOT_TOKEN`            | —       | Required. Token from @BotFather.         |
| `MAX_DURATION_SECONDS` | `1200`  | Reject tracks longer than this.          |

## Project structure

```
musicbot/
├── index.js        # Bot entrypoint, command handlers, YouTube download/send
├── src/queue.js    # Per-chat queue manager (skip/pause/resume/stop)
├── .env.example    # Sample environment configuration
├── package.json
└── README.md
```
