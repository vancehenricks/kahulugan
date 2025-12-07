export class TimeoutError extends Error {
  constructor(message = 'Timeout') {
    super(message);
    this.name = 'TimeoutError';
    this.code = 'TIMEOUT';
  }
}

export function withTimeout(promise, ms, message = 'Timeout') {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new TimeoutError(message)), ms)
    ),
  ]);
}

export function sendJSON(ws, payload) {
  try {
    ws.send(JSON.stringify(payload));
  } catch {
    // If ws.send throws we'll let the caller handle logs
  }
}

export function sendStatus(ws, message) {
  sendJSON(ws, { type: 'status', message });
}

export function sendError(ws, message) {
  sendJSON(ws, { type: 'error', message });
}