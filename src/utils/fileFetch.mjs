import fs from 'fs/promises';
import path from 'path';

import { warn } from '../logs.mjs';

// Try to resolve tokens like `_FILE_:<uuid>/<filename>` to local files or HTTP URLs.
// This is intentionally pragmatic: it looks for likely files under the repo `output/` and `corpus/`
// and falls back to a direct file path or HTTP(S) fetch. It returns an object with
// `{ uuid, filename, content }` or `null` if nothing could be found.

const CWD = process.cwd();

async function tryReadFileCandidates(candidates) {
  for (const c of candidates) {
    if (!c) continue;
    try {
      const txt = await fs.readFile(c, { encoding: 'utf8' });
      return { path: c, content: txt };
    } catch {
      // ignore and try next
    }
  }
  return null;
}

export async function fetchSnippetForToken(token, _question = null) {
  if (!token || typeof token !== 'string') return null;

  try {
    const t = token.trim();

    // If it's an HTTP(s) URL, try fetching it
    if (/^https?:\/\//i.test(t)) {
      try {
        const res = await fetch(t);
        if (!res.ok) return null;
        const content = await res.text();
        const filename = path.basename(new URL(t).pathname) || t;
        return { uuid: null, filename, content };
      } catch (err) {
        warn('fileFetch: http fetch failed for', t, err?.message || err);
        return null;
      }
    }

    // Support internal token format: _FILE_:uuid/relative/path/to/file.txt
    if (t.startsWith('_FILE_:')) {
      const remainder = t.replace(/^_FILE_:/, '');
      const parts = remainder.split('/');
      const uuid = parts.shift();
      const filename = parts.join('/') || uuid;

      const candidates = [];

      // direct repo-relative
      candidates.push(path.resolve(CWD, filename));

      // common locations
      candidates.push(path.resolve(CWD, 'output', 'txt', filename));
      candidates.push(path.resolve(CWD, 'output', filename));
      candidates.push(path.resolve(CWD, 'output', 'embeddings', filename));
      candidates.push(path.resolve(CWD, 'corpus', filename));
      candidates.push(path.resolve(CWD, 'corpus', uuid, filename));

      // try adding .txt if missing
      if (!filename.toLowerCase().endsWith('.txt')) {
        candidates.push(...candidates.map((p) => `${p}.txt`));
      }

      // try basename variations
      const base = path.basename(filename);
      candidates.push(path.resolve(CWD, 'corpus', base));
      candidates.push(path.resolve(CWD, 'output', 'txt', base));

      const found = await tryReadFileCandidates(candidates);
      if (found) {
        return { uuid, filename: path.basename(found.path), content: found.content };
      }

      // Nothing on disk we could find
      return null;
    }

    // Otherwise, treat token as a file path on disk
    try {
      const p = path.resolve(CWD, t);
      const txt = await fs.readFile(p, { encoding: 'utf8' });
      return { uuid: null, filename: path.basename(p), content: txt };
    } catch {
      // not found
      return null;
    }
  } catch (err) {
    warn('fileFetch: unexpected error', err?.message || err);
    return null;
  }
}

export default fetchSnippetForToken;
