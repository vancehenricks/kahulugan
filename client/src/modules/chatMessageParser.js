export const FILE_TOKEN_REGEX = /_FILE_:([^\s)>\]]+)/gi;

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

// parse _FILE_: tokens to { uuid, filename, url }
export function parseFileSource(source, serverBaseUrl = '') {
  if (!source) {
    return { uuid: "unknown", filename: String(source), url: String(source) };
  }

  if (typeof source === "string" && source.startsWith("_FILE_:")) {
    const content = source.slice("_FILE_:".length);
    const parts = content.split("/");
    const uuid = parts[0];
    const filename = parts.slice(1).join("/") || uuid;
    // Build a safe URL: if serverBaseUrl provided use it (trim trailing slash),
    // otherwise use a relative API path so code works without configuration.
    const base = serverBaseUrl ? String(serverBaseUrl).replace(/\/$/, '') : '';
    return {
      uuid,
      filename,
      url: base ? `${base}/api/file/${uuid}` : `/api/file/${uuid}`,
    };
  }

  // fallback
  return {
    uuid: "unknown",
    filename: String(source),
    url: String(source),
  };
}