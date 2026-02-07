/**
 * Options Page Logic — Manage Gemini API key.
 */
(async function () {
  const keyValue       = document.getElementById('key-value');
  const keyActions     = document.getElementById('key-actions');
  const keyEdit        = document.getElementById('key-edit');
  const newKeyInput    = document.getElementById('new-key-input');
  const statusMsg      = document.getElementById('status-msg');
  const confirmOverlay = document.getElementById('confirm-overlay');

  /** Refresh the displayed key state. */
  async function refreshKeyDisplay() {
    const key = await Storage.getApiKey();
    if (key) {
      keyValue.textContent = '••••••••' + key.slice(-4);
      keyActions.style.display = 'flex';
    } else {
      keyValue.textContent = 'Not set';
      keyActions.style.display = 'flex';
    }
    keyEdit.style.display = 'none';
  }

  await refreshKeyDisplay();

  // Change key
  document.getElementById('btn-change-key').addEventListener('click', () => {
    keyActions.style.display = 'none';
    keyEdit.style.display = 'block';
    newKeyInput.value = '';
    newKeyInput.focus();
    statusMsg.className = 'status';
  });

  // Cancel editing
  document.getElementById('btn-cancel-edit').addEventListener('click', () => {
    refreshKeyDisplay();
  });

  // Toggle key visibility
  document.getElementById('toggle-key').addEventListener('click', () => {
    const hidden = newKeyInput.type === 'password';
    newKeyInput.type = hidden ? 'text' : 'password';
    document.getElementById('toggle-key').textContent = hidden ? '🙈' : '👁️';
  });

  // Save new key
  document.getElementById('btn-save-key').addEventListener('click', async () => {
    const key = newKeyInput.value.trim();
    if (!key) {
      showStatus('Please enter an API key.', 'error');
      return;
    }
    showStatus('Verifying...', 'loading');
    document.getElementById('btn-save-key').disabled = true;

    const result = await validateApiKey(key);

    if (result.valid) {
      await Storage.setApiKey(key);
      showStatus('✅ Key saved successfully.', 'success');
      setTimeout(refreshKeyDisplay, 1000);
    } else if (result.error === 'RATE_LIMITED') {
      showStatus('⏳ Rate limit hit — wait a minute and try again.', 'error');
    } else if (result.error === 'NETWORK_ERROR') {
      showStatus('🌐 Network error — check your internet connection.', 'error');
    } else {
      showStatus('❌ Invalid key. Please try again.', 'error');
    }
    document.getElementById('btn-save-key').disabled = false;
  });

  // Clear key — show confirmation
  document.getElementById('btn-clear-key').addEventListener('click', () => {
    confirmOverlay.style.display = 'flex';
  });
  document.getElementById('btn-cancel-clear').addEventListener('click', () => {
    confirmOverlay.style.display = 'none';
  });
  document.getElementById('btn-confirm-clear').addEventListener('click', async () => {
    await Storage.removeApiKey();
    confirmOverlay.style.display = 'none';
    refreshKeyDisplay();
  });

  function showStatus(msg, type) {
    statusMsg.textContent = msg;
    statusMsg.className = 'status ' + type;
  }
})();
