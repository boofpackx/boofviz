/**
 * Archive footage: random old films and TV from the Internet Archive, cached
 * on disk by the main process and played as a layer. Shared types and the
 * pure pieces (queries, file choice) so they can be unit tested.
 */

export interface ArchiveCollection {
  id: string;
  label: string;
  /** Internet Archive search query (mediatype and years are added). */
  query: string;
  /** Shown in the UI: whether the footage is free to show in public. */
  rights: 'public domain' | 'mostly public domain' | 'check rights';
}

export const ARCHIVE_COLLECTIONS: ArchiveCollection[] = [
  { id: 'ephemeral', label: 'Ads, educational & industrial films', query: 'collection:prelinger', rights: 'mostly public domain' },
  { id: 'newsreels', label: 'Newsreels', query: 'collection:universal_newsreels', rights: 'public domain' },
  { id: 'classictv', label: 'Classic TV shows', query: 'collection:classic_tv', rights: 'mostly public domain' },
  { id: 'cartoons', label: 'Cartoons', query: 'collection:classic_cartoons', rights: 'mostly public domain' },
  { id: 'government', label: 'Government films', query: 'collection:fedflix', rights: 'public domain' },
  { id: 'space', label: 'Space age', query: '(collection:prelinger OR collection:fedflix) AND (subject:space OR subject:rocket OR subject:nasa OR title:space)', rights: 'mostly public domain' },
  { id: 'homemovies', label: 'Home movies', query: 'collection:prelinger AND (subject:"home movies" OR title:"home movie")', rights: 'mostly public domain' },
  { id: 'commercials', label: 'TV commercials', query: 'collection:classic_tv_commercials', rights: 'check rights' },
  { id: 'custom', label: 'My search', query: '', rights: 'check rights' },
  { id: 'myvideos', label: 'My videos folder', query: '', rights: 'check rights' },
];

/** Video files the players can open from the user's videos folder. */
export const VIDEO_EXT = /\.(mp4|m4v|webm|ogv|mov|mkv)$/i;

export const FALLBACK_QUERY = 'collection:prelinger';

export interface ArchiveRequest {
  collection: string;
  /** Extra search words (used alone for 'custom'). */
  search: string;
  yearFrom: number;
  yearTo: number;
  /** Which clip: the same slot gives every window the same clip. */
  slot: number;
}

export interface ArchiveClip {
  id: string;
  title: string;
  year: number | null;
  /** boofviz-archive:// URL of the cached file. */
  url: string;
  /** Seconds (0 when unknown; the player reads it from the video). */
  duration: number;
  /** 0..1 random number for this slot (start offsets, jump cuts). */
  seed: number;
}

/** The full search query for a request. */
export function archiveQuery(req: Pick<ArchiveRequest, 'collection' | 'search' | 'yearFrom' | 'yearTo'>): string {
  const col = ARCHIVE_COLLECTIONS.find((c) => c.id === req.collection);
  const words = req.search.trim().replace(/[\r\n]+/g, ' ').slice(0, 200);
  let base = col?.query || '';
  if (words) base = base ? `(${base}) AND (${words})` : words;
  if (!base) base = FALLBACK_QUERY;
  const from = Math.max(1880, Math.min(2002, Math.round(req.yearFrom || 1880)));
  const to = Math.max(from, Math.min(2002, Math.round(req.yearTo || 2002)));
  return `(${base}) AND mediatype:movies AND year:[${from} TO ${to}]`;
}

export interface ArchiveFile {
  name: string;
  format?: string;
  size?: string | number;
  length?: string | number;
}

/** Derivative formats, smallest and most playable first. */
const FORMATS = ['512Kb MPEG4', 'h.264', 'h.264 IA', 'MPEG4'];
const MAX_BYTES = 450 * 1024 * 1024;

/** Seconds from an Internet Archive length field ("312.5" or "05:12"). */
export function parseLength(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return 0;
  if (v.includes(':')) return v.split(':').reduce((acc, part) => acc * 60 + (Number(part) || 0), 0);
  return Number(v) || 0;
}

/** The best playable MP4 in an item, or null. */
export function pickArchiveFile(files: ArchiveFile[]): ArchiveFile | null {
  const mp4 = files.filter((f) => /\.mp4$/i.test(f.name) && Number(f.size ?? 0) <= MAX_BYTES);
  for (const fmt of FORMATS) {
    const hit = mp4.filter((f) => f.format === fmt).sort((a, b) => Number(a.size ?? 0) - Number(b.size ?? 0))[0];
    if (hit) return hit;
  }
  return mp4.sort((a, b) => Number(a.size ?? 0) - Number(b.size ?? 0))[0] ?? null;
}

/** Cache file name for an item's file (no path separators, bounded length). */
export function cacheName(id: string, file: string): string {
  return `${id}__${file}`.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-180);
}
