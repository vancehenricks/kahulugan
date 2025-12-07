import { extractSources, isUnknownResponse } from '../../context.mjs';
import { log } from '../../logs.mjs';
import { answerQuestion } from '../../questionAndAnswer/questionAndAnswer.mjs';
import { tryConsume, getRemaining, getLimit } from '../rateLimiter.mjs';

import { withTimeout, sendJSON, sendStatus, sendError } from './utils.mjs';


const QA_TIMEOUT = 120000;

export async function handleQA(ws, { query, clientState }) {
  if (!query || !String(query).trim()) {
    sendError(ws, 'query required');
    return;
  }

  // Apply hard daily rate limit: if limit reached, reject immediately.
  const remaining = await getRemaining();
  const limit = getLimit();
    if (remaining <= 0) {
    // Send a structured rate-limit error so clients can detect this condition reliably
    sendJSON(ws, { type: 'error', code: 'RATE_LIMIT', message: `Daily QA request limit reached (${limit} requests/day). Please try again tomorrow.` });
    log('QA handler denied request - daily limit reached');
    return;
  }

  // Consume a slot — if consumption fails due to a race, report limit reached.
  const consumed = await tryConsume();
  if (!consumed) {
    // structured rate-limit response
    sendJSON(ws, { type: 'error', code: 'RATE_LIMIT', message: `Daily QA request limit reached (${limit} requests/day). Please try again tomorrow.` });
    log('QA handler denied request - consumption failed (limit reached)');
    return;
  }

  sendStatus(ws, 'Thinking');

  try {
    const qaResult = await withTimeout(
      answerQuestion(query, { clientState }),
      QA_TIMEOUT,
      'QA timeout'
    );

    const { answer, matches } = qaResult || {};
    const { sources } = extractSources(matches || []);

    sendJSON(ws, {
      question: query,
      answer,
      sources: isUnknownResponse(answer) ? [] : sources,
    });

    log('QA completed for query');
  } catch (err) {
    // Handle timeouts specially so clients get a useful message and logs are
    // easier to find in production.
    try {
      const isTimeout = err && (err.name === 'TimeoutError' || err.code === 'TIMEOUT' || /timeout/i.test(String(err.message || '')));
      if (isTimeout) {
        // Log helpful context but avoid dumping full user content
        log('QA handler timed out for query (truncated):', (query || '').slice(0, 200));
        if (err?.stack) log('QA handler timeout stack:', err.stack);
        sendError(ws, 'QA timeout — backend took too long. Try again or ask a narrower question.');
        return;
      }

      const msg = err?.message || String(err);
      const stack = err?.stack || null;
      log('QA handler error message:', msg);
      if (stack) log('QA handler error stack:', stack);
    } catch {
      // Fallback to a simple log if formatting fails
      log('QA handler error (unserializable):', String(err));
    }
    sendError(ws, 'Internal server error');
  }
}