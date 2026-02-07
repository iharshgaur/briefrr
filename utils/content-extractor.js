/**
 * Content Extractor — Uses Mozilla Readability to pull article content from the DOM.
 * Falls back to document.body.innerText when Readability can't parse the page.
 */

const MAX_CONTENT_LENGTH = 50000; // Cap content at ~50k characters

/**
 * Extract meaningful text content from the current page.
 * @returns {{ title: string, content: string, excerpt: string, siteName: string, length: number }}
 */
function extractContent() {
  try {
    // Clone the document so Readability doesn't modify the original
    const documentClone = document.cloneNode(true);
    const reader = new Readability(documentClone);
    const article = reader.parse();

    if (article && article.textContent && article.textContent.trim().length > 100) {
      return {
        title: article.title || document.title,
        content: article.textContent.substring(0, MAX_CONTENT_LENGTH),
        excerpt: article.excerpt || '',
        siteName: article.siteName || window.location.hostname,
        length: article.textContent.length
      };
    }
  } catch (err) {
    console.warn('[Briefrr] Readability failed, using fallback:', err.message);
  }

  // Fallback: grab body text directly
  const bodyText = document.body.innerText || '';
  return {
    title: document.title,
    content: bodyText.substring(0, MAX_CONTENT_LENGTH),
    excerpt: '',
    siteName: window.location.hostname,
    length: bodyText.length
  };
}
