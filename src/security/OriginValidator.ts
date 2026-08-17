/**
 * OriginValidator: CSWSH protection (Cross-Site WebSocket Hijacking).
 *
 * Browsers attach cookies to WS upgrades, so an evil page could open a socket
 * AS the logged-in user. The browser also sends an `Origin` header we can
 * check — if it's not on the allowlist, drop the handshake before auth.
 *
 * Non-browser clients (CLI tools) may omit Origin entirely — they are
 * rejected by design unless added to the allowlist: strict beats permissive.
 */

export class OriginValidator {
  private readonly allowed: string[];

  constructor(allowedOrigins: string[]) {
    // Normalize: "http://a.com/" and "http://a.com" are the same origin
    this.allowed = allowedOrigins.map((origin) => origin.replace(/\/$/, ""));
  }

  validate(origin: string | undefined): boolean {
    if (origin === undefined) return false;
    return this.allowed.includes(origin.replace(/\/$/, ""));
  }
}
