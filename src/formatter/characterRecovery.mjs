export function analyzeCharacterContext(text) {
  const problematicChars = [];

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const code = char.charCodeAt(0);

    if (code === 0xfffd || (code < 32 && code !== 9 && code !== 10 && code !== 13)) {
      const before = text.substring(Math.max(0, i - 30), i);
      const after = text.substring(i + 1, Math.min(text.length, i + 31));

      problematicChars.push({
        index: i,
        code: `U+${code.toString(16).toUpperCase().padStart(4, '0')}`,
        before,
        after,
        context: before + '[?]' + after,
      });
    }
  }

  return problematicChars;
}

export function recoverCharacter(before, after) {
  const beforeLower = before.toLowerCase();
  const afterLower = after.toLowerCase();

  if (/section|rule|article|chapter/i.test(beforeLower) && /^\s*\d/.test(after)) {
    return '§';
  }

  if (/\w$/.test(before) && /^\w/.test(after)) {
    return '-';
  }

  if (/\(|\s$/.test(before) && /^\w|\d/.test(after)) {
    return '–';
  }

  if (/[\w"]$/.test(before) && /^s\b/.test(afterLower)) {
    return "'";
  }

  if (/\b\w$/.test(before) && /^\w/.test(afterLower)) {
    return "'";
  }

  if (/^\s*(i|ii|iii|iv|v|vi)\.?\s/.test(afterLower)) {
    return '°';
  }

  return /\w$/.test(before) && /^\w/.test(after) ? '-' : ' ';
}

export function repairTextEncoding(text) {
  const problematicChars = analyzeCharacterContext(text);

  if (problematicChars.length === 0) {
    return { text, recovered: [] };
  }

  let repaired = text;
  const recovered = [];

  for (let i = problematicChars.length - 1; i >= 0; i--) {
    const char = problematicChars[i];
    const replacement = recoverCharacter(char.before, char.after);

    repaired = repaired.substring(0, char.index) + replacement + repaired.substring(char.index + 1);
    recovered.push({
      index: char.index,
      original: char.code,
      replacement,
      context: char.context,
    });
  }

  return { text: repaired, recovered };
}
