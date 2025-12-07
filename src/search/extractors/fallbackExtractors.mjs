// Fallback and utility extractors

export function extractFallbackLawName(text) {
  // Get first 20 lines and extract first 5 meaningful lines
  const lines = text.split('\n').slice(0, 20);

  // Skip common headers that aren't useful
  const skipPatterns = [
    /^(FIRST|SECOND|THIRD|FOURTH|FIFTH|SIXTH|SEVENTH|EIGHTH|NINTH|TENTH)\s+DIVISION$/i,
    /^EN\s+BANC$/i,
    /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}$/i,
    /^DECISION|RESOLUTION|ORDER|D\s+E\s+C\s+I\s+S\s+I\s+O\s+N$/i,
    /^Republic of the Philippines$/i,
    /^SUPREME COURT$/i,
    /^Manila$/i,
  ];

  const meaningfulLines = lines.filter((_line) => {
    const trimmed = _line.trim();
    if (trimmed.length === 0) return false;
    return !skipPatterns.some((pattern) => pattern.test(trimmed));
  });

  // Extract first 5 meaningful lines
  const extracted = meaningfulLines
    .slice(0, 5)
    .map((line) => line.trim())
    .join('\n');

  return extracted.length > 0 ? extracted.substring(0, 250) : 'Unknown Document';
}
