/**
 * Background Service Worker — Handles extension installation, onboarding,
 * and proxies Gemini API streaming calls (content scripts can't use host_permissions).
 */

// Import utilities so we can call the Gemini API from this privileged context
importScripts('utils/storage.js', 'utils/rate-limiter.js', 'utils/gemini-api.js');

// ── Open onboarding page on first install ──
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') });
  }
});

// ── Simple message handler (popup → content script relay) ──
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'briefrr-run') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, message, (response) => {
          sendResponse(response);
        });
      }
    });
    return true;
  }
});

// ── Streaming port handler ──
// Content script opens a port, sends { apiKey, prompt, systemPrompt },
// and we stream chunks back as { type:'chunk', text } messages.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'briefrr-stream') return;

  port.onMessage.addListener(async (msg) => {
    const { apiKey, prompt, systemPrompt } = msg;

    try {
      for await (const chunk of streamGeminiResponse(apiKey, prompt, systemPrompt)) {
        try {
          port.postMessage({ type: 'chunk', text: chunk });
        } catch {
          // Port disconnected (drawer closed) — stop streaming
          return;
        }
      }
      try { port.postMessage({ type: 'done' }); } catch { /* port closed */ }
    } catch (err) {
      try { port.postMessage({ type: 'error', error: err.message }); } catch { /* port closed */ }
    }
  });
});
