import { app, BrowserWindow, BrowserView, ipcMain, session } from "electron";
import * as path from "path";
import {
  allowsUntrustedCertificateForHost,
  BT_HUB_DEFAULT,
  blockedReason,
  isAllowedUrl,
  normalizeUserInput,
} from "./allowed-urls";

const CHROME_HEIGHT = 52;
const SIDEBAR_WIDTH = 0;
const DEBUG = process.env.ALLEYWEB_DEBUG === "1" || !app.isPackaged;

function debugLog(message: string, data?: unknown): void {
  if (!DEBUG) return;
  if (data === undefined) {
    console.log(`[alleyweb] ${message}`);
    return;
  }
  console.log(`[alleyweb] ${message}`, data);
}

let mainWindow: BrowserWindow | null = null;
let browserView: BrowserView | null = null;

function layoutBrowserView(): void {
  if (!mainWindow || !browserView) return;
  const [width, height] = mainWindow.getContentSize();
  browserView.setBounds({
    x: SIDEBAR_WIDTH,
    y: CHROME_HEIGHT,
    width: Math.max(0, width - SIDEBAR_WIDTH),
    height: Math.max(0, height - CHROME_HEIGHT),
  });
}

function sendToChrome(channel: string, ...args: unknown[]): void {
  mainWindow?.webContents.send(channel, ...args);
}

function stopLoading(): void {
  browserView?.webContents.stop();
  sendToChrome("loading-changed", false);
}

function blockNavigation(url: string): void {
  stopLoading();
  sendToChrome("navigation-blocked", blockedReason(url));
}

function attachNavigationGuards(view: BrowserView): void {
  const wc = view.webContents;

  wc.on("will-navigate", (event, url) => {
    debugLog("will-navigate", { url, allowed: isAllowedUrl(url) });
    if (!isAllowedUrl(url)) {
      event.preventDefault();
      blockNavigation(url);
    }
  });

  wc.on("will-redirect", (event, url) => {
    debugLog("will-redirect", { url, allowed: isAllowedUrl(url) });
    if (!isAllowedUrl(url)) {
      event.preventDefault();
      blockNavigation(url);
    }
  });

  wc.setWindowOpenHandler(({ url }) => {
    if (isAllowedUrl(url)) {
      wc.stop();
      wc.loadURL(url);
    } else {
      blockNavigation(url);
    }
    return { action: "deny" };
  });

  wc.on("did-start-loading", () => sendToChrome("loading-changed", true));
  wc.on("did-stop-loading", () => sendToChrome("loading-changed", false));
  wc.on("did-navigate", (_event, url) => {
    debugLog("did-navigate", url);
    sendToChrome("url-changed", url);
  });
  wc.on("did-navigate-in-page", (_event, url) => {
    debugLog("did-navigate-in-page", url);
    sendToChrome("url-changed", url);
  });

  wc.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      debugLog("did-fail-load", {
        errorCode,
        errorDescription,
        validatedURL,
        isMainFrame,
      });
      if (!isMainFrame) return;
      sendToChrome("loading-changed", false);
      // ERR_ABORTED (-3) is expected after wc.stop().
      if (errorCode === -3) return;
      sendToChrome(
        "navigation-failed",
        `${errorDescription} (${validatedURL || "unknown address"})`
      );
    }
  );
}

async function navigateTo(
  rawInput: string
): Promise<{ ok: true; url: string } | { ok: false; reason: string }> {
  const wc = browserView?.webContents;
  if (!wc) {
    return { ok: false, reason: "Browser is not ready yet." };
  }

  const url = normalizeUserInput(rawInput);
  debugLog("navigateTo", { rawInput, url, allowed: isAllowedUrl(url) });
  if (!isAllowedUrl(url)) {
    sendToChrome("loading-changed", false);
    return { ok: false, reason: blockedReason(url) };
  }

  try {
    await wc.loadURL(url);
    debugLog("navigateTo success", wc.getURL());
    return { ok: true, url: wc.getURL() || url };
  } catch (error) {
    sendToChrome("loading-changed", false);
    const message =
      error instanceof Error ? error.message : "Could not open that address.";
    debugLog("navigateTo failed", message);
    return { ok: false, reason: message };
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 480,
    minHeight: 360,
    title: "Alleyweb",
    backgroundColor: "#0f0f0f",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  browserView = new BrowserView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.setBrowserView(browserView);
  attachNavigationGuards(browserView);
  layoutBrowserView();

  mainWindow.on("resize", layoutBrowserView);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  if (DEBUG) {
    mainWindow.webContents.on("console-message", (_event, level, message) => {
      console.log(`[chrome:${level}] ${message}`);
    });
  }
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

  browserView.webContents.loadURL(BT_HUB_DEFAULT);

  mainWindow.on("closed", () => {
    mainWindow = null;
    browserView = null;
  });
}

function installSessionBlocklist(): void {
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ["*://*/*"] },
    (details, callback) => {
      if (details.resourceType === "mainFrame") {
        const allowed = isAllowedUrl(details.url);
        debugLog("webRequest mainFrame", { url: details.url, allowed });
        callback({ cancel: !allowed });
        return;
      }
      // Subresources inherit the main frame origin on allowed pages.
      callback({ cancel: false });
    }
  );
}

function trustCertificateForAllowedLan(url: string): boolean {
  try {
    return allowsUntrustedCertificateForHost(new URL(url).hostname);
  } catch {
    return false;
  }
}

app.on(
  "certificate-error",
  (event, _webContents, url, error, _certificate, callback) => {
    const trust = trustCertificateForAllowedLan(url);
    debugLog("certificate-error", { url, error, trust });
    if (trust) {
      event.preventDefault();
      callback(true);
      return;
    }
    callback(false);
  }
);

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
}

app.whenReady().then(async () => {
  await session.defaultSession.clearCache();
  installSessionBlocklist();
  createWindow();

  ipcMain.handle("navigate", async (_event, input: string) => {
    debugLog("ipc navigate", input);
    const result = await navigateTo(input);
    debugLog("ipc navigate result", result);
    if (!result.ok) {
      sendToChrome("navigation-blocked", result.reason);
    }
    return result;
  });
  ipcMain.handle("go-back", () => browserView?.webContents.goBack());
  ipcMain.handle("go-forward", () => browserView?.webContents.goForward());
  ipcMain.handle("reload", () => {
    browserView?.webContents.stop();
    browserView?.webContents.reload();
  });
  ipcMain.handle("go-home", async () => navigateTo(""));
  ipcMain.handle(
    "get-current-url",
    () => browserView?.webContents.getURL() ?? BT_HUB_DEFAULT
  );

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  if (process.env.ALLEYWEB_E2E === "cursor") {
    setTimeout(async () => {
      const result = await navigateTo("cursor.com");
      debugLog("e2e self-test result", result);
      app.exit(result.ok ? 0 : 1);
    }, 3000);
  }

  if (process.env.ALLEYWEB_E2E === "form") {
    setTimeout(async () => {
      try {
        if (!mainWindow || !browserView) throw new Error("windows missing");
        await mainWindow.webContents.executeJavaScript(`
          document.getElementById('url-input').value = 'cursor.com';
          document.getElementById('url-form').requestSubmit();
        `);
        await new Promise((resolve) => setTimeout(resolve, 8000));
        const current = browserView.webContents.getURL();
        debugLog("e2e form browserView url", current);
        app.exit(current.includes("cursor.com") ? 0 : 1);
      } catch (error) {
        debugLog("e2e form failed", error);
        app.exit(1);
      }
    }, 3000);
  }

  if (process.env.ALLEYWEB_E2E === "ipc") {
    setTimeout(async () => {
      try {
        if (!mainWindow) throw new Error("main window missing");
        const result = await mainWindow.webContents.executeJavaScript(
          "window.alleyweb.navigate('cursor.com')"
        );
        debugLog("e2e ipc result", result);
        const current = browserView?.webContents.getURL() ?? "";
        debugLog("e2e ipc browserView url", current);
        const ok =
          result?.ok === true && current.includes("cursor.com");
        app.exit(ok ? 0 : 1);
      } catch (error) {
        debugLog("e2e ipc failed", error);
        app.exit(1);
      }
    }, 3000);
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

