/**
 * Headless integration test: hub -> cursor.com via BrowserView + session policy.
 * Exit 0 on success, 1 on failure. Mirrors src/main.ts navigation stack.
 */
const { app, BrowserWindow, BrowserView, session } = require("electron");
const {
  allowsUntrustedCertificateForHost,
  BT_HUB_DEFAULT,
  isAllowedUrl,
  normalizeUserInput,
} = require("../dist/allowed-urls");

const TARGET = "cursor.com";

function log(...args) {
  console.log("[e2e]", ...args);
}

function trustCertificateForAllowedLan(url) {
  try {
    return allowsUntrustedCertificateForHost(new URL(url).hostname);
  } catch {
    return false;
  }
}

app.on("certificate-error", (event, _wc, url, error, _cert, callback) => {
  const trust = trustCertificateForAllowedLan(url);
  log("certificate-error", { url, error, trust });
  if (trust) {
    event.preventDefault();
    callback(true);
    return;
  }
  callback(false);
});

function installSessionBlocklist() {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ["*://*/*"] }, (details, cb) => {
    if (details.resourceType === "mainFrame") {
      const allowed = isAllowedUrl(details.url);
      log("webRequest mainFrame", details.url, "allowed=", allowed);
      cb({ cancel: !allowed });
      return;
    }
    cb({ cancel: false });
  });
}

async function navigateTo(wc, rawInput) {
  const url = normalizeUserInput(rawInput);
  log("navigateTo input=", JSON.stringify(rawInput), "normalized=", url, "allowed=", isAllowedUrl(url));
  if (!isAllowedUrl(url)) {
    throw new Error(`blocked: ${url}`);
  }
  await wc.loadURL(url);
  return url;
}

app.whenReady().then(async () => {
  await session.defaultSession.clearCache();
  installSessionBlocklist();

  const mainWindow = new BrowserWindow({ show: false, width: 900, height: 700 });
  const browserView = new BrowserView({
    webPreferences: { sandbox: true, webSecurity: true, contextIsolation: true },
  });
  mainWindow.setBrowserView(browserView);
  browserView.setBounds({ x: 0, y: 52, width: 900, height: 648 });

  const wc = browserView.webContents;
  wc.on("will-navigate", (_e, url) => log("will-navigate", url));
  wc.on("will-redirect", (_e, url) => log("will-redirect", url));
  wc.on("did-navigate", (_e, url) => log("did-navigate", url));
  wc.on("did-fail-load", (_e, code, desc, url, main) =>
    log("did-fail-load", { code, desc, url, main })
  );

  try {
    log("step 1: load hub", BT_HUB_DEFAULT);
    await wc.loadURL(BT_HUB_DEFAULT);
    log("hub url", wc.getURL());

    log("step 2: navigate to", TARGET);
    const finalUrl = await navigateTo(wc, TARGET);
    const current = wc.getURL();
    log("result url", current, "expected host cursor.com");

    if (!current.includes("cursor.com")) {
      throw new Error(`expected cursor.com, got ${current}`);
    }

    log("PASS");
    app.exit(0);
  } catch (error) {
    log("FAIL", error instanceof Error ? error.message : error);
    app.exit(1);
  }
});
