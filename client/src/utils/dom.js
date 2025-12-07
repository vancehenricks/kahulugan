// DOM utility functions

export function escapeHtml(text) {
  if (!text) return "";
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

export function autoScroll() {
  const messagesDiv = document.querySelector("#messages");
  if (window.autoScrollEnabled) {
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }
}

export function scrollToBottom() {
  const messagesDiv = document.querySelector("#messages");
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}
