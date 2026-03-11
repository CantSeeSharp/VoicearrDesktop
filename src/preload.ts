import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  getVersion: (): Promise<string> => ipcRenderer.invoke('get-version'),

  // Global PTT — main process fires 'ptt-state' events from uiohook-napi
  onPttState: (cb: (active: boolean) => void): void => {
    ipcRenderer.on('ptt-state', (_e, active: boolean) => cb(active));
  },
  setPttKey: (code: string): Promise<void> => ipcRenderer.invoke('set-ptt-key', code),
  setPttEnabled: (enabled: boolean): Promise<void> => ipcRenderer.invoke('set-ptt-enabled', enabled),

  // Taskbar badge (Windows overlay / macOS dock)
  setBadgeCount: (count: number): Promise<void> => ipcRenderer.invoke('set-badge-count', count),

  // OS notifications
  showNotification: (opts: { title: string; body: string; route?: string }): Promise<void> =>
    ipcRenderer.invoke('show-notification', opts),
  onNavigate: (cb: (route: string) => void): void => {
    ipcRenderer.on('navigate', (_e, route: string) => cb(route));
  },

  // Auto-update — main process fires 'update-ready' when a download completes
  onUpdateReady: (cb: () => void): void => {
    ipcRenderer.on('update-ready', () => cb());
  },
  installUpdate: (): Promise<void> => ipcRenderer.invoke('install-update'),

  // Open a URL in the system default browser
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('open-external', url),
});
