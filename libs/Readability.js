/**
 * Minimal Readability.js implementation for Chrome extension
 * Extracts article content from web pages
 */

(function(global) {
  'use strict';

  /**
   * Readability constructor
   * @param {Document} doc - Document or cloned document to parse
   * @param {Object} options - Options for parsing
   */
  function Readability(doc, options) {
    this.doc = doc;
    this.options = options || {};
    this._articleNode = null;
    this._contentLength = 0;
  }

  /**
   * Main parse method that extracts article content
   * @returns {Object} Article object with title, content, and metadata
   */
  Readability.prototype.parse = function() {
    var article = {
      title: this._getTitle(),
      content: null,
      textContent: null,
      excerpt: null,
      siteName: null,
      length: 0,
      byline: null,
      dir: this.doc.dir || null
    };

    try {
      // Clone the document for safe manipulation
      var documentClone = this.doc.cloneNode(true);

      // Remove problematic elements
      this._stripElements(documentClone);

      // Find main article content
      var contentNode = this._grabArticle(documentClone);

      if (contentNode) {
        // Get article content
        article.content = contentNode.innerHTML;
        article.textContent = contentNode.textContent;
        article.length = article.textContent.length;

        // Extract excerpt (first 200 characters of text)
        article.excerpt = this._getExcerpt(article.textContent);
      }

      // Get site name and other metadata
      article.siteName = this._getSiteName();
      article.byline = this._getByline();

      return article;
    } catch (e) {
      console.error('Error parsing article:', e);
      return article;
    }
  };

  /**
   * Get the title of the article
   */
  Readability.prototype._getTitle = function() {
    var title = '';

    try {
      title = this.doc.title || '';
    } catch (e) {
      // Continue if title extraction fails
    }

    if (!title) {
      var titleElement = this.doc.querySelector('meta[property="og:title"]') ||
                         this.doc.querySelector('meta[name="title"]');
      if (titleElement) {
        title = titleElement.getAttribute('content') || '';
      }
    }

    return title.trim();
  };

  /**
   * Get the site name from meta tags
   */
  Readability.prototype._getSiteName = function() {
    var siteName = '';

    try {
      var siteNameElement = this.doc.querySelector('meta[property="og:site_name"]');
      if (siteNameElement) {
        siteName = siteNameElement.getAttribute('content') || '';
      }
    } catch (e) {
      // Continue if extraction fails
    }

    return siteName.trim();
  };

  /**
   * Get article byline/author
   */
  Readability.prototype._getByline = function() {
    var byline = '';

    try {
      var bylineElement = this.doc.querySelector('meta[name="author"]') ||
                          this.doc.querySelector('[rel="author"]');
      if (bylineElement) {
        byline = bylineElement.getAttribute('content') || bylineElement.textContent || '';
      }
    } catch (e) {
      // Continue if extraction fails
    }

    return byline.trim();
  };

  /**
   * Extract a brief excerpt from the content
   */
  Readability.prototype._getExcerpt = function(textContent) {
    if (!textContent) return '';

    var text = textContent.replace(/\s+/g, ' ').trim();
    var maxLength = 200;

    if (text.length > maxLength) {
      return text.substring(0, maxLength).replace(/\s+\S*$/, '') + '...';
    }

    return text;
  };

  /**
   * Strip unwanted elements from the document
   */
  Readability.prototype._stripElements = function(doc) {
    var nodesToRemove = [
      'script',
      'style',
      'noscript',
      'iframe',
      'nav',
      'footer',
      'header',
      'aside',
      '.sidebar',
      '.advertisement',
      '.ads',
      '[role="navigation"]'
    ];

    nodesToRemove.forEach(function(selector) {
      var elements = doc.querySelectorAll(selector);
      elements.forEach(function(element) {
        element.parentNode.removeChild(element);
      });
    });
  };

  /**
   * Find and grab the main article content
   */
  Readability.prototype._grabArticle = function(doc) {
    // Try to find article content in order of preference
    var selectors = [
      'article',
      'main',
      '[role="main"]',
      '.article',
      '.post',
      '.content',
      '.entry'
    ];

    for (var i = 0; i < selectors.length; i++) {
      var element = doc.querySelector(selectors[i]);
      if (element && element.textContent.length > 100) {
        return element;
      }
    }

    // Fallback to body
    var body = doc.querySelector('body');
    if (body) {
      return body;
    }

    return null;
  };

  /**
   * Expose Readability to global scope
   */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Readability;
  } else {
    global.Readability = Readability;
  }

})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : typeof self !== 'undefined' ? self : this);
