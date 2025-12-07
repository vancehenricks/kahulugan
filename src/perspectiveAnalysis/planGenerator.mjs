import { openai } from '../llm.mjs';
import { warn } from '../logs.mjs';

import { PERSPECTIVE_INSTRUCTIONS } from './perspectiveInstructions.mjs';

export async function createPerspectivePlan(params) {
  const { perspective, perspectiveQuestion, today, constitution } = params;
  const current = PERSPECTIVE_INSTRUCTIONS[perspective];

  const system = {
    role: 'system',
    content: [
      `You are ${current.planRole} in ${constitution} constitution. Today: ${today}.`,
      `Research plan for: ${current.planFocus}`,
      'OUTPUT: Valid JSON ONLY with exactly these keys:',
      '  { "searches": [ { "query": "...", "k": 5 } ], "notes": "string" }',
      'Do NOT include any other text, explanation, or formatting.',
      'Use specific statute names, article numbers, legal concepts.',
      'Keep searches short and focused (1-2 queries).',
      'Keep notes concise (1-2 sentences max).',
    ].join(' '),
  };

  const user = {
    role: 'user',
    content: `Create research plan for ${current.planRole}\nPerspective: ${perspectiveQuestion}\nReturn JSON only.`,
  };

  try {
    const completion = await openai.chat.completions.create({
      model: 'google/gemini-2.0-flash-001',
      messages: [system, user],
      max_tokens: 512,
      temperature: 0.2,
    });

    const raw = completion?.choices?.[0]?.message?.content ?? '';
    let json = parseJsonResponse(raw, perspective, perspectiveQuestion);

    json.perspectiveQuestion = perspectiveQuestion;
    return json;
  } catch (error) {
    warn(`${perspective} plan failed:`, error.message);
    return {
      searches: [{ query: perspectiveQuestion, k: 5 }],
      notes: `Fallback plan (error) for ${perspective}`,
      perspectiveQuestion,
    };
  }
}

function parseJsonResponse(raw, perspective, perspectiveQuestion) {
  let json = null;

  // try direct parse
  try {
    json = JSON.parse(raw);
  } catch {
    // try to extract the first JSON object in the string
    const firstBrace = raw.indexOf('{');
    const lastBrace = raw.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      try {
        json = JSON.parse(raw.slice(firstBrace, lastBrace + 1));
      } catch {
        json = null;
      }
    }
  }

  // Defensive fallback if model didn't return valid JSON
  if (!json || typeof json !== 'object') {
    warn(`${perspective} plan parse failed. Raw response: ${raw.substring(0, 200)}`);
    json = {
      searches: [{ query: perspectiveQuestion, k: 5 }],
      notes: `Fallback plan for ${perspective}. Use the rewritten question as search query.`,
    };
  }

  // ensure structure
  if (!Array.isArray(json.searches)) {
    json.searches = [{ query: perspectiveQuestion, k: 5 }];
  } else {
    json.searches = json.searches.slice(0, 2).map((s) => ({
      query: s && s.query && s.query.trim() ? s.query.trim() : perspectiveQuestion,
      k: Math.min(5, s?.k || 5),
    }));
  }

  if (!json.notes || typeof json.notes !== 'string') {
    json.notes = `Plan for ${perspective}`;
  }

  return json;
}
