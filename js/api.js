import { auth } from "./firebase-config.js";

export const DEFAULT_API_BASE_URL = "http://127.0.0.1:3001";

function validateApiBaseUrl(baseUrl) {
  if (typeof baseUrl !== "string" || !baseUrl.trim()) {
    throw new TypeError("API base URL must be a non-empty string.");
  }

  let parsed;
  try {
    parsed = new URL(baseUrl.trim());
  } catch {
    throw new TypeError("API base URL must be a valid HTTP or HTTPS URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new TypeError("API base URL must use HTTP or HTTPS.");
  }
  if (parsed.username || parsed.password) {
    throw new TypeError("API base URL must not contain credentials.");
  }
  if (parsed.search || parsed.hash) {
    throw new TypeError("API base URL must not contain a query string or fragment.");
  }
  return parsed.toString().replace(/\/+$/, "");
}

let apiBaseUrl = validateApiBaseUrl(
  globalThis.WELLEXSA_API_BASE_URL ||
  globalThis.document?.querySelector('meta[name="wellexsa-api-base-url"]')?.content ||
  DEFAULT_API_BASE_URL
);

export class ApiError extends Error {
  constructor(message, status = 0, code = "API_ERROR") {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export function configureApiBaseUrl(baseUrl) {
  apiBaseUrl = validateApiBaseUrl(baseUrl);
  return apiBaseUrl;
}

function normalizeApiPath(path) {
  if (typeof path !== "string" || !path.trim()) {
    throw new TypeError("API path must be a non-empty string.");
  }

  const normalized = path.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(normalized) || normalized.startsWith("//")) {
    throw new TypeError("API path must be relative to the configured API base URL.");
  }
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

function readJsonSafely(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isPlainObjectOrArray(body) {
  if (Array.isArray(body)) return true;
  if (body === null || typeof body !== "object") return false;

  const prototype = Object.getPrototypeOf(body);
  return prototype === Object.prototype || prototype === null;
}

function isBinaryOrStreamingBody(body) {
  if ((typeof Blob !== "undefined" && body instanceof Blob) ||
    (typeof ArrayBuffer !== "undefined" && body instanceof ArrayBuffer) ||
    (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) ||
    (typeof ReadableStream !== "undefined" && body instanceof ReadableStream) ||
    (typeof FormData !== "undefined" && body instanceof FormData)) {
    return true;
  }

  return typeof ArrayBuffer !== "undefined" &&
    typeof ArrayBuffer.isView === "function" &&
    ArrayBuffer.isView(body);
}

function backendError(payload, response) {
  const error = payload?.error;
  const code = typeof error?.code === "string" ? error.code : "API_ERROR";
  const message = typeof error?.message === "string" && error.message.trim()
    ? error.message.trim()
    : typeof payload?.message === "string" && payload.message.trim()
      ? payload.message.trim()
      : response.status >= 500
        ? "The service is temporarily unavailable."
        : "The request could not be completed.";
  return new ApiError(message, response.status, code);
}

export async function callApi(path, options = {}) {
  if (!auth?.currentUser) {
    throw new ApiError(
      "Sign in before calling the backend.",
      401,
      "UNAUTHENTICATED"
    );
  }

  let token;
  try {
    token = await auth.currentUser.getIdToken();
  } catch {
    throw new ApiError(
      "Firebase authentication could not be verified.",
      401,
      "UNAUTHENTICATED"
    );
  }

  if (typeof token !== "string" || !token) {
    throw new ApiError(
      "Firebase authentication could not be verified.",
      401,
      "UNAUTHENTICATED"
    );
  }

  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("Fetch options must be an object.");
  }

  const headers = new Headers(options.headers);
  // Authorization is reserved: always replace caller input with the current Firebase ID token.
  headers.set("Authorization", `Bearer ${token}`);

  let body = options.body;
  if (isPlainObjectOrArray(body)) {
    body = JSON.stringify(body);
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
  } else if (!isBinaryOrStreamingBody(body) &&
    body !== undefined &&
    body !== null &&
    !headers.has("Content-Type") &&
    typeof body === "string") {
    const sample = body.trim();
    if (sample.startsWith("{") || sample.startsWith("[") || sample === "null") {
      headers.set("Content-Type", "application/json");
    }
  }

  const requestUrl = `${apiBaseUrl}${normalizeApiPath(path)}`;
  let response;
  try {
    response = await fetch(requestUrl, {
      ...options,
      body,
      headers,
      credentials: "omit"
    });
  } catch {
    throw new ApiError(
      "The service could not be reached.",
      0,
      "NETWORK_ERROR"
    );
  }

  let text;
  let payload;
  try {
    text = await response.text();
  } catch {
    throw new ApiError(
      "The service could not be reached.",
      0,
      "NETWORK_ERROR"
    );
  }
  payload = readJsonSafely(text);

  if (!response.ok) {
    throw backendError(payload, response);
  }

  return payload;
}
