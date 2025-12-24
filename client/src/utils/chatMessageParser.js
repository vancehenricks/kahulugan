export const FILE_TOKEN_REGEX = /(?:_FILE_:|FILE:)([^\s)>\]]+)/gi;

export function extractFileTokensFromText(text) {
  if (!text || typeof text !== "string") return [];
  const tokens = new Set();
  let m;
  while ((m = FILE_TOKEN_REGEX.exec(text))) {
    tokens.add(m[0]);
  }
  return Array.from(tokens);
}

export function asSourceString(s) {
  if (!s && s !== 0) return null;
  if (typeof s === "string") return s;
  if (s.fileUrl && typeof s.fileUrl === "string") return s.fileUrl;
  return String(s);
}

export function mergeAndDedupeSources(arrSources = [], textTokens = []) {
  const set = new Set();
  const out = [];
  for (const s of arrSources || []) {
    const ss = asSourceString(s);
    if (!ss) continue;
    if (!set.has(ss)) {
      set.add(ss);
      out.push(ss);
    }
  }
  for (const t of textTokens || []) {
    if (!set.has(t)) {
      set.add(t);
      out.push(t);
    }
  }
  return out;
}

export function parseFileSource(source, serverBaseUrl) {
  if (!source) {
    return { uuid: "unknown", filename: String(source), url: String(source) };
  }
  // token form: FILE:uuid/filename or _FILE_: form (client & server sources)
  if (typeof source === "string" && (/^_?FILE_?:/i.test(source))) {
    const content = source.replace(/^_?FILE_?:/i, '');
    const parts = content.split("/");
    const uuid = parts[0];
    const filename = parts.slice(1).join("/") || uuid;
    return {
      uuid,
      filename,
      url: `${serverBaseUrl}/api/file/${uuid}`,
    };
  }
  // If already a server URL, return it
  return { uuid: "unknown", filename: String(source), url: String(source) };
}