/**
 * Storage Helper — Chrome storage abstraction for Briefrr
 * Manages API key and onboarding state via chrome.storage.local
 */
const Storage = {
  /**
   * Retrieve the stored Gemini API key.
   * @returns {Promise<string|null>} The API key or null if not set.
   */
  async getApiKey() {
    const result = await chrome.storage.local.get('geminiApiKey');
    return result.geminiApiKey || null;
  },

  /**
   * Save a Gemini API key to storage.
   * @param {string} key - The Gemini API key.
   */
  async setApiKey(key) {
    await chrome.storage.local.set({ geminiApiKey: key });
  },

  /**
   * Remove the stored Gemini API key.
   */
  async removeApiKey() {
    await chrome.storage.local.remove('geminiApiKey');
  },

  /**
   * Check whether the user has completed onboarding.
   * @returns {Promise<boolean>}
   */
  async isOnboarded() {
    const result = await chrome.storage.local.get('onboardingComplete');
    return result.onboardingComplete === true;
  },

  /**
   * Mark onboarding as complete.
   */
  async setOnboarded() {
    await chrome.storage.local.set({ onboardingComplete: true });
  },

  /**
   * Get the timestamp of the last API request.
   * @returns {Promise<number|null>} Timestamp in milliseconds, or null if never set.
   */
  async getLastRequestTime() {
    const result = await chrome.storage.local.get('lastRequestTime');
    return result.lastRequestTime || null;
  },

  /**
   * Store the timestamp of the current API request.
   * @param {number} timestamp - Timestamp in milliseconds.
   */
  async setLastRequestTime(timestamp) {
    await chrome.storage.local.set({ lastRequestTime: timestamp });
  },

  /**
   * Get the current retry backoff delay (for 429 errors).
   * @returns {Promise<number>} Backoff delay in milliseconds, or 0 if not set.
   */
  async getRetryBackoff() {
    const result = await chrome.storage.local.get('retryBackoff');
    return result.retryBackoff || 0;
  },

  /**
   * Store the retry backoff delay.
   * @param {number} delay - Backoff delay in milliseconds.
   */
  async setRetryBackoff(delay) {
    await chrome.storage.local.set({ retryBackoff: delay });
  },

  /**
   * Clear the retry backoff delay (called after a successful request).
   */
  async clearRetryBackoff() {
    await chrome.storage.local.remove('retryBackoff');
  }
};
