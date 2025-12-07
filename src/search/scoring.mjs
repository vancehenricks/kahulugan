// Handles relevance scoring

export function keywordMatch(text, query) {
  const queryWords = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2); // Lower threshold to catch "law", "ai", etc.
  const textLower = text.toLowerCase();
  const matches = queryWords.filter((word) => textLower.includes(word)).length;
  return queryWords.length > 0 ? matches / queryWords.length : 0;
}

export function distanceToSimilarity(distance) {
  return Math.exp(-distance);
}

export function scoreMatches(matches, query, maxResults) {
  return matches
    .map((m) => {
      const keywordScore = keywordMatch(m.text || '', query);
      const semanticScore = distanceToSimilarity(m.dist || 2);
      return {
        ...m,
        semanticScore,
        keywordScore,
        relevanceScore: semanticScore * 0.7 + keywordScore * 0.3,
      };
    })
    .filter((m) => m.relevanceScore > 0.2)
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, maxResults);
}
