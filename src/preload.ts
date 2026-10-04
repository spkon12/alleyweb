import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("alleyweb", {
  navigate: (url: string) => ipcRenderer.invoke("navigate", url),
  goBack: () => ipcRenderer.invoke("go-back"),
  goForward: () => ipcRenderer.invoke("go-forward"),
  reload: () => ipcRenderer.invoke("reload"),
  goHome: () => ipcRenderer.invoke("go-home"),
  getCurrentUrl: () => ipcRenderer.invoke("get-current-url"),
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
