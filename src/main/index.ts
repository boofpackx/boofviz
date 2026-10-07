import { app, ipcMain, BrowserWindow } from 'electron';
import { IPC, type OutputCommand } from '@shared/ipc';
import type { SpotifyCommand } from '@shared/lyrics';
import type { SettingsPatch } from '@shared/settings';
import type { ArchiveRequest } from '@shared/archive';
import { ArchiveService, registerArchiveScheme } from './archive';
import { installCaptureHandlers } from './audioCapture';
import { LinkService } from './link';
import { NowPlayingService } from './nowPlaying';
import { deleteUserPreset, exportPresetFile, flushSession, importPresetFiles, listUserPresets, openPresetFolder, readSession, saveUserPreset, writeSession } from './presetStore';
import { dataDir, SettingsStore } from './settingsStore';
import { listDisplays, WindowManager } from './windows';

app.setName('BOOFVIZ');
app.setPath('userData', dataDir());

// A VJ app must keep rendering and analysing when windows are unfocused or occluded.
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
// Let the GPU process pace frames rather than capping to the slowest window.
app.commandLine.appendSwitch('enable-gpu-rasterization');

if (!app.requestSingleInstanceLock()) app.quit();
registerArchiveScheme();

let store: SettingsStore;
let windows: WindowManager;
let link: LinkService;
let nowPlaying: NowPlayingService;
let archive: ArchiveService;

function registerIpc(): void {
  ipcMain.handle(IPC.getSettings, () => store.get());
  ipcMain.handle(IPC.updateSettings, (_e, patch: SettingsPatch) => store.update(patch));
  ipcMain.handle(IPC.listDisplays, () => listDisplays());
  ipcMain.handle(IPC.openOutput, (_e, displayId?: number) => windows.openOutput(displayId));
  ipcMain.handle(IPC.closeOutput, () => windows.closeOutput());
  ipcMain.handle(IPC.toggleOutputFullscreen, () => windows.toggleOutputFullscreen());
  ipcMain.on(IPC.outputStats, (_e, stats: { fps: number; width: number; height: number }) => windows.setOutputStats(stats));
  ipcMain.on(IPC.outputCommand, (_e, cmd: OutputCommand) => windows.sendOutputCommand(cmd));
  ipcMain.handle(IPC.listUserPresets, () => listUserPresets());
  ipcMain.handle(IPC.saveUserPreset, (_e, slug: string, json: string, template: boolean) => saveUserPreset(slug, json, template));
  ipcMain.handle(IPC.deleteUserPreset, (_e, slug: string, template: boolean) => deleteUserPreset(slug, template));
  ipcMain.handle(IPC.importPresets, () => importPresetFiles(windows.control));
  ipcMain.handle(IPC.exportPreset, (_e, slug: string, json: string) => exportPresetFile(windows.control, slug, json));
  ipcMain.handle(IPC.openPresetFolder, () => openPresetFolder());
  ipcMain.handle(IPC.readSession, () => readSession());
  ipcMain.on(IPC.writeSession, (_e, json: string) => writeSession(json));
  ipcMain.on(IPC.requestAnalysisPort, () => windows.connectAnalysis());
  ipcMain.handle(IPC.setLinkEnabled, (_e, on: boolean) => {
    link.setEnabled(on);
    return link.state();
  });
  ipcMain.handle(IPC.spotifyConnect, () => nowPlaying.connect());
  ipcMain.handle(IPC.spotifyDisconnect, () => nowPlaying.disconnect());
  ipcMain.handle(IPC.spotifyControl, (_e, cmd: SpotifyCommand) => nowPlaying.control(cmd));
  ipcMain.handle(IPC.getNowPlaying, () => nowPlaying.snapshot());
  ipcMain.handle(IPC.openLyricsFolder, () => nowPlaying.openLyricsFolder());
  ipcMain.handle(IPC.saveLyrics, (_e, text: string) => nowPlaying.saveLrc(String(text)));
  ipcMain.handle(IPC.archiveClip, (_e, req: ArchiveRequest) => archive.clip(req));

  store.onChange((s) => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send(IPC.settingsChanged, s);
  });
}

app.whenReady().then(() => {
  store = new SettingsStore();
  windows = new WindowManager(store);
  installCaptureHandlers();
  link = new LinkService((s) => windows.control?.webContents.send(IPC.linkState, s));
  nowPlaying = new NowPlayingService(store, (channel, value, replay) => windows.broadcast(channel, value, replay));
  archive = new ArchiveService();
  archive.start();
  registerIpc();
  windows.createControl();
  if (store.get().output.openOnLaunch) windows.openOutput();
  nowPlaying.start();

  app.on('second-instance', () => windows.control?.focus());
});

app.on('window-all-closed', () => {
  void Promise.allSettled([store?.flush(), flushSession()]).finally(() => app.quit());
});

app.on('before-quit', () => {
  link?.dispose();
  nowPlaying?.dispose();
  void store?.flush();
  void flushSession();
});
