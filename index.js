'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { Telegraf } = require('telegraf');
const ytSearch = require('yt-search');

const { MusicQueueManager } = require('./src/queue');

// ---------------------------------------------------------------------------
// Minimal .env loader (avoids an extra dependency). Existing process.env wins.
// ---------------------------------------------------------------------------
function loadEnv(file) {
  const full = path.resolve(__dirname, file);
  if (!fs.existsSync(full)) return;
  const text = fs.readFileSync(full, 'utf8');
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnv('.env');

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error(
    'Missing BOT_TOKEN. Copy .env.example to .env and set BOT_TOKEN (from @BotFather).'
  );
  process.exit(1);
}

// Telegram bot uploads are capped at 50 MB. Skip anything obviously too long.
const MAX_DURATION_SECONDS = Number(process.env.MAX_DURATION_SECONDS || 60 * 20);

// Audio is downloaded with yt-dlp (robust against YouTube changes) and converted
// with ffmpeg. Both must be installed and on PATH (override paths if needed).
const YT_DLP = process.env.YT_DLP_PATH || 'yt-dlp';
// Only override ffmpeg discovery when explicitly configured; otherwise yt-dlp
// finds ffmpeg/ffprobe on PATH on its own.
const FFMPEG_LOCATION = process.env.FFMPEG_PATH || null;
// The android_vr client serves formats that don't require JS-based signature
// deciphering, avoiding HTTP 403s when no JS runtime is installed.
const YT_DLP_PLAYER_CLIENT = process.env.YT_DLP_PLAYER_CLIENT || 'android_vr';
// Optional Netscape-format cookies.txt to bypass "Sign in to confirm you're not
// a bot" on datacenter IPs (export with a browser extension).
const YOUTUBE_COOKIES_FILE = process.env.YOUTUBE_COOKIES_FILE
  ? path.resolve(__dirname, process.env.YOUTUBE_COOKIES_FILE)
  : null;

const bot = new Telegraf(BOT_TOKEN);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'live/unknown';
  const s = Math.floor(seconds % 60);
  const m = Math.floor((seconds / 60) % 60);
  const h = Math.floor(seconds / 3600);
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function trackLabel(track) {
  const dur = track.duration ? ` [${track.duration}]` : '';
  return `${track.title}${dur}`;
}

// Extract an 11-char YouTube video id from a URL, or null for plain queries.
function extractVideoId(input) {
  const m = String(input).match(
    /(?:v=|\/shorts\/|youtu\.be\/|\/embed\/|\/v\/)([A-Za-z0-9_-]{11})/
  );
  return m ? m[1] : null;
}

function abortError() {
  const err = new Error('aborted');
  err.name = 'AbortError';
  return err;
}

// ---------------------------------------------------------------------------
// Download audio with yt-dlp into outPath (mp3). Rejects with AbortError if the
// signal fires (killing the child process), or with the yt-dlp error otherwise.
// ---------------------------------------------------------------------------
function downloadAudio(url, outTemplate, signal) {
  return new Promise((resolve, reject) => {
    const args = [
      '-f', 'bestaudio/best',
      '-x', '--audio-format', 'mp3',
      '--audio-quality', '0',
      '--no-playlist',
      '--no-progress',
      '--no-warnings',
      '--extractor-args', `youtube:player_client=${YT_DLP_PLAYER_CLIENT}`,
      '-o', outTemplate,
    ];
    if (FFMPEG_LOCATION) {
      args.push('--ffmpeg-location', FFMPEG_LOCATION);
    }
    if (YOUTUBE_COOKIES_FILE && fs.existsSync(YOUTUBE_COOKIES_FILE)) {
      args.push('--cookies', YOUTUBE_COOKIES_FILE);
    }
    args.push(url);

    const child = spawn(YT_DLP, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    const onAbort = () => child.kill('SIGKILL');
    signal.addEventListener('abort', onAbort, { once: true });

    child.on('error', (err) => {
      signal.removeEventListener('abort', onAbort);
      reject(new Error(`Could not run yt-dlp (${YT_DLP}): ${err.message}`));
    });
    child.on('close', (code) => {
      signal.removeEventListener('abort', onAbort);
      if (signal.aborted) return reject(abortError());
      if (code === 0) return resolve();
      const lastLine = stderr.trim().split('\n').filter(Boolean).pop() || `exit code ${code}`;
      return reject(new Error(lastLine));
    });
  });
}

// ---------------------------------------------------------------------------
// Playback: download the track with yt-dlp and send it as an audio file.
// Respects the AbortSignal so /skip and /stop can interrupt an in-flight job.
// ---------------------------------------------------------------------------
async function playTrack(chatId, track, signal) {
  if (signal.aborted) throw abortError();

  await bot.telegram.sendChatAction(chatId, 'upload_voice').catch(() => {});

  const base = path.join(os.tmpdir(), `mb-${chatId}-${crypto.randomBytes(6).toString('hex')}`);
  const outTemplate = `${base}.%(ext)s`;
  const outPath = `${base}.mp3`;

  try {
    await downloadAudio(track.url, outTemplate, signal);
    if (signal.aborted) throw abortError();
    await bot.telegram.sendAudio(
      chatId,
      { source: outPath },
      {
        title: track.title,
        performer: track.author || 'Unknown',
        caption: `Now playing: ${trackLabel(track)}`,
      }
    );
  } catch (err) {
    if (signal.aborted) throw abortError();
    throw err;
  } finally {
    fs.promises.unlink(outPath).catch(() => {});
  }
}

const manager = new MusicQueueManager({
  onPlay: playTrack,
  onError: (chatId, err) => {
    console.error(`Playback error in chat ${chatId}:`, err.message);
    bot.telegram
      .sendMessage(chatId, `Could not play that track: ${err.message}`)
      .catch(() => {});
  },
});

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------
const HELP = [
  'Music Bot commands:',
  '',
  '/play <song or YouTube URL> — search and queue a track',
  '/skip — skip the current track',
  '/pause — pause the queue (stop starting new tracks)',
  '/resume — resume a paused queue',
  '/stop — clear the queue',
  '',
  'Note: Telegram bots cannot stream into voice chats, so tracks are sent to',
  'the chat as audio files. Long tracks (>50 MB) may fail to upload.',
].join('\n');

bot.start((ctx) => ctx.reply(HELP));
bot.help((ctx) => ctx.reply(HELP));

bot.command('play', async (ctx) => {
  const query = ctx.message.text.split(' ').slice(1).join(' ').trim();
  if (!query) {
    return ctx.reply('Usage: /play <song name or YouTube URL>');
  }

  await ctx.reply(`Searching for "${query}"...`);

  let video;
  try {
    const videoId = extractVideoId(query);
    if (videoId) {
      video = await ytSearch({ videoId });
    } else {
      const results = await ytSearch(query);
      video = results.videos && results.videos[0];
    }
  } catch (err) {
    console.error('Search failed:', err.message);
    return ctx.reply(`Search failed: ${err.message}`);
  }

  if (!video) {
    return ctx.reply('No results found.');
  }

  if (Number.isFinite(video.seconds) && video.seconds > MAX_DURATION_SECONDS) {
    return ctx.reply(
      `That track is ${formatDuration(video.seconds)}, longer than the ${formatDuration(
        MAX_DURATION_SECONDS
      )} limit. Try a shorter one.`
    );
  }

  const track = {
    title: video.title,
    url: video.url,
    duration: video.timestamp || formatDuration(video.seconds),
    author: (video.author && video.author.name) || 'Unknown',
    requestedBy: ctx.from && ctx.from.id,
  };

  const { position } = manager.enqueue(ctx.chat.id, track);
  if (position === 0) {
    return ctx.reply(`Now playing: ${trackLabel(track)}`);
  }
  return ctx.reply(`Queued at #${position}: ${trackLabel(track)}`);
});

bot.command('skip', (ctx) => {
  const skipped = manager.skip(ctx.chat.id);
  if (!skipped) return ctx.reply('Nothing is playing.');
  return ctx.reply(`Skipped: ${trackLabel(skipped)}`);
});

bot.command('pause', (ctx) => {
  const wasActive = manager.pause(ctx.chat.id);
  return ctx.reply(wasActive ? 'Paused. Use /resume to continue.' : 'Queue is already idle.');
});

bot.command('resume', (ctx) => {
  const hasWork = manager.resume(ctx.chat.id);
  return ctx.reply(hasWork ? 'Resumed.' : 'Nothing to resume.');
});

bot.command('stop', (ctx) => {
  const cleared = manager.stop(ctx.chat.id);
  return ctx.reply(cleared > 0 ? `Stopped. Cleared ${cleared} track(s).` : 'The queue is already empty.');
});

bot.command('queue', (ctx) => {
  const state = manager.getState(ctx.chat.id);
  const lines = [];
  if (state.current) lines.push(`Now: ${trackLabel(state.current)}`);
  state.upcoming.forEach((t, i) => lines.push(`${i + 1}. ${trackLabel(t)}`));
  if (state.paused) lines.push('(paused)');
  return ctx.reply(lines.length ? lines.join('\n') : 'The queue is empty.');
});

// ---------------------------------------------------------------------------
// Launch (only when run directly, so the bot stays importable for tests)
// ---------------------------------------------------------------------------
function start() {
  bot
    .launch()
    .then(() => console.log('Music bot is running. Press Ctrl+C to stop.'))
    .catch((err) => {
      console.error('Failed to launch bot:', err.message);
      process.exit(1);
    });

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

if (require.main === module) {
  start();
}

module.exports = { bot, manager, playTrack, start };
