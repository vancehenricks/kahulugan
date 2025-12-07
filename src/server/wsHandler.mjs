import { log, error } from '../logs.mjs';

import { handlePerspectiveAnalysis } from './wsHandlers/analysisHandler.mjs';
import { handleQA } from './wsHandlers/qaHandler.mjs';
import { handleSearch } from './wsHandlers/searchHandler.mjs';
import { sendError } from './wsHandlers/utils.mjs';


export function handleWebSocket(ws, req) {
  const remote = req?.socket?.remoteAddress || 'unknown';
  // Deny cross-origin WebSocket connections: allow only same-host or local origins
  const origin = req.headers.origin || '';
  const host = (req.headers.host || '').split(':')[0];
  const isLocalOrigin =
    !origin ||
    origin.includes('localhost') ||
    origin.includes('127.0.0.1') ||
    (host && origin.includes(host));

  if (!isLocalOrigin) {
    log(`Rejecting WebSocket connection from cross-origin ${origin} (remote ${remote})`);
    try {
      // 1008 = Policy Violation
      ws.close(1008, 'Cross-origin connections not allowed');
    } catch (e) {
      error('Error closing cross-origin WebSocket', e?.message || e);
    }
    return;
  }

  log(`WebSocket connection from ${remote}`);

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data);
      // Accept clientState and clientPayload and keep for logging or passing to QA
      const { type, query, clientState, perspective } = message;

      log('Received WebSocket message:', { type, query, clientState });

      if (type === 'search') {
        await handleSearch(ws, { query });
      } else if (type === 'qa') {
        await handleQA(ws, { query, clientState });
      } else if (type === 'perspective-analysis') {
        await handlePerspectiveAnalysis(ws, { query, perspective });
      } else {
        sendError(ws, 'unsupported message type');
      }
    } catch (err) {
      error('WebSocket error:', err);
      try {
        // Do not send internal error details to the client; send a generic message
        sendError(ws, 'Internal server error');
      } catch (sendErr) {
        error('Failed to send WebSocket error:', sendErr);
      }
    }
  });

  ws.on('close', () => {
    log('WebSocket connection closed');
  });

  ws.on('error', (err) => {
    error('WebSocket socket error:', err);
  });
}
