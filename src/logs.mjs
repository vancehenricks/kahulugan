const MAX_LOG_LENGTH = 500;
const MAX_OBJECT_DEPTH = 3;

function truncateString(str, maxLength = MAX_LOG_LENGTH) {
  if (typeof str !== 'string') return str;
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength) + `... [truncated ${str.length - maxLength} chars]`;
}

function formatArg(arg, depth = 0) {
  if (depth > MAX_OBJECT_DEPTH) return '[Object]';

  if (typeof arg === 'string') {
    return truncateString(arg);
  }

  if (typeof arg === 'object' && arg !== null) {
    if (Array.isArray(arg)) {
      const items = arg.slice(0, 5).map((item) => formatArg(item, depth + 1));
      if (arg.length > 5) items.push(`... ${arg.length - 5} more`);
      return `[${items.join(', ')}]`;
    }

    // Redact obvious secret-like keys to avoid accidental leakage
    const isSecretKey = (k) => /pass(word)?|secret|api(key)?|token|auth|authorization|pwd/i.test(k);

    const keys = Object.keys(arg).slice(0, 5);
    const pairs = keys.map((k) => {
      try {
        if (isSecretKey(k)) return `${k}: [REDACTED]`;
        return `${k}: ${formatArg(arg[k], depth + 1)}`;
      } catch {
        return `${k}: [unavailable]`;
      }
    });
    if (Object.keys(arg).length > 5) pairs.push(`... ${Object.keys(arg).length - 5} more keys`);
    return `{${pairs.join(', ')}}`;
  }

  return String(arg);
}

export function log(...args) {
  const timestamp = new Date().toISOString();
  const formatted = args.map((arg) => formatArg(arg));
  console.log(`[${timestamp}]`, ...formatted);
}

export function warn(...args) {
  const timestamp = new Date().toISOString();
  const formatted = args.map((arg) => formatArg(arg));
  console.warn(`[${timestamp}]`, ...formatted);
}

export function error(...args) {
  const timestamp = new Date().toISOString();
  const formatted = args.map((arg) => formatArg(arg));
  console.error(`[${timestamp}]`, ...formatted);
}
