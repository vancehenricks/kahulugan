import { log } from '../logs.mjs';

import { filterPerspectives } from './perspectiveFilter.mjs';
import { createPerspectivePlan } from './planGenerator.mjs';
import { aggregateSearches, aggregateNotes } from './searchAggregator.mjs';

export async function plannerCreatePlan(params) {
  const { question, perspectiveFilter } = params;

  if (!perspectiveFilter) {
    log('No perspective filter provided, returning null plan');
    return null;
  }

  const today = process.env.RAG_TODAY;
  const constitution = process.env.RAG_CONSTITUTION;

  const perspectives = filterPerspectives(perspectiveFilter);
  log('Perspectives:', perspectives.join(', '));

  const perspectiveQuestions = {};
  const perspectivePlans = {};

  // Generate perspectives in loop
  for (const perspective of perspectives) {
    log(`Generating ${perspective} perspective...`);

    perspectiveQuestions[perspective] = question;

    perspectivePlans[perspective] = (await createPerspectivePlan({
      perspective,
      perspectiveQuestion: perspectiveQuestions[perspective],
      today,
      constitution,
    })) || {
      searches: [{ query: question, k: 5 }],
      notes: `Fallback ${perspective} plan`,
      perspectiveQuestion: perspectiveQuestions[perspective],
    };
  }

  const allSearches = aggregateSearches({
    perspectives,
    perspectivePlans,
    question,
  });

  const notes = aggregateNotes({
    perspectives,
    perspectivePlans,
  });

  const finalPlan = {
    searches: allSearches,
    notes,
    question,
    perspectiveQuestions,
    perspectivePlans,
    requestedPerspectives: perspectives,
  };

  log('Plan created with', allSearches.length, 'searches');
  return finalPlan;
}
