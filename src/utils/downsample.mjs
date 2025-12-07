// Deterministic downsample function shared across import and query code
export function downsampleEmbedding(embedding, targetDim) {
  if (!Array.isArray(embedding)) return embedding;
  const origDim = embedding.length;
  if (!targetDim || targetDim >= origDim) return embedding.slice();

  const out = new Array(targetDim).fill(0);
  for (let i = 0; i < targetDim; i++) {
    const start = Math.floor((i * origDim) / targetDim);
    const end = Math.floor(((i + 1) * origDim) / targetDim);
    if (end <= start) {
      out[i] = Number(embedding[Math.min(start, origDim - 1)]) || 0;
      continue;
    }
    let sum = 0;
    for (let j = start; j < end; j++) sum += Number(embedding[j]) || 0;
    out[i] = sum / Math.max(1, end - start);
  }
  return out;
}
