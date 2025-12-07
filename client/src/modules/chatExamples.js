import { escapeHtml, scrollToBottom } from "../utils/dom.js";

import { sendMessage } from "./chatSend.js";

function shuffleArray(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export async function getExamplesForMode() {
  try {
    // Use a relative path so the client works without requiring an explicit base URL.
    const response = await fetch(`/api/suggestions`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch suggestions: ${response.statusText}`);
    }

    const data = await response.json();

    const currentMode = window.currentMode || "search";

    // Handle different response formats
    let suggestions = [];
    if (Array.isArray(data)) {
      suggestions = data;
    } else if (Array.isArray(data.questions)) {
      suggestions = data.questions;
    }

    // Shuffle suggestions
    const shuffledSuggestions = shuffleArray(suggestions);

    // Return appropriate field based on mode
    if (currentMode === "search") {
      // For search mode, use keywords
      return shuffledSuggestions.map((s) => ({
        text: s.keywords,
        full: s,
      }));
    } else if (currentMode === "perspective-analysis") {
      // For perspective-analysis mode, use scenario
      return shuffledSuggestions.map((s) => ({
        text: s.scenario,
        full: s,
      }));
    } else if (currentMode === "qa") {
      // For QA mode, use question text; fall back to defaults if necessary
      return shuffledSuggestions.map((s) => ({
        text: s.question,
        full: s,
      }));
    }

    // Fallback to question
    return shuffledSuggestions.map((s) => ({
      text: s.question,
      full: s,
    }));
  } catch (error) {
    console.error("Error fetching examples from suggestions endpoint:", error);
    return [];
  }
}

export async function showExamples(count = 3) {
  const messagesContainer = document.getElementById("messages");
  const currentMode = window.currentMode || "search";

  try {
    const examples = await getExamplesForMode();

    if (!examples || examples.length === 0) {
      console.warn("No examples available");
      return;
    }

    const selectedExamples = examples.slice(0, count);

    let examplesTitle = "";
    if (currentMode === "search") {
      examplesTitle = "📚 Click on any search keywords:";
    } else if (currentMode === "perspective-analysis") {
      examplesTitle = "⚖️ Click on any legal scenarios:";
    } else if (currentMode === "qa") {
      examplesTitle = "❓ Click on any legal question to ask:";
    } else {
      examplesTitle = "Examples:";
    }

    const examples_html = `
      <div class="message message-assistant">
        <div class="message-bubble">
          <div class="markdown-content">
            <p><strong>${examplesTitle}</strong></p>
            ${selectedExamples
              .map(
                (example) => `
              <div class="example-item" 
                   data-example="${escapeHtml(example.text)}"
                   data-full="${escapeHtml(JSON.stringify(example.full))}">
                <div class="example-item-text">${escapeHtml(example.text)}</div>
              </div>
            `,
              )
              .join("")}
          </div>
        </div>
      </div>
    `;

    messagesContainer.insertAdjacentHTML("beforeend", examples_html);

    messagesContainer.querySelectorAll(".example-item").forEach((item) => {
      item.addEventListener("click", function () {
        const input = document.querySelector("#messageInput");
        const example = this.getAttribute("data-example");

        input.value = example;
        input.style.height = "auto";
        input.style.height = Math.min(input.scrollHeight, 160) + "px";
        input.focus();

        sendMessage({ preventDefault: () => {} });
      });
    });

    // Scroll to bottom after examples are rendered
    scrollToBottom();
  } catch (error) {
    console.error("Error displaying examples:", error);
  }
}

export function showGreeting() {
  const messagesContainer = document.getElementById("messages");
  const currentMode = window.currentMode || "search";

  let greeting = "";
  let description = "";

  if (currentMode === "search") {
    greeting = "🔎 Search";
    description =
      "Search through Philippine legal documents, case laws, and statutes. Find relevant legal information.";
  } else if (currentMode === "perspective-analysis") {
    greeting = "⚖️ Multi-Perspective Legal Analysis";
    description =
      "Analyze legal scenarios from multiple perspectives: Prosecutor (Complainant), Defense (Respondent), and Judge. For best results, provide a story-like prompt: a short factual paragraph describing the parties, setting, key facts, claimed legal basis, and the legal issue to be analyzed.";
  } else if (currentMode === "qa") {
    greeting = "❓ Legal Q&A";
    description =
      "Ask a legal question and get concise answers grounded in the provided sources. The assistant will cite sources and highlight uncertainties.";
  }

  const greeting_html = `
    <div class="message message-assistant">
      <div class="message-bubble">
        <div class="markdown-content">
          <h2>${greeting}</h2>
          <p>${description}</p>
        </div>
      </div>
    </div>
  `;

  messagesContainer.insertAdjacentHTML("beforeend", greeting_html);
  scrollToBottom();
}
