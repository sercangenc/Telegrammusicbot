'use strict';

/**
 * Per-chat playback queue manager.
 *
 * Telegram Bot API bots cannot stream into voice chats, so "playback" here
 * means sequentially downloading each queued track and sending it to the chat
 * as an audio file. The manager guarantees that only one track per chat is
 * processed at a time and exposes queue controls (skip / pause / resume / stop).
 */

/**
 * @typedef {Object} Track
 * @property {string} title
 * @property {string} url
 * @property {string} [duration]
 * @property {string} [author]
 * @property {number|string} [requestedBy]
 */

class ChatQueue {
  constructor() {
    /** @type {Track[]} */
    this.tracks = [];
    /** @type {Track|null} */
    this.current = null;
    this.paused = false;
    this.processing = false;
    /** @type {AbortController|null} */
    this.controller = null;
  }
}

class MusicQueueManager {
  /**
   * @param {Object} options
   * @param {(chatId: number, track: Track, signal: AbortSignal) => Promise<void>} options.onPlay
   *   Called for each track. Should resolve when the track has finished sending.
   *   Must respect the provided AbortSignal so skip/stop can interrupt it.
   * @param {(chatId: number, error: Error, track: Track) => void} [options.onError]
   */
  constructor({ onPlay, onError } = {}) {
    if (typeof onPlay !== 'function') {
      throw new TypeError('MusicQueueManager requires an onPlay(chatId, track, signal) function');
    }
    this.onPlay = onPlay;
    this.onError = onError || (() => {});
    /** @type {Map<number, ChatQueue>} */
    this.queues = new Map();
  }

  /**
   * @param {number} chatId
   * @returns {ChatQueue}
   */
  _get(chatId) {
    let queue = this.queues.get(chatId);
    if (!queue) {
      queue = new ChatQueue();
      this.queues.set(chatId, queue);
    }
    return queue;
  }

  /**
   * Add a track to a chat's queue. Starts processing if idle.
   * @param {number} chatId
   * @param {Track} track
   * @returns {{ position: number, startedNow: boolean }}
   *   position is 0 when it becomes the current track, otherwise its 1-based
   *   spot in the waiting list.
   */
  enqueue(chatId, track) {
    const queue = this._get(chatId);
    queue.tracks.push(track);
    const idle = !queue.processing && !queue.paused;
    const position = idle ? 0 : queue.tracks.length;
    if (idle) {
      // Kick off processing without blocking the caller.
      this._process(chatId);
    }
    return { position, startedNow: idle };
  }

  async _process(chatId) {
    const queue = this._get(chatId);
    if (queue.processing) return;
    queue.processing = true;

    while (queue.tracks.length > 0 && !queue.paused) {
      const track = queue.tracks.shift();
      queue.current = track;
      queue.controller = new AbortController();
      try {
        await this.onPlay(chatId, track, queue.controller.signal);
      } catch (err) {
        if (err && err.name === 'AbortError') {
          // Skipped or stopped intentionally; just move on.
        } else {
          this.onError(chatId, err, track);
        }
      } finally {
        queue.current = null;
        queue.controller = null;
      }
    }

    queue.processing = false;
  }

  /**
   * Abort the current track and move to the next one.
   * @param {number} chatId
   * @returns {Track|null} the track that was skipped, if any
   */
  skip(chatId) {
    const queue = this._get(chatId);
    const skipped = queue.current;
    if (queue.controller) {
      queue.controller.abort();
    }
    return skipped;
  }

  /**
   * Stop processing the next tracks. The in-flight track keeps sending unless
   * also skipped, but nothing new starts until resume().
   * @param {number} chatId
   * @returns {boolean} whether the queue was actively playing
   */
  pause(chatId) {
    const queue = this._get(chatId);
    const wasActive = queue.processing || Boolean(queue.current);
    queue.paused = true;
    return wasActive;
  }

  /**
   * Resume processing a paused queue.
   * @param {number} chatId
   * @returns {boolean} whether there is anything left to play
   */
  resume(chatId) {
    const queue = this._get(chatId);
    if (!queue.paused) return queue.tracks.length > 0 || Boolean(queue.current);
    queue.paused = false;
    const hasWork = queue.tracks.length > 0;
    if (hasWork && !queue.processing) {
      this._process(chatId);
    }
    return hasWork;
  }

  /**
   * Clear the queue and abort the current track.
   * @param {number} chatId
   * @returns {number} number of tracks that were cleared (including current)
   */
  stop(chatId) {
    const queue = this._get(chatId);
    const cleared = queue.tracks.length + (queue.current ? 1 : 0);
    queue.tracks = [];
    queue.paused = false;
    if (queue.controller) {
      queue.controller.abort();
    }
    return cleared;
  }

  /**
   * @param {number} chatId
   * @returns {{ current: Track|null, upcoming: Track[], paused: boolean, processing: boolean }}
   */
  getState(chatId) {
    const queue = this._get(chatId);
    return {
      current: queue.current,
      upcoming: [...queue.tracks],
      paused: queue.paused,
      processing: queue.processing,
    };
  }
}

module.exports = { MusicQueueManager, ChatQueue };
