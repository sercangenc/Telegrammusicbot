# Telegram Music Bot

A Telegram bot built with [Telegraf](https://telegraf.js.org/) that searches
YouTube ([`yt-search`](https://www.npmjs.com/package/yt-search)), downloads audio
with [`yt-dlp`](https://github.com/yt-dlp/yt-dlp) + [`ffmpeg`](https://ffmpeg.org/),
and sends tracks to the chat with a per-chat queue.

## Important limitation

Telegram **Bot API** bots cannot join or stream into voice chats — that requires
an MTProto *userbot* plus a calls library (e.g. `tgcalls`), which is outside the
scope of `telegraf`. This bot therefore "plays" music by sending each queued
track to the chat as an **audio file**. The `/skip`, `/pause`, `/resume`, and
`/stop` commands control that download/send queue. Telegram caps bot uploads at
50 MB, so long tracks may fail (see `MAX_DURATION_SECONDS`).

## Prerequisites

The bot shells out to `yt-dlp` and `ffmpeg`, so both must be installed and on
`PATH` (or pointed to via `YT_DLP_PATH` / `FFMPEG_PATH`):

```bash
# yt-dlp (pip) and ffmpeg (apt)
python3 -m pip install -U yt-dlp
sudo apt-get install -y ffmpeg
```

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
| `BOT_TOKEN`             | —            | Required. Token from @BotFather.                    |
| `MAX_DURATION_SECONDS`  | `1200`       | Reject tracks longer than this.                     |
| `YT_DLP_PATH`           | `yt-dlp`     | Path to the yt-dlp binary.                          |
| `FFMPEG_PATH`           | (PATH)       | Path to ffmpeg/ffprobe (only if not on PATH).       |
| `YT_DLP_PLAYER_CLIENT`  | `android_vr` | yt-dlp YouTube player client.                       |
| `YOUTUBE_COOKIES_FILE`  | —            | Optional. Path to a Netscape `cookies.txt`.         |

### YouTube bot-detection / cookies

YouTube blocks downloads from datacenter/cloud IPs with *"Sign in to confirm
you're not a bot"*. The default `android_vr` player client avoids most of this
(and the HTTP 403s that occur without a JS runtime). If you still hit blocks,
supply cookies from a logged-in browser session: export a Netscape
`cookies.txt` (e.g. with the *"Get cookies.txt LOCALLY"* extension) and set
`YOUTUBE_COOKIES_FILE=cookies.txt`.

## Project structure

```
musicbot/
├── index.js        # Bot entrypoint, command handlers, yt-dlp download/send
├── src/queue.js    # Per-chat queue manager (skip/pause/resume/stop)
├── .env.example    # Sample environment configuration
├── package.json
└── README.md
```
