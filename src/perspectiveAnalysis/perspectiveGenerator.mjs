import { UNKNOWN_PHRASE } from '../context.mjs';
import { openai } from '../llm.mjs';
import { log, warn } from '../logs.mjs';

export async function generatePerspective({
  perspective,
  question,
  perspectiveQuestion,
  context,
  today,
  constitution,
  planNotes,
  partyA,
  partyB,
}) {
  // Defensive normalization: ensure `context` is always a string before any string ops.
  try {
    if (typeof context !== 'string') {
      if (Array.isArray(context)) {
        context = context.join('\n');
      } else {
        // Use JSON.stringify so that objects produce readable content
        context = JSON.stringify(context || {}, null, ' ');
      }
    }
  } catch {
    // Fallback: make sure we at least have a string
    context = String(context || '');
  }

  // truncate context to avoid passing extremely large payloads to the LLM if needed
  const MAX_CONTEXT_CHARS = 50_000;
  if (context.length > MAX_CONTEXT_CHARS) {
    context = context.slice(0, MAX_CONTEXT_CHARS);
  }

  function getRoleSpec(name) {
    const specs = {
      prosecutor: {
        role: `Counsel for ${partyA || 'Plaintiff'}`,
        instruction: `You represent ${partyA || 'Plaintiff'} (complainant/plaintiff). Build their case against ${partyB || 'Defendant'}.`,
        focus: `Identify applicable statutes/articles, direct evidence, remedies, and procedural steps favorable to ${partyA || 'Plaintiff'}.`,
      },
      defense: {
        role: `Counsel for ${partyB || 'Defendant'}`,
        instruction: `You represent ${partyB || 'Defendant'} (respondent/defendant). Defend them against claims by ${partyA || 'Plaintiff'}.`,
        focus: `Identify defenses, constitutional protections, evidentiary weaknesses in the opposing case, and procedural defenses for ${partyB || 'Defendant'}.`,
      },
      judge: {
        role: 'Presiding Judge',
        instruction: `Provide an impartial judicial analysis of the dispute between ${partyA || 'Party A'} and ${partyB || 'Party B'}.`,
        focus: `State the controlling statutes/articles, relevant precedent, standards of proof, and procedural considerations for both sides.`,
      },
    };

    if (!name) return null;
    return (
      specs[name] || {
        role: `${name}`,
        instruction: `Act as ${name}. Analyze the question and context from this role.`,
        focus: `Analyze the facts and legal issues through the lens of ${name}. Identify relevant laws, evidentiary needs, strengths, weaknesses, and practical next steps.`,
      }
    );
  }

  const spec = getRoleSpec(perspective) || {
    role: 'Legal Analyst',
    instruction: 'Act as a neutral legal analyst and provide reasoned analysis.',
    focus:
      'Identify applicable law, potential arguments, evidentiary needs, and recommended next steps.',
  };

  const planNotesSection = planNotes ? `\n\nRESEARCH NOTES FROM PLANNER:\n${planNotes}` : '';

  const contextSnippet = (context || '').slice(0, 800).replace(/\s+/g, ' '); // short fingerprint

  const system = {
    role: 'system',
    content: [
      `You are ${spec.role}.`,
      spec.instruction,
      `Focus areas: ${spec.focus}`,
      // Instruct the model to cite using the project's internal file tokens
      // so that answers can include clickable references to the source files.
      // Use the same inline link format used by the QnA flow.
      // eslint-disable-next-line no-useless-escape
      'Cite supporting source(s) using numbered inline link citations that are clickable Markdown links in the format [n](_FILE_:uuid/filename.txt) (e.g., [1](_FILE_:uuid/filename.txt), [2](_FILE_:uuid/filename2.txt), [3](_FILE_:uuid/filename.txt) etc..).',
      `Context: Use only the provided CONTEXT to make factual claims, cite statutes, case names, and dates.`,
      // Explicitly prevent the model from echoing meta-markers
      "Do NOT include the literal token '[CONTEXT]' or other bracketed context markers (e.g., [CONTEXT]) in your answer. Do not append or repeat context labels or placeholders — reference facts directly and cite using the numbered inline link format described above.",
      'Summary: Do NOT hallucinate or invent facts. If the CONTEXT lacks key facts to support a claim, respond exactly with: ' +
        `"${UNKNOWN_PHRASE}"`,
      "Direct Answer: Begin with a concise, direct answer (1-2 sentences) that addresses the user's legal question as phrased in the Scenario.",
      'Recommendations Requirement: After the analysis, include 3-5 concrete, prioritized recommendations or next steps (legal and practical). For each recommendation, explain precisely how the cited laws, facts, or documents in CONTEXT support it and identify any immediate actions to implement it.',
      'Provide a concise structured answer with the following sections where applicable:',
      'Summary: One or two sentences summarizing the short answer to the question based on CONTEXT.',
      '1. Applicable Law: list exact statutes/articles/constitutional provisions (with section/article numbers and dates where available) and explain why each law could be helpful—i.e., what factual problem or legal element it addresses and what remedy or defense it supports in the current factual scenario.',
      '2. Analysis: For each law or supporting document you cite, provide a role-specific, reasoned analysis with both supporting and opposing arguments that are explicitly tied to that law or document. Make clear exactly which facts or passages in the provided CONTEXT support or undermine each argument, and avoid making general or ambiguous claims.',
      '3. Recommendations / Relief: practical steps or remedies and how the cited laws would support them. List 3-5 prioritized recommendations: (a) immediate steps, (b) mid-term actions, and (c) contingency/defensive options. For each recommendation, indicate the supporting law or specific passage in CONTEXT and an estimated urgency/priority.',
      '4. Key Uncertainties: facts/documents needed to be more certain (identify what to collect or verify in CONTEXT).',
      'Avoid conversational openings and filler; be precise and cite only what exists in CONTEXT.',
      'Use only the provided CONTEXT for facts or citations.',
      `Context summary (short): ${contextSnippet}`,
    ].join(' '),
  };

  const user = {
    role: 'user',
    content: [
      {
        type: 'text',
        text: `constitution: (${constitution || 'N/A'}, date: ${today || 'N/A'})\nScenario: ${question}\nPerspective: ${perspectiveQuestion || perspective || spec.role}${planNotesSection}\n\nCONTEXT:\n${context}\n\nAnalyze from the perspective of ${spec.role}. For each cited statute, article, case, or supporting document: explain why it could be helpful to the client's position and provide supporting and opposing arguments that directly reference specific passages or facts in CONTEXT.`,
      },
    ],
  };

  try {
    log(`Generating perspective (${perspective || 'generic'}) for question`);

    const completion = await openai.chat.completions.create({
      model: 'google/gemini-2.5-flash',
      messages: [system, user],
      temperature: 0.2,
    });

    const response = completion?.choices?.[0]?.message?.content ?? '(no answer)';
    log(`Perspective (${perspective || 'generic'}) generated (${response.length} chars)`);
    return response;
  } catch (error) {
    warn(`Perspective (${perspective || 'generic'}) generation failed:`, error?.message || error);
    return '(no answer)';
  }
}
