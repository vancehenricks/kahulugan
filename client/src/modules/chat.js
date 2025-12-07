import { scrollToBottom } from "../utils/dom.js";

import { showGreeting, showExamples } from "./chatExamples.js";
import {
  loadMessagesFromStorage,
  clearMessagesStorage,
  addMessage,
} from "./chatMessages.js";
import { sendMessage } from "./chatSend.js";
import { showClearHistoryModal } from "./modal.js";

export function initChat() {
  const form = document.getElementById("chatForm");
  const modeSelect = document.getElementById("modeSelect");
  const messageInput = document.getElementById("messageInput");
  const clearHistoryBtn = document.getElementById("clearHistoryBtn");

  form.addEventListener("submit", sendMessage);

  messageInput.addEventListener("keydown", (e) => {
    // Send on Enter (without Shift)
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(e);
    }
    // Allow Shift+Enter for new line (default behavior)
  });

  messageInput.addEventListener("input", () => {
    messageInput.style.height = "auto";
    messageInput.style.height = Math.min(messageInput.scrollHeight, 160) + "px";
  });

  modeSelect.addEventListener("change", async () => {
    window.currentMode = modeSelect.value;

    const perspectiveSelector = document.getElementById("perspectiveSelector");

    if (modeSelect.value === "perspective-analysis") {
      perspectiveSelector.style.display = "block";
      document.getElementById("perspectiveDropdown").value = "judge";
      window.selectedPerspectives = "judge";
    } else {
      perspectiveSelector.style.display = "none";
      window.selectedPerspectives = null;
    }

    // Show greeting and examples again when switching modes
    showGreeting();
    showExamples();

    // Scroll to bottom
    scrollToBottom();
    console.log("Switched to mode:", window.currentMode);
  });

  // Setup clear history button
  if (clearHistoryBtn) {
    clearHistoryBtn.addEventListener("click", (e) => {
      e.preventDefault();
      showClearHistoryModal(() => {
        clearMessagesStorage();

        // Reset UI
        const messagesContainer = document.getElementById("messages");
        messagesContainer.innerHTML = "";

        showGreeting();
        showExamples();

        console.log("Chat history cleared");
      });
    });
  }

  // Load and display chat history
  loadAndRestoreChatHistory();
}

function loadAndRestoreChatHistory() {
  const messagesContainer = document.getElementById("messages");
  const messages = loadMessagesFromStorage();

  if (messages.length === 0) {
    // No history, show greeting and examples only
    showGreeting();
    showExamples();
    // Scroll to bottom after adding examples
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  } else {
    // Show saved messages first
    messagesContainer.innerHTML = "";

    // Reuse addMessage so rendering & handlers are consistent. Don't re-save to localStorage.
    messages.forEach((msg) => {
      addMessage(msg.text, msg.sender, msg.clickable, msg.sources || [], { save: false });
    });

    // Then show greeting and examples after messages
    showGreeting();
    showExamples();
    // Scroll to bottom after adding examples
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }
}

export { showExamples, showGreeting };
