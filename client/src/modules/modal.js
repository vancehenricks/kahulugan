export function showClearHistoryModal(onConfirm) {
  // Check if modal already exists
  let modal = document.getElementById("clearHistoryModal");
  if (modal) {
    modal.remove();
  }

  // Create modal overlay
  const modalOverlay = document.createElement("div");
  modalOverlay.id = "clearHistoryModalOverlay";
  modalOverlay.className = "modal-overlay";

  // Create modal
  modal = document.createElement("div");
  modal.id = "clearHistoryModal";
  modal.className = "modal";

  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h2 class="modal-title">Clear Chat History</h2>
        <button class="modal-close" id="modalClose" type="button">×</button>
      </div>
      <div class="modal-body">
        <p>Are you sure you want to clear all chat history?</p>
        <p class="modal-warning"><strong>⚠️ Warning:</strong> This action cannot be undone.</p>
      </div>
      <div class="modal-footer">
        <button id="modalCancel" class="modal-btn modal-btn-cancel" type="button">Cancel</button>
        <button id="modalConfirm" class="modal-btn modal-btn-confirm" type="button">Clear History</button>
      </div>
    </div>
  `;

  modalOverlay.appendChild(modal);
  document.body.appendChild(modalOverlay);

  // Handle button clicks
  const confirmBtn = document.getElementById("modalConfirm");
  const cancelBtn = document.getElementById("modalCancel");
  const closeBtn = document.getElementById("modalClose");

  const closeModal = () => {
    modalOverlay.remove();
  };

  const handleConfirm = () => {
    closeModal();
    if (onConfirm) {
      onConfirm();
    }
  };

  confirmBtn.addEventListener("click", handleConfirm);
  cancelBtn.addEventListener("click", closeModal);
  closeBtn.addEventListener("click", closeModal);

  // Close modal on overlay click
  modalOverlay.addEventListener("click", (e) => {
    if (e.target === modalOverlay) {
      closeModal();
    }
  });

  // Close modal on Escape key
  document.addEventListener(
    "keydown",
    (e) => {
      if (
        e.key === "Escape" &&
        document.getElementById("clearHistoryModalOverlay")
      ) {
        closeModal();
      }
    },
    { once: true },
  );
}

export function showDisclaimerModal(onAccept) {
  // If already accepted, invoke callback immediately
  try {
    if (localStorage.getItem('disclaimerAccepted') === '1') {
      if (onAccept) onAccept();
      return;
    }
  } catch {
    // ignore localStorage errors
  }

  // Create modal overlay
  let overlay = document.getElementById('disclaimerModalOverlay');
  if (overlay) overlay.remove();

  overlay = document.createElement('div');
  overlay.id = 'disclaimerModalOverlay';
  overlay.className = 'modal-overlay';

  const modal = document.createElement('div');
  modal.id = 'disclaimerModal';
  modal.className = 'modal';

  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h2 class="modal-title">Disclaimer and Release of Liability Agreement for Kahulugan</h2>
      </div>
      <div class="modal-body">
        <p>By accessing this AI legal research assistant website (the "Kahulugan"), you agree to the following terms:</p>
        <ol>
          <li><strong>Nature of Services</strong>: The information provided is for educational and research purposes only and does not constitute legal advice.</li>
          <li><strong>Disclaimer of Liability</strong>: The Kahulugan and its affiliates shall not be liable for any claims, damages, losses, or expenses arising from your use of this Site. No attorney-client relationship is formed through the use of this Site.</li>
          <li><strong>User Acknowledgment</strong>: By using the Kahulugan, you acknowledge that you have read, understood, and agree to these terms. Any reliance on the information is at your own risk.</li>
          <li><strong>Governing Law</strong>: This agreement shall be governed by the laws of the Philippines.</li>
          <li><strong>Modification Clause</strong>: We reserve the right to modify the terms of this agreement at any time.</li>
        </ol>
        <p><strong>By using this Site, you expressly waive any claims against us that may arise in connection with your use of the Site.</strong></p>
      </div>
      <div class="modal-footer">
        <button id="disclaimerDecline" class="modal-btn modal-btn-cancel" type="button">Decline</button>
        <button id="disclaimerAccept" class="modal-btn modal-btn-confirm" type="button">I Accept</button>
      </div>
    </div>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const acceptBtn = document.getElementById('disclaimerAccept');
  const declineBtn = document.getElementById('disclaimerDecline');

  const closeModal = () => {
    const ov = document.getElementById('disclaimerModalOverlay');
    if (ov) ov.remove();
  };

  acceptBtn.addEventListener('click', () => {
    try {
      localStorage.setItem('disclaimerAccepted', '1');
    } catch {
      // ignore
    }
    closeModal();
    if (onAccept) onAccept();
  });

  declineBtn.addEventListener('click', () => {
    // If user declines, navigate away from the app (block usage)
    try {
      closeModal();
      // Show a simple blocked message
      document.body.innerHTML = `
        <div style="padding:40px;font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif; max-width:800px; margin:40px auto; text-align:center;">
          <h2>Access Denied</h2>
          <p>You must accept the Disclaimer and Release of Liability Agreement to use this site.</p>
        </div>
      `;
    } catch {
      // fallback: reload
      window.location.href = 'about:blank';
    }
  });

  // Prevent closing the disclaimer by clicking overlay or ESC - keep it blocking until accept/decline
}

export function showCopyrightsModal() {
  // Create modal overlay (reuse pattern from other modals)
  let overlay = document.getElementById('copyrightsModalOverlay');
  if (overlay) overlay.remove();

  overlay = document.createElement('div');
  overlay.id = 'copyrightsModalOverlay';
  overlay.className = 'modal-overlay';

  const modal = document.createElement('div');
  modal.id = 'copyrightsModal';
  modal.className = 'modal';

  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h2 class="modal-title">Copyrights & Attributions</h2>
        <button class="modal-close" id="copyrightsClose" type="button">×</button>
      </div>
      <div class="modal-body">
        <p><strong>Website License</strong></p>
        <p>
          Source code is licensed under the <a href="/LICENSE" target="_blank" rel="noopener noreferrer">MIT License</a>.
          MIT is a permissive license: you may use, copy, modify, and distribute the software, provided the original copyright notice and permission notice are included.
        </p>
        <p><strong>Source code</strong></p>
        <p><a href="https://github.com/vancehenricks/kahulugan" target="_blank" rel="noopener noreferrer">github.com/vancehenricks/kahulugan</a></p>
        <hr />
        <p><strong>Data Attribution</strong></p>
        <p>
          Primary source: <a href="https://lawphil.net" target="_blank" rel="noopener noreferrer">Lawphil Project</a> (scraped).
          Additional processing and contributions by <a href="https://extra.bayanwat.ch" target="_blank" rel="noopener noreferrer">extra.bayanwat.ch</a>.
        </p>
        <p>Where applicable, Lawphil content is licensed under the <a href="https://creativecommons.org/licenses/by-nc/4.0/" target="_blank" rel="noopener noreferrer">Creative Commons Attribution‑NonCommercial 4.0 Philippine License</a>.</p>
        <p>Statutes, issuances, and court decisions are works of the Philippine Government. Kahulugan is not affiliated with, sponsored by, or endorsed by the Arellano Law Foundation or the Lawphil Project.</p>
      </div>
      <div class="modal-footer">
        <button id="copyrightsOk" class="modal-btn modal-btn-confirm" type="button">Close</button>
      </div>
    </div>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const closeBtn = document.getElementById('copyrightsClose');
  const okBtn = document.getElementById('copyrightsOk');

  const closeModal = () => {
    const ov = document.getElementById('copyrightsModalOverlay');
    if (ov) ov.remove();
  };

  closeBtn.addEventListener('click', closeModal);
  okBtn.addEventListener('click', closeModal);

  // Close on overlay click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });

  // Close on Escape
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape' && document.getElementById('copyrightsModalOverlay')) {
        closeModal();
      }
    },
    { once: true }
  );
}
