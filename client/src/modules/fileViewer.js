import { escapeHtml } from "../utils/dom.js";

let currentRawContent = "";
let currentFilename = "";
let highlightTerms = [];

export function initFileViewer() {
  const fileViewer = document.querySelector("#fileViewer");
  const closeViewer = document.querySelector("#closeViewer");

  closeViewer.addEventListener("click", () => {
    fileViewer.classList.add("closing");

    setTimeout(() => {
      fileViewer.classList.remove("visible");
      fileViewer.classList.remove("closing");
    }, 300);
  });
}

function downloadFile() {
  const element = document.createElement("a");
  element.setAttribute(
    "href",
    "data:text/plain;charset=utf-8," + encodeURIComponent(currentRawContent),
  );
  element.setAttribute("download", currentFilename);
  element.style.display = "none";
  document.body.appendChild(element);
  element.click();
  document.body.removeChild(element);
}

function displayRawContent(content) {
  const fileContent = document.querySelector("#fileContent");
  const lines = content.split("\n");

  const formattedContent = lines
    .map((line) => {
      let escapedLine = escapeHtml(line);
      let lineHasHighlight = false;

      const presentTerms = highlightTerms.filter(
        (term) =>
          term &&
          term.trim() !== "" &&
          line.toLowerCase().includes(term.toLowerCase()),
      );

      if (presentTerms.length > 3) {
        let minIndex = Infinity;
        let maxIndex = -Infinity;
        presentTerms.forEach((term) => {
          const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const regex = new RegExp(escapedTerm, "gi");
          let match;
          while ((match = regex.exec(escapedLine)) !== null) {
            minIndex = Math.min(minIndex, match.index);
            maxIndex = Math.max(maxIndex, match.index + match[0].length);
          }
        });
        if (minIndex < maxIndex) {
          let sentenceStart = 0;
          let sentenceEnd = escapedLine.length;

          for (let i = minIndex - 1; i >= 0; i--) {
            if ([".", "!", "?"].includes(escapedLine[i])) {
              sentenceStart = i + 1;
              break;
            }
          }

          for (let i = maxIndex; i < escapedLine.length; i++) {
            if ([".", "!", "?"].includes(escapedLine[i])) {
              sentenceEnd = i + 1;
              break;
            }
          }

          const before = escapedLine.slice(0, sentenceStart);
          const highlight = escapedLine.slice(sentenceStart, sentenceEnd);
          const after = escapedLine.slice(sentenceEnd);
          escapedLine =
            before +
            '<span class="highlight-match">' +
            highlight +
            "</span>" +
            after;
          lineHasHighlight = true;
        }
      }

      return `<div class="line ${lineHasHighlight ? "has-match" : ""}"><span class="line-content">${escapedLine}</span></div>`;
    })
    .join("");

  fileContent.innerHTML = `<div class="file-text">${formattedContent}</div>`;

  const firstHighlighted = fileContent.querySelector(".line.has-match");
  if (firstHighlighted) {
    firstHighlighted.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

export async function loadFileContent(url, filename) {
  const fileViewer = document.querySelector("#fileViewer");
  const fileInfo = document.querySelector("#fileInfo");
  const fileContent = document.querySelector("#fileContent");

  try {
    fileViewer.classList.add("visible");
    currentFilename = filename;
    currentRawContent = "";

    fileInfo.innerHTML = `<div class="loading-file">Loading: ${escapeHtml(filename)}</div>`;
    fileContent.innerHTML =
      '<div class="loading-content">Loading document<span class="loading-dots"></span></div>';

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const content = await response.text();
    currentRawContent = content;

    // Calculate file size in KB
    const fileSizeKB = (new Blob([content]).size / 1024).toFixed(2);

    fileInfo.innerHTML = `
      <div class="file-header">
        <div class="file-info-column">
          <div class="file-name">${escapeHtml(filename)}</div>
          <div class="file-size">${fileSizeKB} KB</div>
        </div>
        <button id="downloadBtn" class="download-button">Download</button>
      </div>
    `;

    document
      .querySelector("#downloadBtn")
      .addEventListener("click", downloadFile);

    displayRawContent(content);
  } catch (error) {
    console.error("[LOAD] Error:", error);
    fileInfo.innerHTML = `<div class="file-error">Error loading: ${escapeHtml(currentFilename)}</div>`;
    fileContent.innerHTML = `<div class="error-content">Failed to load document: ${escapeHtml(error.message)}</div>`;
  }
}

export function setHighlightTerms(terms) {
  highlightTerms = Array.isArray(terms) ? terms : [terms];
  if (currentRawContent) {
    displayRawContent(currentRawContent);
  }
}
