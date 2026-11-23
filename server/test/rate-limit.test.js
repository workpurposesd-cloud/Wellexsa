import assert from "node:assert/strict";
import test from "node:test";
import { createRateLimiter } from "../src/middleware/rateLimit.js";

function invoke(limiter, ip) {
  const result = {
    headers: {},
    statusCode: 200,
    body: null,
    continued: false
  };
  const response = {
    set(name, value) {
      result.headers[name] = value;
      return this;
    },
    status(statusCode) {
      result.statusCode = statusCode;
      return this;
    },
    json(body) {
      result.body = body;
      return this;
    }
  };
  limiter({ ip, socket: {} }, response, () => {
    result.continued = true;
  });
  return result;
}

test("rate limiter rejects requests over the configured per-IP limit", () => {
  const limiter = createRateLimiter({ limit: 2, windowMs: 1000, now: () => 10_000 });

  assert.equal(invoke(limiter, "127.0.0.1").continued, true);
  assert.equal(invoke(limiter, "127.0.0.1").continued, true);
  const limited = invoke(limiter, "127.0.0.1");

  assert.equal(limited.statusCode, 429);
  assert.equal(limited.headers["Retry-After"], "1");
  assert.deepEqual(limited.body, {
    error: {
      code: "RATE_LIMITED",
      message: "Too many requests. Try again shortly."
    }
  });
});

test("rate limiter expires windows and isolates clients", () => {
  let time = 10_000;
  const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: () => time });

  assert.equal(invoke(limiter, "127.0.0.1").continued, true);
  assert.equal(invoke(limiter, "127.0.0.2").continued, true);
  assert.equal(invoke(limiter, "127.0.0.1").statusCode, 429);
  time += 1000;
  assert.equal(invoke(limiter, "127.0.0.1").continued, true);
});
