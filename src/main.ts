import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, Notification } from 'electron';
import * as path from 'path';
import { autoUpdater } from 'electron-updater';
import { APP_NAME, GITHUB_OWNER, GITHUB_REPO, STAGING_URL, PRODUCTION_URL, DEV_URL } from './app.config';
import { loadWindowState, saveWindowState } from './window-state';
import { uIOhook, UiohookKey } from 'uiohook-napi';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let updateReady = false;
let resolvedServerUrl = DEV_URL;

// ── PTT state ─────────────────────────────────────────────────────────────────
let pttEnabled = false;
let pttKeyCode: number | null = null;

// Mapping from KeyboardEvent.code (web) to uiohook-napi key codes
const webCodeToUiohook: Record<string, number> = {
  Space: UiohookKey.Space,
  Enter: UiohookKey.Enter,
  Tab: UiohookKey.Tab,
  Backspace: UiohookKey.Backspace,
  Escape: UiohookKey.Escape,
  CapsLock: UiohookKey.CapsLock,
  ShiftLeft: UiohookKey.Shift,
  ShiftRight: UiohookKey.ShiftRight,
  ControlLeft: UiohookKey.Ctrl,
  ControlRight: UiohookKey.CtrlRight,
  AltLeft: UiohookKey.Alt,
  AltRight: UiohookKey.AltRight,
  MetaLeft: UiohookKey.Meta,
  MetaRight: UiohookKey.MetaRight,
  KeyA: UiohookKey.A, KeyB: UiohookKey.B, KeyC: UiohookKey.C, KeyD: UiohookKey.D,
  KeyE: UiohookKey.E, KeyF: UiohookKey.F, KeyG: UiohookKey.G, KeyH: UiohookKey.H,
  KeyI: UiohookKey.I, KeyJ: UiohookKey.J, KeyK: UiohookKey.K, KeyL: UiohookKey.L,
  KeyM: UiohookKey.M, KeyN: UiohookKey.N, KeyO: UiohookKey.O, KeyP: UiohookKey.P,
  KeyQ: UiohookKey.Q, KeyR: UiohookKey.R, KeyS: UiohookKey.S, KeyT: UiohookKey.T,
  KeyU: UiohookKey.U, KeyV: UiohookKey.V, KeyW: UiohookKey.W, KeyX: UiohookKey.X,
  KeyY: UiohookKey.Y, KeyZ: UiohookKey.Z,
  Digit1: 2, Digit2: 3, Digit3: 4, Digit4: 5, Digit5: 6,
  Digit6: 7, Digit7: 8, Digit8: 9, Digit9: 10, Digit0: 11,
  F1: UiohookKey.F1,  F2: UiohookKey.F2,  F3: UiohookKey.F3,  F4: UiohookKey.F4,
  F5: UiohookKey.F5,  F6: UiohookKey.F6,  F7: UiohookKey.F7,  F8: UiohookKey.F8,
  F9: UiohookKey.F9,  F10: UiohookKey.F10, F11: UiohookKey.F11, F12: UiohookKey.F12,
};

// ── Icon helpers ───────────────────────────────────────────────────────────────
function getResourcesPath(): string {
  return app.isPackaged
    ? process.resourcesPath
    : path.join(__dirname, '..');
}

function getIconPath(): string {
  return path.join(getResourcesPath(), 'resources', 'icon.png');
}

function getBadgePath(): string {
  return path.join(getResourcesPath(), 'resources', 'badge.png');
}

let badgeIcon: Electron.NativeImage | null = null;

function loadBadgeIcon(): Electron.NativeImage | null {
  if (badgeIcon) return badgeIcon;
  try {
    const img = nativeImage.createFromPath(getBadgePath());
    badgeIcon = img.isEmpty() ? null : img;
  } catch {
    badgeIcon = null;
  }
  return badgeIcon;
}

// ── Release detection ──────────────────────────────────────────────────────────
interface AppConfig {
  serverUrl: string;
  isPreRelease: boolean;
}

// Checks the GitHub release for the running version to determine if it is a
// pre-release, then picks the appropriate server URL. Falls back to inspecting
// the semver string (presence of '-') when the network is unavailable.
async function resolveConfig(): Promise<AppConfig> {
  if (!app.isPackaged) {
    return { serverUrl: DEV_URL, isPreRelease: false };
  }

  try {
    const version = app.getVersion();
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/tags/${version}`,
      { headers: { 'User-Agent': 'Voicearr-Desktop' } },
    );
    if (response.ok) {
      const data = await response.json() as { prerelease: boolean };
      return {
        serverUrl: data.prerelease ? STAGING_URL : PRODUCTION_URL,
        isPreRelease: data.prerelease,
      };
    }
  } catch {
    // Network unavailable or release not found — fall back to version string
  }

  // Fallback: semver pre-release segment (e.g. 1.0.0-beta.1)
  const isPreRelease = app.getVersion().includes('-');
  return {
    serverUrl: isPreRelease ? STAGING_URL : PRODUCTION_URL,
    isPreRelease,
  };
}

// ── Auto-updater ───────────────────────────────────────────────────────────────
function setupAutoUpdater(isPreRelease: boolean): void {
  if (!app.isPackaged) return;

  // Pre-release builds also track pre-release updates; stable builds only see stable.
  autoUpdater.allowPrerelease = isPreRelease;
  autoUpdater.autoDownload = true;

  autoUpdater.on('update-downloaded', () => {
    updateReady = true;
    if (tray) tray.setContextMenu(buildTrayMenu());
    mainWindow?.webContents.send('update-ready');
  });

  autoUpdater.on('error', (err: Error) => {
    console.error('Auto-updater error:', err.message);
  });

  // Check on startup then every 4 hours
  autoUpdater.checkForUpdates().catch((err: Error) => console.warn('Update check failed:', err.message));
  setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 4 * 60 * 60 * 1000);
}

// ── Window ─────────────────────────────────────────────────────────────────────
function createWindow(serverUrl: string): void {
  const state = loadWindowState();

  mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 800,
    minHeight: 600,
    title: APP_NAME,
    icon: getIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (state.isMaximized) mainWindow.maximize();

  mainWindow.loadURL(serverUrl);

  // Auto-grant all permissions for our own hosted app.
  // setPermissionCheckHandler is called synchronously by Chromium before the request handler,
  // using internal permission names like 'audio-capture'/'video-capture' in addition to
  // the standard 'media'/'microphone' names — so we allow everything from our own origin.
  mainWindow.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(true);
  });
  mainWindow.webContents.session.setPermissionCheckHandler(() => true);

  // Open external links in the default browser instead of a new Electron window
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(serverUrl)) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Persist window size/position on every change
  const onBoundsChanged = () => { if (mainWindow) saveWindowState(mainWindow); };
  mainWindow.on('resize', onBoundsChanged);
  mainWindow.on('move', onBoundsChanged);

  // Minimize to tray on close unless the app is actually quitting
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      if (mainWindow) {
        saveWindowState(mainWindow);
        mainWindow.hide();
      }
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── Tray ───────────────────────────────────────────────────────────────────────
function buildTrayMenu(): Electron.Menu {
  const isAutoLaunch = app.getLoginItemSettings().openAtLogin;
  const template: Electron.MenuItemConstructorOptions[] = [
    { label: `Open ${APP_NAME}`, click: showWindow },
    { type: 'separator' },
    {
      label: 'Launch at startup',
      type: 'checkbox',
      checked: isAutoLaunch,
      click: (item) => {
        app.setLoginItemSettings({ openAtLogin: item.checked });
      },
    },
    { type: 'separator' },
  ];

  if (updateReady) {
    template.push({ label: 'Restart & Install Update', click: () => autoUpdater.quitAndInstall() });
    template.push({ type: 'separator' });
  } else if (app.isPackaged) {
    template.push({
      label: 'Check for Updates',
      click: () => { autoUpdater.checkForUpdates().catch(() => {}); },
    });
    template.push({ type: 'separator' });
  }

  template.push({ label: 'Quit', click: () => app.quit() });
  return Menu.buildFromTemplate(template);
}

function createTray(): void {
  const iconPath = getIconPath();
  let icon: Electron.NativeImage;
  try {
    icon = nativeImage.createFromPath(iconPath);
  } catch {
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip(APP_NAME);
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', showWindow);
}

function showWindow(): void {
  if (!mainWindow) {
    createWindow(resolvedServerUrl);
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// ── IPC handlers ───────────────────────────────────────────────────────────────
function registerIpcHandlers(): void {
  ipcMain.handle('get-version', () => app.getVersion());

  // PTT key config from renderer
  ipcMain.handle('set-ptt-key', (_e, code: string) => {
    pttKeyCode = webCodeToUiohook[code] ?? null;
  });

  ipcMain.handle('set-ptt-enabled', (_e, enabled: boolean) => {
    pttEnabled = enabled;
  });

  // Taskbar badge (Windows overlay icon / macOS dock badge)
  ipcMain.handle('set-badge-count', (_e, count: number) => {
    if (!mainWindow) return;
    if (process.platform === 'darwin') {
      app.setBadgeCount(count);
    } else if (process.platform === 'win32') {
      if (count > 0) {
        const icon = loadBadgeIcon();
        if (icon) mainWindow.setOverlayIcon(icon, `${count} unread`);
      } else {
        mainWindow.setOverlayIcon(null, '');
      }
    }
  });

  // OS notifications — only shown when the window is not focused
  ipcMain.handle('show-notification', (_e, opts: { title: string; body: string; route?: string }) => {
    if (mainWindow?.isFocused()) return;
    if (!Notification.isSupported()) return;
    const notif = new Notification({
      title: opts.title,
      body: opts.body,
      icon: getIconPath(),
    });
    notif.on('click', () => {
      showWindow();
      if (opts.route) mainWindow?.webContents.send('navigate', opts.route);
    });
    notif.show();
  });

  // Triggered by renderer when user confirms the update prompt
  ipcMain.handle('install-update', () => {
    autoUpdater.quitAndInstall();
  });
}

// ── Single-instance lock ───────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
}

// ── App lifecycle ──────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const config = await resolveConfig();
  resolvedServerUrl = config.serverUrl;

  createWindow(config.serverUrl);
  createTray();
  registerIpcHandlers();
  setupAutoUpdater(config.isPreRelease);

  // Global key hooks for PTT (works even when app is not focused)
  try {
    uIOhook.on('keydown', (e) => {
      if (pttEnabled && pttKeyCode !== null && e.keycode === pttKeyCode) {
        mainWindow?.webContents.send('ptt-state', true);
      }
    });
    uIOhook.on('keyup', (e) => {
      if (pttEnabled && pttKeyCode !== null && e.keycode === pttKeyCode) {
        mainWindow?.webContents.send('ptt-state', false);
      }
    });
    uIOhook.start();
  } catch (err) {
    console.warn('uiohook-napi failed to start — global PTT unavailable:', err);
  }
}

app.on('ready', () => { main().catch(console.error); });

// Keep app alive in tray when all windows are closed
app.on('window-all-closed', () => {
  // intentionally empty — tray keeps the process alive
});

// Mark as actually quitting so the close handler doesn't intercept
app.on('before-quit', () => {
  isQuitting = true;
  try { uIOhook.stop(); } catch { /* ignore */ }
});
