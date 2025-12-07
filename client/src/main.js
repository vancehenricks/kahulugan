import "./styles/variables.css";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/header.css";
import "./styles/messages.css";
import "./styles/inputs.css";
import "./styles/sources.css";
import "./styles/file-viewer.css";
import "./styles/file-content.css";
import "./styles/examples.css";
import "./styles/responsive.css";
import "./styles/modal.css";
import { initChat } from "./modules/chat.js";
import { initFileViewer } from "./modules/fileViewer.js";
import { showDisclaimerModal, showCopyrightsModal } from "./modules/modal.js";
if (!document.querySelector("meta[charset]") && document.head) {
  const meta = document.createElement("meta");
  meta.charset = "UTF-8";
  document.head.insertBefore(meta, document.head.firstChild);
}

window.currentMode = "search";
window.selectedPerspectives = null; // Track selected perspectives

document.querySelector("#app").innerHTML = `
  <div class="main-container">
    <div class="chatbot-container">
      <div class="chat-header">
        <div class="title"><img src="/kahulugan.svg" class="kahulugan-logo" alt="Kahulugan logo"/>Kahulugan</div>
        <div class="subtitle">AI Powered Philippine Legal Research Assistant</div>
        <button id="licenseBtn" class="license-btn" title="Copyrights and attributions" aria-label="Copyrights and attributions">Copyrights & Attributions</button>
        <div class="subtitle" id="disclaimer" role="note" aria-live="polite">
          <strong>⚠️</strong> This AI provides general legal information, is not a substitute for professional legal advice, and may display inaccurate or outdated information.
        </div>
      </div>

      <div class="chat-messages" id="messages" role="log" aria-live="polite"></div>
      <div class="chat-input-container">
        <form id="chatForm" class="chat-form">
          <div class="input-row">
            <textarea id="messageInput" placeholder="Enter your message here" rows="1" autocomplete="off"></textarea>
            <button type="submit" id="sendBtn" class="send-btn" title="Send message" aria-label="Send">Send</button>
          </div>
          <div class="selector-group">
            <button id="clearHistoryBtn" class="clear-history-btn" title="Clear chat history" type="button">🔥</button>
            <div class="mode-selector">
              <select id="modeSelect" title="Select mode" aria-label="Select mode">
                <option value="search" selected>🔍 Search</option>
                <option value="qa">❓ Q&A</option>
                <option value="perspective-analysis">⚖️ Perspective Analysis</option>
              </select>
            </div>
            <div class="perspective-selector" id="perspectiveSelector" style="display: none;">
              <select id="perspectiveDropdown" title="Select perspective" aria-label="Select perspective">
                <option value="prosecutor">👨‍💼 Prosecutor (Complainant/Plaintiff)</option>
                <option value="defense">🛡️ Defense (Respondent/Defendant)</option>
                <option value="judge">👨‍⚖️ Judge (Judicial)</option>
              </select>
            </div>
          </div>
        </form>
      </div>
    </div>

    <div class="file-viewer-container" id="fileViewer">
      <div class="file-viewer-header">
        <div class="file-viewer-title">📄 Document Viewer</div>
        <button class="close-viewer" id="closeViewer">×</button>
      </div>
      <div class="file-viewer-content">
        <div class="file-info" id="fileInfo">
          <div class="no-file-selected">Click on a source link to view the document</div>
        </div>
        <div class="file-content" id="fileContent">
          <!-- File content will be loaded here -->
        </div>
      </div>
    </div>
  </div>
`;

// Initialize global auto-scroll flag
window.autoScrollEnabled = true;

// Handle perspective selection
document
  .getElementById("perspectiveDropdown")
  .addEventListener("change", (e) => {
    const value = e.target.value;
    window.selectedPerspectives = value;

    console.log(
      "Selected perspective(s):",
      window.selectedPerspectives || "all",
    );
  });

  // Wire license button to open copyrights modal
  try {
    const licenseBtn = document.getElementById('licenseBtn');
    if (licenseBtn) {
      licenseBtn.addEventListener('click', () => {
        try {
          if (typeof showCopyrightsModal === 'function') showCopyrightsModal();
        } catch (e) {
          console.error('Failed to open copyrights modal', e);
        }
      });
    }
  } catch {
    // ignore
  }

// Set initial default perspective to 'all' after DOM is ready
document.getElementById("perspectiveDropdown").value = "judge";
window.selectedPerspectives = "judge";

async function initializeApp() {
  // Initialize modules - chat.js handles showing greeting/examples or restoring history
  initChat();
  initFileViewer();
}

// Call it only after the user accepts the disclaimer
try {
  const accepted = localStorage.getItem('disclaimerAccepted') === '1';
  if (accepted) {
    initializeApp();
  } else {
    showDisclaimerModal(() => initializeApp());
  }
} catch {
  // If localStorage is unavailable, still show the disclaimer modal
  showDisclaimerModal(() => initializeApp());
}

// Make footer clickable to open full copyright modal
// footer removed — no click handler needed
