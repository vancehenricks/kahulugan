import { UNKNOWN_PHRASE } from '../context.mjs';
import { searchNearest } from '../embeddings.mjs';
import { log, warn } from '../logs.mjs';
import { extractRelevantSnippet, formatSnippet } from '../search/snippetExtractors.mjs';

const CONSTITUTION = process.env.RAG_CONSTITUTION;

function filterBarExamNotes(hits) {
  if (!Array.isArray(hits)) return [];

  const filtered = hits.filter((hit) => {
    const filename = (hit.filename || '').toLowerCase();
    const relativePath = (hit.relative_path || '').toLowerCase();

    const lineCount = (hit.text || '').split('\n').length;
    if (lineCount <= 2) {
      log(`Filtered out very short file (${lineCount} lines): ${hit.filename || hit.uuid}`);
      return false;
    }

    const isBarExam = filename.includes('bar') || relativePath.includes('bar');

    if (isBarExam) {
      log(`Filtered out bar exam content: ${hit.filename || hit.uuid}`);
      return false;
    }

    const hasConstitutionContent = filename.includes('const') || relativePath.includes('const');

    if (hasConstitutionContent) {
      const isCorrectConstitution =
        filename.includes(`cons${CONSTITUTION}`) || relativePath.includes(`cons${CONSTITUTION}`);

      if (!isCorrectConstitution) {
        log(`Filtered out non-${CONSTITUTION} constitution document: ${hit.filename || hit.uuid}`);
        return false;
      }
    }

    return true;
  });

  if (filtered.length < hits.length) {
    log(`Filtered out ${hits.length - filtered.length} documents`);
  }

  return filtered;
}

function extractCitations(text) {
  if (!text) return [];

  const citations = new Set();

  const patterns = [
    /(?:R\.A\.|RA|Republic Act)\s*(?:No\.?)?\s*(\d+)/gi,
    /(?:P\.D\.|PD|Presidential Decree)\s*(?:No\.?)?\s*(\d+)/gi,
    /(?:E\.O\.|EO|Executive Order)\s*(?:No\.?)?\s*(\d+)/gi,
    /(?:B\.P\.|BP|Batas Pambansa)\s*(?:No\.?)?\s*(\d+)/gi,
    /G\.R\.\s*No\.?\s*(\d+)/gi,
    /(?:A\.O\.|AO|Administrative Order)\s*(?:No\.?)?\s*(\d+)/gi,
    /(?:D\.O\.|DO|Department Order)\s*(?:No\.?)?\s*(\d+)/gi,
  ];

  patterns.forEach((pattern) => {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      citations.add(match[0].trim());
    }
  });

  return Array.from(citations);
}

async function searchCitations(citations, maxPerCitation = 2) {
  const citationHits = [];

  for (const citation of citations.slice(0, 5)) {
    log(`Searching for citation: ${citation}`);

    try {
      let hits = await searchNearest(citation, maxPerCitation, { searchByTitle: true });
      if (!Array.isArray(hits)) hits = [];

      hits = filterBarExamNotes(hits);

      for (const hit of hits) {
        citationHits.push({
          ...hit,
          foundViaCitation: citation,
        });
      }

      log(`Found ${hits.length} documents for citation: ${citation}`);
    } catch (e) {
      warn(`Error searching citation ${citation}:`, e.message);
    }
  }

  return citationHits;
}

export async function researcherExecutePlan(plan) {
  const requestedPerspectives = plan.requestedPerspectives || ['prosecutor', 'defense', 'judge'];

  log('Executing research plan with', plan.searches?.length || 0, 'searches');
  log('Requested perspectives:', requestedPerspectives.join(', '));
  log('Plan notes:', plan.notes || 'none');
  log('Note: Bar exam materials will be filtered out from results');

  const seen = new Map();
  const allCitations = new Set();

  // Filter searches by requested perspectives
  const filteredSearches = plan.searches.filter((s) => {
    const perspective = s.perspective || 'general';
    return requestedPerspectives.includes(perspective) || perspective === 'general';
  });

  log(
    `Filtered searches from ${plan.searches.length} to ${filteredSearches.length} based on requested perspectives`
  );

  for (let searchIdx = 0; searchIdx < filteredSearches.length; searchIdx++) {
    const s = filteredSearches[searchIdx];
    const q = s && s.query ? s.query : null;

    if (!q) {
      warn(`Search ${searchIdx + 1}: No query found, skipping`);
      continue;
    }

    const k = Number.isInteger(s.k) ? s.k : 3;
    const perspective = s.perspective || 'unknown';

    log(`Search ${searchIdx + 1}/${filteredSearches.length} (${perspective}):`, q, `(k=${k})`);
    log(`Search ${searchIdx + 1}: Searching embeddings`);

    let hits = await searchNearest(q, k);

    if (!Array.isArray(hits)) hits = [];

    log(`Search ${searchIdx + 1}: Found ${hits.length} initial hits`);

    hits = filterBarExamNotes(hits);
    log(`Search ${searchIdx + 1}: After filtering: ${hits.length} hits`);

    let newHits = 0;
    for (const h of hits) {
      // Preserve original text for citation extraction, then reduce stored text to a snippet
      const originalText = h.text || '';
      const citationsInDoc = extractCitations(originalText);
      citationsInDoc.forEach((cite) => allCitations.add(cite));

      // Try to generate a relevant snippet; fall back to a simple truncation
      let snippet = originalText.slice(0, 800);
      try {
        snippet = await extractRelevantSnippet(originalText, q || '', false);
        if (snippet && typeof snippet === 'string') snippet = await formatSnippet(snippet);

        // If we can't extract a reliable snippet, omit this hit entirely
        if (snippet === UNKNOWN_PHRASE) {
          log(`researcher: skipping hit ${h.filename || h.uuid} due to UNKNOWN_PHRASE`);
          continue;
        }
      } catch (e) {
        warn('Snippet extraction/formatting failed for', h.filename || h.uuid, e?.message || e);
        try {
          snippet = await formatSnippet(snippet);
        } catch (e2) {
          warn('Fallback snippet formatting failed:', e2?.message || e2);
        }
        if (snippet === UNKNOWN_PHRASE) {
          log(`researcher: skipping hit ${h.filename || h.uuid} after fallback due to UNKNOWN_PHRASE`);
          continue;
        }
      }

      // Build a reduced hit object to keep token footprint small; keep original metadata
      const reducedHit = {
        ...h,
        snippet,
        // We intentionally replace `text` with the smaller snippet to reduce context size downstream.
        text: snippet,
        // Keep a flag indicating we truncated context (avoid sending full text in outputs).
        full_text_truncated: originalText.length > (snippet || '').length,
      };

      if (!seen.has(h.uuid)) {
        seen.set(h.uuid, reducedHit);
        newHits++;
        log(`Added hit (snippet ${String(reducedHit.text).length} chars): ${h.filename || h.uuid}`);
      }
    }

    log(`Search ${searchIdx + 1}: Added ${newHits} new unique hits`);
  }

  if (allCitations.size > 0) {
    log(
      `Found ${allCitations.size} citations in retrieved documents, searching for related documents...`
    );
    const citationHits = await searchCitations(Array.from(allCitations), 2);

    let citationNewHits = 0;
    for (const h of citationHits) {
      if (!seen.has(h.uuid)) {
        seen.set(h.uuid, h);
        citationNewHits++;
        log(`Added citation-related hit: ${h.filename || h.uuid}`);
      }
    }

    log(`Citation follow-up: Added ${citationNewHits} new documents`);
  }

  const finalResults = Array.from(seen.values());
  log('Research plan execution completed:', finalResults.length, 'total unique results');

  return finalResults;
}
