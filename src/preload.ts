import { contextBridge, ipcRenderer } from "electron";

export interface TabInfo {
  id: number;
  title: string;
  active: boolean;
}

contextBridge.exposeInMainWorld("alleyweb", {
  navigate: (url: string) => ipcRenderer.invoke("navigate", url),
  goBack: () => ipcRenderer.invoke("go-back"),
  goForward: () => ipcRenderer.invoke("go-forward"),
  reload: () => ipcRenderer.invoke("reload"),
  goHome: () => ipcRenderer.invoke("go-home"),
  getCurrentUrl: () => ipcRenderer.invoke("get-current-url"),
  setTopChromeHeight: (height: number) =>
    ipcRenderer.invoke("set-top-chrome-height", height),
  newTab: () => ipcRenderer.invoke("tabs-new") as Promise<number>,
  closeTab: (tabId: number) => ipcRenderer.invoke("tabs-close", tabId),
  activateTab: (tabId: number) => ipcRenderer.invoke("tabs-activate", tabId),
  onTabsUpdated: (callback: (tabs: TabInfo[]) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, tabs: TabInfo[]) =>
      callback(tabs);
    ipcRenderer.on("tabs-updated", listener);
    return () => ipcRenderer.removeListener("tabs-updated", listener);
  },
  onUrlChanged: (callback: (url: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, url: string) =>
      callback(url);
    ipcRenderer.on("url-changed", listener);
    return () => ipcRenderer.removeListener("url-changed", listener);
  },
  onBlocked: (callback: (reason: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, reason: string) =>
      callback(reason);
    ipcRenderer.on("navigation-blocked", listener);
    return () => ipcRenderer.removeListener("navigation-blocked", listener);
  },
  onNavigationFailed: (callback: (reason: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, reason: string) =>
      callback(reason);
    ipcRenderer.on("navigation-failed", listener);
    return () => ipcRenderer.removeListener("navigation-failed", listener);
  },
  onLoading: (callback: (loading: boolean) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, loading: boolean) =>
      callback(loading);
    ipcRenderer.on("loading-changed", listener);
    return () => ipcRenderer.removeListener("loading-changed", listener);
  },
});