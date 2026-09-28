export function createLoginRateLimiter(options = {}) {
  const maxAttempts = Number(options.maxAttempts ?? 5);
  const windowMs = Number(options.windowMs ?? 15 * 60 * 1000);
  const attemptsByKey = new Map();

  return {
    consume(key, now = Date.now()) {
      const normalizedKey = String(key || 'anonymous');
      const attempt = attemptsByKey.get(normalizedKey);

      if (!attempt || now >= attempt.expiresAt) {
        attemptsByKey.set(normalizedKey, { count: 1, expiresAt: now + windowMs });
        return true;
      }

      if (attempt.count >= maxAttempts) {
        return false;
      }

      attempt.count += 1;
      return true;
    },

    reset(key) {
      attemptsByKey.delete(String(key || 'anonymous'));
    }
  };
}
