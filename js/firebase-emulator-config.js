export function shouldConnectAuthEmulator({
  explicitOptIn = false,
  hostname = ""
} = {}) {
  return explicitOptIn === true &&
    (hostname === "localhost" || hostname === "127.0.0.1");
}
