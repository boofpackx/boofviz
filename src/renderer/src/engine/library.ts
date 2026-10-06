import type { Preset } from '@shared/types/engine';
import { normalizePreset, slugify } from './presetIO';

export type PresetSource = 'builtin' | 'user';

export interface PresetEntry {
  /** "builtin:neon-stage", "user:my-look". */
  id: string;
  source: PresetSource;
  preset: Preset;
}

const builtinFiles = import.meta.glob('../../../../presets/builtin/**/*.json', { eager: true, import: 'default' });
const templateFiles = import.meta.glob('../../../../presets/templates/*.json', { eager: true, import: 'default' });

function entries(files: Record<string, unknown>): PresetEntry[] {
  return Object.entries(files)
    .map(([path, json]) => {
      const preset = normalizePreset(json);
      const file = path.split('/').pop()!.replace(/\.json$/, '');
      return { id: `builtin:${file}`, source: 'builtin' as const, preset };
    })
    .sort((a, b) => a.preset.name.localeCompare(b.preset.name));
}

/** Presets that ship with the app (read-only; "Save" on one creates a user copy). */
export const BUILTIN_PRESETS: PresetEntry[] = entries(builtinFiles);
export const BUILTIN_TEMPLATES: PresetEntry[] = entries(templateFiles).map((e) => ({ ...e, id: e.id.replace('builtin:', 'builtin-template:') }));

export const DEFAULT_PRESET_ID = 'builtin:neon-stage';

export function userId(preset: Preset): string {
  return `${preset.isTemplate ? 'user-template' : 'user'}:${slugify(preset.name)}`;
}
