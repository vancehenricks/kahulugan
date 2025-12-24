import { escapeHtml } from "../utils/dom.js";

import { parseFileSource } from "./chatMessageParser.js";
import { loadFileContent, setHighlightTerms } from "./fileViewer.js";

// Server base URL removed — rely on relative '/api/file/' paths or explicit URLs

// Build highlight terms from answer text
export function extractHighlightTerms(answerText) {
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
        if (chunk.length > 6) terms.add(chunk);
      }
    });
  });
  return Array.from(terms).filter((t) => t.length > 5);
}

// Handle clicks on links / sources
export function handleSourceClick(e, url, filename, explicitHighlights) {
  e.preventDefault();
  if (!url) return;

  let highlights = explicitHighlights;
  if (!highlights && e && e.currentTarget && e.currentTarget.dataset?.highlights) {
    try {
      highlights = JSON.parse(decodeURIComponent(e.currentTarget.dataset.highlights));
    } catch {
      highlights = null;
    }
  }
  if (Array.isArray(highlights) && highlights.length > 0) {
    setHighlightTerms(highlights);
  }

  loadFileContent(url, filename);
}

// Attach anchors & source links handlers and render sources
// container: .message (for addMessage) or .message-bubble (for replaceThinkingWithAnswer)
export function applyMessageContentEnhancements(container, text, sources = [], serverBaseUrl = '') {
  if (!container) return [];
  const bubble = container.classList.contains("message-bubble") ? container : container.querySelector(".message-bubble");
  if (!bubble) return [];

  // build combined sources and highlight
  const tokens = (typeof text === "string" ? text.match(/(?:_FILE_:|FILE:)([^\s)>\]]+)/gi) || [] : []);
  const combinedSources = (Array.isArray(sources) ? sources : []).concat(tokens).filter(Boolean);
  const messageHighlightTerms = extractHighlightTerms(text);
  const encodedHighlights = encodeURIComponent(JSON.stringify(messageHighlightTerms || []));

  // ensure DOM is painted
  requestAnimationFrame(() => {
    // anchors in markdown
    bubble.querySelectorAll(".markdown-content a").forEach((link) => {
      if (link.__markdownHandlerAttached) return;
      link.__markdownHandlerAttached = true;

      let href = link.getAttribute("href");
      if (!href) return;

      link.dataset.highlights = encodedHighlights;

      if (!href.startsWith("http") && !href.startsWith("mailto:")) {
        link.addEventListener("click", (e) => {
          const parsed = parseFileSource(href, serverBaseUrl);
          handleSourceClick(e, parsed.url, parsed.filename, messageHighlightTerms);
        });
      } else if (href.includes('/api/file/')) {
        link.addEventListener("click", (e) => {
          const parsed = parseFileSource(href, serverBaseUrl);
          handleSourceClick(e, parsed.url, parsed.filename, messageHighlightTerms);
        });
      } else {
        link.addEventListener("click", (e) => {
          e.preventDefault();
          window.open(href, "_blank", "noopener");
        });
      }
    });

    // sources UI
    if (Array.isArray(combinedSources) && combinedSources.length) {
      const parsedSourcesHtml = combinedSources
        .map((s, n) => {
          const parsed = parseFileSource(String(s), serverBaseUrl);
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

      bubble.querySelectorAll(".source-link").forEach((link) => {
        if (link.__sourceHandlerAttached) return;
        link.__sourceHandlerAttached = true;
        link.addEventListener("click", (e) => {
          const url = link.getAttribute("data-url");
          const filename = link.getAttribute("data-filename");
          handleSourceClick(e, url, filename, messageHighlightTerms);
        });
      });
    }
  });

  return combinedSources;
}