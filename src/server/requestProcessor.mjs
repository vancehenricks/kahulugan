export function applyCorsPolicy(/* req, res */) {
  // Intentionally do not set any CORS headers.
  // This server disallows cross-origin requests. Keep this function as a
  // no-op so callers don't need to change, but no Access-Control headers
  // will be emitted.
  return;
}

export function handlePreflight(req, res) {
  if (req.method === 'OPTIONS') {
    // Check origin: allow if absent or same-host/local; otherwise deny.
    const origin = req.headers.origin || '';
    const host = (req.headers.host || '').split(':')[0];

    const isLocalOrigin =
      origin === '' ||
      origin.includes('localhost') ||
      origin.includes('127.0.0.1') ||
      (host && origin.includes(host));

    if (!isLocalOrigin) {
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'CORS requests are not allowed' }), 'utf-8');
      return true;
    }

    // For same-origin or absent Origin, treat preflight as handled but do
    // not emit CORS response headers.
    res.writeHead(200);
    res.end();
    return true;
  }
  return false;
}

export function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString('utf-8');
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
  });
}
