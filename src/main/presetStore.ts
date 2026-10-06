import { app, dialog, shell, type BrowserWindow } from 'electron';
import { promises as fs } from 'node:fs';
import { basename, join } from 'node:path';
import { dataDir } from './settingsStore';

export interface StoredPreset {
  /** File name without extension (the slug). */
  file: string;
  template: boolean;
  json: string;
}

const dirs = () => ({ presets: join(dataDir(), 'presets'), templates: join(dataDir(), 'templates') });

async function ensure(): Promise<void> {
  const d = dirs();
  await fs.mkdir(d.presets, { recursive: true });
  await fs.mkdir(d.templates, { recursive: true });
}

/** Keep file names boring and safe: the renderer slugifies, main re-checks. */
function safeSlug(slug: string): string {
  const s = basename(slug).replace(/[^a-z0-9-]/gi, '').slice(0, 60);
  if (!s) throw new Error('Invalid preset name');
  return s;
}

async function readDir(dir: string, template: boolean): Promise<StoredPreset[]> {
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  const out: StoredPreset[] = [];
  for (const name of names.filter((n) => n.endsWith('.json'))) {
    try {
      out.push({ file: name.replace(/\.json$/, ''), template, json: await fs.readFile(join(dir, name), 'utf8') });
    } catch {
      /* unreadable file: skip */
    }
  }
  return out;
}

export async function listUserPresets(): Promise<StoredPreset[]> {
  await ensure();
  const d = dirs();
  return [...(await readDir(d.presets, false)), ...(await readDir(d.templates, true))];
}

export async function saveUserPreset(slug: string, json: string, template: boolean): Promise<void> {
  await ensure();
  const d = dirs();
  const file = join(template ? d.templates : d.presets, `${safeSlug(slug)}.json`);
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, json, 'utf8');
  await fs.rename(tmp, file);
}

export async function deleteUserPreset(slug: string, template: boolean): Promise<void> {
  const d = dirs();
  await fs.rm(join(template ? d.templates : d.presets, `${safeSlug(slug)}.json`), { force: true });
}

export async function importPresetFiles(win: BrowserWindow | null): Promise<string[]> {
  const opts = { title: 'Import presets', properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'>, filters: [{ name: 'BOOFVIZ preset', extensions: ['json'] }] };
  const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  if (res.canceled) return [];
  const out: string[] = [];
  for (const p of res.filePaths) {
    const stat = await fs.stat(p);
    if (stat.size > 2 * 1024 * 1024) continue; // presets are a few KB; refuse anything huge
    out.push(await fs.readFile(p, 'utf8'));
  }
  return out;
}

export async function exportPresetFile(win: BrowserWindow | null, suggested: string, json: string): Promise<boolean> {
  const opts = { title: 'Export preset', defaultPath: join(app.getPath('documents'), `${safeSlug(suggested)}.json`), filters: [{ name: 'BOOFVIZ preset', extensions: ['json'] }] };
  const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
  if (res.canceled || !res.filePath) return false;
  await fs.writeFile(res.filePath, json, 'utf8');
  return true;
}

export async function openPresetFolder(): Promise<void> {
  await ensure();
  await shell.openPath(dirs().presets);
}

// --- Session: the working look, restored on next launch -------------------

const sessionFile = () => join(dataDir(), 'session.json');

export async function readSession(): Promise<string | null> {
  return fs.readFile(sessionFile(), 'utf8').catch(() => null);
}

let sessionTimer: NodeJS.Timeout | null = null;
let pendingSession: string | null = null;

export function writeSession(json: string): void {
  pendingSession = json;
  if (sessionTimer) clearTimeout(sessionTimer);
  sessionTimer = setTimeout(() => void flushSession(), 800);
}

export async function flushSession(): Promise<void> {
  if (sessionTimer) clearTimeout(sessionTimer);
  sessionTimer = null;
  if (pendingSession === null) return;
  const json = pendingSession;
  pendingSession = null;
  const tmp = `${sessionFile()}.tmp`;
  await fs.writeFile(tmp, json, 'utf8');
  await fs.rename(tmp, sessionFile());
}
