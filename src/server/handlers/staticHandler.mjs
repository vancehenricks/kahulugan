import fs from 'fs';
import path from 'path';

import { error } from '../../logs.mjs';

const DIST_DIR = path.join(process.cwd(), 'client', 'dist');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

export function serveStaticAsset(req, res) {
  let filePath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  filePath = path.join(DIST_DIR, filePath);
  const resolvedPath = path.resolve(filePath);

  if (!resolvedPath.startsWith(path.resolve(DIST_DIR))) {
    res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Forbidden' }), 'utf-8');
    return;
  }

  try {
    const stat = fs.statSync(resolvedPath);
    if (stat.isDirectory()) {
      filePath = path.join(resolvedPath, 'index.html');
    }
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': getMimeType(filePath) });
    res.end(content);
  } catch (err) {
    if (err.code === 'ENOENT') {
      try {
        const indexPath = path.join(DIST_DIR, 'index.html');
        const content = fs.readFileSync(indexPath);
        res.writeHead(200, { 'Content-Type': MIME_TYPES['.html'] });
        res.end(content);
      } catch {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Not found' }), 'utf-8');
      }
    } else {
      // Log the internal error server-side (message truncated by logger)
      error('Static handler error:', err?.message || String(err));
      // Do not return internal error details to clients; return a generic message
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Internal server error' }), 'utf-8');
    }
  }
}
