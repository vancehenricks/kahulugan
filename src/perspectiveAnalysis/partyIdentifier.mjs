import { openai } from '../llm.mjs';
import { warn } from '../logs.mjs';

export async function identifyParties(question) {
  const system = {
    role: 'system',
    content: `You are a legal party identifier. Extract the two main parties from the legal question.

OUTPUT FORMAT (strict):
Party A Name: [name]
Party A Role: [role]
Party B Name: [name]
Party B Role: [role]

Use standard legal roles like Complainant/Plaintiff, Respondent/Defendant, etc.
If unclear, use Party A and Party B with Complainant/Plaintiff and Respondent/Defendant.

IMPORTANT: Do NOT include any extra text, explanation, or commentary. Return only the four lines in the exact OUTPUT FORMAT above.`,
  };

  const user = {
    role: 'user',
    content: `Extract parties from: "${question}"`,
  };

  try {
    const completion = await openai.chat.completions.create({
      model: 'google/gemini-2.0-flash-001',
      messages: [system, user],
      max_tokens: 100,
      temperature: 0.1,
    });

    const response = completion?.choices?.[0]?.message?.content?.trim() || '';

    const partyAMatch = response.match(/Party A Name:\s*(.+)/i);
    const partyARoleMatch = response.match(/Party A Role:\s*(.+)/i);
    const partyBMatch = response.match(/Party B Name:\s*(.+)/i);
    const partyBRoleMatch = response.match(/Party B Role:\s*(.+)/i);

    return {
      partyA: partyAMatch ? partyAMatch[1].trim() : 'Party A',
      partyB: partyBMatch ? partyBMatch[1].trim() : 'Party B',
      partyARole: partyARoleMatch ? partyARoleMatch[1].trim() : 'Complainant/Plaintiff',
      partyBRole: partyBRoleMatch ? partyBRoleMatch[1].trim() : 'Respondent/Defendant',
    };
  } catch (error) {
    warn('Party identification failed:', error.message);
    return {
      partyA: 'Party A',
      partyB: 'Party B',
      partyARole: 'Complainant/Plaintiff',
      partyBRole: 'Respondent/Defendant',
    };
  }
}
