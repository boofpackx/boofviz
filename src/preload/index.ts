import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { IPC, PORT_MESSAGE_TAG, type BoofvizApi, type OutputCommand, type OutputStatus } from '@shared/ipc';
import type { Settings, SettingsPatch } from '@shared/settings';

const roleArg = process.argv.find((a) => a.startsWith('--boofviz-role='));
const role = (roleArg?.split('=')[1] ?? 'control') as BoofvizApi['role'];

function subscribe<T>(channel: string, cb: (v: T) => void): () => void {
  const handler = (_e: Electron.IpcRendererEvent, v: T): void => cb(v);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

// MessagePorts can't cross contextBridge directly; hand them to the page via window.postMessage.
ipcRenderer.on(IPC.analysisPort, (e, meta: { consumer: string }) => {
  window.postMessage({ tag: PORT_MESSAGE_TAG, consumer: meta.consumer }, '*', e.ports);
});

const api: BoofvizApi = {
  platform: process.platform,
  role,
  getSettings: () => ipcRenderer.invoke(IPC.getSettings) as Promise<Settings>,
  updateSettings: (patch: SettingsPatch) => ipcRenderer.invoke(IPC.updateSettings, patch) as Promise<Settings>,
  onSettings: (cb) => subscribe<Settings>(IPC.settingsChanged, cb),
  listDisplays: () => ipcRenderer.invoke(IPC.listDisplays),
  openOutput: (displayId) => ipcRenderer.invoke(IPC.openOutput, displayId),
  closeOutput: () => ipcRenderer.invoke(IPC.closeOutput),
  toggleOutputFullscreen: () => ipcRenderer.invoke(IPC.toggleOutputFullscreen),
  onOutputStatus: (cb) => subscribe<OutputStatus>(IPC.outputStatus, cb),
  reportOutputStats: (s) => ipcRenderer.send(IPC.outputStats, s),
  sendOutputCommand: (cmd) => ipcRenderer.send(IPC.outputCommand, cmd),
  onOutputCommand: (cb) => subscribe<OutputCommand>(IPC.outputCommand, cb),
  requestAnalysisPort: () => ipcRenderer.send(IPC.requestAnalysisPort),
  pathForFile: (file) => webUtils.getPathForFile(file),
};

contextBridge.exposeInMainWorld('boofviz', api);
