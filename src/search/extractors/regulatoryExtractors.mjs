// Resolution and regulatory document extractors - simplified

export function extractResolutionLawName(text) {
  // Get first 20 lines to scan for RESOLUTION pattern
  const lines = text.split('\n').slice(0, 20);

  // Find the line that contains RESOLUTION No.
  for (const line of lines) {
    if (/RESOLUTION\s+No\./i.test(line)) {
      return line.trim().substring(0, 250);
    }
  }

  return null;
}

export function extractCommissionResolutionLawName(text) {
  // Get first 20 lines to scan for Commission pattern
  const lines = text.split('\n').slice(0, 20);

  // Find lines with COMMISSION names
  for (const line of lines) {
    if (
      /(?:COMMISSION ON ELECTIONS|COMMISSION ON AUDIT|CIVIL SERVICE COMMISSION|NATIONAL LABOR RELATIONS COMMISSION|BANGKO SENTRAL NG PILIPINAS)/i.test(
        line
      )
    ) {
      return line.trim().substring(0, 250);
    }
  }

  return null;
}

export function extractStatueLawName(text) {
  // Get first 20 lines to scan for statute pattern
  const lines = text.split('\n').slice(0, 20);
  const headerText = lines.join('\n');

  // Skip if G.R. or SUPREME COURT present (court documents, not statutes)
  if (/G\.R\.|SUPREME COURT|A\.M\./i.test(headerText)) {
    return null;
  }

  // Find lines with statute patterns
  for (const line of lines) {
    if (
      /Republic Act No\.|Executive Order No\.|Presidential Decree No\.|Batas Pambansa Blg\./i.test(
        line
      )
    ) {
      return line.trim().substring(0, 250);
    }
  }

  return null;
}
