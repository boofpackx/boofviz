import { BrowserWindow, MessageChannelMain, screen, type Rectangle } from 'electron';
import { join } from 'node:path';
import { IPC, type DisplayInfo, type OutputCommand, type OutputStatus } from '@shared/ipc';
import type { SettingsStore } from './settingsStore';

const preloadPath = join(__dirname, '../preload/index.cjs');

function loadPage(win: BrowserWindow, page: 'control' | 'output'): void {
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) void win.loadURL(`${devUrl}/${page}.html`);
  else void win.loadFile(join(__dirname, `../renderer/${page}.html`));
}

export function listDisplays(): DisplayInfo[] {
  const primary = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d, i) => ({
    id: d.id,
    label: d.label || `Display ${i + 1}`,
    width: Math.round(d.size.width * d.scaleFactor),
    height: Math.round(d.size.height * d.scaleFactor),
    scaleFactor: d.scaleFactor,
    refreshRate: d.displayFrequency,
    primary: d.id === primary,
  }));
}

export class WindowManager {
  control: BrowserWindow | null = null;
  output: BrowserWindow | null = null;
  private outputStats = { fps: 0, width: 0, height: 0 };
  private boundsTimer: NodeJS.Timeout | null = null;
  private readonly ready = { control: false, output: false };
  /** Latest scene/globals for the output, replayed whenever the output (re)loads. */
  private outputState: OutputCommand = {};
  /** Latest value per broadcast channel, replayed to a window when it (re)loads. */
  private readonly replay = new Map<string, unknown>();

  constructor(private readonly store: SettingsStore) {}

  createControl(): BrowserWindow {
    const win = new BrowserWindow({
      width: 1480,
      height: 920,
      minWidth: 1100,
      minHeight: 700,
      backgroundColor: '#0a0a0c',
      title: 'BOOFVIZ',
      show: false,
      autoHideMenuBar: true,
      webPreferences: {
        preload: preloadPath,
        additionalArguments: ['--boofviz-role=control'],
        sandbox: true,
        contextIsolation: true,
        backgroundThrottling: false,
      },
    });
    win.once('ready-to-show', () => win.show());
    this.trackReady(win, 'control');
    win.on('closed', () => {
      this.control = null;
      this.output?.close();
    });
    loadPage(win, 'control');
    this.control = win;
    return win;
  }

  openOutput(displayId?: number): void {
    const settings = this.store.get().output;
    const targetId = displayId ?? settings.displayId;
    if (this.output) {
      if (displayId !== undefined) this.moveOutputTo(displayId);
      this.output.focus();
      return;
    }
    const displays = screen.getAllDisplays();
    const display = displays.find((d) => d.id === targetId) ?? displays.find((d) => d.id !== screen.getPrimaryDisplay().id) ?? screen.getPrimaryDisplay();
    const remembered = settings.bounds && display.id === settings.displayId ? settings.bounds : undefined;
    const bounds: Rectangle = remembered ?? centeredBounds(display.workArea, 0.6);

    const win = new BrowserWindow({
      ...bounds,
      frame: false,
      backgroundColor: '#000000',
      title: 'BOOFVIZ Output',
      show: false,
      hasShadow: false,
      autoHideMenuBar: true,
      webPreferences: {
        preload: preloadPath,
        additionalArguments: ['--boofviz-role=output'],
        sandbox: true,
        contextIsolation: true,
        backgroundThrottling: false,
      },
    });
    win.setMenu(null);
    win.once('ready-to-show', () => {
      win.show();
      // Only go fullscreen automatically on a non-primary display (projector / second screen).
      if (settings.fullscreen && display.id !== screen.getPrimaryDisplay().id) win.setFullScreen(true);
      this.control?.focus();
    });
    this.trackReady(win, 'output');
    win.on('enter-full-screen', () => this.persistOutput(true));
    win.on('leave-full-screen', () => this.persistOutput(false));
    win.on('moved', () => this.debouncePersistBounds());
    win.on('resized', () => this.debouncePersistBounds());
    win.on('closed', () => {
      this.output = null;
      this.ready.output = false;
      this.outputStats = { fps: 0, width: 0, height: 0 };
      this.sendStatus();
    });
    loadPage(win, 'output');
    this.output = win;
    this.store.update({ output: { displayId: display.id } });
    this.sendStatus();
  }

  closeOutput(): void {
    this.output?.close();
  }

  toggleOutputFullscreen(): void {
    if (!this.output) return;
    this.output.setFullScreen(!this.output.isFullScreen());
  }

  private moveOutputTo(displayId: number): void {
    const win = this.output;
    const display = screen.getAllDisplays().find((d) => d.id === displayId);
    if (!win || !display) return;
    const wasFull = win.isFullScreen();
    const apply = (): void => {
      win.setBounds(centeredBounds(display.workArea, 0.6));
      if (wasFull) win.setFullScreen(true);
      this.store.update({ output: { displayId } });
      this.sendStatus();
    };
    if (wasFull) {
      win.once('leave-full-screen', apply);
      win.setFullScreen(false);
    } else apply();
  }

  /** (Re)connect analysis whenever either page finishes loading (first load, reload, HMR). */
  private trackReady(win: BrowserWindow, role: 'control' | 'output'): void {
    win.webContents.on('did-start-loading', () => (this.ready[role] = false));
    win.webContents.on('did-finish-load', () => {
      this.ready[role] = true;
      if (role === 'output' && (this.outputState.scene || this.outputState.globals)) win.webContents.send(IPC.outputCommand, this.outputState);
      for (const [channel, value] of this.replay) win.webContents.send(channel, value);
      this.connectAnalysis();
    });
  }

  /** Send to both windows; `replay` (default: the value) is what a window gets when it (re)loads. */
  broadcast(channel: string, value: unknown, replay: unknown = value): void {
    this.replay.set(channel, replay);
    if (this.control && this.ready.control) this.control.webContents.send(channel, value);
    if (this.output && this.ready.output) this.output.webContents.send(channel, value);
  }

  sendOutputCommand(cmd: OutputCommand): void {
    this.outputState = { ...this.outputState, ...cmd };
    if (cmd.scene && cmd.applyAtBeat === undefined) delete this.outputState.applyAtBeat;
    if (this.output && this.ready.output) this.output.webContents.send(IPC.outputCommand, cmd);
  }

  /** Create a direct renderer↔renderer channel for analysis packets (control → output). */
  connectAnalysis(): void {
    if (!this.control || !this.output || !this.ready.control || !this.ready.output) return;
    const { port1, port2 } = new MessageChannelMain();
    this.control.webContents.postMessage(IPC.analysisPort, { consumer: 'output' }, [port1]);
    this.output.webContents.postMessage(IPC.analysisPort, { consumer: 'output' }, [port2]);
  }

  setOutputStats(stats: { fps: number; width: number; height: number }): void {
    this.outputStats = stats;
    this.sendStatus();
  }

  status(): OutputStatus {
    const win = this.output;
    if (!win) return { open: false, fullscreen: false, fps: 0, width: 0, height: 0 };
    const display = screen.getDisplayMatching(win.getBounds());
    return { open: true, displayId: display.id, fullscreen: win.isFullScreen(), ...this.outputStats };
  }

  sendStatus(): void {
    this.control?.webContents.send(IPC.outputStatus, this.status());
  }

  private persistOutput(fullscreen: boolean): void {
    this.store.update({ output: { fullscreen } });
    this.sendStatus();
  }

  private debouncePersistBounds(): void {
    if (this.boundsTimer) clearTimeout(this.boundsTimer);
    this.boundsTimer = setTimeout(() => {
      const win = this.output;
      if (!win || win.isFullScreen()) return;
      const bounds = win.getBounds();
      const display = screen.getDisplayMatching(bounds);
      this.store.update({ output: { bounds, displayId: display.id } });
      this.sendStatus();
    }, 400);
  }
}

function centeredBounds(area: Rectangle, frac: number): Rectangle {
  const width = Math.round(area.width * frac);
  const height = Math.round((width * 9) / 16);
  return { x: Math.round(area.x + (area.width - width) / 2), y: Math.round(area.y + (area.height - height) / 2), width, height };
}
