import { marked } from "marked";

import { escapeHtml, autoScroll } from "../utils/dom.js";

import { sendMessage } from "./chatSend.js";
import { loadFileContent, setHighlightTerms } from "./fileViewer.js";

// Server base URL removed; detect server file URLs via '/api/file/' path
const STORAGE_KEY = "rag_chat_messages";
const MAX_MESSAGES = 100;

// Find _FILE_: tokens embedded anywhere in the provided text (markdown or plain)
const FILE_TOKEN_REGEX = /_FILE_:([^\s)>\]]+)/gi;
function extractFileTokensFromText(text) {
  if (!text || typeof text !== "string") return [];
  const tokens = new Set();
  let m;
  while ((m = FILE_TOKEN_REGEX.exec(text))) {
    tokens.add(m[0]);
  }
  return Array.from(tokens);
}

function asSourceString(s) {
  if (!s && s !== 0) return null;
  if (typeof s === "string") return s;
  if (s.fileUrl && typeof s.fileUrl === "string") return s.fileUrl;
  return String(s);
}

function mergeAndDedupeSources(arrSources = [], textTokens = []) {
  const set = new Set();
  const out = [];
  for (const s of arrSources || []) {
    const ss = asSourceString(s);
    if (!ss) continue;
    if (!set.has(ss)) {
      set.add(ss);
      out.push(ss);
    }
  }
  for (const t of textTokens || []) {
    if (!set.has(t)) {
      set.add(t);
      out.push(t);
    }
  }
  return out;
}

// Handle click for source links and markdown anchors
function handleSourceClick(e, url, filename, explicitHighlights) {
  e.preventDefault();
  if (!url) return;

  // If explicit highlight terms provided, or present on the clicked element dataset, set them
  let highlights = explicitHighlights;
  if (!highlights && e && e.currentTarget && e.currentTarget.dataset?.highlights) {
    try {
      highlights = JSON.parse(decodeURIComponent(e.currentTarget.dataset.highlights));
    } catch {
      // ignore parse errors
    }
  }
  if (Array.isArray(highlights) && highlights.length > 0) {
    setHighlightTerms(highlights);
  }

  // All sources (whether from server or localStorage) use the same _FILE_:uuid/filename format
  loadFileContent(url, filename);
}

// Centralized handler: inserts sources UI and attaches click handlers for markdown anchors and source links.
// container - either the .message element (addMessage) or the .message-bubble (replaceThinkingWithAnswer)
function applyMessageContentEnhancements(container, text, sources = []) {
  if (!container) return [];
  const bubble = container.classList.contains("message-bubble")
    ? container
    : container.querySelector(".message-bubble");
  if (!bubble) return [];

  const inlineTokens = extractFileTokensFromText(text);
  const combinedSources = mergeAndDedupeSources(Array.isArray(sources) ? sources : [], inlineTokens);
  const messageHighlightTerms = extractHighlightTerms(text);
  // store as encoded JSON string for dataset usage
  const encodedHighlights = encodeURIComponent(JSON.stringify(messageHighlightTerms || []));

  // Use requestAnimationFrame to ensure DOM is fully painted before attaching handlers
  requestAnimationFrame(() => {
    // Attach handlers for anchors inside markdown content (inline file tokens and server URLs)
    const markdownLinks = bubble.querySelectorAll(".markdown-content a");
    console.log(`[applyMessageContentEnhancements] Found ${markdownLinks.length} markdown links`);
    
    markdownLinks.forEach((link) => {
      // Avoid duplicate handlers
      if (link.__markdownHandlerAttached) return;
      link.__markdownHandlerAttached = true;

      let href = link.getAttribute("href");
      if (!href) return;

      // Attach the highlight terms to the link itself so click handler can set them before loading viewer
      link.dataset.highlights = encodedHighlights;

      console.log(`[applyMessageContentEnhancements] Attaching handler to markdown link:`, href);

      // Non-http links are expected to be our _FILE_ tokens
      if (!href.startsWith("http") && !href.startsWith("mailto:")) {
        link.addEventListener("click", (e) => {
          const parsed = parseFileSource(href);
          console.log(`[handleSourceClick] Parsed _FILE_ token:`, parsed);
          handleSourceClick(e, parsed.url, parsed.filename);
        });
      } else if (href.includes('/api/file/')) {
        // If link points to a server file URL, intercept and load via viewer
        link.addEventListener("click", (e) => {
          const parsed = parseFileSource(href);
          console.log(`[handleSourceClick] Parsed server URL:`, parsed);
          handleSourceClick(e, parsed.url, parsed.filename);
        });
      } else {
        // Default external links should open in a new tab
        link.addEventListener("click", (e) => {
          e.preventDefault();
          window.open(href, "_blank", "noopener");
        });
      }
    });

    // Build & insert sources UI if present
    if (Array.isArray(combinedSources) && combinedSources.length) {
      console.log(`[applyMessageContentEnhancements] Rendering ${combinedSources.length} sources`);
      
      const parsedSourcesHtml = combinedSources
        .map((s, n) => {
          const parsed = parseFileSource(String(s));
          return `<div class="source-item">
            <a href="#" class="source-link" data-highlights="${escapeHtml(encodedHighlights)}" data-url="${escapeHtml(parsed.url)}" data-filename="${escapeHtml(parsed.filename)}">${n + 1}. ${escapeHtml(parsed.filename)}</a>
          </div>`;
        })
        .join("");

      const srcHtml = `
        <div class="sources-container">
          <details>
            <summary>📚 Sources (${combinedSources.length})</summary>
            <div class="sources-list">${parsedSourcesHtml}</div>
          </details>
        </div>`;
      bubble.insertAdjacentHTML("beforeend", srcHtml);

      // Attach click handlers for source links AFTER inserting the HTML
      const sourceLinks = bubble.querySelectorAll(".source-link");
      console.log(`[applyMessageContentEnhancements] Found ${sourceLinks.length} source links after insertion`);
      
      sourceLinks.forEach((link) => {
        // Avoid duplicate handlers
        if (link.__sourceHandlerAttached) return;
        link.__sourceHandlerAttached = true;

        console.log(`[applyMessageContentEnhancements] Attaching handler to source link:`, link.getAttribute("data-filename"));

        link.addEventListener("click", (e) => {
          const url = link.getAttribute("data-url");
          const filename = link.getAttribute("data-filename");
          console.log(`[handleSourceClick] Source link clicked:`, { url, filename });
          handleSourceClick(e, url, filename);
        });
      });
    }
  });

  return combinedSources;
}

function saveMsgToStorage(text, sender, clickable = false, sources = []) {
  try {
    const messages = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];

    messages.push({
      text,
      sender,
      clickable,
      timestamp: new Date().toISOString(),
      sources: Array.isArray(sources) ? sources : [],
    });

    // Keep only last 100 messages
    const limited = messages.slice(-MAX_MESSAGES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(limited));
  } catch (error) {
    console.error("Failed to save message to storage:", error);
  }
}

export function loadMessagesFromStorage() {
  try {
    const messages = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    // Ensure sources exist for older messages
    return messages.map((m) => ({ ...m, sources: Array.isArray(m.sources) ? m.sources : [] }));
  } catch (error) {
    console.error("Failed to load messages from storage:", error);
    return [];
  }
}

export function clearMessagesStorage() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    return true;
  } catch (error) {
    console.error("Failed to clear messages storage:", error);
    return false;
  }
}

// options: { save: true | false } - set save:false when restoring from storage
export function addMessage(
  text,
  sender = "assistant",
  clickable = false,
  sources = [],
  options = {}
) {
  const messagesDiv = document.querySelector("#messages");
  const input = document.querySelector("#messageInput");
  const msgDiv = document.createElement("div");
  msgDiv.className = `message message-${sender}`;

  if (clickable) {
    msgDiv.classList.add("clickable-example");
  }

  let contentHtml = '<div class="message-bubble">';
  if (sender === "assistant") {
    contentHtml += `<div class="markdown-content">${marked(text || "")}</div>`;
  } else if (sender === "error") {
    contentHtml += `<div class="error-message">${escapeHtml(text)}</div>`;
  } else {
    contentHtml += `<div class="user-message">${escapeHtml(text)}</div>`;
  }
  contentHtml += "</div>";

  msgDiv.innerHTML = contentHtml;
  msgDiv.classList.add("animate-in");

  if (clickable) {
    msgDiv.style.cursor = "pointer";
    msgDiv.addEventListener("click", () => {
      if (input.disabled) return;
      input.value = text;
      input.style.height = "0px";
      input.style.height = input.scrollHeight + "px";
      sendMessage({ preventDefault: () => {} });
    });

    msgDiv.addEventListener("mouseenter", () => {
      if (!input.disabled) msgDiv.style.opacity = "0.8";
    });

    msgDiv.addEventListener("mouseleave", () => {
      msgDiv.style.opacity = "1";
    });
  }

  // Apply shared enhancements and get deduped combined sources
  const combinedSources = applyMessageContentEnhancements(msgDiv, text, sources || []);

  messagesDiv.appendChild(msgDiv);

  // Save to localStorage (now includes deduped combinedSources) unless disabled
  const shouldSave = options && options.save !== false;
  if (shouldSave) {
    saveMsgToStorage(text, sender, clickable, combinedSources);
  }

  autoScroll();
}

export function createThinkingBubble() {
  const messagesDiv = document.querySelector("#messages");
  const msgDiv = document.createElement("div");
  msgDiv.className = "message message-assistant thinking animate-in";
  msgDiv.innerHTML = `
    <div class="message-bubble">
      <div class="markdown-content"><em>Loading</em><span class="loading-dots"></span></div>
    </div>
  `;
  messagesDiv.appendChild(msgDiv);
  autoScroll();
  return msgDiv;
}

export function editThinkingBubble(newText) {
  const length = document.querySelectorAll(".message.thinking").length;
  const thinkingEl =
    length > 0
      ? document.querySelectorAll(".message.thinking")[length - 1]
      : null;
  if (thinkingEl) {
    const bubble = thinkingEl.querySelector(".message-bubble");
    bubble.innerHTML = `<div class="markdown-content"><em>${escapeHtml(newText)}</em><span class="loading-dots"></span></div>`;
    autoScroll();
  }
}

export function parseFileSource(source) {
  if (!source) {
    return { uuid: "unknown", filename: String(source), url: String(source) };
  }

  // Handle _FILE_: token format (from both server and localStorage)
  if (typeof source === "string" && source.startsWith("_FILE_:")) {
    const content = source.slice("_FILE_:".length);
    const parts = content.split("/");
    const uuid = parts[0];
    const filename = parts.slice(1).join("/") || uuid;
    return {
      uuid,
      filename,
      url: `/api/file/${uuid}`,
    };
  }

  // fallback: return as-is
  return {
    uuid: "unknown",
    filename: String(source),
    url: String(source),
  };
}

function extractHighlightTerms(answerText) {
  const terms = new Set();

  if (!answerText || typeof answerText !== "string") return Array.from(terms);

  const sections = answerText.split("###");

  sections.forEach((section) => {
    const quoteMatches = section.match(/"([^"]+)"/g) || [];

    quoteMatches.forEach((match) => {
      let content = match.slice(1, -1).trim();
      content = content.replace(/\.\.\.$/, "").trim();

      const words = content.split(/\s+/).filter((w) => w.length > 0);
      for (let i = 0; i <= words.length - 9; i++) {
        const chunk = words.slice(i, i + 9).join(" ");
        if (chunk.length > 6) {
          terms.add(chunk);
        }
      }
    });
  });

  return Array.from(terms).filter((t) => t.length > 5);
}

export function replaceThinkingWithAnswer({
  thinkingEl,
  answerText = "",
  sources = [],
}) {
  const highlightTerms = extractHighlightTerms(answerText);
  setHighlightTerms(highlightTerms);

  console.log({
    answerText,
  });

  const bubble = thinkingEl.querySelector(".message-bubble");
  bubble.innerHTML = `<div class="markdown-content">${marked(answerText || "")}</div>`;

  // Use same function to attach anchors and sources and get combined sources for saving
  const combinedSources = applyMessageContentEnhancements(bubble, answerText, sources || []);

  // Save answer to storage (now includes deduped combinedSources)
  saveMsgToStorage(answerText, "assistant", false, combinedSources);

  autoScroll();
}
