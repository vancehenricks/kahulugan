const MAX_K = 5;

export function aggregateSearches(params) {
  const { perspectives, perspectivePlans, question } = params;

  const allSearches = [];

  for (const perspective of perspectives) {
    const plan = perspectivePlans[perspective];
    if (plan?.searches && Array.isArray(plan.searches)) {
      plan.searches.slice(0, 2).forEach((search) => {
        if (search?.query?.trim()) {
          allSearches.push({
            query: search.query.trim(),
            k: Math.min(MAX_K, search.k || MAX_K),
            perspective,
          });
        }
      });
    }
  }

  if (allSearches.length === 0) {
    allSearches.push({ query: question, k: MAX_K, perspective: 'general' });
  }

  return allSearches;
}

export function aggregateNotes(params) {
  const { perspectives, perspectivePlans } = params;

  const notesList = [];
  for (const perspective of perspectives) {
    if (perspectivePlans[perspective]?.notes) {
      notesList.push(`${capitalize(perspective)}: ${perspectivePlans[perspective].notes}`);
    }
  }

  return notesList.join(' | ') || `Plan for ${perspectives.join(', ')}`;
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
