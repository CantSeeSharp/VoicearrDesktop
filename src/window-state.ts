import { app, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  isMaximized?: boolean;
}

const STATE_FILE = path.join(app.getPath('userData'), 'window-state.json');

export function loadWindowState(): WindowState {
  try {
    const data = fs.readFileSync(STATE_FILE, 'utf-8');
    return JSON.parse(data) as WindowState;
  } catch {
    return { width: 1280, height: 800 };
  }
}

export function saveWindowState(win: BrowserWindow): void {
  try {
    const state: WindowState = {
      ...win.getBounds(),
      isMaximized: win.isMaximized(),
    };
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch {
    // non-fatal
  }
}
