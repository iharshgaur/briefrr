/**
 * Popup Logic — Shows mode selector or setup prompt based on API key status.
 */
(async function () {
  const setupView = document.getElementById('setup-view');
  const readyView = document.getElementById('ready-view');

  const apiKey = await Storage.getApiKey();

  if (!apiKey) {
    // No API key — show setup prompt
    setupView.style.display = 'block';
    document.getElementById('btn-open-onboarding').addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') });
      window.close();
    });
    return;
  }

  // API key exists — show mode selector
  readyView.style.display = 'block';

  // Get current tab title
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const title = tab?.title || 'Untitled Page';
  document.getElementById('page-title').textContent =
    title.length > 55 ? title.substring(0, 52) + '...' : title;

  /** Send a mode message to the content script, then close the popup. */
  async function triggerMode(mode) {
    const badge = document.getElementById('status-badge');
    badge.textContent = 'Processing...';
    badge.classList.add('processing');

    // Content scripts are auto-injected on all URLs via manifest.json.
    // Just send the message directly. If the tab was open before install,
    // sendMessage will fail — we catch that and inject once as a fallback.
    try {
      await chrome.tabs.sendMessage(tab.id, { action: 'briefrr-run', mode });
    } catch {
      // Content script not yet on this tab — inject once, then retry
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['libs/Readability.js', 'utils/storage.js', 'utils/content-extractor.js', 'utils/gemini-api.js', 'content.js']
        });
        await chrome.tabs.sendMessage(tab.id, { action: 'briefrr-run', mode });
      } catch {
        // Injection not possible on this page (e.g. chrome:// URLs)
      }
    }

    setTimeout(() => window.close(), 150);
  }

  document.getElementById('btn-highlights').addEventListener('click', () => triggerMode('highlights'));
  document.getElementById('btn-explain').addEventListener('click', () => triggerMode('explain'));

  // Settings button
  document.getElementById('btn-settings').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });
})();
