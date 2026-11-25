import { app, BrowserWindow, BrowserView, ipcMain, session } from "electron";
import * as path from "path";
import {
  allowsUntrustedCertificateForHost,
  BT_HUB_DEFAULT,
  blockedReason,
  isAllowedUrl,
  normalizeUserInput,
} from "./allowed-urls";

const DEFAULT_TAB_BAR_HEIGHT = 36;
const DEFAULT_TOOLBAR_HEIGHT = 52;
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

interface TabState {
  id: number;
  view: BrowserView;
}

let mainWindow: BrowserWindow | null = null;
let tabs: TabState[] = [];
let activeTabId: number | null = null;
let nextTabId = 1;
/** Measured from renderer (tab strip + toolbar); fallback until first report. */
let topChromeHeight = DEFAULT_TAB_BAR_HEIGHT + DEFAULT_TOOLBAR_HEIGHT;

function layoutBrowserView(): void {
  if (!mainWindow || activeTabId === null) return;
  const tab = tabs.find((t) => t.id === activeTabId);
  if (!tab) return;
  const [width, height] = mainWindow.getContentSize();
  tab.view.setBounds({
    x: SIDEBAR_WIDTH,
    y: topChromeHeight,
    width: Math.max(0, width - SIDEBAR_WIDTH),
    height: Math.max(0, height - topChromeHeight),
  });
}

function bindLayoutEvents(): void {
  if (!mainWindow) return;
  const relayout = () => layoutBrowserView();
  mainWindow.on("resize", relayout);
  mainWindow.on("maximize", relayout);
  mainWindow.on("unmaximize", relayout);
  mainWindow.on("enter-full-screen", relayout);
  mainWindow.on("leave-full-screen", relayout);
}

function sendToChrome(channel: string, ...args: unknown[]): void {
  mainWindow?.webContents.send(channel, ...args);
}

function broadcastTabs(): void {
  sendToChrome(
    "tabs-updated",
    tabs.map((t) => ({
      id: t.id,
      title: t.view.webContents.getTitle() || "New tab",
      active: t.id === activeTabId,
    }))
  );
}

function stopLoading(tab: TabState): void {
  tab.view.webContents.stop();
  if (tab.id === activeTabId) {
    sendToChrome("loading-changed", false);
  }
}

function blockNavigation(tab: TabState, url: string): void {
  stopLoading(tab);
  if (tab.id === activeTabId) {
    sendToChrome("navigation-blocked", blockedReason(url));
  }
}

function attachNavigationGuards(view: BrowserView, tabId: number): void {
  const wc = view.webContents;

  const sendIfActive = (channel: string, ...args: unknown[]) => {
    if (activeTabId === tabId) sendToChrome(channel, ...args);
  };

  wc.on("will-navigate", (event, url) => {
    debugLog("will-navigate", { tabId, url, allowed: isAllowedUrl(url) });
    if (!isAllowedUrl(url)) {
      event.preventDefault();
      const tab = tabs.find((t) => t.id === tabId);
      if (tab) blockNavigation(tab, url);
    }
  });

  wc.on("will-redirect", (event, url) => {
    debugLog("will-redirect", { tabId, url, allowed: isAllowedUrl(url) });
    if (!isAllowedUrl(url)) {
      event.preventDefault();
      const tab = tabs.find((t) => t.id === tabId);
      if (tab) blockNavigation(tab, url);
    }
  });

  wc.setWindowOpenHandler(({ url }) => {
    if (isAllowedUrl(url)) {
      wc.stop();
      wc.loadURL(url);
    } else {
      const tab = tabs.find((t) => t.id === tabId);
      if (tab) blockNavigation(tab, url);
    }
    return { action: "deny" };
  });

  wc.on("did-start-loading", () => sendIfActive("loading-changed", true));
  wc.on("did-stop-loading", () => sendIfActive("loading-changed", false));
  wc.on("did-navigate", (_event, url) => {
    debugLog("did-navigate", { tabId, url });
    sendIfActive("url-changed", url);
  });
  wc.on("did-navigate-in-page", (_event, url) => {
    debugLog("did-navigate-in-page", { tabId, url });
    sendIfActive("url-changed", url);
  });
  wc.on("page-title-updated", () => broadcastTabs());

  wc.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      debugLog("did-fail-load", {
        tabId,
        errorCode,
        errorDescription,
        validatedURL,
        isMainFrame,
      });
      if (!isMainFrame) return;
      sendIfActive("loading-changed", false);
      if (errorCode === -3) return;
      sendIfActive(
        "navigation-failed",
        `${errorDescription} (${validatedURL || "unknown address"})`
      );
    }
  );
}

function createBrowserView(): BrowserView {
  return new BrowserView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
}

function setActiveTab(id: number): void {
  if (!mainWindow) return;
  const tab = tabs.find((t) => t.id === id);
  if (!tab) return;
  activeTabId = id;
  mainWindow.setBrowserView(tab.view);
  layoutBrowserView();
  sendToChrome("url-changed", tab.view.webContents.getURL() || BT_HUB_DEFAULT);
  sendToChrome("loading-changed", tab.view.webContents.isLoading());
  broadcastTabs();
}

function createTab(url: string = BT_HUB_DEFAULT): number {
  const id = nextTabId++;
  const view = createBrowserView();
  attachNavigationGuards(view, id);
  tabs.push({ id, view });
  void view.webContents.loadURL(url);
  setActiveTab(id);
  return id;
}

function closeTab(id: number): void {
  const index = tabs.findIndex((t) => t.id === id);
  if (index === -1) return;
  const [removed] = tabs.splice(index, 1);
  if (mainWindow?.getBrowserView() === removed.view) {
    mainWindow.setBrowserView(null);
  }
  removed.view.webContents.close();
  if (tabs.length === 0) {
    createTab();
    return;
  }
  if (activeTabId === id) {
    const next = tabs[Math.min(index, tabs.length - 1)];
    setActiveTab(next.id);
  } else {
    broadcastTabs();
  }
}

function activeTab(): TabState | undefined {
  if (activeTabId === null) return undefined;
  return tabs.find((t) => t.id === activeTabId);
}

async function navigateTo(
  rawInput: string
): Promise<{ ok: true; url: string } | { ok: false; reason: string }> {
  const tab = activeTab();
  const wc = tab?.view.webContents;
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

  bindLayoutEvents();
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  if (DEBUG) {
    mainWindow.webContents.on("console-message", (_event, level, message) => {
      console.log(`[chrome:${level}] ${message}`);
    });
  }
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

  createTab(BT_HUB_DEFAULT);

  mainWindow.on("closed", () => {
    mainWindow = null;
    tabs = [];
    activeTabId = null;
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

  ipcMain.handle("set-top-chrome-height", (_event, height: number) => {
    if (typeof height !== "number" || !Number.isFinite(height) || height < 0) {
      return;
    }
    const rounded = Math.round(height);
    if (rounded === topChromeHeight) return;
    topChromeHeight = rounded;
    debugLog("top chrome height", topChromeHeight);
    layoutBrowserView();
  });

  ipcMain.handle("tabs-new", () => {
    const id = createTab();
    return id;
  });
  ipcMain.handle("tabs-close", (_event, tabId: number) => {
    closeTab(tabId);
  });
  ipcMain.handle("tabs-activate", (_event, tabId: number) => {
    setActiveTab(tabId);
  });

  ipcMain.handle("navigate", async (_event, input: string) => {
    debugLog("ipc navigate", input);
    const result = await navigateTo(input);
    debugLog("ipc navigate result", result);
    if (!result.ok) {
      sendToChrome("navigation-blocked", result.reason);
    }
    return result;
  });
  ipcMain.handle("go-back", () => activeTab()?.view.webContents.goBack());
  ipcMain.handle("go-forward", () => activeTab()?.view.webContents.goForward());
  ipcMain.handle("reload", () => {
    const wc = activeTab()?.view.webContents;
    wc?.stop();
    wc?.reload();
  });
  ipcMain.handle("go-home", async () => navigateTo(""));
  ipcMain.handle(
    "get-current-url",
    () => activeTab()?.view.webContents.getURL() ?? BT_HUB_DEFAULT
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
        const tab = activeTab();
        if (!mainWindow || !tab) throw new Error("windows missing");
        await mainWindow.webContents.executeJavaScript(`
          document.getElementById('url-input').value = 'cursor.com';
          document.getElementById('url-form').requestSubmit();
        `);
        await new Promise((resolve) => setTimeout(resolve, 8000));
        const current = tab.view.webContents.getURL();
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
        const current = activeTab()?.view.webContents.getURL() ?? "";
        debugLog("e2e ipc browserView url", current);
        const ok = result?.ok === true && current.includes("cursor.com");
        app.exit(ok ? 0 : 1);
      } catch (error) {
        debugLog("e2e ipc failed", error);
        app.exit(1);
      }
    }, 3000);
  }

  if (process.env.ALLEYWEB_E2E === "screenshot") {
    setTimeout(async () => {
      try {
        if (!mainWindow) throw new Error("main window missing");
        createTab(BT_HUB_DEFAULT);
        await new Promise((resolve) => setTimeout(resolve, 500));
        const image = await mainWindow.webContents.capturePage();
        const out = process.env.ALLEYWEB_SCREENSHOT_PATH ?? "/opt/cursor/artifacts/tab-bar.png";
        const { writeFileSync, mkdirSync } = await import("fs");
        const { dirname } = await import("path");
        mkdirSync(dirname(out), { recursive: true });
        writeFileSync(out, image.toPNG());
        debugLog("screenshot saved", out);
        app.exit(0);
      } catch (error) {
        debugLog("screenshot failed", error);
        app.exit(1);
      }
    }, 2000);
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});