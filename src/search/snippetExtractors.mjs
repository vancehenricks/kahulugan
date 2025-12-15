// Handles snippet extraction and formatting

import { UNKNOWN_PHRASE } from '../context.mjs';
import { formatDocument } from '../formatter/formatter.mjs';
import { openai } from '../llm.mjs';
import { log } from '../logs.mjs';

const USE_LLM_SNIPPET = process.env.USE_LLM_SNIPPET === '1' || process.env.USE_LLM_SNIPPET === 'true';

export async function extractRelevantSnippet(text, query, useLLM = USE_LLM_SNIPPET) {
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [];
  const queryWords = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3);

  if (sentences.length === 0) {
    log('extractRelevantSnippet: no sentences found; returning UNKNOWN_PHRASE', {
      method: 'no-sentences',
    });
    return UNKNOWN_PHRASE;
  }

  // If LLM mode is enabled, try LLM extraction first; on failure, fall back to heuristics
  if (useLLM) {
    try {
      const llm = await extractRelevantSnippetWithLLM(text, query, 300);
      if (llm && llm.trim() && llm !== UNKNOWN_PHRASE) {
        const out = llm.length > 300 ? llm.substring(0, 300) + '...' : llm;
        log('extractRelevantSnippet: returning snippet', {
          method: 'llm',
          length: out.length,
          preview: out.slice(0, 300),
        });
        return out;
      } else {
        log('extractRelevantSnippet: LLM returned no reliable snippet; falling back to heuristics', {
          method: 'llm-no-snippet',
        });
        // fall through to heuristic below
      }
    } catch (e) {
      log('extractRelevantSnippet: LLM snippet attempt failed; falling back to heuristics', e?.message || e);
      // fall through to heuristic below
    }
  }

  // LLM disabled: use heuristic (keyword-based sentence matching)
  const scoredSentences = sentences.map((sentence, idx) => {
    const lowerSentence = sentence.toLowerCase();
    const matchCount = queryWords.filter((word) => lowerSentence.includes(word)).length;
    return { sentence: sentence.trim(), score: matchCount, index: idx };
  });

  const topSentence = scoredSentences
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 1)[0];

  if (!topSentence) {
    log('extractRelevantSnippet: no keyword matches found; returning UNKNOWN_PHRASE', {
      method: 'no-snippet',
    });
    return UNKNOWN_PHRASE;
  }

  const finalSnippet = topSentence.sentence;
  const out = finalSnippet.length > 300 ? finalSnippet.substring(0, 300) + '...' : finalSnippet;
  log('extractRelevantSnippet: returning snippet', {
    method: 'heuristic',
    length: out.length,
    preview: out.slice(0, 200),
  });
  return out;
}

// LLM-backed snippet extraction: returns a short (<=300 chars) snippet
// that best answers the `query` using only the provided `text`.
// Uses chunking to scan the entire document.
export async function extractRelevantSnippetWithLLM(text, query, maxChars = 300) {
  try {
    if (!text || !text.trim()) return '';
    
    const CHUNK_SIZE = parseInt(process.env.SNIPPET_CHUNK_SIZE || '1100000', 10);
    const CHUNK_OVERLAP = parseInt(process.env.SNIPPET_CHUNK_OVERLAP || '500', 10);
    const MAX_CHUNKS = parseInt(process.env.SNIPPET_MAX_CHUNKS || '20', 10);
    
    // Split text into overlapping chunks
    let chunks = [];
    for (let i = 0; i < text.length; i += CHUNK_SIZE - CHUNK_OVERLAP) {
      chunks.push(text.slice(i, i + CHUNK_SIZE));
    }

    if (chunks.length > MAX_CHUNKS) {
      log('extractRelevantSnippetWithLLM: chunk count', chunks.length, 'exceeds MAX_CHUNKS', MAX_CHUNKS, '- truncating');
      chunks = chunks.slice(0, MAX_CHUNKS);
    }

    log('extractRelevantSnippetWithLLM: processing', chunks.length, 'chunks');
    
    // Include the output length constraint directly in the system and user prompt
    const system = {
      role: 'system',
      content: [
        'You are a legal assistant that extracts relevant passages from documents.',
        'Given a document and a question, find and return the most relevant passage (1-3 sentences) that helps answer the question.',
        'Extract the passage as it appears in the document, maintaining its exact wording.',
        'If no relevant passage exists, return empty.',
        'Return ONLY the passage text - no labels, quotes, or explanations.',
      ].join(' '),
    };

    // Process chunks sequentially and stop at first good snippet
    let candidate = '';
    for (let idx = 0; idx < chunks.length; idx++) {
      const chunk = chunks[idx];
      const user = {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Question: ${query}\n\nDocument:\n${chunk}\n\nExtract the most relevant passage (max ${maxChars} chars) that helps answer this question. Return only the passage text, or empty if nothing is relevant.`,
          },
        ],
      };

      try {
        const completion = await openai.chat.completions.create({
          model: 'ibm-granite/granite-4.0-h-micro',
          messages: [system, user],
          temperature: 0.0,
          max_output_tokens: 200,
        });

        const raw = completion?.choices?.[0]?.message?.content ?? '';
        const snippet = String(raw || '').trim();
        
        log(`extractRelevantSnippetWithLLM: chunk ${idx+1}/${chunks.length} raw response:`, {
          length: snippet.length,
          preview: snippet.slice(0, 100),
        });
        
        if (snippet && snippet.length > 0) {
          candidate = snippet;
          log(`extractRelevantSnippetWithLLM: found snippet in chunk ${idx}/${chunks.length}`);
          break; // Stop at first good snippet
        }
      } catch (err) {
        log(`extractRelevantSnippetWithLLM: chunk ${idx} failed:`, err?.message || err);
        // Continue to next chunk on error
      }
    }
    
    if (!candidate) {
      log('extractRelevantSnippetWithLLM: no snippets found across all chunks');
      return UNKNOWN_PHRASE;
    }

    // Remove code fences and surrounding quotes if model included them
    candidate = candidate.replace(/```[\s\S]*?```/g, '').trim();
    candidate = candidate.replace(/^["'`]+|["'`]+$/g, '').trim();

    // Collapse whitespace to single spaces
    candidate = candidate.replace(/\s+/g, ' ');

    log('extractRelevantSnippetWithLLM: after cleanup', {
      length: candidate.length,
      preview: candidate.slice(0, 100),
    });

    // If the model explicitly says there's no relevant passage, treat as empty
    if (/no relevant passage|no relevant text|no relevant snippet|nothing relevant|no passage exists|no match/i.test(candidate)) {
      log('extractRelevantSnippetWithLLM: LLM indicated no relevant passage; returning UNKNOWN_PHRASE');
      return UNKNOWN_PHRASE;
    }

    // Only reject if completely empty or pure punctuation (not short text)
    if (candidate.length === 0 || /^[^\w]+$/.test(candidate)) {
      log('extractRelevantSnippetWithLLM: LLM candidate empty or non-informative; returning UNKNOWN_PHRASE');
      return UNKNOWN_PHRASE;
    }

    // Truncate defensively and ensure we return verbatim-like text
    const truncated = candidate.length > maxChars ? candidate.slice(0, maxChars).trim() : candidate;

    log('extractRelevantSnippetWithLLM: LLM returned candidate', {
      length: truncated.length,
      preview: truncated.slice(0, 200),
    });

    return truncated;
  } catch (err) {
    log('LLM snippet extraction failed:', err?.message || err);
    return UNKNOWN_PHRASE;
  }
}

export async function formatSnippet(snippet) {
  try {
    const formatted = await formatDocument(snippet);
    return formatted
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/\n+/g, ' ')
      .replace(/([.!?])\s+\.\.\./g, '$1')
      .replace(/"\s+/g, '"')
      .replace(/\s+"/g, '"');
  } catch (error) {
    log(`Error formatting snippet: ${error.message}`);
    return snippet
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/\n+/g, ' ')
      .replace(/([.!?])\s+\.\.\./g, '$1')
      .replace(/"\s+/g, '"')
      .replace(/\s+"/g, '"');
  }
}

export async function formatLawName(lawName) {
  try {
    const formatted = await formatDocument(lawName);
    return formatted.trim().replace(/\s+/g, ' ').replace(/\n+/g, ' ').substring(0, 200);
  } catch (error) {
    log(`Error formatting law name: ${error.message}`);
    return lawName.trim().replace(/\s+/g, ' ').replace(/\n+/g, ' ').substring(0, 200);
  }
}
