export function buildContext(snippets) {
  const parts = [];
  for (let i = 0; i < snippets.length; i++) {
    const body = snippets[i].text ?? '[text unavailable]';
    parts.push(body);
  }
  return parts;
}

export function extractSource(source) {
  const fileUrl = `FILE:${source.uuid}/${source.filename}.txt`;
  return fileUrl;
}

export function extractSources(snippets) {
  const sources = [];
  snippets.forEach((s) => {
    sources.push(extractSource(s));
  });
  return { sources };
}

export const UNKNOWN_PHRASE = 'Insufficient information';

export function isUnknownResponse(response) {
  return (
    response === UNKNOWN_PHRASE ||
    response.includes(UNKNOWN_PHRASE) ||
    response === '(no answer)' ||
    !response ||
    response.trim() === ''
  );
}
