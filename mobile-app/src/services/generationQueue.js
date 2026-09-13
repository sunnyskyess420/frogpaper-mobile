// Offline generation queue.
//
// A generate request that fails because the backend cannot be reached is not
// lost: the prompt is parked in AsyncStorage and replayed later, one at a time,
// the next time the backend answers.
//
// Deliberately NO background / headless execution (WorkManager, background
// fetch, ...): Android battery managers throttle or kill those, so the queue
// only advances while the app is actually open. Same reasoning as the daily
// wallpaper's "on first open of the day" trigger.
//
// Two kinds of failure, two different answers:
//   - nothing answered (api.isOfflineError) -> stop the run, keep the entry
//   - the server answered 4xx/5xx -> mark the entry failed (with the reason)
//     and move on; a rejected prompt will be rejected again, so it is only
//     retried when the user asks for it.
import AsyncStorage from '@react-native-async-storage/async-storage';
import api, { isOfflineError } from './api';

const QUEUE_KEY = '@frogpaper/generation_queue';
export const MAX_QUEUE = 10;
// Same ceiling as the interactive Generate screen: peak-hour cloud queues can
// outlast the 60s default and the request has already been paid for.
const GENERATE_TIMEOUT_MS = 180000;

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeEntry(entry) {
  if (!entry || typeof entry !== 'object' || typeof entry.prompt !== 'string') {
    return null;
  }
  return {
    id: entry.id || makeId(),
    prompt: entry.prompt,
    negativePrompt: entry.negativePrompt || null,
    width: entry.width || 1080,
    height: entry.height || 1920,
    provider: entry.provider || null,
    seed: entry.seed === undefined ? null : entry.seed,
    createdAt: entry.createdAt || Date.now(),
    failed: !!entry.failed,
    failedMessage: entry.failedMessage || null,
    failedAt: entry.failedAt || null,
  };
}

async function writeQueue(queue) {
  try {
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch (err) {
    // storage full / unavailable - the in-memory caller still sees the result
  }
  return queue;
}

async function readQueue() {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.map(normalizeEntry).filter(Boolean);
  } catch (err) {
    return [];
  }
}

export async function listQueue() {
  return readQueue();
}

// Adds a request to the end of the queue. When the queue is full the oldest
// entry is dropped - reported back so the caller can say so out loud instead of
// silently losing a prompt.
export async function enqueue(request) {
  const prompt = String((request && request.prompt) || '').trim();
  if (prompt.length < 3) {
    return { entry: null, dropped: null, queue: await readQueue() };
  }
  const queue = await readQueue();
  const entry = normalizeEntry({
    id: makeId(),
    prompt,
    negativePrompt: (request && request.negativePrompt) || null,
    width: request && request.width,
    height: request && request.height,
    provider: (request && request.provider) || null,
    seed: request ? request.seed : null,
    createdAt: Date.now(),
  });
  queue.push(entry);
  let dropped = null;
  while (queue.length > MAX_QUEUE) {
    dropped = queue.shift();
  }
  await writeQueue(queue);
  return { entry, dropped, queue };
}

export async function removeFromQueue(id) {
  const queue = await readQueue();
  const next = queue.filter((entry) => entry.id !== id);
  await writeQueue(next);
  return next;
}

export async function clearQueue() {
  const queue = await readQueue();
  await writeQueue([]);
  return queue.length;
}

// Runs the queue in order, one request at a time.
//
// includeFailed: entries the server already refused are skipped unless this is
// set - the automatic run on app open uses false so a rejected prompt is not
// re-sent on every launch, while the manual "Run queued" button uses true and
// gives the user a real retry.
//
// Returns a summary the caller can phrase for the user.
export async function processQueue({ includeFailed = true, onProgress } = {}) {
  const snapshot = await readQueue();
  const pending = snapshot.filter((entry) => includeFailed || !entry.failed);

  const summary = {
    attempted: 0,
    succeeded: [], // [{ entry, image }]
    failed: [], // [{ entry, message, status }]
    stoppedOffline: false,
    error: null,
    remaining: snapshot.length,
  };

  for (const entry of pending) {
    summary.attempted += 1;
    if (onProgress) {
      onProgress({ entry, attempted: summary.attempted, total: pending.length });
    }
    let image = null;
    try {
      const response = await api.generate({
        prompt: entry.prompt,
        negativePrompt: entry.negativePrompt,
        width: entry.width,
        height: entry.height,
        seed: entry.seed === null ? undefined : entry.seed,
        provider: entry.provider || undefined,
        timeoutMs: GENERATE_TIMEOUT_MS,
      });
      image = response.image;
    } catch (err) {
      if (isOfflineError(err)) {
        // Nothing answered: keep this entry and everything behind it for the
        // next attempt. Stop here - the whole backend is unreachable.
        summary.stoppedOffline = true;
        summary.error = {
          message: (err && err.message) || 'Backend unreachable.',
          status: (err && err.status) || null,
        };
        break;
      }
      const message = (err && err.message) || 'Generation failed.';
      summary.failed.push({ entry, message, status: (err && err.status) || null });
      const current = await readQueue();
      await writeQueue(
        current.map((item) =>
          item.id === entry.id
            ? { ...item, failed: true, failedMessage: message, failedAt: Date.now() }
            : item
        )
      );
      continue;
    }
    // Success: the image exists on the server now, so the entry is done.
    summary.succeeded.push({ entry, image });
    const current = await readQueue();
    await writeQueue(current.filter((item) => item.id !== entry.id));
  }

  summary.remaining = (await readQueue()).length;
  return summary;
}

// Short human-readable outcome, shared by Home and Generate so both screens
// word the same result the same way.
export function describeQueueRun(summary) {
  if (!summary) {
    return '';
  }
  const parts = [];
  if (summary.succeeded.length > 0) {
    parts.push(
      `Generated ${summary.succeeded.length} queued wallpaper${
        summary.succeeded.length === 1 ? '' : 's'
      }.`
    );
  }
  if (summary.stoppedOffline) {
    parts.push(`Backend still unreachable - ${summary.remaining} kept in the queue.`);
  }
  if (summary.failed.length > 0) {
    const reason = summary.failed[0].message;
    parts.push(
      `${summary.failed.length} request${summary.failed.length === 1 ? '' : 's'} refused by the server (${reason}). Tap Run queued to retry.`
    );
  }
  if (parts.length === 0) {
    parts.push('Nothing to run.');
  }
  return parts.join(' ');
}

export default {
  enqueue,
  listQueue,
  removeFromQueue,
  clearQueue,
  processQueue,
  describeQueueRun,
  MAX_QUEUE,
};
