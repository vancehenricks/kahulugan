import http from 'http';

import { WebSocketServer } from 'ws';

import { connectDb, closeDb } from './src/db.mjs';
import { log } from './src/logs.mjs';
import { applyCorsPolicy, handlePreflight } from './src/server/requestProcessor.mjs';
import { routeRequest } from './src/server/requestRouter.mjs';
import { handleWebSocket } from './src/server/wsHandler.mjs';

const PORT = process.env.RAG_PORT;
const HOST = process.env.RAG_HOST;

async function handleRequest(req, res) {
  applyCorsPolicy(req, res);
  if (handlePreflight(req, res)) return;
  await routeRequest(req, res);
}

async function main() {
  await connectDb();
  log('Database connected');

  const server = http.createServer(handleRequest);
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws, req) => {
    handleWebSocket(ws, req);
  });

  server.listen(PORT, HOST, () => {
    console.log(`Server running at http://${HOST}:${PORT}`);
  });

  process.on('SIGINT', async () => {
    log('\nShutting down...');
    server.close();
    await closeDb();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
