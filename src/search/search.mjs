// Main search orchestrator

import { extractSource, UNKNOWN_PHRASE } from '../context.mjs';
import { searchNearest } from '../embeddings.mjs';
import { openai } from '../llm.mjs';
import { log } from '../logs.mjs';

import { extractLawName } from './lawNameExtractors.mjs';
import { scoreMatches } from './scoring.mjs';
import { extractRelevantSnippet, formatSnippet, formatLawName } from './snippetExtractors.mjs';

const MAX_MATCHES = 5;

async function interpretMatchesWithLLM(items = [], query = '') {
  try {
    log('Interpreting matches with LLM...');

    const docsText = items
      .map(
        (it, idx) =>
          `DOCUMENT ${idx + 1}\nLaw: ${it.lawName}\nScore: ${typeof it.score !== 'undefined' ? it.score : 'n/a'}\nSnippet: ${it.snippet}\nURL: ${it.fileUrl}\n`
      )
      .join('\n---\n');

      const system = {
        role: 'system',
        content: [
          'You are a friendly, conversational legal research assistant. Use only the documents and snippets provided below; do NOT hallucinate facts or cite sources not included in the input.',
          'Be warm, concise, and helpful — imagine explaining your reasoning to a colleague in plain language. Favor short sentences and clear suggestions.',
          "Your task: Identify the top 1-5 documents most useful to answer the user's query and explain why, referencing exact snippets provided. For each recommended document, provide concise recommended next steps (1-3 actions) and any key uncertainties or additional documents needed to be more certain.",
          "Important: When referring to documents, always use the case or law name as provided in the 'Law' field. Do NOT refer to documents only by their numeric 'DOCUMENT N' identifiers. If you include any index numbers, include them alongside the law name, but prefer and prioritize the law name.",
          "Be concise: limit 'reason' to 30 words, 'brief' to 20 words, 'recommendedActions' to at most 3 short items (max 10 words each), and 'uncertainties' to at most 2 short items. Return only the JSON object—no extra commentary or explanation.",
          "Output format: JSON with keys { topDocuments: [{index, lawName, reason, supportingSnippet, recommendedActions:[], uncertainties:[]}], ranked: [indexes in order], brief: 'short 1-2 sentence friendly summary' } — the field values (reason, recommendedActions, uncertainties, brief) should use a conversational, helpful tone.",
        ].join(' '),
      };

    const user = {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `Query: ${query}\n\nDocuments:\n${docsText}\n\nPlease return only valid JSON following the output format above. Use a friendly, conversational tone in all textual fields (brief, reason, recommendedActions, uncertainties). Do not include any extra commentary outside the JSON object.`,
        },
      ],
    };

    const completion = await openai.chat.completions.create({
      model: items.length < 2 ? 'openai/gpt-oss-20b' : 'google/gemini-2.0-flash-001',
      messages: [system, user],
      temperature: 0.0,
      // reduce max tokens to encourage faster responses from a slower LLM
      max_output_tokens: 600,
    });

    const raw = completion?.choices?.[0]?.message?.content ?? '(no answer)';
    log('LLM interpretation received', raw?.length || 0);

    // Try to parse JSON response defensively
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // attempt to extract the first JSON object inside the response
      const firstBrace = raw.indexOf('{');
      const lastBrace = raw.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        try {
          parsed = JSON.parse(raw.slice(firstBrace, lastBrace + 1));
        } catch {
          parsed = null;
        }
      }
    }

    // Build a brief summary fallback if not provided by parsed JSON
    let brief = '';
    if (parsed && typeof parsed.brief === 'string' && parsed.brief.trim().length > 0) {
      brief = parsed.brief.trim();
    } else if (parsed && Array.isArray(parsed.topDocuments) && parsed.topDocuments.length > 0) {
      brief = parsed.topDocuments
        .slice(0, 3)
        .map(
          (d) =>
            `${d.lawName || `Document ${d.index}`} - ${d.reason?.split('.')[0] || 'recommended'}`
        )
        .join('; ');
      brief = brief || 'Top documents recommended.';
    } else {
      // fallback: take first 1-2 lines of raw output, sanitized
      brief = (raw || '(no interpretation)').split('\n').slice(0, 2).join(' ').trim();
    }

    return { raw, parsed, brief };
  } catch (error) {
    log('LLM interpretation failed:', error?.message || error);
    return { raw: '(no interpretation)', parsed: null, brief: '(no interpretation)' };
  }
}

// Decide whether the user's query should be treated as a title/law lookup
// (title-only search) or a descriptive query that requires vector search.
// Uses the LLM with a deterministic prompt (temperature=0). Returns boolean
// `true` when the query should be treated as a title/identifier lookup.
async function decideSearchByTitle(query) {
  try {
    if (!query || typeof query !== 'string') return { ok: true, isTitle: false, reason: 'empty or non-string' };
    const s = query.trim();

    if (s.includes(',')) return { ok: true, isTitle: false, reason: 'contains comma -> descriptive' };

    const idPatterns = [
      { keyword: 'G.R.', regex: new RegExp('\\b(?:G\\.R\\.|GR|G R\\.|General Registry Number)(?=\\s|$|[\\.,:;])(?:\\s*(?:No\\.?|#)?\\s*([\\dA-Za-z\\-\\/]+))?', 'i') },
      { keyword: 'R.A.', regex: new RegExp('\\b(?:R\\.A\\.|RA|Republic Act|Republic Act No\\.?)(?=\\s|$|[\\.,:;])(?:\\s*(?:No\\.?|#)?\\s*([\\dA-Za-z\\-\\/]+))?', 'i') },
      { keyword: 'C.A.', regex: new RegExp('\\b(?:C\\.A\\.|CA|Commonwealth Act|Commonwealth Act No\\.?)(?=\\s|$|[\\.,:;])(?:\\s*(?:No\\.?|#)?\\s*([\\dA-Za-z\\-\\/]+))?', 'i') },
      { keyword: 'P.D.', regex: new RegExp('\\b(?:P\\.D\\.|PD|Presidential Decree|Presidential Decree No\\.?)(?=\\s|$|[\\.,:;])(?:\\s*(?:No\\.?|#)?\\s*([\\dA-Za-z\\-\\/]+))?', 'i') },
      { keyword: 'A.O.', regex: new RegExp('\\b(?:A\\.O\\.|AO|Administrative Order|Administrative Order No\\.?)(?=\\s|$|[\\.,:;])(?:\\s*(?:No\\.?|#)?\\s*([\\dA-Za-z\\-\\/]+))?', 'i') },
      { keyword: 'B.P.', regex: new RegExp('\\b(?:B\\.P\\.|BP|Batas Pambansa|Batas Pambansa No\\.?)(?=\\s|$|[\\.,:;])(?:\\s*(?:No\\.?|#)?\\s*([\\dA-Za-z\\-\\/]+))?', 'i') },
      { keyword: 'M.C.', regex: new RegExp('\\b(?:M\\.C\\.|MC|Memorandum Circular|Memorandum Circular No\\.?)(?=\\s|$|[\\.,:;])(?:\\s*(?:No\\.?|#)?\\s*([\\dA-Za-z\\-\\/]+))?', 'i') },
      { keyword: 'A.M.', regex: new RegExp('\\b(?:A\\.M\\.|AM|Administrative Matter|Administrative Matter No\\.?)(?=\\s|$|[\\.,:;])(?:\\s*(?:No\\.?|#)?\\s*([\\dA-Za-z\\-\\/]+))?', 'i') },
      { keyword: 'E.O.', regex: new RegExp('\\b(?:E\\.O\\.|EO|Executive Order|Executive Order No\\.?)(?=\\s|$|[\\.,:;])(?:\\s*(?:No\\.?|#)?\\s*([\\dA-Za-z\\-\\/]+))?', 'i') },
      { keyword: 'L.O.', regex: new RegExp('\\b(?:L\\.O\\.|LO|Legislative Order|Legislative Order No\\.?)(?=\\s|$|[\\.,:;])(?:\\s*(?:No\\.?|#)?\\s*([\\dA-Za-z\\-\\/]+))?', 'i') },
      { keyword: 'M.O.', regex: new RegExp('\\b(?:M\\.O\\.|MO|Memorandum Order|Memorandum Order No\\.?)(?=\\s|$|[\\.,:;])(?:\\s*(?:No\\.?|#)?\\s*([\\dA-Za-z\\-\\/]+))?', 'i') },
      { keyword: 'I.D.', regex: new RegExp('\\b(?:I\\.D\\.|ID|Internal Directive|Internal Directive No\\.?)(?=\\s|$|[\\.,:;])(?:\\s*(?:No\\.?|#)?\\s*([\\dA-Za-z\\-\\/]+))?', 'i') },
      { keyword: 'J.A.', regex: new RegExp('\\b(?:J\\.A\\.|JA|Judicial Affidavit|Judicial Affidavit No\\.?)(?=\\s|$|[\\.,:;])(?:\\s*(?:No\\.?|#)?\\s*([\\dA-Za-z\\-\\/]+))?', 'i') },
      { keyword: 'S.R.O.', regex: new RegExp('\\b(?:S\\.R\\.O\\.|SRO|Supreme Court Resolution Order|Supreme Court Resolution Order No\\.?)(?=\\s|$|[\\.,:;])(?:\\s*(?:No\\.?|#)?\\s*([\\dA-Za-z\\-\\/]+))?', 'i') },
      { keyword: 'R.S.', regex: new RegExp('\\b(?:R\\.S\\.|RS|Republic Statute|Republic Statute No\\.?)(?=\\s|$|[\\.,:;])(?:\\s*(?:No\\.?|#)?\\s*([\\dA-Za-z\\-\\/]+))?', 'i') },
      { keyword: 'C.A.R.', regex: new RegExp('\\b(?:C\\.A\\.R\\.|CAR|Court Administrative Rules|Court Administrative Rules No\\.?)(?=\\s|$|[\\.,:;])(?:\\s*(?:No\\.?|#)?\\s*([\\dA-Za-z\\-\\/]+))?', 'i') },
    ];

    for (const p of idPatterns) {
      p.regex.lastIndex = 0;
      if (p.regex.test(s)) return { ok: true, isTitle: true, reason: `matched ${p.keyword}` };
    }

    // Default: not a strict identifier -> use vector search
    return { ok: true, isTitle: false, reason: 'no identifier match' };
  } catch (err) {
    return { ok: false, isTitle: false, reason: String(err?.message || err) };
  }
}

export async function fetchRelevantMatches(query) {
  try {

    log('Querying the database for relevant matches...');
    // Try to extract a law/title-like fragment from the user's query. If one
    // is present, pass a boolean flag to `searchNearest` so it uses the main
    // `query` string as the title filter. Do NOT pass the extracted string
    // itself (avoid fallback rename behavior).
    // Let the LLM decide if this query should be treated as a title-only
    // lookup. If the LLM fails or returns no clear answer, fall back to the
    // existing `extractLawName` heuristic.
    let shouldUseTitleFlag = false;
    try {
      const decision = await decideSearchByTitle(query);
      if (decision && decision.ok) {
        shouldUseTitleFlag = !!decision.isTitle;
        log(`decideSearchByTitle: ${shouldUseTitleFlag} (${decision.reason || 'no reason'})`);
      } else {
        const extractedTitle = (typeof extractLawName === 'function' && extractLawName(query)) || '';
        shouldUseTitleFlag = extractedTitle && String(extractedTitle).trim().length > 0;
      }
    } catch {
      const extractedTitle = (typeof extractLawName === 'function' && extractLawName(query)) || '';
      shouldUseTitleFlag = extractedTitle && String(extractedTitle).trim().length > 0;
    }

    const matches = await searchNearest(query, MAX_MATCHES, { searchByTitle: !!shouldUseTitleFlag });

    log(`Found ${matches.length} total matches.`);

    if (matches.length === 0) {
      return { matches: [], answer: 'No relevant documents found.' };
    }

    const scored = scoreMatches(matches, query, MAX_MATCHES);

    log(`Ranked ${scored.length} matches by relevance score`);

    if (scored.length === 0) {
      return {
        matches: [],
        answer: 'No relevant documents found after filtering.',
      };
    }

    // Build structured items to send to LLM interpreter, but omit any
    // matches where we could not extract a reliable snippet (UNKNOWN_PHRASE)
    const items = [];
    const summaries = [];
    for (let i = 0; i < scored.length; i += 1) {
      const match = scored[i];
      const rawSnippet = await extractRelevantSnippet(match.text || '', query, false);
      const snippet = await formatSnippet(rawSnippet);

      // If snippet is unknown, omit this source entirely from items/summaries
      if (snippet === UNKNOWN_PHRASE) {
        log('fetchRelevantMatches: skipping match due to UNKNOWN_PHRASE', { filename: match.filename, uuid: match.uuid });
        continue;
      }

      const rawLawName = extractLawName(match.text || '');
      const lawName = await formatLawName(rawLawName);
      const fileUrl = extractSource(match);

      summaries.push(`### ${lawName}\n\n"${snippet}"\n\n[View Document](${fileUrl})`);
      items.push({
        id: match.id || null,
        score: typeof match._score !== 'undefined' ? match._score : match.score || null,
        lawName,
        snippet,
        fileUrl,
        originalIndex: i,
        originalMatch: match,
      });
    }

    if (items.length === 0) {
      log('fetchRelevantMatches: no matches with reliable snippets found');
      return { matches: [], answer: 'No relevant documents found.' };
    }

    // Ask the LLM to interpret and recommend most useful documents
    const interpretation = await interpretMatchesWithLLM(items, query);
    log('Interpretation complete');

    // Map LLM interpretation to a set of recommended item indexes (0-based)
    function mapParsedToIndexes(items, parsed) {
      const idxSet = new Set();
      if (!parsed) return idxSet;

      // If the model returned an explicit ranked list of indexes (1-based)
      if (Array.isArray(parsed.ranked) && parsed.ranked.length > 0) {
        for (const rawIndex of parsed.ranked) {
          const n = parseInt(rawIndex, 10);
          if (!Number.isNaN(n)) {
            const idx = n - 1;
            if (idx >= 0 && idx < items.length) idxSet.add(idx);
          }
        }
        if (idxSet.size > 0) return idxSet;
      }

      // If the model returned topDocuments with .index property
      if (Array.isArray(parsed.topDocuments) && parsed.topDocuments.length > 0) {
        for (const doc of parsed.topDocuments) {
          if (typeof doc.index === 'number') {
            const idx = doc.index - 1;
            if (idx >= 0 && idx < items.length) idxSet.add(idx);
          } else if (typeof doc.lawName === 'string') {
            const matchIdx = items.findIndex((it) =>
              (it.lawName || '').toLowerCase().includes(doc.lawName.toLowerCase())
            );
            if (matchIdx !== -1) idxSet.add(matchIdx);
          } else if (typeof doc.supportingSnippet === 'string') {
            const matchIdx = items.findIndex((it) =>
              (it.snippet || '').includes(doc.supportingSnippet)
            );
            if (matchIdx !== -1) idxSet.add(matchIdx);
          }
        }
        if (idxSet.size > 0) return idxSet;
      }

      // Fallback: try matching by any lawName string included in parsed raw JSON
      if (parsed && typeof parsed === 'object') {
        const serialized = JSON.stringify(parsed);
        for (let i = 0; i < items.length; i += 1) {
          const ln = (items[i].lawName || '').toLowerCase();
          if (ln && serialized.toLowerCase().includes(ln)) idxSet.add(i);
        }
      }

      return idxSet;
    }
    const recommendedIndexSet = mapParsedToIndexes(items, interpretation && interpretation.parsed ? interpretation.parsed : null);
    let filteredScored = [];
    let filteredSummaries = [];
    if (recommendedIndexSet.size > 0) {
      // Map back to the original scored entries using items' originalIndex
      const kept = items.filter((_, idx) => recommendedIndexSet.has(idx));
      filteredScored = kept.map((it) => it.originalMatch);
      filteredSummaries = summaries.filter((_, idx) => recommendedIndexSet.has(idx));
      log(`Filtered matches to ${filteredScored.length} items per LLM recommendation`);
    } else {
      // No explicit LLM preference: return all items (already filtered for UNKNOWN_PHRASE)
      filteredScored = items.map((it) => it.originalMatch);
      filteredSummaries = summaries;
      log('No explicit LLM recommendations parsed; returning all matches with reliable snippets');
    }

    // Build a concise summary to display before the full details (Markdown text)
    const briefSummaryMarkdown =
      interpretation && interpretation.brief
        ? `## Brief Summary\n\n${interpretation.brief}\n\n`
        : '';
    const filteredDetailAnswer = filteredSummaries.join('\n\n---\n\n');
    const finalAnswer = `${briefSummaryMarkdown}${filteredDetailAnswer}`;

    // Return filtered matches (only those recommended by LLM), the formatted answer and interpretation
    return {
      matches: filteredScored,
      answer: finalAnswer,
      interpretation,
      originalMatches: scored,
    };
  } catch (error) {
    log(`Error fetching relevant matches: ${error.message}`);
    throw new Error('Failed to fetch relevant matches.');
  }
}
