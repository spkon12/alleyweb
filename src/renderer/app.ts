interface AlleywebApi {
  navigate: (url: string) => Promise<{ ok: true; url: string } | { ok: false; reason: string }>;
  goBack: () => Promise<void>;
  goForward: () => Promise<void>;
  reload: () => Promise<void>;
  goHome: () => Promise<{ ok: true; url: string } | { ok: false; reason: string }>;
  getCurrentUrl: () => Promise<string>;
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

let toastTimer: ReturnType<typeof setTimeout> | undefined;
let userEditedAddress = false;
let navigating = false;

function debugLog(message: string, data?: unknown): void {
  if (data === undefined) {
    console.log(`[alleyweb-ui] ${message}`);
    return;
  }
  console.log(`[alleyweb-ui] ${message}`, JSON.stringify(data));
}

function showToast(message: string): void {
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 4500);
}

async function submitUrl(): Promise<void> {
  const typed = input.value.trim();
  if (!typed) return;

  navigating = true;
  debugLog("submit", typed);
  const result = await window.alleyweb.navigate(typed);
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
  void window.alleyweb.goBack();
});

document.getElementById("btn-forward")?.addEventListener("click", () => {
  userEditedAddress = false;
  void window.alleyweb.goForward();
});

document.getElementById("btn-reload")?.addEventListener("click", () => {
  void window.alleyweb.reload();
});

document.getElementById("btn-home")?.addEventListener("click", () => {
  userEditedAddress = false;
  void window.alleyweb.goHome();
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
