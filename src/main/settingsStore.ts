import { app } from 'electron';
import { promises as fs, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_SETTINGS, mergeSettings, type Settings, type SettingsPatch } from '@shared/settings';

/** %APPDATA%/BOOFVIZ on Windows, ~/Library/Application Support/BOOFVIZ on macOS. */
export function dataDir(): string {
  return join(app.getPath('appData'), 'BOOFVIZ');
}

export class SettingsStore {
  private settings: Settings;
  private readonly file: string;
  private saveTimer: NodeJS.Timeout | null = null;
  private listeners = new Set<(s: Settings) => void>();

  constructor() {
    const dir = dataDir();
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, 'settings.json');
    this.settings = this.load();
  }

  private load(): Settings {
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8'));
      return mergeSettings(DEFAULT_SETTINGS, raw);
    } catch {
      return structuredClone(DEFAULT_SETTINGS);
    }
  }

  get(): Settings {
    return this.settings;
  }

  update(patch: SettingsPatch): Settings {
    this.settings = mergeSettings(this.settings, patch);
    this.scheduleSave();
    for (const l of this.listeners) l(this.settings);
    return this.settings;
  }

  onChange(cb: (s: Settings) => void): void {
    this.listeners.add(cb);
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.flush(), 300);
  }

  async flush(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    const tmp = `${this.file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.settings, null, 2), 'utf8');
    await fs.rename(tmp, this.file);
  }
}
