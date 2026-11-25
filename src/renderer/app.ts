interface TabInfo {
  id: number;
  title: string;
  active: boolean;
}

interface AlleywebApi {
  navigate: (
    url: string,
    tabId?: number
  ) => Promise<{ ok: true; url: string } | { ok: false; reason: string }>;
  goBack: (tabId?: number) => Promise<void>;
  goForward: (tabId?: number) => Promise<void>;
  reload: (tabId?: number) => Promise<void>;
  goHome: (
    tabId?: number
  ) => Promise<{ ok: true; url: string } | { ok: false; reason: string }>;
  getCurrentUrl: (tabId?: number) => Promise<string>;
  setTopChromeHeight: (height: number) => Promise<void>;
  newTab: () => Promise<number>;
  closeTab: (tabId: number) => Promise<void>;
  activateTab: (tabId: number) => Promise<void>;
  onTabsUpdated: (callback: (tabs: TabInfo[]) => void) => () => void;
  onUrlChanged: (callback: (url: string) => void) => () => void;
  onBlocked: (callback: (reason: string) => void) => () => void;
  onNavigationFailed: (callback: (reason: string) => void) => () => void;
  onLoading: (callback: (loading: boolean) => void) => () => void;
}

export {};

declare global {
  interface Window {
    alleyweb: AlleywebApi;
  }
}

const form = document.getElementById("url-form") as HTMLFormElement;
const input = document.getElementById("url-input") as HTMLInputElement;
const toast = document.getElementById("toast") as HTMLDivElement;
const loading = document.getElementById("loading") as HTMLDivElement;
const tabList = document.getElementById("tab-list") as HTMLDivElement;
const topChrome = document.getElementById("top-chrome") as HTMLDivElement;

let toastTimer: ReturnType<typeof setTimeout> | undefined;
let userEditedAddress = false;
let navigating = false;
let tabs: TabInfo[] = [];
let activeTabId = 0;

function debugLog(message: string, data?: unknown): void {
  if (data === undefined) {
    console.log(`[alleyweb-ui] ${message}`);
    return;
  }
  console.log(`[alleyweb-ui] ${message}`, JSON.stringify(data));
}

function reportTopChromeHeight(): void {
  const height = Math.ceil(topChrome.getBoundingClientRect().height);
  void window.alleyweb.setTopChromeHeight(height);
}

function showToast(message: string): void {
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 4500);
}

function renderTabs(): void {
  const active = tabs.find((tab) => tab.active);
  if (active) activeTabId = active.id;
  tabList.replaceChildren();
  for (const tab of tabs) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tab";
    button.role = "tab";
    button.setAttribute("aria-selected", tab.active ? "true" : "false");
    button.dataset.tabId = String(tab.id);
    button.title = tab.title;

    const title = document.createElement("span");
    title.className = "tab-title";
    title.textContent = tab.title;

    const close = document.createElement("button");
    close.type = "button";
    close.className = "tab-close";
    close.setAttribute("aria-label", `Close ${tab.title}`);
    close.textContent = "×";
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      void window.alleyweb.closeTab(tab.id);
    });

    button.append(title, close);
    button.addEventListener("click", () => {
      void window.alleyweb.activateTab(tab.id);
    });
    tabList.append(button);
  }
  reportTopChromeHeight();
}

async function submitUrl(): Promise<void> {
  const typed = input.value.trim();
  if (!typed) return;

  navigating = true;
  debugLog("submit", typed);
  const result = await window.alleyweb.navigate(typed, activeTabId || undefined);
  navigating = false;
  debugLog("submit result", result);

  if (!result.ok) {
    input.value = typed;
    userEditedAddress = true;
    showToast(result.reason);
    return;
  }

  userEditedAddress = false;
  input.value = result.url;
}

input.addEventListener("input", () => {
  userEditedAddress = true;
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void submitUrl();
});

document.getElementById("btn-back")?.addEventListener("click", () => {
  userEditedAddress = false;
  void window.alleyweb.goBack(activeTabId || undefined);
});

document.getElementById("btn-forward")?.addEventListener("click", () => {
  userEditedAddress = false;
  void window.alleyweb.goForward(activeTabId || undefined);
});

document.getElementById("btn-reload")?.addEventListener("click", () => {
  void window.alleyweb.reload(activeTabId || undefined);
});

document.getElementById("btn-home")?.addEventListener("click", () => {
  userEditedAddress = false;
  void window.alleyweb.goHome(activeTabId || undefined);
});

document.getElementById("btn-new-tab")?.addEventListener("click", () => {
  void window.alleyweb.newTab();
});

document.addEventListener("keydown", (event) => {
  const mod = event.ctrlKey || event.metaKey;
  if (!mod || event.altKey) return;
  if (event.key === "l" || event.key === "L") {
    event.preventDefault();
    input.focus();
    input.select();
    return;
  }
  if (event.key === "t" || event.key === "T") {
    event.preventDefault();
    void window.alleyweb.newTab();
    return;
  }
  if (event.key === "w" || event.key === "W") {
    const active = tabs.find((t) => t.active);
    if (active) {
      event.preventDefault();
      void window.alleyweb.closeTab(active.id);
    }
    return;
  }
  if (event.key === "Tab") {
    event.preventDefault();
    if (tabs.length < 2) return;
    const idx = tabs.findIndex((t) => t.active);
    const next = event.shiftKey
      ? tabs[(idx - 1 + tabs.length) % tabs.length]
      : tabs[(idx + 1) % tabs.length];
    void window.alleyweb.activateTab(next.id);
  }
});

window.alleyweb.onTabsUpdated((next) => {
  tabs = next;
  renderTabs();
});

window.alleyweb.onUrlChanged((url) => {
  debugLog("url-changed", { url, userEditedAddress, navigating });
  if (!url || userEditedAddress || navigating) return;
  input.value = url;
});

window.alleyweb.onBlocked((reason) => {
  showToast(reason);
});

window.alleyweb.onNavigationFailed((reason) => {
  showToast(reason);
});

window.alleyweb.onLoading((isLoading) => {
  loading.hidden = !isLoading;
});

void window.alleyweb.getCurrentUrl().then((url) => {
  if (!userEditedAddress && url) {
    input.value = url;
  }
});

const chromeObserver = new ResizeObserver(() => reportTopChromeHeight());
chromeObserver.observe(topChrome);
reportTopChromeHeight();