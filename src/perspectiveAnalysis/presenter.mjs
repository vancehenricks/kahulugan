import { validate as validateUuid } from 'uuid';

import { buildContext, isUnknownResponse, UNKNOWN_PHRASE, extractSource } from '../context.mjs';
import { log, warn } from '../logs.mjs';
import { extractLawName } from '../search/lawNameExtractors.mjs';
import { extractRelevantSnippet, formatSnippet, formatLawName } from '../search/snippetExtractors.mjs';

import { identifyParties } from './partyIdentifier.mjs';
import { generatePerspective } from './perspectiveGenerator.mjs';
import { verifyPerspective } from './responseVerifier.mjs';

// Exported helper: renumber inline citations so markdown-style file tokens
// (including malformed LLM outputs) are mapped to a consistent numeric index
export function renumberInlineCitations(text, orderedFileUrls) {
  if (!text || !Array.isArray(orderedFileUrls) || orderedFileUrls.length === 0) return text;

  // Map canonical file URL -> 1-based index
  const fileIdx = new Map(orderedFileUrls.map((u, i) => [u, i + 1]));

  // Helper: determine whether a string looks like a file token (uuid/filename or similar)
  function looksLikeFileToken(s) {
    if (!s || typeof s !== 'string') return false;
    const trimmed = s.trim();
    // common pattern: <uuid>/<filename>
    if (/^[0-9a-fA-F-]{36}\/[^\s]+$/.test(trimmed)) return true;
    // accept FILE: and _FILE_: prefixes
    if (/^(?:_?FILE_?:)[^\s]+$/i.test(trimmed)) return true;
    return false;
  }

  let out = String(text);

  // Normalize common malformed FILE token patterns produced by LLMs
  // Example: [4](FILE:uuid/path.txt]  ->  [4](FILE:uuid/path.txt)
  out = out.replace(/\(\s*(_?FILE_?:[^\)\]]+)\]/gi, '($1)');

  // 1) Handle markdown links: [text](href)
  out = out.replace(/\[([^\]]*?)\]\(([^)]+)\)/g, (match, _inner, href) => {
    let canonicalHref = String(href).split('#')[0].trim();

    // Normalize any leading FILE: or _FILE_: to canonical FILE: token
    if (canonicalHref.toUpperCase().startsWith('FILE:') || canonicalHref.toUpperCase().startsWith('_FILE_:')) {
      canonicalHref = `FILE:${canonicalHref.replace(/^_?FILE_?:/i, '').replace(/^\/+/, '')}`;
    }

    // If href looks like a bare file token, canonicalize to FILE: token format
    if (!canonicalHref.startsWith('FILE:') && looksLikeFileToken(canonicalHref)) {
      // strip any leading slashes and ensure the FILE: prefix
      canonicalHref = canonicalHref.startsWith('FILE:')
        ? `FILE:${canonicalHref.replace(/^[Ff][Ii][Ll][Ee]:/, '').replace(/^\/+/, '')}`
        : `FILE:${canonicalHref.replace(/^\/+/, '')}`;
    }

    // direct mapping
    const idx = fileIdx.get(canonicalHref);
    if (idx) return `[${idx}](${canonicalHref})`;

    // Relaxed matching (allow leading slash differences)
    for (const [key, value] of fileIdx.entries()) {
      if (key === canonicalHref || key.replace(/^\//, '') === canonicalHref.replace(/^\//, '')) {
        return `[${value}](${canonicalHref})`;
      }
    }

    // No match, leave as-is
    return match;
  });

  // 2) Handle bare bracket tokens like [uuid/filename] (no parentheses)
  out = out.replace(/\[([^\]]+?)\]/g, (match, inner) => {
    if (!looksLikeFileToken(inner)) return match;
    const canonical = inner.trim().startsWith('FILE:') || inner.trim().startsWith('_FILE_:') ? inner.trim().replace(/^_?FILE_?:/i, 'FILE:') : `FILE:${inner.trim().replace(/^\/+/, '')}`;
    const idx = fileIdx.get(canonical);
    if (idx) return `[${idx}](${canonical})`;
    // try relaxed matching
    for (const [key, value] of fileIdx.entries()) {
      if (key === canonical || key.replace(/^\//, '') === canonical.replace(/^\//, '')) {
        return `[${value}](${canonical})`;
      }
    }
    return match;
  });

  return out;
}

export async function presenterPresent(question, plan, snippets) {
  // Count total characters before starting
  const questionChars = question.length;
  const planChars = JSON.stringify(plan).length;
  const snippetsChars = snippets.reduce((sum, s) => sum + JSON.stringify(s).length, 0);
  const totalChars = questionChars + planChars + snippetsChars;

  log('Starting presenter');
  log(`  Question: ${questionChars} characters`);
  log(`  Plan: ${planChars} characters`);
  log(`  Snippets (${snippets.length} items): ${snippetsChars} characters`);
  log(`  Total input: ${totalChars} characters`);
  log('Starting presenter with', snippets.length, 'snippets');

  const parties = await identifyParties(question);

  log(`Party A (${parties.partyARole}): ${parties.partyA}`);
  log(`Party B (${parties.partyBRole}): ${parties.partyB}`);

  // Build a CONTEXT similar to the QnA flow: include file tokens and short
  // snippets so the LLM can include inline citations like FILE:uuid/filename.
  const contextChunks = [];
  const fileUrls = [];
  const sources = [];
  for (const s of snippets || []) {
    try {
      const rawSnippet = await extractRelevantSnippet(s.text || '', question);
      const snippet = await formatSnippet(rawSnippet);
      const rawLawName = extractLawName(s && s.text ? s.text : '');
      const lawName = (await formatLawName(rawLawName)) || 'Document';
      const fileUrl = extractSource(s);
      // Omit sources where snippet extraction failed (UNKNOWN_PHRASE)
      if (snippet === UNKNOWN_PHRASE) {
        log('Presenter: skipping snippet/source due to UNKNOWN_PHRASE', { filename: s.filename, uuid: s.uuid });
        continue;
      }

      // Skip entries with missing or placeholder filenames or invalid UUIDs
      const filenameStr = (s.filename || '').toString().trim();
      if (!filenameStr || ['filename', 'filename.txt'].includes(filenameStr.toLowerCase())) {
        warn('Presenter: skipping snippet due to missing or placeholder filename', { filename: s.filename, uuid: s.uuid });
        continue;
      }
      if (!validateUuid(s.uuid)) {
        warn('Presenter: skipping snippet due to invalid uuid', { filename: s.filename, uuid: s.uuid });
        continue;
      }

      fileUrls.push(fileUrl);
      const date = s.date ? String(s.date) : 'unknown';
      const summary = s.summary ? String(s.summary) : '';
      sources.push({ fileUrl, lawName, uuid: s.uuid, filename: s.filename, date, summary });
      // Include date and summary metadata to allow the model to prioritize recent documents when synthesizing
      contextChunks.push(`##${fileUrl}\nDate: ${date}\nSummary: ${summary}\n\n${snippet}\n`);
    } catch (err) {
      warn('Presenter: snippet formatting failed for snippet', s && s.filename, err?.message || err);
    }
  }

  const contextText = contextChunks.length > 0 ? contextChunks.join('\n---\n') : (Array.isArray(buildContext(snippets)) ? buildContext(snippets).join('\n') : String(buildContext(snippets)));

  const today = process.env.RAG_TODAY;
  const constitution = process.env.RAG_CONSTITUTION;

  log('Context prepared:', (contextText && contextText.length) || 0, 'characters');

  const prosecutorQuestion = plan.perspectiveQuestions?.prosecutor || question;
  const defenseQuestion = plan.perspectiveQuestions?.defense || question;
  const judgeQuestion = plan.perspectiveQuestions?.judge || question;

  const requestedPerspectives = plan.requestedPerspectives || ['prosecutor', 'defense', 'judge'];

  try {
    log('Starting generation for requested perspectives:', requestedPerspectives.join(', '));

    const responses = {};

    if (requestedPerspectives.includes('prosecutor')) {
      log('Generating prosecutor perspective...');
      responses.prosecutor = await generatePerspective({
        perspective: 'prosecutor',
        question,
        perspectiveQuestion: prosecutorQuestion,
        context: contextText,
        today,
        constitution,
        planNotes: plan.perspectivePlans?.prosecutor?.notes,
        partyA: parties.partyA,
        partyB: parties.partyB,
      });
      log(`Prosecutor response: ${String(responses.prosecutor).length} characters`);

      // verify prosecutor alignment
      try {
        await verifyPerspective({
          question,
          perspectiveName: 'prosecutor',
          perspectiveText: responses.prosecutor,
          context: contextText,
        });
      } catch (err) {
        log('Prosecutor validation failed:', err);
      }
    }

    if (requestedPerspectives.includes('defense')) {
      log('Generating defense perspective...');
      responses.defense = await generatePerspective({
        perspective: 'defense',
        question,
        perspectiveQuestion: defenseQuestion,
        context: contextText,
        today,
        constitution,
        planNotes: plan.perspectivePlans?.defense?.notes,
        partyA: parties.partyA,
        partyB: parties.partyB,
      });
      log(`Defense response: ${String(responses.defense).length} characters`);

      // verify defense alignment
      try {
        await verifyPerspective({
          question,
          perspectiveName: 'defense',
          perspectiveText: responses.defense,
          context: contextText,
        });
      } catch (err) {
        log('Defense validation failed:', err);
      }
    }

    // Judge gets prosecutor and defense context
    if (requestedPerspectives.includes('judge')) {
      log('Generating judge perspective...');

      let judgeContext = contextText;

      // Add prosecutor and defense analyses to judge context
      if (responses.prosecutor && !isUnknownResponse(responses.prosecutor)) {
        judgeContext += `\n\n[${parties.partyA} (PROSECUTOR) ARGUMENTS]\n${responses.prosecutor}`;
      }

      if (responses.defense && !isUnknownResponse(responses.defense)) {
        judgeContext += `\n\n[${parties.partyB} (DEFENSE) ARGUMENTS]\n${responses.defense}`;
      }

      responses.judge = await generatePerspective({
        perspective: 'judge',
        question,
        perspectiveQuestion: judgeQuestion,
        context: judgeContext,
        today,
        constitution,
        planNotes: plan.perspectivePlans?.judge?.notes,
        partyA: parties.partyA,
        partyB: parties.partyB,
      });
      log(`Judge response: ${String(responses.judge).length} characters`);

      // verify judge alignment
      try {
        await verifyPerspective({
          question,
          perspectiveName: 'judge',
          perspectiveText: responses.judge,
          context: judgeContext,
        });
      } catch (err) {
        log('Judge validation failed:', err);
      }
    }

    log('All requested perspective responses completed');

    const allResponses = Object.values(responses);
    if (allResponses.every(isUnknownResponse)) {
      log('All responses indicate insufficient information');
      return UNKNOWN_PHRASE;
    }

    log('Building final response');

    let response = `**Query:** ${question}\n\n`;
    response += `**Parties:**\n`;
    response += `- **${parties.partyA}** (${parties.partyARole})\n`;
    response += `- **${parties.partyB}** (${parties.partyBRole})\n\n`;

    if (requestedPerspectives.includes('prosecutor')) {
      response += `---\n\n`;
      response += `## ${parties.partyA} Position\n\n`;
      response += `${responses.prosecutor}\n\n`;

      if (responses.prosecutorValidation && !responses.prosecutorValidation.matches) {
        response += `**Validation issues (prosecutor):**\n`;
        for (const issue of responses.prosecutorValidation.issues || []) {
          response += `- ${issue}\n`;
        }
        if (responses.prosecutorValidation.summary) {
          response += `\nSummary: ${responses.prosecutorValidation.summary}\n\n`;
        }
      }
    }

    if (requestedPerspectives.includes('defense')) {
      response += `---\n\n`;
      response += `## ${parties.partyB} Position\n\n`;
      response += `${responses.defense}\n\n`;

      if (responses.defenseValidation && !responses.defenseValidation.matches) {
        response += `**Validation issues (defense):**\n`;
        for (const issue of responses.defenseValidation.issues || []) {
          response += `- ${issue}\n`;
        }
        if (responses.defenseValidation.summary) {
          response += `\nSummary: ${responses.defenseValidation.summary}\n\n`;
        }
      }
    }

    if (requestedPerspectives.includes('judge')) {
      response += `---\n\n`;
      response += `## Judicial Analysis (${parties.partyA} vs ${parties.partyB})\n\n`;
      response += `${responses.judge}\n\n`;

      if (responses.judgeValidation && !responses.judgeValidation.matches) {
        response += `**Validation issues (judge):**\n`;
        for (const issue of responses.judgeValidation.issues || []) {
          response += `- ${issue}\n`;
        }
        if (responses.judgeValidation.summary) {
          response += `\nSummary: ${responses.judgeValidation.summary}\n\n`;
        }
      }
    }

    log('Final response completed:', response.length, 'characters');


    const renumbered = renumberInlineCitations(response, fileUrls);
    return renumbered;
  } catch (error) {
    // Extract a concise, user-friendly error message while avoiding stack traces.
    let rawMsg = 'Unknown error';
    try {
      if (error && typeof error === 'object') {
        rawMsg = error.message || (JSON.stringify(error) !== '{}' ? JSON.stringify(error) : String(error));
      } else {
        rawMsg = String(error);
      }
    } catch {
      rawMsg = 'Unknown error';
    }

    const sanitized = String(rawMsg).replace(/\s+/g, ' ').trim().slice(0, 600);
    // Log a sanitized message for user-facing logs and a full trace for dev logs (if available).
    warn('Error generating analysis (user):', sanitized);
    if (error && error.stack) log('Error generating analysis (stack):', error.stack);

    // Return a helpful message so the user can correct input or retry.
    return `Error generating analysis: ${sanitized}. Please review your inputs and try again.`;
  }
}
