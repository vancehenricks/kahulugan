import OpenAI from 'openai';

const API_KEY = process.env.OPENROUTER_KEY;
if (!API_KEY) {
  console.error('Missing API key. Export OPENROUTER_KEY and retry.');
  process.exit(1);
}

const openai = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: API_KEY,
});

export { openai };

export async function getQueryEmbedding(text) {
  const res = await openai.embeddings.create({
    model: 'qwen/qwen3-embedding-8b',
    input: text,
  });
  return res?.data?.[0]?.embedding ?? null;
}
