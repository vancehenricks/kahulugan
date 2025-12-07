import { openai } from '../llm.mjs';
import { log, warn } from '../logs.mjs';

/**
 * Role-specific checklist to guide verification
 */
function getChecklistForPerspective(name, partyA = 'Party A', partyB = 'Party B') {
  const map = {
    prosecutor: [
      `Identifies the plaintiff (${partyA}) and articulates the cause(s) of action`,
      'Presents statutes/articles supporting the claims (by name or citation)',
      'Specifies or requests particular remedies or relief',
      'Identifies core evidence or testimony needed',
    ],
    defense: [
      `Identifies the defendant (${partyB}) and the primary defenses`,
      'References constitutional protections or procedural safeguards relevant to the defense',
      'Challenges evidentiary sufficiency and burden of proof',
      'Notes possible procedural or jurisdictional defenses',
    ],
    judge: [
      'Impartial judicial analysis weighing both sides',
      'Identifies controlling statutes/articles/precedent',
      'Addresses standards of proof and evidentiary considerations',
      'Recommends procedural steps or likely rulings',
    ],
    default: [
      'Directly addresses the question',
      'Uses only provided CONTEXT for factual claims',
      'Does not invent facts',
    ],
  };

  return map[name] || map.default;
}

/**
 * Verifies whether a generated perspective response actually answers the
 * question provided and uses only the given context for factual claims.
 *
 * Returns an object:
 *  { matches: boolean, issues: [string], summary: string, roleChecks: { [check]: boolean }, unverifiedClaims: [] }
 */
export async function verifyPerspective({
  question,
  perspectiveName,
  perspectiveText,
  context,
  partyA = 'Party A',
  partyB = 'Party B',
}) {
  try {
    const checklist = getChecklistForPerspective(perspectiveName, partyA, partyB);

    const system = {
      role: 'system',
      content:
        'You are a concise verifier. Use ONLY the provided CONTEXT. Do not invent facts, do not provide legal opinions; only verify alignment and factual grounding.',
    };

    const user = {
      role: 'user',
      content: [
        `QUESTION: ${question}`,
        `PERSPECTIVE: ${perspectiveName}`,
        `PERSPECTIVE_TEXT: ${perspectiveText}`,
        `CONTEXT:\n${context}`,
        '',
        'Task: Answer only with a JSON object (no extra text). The JSON must be parsable and include:',
        `  {"matches": boolean, "issues": ["short strings describing problems"], "summary": "brief note", "roleChecks": {"check text": boolean}, "unverifiedClaims": ["list"]}`,
        '',
        'Perform the following checks:',
        `- Check each of the following role-specific items and mark true/false for each:`,
        checklist.map((c, i) => `  ${i + 1}. ${c}`).join('\n'),
        '- Identify any factual claims in PERSPECTIVE_TEXT that are not found in CONTEXT (list them under unverifiedClaims).',
        '- If the perspective does not directly answer the original QUESTION, add an issue explaining what is missing.',
        '- If everything is fine, return matches=true and an empty issues array.',
        'Return compact JSON only.',
      ].join('\n'),
    };

    const completion = await openai.chat.completions.create({
      model: 'google/gemini-2.0-flash-001',
      messages: [system, user],
      temperature: 0.0,
      max_output_tokens: 512,
    });

    const raw = completion?.choices?.[0]?.message?.content ?? '';
    let jsonText = raw.trim();
    const jsonStart = jsonText.indexOf('{');
    const jsonEnd = jsonText.lastIndexOf('}');
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      jsonText = jsonText.slice(jsonStart, jsonEnd + 1);
    }

    let parsed = null;
    try {
      parsed = JSON.parse(jsonText);
    } catch (parseErr) {
      warn('responseVerifier: JSON parse failed', parseErr.message || parseErr, 'raw:', raw);
      return {
        matches: false,
        issues: ['Verifier could not parse model response', (parseErr.message || String(parseErr)).slice(0, 200)],
        summary: 'Verifier failure: parse error',
        roleChecks: {},
        unverifiedClaims: [],
      };
    }

    // Ensure expected shape and defaults
    const result = {
      matches: !!parsed.matches,
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      summary: String(parsed.summary || '').trim(),
      roleChecks:
        parsed.roleChecks && typeof parsed.roleChecks === 'object' ? parsed.roleChecks : {},
      unverifiedClaims: Array.isArray(parsed.unverifiedClaims) ? parsed.unverifiedClaims : [],
    };

    // If roleChecks are empty, build a basic roleChecks from checklist using heuristics
    if (!Object.keys(result.roleChecks).length) {
      result.roleChecks = {};
      const lowerText = String(perspectiveText || '').toLowerCase();
      for (const check of checklist) {
        // quick heuristic: check for simple keywords
        const keywords = check
          .toLowerCase()
          .split(/[,/\s]+/)
          .filter(Boolean)
          .slice(0, 6);
        result.roleChecks[check] = keywords.some((k) => k.length > 2 && lowerText.includes(k));
      }
    }

    log(
      `verifyPerspective ${perspectiveName}: matches=${result.matches}, issues=${result.issues.length}, roleChecks=${
        Object.values(result.roleChecks).filter(Boolean).length
      }/${Object.keys(result.roleChecks).length}`
    );
    return result;
  } catch (err) {
    const rawMsg = (err && (err.message || String(err))) || 'Unknown verifier error';
    const sanitized = String(rawMsg).replace(/\s+/g, ' ').trim().slice(0, 600);
    warn('verifyPerspective failed:', sanitized);
    return {
      matches: false,
      issues: [`Verifier error: ${sanitized}`],
      summary: `Verifier error: ${sanitized}`,
      roleChecks: {},
      unverifiedClaims: [],
    };
  }
}
