import crypto from 'crypto';


import { pgClient } from '../db.mjs';
import { openai } from '../llm.mjs';
import { log, warn } from '../logs.mjs';

const CACHE_DURATION_DAYS = 7;

// We intentionally do not perform any external scraping.
// For predictability and privacy, suggestions are generated from a generic
// Philippine-focused prompt rather than fetching current headlines.

// No external scraping: we will generate generic Philippine-focused examples.

async function getCachedSuggestions() {
  try {
    const result = await pgClient.query(`SELECT date FROM suggestions_meta WHERE id = 1`);

    if (result.rows.length === 0) {
      return null;
    }

    const cachedDate = new Date(result.rows[0].date);
    const now = new Date();
    const daysDiff = Math.floor((now - cachedDate) / (1000 * 60 * 60 * 24));

    if (daysDiff < CACHE_DURATION_DAYS) {
      log(`Using cached suggestions from ${daysDiff} days ago`);
      return true;
    }

    log(`Cache expired (${daysDiff} days old), fetching new suggestions`);
    return null;
  } catch (error) {
    warn('Failed to check cache:', error.message);
    return null;
  }
}

async function storeSuggestions(suggestions) {
  try {
    // Delete all existing suggestions
    await pgClient.query(`DELETE FROM suggestions`);

    // Store each suggestion as three separate entries (question, keywords, scenario)
    for (const suggestion of suggestions) {
      // Store question
      await pgClient.query(`INSERT INTO suggestions (id, name, category) VALUES ($1, $2, $3)`, [
        crypto.randomUUID(),
        suggestion.question,
        'question',
      ]);

      // Store keywords
      await pgClient.query(`INSERT INTO suggestions (id, name, category) VALUES ($1, $2, $3)`, [
        crypto.randomUUID(),
        suggestion.keywords,
        'keywords',
      ]);

      // Store scenario
      await pgClient.query(`INSERT INTO suggestions (id, name, category) VALUES ($1, $2, $3)`, [
        crypto.randomUUID(),
        suggestion.scenario,
        'scenario',
      ]);
    }

    // Update or insert the suggestions_meta last-updated timestamp
    await pgClient.query(
      `INSERT INTO suggestions_meta (id, date) VALUES (1, CURRENT_TIMESTAMP)
       ON CONFLICT (id) DO UPDATE SET date = CURRENT_TIMESTAMP`
    );

    log(`Stored ${suggestions.length} suggestions (${suggestions.length * 3} total entries)`);
    return true;
  } catch (error) {
    warn('Failed to store suggestions:', error.message);
    return false;
  }
}

export async function generateSuggestions() {
  // Check cache first
  const cached = await getCachedSuggestions();
  if (cached) {
    try {
      const result = await pgClient.query(
        `SELECT name, category FROM suggestions ORDER BY category`
      );
      if (result.rows.length > 0) {
        // Group results by category
        const suggestions = [];
        const groupedByCategory = {};

        // Group all rows by category
        for (const row of result.rows) {
          if (!groupedByCategory[row.category]) {
            groupedByCategory[row.category] = [];
          }
          groupedByCategory[row.category].push(row.name);
        }

        // Match questions with keywords and scenarios
        const questions = groupedByCategory['question'] || [];
        const keywords = groupedByCategory['keywords'] || [];
        const scenarios = groupedByCategory['scenario'] || [];

        for (let i = 0; i < questions.length; i++) {
          if (keywords[i] && scenarios[i]) {
            suggestions.push({
              question: questions[i],
              keywords: keywords[i],
              scenario: scenarios[i],
            });
          }
        }

        if (suggestions.length > 0) {
          log('Returning cached suggestions');
          return suggestions;
        }
      }
    } catch (error) {
      warn('Failed to retrieve cached suggestions:', error.message);
    }
  }

  // Cache is expired or doesn't exist - generate fresh, generic Philippine-focused examples
  log('Cache expired or missing, generating generic Philippine-focused examples...');
  const eventsText = 'General legal matters and typical issues in the Philippines (no external scraping).';

  const system = {
    role: 'system',
    content: [
      'You are a legal question generator.',
      'Generate 10 practical, thought-provoking legal questions relevant to the Philippines.',
      'For each question, also generate topic keywords and a two-party legal scenario.',
      '',
      'GEOGRAPHIC FOCUS: All questions and scenarios MUST be directly relevant to the Philippines and Philippine law, policy, or institutions.',
      "ANONYMIZATION: Replace all personal names (private individuals and public figures) and all company/brand/group names with role/placeholders. Use 'Private Person' for private individuals, 'Public Official' for named public officials, 'Religious Group' for religious organizations, and 'Company' for private firms and brands. Preserve names of official government institutions and international institutions (e.g., 'Supreme Court', 'ICC', 'Department of Justice'). DO NOT include any personal or commercial names in your output.",
      'TOPIC KEYWORDS: Use 2-4 short keywords per question',
      'Examples of keywords:',
      '  - Criminal: homicide, fraud, theft, perjury, evidence, due process',
      '  - Civil: liability, damages, contract, negligence, tort, property',
      '  - Constitutional: rights, due process, free speech, equal protection',
      '  - Labor: wrongful dismissal, overtime, discrimination, benefits',
      '  - Commercial: breach, competition, unfair trade, liability',
      '  - Administrative: regulatory, compliance, appeals, jurisdiction',
      '',
      'SCENARIO FORMAT: Provide a short, story-like two-party scenario (4-6 sentences; aim for 150-350 characters) that fully describes the situation. Include: a brief setting (place & approximate date), the anonymized parties (use placeholders), the contested event(s) or conduct, key facts (dates, amounts, notices, or documents), the claimed legal basis (e.g., breach of contract, constitutional claim, regulatory violation), the immediate remedy sought (e.g., injunction, damages, administrative relief), and finish with a one-sentence summary that articulates the legal question or dispute.',
      "ANONYMIZATION REMINDER: Replace all personal/company names with placeholders (e.g., 'Private Person', 'Public Official', 'Company') while preserving official institution names (Supreme Court, DOJ, ICC, etc.).",
      'Use clear, concrete facts and avoid open-ended hypotheticals; the scenario should read like a short factual paragraph that a lawyer can immediately reason about.',
      '- Use action words: seeks to, sues, accuses, prosecutes, charges, files complaint against, removes, regulates.',
      "- Format guidance: Start with '[Party Type A] [action] [Party Type B]' followed by concise factual context and the legal basis and remedy requested. End with a one-sentence summary that articulates the legal question in plain language.",
      '',
      // STRONGER, clearer instructions to avoid fences and extraneous text
      'CRITICAL: Return EXACTLY a single, valid raw JSON array (no indentation or formatting restrictions), and nothing else. No markdown code fences, no leading/trailing text, no comments, no timestamps, no language tags, and no extra explanation or headings. Do NOT include triple backticks or the text "```json". If you are unable to provide valid JSON that meets the exact schema below, return an empty array [] and nothing else.',
      '',
      'Required format - respond with EXACTLY this structure (10 items):',
      '[{"question": "...", "keywords": "keyword1, keyword2, keyword3", "scenario": "..."}, {...}]',
      '',
      'Each question must be a string (1-2 sentences max).',
      'Keywords must be a comma-separated string of 2-4 short keywords.',
      'Scenario must be 4-6 short sentences in the Party A vs Party B format, anonymized as specified.',
      'Return exactly 10 objects in the array.',
    ].join('\n'),
  };

  const userContent = [
    {
      type: 'text',
        text: `Generate 10 legal questions with keywords and scenarios relevant to the Philippines (do NOT fetch or reference external headlines).\n\n${eventsText}\n\nREMEMBER: Return ONLY a raw JSON array and nothing else. Do NOT include markdown code blocks, any introductory or trailing text, or triple backticks. Output must be directly parseable by JSON.parse().`,
    },
  ];

  const user = {
    role: 'user',
    content: userContent,
  };

  try {
    log('Generating legal questions (Philippine-focused examples)...');

    const completion = await openai.chat.completions.create({
      model: 'google/gemini-2.0-flash-001',
      messages: [system, user],
      max_tokens: 2048,
      // Low temperature for deterministic, precise outputs and to reduce formatting variations
      temperature: 0.0,
    });

    const raw = completion?.choices?.[0]?.message?.content ?? '';
    log('LLM response received:', raw.substring(0, 100));

    const suggestions = parseJsonResponse(raw);
    log('Suggestions parsed:', suggestions.length);

    if (!suggestions || suggestions.length === 0) {
      warn('No suggestions generated.');
      return [];
    }

    log(`Generated ${suggestions.length} suggestions`);

    // Store in database (this will delete old suggestions and store new ones)
    await storeSuggestions(suggestions);
    log('Suggestions stored in database');

    // Return all three fields for API
    return suggestions;
  } catch (error) {
    warn('Suggestion generation failed:', error.message);
    return [];
  }
}

function parseJsonResponse(raw) {
  let json = null;

  // Defensive step: strip common Markdown code fences if accidentally returned
  try {
    raw = String(raw || '').trim();
    raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  } catch {
    // ignore non-string inputs
  }

  // try direct parse
  try {
    console.log('Parsing JSON response (direct):', raw.substring(0, 200));
    json = JSON.parse(raw);
  } catch (err) {
    console.warn('Direct JSON.parse failed:', err?.message || err);
    // try to extract the first JSON array in the string
    const firstBracket = raw.indexOf('[');
    const lastBracket = raw.lastIndexOf(']');
    if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
      try {
        const candidate = raw.slice(firstBracket, lastBracket + 1);
        console.log('Attempting parse of bracket-delimited candidate (trimmed):', candidate.substring(0, 200));
        json = JSON.parse(candidate);
      } catch (err2) {
        console.warn('Bracket-delimited parse failed:', err2?.message || err2);
        json = null;
      }
    }
  }

  // If full-array parsing failed, attempt to extract objects individually (robust extractor)
  if (!Array.isArray(json)) {
    try {
      const objs = [];
      const s = raw;
      const len = s.length;
      let i = 0;

      while (i < len) {
        // find next '{' that is not obviously part of a JSON code block delimiter
        const startIdx = s.indexOf('{', i);
        if (startIdx === -1) break;

        let j = startIdx + 1;
        let depth = 1;
        let inString = false;

        for (; j < len; j++) {
          const ch = s[j];

          if (inString) {
            if (ch === '\\') {
              j++; // skip escaped char
              continue;
            }
            if (ch === '"') {
              inString = false;
            }
            continue;
          } else {
            if (ch === '"') {
              inString = true;
              continue;
            }
            if (ch === '{') {
              depth++;
              continue;
            }
            if (ch === '}') {
              depth--;
              if (depth === 0) {
                const candidateObj = s.slice(startIdx, j + 1);
                // try to parse this candidate object; if it fails, attempt a mild repair
                try {
                  const parsed = JSON.parse(candidateObj);
                  objs.push(parsed);
                } catch {
                  // mild repair: remove trailing commas like {...,} and try again
                  const repaired = candidateObj.replace(/,\s*}/g, '}');
                  try {
                    const parsed2 = JSON.parse(repaired);
                    objs.push(parsed2);
                  } catch {
                    // ignore unparseable candidate
                  }
                }
                i = j + 1;
                break;
              }
            }
          }
        }

        // if for-loop finished without closing the object, no balanced object found; break
        if (j >= len) break;
      }

      if (objs.length > 0) {
        json = objs;
      } else {
        json = null;
      }
    } catch (ex) {
      console.warn('Object-extraction fallback failed:', ex?.message || ex);
      json = null;
    }
  }

  // Defensive fallback if model didn't return valid JSON
  if (!Array.isArray(json)) {
    warn('Suggestion parse failed');
    return [];
  }

  // ensure structure - filter out empty strings
  return json
    .slice(0, 10)
    .filter((s) => s && typeof s === 'object')
    .map((s) => ({
      question: typeof s.question === 'string' ? s.question.trim() : '',
      keywords: typeof s.keywords === 'string' ? s.keywords.trim() : 'general',
      scenario: typeof s.scenario === 'string' ? s.scenario.trim() : '',
    }))
    .filter((s) => s.question.length > 0 && s.scenario.length > 0);
}
