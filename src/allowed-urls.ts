/**
 * Alleyweb URL policy — only these destinations are reachable.
 *
 * 1. BT Home Hub (default IP + known hostnames)
 * 2. localhost / 127.0.0.1 on any port
 * 3. Direct IPv4 literal addresses on any port
 * 4. cursor.com / cursor.sh and their subdomains
 * 5. workos.com (Cursor login via WorkOS AuthKit)
 * 6. github.com (Cursor login via GitHub OAuth)
 */

const BT_HUB_HOSTNAMES = new Set([
  "bthomehub.home",
  "hub.home",
  "bthomehub",
]);

const ALLOWED_DOMAIN_SUFFIXES = [
  "cursor.com",
  "cursor.sh",
  "workos.com",
  "github.com",
];

/** Default BT Smart Hub admin address on most home networks. */
export const BT_HUB_DEFAULT = "http://192.168.1.254";

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

function isIPv4Literal(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    const n = Number(part);
    return n >= 0 && n <= 255;
  });
}

function isLocalhost(host: string): boolean {
  const normalized = host.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "[::1]"
  );
}

function isAllowedDomain(host: string): boolean {
  const normalized = host.toLowerCase();
  return ALLOWED_DOMAIN_SUFFIXES.some(
    (domain) => normalized === domain || normalized.endsWith(`.${domain}`)
  );
}

export function isChromiumCertificateOk(verificationResult: string): boolean {
  return verificationResult === "OK" || verificationResult === "net::OK";
}

/** Self-signed certs are expected on hub/LAN targets, not on public allowlist domains. */
export function allowsUntrustedCertificateForHost(host: string): boolean {
  const normalized = host.toLowerCase();
  if (isAllowedDomain(normalized)) return false;
  if (isLocalhost(normalized)) return true;
  if (BT_HUB_HOSTNAMES.has(normalized)) return true;
  if (normalized === "192.168.1.254") return true;
  return isIPv4Literal(normalized);
}

/** LAN/hub targets often use self-signed HTTPS; public allowlist domains do not. */
export function allowsUntrustedCertificate(rawUrl: string): boolean {
  if (!isAllowedUrl(rawUrl)) return false;

  try {
    return allowsUntrustedCertificateForHost(new URL(rawUrl).hostname);
  } catch {
    return false;
  }
}

function isAllowedBlobUrl(rawUrl: string): boolean {
  const originMatch = rawUrl.match(/^blob:(https?:\/\/[^/]+)/i);
  if (!originMatch) return false;
  return isAllowedUrl(`${originMatch[1]}/`);
}

export function isAllowedUrl(rawUrl: string): boolean {
  if (rawUrl.startsWith("blob:")) {
    return isAllowedBlobUrl(rawUrl);
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }

  if (parsed.protocol === "about:" && parsed.pathname === "blank") {
    return true;
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return false;
  }

  const host = parsed.hostname.toLowerCase();

  if (isLocalhost(host)) return true;
  if (BT_HUB_HOSTNAMES.has(host)) return true;
  if (isAllowedDomain(host)) return true;
  if (host === "192.168.1.254") return true;
  if (isIPv4Literal(host)) return true;

  return false;
}

export function normalizeUserInput(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return BT_HUB_DEFAULT;

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  if (/^(?:[\w-]+\.)*cursor\.(?:com|sh)(?::\d+)?(?:\/.*)?$/i.test(trimmed)) {
    return `https://${trimmed}`;
  }

  // Bare IPv4 or hostname — assume http (typical for hub / LAN devices).
  if (/^[\d.a-z-]+(?::\d+)?(?:\/.*)?$/i.test(trimmed)) {
    return `http://${trimmed}`;
  }

  return trimmed;
}

export function blockedReason(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return "That address is not valid.";
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return `Only http and https are allowed — not ${parsed.protocol}`;
  }

  const host = parsed.hostname.toLowerCase();
  if (host.includes(".")) {
    const labels = host.split(".");
    const looksLikeDomain =
      labels.length >= 2 &&
      labels.every((l) => /^[a-z0-9-]+$/i.test(l)) &&
      !isIPv4Literal(host);

    if (
      looksLikeDomain &&
      !BT_HUB_HOSTNAMES.has(host) &&
      !isAllowedDomain(host)
    ) {
      return `"${host}" is a domain name. Alleyweb only opens localhost, direct IP addresses, the BT Home Hub, cursor.com, and Cursor login (workos.com, github.com).`;
    }
  }

  return `"${host}" is not on the allowlist.`;
}
