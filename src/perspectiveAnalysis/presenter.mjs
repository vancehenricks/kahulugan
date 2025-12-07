import { buildContext, isUnknownResponse, UNKNOWN_PHRASE, extractSource } from '../context.mjs';
import { log, warn } from '../logs.mjs';
import { extractLawName } from '../search/lawNameExtractors.mjs';
import { extractRelevantSnippet, formatSnippet, formatLawName } from '../search/snippetExtractors.mjs';

import { identifyParties } from './partyIdentifier.mjs';
import { generatePerspective } from './perspectiveGenerator.mjs';
import { verifyPerspective } from './responseVerifier.mjs';

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
  // snippets so the LLM can include inline citations like [_FILE_:uuid/filename].
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

      fileUrls.push(fileUrl);
      sources.push({ fileUrl, lawName, uuid: s.uuid, filename: s.filename });
      contextChunks.push(`##${fileUrl}\n\n${snippet}\n`);
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

    // Renumber inline citations to match the order of `fileUrls` included in the CONTEXT
    function renumberInlineCitations(text, orderedFileUrls) {
      if (!text || !Array.isArray(orderedFileUrls) || orderedFileUrls.length === 0) return text;
      const fileIdx = new Map(orderedFileUrls.map((u, i) => [u, i + 1]));
      return String(text).replace(/\[([^\]]*?)\]\((_FILE_:[^)]+)\)/g, (match, _inner, href) => {
        const canonicalHref = String(href).split('#')[0].trim();
        const idx = fileIdx.get(canonicalHref);
        if (idx) return `[${idx}](${href})`;
        for (const [key, value] of fileIdx.entries()) {
          if (key === canonicalHref || key.replace(/^\//, '') === canonicalHref.replace(/^\//, '')) {
            return `[${value}](${href})`;
          }
        }
        return match;
      });
    }

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
