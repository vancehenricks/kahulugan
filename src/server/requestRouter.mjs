import { serveFile } from './handlers/fileHandler.mjs';
import { serveStaticAsset } from './handlers/staticHandler.mjs';
import { serveSuggestions } from './handlers/suggestionsHandler.mjs';

export async function routeRequest(req, res) {
  const { method, url } = req;

  if (method === 'GET' && url.startsWith('/api/file/')) {
    return serveFile(req, res);
  }

  if (method === 'GET' && url === '/api/suggestions') {
    return serveSuggestions(req, res);
  }

  if (method === 'GET' && !url.startsWith('/api/')) {
    return serveStaticAsset(req, res);
  }

  // Not found
  res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: 'Not found' }), 'utf-8');
}
