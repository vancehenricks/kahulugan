import { extractSources } from '../../context.mjs';
import { log } from '../../logs.mjs';
import { fetchRelevantMatches } from '../../search/search.mjs';
import { tryConsume, getRemaining, getLimit } from '../rateLimiter.mjs';

import { withTimeout, sendJSON, sendStatus, sendError } from './utils.mjs';


const SEARCH_TIMEOUT = 50000;

export async function handleSearch(ws, { query }) {
  if (!query || !String(query).trim()) {
    sendError(ws, 'query required');
    return;
  }

  // Apply hard daily rate limit: if limit reached, reject immediately.
  const remaining = await getRemaining();
  const limit = getLimit();
    if (remaining <= 0) {
      // structured rate-limit response so client can detect with a code
      sendJSON(ws, { type: 'error', code: 'RATE_LIMIT', message: `Daily Search request limit reached (${limit} requests/day). Please try again tomorrow.` });
    log('Search handler denied request - daily limit reached');
    return;
  }

  // Consume a slot — if consumption fails due to a race, report limit reached.
  if (!await tryConsume()) {
      // structured rate-limit response
      sendJSON(ws, { type: 'error', code: 'RATE_LIMIT', message: `Daily Search request limit reached (${limit} requests/day). Please try again tomorrow.` });
    log('Search handler denied request - consumption failed (limit reached)');
    return;
  }

  sendStatus(ws, 'Searching');

  try {
    const result = await withTimeout(fetchRelevantMatches(query), SEARCH_TIMEOUT, 'Search timeout');
    const { matches, answer } = result || {};
    const { sources } = extractSources(matches || []);

    sendJSON(ws, { question: query, answer, sources });
    log('Search completed for query');
  } catch (err) {
    // Log detailed error server-side, send generic error to client
    log('Search handler error:', err);
    sendError(ws, 'Internal server error');
  }
}