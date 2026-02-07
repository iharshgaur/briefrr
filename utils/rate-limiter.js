/**
 * Rate Limiter — Client-side request throttling for Gemini API
 * Enforces minimum delay between requests to prevent hitting API rate limits.
 * 
 * Gemini API Free Tier Limits:
 * - 15 RPM (Requests Per Minute)
 * - 1,500 RPD (Requests Per Day)
 * 
 * Our Strategy:
 * - Minimum 4 seconds between requests (15 requests / 60 seconds)
 * - Exponential backoff on 429 errors (60s → 120s → 240s → max 300s)
 */

const RateLimiter = {
    // Minimum delay between requests in milliseconds (4 seconds)
    MIN_REQUEST_DELAY: 4000,

    // Initial backoff delay for 429 errors (60 seconds)
    INITIAL_BACKOFF: 60000,

    // Maximum backoff delay (5 minutes)
    MAX_BACKOFF: 300000,

    /**
     * Check if a new request can be made based on rate limiting rules.
     * @returns {Promise<{ allowed: boolean, remainingMs?: number }>}
     */
    async canMakeRequest() {
        try {
            // Add timeout protection - if storage calls take too long, allow the request
            const timeoutPromise = new Promise((resolve) => {
                setTimeout(() => resolve({ allowed: true, timedOut: true }), 2000);
            });

            const checkPromise = (async () => {
                const lastRequestTime = await Storage.getLastRequestTime();
                const backoffDelay = await Storage.getRetryBackoff();

                const now = Date.now();

                // If we have an active backoff (from a 429 error), enforce it
                if (backoffDelay && backoffDelay > 0) {
                    const backoffUntil = lastRequestTime + backoffDelay;
                    if (now < backoffUntil) {
                        return {
                            allowed: false,
                            remainingMs: backoffUntil - now,
                            reason: 'backoff'
                        };
                    }
                    // Backoff period has expired, clear it
                    await Storage.clearRetryBackoff();
                }

                // Check minimum delay between requests
                if (lastRequestTime) {
                    const timeSinceLastRequest = now - lastRequestTime;
                    if (timeSinceLastRequest < this.MIN_REQUEST_DELAY) {
                        return {
                            allowed: false,
                            remainingMs: this.MIN_REQUEST_DELAY - timeSinceLastRequest,
                            reason: 'rate_limit'
                        };
                    }
                }

                return { allowed: true };
            })();

            const result = await Promise.race([checkPromise, timeoutPromise]);

            if (result.timedOut) {
                console.warn('[RateLimiter] Storage check timed out, allowing request');
            }

            return result;
        } catch (error) {
            console.error('[RateLimiter] Error in canMakeRequest:', error);
            // On error, allow the request to proceed
            return { allowed: true, error: true };
        }
    },

    /**
     * Record that a request is being made.
     * Call this immediately before making an API request.
     */
    async recordRequest() {
        await Storage.setLastRequestTime(Date.now());
    },

    /**
     * Handle a successful request - clear any backoff delays.
     */
    async recordSuccess() {
        await Storage.clearRetryBackoff();
    },

    /**
     * Handle a 429 rate limit error - set exponential backoff.
     */
    async recordRateLimitError() {
        const currentBackoff = await Storage.getRetryBackoff();

        let newBackoff;
        if (!currentBackoff || currentBackoff === 0) {
            // First 429 error - start with initial backoff
            newBackoff = this.INITIAL_BACKOFF;
        } else {
            // Subsequent 429 errors - double the backoff
            newBackoff = Math.min(currentBackoff * 2, this.MAX_BACKOFF);
        }

        await Storage.setRetryBackoff(newBackoff);

        return newBackoff;
    },

    /**
     * Get a human-readable time remaining message.
     * @param {number} ms - Milliseconds remaining
     * @returns {string} - e.g., "3 seconds", "1 minute", "2 minutes"
     */
    formatTimeRemaining(ms) {
        const seconds = Math.ceil(ms / 1000);

        if (seconds < 60) {
            return `${seconds} second${seconds !== 1 ? 's' : ''}`;
        }

        const minutes = Math.ceil(seconds / 60);
        return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
    },

    /**
     * Get the remaining cooldown time in milliseconds.
     * Returns 0 if no cooldown is active.
     * @returns {Promise<number>}
     */
    async getRemainingCooldown() {
        const check = await this.canMakeRequest();
        return check.allowed ? 0 : (check.remainingMs || 0);
    }
};
