/**
 * The music organizer's workings (scripts/organize-music.ts is the command):
 * read the tags of downloaded songs and videos, work out artist / album /
 * title (tags first, then the file name, then the folder), plan where every
 * file goes, then copy or move them. Names follow what BOOFVIZ looks for:
 * "Artist - Title" for songs, .lrc lyrics and music videos.
 */
import { createHash } from 'node:crypto';
import { constants, createReadStream, existsSync, readdirSync, statSync, type Dirent } from 'node:fs';
import { appendFile, copyFile, mkdir, open, readFile, rename, rmdir, stat, unlink, utimes, type FileHandle } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative } from 'node:path';
import { VIDEO_EXT } from '../src/shared/archive';
import { lrcFileName, matchKey, normalizeTitle } from '../src/shared/lyrics';

/** What BOOFVIZ plays when a file is dropped on the control window (AUDIO_EXT in SourcePanel.tsx). */
export const AUDIO_EXT = /\.(mp3|wav|flac|ogg|m4a|aac|aiff?)$/i;
/** Audio BOOFVIZ can't open: reported and left where it is. */
export const OTHER_AUDIO_EXT = /\.(wma|opus|ape|wv|mka|mpc|ac3|dts|dsf|dff|amr|tta|caf|ra)$/i;
const LYRICS_EXT = /\.lrc$/i;
const ART_NAME = /^(cover|folder|front|album\s*art\w*)\.(jpe?g|png)$/i;

// ---------------------------------------------------------------- tags

export interface Tags {
  title?: string;
  artist?: string;
  albumArtist?: string;
  album?: string;
  compilation?: boolean;
}
type Field = keyof Tags;

const MAX_TAG = 32 * 1024 * 1024;
const utf8 = new TextDecoder('utf-8', { fatal: true });

/** UTF-8 when it is valid, else Latin-1 (older taggers). */
function text(b: Buffer): string {
  try {
    return utf8.decode(b);
  } catch {
    return b.toString('latin1');
  }
}

function add(tags: Tags, field: Field, value: string): void {
  const v = value.replace(/\0[\s\S]*$/, '').trim();
  if (!v) return;
  if (field === 'compilation') {
    tags.compilation = v === '1' || /^true$/i.test(v);
    return;
  }
  const had = tags[field];
  tags[field] = had && had !== v ? `${had}, ${v}` : v;
}

async function readAt(fh: FileHandle, pos: number, len: number): Promise<Buffer> {
  const buf = Buffer.alloc(Math.max(0, len));
  const { bytesRead } = await fh.read(buf, 0, buf.length, pos);
  return buf.subarray(0, bytesRead);
}

/**
 * Title, artist, album artist and album from a file's own tags: ID3 (MP3,
 * AAC, WAV, AIFF), FLAC and Ogg comments, MP4 / M4A atoms, WAV INFO. Empty
 * when there are none or the file can't be read.
 */
export async function readTags(path: string): Promise<Tags> {
  const native: Tags = {};
  const id3: Tags = {};
  const v1: Tags = {};
  const fh = await open(path, 'r').catch(() => null);
  if (!fh) return {};
  try {
    const size = (await fh.stat()).size;
    const start = await readId3v2(fh, 0, id3);
    const head = await readAt(fh, start, 12);
    const at = (a: number, b: number): string => head.toString('latin1', a, b);
    if (at(0, 4) === 'fLaC') await readFlac(fh, start + 4, native);
    else if (at(0, 4) === 'OggS') readOgg(await readAt(fh, start, 256 * 1024), native);
    else if (at(4, 8) === 'ftyp') await readMp4(fh, size, native);
    else if (at(0, 4) === 'RIFF') await readChunks(fh, 12, size, false, native, id3);
    else if (at(0, 4) === 'FORM') await readChunks(fh, 12, size, true, native, id3);
    if (!id3.title && !id3.artist && !native.title && !native.artist && size >= 128) readId3v1(await readAt(fh, size - 128, 128), v1);
  } catch {
    // A damaged or unusual file: keep whatever was read before the error.
  } finally {
    await fh.close();
  }
  return { ...v1, ...id3, ...native };
}

const ID3_FIELDS: Record<string, Field> = {
  TIT2: 'title', TT2: 'title', TPE1: 'artist', TP1: 'artist', TPE2: 'albumArtist', TP2: 'albumArtist', TALB: 'album', TAL: 'album', TCMP: 'compilation', TCP: 'compilation',
};

const synchsafe = (b: Buffer, i: number): number => ((b[i] & 0x7f) << 21) | ((b[i + 1] & 0x7f) << 14) | ((b[i + 2] & 0x7f) << 7) | (b[i + 3] & 0x7f);

function unsync(b: Buffer): Buffer {
  const out = Buffer.alloc(b.length);
  let n = 0;
  for (let i = 0; i < b.length; i++) {
    out[n++] = b[i];
    if (b[i] === 0xff && b[i + 1] === 0) i++;
  }
  return out.subarray(0, n);
}

function id3Text(b: Buffer): string {
  const enc = b[0];
  let body = b.subarray(1);
  let s: string;
  if (enc === 1 || enc === 2) {
    let be = enc === 2;
    if (body[0] === 0xfe && body[1] === 0xff) be = true;
    else if (body[0] === 0xff && body[1] === 0xfe) be = false;
    body = Buffer.from(body.subarray(0, body.length & ~1));
    if (be) body.swap16();
    s = body.toString('utf16le');
  } else {
    s = text(body);
  }
  return s.replace(/﻿/g, '').split('\0').map((v) => v.trim()).filter(Boolean).join(', ');
}

/** Reads an ID3v2 tag at `pos` into `tags`; returns where the tag ends (`pos` when there is none). */
async function readId3v2(fh: FileHandle, pos: number, tags: Tags): Promise<number> {
  const h = await readAt(fh, pos, 10);
  if (h.length < 10 || h.toString('latin1', 0, 3) !== 'ID3') return pos;
  const ver = h[3];
  const flags = h[5];
  const size = synchsafe(h, 6);
  const end = pos + 10 + size + (flags & 0x10 ? 10 : 0);
  if (ver < 2 || ver > 4) return end;
  let b = await readAt(fh, pos + 10, Math.min(size, MAX_TAG));
  if (flags & 0x80 && ver < 4) b = unsync(b);
  const v2 = ver === 2;
  const hl = v2 ? 6 : 10;
  let i = flags & 0x40 && !v2 && b.length >= 4 ? (ver === 3 ? 4 + b.readUInt32BE(0) : synchsafe(b, 0)) : 0;
  while (i + hl <= b.length) {
    const id = b.toString('latin1', i, i + (v2 ? 3 : 4));
    if (!/^[A-Z0-9]+$/.test(id)) break;
    const len = v2 ? b.readUIntBE(i + 3, 3) : ver === 4 ? synchsafe(b, i + 4) : b.readUInt32BE(i + 4);
    const ff = v2 ? 0 : b.readUInt16BE(i + 8);
    let data = b.subarray(i + hl, i + hl + len);
    i += hl + len;
    const field = ID3_FIELDS[id];
    if (!field || !data.length) continue;
    if (ver === 3 && ff & 0xc0) continue; // compressed or encrypted
    if (ver === 4) {
      if (ff & 0x0c) continue;
      if (ff & 0x01) data = data.subarray(4);
      if (ff & 0x02) data = unsync(data);
    }
    add(tags, field, id3Text(data));
  }
  return end;
}

function readId3v1(b: Buffer, tags: Tags): void {
  if (b.length < 128 || b.toString('latin1', 0, 3) !== 'TAG') return;
  add(tags, 'title', text(b.subarray(3, 33)));
  add(tags, 'artist', text(b.subarray(33, 63)));
  add(tags, 'album', text(b.subarray(63, 93)));
}

const VORBIS_FIELDS: Record<string, Field> = { TITLE: 'title', ARTIST: 'artist', ALBUMARTIST: 'albumArtist', 'ALBUM ARTIST': 'albumArtist', ALBUM: 'album', COMPILATION: 'compilation' };

/** Vorbis comments (FLAC, Ogg Vorbis, Opus); a cut-off block still gives its first fields. */
function vorbisComments(b: Buffer, tags: Tags): void {
  let i = 0;
  const u32 = (): number => (i + 4 <= b.length ? b.readUInt32LE((i += 4) - 4) : -1);
  const vendor = u32();
  if (vendor < 0) return;
  i += vendor;
  const count = u32();
  for (let k = 0; k < count; k++) {
    const len = u32();
    if (len < 0 || i + len > b.length) return;
    const s = b.toString('utf8', i, i + len);
    i += len;
    const eq = s.indexOf('=');
    const field = eq > 0 ? VORBIS_FIELDS[s.slice(0, eq).toUpperCase()] : undefined;
    if (field) add(tags, field, s.slice(eq + 1));
  }
}

async function readFlac(fh: FileHandle, pos: number, tags: Tags): Promise<void> {
  for (let n = 0; n < 128; n++) {
    const h = await readAt(fh, pos, 4);
    if (h.length < 4) return;
    const len = h.readUIntBE(1, 3);
    if ((h[0] & 0x7f) === 4) return vorbisComments(await readAt(fh, pos + 4, Math.min(len, MAX_TAG)), tags);
    if (h[0] & 0x80) return;
    pos += 4 + len;
  }
}

/** The comment header is an Ogg stream's second packet, often spread over several pages. */
function readOgg(b: Buffer, tags: Tags): void {
  const packets: Buffer[] = [];
  let part: Buffer[] = [];
  for (let i = 0; packets.length < 2 && i + 27 <= b.length && b.toString('latin1', i, i + 4) === 'OggS'; ) {
    const segs = b[i + 26];
    let p = i + 27 + segs;
    if (p > b.length) break;
    for (let s = 0; s < segs && packets.length < 2; s++) {
      const l = b[i + 27 + s];
      part.push(b.subarray(p, p + l));
      p += l;
      if (l < 255) {
        packets.push(Buffer.concat(part));
        part = [];
      }
    }
    i = p;
  }
  // Cover art can run the comments past what was read: the first fields are still there.
  const c = packets[1] ?? (packets.length === 1 && part.length ? Buffer.concat(part) : null);
  if (!c) return;
  if (c.toString('latin1', 0, 7) === '\u0003vorbis') vorbisComments(c.subarray(7), tags);
  else if (c.toString('latin1', 0, 8) === 'OpusTags') vorbisComments(c.subarray(8), tags);
}

/** Child boxes of an MP4 box: [type, body start, end]. */
function boxes(b: Buffer, start: number, end: number): Array<[string, number, number]> {
  const out: Array<[string, number, number]> = [];
  for (let i = start; i + 8 <= end; ) {
    let len = b.readUInt32BE(i);
    let hl = 8;
    if (len === 1 && i + 16 <= end) {
      len = Number(b.readBigUInt64BE(i + 8));
      hl = 16;
    } else if (len === 0) len = end - i;
    if (len < hl) break;
    out.push([b.toString('latin1', i + 4, i + 8), i + hl, Math.min(i + len, end)]);
    i += len;
  }
  return out;
}

const MP4_FIELDS: Record<string, Field> = { '©nam': 'title', '©ART': 'artist', aART: 'albumArtist', '©alb': 'album', cpil: 'compilation' };

async function readMp4(fh: FileHandle, size: number, tags: Tags): Promise<void> {
  // "moov" can come after the audio, so step over the top-level boxes to find it.
  for (let pos = 0, n = 0; pos + 8 <= size && n < 1000; n++) {
    const h = await readAt(fh, pos, 16);
    let len = h.readUInt32BE(0);
    let hl = 8;
    if (len === 1) {
      len = Number(h.readBigUInt64BE(8));
      hl = 16;
    } else if (len === 0) len = size - pos;
    if (len < hl) return;
    if (h.toString('latin1', 4, 8) === 'moov') return mp4Tags(await readAt(fh, pos + hl, Math.min(len - hl, MAX_TAG)), tags);
    pos += len;
  }
}

function mp4Tags(moov: Buffer, tags: Tags): void {
  const child = (start: number, end: number, type: string): [string, number, number] | undefined => boxes(moov, start, end).find((x) => x[0] === type);
  const udta = child(0, moov.length, 'udta');
  const meta = (udta && child(udta[1], udta[2], 'meta')) ?? child(0, moov.length, 'meta');
  if (!meta) return;
  // "meta" starts with 4 bytes of version and flags, except in some QuickTime files.
  const ms = moov.toString('latin1', meta[1] + 4, meta[1] + 8) === 'hdlr' ? meta[1] : meta[1] + 4;
  const ilst = child(ms, meta[2], 'ilst');
  if (!ilst) return;
  for (const [type, s, e] of boxes(moov, ilst[1], ilst[2])) {
    const field = MP4_FIELDS[type];
    const data = field && child(s, e, 'data');
    if (!field || !data) continue;
    const value = moov.subarray(data[1] + 8, data[2]); // after the type and locale words
    add(tags, field, field === 'compilation' ? String(value[0] ?? 0) : text(value));
  }
}

const RIFF_FIELDS: Record<string, Field> = { INAM: 'title', IART: 'artist', IPRD: 'album' };

/** WAV (little-endian) and AIFF (big-endian) chunks: an embedded ID3 tag, WAV's INFO list, AIFF's NAME and AUTH. */
async function readChunks(fh: FileHandle, pos: number, size: number, bigEndian: boolean, tags: Tags, id3: Tags): Promise<void> {
  for (let n = 0; pos + 8 <= size && n < 1000; n++) {
    const h = await readAt(fh, pos, 12);
    const id = h.toString('latin1', 0, 4);
    const len = bigEndian ? h.readUInt32BE(4) : h.readUInt32LE(4);
    if (/^id3 $/i.test(id)) await readId3v2(fh, pos + 8, id3);
    else if (!bigEndian && id === 'LIST' && h.toString('latin1', 8, 12) === 'INFO') {
      const b = await readAt(fh, pos + 12, Math.min(len - 4, MAX_TAG));
      for (let i = 0; i + 8 <= b.length; ) {
        const sub = b.readUInt32LE(i + 4);
        const field = RIFF_FIELDS[b.toString('latin1', i, i + 4)];
        if (field) add(tags, field, text(b.subarray(i + 8, i + 8 + sub)));
        i += 8 + sub + (sub & 1);
      }
    } else if (bigEndian && (id === 'NAME' || id === 'AUTH')) add(tags, id === 'NAME' ? 'title' : 'artist', text(await readAt(fh, pos + 8, Math.min(len, 4096))));
    pos += 8 + len + (len & 1);
  }
}

/** A .webm / .mkv with a picture: audio-only downloads list only "A_…" codecs. */
export async function hasVideoTrack(path: string): Promise<boolean> {
  const fh = await open(path, 'r');
  try {
    const head = (await readAt(fh, 0, 1 << 20)).toString('latin1');
    return /V_(VP[89]|AV1|MPEG|MS\/|THEORA|REAL|QUICKTIME|UNCOMPRESSED)/.test(head) || !/A_[A-Z]/.test(head);
  } finally {
    await fh.close();
  }
}

// ---------------------------------------------------------------- names

/** Bracketed extras in downloaded file names and tags that aren't part of the song's name. */
const JUNK = /\b(official|video|audio|lyrics?|visuali[sz]er|hd|hq|4k|\d{3,4}p|\d{2,3}\s*kbps|free download|out now)\b/i;
const SPLIT = /^(.+?)\s+[-–—]\s+(.+)$/;

/** "Song (Official Video) [HD]" → "Song". Keeps "(feat. X)", "(Remix)" and the like. */
export function cleanTitle(s: string): string {
  return s
    .replace(/_+/g, ' ')
    .replace(/\s*\[([A-Za-z0-9_-]{11})\]\s*$/, (whole, id: string) => (/[0-9_-]|[a-z][A-Z]/.test(id) ? '' : whole)) // yt-dlp's [video id]
    .replace(/^\s*(?:[\w-]+\.)+(?:com|net|org|io|cc|to|me|fm)\s+-\s+/i, '') // "y2mate.com - "
    .replace(/\s*[([]([^)\]]*)[)\]]/g, (whole, inner: string) => (JUNK.test(inner) ? '' : whole))
    .replace(/\s+-\s+(official\s+)?(music\s+)?(video|audio|lyrics?)$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "Artist - Topic" (YouTube's auto channels) → "Artist". */
export function cleanArtist(s: string): string {
  return s.replace(/_+/g, ' ').replace(/\s+-\s+topic$/i, '').replace(/\s+/g, ' ').trim();
}

/** Artist and title from a file name: "Artist - Title", "01 - Title", "01. Artist - Title"… */
export function parseName(base: string): { artist: string; title: string } {
  const s = cleanTitle(base)
    .replace(/^\d{1,3}(?:-\d{1,3})?\s*[.)_]\s*(?=\S)/, '')
    .replace(/^\d{1,3}\s+[-–—]\s+(?=\S)/, '');
  const track = /^(?:\d-)?0\d\s+(?=\S)/; // "01 Title", "1-01 Title" (not "50 Cent")
  const m = SPLIT.exec(s);
  if (m) return { artist: cleanArtist(m[1].replace(track, '')), title: m[2].trim() };
  return { artist: '', title: s.replace(track, '') };
}

/** Artist and album from a folder named "Artist - Album (2001)", or "Artist/Album" when the artist is known. */
export function parseFolders(dirs: readonly string[], artist: string): { artist: string; album: string } {
  const last = dirs[dirs.length - 1]?.replace(/_+/g, ' ') ?? '';
  const m = SPLIT.exec(last);
  if (m && !/^copy( \(\d+\))?$/i.test(m[2])) return { artist: cleanArtist(m[1]), album: cleanTitle(m[2].replace(/\s*[([]\d{4}[)\]]\s*$/, '')) };
  if (artist && dirs.length >= 2 && matchKey(dirs[dirs.length - 2]) === matchKey(artist)) return { artist, album: cleanTitle(last) };
  return { artist: '', album: '' };
}

/** The main artist, for the artist folder: "A feat. B" → "A" (but "Simon & Garfunkel" stays together). */
function leadArtist(s: string): string {
  return s.split(/\s+(?:feat\.?|ft\.?|featuring)\s+|\s*[([](?:feat|ft)\.?\s/i)[0].trim();
}

export interface SongInfo {
  artist: string;
  title: string;
  album: string;
  /** The artist folder: album artist, the lead artist, "Various Artists" or "Unknown Artist". */
  folder: string;
}

/** The album the tagged songs in one folder share, if they share one. */
export function sharedAlbum(tagged: readonly Tags[]): Tags | undefined {
  const withAlbum = tagged.filter((t) => t.album && (t.artist || t.albumArtist));
  if (!withAlbum.length || new Set(withAlbum.map((t) => matchKey(t.album!))).size > 1) return undefined;
  const artists = new Set(withAlbum.map((t) => matchKey(t.artist ?? '')));
  return { album: withAlbum[0].album, albumArtist: withAlbum.find((t) => t.albumArtist)?.albumArtist, artist: artists.size === 1 ? withAlbum[0].artist : undefined, compilation: withAlbum.some((t) => t.compilation) };
}

/**
 * What a song is: its tags first, then its file name, then the album the
 * tagged songs beside it share (`album`), then its folder's name.
 */
export function songInfo(tags: Tags, base: string, dirs: readonly string[], album?: Tags): SongInfo {
  const name = parseName(base);
  let title = cleanTitle(tags.title ?? '');
  let artist = cleanArtist(tags.artist ?? '');
  // "Artist - Title" all in the title tag, the artist tag empty or a channel name ("ArtistVEVO").
  const both = SPLIT.exec(title);
  const a = matchKey(artist);
  const b = both ? matchKey(both[1]) : '';
  if (both && b && (!a || a === b || (Math.min(a.length, b.length) >= 4 && (a.includes(b) || b.includes(a))))) {
    artist = cleanArtist(both[1]);
    title = both[2].trim();
  }
  // An untagged song joins its neighbours' album when it is by the same artist (or nobody knows).
  const own = matchKey(artist || name.artist);
  const shared = !tags.album && album && (!own || [album.artist, album.albumArtist].some((x) => x && matchKey(x) === own)) ? album : undefined;
  const folders = parseFolders(dirs, artist || name.artist);
  artist ||= name.artist || cleanArtist(shared?.artist ?? '') || folders.artist;
  title ||= name.title || base;
  // "Ann feat. Bo - Night Bus (feat. Bo)" → "Ann - Night Bus (feat. Bo)"
  if (/[([](feat|ft)\.?\s/i.test(title)) artist = leadArtist(artist);
  const albumName = cleanTitle(tags.album ?? shared?.album ?? '') || folders.album;
  const albumArtist = cleanArtist(tags.albumArtist ?? shared?.albumArtist ?? '');
  const various = (tags.compilation ?? shared?.compilation) || /^(various( artists)?|va)$/i.test(albumArtist);
  return { artist, title, album: albumName, folder: various ? 'Various Artists' : albumArtist || leadArtist(artist) || 'Unknown Artist' };
}

const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

/** A file or folder name that works on Windows, macOS and Linux. */
export function safeName(s: string, max = 120): string {
  const out = Array.from(s.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim())
    .slice(0, max)
    .join('')
    .replace(/[. ]+$/, '');
  return RESERVED.test(out) ? `_${out}` : out;
}

/** "Artist - Title.mp3": what BOOFVIZ shows for a dropped file, and how it finds music videos. */
export function songFileName(info: Pick<SongInfo, 'artist' | 'title'>, ext: string): string {
  const title = safeName(info.title) || 'Untitled';
  return `${info.artist ? `${safeName(info.artist, 80)} - ` : ''}${title}${ext.toLowerCase()}`;
}

/** A music video, matched to the playing song by name ("- 2011 Remaster", "(feat. X)" left out, as for lyrics). */
export function videoFileName(info: Pick<SongInfo, 'artist' | 'title'>, ext: string): string {
  return songFileName({ artist: info.artist, title: normalizeTitle(info.title) }, ext);
}

/** "Artist - Title.lrc", the name BOOFVIZ gives lyrics you attach. */
export function lyricsFileName(info: Pick<SongInfo, 'artist' | 'title'>): string {
  return info.artist ? lrcFileName(info.artist, info.title) : `${safeName(info.title) || 'Untitled'}.lrc`;
}

// ---------------------------------------------------------------- finding files

export type Kind = 'song' | 'lyrics' | 'video' | 'art';

export interface Found {
  path: string;
  /** Folder names from the source folder's own name down to the file's folder. */
  dirs: string[];
}

export interface Source {
  path: string;
  /** Desktop and Downloads: only folders with songs in them, and songs or lyrics lying loose. */
  loose?: boolean;
}

const SKIP_DIR = /^(node_modules|\$recycle\.bin|system volume information)$/i;

function inside(path: string, parent: string): boolean {
  const rel = relative(parent, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function walk(dir: string, dirs: string[], depth: number, skip: readonly string[], out: Found[]): void {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  if (depth > 0 && entries.some((e) => e.name === '.git')) return; // a code project, not music
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (depth < 12 && !SKIP_DIR.test(e.name) && !skip.some((s) => inside(p, s))) walk(p, [...dirs, e.name], depth + 1, skip, out);
    } else if (e.isFile()) out.push({ path: p, dirs });
  }
}

const isAudio = (p: string): boolean => AUDIO_EXT.test(p) || OTHER_AUDIO_EXT.test(p);

/** Every file under the sources, minus anything inside `skip` (the library and BOOFVIZ's own folders). */
export function findFiles(sources: readonly Source[], skip: readonly string[]): Found[] {
  const out: Found[] = [];
  const seen = new Set<string>();
  const push = (files: Found[]): void => {
    for (const f of files) {
      const key = process.platform === 'win32' ? f.path.toLowerCase() : f.path;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(f);
    }
  };
  for (const src of sources) {
    let st;
    try {
      st = statSync(src.path);
    } catch {
      continue;
    }
    if (st.isFile()) {
      push([{ path: src.path, dirs: [] }]);
      continue;
    }
    if (!src.loose) {
      const files: Found[] = [];
      walk(src.path, [basename(src.path)], 0, skip, files);
      push(files);
      continue;
    }
    const files: Found[] = [];
    walk(src.path, [], 0, skip, files);
    // Loose files in the folder itself: songs and lyrics only. Subfolders: only those with songs.
    const top = (f: Found): string => f.dirs[0] ?? '';
    const musical = new Set(files.filter((f) => isAudio(f.path)).map(top));
    push(files.filter((f) => (f.dirs.length ? musical.has(top(f)) : isAudio(f.path) || LYRICS_EXT.test(f.path))));
  }
  return out;
}

// ---------------------------------------------------------------- planning

export interface Move {
  kind: Kind;
  from: string;
  to: string;
}

export interface Plan {
  moves: Move[];
  /** Already in the library, or a copy of another file being moved: [file, the copy that stays]. */
  same: Array<[string, string]>;
  /** Audio BOOFVIZ can't open (WMA, Opus…), left where it is. */
  unplayable: string[];
}

export interface Places {
  library: string;
  lyrics: string;
  videos: string;
}

async function sameFile(a: string, b: string): Promise<boolean> {
  const [sa, sb] = await Promise.all([stat(a), stat(b)]);
  if (sa.size !== sb.size) return false;
  const hash = (p: string): Promise<string> =>
    new Promise((res, rej) => {
      const h = createHash('sha1');
      createReadStream(p).on('data', (d) => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej);
    });
  const [ha, hb] = await Promise.all([hash(a), hash(b)]);
  return ha === hb;
}

/** Folder names that differ only in case or accents ("ABBA" / "Abba", "Beyonce" / "Beyoncé") share one folder. */
class Folders {
  private readonly names = new Map<string, string>();
  private readonly listed = new Set<string>();

  private key(parent: string, name: string): string {
    return `${parent.toLowerCase()}\n${matchKey(name) || name.toLowerCase()}`;
  }

  path(parent: string, ...names: string[]): string {
    let dir = parent;
    for (const raw of names) {
      const name = safeName(raw) || '_';
      if (!this.listed.has(dir)) {
        this.listed.add(dir);
        if (existsSync(dir)) for (const e of readdirSync(dir, { withFileTypes: true })) if (e.isDirectory()) this.names.set(this.key(dir, e.name), e.name);
      }
      const k = this.key(dir, name);
      if (!this.names.has(k)) this.names.set(k, name);
      dir = join(dir, this.names.get(k)!);
    }
    return dir;
  }
}

/** Where each file goes: names already taken (on disk or earlier in the plan) get " (2)", " (3)"… unless they hold the same file. */
class Targets {
  private readonly taken = new Map<string, string>();

  async place(from: string, dir: string, name: string, rename = true): Promise<{ to: string } | { same: string } | null> {
    const ext = extname(name);
    const stem = name.slice(0, name.length - ext.length);
    for (let n = 1; ; n++) {
      const to = join(dir, n === 1 ? name : `${stem} (${n})${ext}`);
      const key = to.toLowerCase(); // Windows and macOS ignore case in file names
      const other = this.taken.get(key) ?? (existsSync(to) ? to : null);
      if (!other) {
        this.taken.set(key, from);
        return { to };
      }
      if (await sameFile(from, other)) return { same: other };
      if (!rename) return null;
    }
  }
}

async function lrcTags(path: string): Promise<Tags> {
  const head = text((await readFile(path)).subarray(0, 2048));
  return { artist: /\[ar:([^\]]*)\]/i.exec(head)?.[1]?.trim(), title: /\[ti:([^\]]*)\]/i.exec(head)?.[1]?.trim() };
}

const stemKey = (p: string): string => join(dirname(p), basename(p, extname(p))).toLowerCase();

/**
 * Where everything goes. Songs: library/Artist/Album/"Artist - Title.ext"
 * (no album: library/Artist/). Lyrics and music videos: BOOFVIZ's own
 * folders as "Artist - Title". Album covers follow their songs.
 */
export async function planLibrary(found: readonly Found[], places: Places, onProgress?: (done: number, total: number) => void): Promise<Plan> {
  const plan: Plan = { moves: [], same: [], unplayable: [] };
  const folders = new Folders();
  const targets = new Targets();
  const infos = new Map<string, SongInfo>(); // song path without extension → info, for lyrics beside it
  const songDirs = new Map<string, Set<string>>(); // source folder → library folders its songs went to
  const place = async (kind: Kind, from: string, dir: string, name: string): Promise<void> => {
    const r = await targets.place(from, dir, name, kind !== 'art'); // a second cover for one album is left behind
    if (r && 'to' in r) plan.moves.push({ kind, from, to: r.to });
    else if (r) plan.same.push([from, r.same]);
  };
  const base = (p: string): string => basename(p, extname(p));

  const songTags = new Map<string, Tags>();
  let done = 0;
  for (const f of found) {
    onProgress?.(done++, found.length);
    if (AUDIO_EXT.test(f.path)) songTags.set(f.path, await readTags(f.path));
  }
  onProgress?.(found.length, found.length);
  const byDir = new Map<string, Tags[]>();
  for (const [path, tags] of songTags) byDir.set(dirname(path), [...(byDir.get(dirname(path)) ?? []), tags]);
  const albums = new Map([...byDir].map(([dir, list]) => [dir, sharedAlbum(list)]));

  for (const f of found) {
    const tags = songTags.get(f.path);
    if (tags) {
      const info = songInfo(tags, base(f.path), f.dirs, albums.get(dirname(f.path)));
      infos.set(stemKey(f.path), info);
      const dir = info.album ? folders.path(places.library, info.folder, info.album) : folders.path(places.library, info.folder);
      await place('song', f.path, dir, songFileName(info, extname(f.path)));
      const set = songDirs.get(dirname(f.path)) ?? new Set();
      songDirs.set(dirname(f.path), set.add(dir));
    } else if (OTHER_AUDIO_EXT.test(f.path) || (/\.(webm|mkv)$/i.test(f.path) && !(await hasVideoTrack(f.path).catch(() => true)))) {
      plan.unplayable.push(f.path);
    } else if (VIDEO_EXT.test(f.path)) {
      // Downloaded videos are named "Artist - Title (Official Video)"; their tags often name the channel instead.
      const tags = !parseName(base(f.path)).artist && /\.(mp4|m4v|mov)$/i.test(f.path) ? await readTags(f.path) : {};
      const info = songInfo(tags, base(f.path), f.dirs);
      await place('video', f.path, places.videos, videoFileName(info, extname(f.path)));
    }
  }
  for (const f of found) {
    if (!LYRICS_EXT.test(f.path)) continue;
    const own = await lrcTags(f.path).catch((): Tags => ({}));
    const info = own.title ? songInfo(own, base(f.path), f.dirs) : (infos.get(stemKey(f.path)) ?? songInfo({}, base(f.path), f.dirs));
    await place('lyrics', f.path, places.lyrics, lyricsFileName(info));
  }
  for (const f of found) {
    const dirs = ART_NAME.test(basename(f.path)) ? songDirs.get(dirname(f.path)) : undefined;
    if (dirs?.size === 1) await place('art', f.path, [...dirs][0], basename(f.path).toLowerCase());
  }
  return plan;
}

// ---------------------------------------------------------------- doing it

async function copyKeepingDate(from: string, to: string): Promise<void> {
  await copyFile(from, to, constants.COPYFILE_EXCL);
  const st = await stat(from);
  await utimes(to, st.atime, st.mtime).catch(() => undefined);
}

async function moveFile(from: string, to: string): Promise<void> {
  if (existsSync(to)) throw new Error(`${to} already exists`);
  try {
    await rename(from, to);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
    await copyKeepingDate(from, to); // another drive
    await unlink(from);
  }
}

/**
 * Copies (or moves) every planned file, never overwriting, and appends what
 * went where to organize-log.txt in the library. After a move, folders left
 * empty are removed (never the source folders themselves).
 */
export async function applyPlan(plan: Plan, places: Places, opts: { move: boolean; sources: readonly string[]; onProgress?: (done: number, total: number) => void }): Promise<{ done: number; failed: Array<[string, string]> }> {
  const failed: Array<[string, string]> = [];
  const log: string[] = [`# ${new Date().toISOString()} ${opts.move ? 'moved' : 'copied'}`];
  let done = 0;
  for (const m of plan.moves) {
    opts.onProgress?.(done + failed.length, plan.moves.length);
    try {
      await mkdir(dirname(m.to), { recursive: true });
      await (opts.move ? moveFile(m.from, m.to) : copyKeepingDate(m.from, m.to));
      log.push(`${m.from}\t${m.to}`);
      done++;
    } catch (err) {
      failed.push([m.from, (err as Error).message]);
    }
  }
  opts.onProgress?.(plan.moves.length, plan.moves.length);
  if (opts.move) {
    const dirs = [...new Set(plan.moves.map((m) => dirname(m.from)))].sort((a, b) => b.length - a.length);
    for (let dir of dirs) {
      while (!opts.sources.some((s) => relative(dir, s) === '') && opts.sources.some((s) => inside(dir, s))) {
        try {
          await rmdir(dir); // only succeeds when empty
        } catch {
          break;
        }
        dir = dirname(dir);
      }
    }
  }
  if (done) {
    await mkdir(places.library, { recursive: true });
    await appendFile(join(places.library, 'organize-log.txt'), `${log.join('\n')}\n\n`);
  }
  return { done, failed };
}
