export function createRateLimiter({
  limit = 120,
  windowMs = 60_000,
  maxClients = 10_000,
  now = Date.now
} = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1 ||
      !Number.isSafeInteger(windowMs) || windowMs < 1 ||
      !Number.isSafeInteger(maxClients) || maxClients < 1 ||
      typeof now !== "function") {
    throw new TypeError("Rate-limit settings are invalid.");
  }

  const clients = new Map();

  return function rateLimit(request, response, next) {
    const time = now();
    const key = request.ip || request.socket.remoteAddress || "unknown";
    let client = clients.get(key);

    if (!client || time >= client.resetAt) {
      if (!client && clients.size >= maxClients) {
        for (const [clientKey, entry] of clients) {
          if (time >= entry.resetAt) clients.delete(clientKey);
        }
      }
      if (!client && clients.size >= maxClients) {
        response.status(429).json({
          error: {
            code: "RATE_LIMITED",
            message: "Too many requests. Try again shortly."
          }
        });
        return;
      }
      client = { count: 0, resetAt: time + windowMs };
      clients.set(key, client);
    }

    response.set("RateLimit-Limit", String(limit));
    response.set("RateLimit-Remaining", String(Math.max(0, limit - client.count - 1)));
    if (client.count >= limit) {
      response.set("Retry-After", String(Math.max(1, Math.ceil((client.resetAt - time) / 1000))));
      response.status(429).json({
        error: {
          code: "RATE_LIMITED",
          message: "Too many requests. Try again shortly."
        }
      });
      return;
    }

    client.count += 1;
    next();
  };
}
