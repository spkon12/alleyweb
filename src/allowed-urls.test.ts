import assert from "node:assert/strict";
import {
  allowsUntrustedCertificate,
  allowsUntrustedCertificateForHost,
  blockedReason,
  isAllowedUrl,
  isExternalOAuthUrl,
  isChromiumCertificateOk,
  normalizeUserInput,
} from "./allowed-urls";

const allowed = [
  "http://192.168.1.254",
  "http://bthomehub.home",
  "http://hub.home",
  "http://localhost:3000",
  "http://127.0.0.1:8080",
  "https://10.0.0.5/admin",
  "http://192.168.0.1",
  "https://cursor.com",
  "https://cursor.sh",
  "https://docs.cursor.com",
  "https://www.cursor.com/pricing",
  "https://api.workos.com/user_management/authorize",
  "https://github.com/login/oauth/authorize",
  "https://authenticate.cursor.sh/user_management/authorize",
  "blob:https://192.168.1.254/abc-123",
  "about:blank",
  "file:///C:/Games/Alley%20Game/index.html",
];

const blocked = [
  "https://google.com",
  "https://example.org",
  "ftp://192.168.1.1",
  "javascript:alert(1)",
  "file:///etc/passwd",
  "file:///C:/Games/readme.txt",
  "file://server/share/game.html",
];

for (const url of allowed) {
  assert.equal(isAllowedUrl(url), true, `expected allowed: ${url}`);
}

for (const url of blocked) {
  assert.equal(isAllowedUrl(url), false, `expected blocked: ${url}`);
}

assert.equal(normalizeUserInput(""), "http://192.168.1.254");
assert.equal(
  normalizeUserInput("C:\\Games\\Alley Game\\index.html"),
  "file:///C:/Games/Alley%20Game/index.html"
);
assert.equal(normalizeUserInput("localhost:4000"), "http://localhost:4000");
assert.equal(normalizeUserInput("cursor.com"), "https://cursor.com");
assert.equal(normalizeUserInput("cursor.sh"), "https://cursor.sh");
assert.equal(
  normalizeUserInput("docs.cursor.com/agent"),
  "https://docs.cursor.com/agent"
);
assert.equal(
  normalizeUserInput("https://10.1.1.1"),
  "https://10.1.1.1"
);

assert.match(blockedReason("https://google.com"), /domain name/i);
assert.match(blockedReason("file:///tmp/note.txt"), /html files/i);

assert.equal(allowsUntrustedCertificate("https://192.168.1.254/"), true);
assert.equal(allowsUntrustedCertificate("https://bthomehub.home/"), true);
assert.equal(allowsUntrustedCertificate("https://localhost:8443/"), true);
assert.equal(allowsUntrustedCertificate("https://cursor.com"), false);
assert.equal(allowsUntrustedCertificate("https://google.com"), false);
assert.equal(allowsUntrustedCertificateForHost("192.168.1.254"), true);
assert.equal(allowsUntrustedCertificateForHost("cursor.com"), false);
assert.equal(isChromiumCertificateOk("net::OK"), true);
assert.equal(isChromiumCertificateOk("OK"), true);
assert.equal(isChromiumCertificateOk("net::ERR_CERT_AUTHORITY_INVALID"), false);
assert.equal(isAllowedUrl("blob:https://google.com/abc"), false);
assert.equal(
  isExternalOAuthUrl(
    "https://accounts.google.com/o/oauth2/v2/auth?client_id=x"
  ),
  true
);
assert.equal(
  isExternalOAuthUrl(
    "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
  ),
  true
);
assert.equal(
  isExternalOAuthUrl("http://accounts.google.com/o/oauth2/auth"),
  false
);
assert.equal(
  isExternalOAuthUrl("https://accounts.google.com.evil.test/oauth/authorize"),
  false
);
assert.equal(
  isExternalOAuthUrl("https://example.org/oauth/authorize"),
  false
);

console.log("allowed-urls: all checks passed");