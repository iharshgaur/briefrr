/**
 * Content Script — Injects the Briefrr side drawer into the page,
 * manages streaming responses from Gemini, and handles mode switching.
 */
(function () {
  // Guard against double-injection
  if (window.__briefrr_loaded) return;
  window.__briefrr_loaded = true;

  /* ────────────────────────────────────────────
     Lightweight Markdown → HTML converter
     Handles: headings, bold, italic, bullets,
     inline code, code blocks, paragraphs
  ──────────────────────────────────────────── */
  function markdownToHtml(md) {
    if (!md) return '';
    let html = md;

    // Code blocks (```)
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
      return `<pre class="pb-code-block"><code>${escapeHtml(code.trim())}</code></pre>`;
    });

    // Split into lines for block-level processing
    const lines = html.split('\n');
    const output = [];
    let inList = false;

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];

      // Headings
      if (line.startsWith('### ')) { closePendingList(); output.push(`<h3 class="pb-h3">${inline(line.slice(4))}</h3>`); continue; }
      if (line.startsWith('## ')) { closePendingList(); output.push(`<h2 class="pb-h2">${inline(line.slice(3))}</h2>`); continue; }
      if (line.startsWith('# ')) { closePendingList(); output.push(`<h1 class="pb-h1">${inline(line.slice(2))}</h1>`); continue; }

      // Bullet points
      if (/^[-*] /.test(line)) {
        if (!inList) { output.push('<ul class="pb-ul">'); inList = true; }
        output.push(`<li>${inline(line.slice(2))}</li>`);
        continue;
      }

      // Numbered lists
      if (/^\d+\.\s/.test(line)) {
        if (!inList) { output.push('<ol class="pb-ol">'); inList = true; }
        output.push(`<li>${inline(line.replace(/^\d+\.\s/, ''))}</li>`);
        continue;
      }

      // Close list if open
      closePendingList();

      // Blank line
      if (line.trim() === '') { continue; }

      // Paragraph
      output.push(`<p class="pb-p">${inline(line)}</p>`);
    }
    closePendingList();

    function closePendingList() {
      if (inList) { output.push(output[output.length - 1]?.startsWith('<li>') ? '</ul>' : '</ul>'); inList = false; }
    }

    return output.join('\n');

    /** Inline formatting: bold, italic, code, links */
    function inline(text) {
      text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
      text = text.replace(/`(.+?)`/g, '<code class="pb-inline-code">$1</code>');
      text = text.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
      return text;
    }
  }

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ────────────────────────────────────────────
     Shadow DOM Drawer
  ──────────────────────────────────────────── */
  let hostEl = null;
  let shadowRoot = null;
  let currentMode = 'highlights';
  let isStreaming = false;
  let abortController = null;
  let debounceTimer = null;
  let countdownInterval = null;

  /** Inject the drawer host element if not already present. */
  function ensureHost() {
    if (hostEl) return;
    hostEl = document.createElement('div');
    hostEl.id = 'briefrr-host';
    document.documentElement.appendChild(hostEl);
    shadowRoot = hostEl.attachShadow({ mode: 'closed' });

    // Inject styles into shadow root
    const style = document.createElement('style');
    style.textContent = getShadowStyles();
    shadowRoot.appendChild(style);

    // Inject drawer HTML
    const drawer = document.createElement('div');
    drawer.id = 'briefrr-drawer';
    drawer.className = 'briefrr-drawer';
    drawer.innerHTML = `
      <div class="briefrr-header">
        <div class="briefrr-title">
          <span class="briefrr-logo" id="pb-logo">⚡</span>
          <span id="pb-title-text">Briefrr — Brief</span>
        </div>
        <div class="briefrr-actions">
          <button class="briefrr-mode-btn" id="pb-mode-brief" title="Brief (5-10 points)">⚡</button>
          <button class="briefrr-mode-btn" id="pb-mode-explain" title="Explain (10-20 points)">📖</button>
          <button class="briefrr-mode-btn" id="pb-mode-search" title="Search page">🔍</button>
          <button class="briefrr-close" id="pb-close" title="Close">✕</button>
        </div>
      </div>
      <div class="briefrr-search-bar" id="pb-search-bar" style="display: none;">
        <input type="text" id="pb-search-input" placeholder="Ask a question about this page..." />
        <button id="pb-search-btn">Search</button>
      </div>
      <div class="briefrr-content" id="pb-content">
        <div class="pb-loading">
          <div class="pb-spinner"></div>
          <span>Extracting page content...</span>
        </div>
      </div>
      <div class="briefrr-footer">
        <span class="briefrr-powered">Powered by Gemini</span>
      </div>
    `;
    shadowRoot.appendChild(drawer);

    // Close button
    shadowRoot.getElementById('pb-close').addEventListener('click', closeDrawer);

    // Mode buttons
    shadowRoot.getElementById('pb-mode-brief').addEventListener('click', () => switchMode('highlights'));
    shadowRoot.getElementById('pb-mode-explain').addEventListener('click', () => switchMode('explain'));
    shadowRoot.getElementById('pb-mode-search').addEventListener('click', () => switchMode('search'));

    // Search button
    shadowRoot.getElementById('pb-search-btn').addEventListener('click', () => {
      if (currentMode === 'search') {
        runBriefrr('search');
      }
    });

    // Enter key in search input
    shadowRoot.getElementById('pb-search-input').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        runBriefrr('search');
      }
    });
  }

  /** Switch between modes with debouncing */
  function switchMode(newMode) {
    // Clear any existing debounce timer
    if (debounceTimer) clearTimeout(debounceTimer);

    // Update UI immediately
    updateHeader(newMode);

    // Show/hide search bar
    const searchBar = shadowRoot.getElementById('pb-search-bar');
    if (newMode === 'search') {
      searchBar.style.display = 'flex';
      // Focus the search input
      setTimeout(() => shadowRoot.getElementById('pb-search-input').focus(), 100);
    } else {
      searchBar.style.display = 'none';
    }

    // For search mode, don't auto-run - wait for user to enter query
    if (newMode === 'search') {
      const content = shadowRoot.getElementById('pb-content');
      content.innerHTML = `<div class="pb-info"><p>💡 Ask a question about this page and get answers based only on the page content.</p></div>`;
      return;
    }

    // For brief/explain modes, debounce and run
    debounceTimer = setTimeout(() => {
      runBriefrr(newMode);
    }, 500);

    // Show loading state
    const content = shadowRoot.getElementById('pb-content');
    content.innerHTML = `<div class="pb-loading"><div class="pb-spinner"></div><span>Switching mode...</span></div>`;
  }

  /** Open the drawer with a slide-in animation. */
  function openDrawer() {
    ensureHost();
    // Force reflow then add class
    requestAnimationFrame(() => {
      hostEl.classList.add('open');
      shadowRoot.getElementById('briefrr-drawer').classList.add('open');
    });
  }

  /** Close the drawer and clean up. */
  function closeDrawer() {
    if (abortController) abortController.abort();
    if (debounceTimer) clearTimeout(debounceTimer);
    if (countdownInterval) clearInterval(countdownInterval);
    if (shadowRoot) {
      shadowRoot.getElementById('briefrr-drawer').classList.remove('open');
    }
    if (hostEl) hostEl.classList.remove('open');
  }

  /** Update header for current mode. */
  function updateHeader(mode) {
    currentMode = mode;
    const logo = shadowRoot.getElementById('pb-logo');
    const title = shadowRoot.getElementById('pb-title-text');

    // Update active button styling
    shadowRoot.querySelectorAll('.briefrr-mode-btn').forEach(btn => btn.classList.remove('active'));

    if (mode === 'highlights') {
      logo.textContent = '⚡';
      title.textContent = 'Briefrr — Brief';
      shadowRoot.getElementById('pb-mode-brief').classList.add('active');
    } else if (mode === 'explain') {
      logo.textContent = '📖';
      title.textContent = 'Briefrr — Explain';
      shadowRoot.getElementById('pb-mode-explain').classList.add('active');
    } else if (mode === 'search') {
      logo.textContent = '🔍';
      title.textContent = 'Briefrr — Search';
      shadowRoot.getElementById('pb-mode-search').classList.add('active');
    }
  }

  /** Display an error message inside the content area. */
  function showError(message, showRetry = false, autoRetryMs = 0) {
    const content = shadowRoot.getElementById('pb-content');
    content.innerHTML = `
      <div class="pb-error">
        <span class="pb-error-icon">⚠️</span>
        <p>${message}</p>
        ${autoRetryMs > 0 ? `<p class="pb-countdown" id="pb-countdown">Retrying in <strong>${Math.ceil(autoRetryMs / 1000)}</strong> seconds...</p>` : ''}
        ${showRetry && autoRetryMs === 0 ? '<button class="pb-retry-btn" id="pb-retry">🔄 Retry</button>' : ''}
      </div>
    `;

    // Set up countdown timer if auto-retry is enabled
    if (autoRetryMs > 0) {
      const endTime = Date.now() + autoRetryMs;

      countdownInterval = setInterval(() => {
        const remaining = endTime - Date.now();
        if (remaining <= 0) {
          clearInterval(countdownInterval);
          runBriefrr(currentMode);
        } else {
          const countdownEl = shadowRoot.getElementById('pb-countdown');
          if (countdownEl) {
            const seconds = Math.ceil(remaining / 1000);
            countdownEl.innerHTML = `Retrying in <strong>${seconds}</strong> second${seconds !== 1 ? 's' : ''}...`;
          }
        }
      }, 100);
    } else if (showRetry) {
      shadowRoot.getElementById('pb-retry').addEventListener('click', () => runBriefrr(currentMode));
    }
  }

  /* ────────────────────────────────────────────
     Main Execution Flow
  ──────────────────────────────────────────── */
  async function runBriefrr(mode) {
    // Clear any existing countdown
    if (countdownInterval) clearInterval(countdownInterval);

    if (isStreaming && abortController) abortController.abort();
    abortController = new AbortController();
    isStreaming = true;

    openDrawer();
    updateHeader(mode);

    const content = shadowRoot.getElementById('pb-content');
    content.innerHTML = `<div class="pb-loading"><div class="pb-spinner"></div><span>Checking rate limits...</span></div>`;

    // 1. Check rate limiting
    try {
      console.log('[Briefrr] Checking rate limits...', typeof RateLimiter);
      const rateLimitCheck = await RateLimiter.canMakeRequest();
      console.log('[Briefrr] Rate limit check result:', rateLimitCheck);

      if (!rateLimitCheck.allowed) {
        const timeRemaining = RateLimiter.formatTimeRemaining(rateLimitCheck.remainingMs);
        const message = rateLimitCheck.reason === 'backoff'
          ? `Rate limit cooldown active. Too many requests were made.`
          : `Please wait before making another request.`;
        showError(message, false, rateLimitCheck.remainingMs);
        isStreaming = false;
        return;
      }
    } catch (error) {
      console.error('[Briefrr] Rate limit check failed:', error);
      showError(`Rate limit check failed: ${error.message}. Proceeding anyway...`, false);
      // Continue anyway if rate limiter fails
    }

    content.innerHTML = `<div class="pb-loading"><div class="pb-spinner"></div><span>Extracting page content...</span></div>`;

    // 2. Check for API key
    const apiKey = await Storage.getApiKey();
    if (!apiKey) {
      showError('Please set up your Gemini API key first. Click the Briefrr extension icon → Settings.');
      isStreaming = false;
      return;
    }

    // 2. Extract content
    let article;
    try {
      article = extractContent();
    } catch (err) {
      showError('Couldn\'t extract content from this page. The page might be too dynamic or empty.');
      isStreaming = false;
      return;
    }

    if (!article.content || article.content.trim().length < 50) {
      showError('Couldn\'t extract meaningful content from this page. The page might be too dynamic or empty.');
      isStreaming = false;
      return;
    }

    // 3. Build prompt
    let systemPrompt, userPrompt;

    if (mode === 'search') {
      systemPrompt = SEARCH_SYSTEM_PROMPT;
      const searchQuery = shadowRoot.getElementById('pb-search-input')?.value || '';
      if (!searchQuery.trim()) {
        showError('Please enter a search query.');
        isStreaming = false;
        return;
      }
      userPrompt = buildUserPrompt(article, mode, searchQuery);
    } else {
      systemPrompt = mode === 'highlights' ? HIGHLIGHTS_SYSTEM_PROMPT : EXPLAIN_SYSTEM_PROMPT;
      userPrompt = buildUserPrompt(article, mode);
    }

    // 4. Stream the response via background service worker (has host_permissions)
    const loadingText = mode === 'search' ? 'Searching page content...' :
      mode === 'highlights' ? 'Generating brief...' : 'Generating explanation...';
    content.innerHTML = `<div class="pb-loading"><div class="pb-spinner"></div><span>${loadingText}</span></div>`;

    let accumulated = '';

    try {
      await new Promise((resolve, reject) => {
        const port = chrome.runtime.connect({ name: 'briefrr-stream' });

        // If the user closes the drawer, disconnect the port
        abortController.signal.addEventListener('abort', () => {
          port.disconnect();
          resolve();
        });

        port.onMessage.addListener((msg) => {
          if (abortController.signal.aborted) return;

          if (msg.type === 'chunk') {
            accumulated += msg.text;
            content.innerHTML = `
              <div class="pb-markdown">${markdownToHtml(accumulated)}</div>
              <div class="pb-cursor"></div>
            `;
            content.scrollTop = content.scrollHeight;
          } else if (msg.type === 'done') {
            // Remove cursor once done
            const cursor = shadowRoot.querySelector('.pb-cursor');
            if (cursor) cursor.remove();
            port.disconnect();
            resolve();
          } else if (msg.type === 'error') {
            port.disconnect();
            reject(new Error(msg.error));
          }
        });

        port.onDisconnect.addListener(() => {
          // Port closed unexpectedly (e.g. service worker restart)
          if (!abortController.signal.aborted && !accumulated) {
            reject(new Error('Connection to extension lost. Please try again.'));
          } else {
            resolve();
          }
        });

        // Send the request to background
        port.postMessage({ apiKey, prompt: userPrompt, systemPrompt });
      });
    } catch (err) {
      if (abortController.signal.aborted) return;

      if (err.message === 'INVALID_KEY') {
        showError('Your API key seems invalid. Please check it in Settings.', true);
      } else if (err.message.startsWith('RATE_LIMITED:')) {
        // Parse the new error format: RATE_LIMITED:<ms>:<message>
        const parts = err.message.split(':');
        if (parts.length >= 3) {
          const cooldownMs = parseInt(parts[1], 10);
          const message = parts.slice(2).join(':');
          showError(message, false, cooldownMs);
        } else {
          showError('You\'ve hit the rate limit. Please wait a moment and try again.', true);
        }
      } else if (err.message === 'RATE_LIMITED') {
        showError('You\'ve hit the rate limit. Please wait a moment and try again.', true);
      } else if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
        showError('Couldn\'t connect to Gemini. Please check your internet connection.', true);
      } else {
        showError(`The response was interrupted. ${err.message}`, true);
      }
    }

    isStreaming = false;
  }

  /* ────────────────────────────────────────────
     Message Listener
  ──────────────────────────────────────────── */
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'briefrr-run') {
      runBriefrr(message.mode);
      sendResponse({ ok: true });
    }
  });

  /* ────────────────────────────────────────────
     Shadow DOM Styles
  ──────────────────────────────────────────── */
  function getShadowStyles() {
    return `
      * { margin: 0; padding: 0; box-sizing: border-box; }

      .briefrr-drawer {
        position: fixed;
        top: 0; right: 0;
        width: 400px; height: 100vh;
        background: #ffffff;
        box-shadow: -4px 0 20px rgba(0,0,0,0.15);
        display: flex; flex-direction: column;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 15px;
        color: #1A1A2E;
        transform: translateX(100%);
        transition: transform 0.3s ease;
        z-index: 2147483647;
      }
      .briefrr-drawer.open { transform: translateX(0); }

      @media (max-width: 768px) {
        .briefrr-drawer { width: 100vw; }
      }

      /* ── Header ── */
      .briefrr-header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 0 16px;
        height: 56px; min-height: 56px;
        background: #f8f9fa;
        border-bottom: 1px solid #E5E7EB;
      }
      .briefrr-title { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 14px; }
      .briefrr-logo { font-size: 18px; }
      .briefrr-actions { display: flex; gap: 4px; }
      .briefrr-actions button {
        background: none; border: none; cursor: pointer;
        font-size: 16px; padding: 6px 8px; border-radius: 6px;
        color: #6B7280; transition: background 0.15s;
      }
      .briefrr-actions button:hover { background: #e5e7eb; }
      .briefrr-mode-btn.active {
        background: #3B82F6 !important;
        color: white !important;
      }
      .briefrr-close { font-style: normal; font-size: 18px !important; }

      /* ── Search Bar ── */
      .briefrr-search-bar {
        display: flex;
        gap: 8px;
        padding: 12px 16px;
        background: #f8f9fa;
        border-bottom: 1px solid #E5E7EB;
      }
      .briefrr-search-bar input {
        flex: 1;
        padding: 8px 12px;
        border: 1px solid #D1D5DB;
        border-radius: 6px;
        font-size: 14px;
        font-family: inherit;
      }
      .briefrr-search-bar input:focus {
        outline: none;
        border-color: #3B82F6;
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
      }
      .briefrr-search-bar button {
        padding: 8px 16px;
        background: #3B82F6;
        color: white;
        border: none;
        border-radius: 6px;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.15s;
      }
      .briefrr-search-bar button:hover {
        background: #2563EB;
      }

      /* ── Content ── */
      .briefrr-content {
        flex: 1; overflow-y: auto; padding: 20px;
        line-height: 1.6;
      }
      
      /* Info message for search mode */
      .pb-info {
        text-align: center;
        padding: 40px 20px;
        color: #6B7280;
      }
      .pb-info p {
        font-size: 15px;
        line-height: 1.6;
      }

      /* ── Footer ── */
      .briefrr-footer {
        padding: 10px 16px;
        border-top: 1px solid #f3f4f6;
        text-align: center;
      }
      .briefrr-powered { font-size: 11px; color: #9CA3AF; }

      /* ── Loading ── */
      .pb-loading {
        display: flex; flex-direction: column; align-items: center;
        justify-content: center; gap: 14px;
        height: 200px; color: #6B7280; font-size: 14px;
      }
      .pb-spinner {
        width: 28px; height: 28px;
        border: 3px solid #E5E7EB; border-top-color: #6C63FF;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
      }
      @keyframes spin { to { transform: rotate(360deg); } }

      /* ── Streaming cursor ── */
      .pb-cursor {
        display: inline-block;
        width: 8px; height: 18px;
        background: #6C63FF;
        border-radius: 2px;
        animation: blink 0.8s steps(2) infinite;
        margin-left: 2px;
        vertical-align: text-bottom;
      }
      @keyframes blink { 50% { opacity: 0; } }

      /* ── Error ── */
      .pb-error {
        display: flex; flex-direction: column; align-items: center;
        justify-content: center; gap: 12px; text-align: center;
        padding: 40px 20px; color: #6B7280;
      }
      .pb-error-icon { font-size: 32px; }
      .pb-error p { font-size: 14px; line-height: 1.6; max-width: 300px; }
      .pb-retry-btn {
        background: #6C63FF; color: #fff; border: none;
        padding: 9px 20px; border-radius: 8px; cursor: pointer;
        font-size: 13px; font-weight: 600;
        transition: background 0.2s;
      }
      .pb-retry-btn:hover { background: #5a52e0; }

      /* ── Markdown Rendered Content ── */
      .pb-markdown { animation: fadeIn 0.15s ease; }
      @keyframes fadeIn { from { opacity: 0.5; } to { opacity: 1; } }

      .pb-h1 { font-size: 22px; font-weight: 700; margin: 20px 0 10px; }
      .pb-h2 { font-size: 18px; font-weight: 700; margin: 22px 0 8px; color: #1A1A2E; }
      .pb-h3 { font-size: 16px; font-weight: 600; margin: 18px 0 6px; color: #374151; }
      .pb-p  { margin-bottom: 12px; line-height: 1.65; }

      .pb-ul, .pb-ol { padding-left: 22px; margin-bottom: 12px; }
      .pb-ul li, .pb-ol li { margin-bottom: 6px; line-height: 1.55; }

      .pb-inline-code {
        background: #F3F4F6; color: #e11d48;
        padding: 2px 6px; border-radius: 4px;
        font-family: 'SF Mono', 'Fira Code', monospace;
        font-size: 13px;
      }
      .pb-code-block {
        background: #F3F4F6; border-radius: 8px;
        padding: 14px 16px; overflow-x: auto;
        margin: 12px 0;
        font-family: 'SF Mono', 'Fira Code', monospace;
        font-size: 13px; line-height: 1.5;
      }

      a { color: #6C63FF; text-decoration: none; }
      a:hover { text-decoration: underline; }
      strong { font-weight: 600; }
      em { font-style: italic; }
    `;
  }
})();
