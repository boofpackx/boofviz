/**
 * Song details from a local audio file's own tags: ID3 (MP3, and inside WAV /
 * AIFF), WAV's LIST/INFO, Vorbis comments (FLAC, Ogg, Opus) and iTunes atoms
 * (M4A), falling back to the file name
 * ("Artist - Title.mp3"). Lyrics stored in the tags (often timed LRC) come
 * along. Pure: hand it the start of the file (and its end, for ID3v1 and M4A
 * files that keep their tags at the back).
 */

export interface FileSong {
  title: string;
  artists: string[];
  album: string;
  /** Lyrics from the tags (LRC or plain), or null. */
  lyrics: string | null;
}

interface Tags {
  title?: string;
  artist?: string[];
  albumArtist?: string;
  album?: string;
  lyrics?: string;
}

const ascii = (b: Uint8Array, at: number, n: number): string => String.fromCharCode(...b.subarray(at, at + n));
const u32be = (b: Uint8Array, at: number): number => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
const u32le = (b: Uint8Array, at: number): number => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;
const syncsafe = (b: Uint8Array, at: number): number => ((b[at] & 0x7f) << 21) | ((b[at + 1] & 0x7f) << 14) | ((b[at + 2] & 0x7f) << 7) | (b[at + 3] & 0x7f);
const utf8 = (b: Uint8Array): string => new TextDecoder('utf-8').decode(b);
const clean = (s: string | undefined): string => (s ?? '').replace(/\0+$/g, '').trim();

/** Decode an ID3 string in its declared encoding (0 Latin-1, 1 UTF-16 + BOM, 2 UTF-16BE, 3 UTF-8). */
function id3String(b: Uint8Array, enc: number): string {
  if (enc === 0) return new TextDecoder('latin1').decode(b);
  if (enc === 3) return utf8(b);
  let le = enc === 1;
  let at = 0;
  if (b.length >= 2 && ((b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0xfe && b[1] === 0xff))) {
    le = b[0] === 0xff;
    at = 2;
  }
  return new TextDecoder(le ? 'utf-16le' : 'utf-16be').decode(b.subarray(at, at + ((b.length - at) & ~1)));
}

/** Where an ID3 string ends (its terminator: one zero byte, or two aligned ones for UTF-16). */
function id3End(b: Uint8Array, at: number, enc: number): number {
  const wide = enc === 1 || enc === 2;
  for (let i = at; i + (wide ? 1 : 0) < b.length; i += wide ? 2 : 1) if (b[i] === 0 && (!wide || b[i + 1] === 0)) return i;
  return b.length;
}

function readId3v2(b: Uint8Array): { tags: Tags; size: number } | null {
  if (b.length < 10 || ascii(b, 0, 3) !== 'ID3') return null;
  const major = b[3];
  const size = 10 + syncsafe(b, 6);
  const tags: Tags = {};
  let at = 10;
  if (b[5] & 0x40) at += major === 4 ? syncsafe(b, 10) : 4 + u32be(b, 10);
  const end = Math.min(size, b.length);
  const v22 = major === 2;
  const head = v22 ? 6 : 10;
  while (at + head <= end) {
    const id = ascii(b, at, v22 ? 3 : 4);
    if (!/^[A-Z0-9]{3,4}$/.test(id)) break;
    const len = v22 ? (b[at + 3] << 16) | (b[at + 4] << 8) | b[at + 5] : major === 4 ? syncsafe(b, at + 4) : u32be(b, at + 4);
    let body = b.subarray(at + head, Math.min(end, at + head + len));
    // ID3v2.4 "data length indicator" adds four bytes before the frame's content.
    if (major === 4 && b[at + 9] & 0x01) body = body.subarray(4);
    at += head + len;
    if (!body.length) continue;
    const enc = body[0];
    const text = (): string[] =>
      id3String(body.subarray(1), enc)
        .split('\0')
        .map((s) => s.trim())
        .filter(Boolean);
    if (id === 'TIT2' || id === 'TT2') tags.title = text()[0];
    else if (id === 'TPE1' || id === 'TP1') tags.artist = text();
    else if (id === 'TPE2' || id === 'TP2') tags.albumArtist = text()[0];
    else if (id === 'TALB' || id === 'TAL') tags.album = text()[0];
    else if ((id === 'USLT' || id === 'ULT') && !tags.lyrics) {
      // Encoding, language (3), a description ending in a terminator, then the words.
      const descEnd = id3End(body, 4, enc);
      const words = id3String(body.subarray(descEnd + (enc === 1 || enc === 2 ? 2 : 1)), enc).trim();
      if (words) tags.lyrics = words;
    }
  }
  return { tags, size };
}

function readId3v1(tail: Uint8Array): Tags | null {
  if (tail.length < 128) return null;
  const t = tail.subarray(tail.length - 128);
  if (ascii(t, 0, 3) !== 'TAG') return null;
  const field = (at: number): string => clean(new TextDecoder('latin1').decode(t.subarray(at, at + 30)));
  const artist = field(33);
  return { title: field(3), artist: artist ? [artist] : [], album: field(63) };
}

/** A Vorbis comment block (FLAC, Ogg Vorbis, Opus): vendor, then "KEY=value" entries. */
function readVorbisComments(b: Uint8Array, at: number): Tags {
  const tags: Tags = {};
  if (at + 8 > b.length) return tags;
  at += 4 + u32le(b, at);
  const count = u32le(b, at);
  at += 4;
  const artists: string[] = [];
  for (let i = 0; i < count && at + 4 <= b.length; i++) {
    const len = u32le(b, at);
    const entry = utf8(b.subarray(at + 4, Math.min(b.length, at + 4 + len)));
    at += 4 + len;
    const eq = entry.indexOf('=');
    if (eq < 0) continue;
    const key = entry.slice(0, eq).toUpperCase();
    const value = entry.slice(eq + 1).trim();
    if (!value) continue;
    if (key === 'TITLE') tags.title ??= value;
    else if (key === 'ARTIST') artists.push(value);
    else if (key === 'ALBUMARTIST' || key === 'ALBUM ARTIST') tags.albumArtist ??= value;
    else if (key === 'ALBUM') tags.album ??= value;
    else if (key === 'LYRICS' || key === 'UNSYNCEDLYRICS' || key === 'SYNCEDLYRICS') tags.lyrics ??= value;
  }
  if (artists.length) tags.artist = artists;
  return tags;
}

function readFlac(b: Uint8Array, at: number): Tags | null {
  if (ascii(b, at, 4) !== 'fLaC') return null;
  at += 4;
  while (at + 4 <= b.length) {
    const last = b[at] & 0x80;
    const type = b[at] & 0x7f;
    const len = (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3];
    if (type === 4) return readVorbisComments(b.subarray(0, Math.min(b.length, at + 4 + len)), at + 4);
    if (last) break;
    at += 4 + len;
  }
  return {};
}

function indexOf(b: Uint8Array, needle: number[], from = 0, to = b.length): number {
  outer: for (let i = from; i <= Math.min(to, b.length) - needle.length; i++) {
    for (let k = 0; k < needle.length; k++) if (b[i + k] !== needle[k]) continue outer;
    return i;
  }
  return -1;
}

function readOgg(b: Uint8Array): Tags | null {
  if (ascii(b, 0, 4) !== 'OggS') return null;
  const window = Math.min(b.length, 256 * 1024);
  const vorbis = indexOf(b, [0x03, 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73], 0, window);
  if (vorbis >= 0) return readVorbisComments(b, vorbis + 7);
  const opus = indexOf(
    b,
    [...'OpusTags'].map((c) => c.charCodeAt(0)),
    0,
    window,
  );
  return opus >= 0 ? readVorbisComments(b, opus + 8) : {};
}

/** iTunes-style metadata: the "ilst" atom's ©nam / ©ART / aART / ©alb / ©lyr children. */
function readMp4(b: Uint8Array): Tags | null {
  if (b.length < 12) return null;
  const ilst = indexOf(b, [0x69, 0x6c, 0x73, 0x74]);
  if (ilst < 4) return null;
  const end = Math.min(b.length, ilst - 4 + u32be(b, ilst - 4));
  const tags: Tags = {};
  let at = ilst + 4;
  while (at + 8 <= end) {
    const len = u32be(b, at);
    if (len < 8) break;
    const key = ascii(b, at + 4, 4);
    // Child "data" atom: size, "data", type, locale, then the value.
    const data = at + 8;
    if (ascii(b, data + 4, 4) === 'data') {
      const value = utf8(b.subarray(data + 16, Math.min(end, data + u32be(b, data)))).trim();
      if (value) {
        if (key === '©nam') tags.title = value;
        else if (key === '©ART') tags.artist = [value];
        else if (key === 'aART') tags.albumArtist = value;
        else if (key === '©alb') tags.album = value;
        else if (key === '©lyr') tags.lyrics = value;
      }
    }
    at += len;
  }
  return tags;
}

/** WAV LIST/INFO strings (INAM, IART, IPRD) from a chunk body starting after "INFO". */
function readRiffInfo(b: Uint8Array, at: number, end: number): Tags {
  const tags: Tags = {};
  while (at + 8 <= end) {
    const id = ascii(b, at, 4);
    const len = u32le(b, at + 4);
    const value = clean(utf8(b.subarray(at + 8, Math.min(end, at + 8 + len))));
    if (value) {
      if (id === 'INAM') tags.title = value;
      else if (id === 'IART') tags.artist = [value];
      else if (id === 'IPRD') tags.album = value;
    }
    at += 8 + len + (len & 1);
  }
  return tags;
}

/** WAV (RIFF) and AIFF (FORM) files: an ID3 chunk, or WAV's LIST/INFO, wherever it sits (start or end). */
function readRiff(head: Uint8Array, tail?: Uint8Array): Tags | null {
  const riff = ascii(head, 0, 4) === 'RIFF';
  if (!riff && ascii(head, 0, 4) !== 'FORM') return null;
  const size = (b: Uint8Array, at: number): number => (riff ? u32le(b, at) : u32be(b, at));
  const scan = (b: Uint8Array, at: number): Tags | null => {
    let found: Tags | null = null;
    while (at + 8 <= b.length) {
      const id = ascii(b, at, 4);
      const len = size(b, at + 4);
      const end = Math.min(b.length, at + 8 + len);
      if (id === 'id3 ' || id === 'ID3 ') return readId3v2(b.subarray(at + 8, end))?.tags ?? found;
      if (id === 'LIST' && ascii(b, at + 8, 4) === 'INFO') found = readRiffInfo(b, at + 12, end);
      at += 8 + len + (len & 1);
    }
    return found;
  };
  const inHead = scan(head, 12);
  if (inHead?.title || !tail) return inHead ?? {};
  // Tags after the audio: find the chunk by its name near the end of the file.
  for (const name of ['id3 ', 'ID3 ', 'LIST']) {
    const needle = [...name].map((c) => c.charCodeAt(0));
    for (let i = indexOf(tail, needle); i >= 0; i = indexOf(tail, needle, i + 1)) {
      const t = scan(tail, i);
      if (t?.title || t?.artist) return t;
    }
  }
  return inHead ?? {};
}

/** "01 - Artist - Title.mp3" → artist and title (either may be empty). */
export function songFromName(name: string): { title: string; artist: string } {
  const base = name
    .replace(/^.*[\\/]/, '')
    .replace(/\.[^.]+$/, '')
    .replace(/_/g, ' ')
    .replace(/^\s*\d{1,3}\s*[.)-]?\s+(?=\S)/, '')
    .trim();
  const parts = base.split(/\s+[-–—]\s+/);
  if (parts.length >= 2) return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() };
  return { artist: '', title: base };
}

export function songFromFile(name: string, head: Uint8Array, tail?: Uint8Array): FileSong {
  let tags: Tags = {};
  const id3 = readId3v2(head);
  const at = id3 ? id3.size : 0;
  if (id3) tags = id3.tags;
  const more = readFlac(head, at) ?? readOgg(head) ?? readRiff(head, tail) ?? (ascii(head, 4, 4) === 'ftyp' ? (readMp4(head) ?? (tail ? readMp4(tail) : null)) : null);
  if (more) tags = { ...more, ...Object.fromEntries(Object.entries(tags).filter(([, v]) => v !== undefined && v !== '')) };
  if (!tags.title && tail) tags = { ...readId3v1(tail), ...tags };
  const fromName = songFromName(name);
  const artists = (tags.artist?.length ? tags.artist : tags.albumArtist ? [tags.albumArtist] : fromName.artist ? [fromName.artist] : []).map(clean).filter(Boolean);
  return {
    title: clean(tags.title) || fromName.title,
    artists,
    album: clean(tags.album),
    lyrics: tags.lyrics?.trim() || null,
  };
}
