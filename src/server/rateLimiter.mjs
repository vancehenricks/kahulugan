
import { pgClient } from '../db.mjs';
import { log } from '../logs.mjs';

const DEFAULT_LIMIT = parseInt(process.env.HARD_LIMIT || '100', 10);

// In-memory fallback (only used if DB fails)
const _fallbackCounts = new Map();

function _dayKeyForDate(d = new Date()) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function _ensureSchema() {
  try {
    await pgClient.query(
      `CREATE TABLE IF NOT EXISTS daily_api_counters (
        day TEXT PRIMARY KEY,
        count INTEGER NOT NULL
      );`
    );
  } catch (err) {
    // If DB is not available, we'll fall back to memory. Don't rethrow.
    log('rateLimiter: failed to ensure schema, falling back to in-memory:', err?.message || err);
    throw err;
  }
}

export function getLimit() {
  return DEFAULT_LIMIT;
}

export async function getCountForToday() {
  const key = _dayKeyForDate();
  try {
    // ensure table exists
    await _ensureSchema();
    const res = await pgClient.query('SELECT count FROM daily_api_counters WHERE day = $1', [key]);
    if (res && res.rows && res.rows[0]) return parseInt(res.rows[0].count || 0, 10);
    return 0;
  } catch {
    // fallback to memory
    return _fallbackCounts.get(key) || 0;
  }
}

// Try to consume a single slot. Returns true if the consumption succeeded
// (there was capacity and the counter was incremented), false if the
// limit is already reached and no consumption occurred.
export async function tryConsume() {
  const key = _dayKeyForDate();

  // Prefer DB-backed approach, but gracefully fallback to in-memory on errors
  try {
    await _ensureSchema();
    // Run a transaction: select FOR UPDATE, then either insert or update
    await pgClient.query('BEGIN');
    const sel = await pgClient.query('SELECT count FROM daily_api_counters WHERE day = $1 FOR UPDATE', [key]);
    let cur = 0;
    if (sel && sel.rows && sel.rows[0]) cur = parseInt(sel.rows[0].count || 0, 10);
    if (cur >= DEFAULT_LIMIT) {
      await pgClient.query('ROLLBACK');
      return false;
    }
    if (cur === 0) {
      await pgClient.query('INSERT INTO daily_api_counters(day, count) VALUES($1, $2)', [key, 1]);
    } else {
      await pgClient.query('UPDATE daily_api_counters SET count = count + 1 WHERE day = $1', [key]);
    }
    await pgClient.query('COMMIT');
    return true;
  } catch {
    try {
      await pgClient.query('ROLLBACK');
    } catch {
        // ignore
    }
    // fallback to memory
    const cur = _fallbackCounts.get(key) || 0;
    if (cur >= DEFAULT_LIMIT) return false;
    _fallbackCounts.set(key, cur + 1);
    // cleanup older keys
    _cleanupOldKeys();
    return true;
  }
}

export async function resetCounts() {
  const key = _dayKeyForDate();
  try {
    await _ensureSchema();
    await pgClient.query('DELETE FROM daily_api_counters WHERE day = $1', [key]);
  } catch {
    _fallbackCounts.delete(key);
  }
}

function _cleanupOldKeys() {
  const keep = new Set();
  const today = _dayKeyForDate();
  keep.add(today);
  const d1 = new Date();
  d1.setUTCDate(d1.getUTCDate() - 1);
  keep.add(_dayKeyForDate(d1));
  const d2 = new Date();
  d2.setUTCDate(d2.getUTCDate() - 2);
  keep.add(_dayKeyForDate(d2));
  for (const k of Array.from(_fallbackCounts.keys())) {
    if (!keep.has(k)) _fallbackCounts.delete(k);
  }
}

export async function getRemaining() {
  const used = await getCountForToday();
  return Math.max(0, DEFAULT_LIMIT - used);
}

export async function isOverLimit() {
  const used = await getCountForToday();
  return used >= DEFAULT_LIMIT;
}
