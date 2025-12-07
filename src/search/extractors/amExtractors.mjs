// A.M. (Administrative Matter) extractors - simplified

export function extractAMLawName(text) {
  // Get first 20 lines to scan for A.M. pattern
  const lines = text.split('\n').slice(0, 20);

  // Find the line that contains A.M. No.
  for (const line of lines) {
    if (/A\.M\.\s+No\./i.test(line)) {
      return line.trim().substring(0, 250);
    }
  }

  return null;
}
