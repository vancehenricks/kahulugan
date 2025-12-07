import { extractSources, isUnknownResponse } from '../../context.mjs';
import { log } from '../../logs.mjs';
import { plannerCreatePlan } from '../../perspectiveAnalysis/planner.mjs';
import { presenterPresent } from '../../perspectiveAnalysis/presenter.mjs';
import { researcherExecutePlan } from '../../perspectiveAnalysis/researcher.mjs';
import { tryConsume, getRemaining, getLimit } from '../rateLimiter.mjs';

import { withTimeout, sendJSON, sendStatus, sendError } from './utils.mjs';


const ANALYSIS_TOTAL_TIMEOUT = 300000; // 5 minutes

export async function handlePerspectiveAnalysis(ws, { query, perspective }) {
  if (!query || !String(query).trim()) {
    sendError(ws, 'question required');
    return;
  }

  // Apply hard daily rate limit: if limit reached, reject immediately.
  const remaining = await getRemaining();
  const limit = getLimit();
  if (remaining <= 0) {
    // structured rate-limit response
    sendJSON(ws, { type: 'error', code: 'RATE_LIMIT', message: `Daily Perspective Analysis request limit reached (${limit} requests/day). Please try again tomorrow.` });
    log('Analysis handler denied request - daily limit reached');
    return;
  }

  // Consume a slot — if consumption fails due to a race, report limit reached.
  if (!await tryConsume()) {
    // structured rate-limit response
    sendJSON(ws, { type: 'error', code: 'RATE_LIMIT', message: `Daily Perspective Analysis request limit reached (${limit} requests/day). Please try again tomorrow.` });
    log('Analysis handler denied request - consumption failed (limit reached)');
    return;
  }

  try {
    sendStatus(ws, 'Planning');

    const analysisPromise = (async () => {
      const plan = await plannerCreatePlan({
        question: query,
        perspectiveFilter: perspective,
      });

      if (!plan) throw new Error('Plan creation failed');

      sendStatus(ws, 'Researching');
      const snippets = await researcherExecutePlan(plan);

      sendStatus(ws, 'Verifying');
      const answer = await presenterPresent(query, plan, snippets);

      return { plan, snippets, answer };
    })();

    const { snippets, answer } = await withTimeout(analysisPromise, ANALYSIS_TOTAL_TIMEOUT, 'Total analysis timeout');

    sendStatus(ws, 'Extracting sources');
    const { sources } = extractSources(snippets || []);

    sendJSON(ws, {
      question: query,
      answer,
      sources: isUnknownResponse(answer) ? [] : sources,
    });

    log('Perspective analysis completed for query');
  } catch (err) {
    log('Analysis handler error:', err);
    sendError(ws, 'Internal server error');
  }
}