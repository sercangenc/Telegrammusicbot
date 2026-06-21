# Telegram Music Bot

A Telegram bot built with [Telegraf](https://telegraf.js.org/) that searches
YouTube ([`yt-search`](https://www.npmjs.com/package/yt-search)), downloads audio
([`@distube/ytdl-core`](https://www.npmjs.com/package/@distube/ytdl-core)), and
sends tracks to the chat with a per-chat queue.

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

| Variable               | Default | Description                                            |
| ---------------------- | ------- | ------------------------------------------------------ |
| `BOT_TOKEN`            | —       | Required. Token from @BotFather.                       |
| `MAX_DURATION_SECONDS` | `1200`  | Reject tracks longer than this.                        |
| `YOUTUBE_COOKIES`      | —       | Optional. Inline JSON array of YouTube cookies.        |
| `YOUTUBE_COOKIES_FILE` | —       | Optional. Path to a JSON file of YouTube cookies.      |

### YouTube bot-detection / cookies

YouTube blocks downloads from datacenter/cloud IPs with *"Sign in to confirm
you're not a bot"*. To work around it, supply cookies from a logged-in browser
session. Export them as a JSON array (e.g. with the *"Get cookies.txt LOCALLY"*
extension) and either set `YOUTUBE_COOKIES_FILE=cookies.json` or paste the JSON
inline into `YOUTUBE_COOKIES`. Without cookies, search and queue commands still
work but the actual audio download may fail from such IPs.

## Project structure

```
musicbot/
├── index.js        # Bot entrypoint, command handlers, YouTube download/send
├── src/queue.js    # Per-chat queue manager (skip/pause/resume/stop)
├── .env.example    # Sample environment configuration
├── package.json
└── README.md
```
