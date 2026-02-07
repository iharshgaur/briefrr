/**
 * Onboarding Page Logic — Handles API key verification and setup completion.
 */
(function () {
  const steps   = document.querySelectorAll('.step');
  const dots    = document.querySelectorAll('.dot');
  const input   = document.getElementById('api-key-input');
  const status  = document.getElementById('status-message');

  /** Navigate to a specific step (1-indexed). */
  function goToStep(n) {
    steps.forEach(s => s.classList.remove('active'));
    dots.forEach(d => d.classList.remove('active'));
    document.getElementById(`step-${n}`).classList.add('active');
    document.querySelector(`.dot[data-step="${n}"]`).classList.add('active');
  }

  // Show / hide API key
  document.getElementById('toggle-key').addEventListener('click', () => {
    const isPassword = input.type === 'password';
    input.type = isPassword ? 'text' : 'password';
    document.getElementById('toggle-key').textContent = isPassword ? '🙈' : '👁️';
  });

  // Verify & Save
  document.getElementById('btn-verify').addEventListener('click', async () => {
    const key = input.value.trim();
    if (!key) {
      showStatus('Please paste your API key first.', 'error');
      return;
    }

    showStatus('Verifying your key...', 'loading');
    document.getElementById('btn-verify').disabled = true;

    const result = await validateApiKey(key);

    if (result.valid) {
      await Storage.setApiKey(key);
      await Storage.setOnboarded();
      showStatus('✅ Key verified! You\'re all set.', 'success');
      setTimeout(() => goToStep(2), 800);
    } else if (result.error === 'RATE_LIMITED') {
      showStatus('⏳ Rate limit hit — too many requests. Wait a minute and try again.', 'error');
    } else if (result.error === 'NETWORK_ERROR') {
      showStatus('🌐 Network error — check your internet connection and try again.', 'error');
    } else {
      showStatus('❌ Invalid key. Please check and try again.', 'error');
    }
    document.getElementById('btn-verify').disabled = false;
  });

  // Get Started — close the tab
  document.getElementById('btn-get-started').addEventListener('click', () => {
    window.close();
  });

  /** Update the status message element. */
  function showStatus(msg, type) {
    status.textContent = msg;
    status.className = 'status ' + type;
  }
})();
