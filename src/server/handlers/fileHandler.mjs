import fs from 'fs';
import path from 'path';

import { validate } from 'uuid';

import { pgClient } from '../../db.mjs';
import { formatDocument } from '../../formatter/formatter.mjs';
import { log, error } from '../../logs.mjs';

const CORPUS_DIR = process.env.RAG_CORPUS_PATH;

async function retrieveDocumentFiles(uuid) {
  return pgClient.query(
    'SELECT filename, relative_path FROM documents WHERE uuid = $1 LIMIT 1',
    [uuid]
  );
}

export async function serveFile(req, res) {
  const uuid = req.url.slice('/api/file/'.length).split('?')[0];

  if (!validate(uuid)) {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Invalid UUID format' }), 'utf-8');
    return;
  }

  try {
    const result = await retrieveDocumentFiles(uuid);

    if (result.rows.length === 0) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Document not found' }), 'utf-8');
      return;
    }

    const { filename, relative_path } = result.rows[0];
    const filePath = path.join(CORPUS_DIR, relative_path, `${filename}.txt`);
    const resolvedPath = path.resolve(filePath);
    const resolvedSampleDir = path.resolve(CORPUS_DIR);

    if (!resolvedPath.startsWith(resolvedSampleDir)) {
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Forbidden' }), 'utf-8');
      return;
    }

    let content = fs.readFileSync(resolvedPath, 'utf-8');
    log(`File served: ${uuid}`);
    content = await formatDocument(content);

    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(content, 'utf-8');
  } catch (err) {
    // Log internal error server-side but avoid leaking internal error details to clients
    error('File handler error:', err?.message || String(err));
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Internal server error' }), 'utf-8');
  }
}
