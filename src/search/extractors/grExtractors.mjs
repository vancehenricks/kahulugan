// G.R. (Case) number extractors - simplified

export function extractGRLawName(text) {
  // Get first 20 lines to scan for G.R. pattern
  const lines = text.split('\n').slice(0, 20);

  // Find the line that contains G.R. No.
  for (const line of lines) {
    if (/G\.R\.\s+No\./i.test(line)) {
      return line.trim().substring(0, 250);
    }
  }

  return null;
}
