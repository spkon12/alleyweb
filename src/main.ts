import {
  app,
  BrowserWindow,
  BrowserView,
  ipcMain,
  session,
  shell,
  WebContents,
} from "electron";
import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "node:url";
import {
  allowsUntrustedCertificateForHost,
  BT_HUB_DEFAULT,
  blockedReason,
  isAllowedUrl,
  isExternalOAuthUrl,
  normalizeUserInput,
} from "./allowed-urls";

const DEFAULT_TAB_BAR_HEIGHT = 36;
const DEFAULT_TOOLBAR_HEIGHT = 52;
const SIDEBAR_WIDTH = 0;
const DEBUG = process.env.ALLEYWEB_DEBUG === "1" || !app.isPackaged;
const OAUTH_OPENED_MESSAGE =
  "This sign-in opened in your system browser. Return here when it finishes.";

function debugLog(message: string, data?: unknown): void {
  if (!DEBUG) return;
  if (data === undefined) {
    console.log(`[alleyweb] ${message}`);
    return;
  }
  console.log(`[alleyweb] ${message}`, data);
}

function tabsStatePath(): string {
  return path.join(app.getPath("userData"), "tabs.json");
}

interface TabState {
  id: number;
  view: BrowserView;
  url: string;
}

let mainWindow: BrowserWindow | null = null;
let tabs: TabState[] = [];
let activeTabId: number | null = null;
let nextTabId = 1;
/** Measured from renderer (tab strip + toolbar); fallback until first report. */
let topChromeHeight = DEFAULT_TAB_BAR_HEIGHT + DEFAULT_TOOLBAR_HEIGHT;

function isChromeIpc(event: Electron.IpcMainInvokeEvent): boolean {
  return event.sender === mainWindow?.webContents;
}

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

function persistAndBroadcastTabs(): void {
  try {
    const urls = tabs
      .map((t) => t.url || t.view.webContents.getURL())
      .filter((u) => isAllowedUrl(u));
    const activeIndex = tabs.findIndex((t) => t.id === activeTabId);
    fs.writeFileSync(
      tabsStatePath(),
      JSON.stringify({
        tabs: urls,
        activeIndex: Math.max(0, activeIndex),
      })
    );
  } catch (error) {
    debugLog("could not persist tabs", error);
  }
  sendToChrome(
    "tabs-updated",
    tabs.map((t) => ({
      id: t.id,
      title: t.view.webContents.getTitle() || "New tab",
      active: t.id === activeTabId,
    }))
  );
}

function stopLoading(tabId: number | null = activeTabId): void {
  const view =
    tabId === null
      ? undefined
      : tabs.find((t) => t.id === tabId)?.view;
  view?.webContents.stop();
  if (tabId === activeTabId) {
    sendToChrome("loading-changed", false);
  }
}

function blockNavigation(
  url: string,
  tabId: number | null = activeTabId
): void {
  stopLoading(tabId);
  sendToChrome("navigation-blocked", blockedReason(url));
}

function handleBlockedUrl(url: string, tabId: number | null): void {
  if (isExternalOAuthUrl(url)) {
    void shell.openExternal(url);
    sendToChrome("navigation-blocked", OAUTH_OPENED_MESSAGE);
    return;
  }
  blockNavigation(url, tabId);
}

function attachNavigationGuards(wc: WebContents, tabId: number | null): void {
  const sendIfActive = (channel: string, ...args: unknown[]) => {
    if (tabId === activeTabId) sendToChrome(channel, ...args);
  };

  wc.on("will-navigate", (event, url) => {
    debugLog("will-navigate", { tabId, url, allowed: isAllowedUrl(url) });
    if (!isAllowedUrl(url)) {
      event.preventDefault();
      handleBlockedUrl(url, tabId);
    }
  });

  wc.on("will-redirect", (event, url) => {
    debugLog("will-redirect", { tabId, url, allowed: isAllowedUrl(url) });
    if (!isAllowedUrl(url)) {
      event.preventDefault();
      handleBlockedUrl(url, tabId);
    }
  });

  wc.setWindowOpenHandler(({ url }) => {
    if (isExternalOAuthUrl(url)) {
      void shell.openExternal(url);
      sendToChrome("navigation-blocked", OAUTH_OPENED_MESSAGE);
      return { action: "deny" };
    }
    if (!isAllowedUrl(url)) {
      handleBlockedUrl(url, tabId);
      return { action: "deny" };
    }
    return {
      action: "allow",
      overrideBrowserWindowOptions: {
        width: 900,
        height: 700,
        webPreferences: {
          session: session.defaultSession,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webSecurity: true,
        },
      },
    };
  });

  wc.on("did-create-window", (popup) => {
    attachNavigationGuards(popup.webContents, null);
  });

  wc.on("did-start-loading", () => sendIfActive("loading-changed", true));
  wc.on("did-stop-loading", () => sendIfActive("loading-changed", false));
  wc.on("did-navigate", (_event, url) => {
    debugLog("did-navigate", { tabId, url });
    if (tabId !== null) {
      const tab = tabs.find((t) => t.id === tabId);
      if (tab) tab.url = url;
      persistAndBroadcastTabs();
    }
    sendIfActive("url-changed", url);
  });
  wc.on("did-navigate-in-page", (_event, url) => {
    debugLog("did-navigate-in-page", { tabId, url });
    if (tabId !== null) {
      const tab = tabs.find((t) => t.id === tabId);
      if (tab) tab.url = url;
      persistAndBroadcastTabs();
    }
    sendIfActive("url-changed", url);
  });
  wc.on("page-title-updated", () => {
    if (tabId !== null) persistAndBroadcastTabs();
  });

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
  const view = new BrowserView({
    webPreferences: {
      session: session.defaultSession,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  return view;
}

function setActiveTab(id: number): void {
  if (!mainWindow) return;
  const tab = tabs.find((t) => t.id === id);
  if (!tab) return;
  activeTabId = id;
  mainWindow.setBrowserView(tab.view);
  layoutBrowserView();
  sendToChrome("url-changed", tab.view.webContents.getURL() || tab.url);
  sendToChrome("loading-changed", tab.view.webContents.isLoading());
  persistAndBroadcastTabs();
}

function createTab(url: string = BT_HUB_DEFAULT, activate = true): number {
  const id = nextTabId++;
  const view = createBrowserView();
  const loadUrl = isAllowedUrl(url) ? url : BT_HUB_DEFAULT;
  attachNavigationGuards(view.webContents, id);
  tabs.push({ id, view, url: loadUrl });
  void view.webContents.loadURL(loadUrl);
  if (activate) {
    setActiveTab(id);
  } else {
    persistAndBroadcastTabs();
  }
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
    persistAndBroadcastTabs();
  }
}

function activeTab(): TabState | undefined {
  if (activeTabId === null) return undefined;
  return tabs.find((t) => t.id === activeTabId);
}

function tabById(tabId: number | null | undefined): TabState | undefined {
  if (tabId === null || tabId === undefined) return activeTab();
  return tabs.find((t) => t.id === tabId);
}

async function navigateTo(
  rawInput: string,
  tabId = activeTabId
): Promise<{ ok: true; url: string } | { ok: false; reason: string }> {
  const tab = tabById(tabId);
  const wc = tab?.view.webContents;
  if (!wc) {
    return { ok: false, reason: "Browser is not ready yet." };
  }

  const url = normalizeUserInput(rawInput);
  debugLog("navigateTo", { rawInput, url, allowed: isAllowedUrl(url) });
  if (!isAllowedUrl(url)) {
    if (tabId === activeTabId) sendToChrome("loading-changed", false);
    return { ok: false, reason: blockedReason(url) };
  }

  try {
    await wc.loadURL(url);
    if (tab) tab.url = wc.getURL() || url;
    persistAndBroadcastTabs();
    debugLog("navigateTo success", wc.getURL());
    return { ok: true, url: wc.getURL() || url };
  } catch (error) {
    if (tabId === activeTabId) sendToChrome("loading-changed", false);
    const message =
      error instanceof Error ? error.message : "Could not open that address.";
    debugLog("navigateTo failed", message);
    return { ok: false, reason: message };
  }
}

function restoreTabsFromDisk(): { urls: string[]; activeIndex: number } {
  try {
    const state = JSON.parse(fs.readFileSync(tabsStatePath(), "utf8")) as {
      tabs?: unknown;
      activeIndex?: number;
    };
    const urls = Array.isArray(state.tabs)
      ? state.tabs.filter(
          (u): u is string => typeof u === "string" && isAllowedUrl(u)
        )
      : [];
    const activeIndex =
      typeof state.activeIndex === "number" ? state.activeIndex : 0;
    return { urls, activeIndex };
  } catch {
    return { urls: [], activeIndex: 0 };
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

  const { urls: restored, activeIndex: savedActive } = restoreTabsFromDisk();
  const startUrls = restored.length ? restored : [BT_HUB_DEFAULT];
  startUrls.forEach((url, index) => createTab(url, index === 0));
  const ids = tabs.map((t) => t.id);
  if (ids[savedActive] !== undefined) {
    setActiveTab(ids[savedActive]);
  }

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

  mainWindow.on("closed", () => {
    mainWindow = null;
    for (const tab of tabs) tab.view.webContents.close();
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

  ipcMain.handle("tabs-new", (event) => {
    if (!isChromeIpc(event)) return null;
    return createTab();
  });
  ipcMain.handle("tabs-close", (event, tabId: number) => {
    if (isChromeIpc(event)) closeTab(tabId);
  });
  ipcMain.handle("tabs-activate", (event, tabId: number) => {
    if (isChromeIpc(event)) setActiveTab(tabId);
  });

  ipcMain.handle("navigate", async (event, input: string, tabId?: number) => {
    if (!isChromeIpc(event)) {
      return { ok: false as const, reason: "Invalid caller." };
    }
    const targetId =
      tabId !== undefined && tabs.some((t) => t.id === tabId)
        ? tabId
        : activeTabId;
    debugLog("ipc navigate", { input, tabId: targetId });
    const result = await navigateTo(input, targetId);
    debugLog("ipc navigate result", result);
    if (!result.ok) {
      sendToChrome("navigation-blocked", result.reason);
    }
    return result;
  });
  ipcMain.handle("go-back", (event, tabId?: number) => {
    if (!isChromeIpc(event)) return;
    tabById(tabId)?.view.webContents.goBack();
  });
  ipcMain.handle("go-forward", (event, tabId?: number) => {
    if (!isChromeIpc(event)) return;
    tabById(tabId)?.view.webContents.goForward();
  });
  ipcMain.handle("reload", (event, tabId?: number) => {
    if (!isChromeIpc(event)) return;
    const wc = tabById(tabId)?.view.webContents;
    wc?.stop();
    wc?.reload();
  });
  ipcMain.handle("go-home", async (event, tabId?: number) => {
    if (!isChromeIpc(event)) {
      return { ok: false as const, reason: "Invalid caller." };
    }
    return navigateTo("", tabId);
  });
  ipcMain.handle("get-current-url", (event, tabId?: number) => {
    if (!isChromeIpc(event)) return BT_HUB_DEFAULT;
    return tabById(tabId)?.view.webContents.getURL() ?? BT_HUB_DEFAULT;
  });

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
        const out =
          process.env.ALLEYWEB_SCREENSHOT_PATH ??
          "/opt/cursor/artifacts/tab-bar.png";
        const { mkdirSync } = await import("fs");
        const { dirname } = await import("path");
        mkdirSync(dirname(out), { recursive: true });
        fs.writeFileSync(out, image.toPNG());
        debugLog("screenshot saved", out);
        app.exit(0);
      } catch (error) {
        debugLog("screenshot failed", error);
        app.exit(1);
      }
    }, 2000);
  }

  if (process.env.ALLEYWEB_E2E === "screenshot-local") {
    setTimeout(async () => {
      try {
        const tab = activeTab();
        if (!mainWindow || !tab) throw new Error("main window missing");
        const htmlPath = path.join(app.getPath("temp"), "alleyweb-local-demo.html");
        fs.writeFileSync(
          htmlPath,
          `<!DOCTYPE html><html><head><title>Local demo</title></head><body style="font-family:sans-serif;background:#1a2a1a;color:#cfc;padding:24px"><h1>Local HTML file</h1><p>Opened via file:// in Alleyweb.</p></body></html>`
        );
        const fileUrl = pathToFileURL(htmlPath).href;
        const nav = await navigateTo(fileUrl);
        if (!nav.ok) throw new Error(nav.reason);
        await new Promise((resolve) => setTimeout(resolve, 800));
        const image = await mainWindow.webContents.capturePage();
        const out =
          process.env.ALLEYWEB_SCREENSHOT_PATH ??
          "/opt/cursor/artifacts/local-html-tab.png";
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, image.toPNG());
        debugLog("screenshot-local saved", out);
        app.exit(0);
      } catch (error) {
        debugLog("screenshot-local failed", error);
        app.exit(1);
      }
    }, 1500);
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});