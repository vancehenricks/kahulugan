import {
  addMessage,
  createThinkingBubble,
  replaceThinkingWithAnswer,
  editThinkingBubble,
} from "./chatMessages.js";

// Use same-origin websocket URL by default (no env variable required).
// If the client and server are hosted on the same origin this simply works.
const SERVER_WS = (() => {
  try {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}`;
  } catch {
    // Fallback to an empty string; connection will fail and the client will retry.
    return '';
  }
})();
let ws = null;
let wsReadyPromise = null;
let wsReadyResolve = null;
let reconnectTimer = null;
const RECONNECT_DELAY = 3000;
// When set, the client will not attempt to reconnect and will prevent new sends
let rateLimited = false;

const pending = new Map();

function connectWebSocket() {
  // teardown previous ws
  if (ws) {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
    ws = null;
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  wsReadyPromise = new Promise((resolve) => {
    wsReadyResolve = resolve;
  });

  try {
    ws = new WebSocket(SERVER_WS);
  } catch (err) {
    console.error("Failed create WebSocket:", err);
    scheduleReconnect();
    return;
  }

  console.log("Connecting to WebSocket:", SERVER_WS);

  ws.onopen = () => {
    console.log("WebSocket connected");
    if (wsReadyResolve) {
      wsReadyResolve();
      wsReadyResolve = null;
    }
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      let payload = null;
      if (msg?.question) {
        payload = {
          question: msg.question,
          answer: msg.answer,
          sources: msg.sources || [],
        };
      } else if (msg?.type === "error") {
        const errMsg = String(msg.message || 'Unknown');

        // Detect structured rate-limit responses from the server and handle specially
        // Prefer explicit `code: 'RATE_LIMIT'` but still support legacy text matching.
        if (msg?.code === 'RATE_LIMIT' || /request limit reached/i.test(errMsg)) {
          rateLimited = true;
          // If there's a pending request, map the error to it; otherwise add to chat
          if (pending.size > 0) {
            const entries = Array.from(pending.entries());
            const [lastKey, lastEntry] = entries[entries.length - 1] || [];
            if (lastEntry && lastEntry.thinkingEl) {
              replaceThinkingWithAnswer({ thinkingEl: lastEntry.thinkingEl, answerText: `${errMsg}`, sources: [] });
              pending.delete(lastKey);
            }
          } else {
            addMessage(`Error: ${errMsg}`, "error");
          }

          // Close the connection and avoid automatic reconnects
          try {
            if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
              ws.close(1008, 'Daily limit reached');
            }
          } catch {
            /* ignore */
          }

          return;
        }

        // Non-rate-limit errors: map to pending thinking bubble if present, otherwise log
        if (pending.size > 0) {
          const entries = Array.from(pending.entries());
          const [lastKey, lastEntry] = entries[entries.length - 1] || [];
          if (lastEntry && lastEntry.thinkingEl) {
            replaceThinkingWithAnswer({ thinkingEl: lastEntry.thinkingEl, answerText: `Error: ${errMsg}`, sources: [] });
            pending.delete(lastKey);
            return;
          }
        }

        addMessage(`Error: ${errMsg}`, "error");
        return;
      } else if (msg?.type === "status") {
        console.log("Status update:", msg.message);
        editThinkingBubble(msg.message);
        return;
      } else {
        addMessage(JSON.stringify(msg), "assistant");
        return;
      }

      const key = String(payload.question).trim();
      if (!key) {
        addMessage(payload.answer || "No answer", "assistant", false, payload.sources || []);
        return;
      }

      const entry = pending.get(key);
      const combinedAnswer = (payload.answer || "").trim();

      if (entry) {
        replaceThinkingWithAnswer({
          thinkingEl: entry.thinkingEl,
          answerText: combinedAnswer || "No answer returned.",
          sources: payload.sources || [],
        });
        pending.delete(key);
      } else {
        // Show sources for messages that arrive outside of a pending request
        addMessage(combinedAnswer, "assistant", false, payload.sources || []);
      }
    } catch (err) {
      console.error("Error handling WS message:", err);
    }
  };

  ws.onerror = (err) => {
    console.error("WebSocket error:", err);
    addMessage("WebSocket connection error", "error");
  };

  ws.onclose = () => {
    console.log("WebSocket disconnected");
    // Replace all pending thinking bubbles with an error
    for (const [, entry] of pending) {
      replaceThinkingWithAnswer({
        thinkingEl: entry.thinkingEl,
        answerText: "Connection closed before response was received.",
        sources: [],
      });
    }
    pending.clear();
    scheduleReconnect();
  };
}

function scheduleReconnect() {
  // If we've been rate-limited, do not reconnect automatically
  if (rateLimited) return;
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectWebSocket();
  }, RECONNECT_DELAY);
}

async function ensureWsOpen() {
  if (rateLimited) throw new Error('Connection disabled due to daily limit');
  if (
    !ws ||
    ws.readyState === WebSocket.CLOSED ||
    ws.readyState === WebSocket.CLOSING
  ) {
    connectWebSocket();
  }
  if (ws && ws.readyState === WebSocket.OPEN) return;
  await Promise.race([
    wsReadyPromise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("WebSocket connection timeout")), 5000),
    ),
  ]);
}

// Snapshot localStorage into a plain object for sending with the QA payload
function snapshotLocalStorage() {
  const obj = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      obj[key] = localStorage.getItem(key);
    }
  } catch (err) {
    console.warn("Failed to snapshot localStorage:", err);
  }
  return obj;
}

export async function sendMessage(e) {
  if (e && e.preventDefault) e.preventDefault();

  const input = document.querySelector("#messageInput");
  const sendBtn = document.querySelector("#sendBtn");

  // Enforce single outstanding message: if there's a pending request, do not allow another send
  if (pending.size > 0) {
    try {
      // Inform the user briefly
      addMessage('Please wait for the previous response before sending another message.', 'error');
    } catch {
      /* ignore */
    }
    return;
  }

  // If the client has been flagged as rate-limited, do not attempt to send and inform the user
  if (rateLimited) {
    addMessage('Error: Connection disabled due to daily limit. Please try again tomorrow.', 'error');
    return;
  }

  const question = input.value.trim();
  if (!question) return;

  addMessage(question, "user");
  input.value = "";
  input.style.height = "";

  input.disabled = true;
  sendBtn.disabled = true;
  window.autoScrollEnabled = true;

  const currentMode = window.currentMode;
  const thinkingEl = createThinkingBubble();
  // No client-side timeout: wait for backend to respond.
  pending.set(question, { thinkingEl });

  try {
    await ensureWsOpen();

    // Build the payload for the server; include localStorage snapshot & metadata if mode === 'qa'
    const basePayload = {
      type:
        currentMode === "search"
          ? "search"
          : currentMode === "qa"
            ? "qa"
            : "perspective-analysis",
      query: question,
    };

    // Add selected perspective for perspective-analysis or QA (optional)
    if (currentMode === "perspective-analysis" && window.selectedPerspectives) {
      basePayload.perspective = window.selectedPerspectives;
    }

    // If QA, include a snapshot of localStorage and client payload metadata
    if (currentMode === "qa") {
      const snapshot = snapshotLocalStorage();
      // Try to extract our message history from localStorage (used by chatMessages)
      let messages = null;
      try {
        const raw = snapshot['rag_chat_messages'];
        if (raw) messages = JSON.parse(raw);
      } catch {
        messages = null;
      }
      // Send structured client state: provide messages array (if available) and full snapshot for debugging
      basePayload.clientState = { ...(messages ? { messages } : {}), localStorage: snapshot };
    }

    if (import.meta.env.DEV) {
      // Helpful debug: output the payload when developing so we can confirm clientState is included
      console.log('WS payload (clientState preview):', basePayload.clientState ? { ...basePayload, clientState: { messages: basePayload.clientState.messages ? basePayload.clientState.messages.slice(-5) : undefined } } : basePayload);
    }
    ws.send(JSON.stringify(basePayload));
  } catch (err) {
    console.warn("WebSocket send failed:", err);

    replaceThinkingWithAnswer({
      thinkingEl,
      answerText: "WebSocket error: failed to send message. Please try again.",
      sources: [],
    });

    const entry = pending.get(question);
    if (entry) {
      pending.delete(question);
    }

    scheduleReconnect();
  } finally {
    input.disabled = false;
    sendBtn.disabled = false;
    if (!input.disabled) input.focus();
  }
}

connectWebSocket();
