/**
 * Gemini API Integration — Streaming responses from Google's Gemini 2.5 Flash-Lite model.
 */

const GEMINI_MODEL = 'gemini-2.5-flash-lite';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:streamGenerateContent`;

/** System prompt for Brief mode */
const HIGHLIGHTS_SYSTEM_PROMPT = `Create an ultra-concise summary of the provided web content.

IMPORTANT: Only use information from the webpage content provided. Do not add external knowledge.

Format requirements:
- Start with ONE sentence overview
- List 5-10 key bullet points
- Each bullet point: 1 sentence maximum
- Use simple, clear language
- Only include information explicitly stated on the page
- Use clean Markdown formatting

Total response: under 200 words.`;

/** System prompt for Explain mode */
const EXPLAIN_SYSTEM_PROMPT = `Create a detailed explanation of the provided web content.

IMPORTANT: Only use information from the webpage content provided. Do not add external knowledge.

Format requirements:
- Start with a 2-3 sentence overview
- List 10-20 key points as bullet points
- Each bullet point: 1-2 sentences explaining a concept
- Group related points under section headings (##) if helpful
- Only explain concepts and ideas mentioned on the page
- End with "Key Takeaways" section (3-5 points)
- Use clean Markdown formatting

Target length: 400-600 words.`;

/** System prompt for Search mode */
const SEARCH_SYSTEM_PROMPT = `Answer questions about the provided web content.

Rules:
1. Only use information from the webpage content provided
2. If the answer is not on the page, respond: "This information is not found on this page."
3. Do not use external knowledge or make assumptions
4. Be concise and direct
5. Quote relevant parts when helpful
6. If partial answer available, clarify what is and isn't on the page

Use clean Markdown formatting.`;

/**
 * Build the user prompt sent to Gemini.
 * @param {{ title: string, content: string, siteName: string }} article
 * @param {'highlights'|'explain'|'search'} mode
 * @param {string} searchQuery - Optional search query for search mode
 * @returns {string}
 */
function buildUserPrompt(article, mode, searchQuery = '') {
  const { title, content, siteName } = article;

  if (mode === 'search') {
    return `**Page Title**: ${title}
**Site**: ${siteName}

**Page Content**:
${content}

---

**User Question**: ${searchQuery}

Please answer the user's question using ONLY the information from the page content above. If the information is not on the page, explicitly state that.`;
  }

  // For highlights and explain modes
  return `**Page Title**: ${title}
**Site**: ${siteName}

**Page Content**:
${content}`;
}

/**
 * Validate an API key by fetching model metadata (GET request).
 * NOTE: While this does NOT consume generation tokens, it DOES count toward
 * the API's Requests Per Minute (RPM) and Requests Per Day (RPD) limits.
 * Returns an object: { valid: boolean, error?: string }
 * @param {string} apiKey
 * @returns {Promise<{ valid: boolean, error?: string }>}
 */
async function validateApiKey(apiKey) {
  try {
    // Use the models.get endpoint — it only reads metadata, no generation tokens used
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}?key=${apiKey}`;
    const res = await fetch(url, { method: 'GET' });

    if (res.ok) return { valid: true };

    // Parse the error body for a helpful message
    let detail = '';
    try {
      const body = await res.json();
      detail = body.error?.message || '';
    } catch { /* ignore */ }

    if (res.status === 429) {
      return { valid: false, error: 'RATE_LIMITED' };
    }
    if (res.status === 400 || res.status === 403) {
      return { valid: false, error: 'INVALID_KEY' };
    }
    return { valid: false, error: detail || `API returned status ${res.status}` };
  } catch (err) {
    console.error('[Briefrr] validateApiKey network error:', err);
    return { valid: false, error: 'NETWORK_ERROR' };
  }
}

/**
 * Stream a response from the Gemini API using Server-Sent Events.
 * Yields text chunks as they arrive.
 * @param {string} apiKey
 * @param {string} prompt
 * @param {string} systemInstruction
 * @yields {string} text chunks
 */
async function* streamGeminiResponse(apiKey, prompt, systemInstruction) {
  // Check rate limiting before making the request
  const rateLimitCheck = await RateLimiter.canMakeRequest();
  if (!rateLimitCheck.allowed) {
    const timeRemaining = RateLimiter.formatTimeRemaining(rateLimitCheck.remainingMs);
    const reason = rateLimitCheck.reason === 'backoff'
      ? `Rate limit cooldown active. Please wait ${timeRemaining}.`
      : `Too many requests. Please wait ${timeRemaining} before trying again.`;
    throw new Error(`RATE_LIMITED:${rateLimitCheck.remainingMs}:${reason}`);
  }

  // Record that we're making a request
  await RateLimiter.recordRequest();

  const url = `${GEMINI_ENDPOINT}?alt=sse&key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: {
        parts: [{ text: systemInstruction }]
      },
      contents: [{
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 4096
      }
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    let errorMsg = `API error (${response.status})`;
    try {
      const parsed = JSON.parse(errorBody);
      errorMsg = parsed.error?.message || errorMsg;
    } catch { /* use default */ }

    if (response.status === 400) throw new Error('INVALID_KEY');

    if (response.status === 429) {
      // Record the rate limit error and get the backoff delay
      const backoffMs = await RateLimiter.recordRateLimitError();
      const timeRemaining = RateLimiter.formatTimeRemaining(backoffMs);
      throw new Error(`RATE_LIMITED:${backoffMs}:You've hit the API rate limit. Please wait ${timeRemaining} and try again.`);
    }

    throw new Error(errorMsg);
  }

  // Request was successful - clear any backoff delays
  await RateLimiter.recordSuccess();

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim();
        if (data === '[DONE]') return;
        try {
          const json = JSON.parse(data);
          const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) yield text;
        } catch {
          // Skip malformed chunks
        }
      }
    }
  }
}
