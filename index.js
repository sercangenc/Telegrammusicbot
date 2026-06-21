'use strict';

const fs = require('fs');
const path = require('path');
const { Telegraf } = require('telegraf');
const ytSearch = require('yt-search');
const ytdl = require('ytdl-core');

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

// ---------------------------------------------------------------------------
// Playback: download the track with ytdl-core and send it as an audio file.
// Respects the AbortSignal so /skip and /stop can interrupt an in-flight send.
// ---------------------------------------------------------------------------
async function playTrack(chatId, track, signal) {
  if (signal.aborted) {
    const err = new Error('aborted');
    err.name = 'AbortError';
    throw err;
  }

  await bot.telegram.sendChatAction(chatId, 'upload_voice').catch(() => {});

  const stream = ytdl(track.url, {
    filter: 'audioonly',
    quality: 'highestaudio',
    highWaterMark: 1 << 25,
  });

  const onAbort = () => stream.destroy(new Error('aborted'));
  signal.addEventListener('abort', onAbort, { once: true });

  try {
    await bot.telegram.sendAudio(
      chatId,
      { source: stream },
      {
        title: track.title,
        performer: track.author || 'Unknown',
        caption: `Now playing: ${trackLabel(track)}`,
      }
    );
  } catch (err) {
    if (signal.aborted) {
      const aborted = new Error('aborted');
      aborted.name = 'AbortError';
      throw aborted;
    }
    throw err;
  } finally {
    signal.removeEventListener('abort', onAbort);
    if (!stream.destroyed) stream.destroy();
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
    if (ytdl.validateURL(query)) {
      const info = await ytSearch({ videoId: ytdl.getVideoID(query) });
      video = info;
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
// Launch
// ---------------------------------------------------------------------------
bot
  .launch()
  .then(() => console.log('Music bot is running. Press Ctrl+C to stop.'))
  .catch((err) => {
    console.error('Failed to launch bot:', err.message);
    process.exit(1);
  });

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
