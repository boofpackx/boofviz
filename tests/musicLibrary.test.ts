import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { matchMusicVideo } from '@shared/archive';
import { matchKey, normalizeTitle } from '@shared/lyrics';
import { applyPlan, findFiles, lyricsFileName, parseName, planLibrary, readTags, safeName, sharedAlbum, songFileName, songInfo, videoFileName, type Places } from '../scripts/musicLibrary';

// Every name below is invented. Tagged files are built byte by byte so no encoder is needed.

const u32 = (n: number): Buffer => Buffer.from([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const le32 = (n: number): Buffer => Buffer.from([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, n >>> 24]);
const safe = (n: number): Buffer => Buffer.from([(n >> 21) & 127, (n >> 14) & 127, (n >> 7) & 127, n & 127]);
const audio = Buffer.alloc(2000, 0x55);

function id3(ver: 2 | 3 | 4, frames: Array<[string, Buffer]>): Buffer {
  const body = Buffer.concat(
    frames.map(([id, b]) =>
      ver === 2 ? Buffer.concat([Buffer.from(id, 'latin1'), u32(b.length).subarray(1), b]) : Buffer.concat([Buffer.from(id, 'latin1'), ver === 4 ? safe(b.length) : u32(b.length), Buffer.alloc(2), b]),
    ),
  );
  const padded = Buffer.concat([body, Buffer.alloc(64)]);
  return Buffer.concat([Buffer.from('ID3'), Buffer.from([ver, 0, 0]), safe(padded.length), padded]);
}
const latin1 = (s: string): Buffer => Buffer.concat([Buffer.from([0]), Buffer.from(s, 'latin1')]);
const utf16 = (s: string): Buffer => Buffer.concat([Buffer.from([1, 0xff, 0xfe]), Buffer.from(s, 'utf16le')]);
const utf8 = (s: string): Buffer => Buffer.concat([Buffer.from([3]), Buffer.from(s, 'utf8')]);
const vorbis = (fields: string[]): Buffer => Buffer.concat([le32(6), Buffer.from('vendor'), le32(fields.length), ...fields.flatMap((f) => [le32(Buffer.byteLength(f)), Buffer.from(f)])]);
const box = (type: string, ...body: Buffer[]): Buffer => {
  const b = Buffer.concat(body);
  return Buffer.concat([u32(8 + b.length), Buffer.from(type, 'latin1'), b]);
};
const mp4Item = (type: string, value: string): Buffer => box(type, box('data', u32(1), u32(0), Buffer.from(value, 'utf8')));
const chunk = (id: string, body: Buffer): Buffer => Buffer.concat([Buffer.from(id), le32(body.length), body, Buffer.alloc(body.length & 1)]);

function oggPage(lacing: number[], data: Buffer): Buffer {
  const h = Buffer.alloc(27);
  h.write('OggS', 0, 'latin1');
  h[26] = lacing.length;
  return Buffer.concat([h, Buffer.from(lacing), data]);
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'boofviz-music-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});
const put = (rel: string, data: Buffer | string): string => {
  const p = join(dir, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, data);
  return p;
};
const mp3 = (title: string, artist: string, album = '', extra: Array<[string, Buffer]> = []): Buffer =>
  Buffer.concat([id3(3, [['TIT2', latin1(title)], ['TPE1', latin1(artist)], ...(album ? ([['TALB', latin1(album)]] as Array<[string, Buffer]>) : []), ...extra]), audio, Buffer.from(title)]);

describe('readTags', () => {
  it('reads ID3v2.2, v2.3 (UTF-16, cover art skipped) and v2.4 (UTF-8, several artists)', async () => {
    const v3 = put('a.mp3', Buffer.concat([id3(3, [['APIC', Buffer.alloc(5000, 1)], ['TIT2', utf16('Café Song')], ['TPE1', latin1('Some Band')], ['TPE2', latin1('Some Band')], ['TALB', latin1('First')]]), audio]));
    expect(await readTags(v3)).toEqual({ title: 'Café Song', artist: 'Some Band', albumArtist: 'Some Band', album: 'First' });
    const v4 = put('b.mp3', Buffer.concat([id3(4, [['TIT2', utf8('Night Bus')], ['TPE1', utf8('Ann Example\0Bo Other')], ['TCMP', latin1('1')]]), audio]));
    expect(await readTags(v4)).toEqual({ title: 'Night Bus', artist: 'Ann Example, Bo Other', compilation: true });
    const v2 = put('c.mp3', Buffer.concat([id3(2, [['TT2', latin1('Old Format')], ['TP1', latin1('Elder')]]), audio]));
    expect(await readTags(v2)).toEqual({ title: 'Old Format', artist: 'Elder' });
  });

  it('falls back to ID3v1 at the end of the file', async () => {
    const tag = Buffer.alloc(128);
    tag.write('TAG', 0, 'latin1');
    tag.write('Tail Song', 3, 'latin1');
    tag.write('Tail Band', 33, 'latin1');
    expect(await readTags(put('v1.mp3', Buffer.concat([audio, tag])))).toEqual({ title: 'Tail Song', artist: 'Tail Band' });
  });

  it('reads FLAC and Ogg comments (a comment packet spread over two pages)', async () => {
    const block = (type: number, last: boolean, b: Buffer): Buffer => Buffer.concat([Buffer.from([(last ? 0x80 : 0) | type]), u32(b.length).subarray(1), b]);
    const flac = put('a.flac', Buffer.concat([Buffer.from('fLaC'), block(0, false, Buffer.alloc(34)), block(4, true, vorbis(['TITLE=Lossless', 'ARTIST=Flac One', 'ARTIST=Flac Two', 'ALBUMARTIST=Flac One', 'ALBUM=Big Files'])), audio]));
    expect(await readTags(flac)).toEqual({ title: 'Lossless', artist: 'Flac One, Flac Two', albumArtist: 'Flac One', album: 'Big Files' });

    const ident = Buffer.concat([Buffer.from('\u0001vorbis', 'latin1'), Buffer.alloc(23)]);
    const comment = Buffer.concat([Buffer.from('\u0003vorbis', 'latin1'), vorbis(['TITLE=Ogg Tune', 'ARTIST=Xiph Crew', `COMMENT=${'x'.repeat(600)}`]), Buffer.from([1])]);
    const rest = comment.length - 510;
    const ogg = Buffer.concat([oggPage([ident.length, 255, 255], Buffer.concat([ident, comment.subarray(0, 510)])), oggPage([...Array(Math.floor(rest / 255)).fill(255), rest % 255], comment.subarray(510)), audio]);
    expect(await readTags(put('a.ogg', ogg))).toEqual({ title: 'Ogg Tune', artist: 'Xiph Crew' });
  });

  it('reads MP4 / M4A atoms, with the movie box after the audio', async () => {
    const ilst = box('ilst', mp4Item('\u00a9nam', 'Moov Last'), mp4Item('\u00a9ART', 'Atom Band'), mp4Item('\u00a9alb', 'Boxes'), box('cpil', box('data', u32(21), u32(0), Buffer.from([1]))));
    const m4a = Buffer.concat([box('ftyp', Buffer.from('M4A \0\0\0\0M4A mp42', 'latin1')), box('mdat', audio), box('moov', box('mvhd', Buffer.alloc(100)), box('udta', box('meta', Buffer.alloc(4), box('hdlr', Buffer.alloc(25)), ilst)))]);
    expect(await readTags(put('a.m4a', m4a))).toEqual({ title: 'Moov Last', artist: 'Atom Band', album: 'Boxes', compilation: true });
  });

  it('reads WAV INFO lists, and gives nothing for files without tags', async () => {
    const info = Buffer.concat([Buffer.from('INFO'), chunk('INAM', Buffer.from('Wave Form\0')), chunk('IPRD', Buffer.from('Odds\0')), chunk('IART', Buffer.from('RIFF Raff\0'))]);
    const body = Buffer.concat([Buffer.from('WAVE'), chunk('fmt ', Buffer.alloc(16)), chunk('LIST', info), chunk('data', audio)]);
    expect(await readTags(put('a.wav', Buffer.concat([Buffer.from('RIFF'), le32(body.length), body])))).toEqual({ title: 'Wave Form', artist: 'RIFF Raff', album: 'Odds' });
    expect(await readTags(put('plain.mp3', audio))).toEqual({});
    expect(await readTags(join(dir, 'missing.mp3'))).toEqual({});
  });
});

describe('names', () => {
  it('reads artist and title out of downloaded file names', () => {
    const cases: Array<[string, string, string]> = [
      ['Daft Example - One More Test (Official Video) [dQw4w9WgXcQ]', 'Daft Example', 'One More Test'],
      ['y2mate.com - 50 Example - In Da Test (Lyrics)', '50 Example', 'In Da Test'],
      ['01 - Second Song', '', 'Second Song'],
      ['01. Ann Example - Night Bus (feat. Bo)', 'Ann Example', 'Night Bus (feat. Bo)'],
      ['03 Night Bus', '', 'Night Bus'],
      ['1-01 Disc Song', '', 'Disc Song'],
      ['7 Rings Example', '', '7 Rings Example'],
      ['Some_Band_-_Under_Scores', 'Some Band', 'Under Scores'],
      ['Song (Remastered 2011) [HD]', '', 'Song (Remastered 2011)'],
    ];
    for (const [base, artist, title] of cases) expect(parseName(base), base).toEqual({ artist, title });
  });

  it('works out a song from tags, then its name, then its neighbours, then its folder', () => {
    // A channel name for the artist, "Artist - Title" in the title tag.
    expect(songInfo({ title: 'Daft Example - One More Test (Official Video)', artist: 'DaftExampleVEVO' }, 'x', [])).toMatchObject({ artist: 'Daft Example', title: 'One More Test', folder: 'Daft Example' });
    // A real title with a dash in it stays whole.
    expect(songInfo({ title: 'One More Test - Radio Edit', artist: 'Daft Example' }, 'x', [])).toMatchObject({ artist: 'Daft Example', title: 'One More Test - Radio Edit' });
    // Featured artist named once; the folder is the lead artist ("Simon & Example" stays together).
    expect(songInfo({ title: 'Night Bus (feat. Bo)', artist: 'Ann Example feat. Bo' }, 'x', [])).toMatchObject({ artist: 'Ann Example', folder: 'Ann Example' });
    expect(songInfo({ title: 'Duet', artist: 'Simon & Example' }, 'x', [])).toMatchObject({ folder: 'Simon & Example' });
    // Compilations go under Various Artists.
    expect(songInfo({ title: 'T', artist: 'A', album: 'Hits', compilation: true }, 'x', [])).toMatchObject({ album: 'Hits', folder: 'Various Artists' });
    expect(songInfo({ title: 'T', artist: 'A', albumArtist: 'VA' }, 'x', [])).toMatchObject({ folder: 'Various Artists' });
    // No tags: the file name, then the folder ("Artist - Album (2011)").
    expect(songInfo({}, '02 - Second Song', ['Placeholders - Paper Lanterns (2011)'])).toEqual({ artist: 'Placeholders', title: 'Second Song', album: 'Paper Lanterns', folder: 'Placeholders' });
    expect(songInfo({}, 'Ann Example - Night Bus', ['Ann Example', 'Night Album'])).toMatchObject({ album: 'Night Album', folder: 'Ann Example' });
    expect(songInfo({}, 'Lonely Song', ['Old Stuff', 'Party'])).toEqual({ artist: '', title: 'Lonely Song', album: '', folder: 'Unknown Artist' });
    expect(songInfo({}, 'Lonely Song', ['music - Copy'])).toMatchObject({ artist: '', album: '' });
    expect(songInfo({ title: 'Clara - Live', artist: 'A' }, 'x', [])).toMatchObject({ artist: 'A', title: 'Clara - Live' });
    // No tags, but the tagged songs beside it share an album.
    const album = sharedAlbum([{ title: 'A', artist: 'The Placeholders', album: 'Paper Lanterns' }, { title: 'B', artist: 'The Placeholders', album: 'Paper Lanterns' }]);
    expect(songInfo({}, '02 - Second Song', ['Placeholders - Paper Lanterns'], album)).toEqual({ artist: 'The Placeholders', title: 'Second Song', album: 'Paper Lanterns', folder: 'The Placeholders' });
    expect(songInfo({}, 'Other Band - Stray', ['Mix'], album)).toEqual({ artist: 'Other Band', title: 'Stray', album: '', folder: 'Other Band' });
    expect(sharedAlbum([{ artist: 'A', album: 'One' }, { artist: 'A', album: 'Two' }])).toBeUndefined();
  });

  it('names files so BOOFVIZ finds them: music videos and lyrics by "Artist - Title"', () => {
    const info = { artist: 'The Placeholders', title: 'Paper Lanterns - 2011 Remaster' };
    expect(songFileName(info, '.MP3')).toBe('The Placeholders - Paper Lanterns - 2011 Remaster.mp3');
    const video = videoFileName(info, '.MP4');
    expect(video).toBe('The Placeholders - Paper Lanterns.mp4');
    for (const title of ['Paper Lanterns', 'Paper Lanterns - 2011 Remaster']) expect(matchMusicVideo([video], { title, artists: ['The Placeholders'] })).toBe(video);
    const lrc = lyricsFileName(info);
    expect(lrc).toBe('The Placeholders - Paper Lanterns.lrc');
    // The lyrics folder index keys a file by its name (src/main/lyrics.ts).
    expect(matchKey(lrc.replace(/\.lrc$/, ''))).toBe(matchKey(`The Placeholders - ${normalizeTitle('Paper Lanterns')}`));
    expect(songFileName({ artist: '', title: 'Lonely' }, '.flac')).toBe('Lonely.flac');
  });

  it('makes names that work on Windows', () => {
    expect(safeName('AC/DC: Live?  ')).toBe('AC DC Live');
    expect(safeName('Song...')).toBe('Song');
    expect(safeName('CON')).toBe('_CON');
    expect(Array.from(safeName('é'.repeat(300))).length).toBe(120);
  });
});

describe('organizing', () => {
  const places = (): Places => ({ library: join(dir, 'Music', 'BOOFVIZ'), lyrics: join(dir, 'data', 'lyrics'), videos: join(dir, 'data', 'videos') });
  const tree = (root: string): string[] => {
    const out: string[] = [];
    const walk = (d: string): void => {
      for (const e of readdirSync(d, { withFileTypes: true })) e.isDirectory() ? walk(join(d, e.name)) : out.push(relative(root, join(d, e.name)).split('\\').join('/'));
    };
    if (existsSync(root)) walk(root);
    return out.sort();
  };

  it('looks through the Desktop for music folders only, and skips code projects and the library itself', () => {
    put('Desktop/loose.mp3', audio);
    put('Desktop/loose.lrc', '[00:01]la');
    put('Desktop/recording.mp4', audio);
    put('Desktop/music dump/Band - Album/01 Song.mp3', audio);
    put('Desktop/music dump/Band - Album/Band - Song (Official Video).mp4', audio);
    put('Desktop/work/screen capture.mp4', audio);
    put('Desktop/boofviz/.git/HEAD', 'ref');
    put('Desktop/boofviz/test-output/test.wav', audio);
    put('Desktop/Library/Already.mp3', audio);
    const found = findFiles([{ path: join(dir, 'Desktop'), loose: true }], [join(dir, 'Desktop', 'Library')]);
    expect(found.map((f) => relative(dir, f.path).split('\\').join('/'))).toEqual(['Desktop/loose.lrc', 'Desktop/loose.mp3', 'Desktop/music dump/Band - Album/01 Song.mp3', 'Desktop/music dump/Band - Album/Band - Song (Official Video).mp4']);
    expect(found[2].dirs).toEqual(['music dump', 'Band - Album']);
    // A folder named outright is taken whole, its own name included.
    expect(findFiles([{ path: join(dir, 'Desktop', 'work') }], []).map((f) => f.dirs)).toEqual([['work']]);
  });

  it('plans, copies and re-runs without doing anything twice', async () => {
    const p = places();
    put('src/Band - Album/01 First.mp3', mp3('First', 'Band', 'Album'));
    put('src/Band - Album/02 Second.mp3', audio); // untagged: joins its neighbours' album
    put('src/Band - Album/01 First.lrc', '[00:01]la');
    put('src/Band - Album/cover.jpg', 'jpg');
    put('src/copy/First.mp3', mp3('First', 'Band', 'Album')); // the same file twice
    put('src/other/First.mp3', mp3('First', 'Band', 'Album', [['COMM', latin1('another rip')]])); // same name, different file
    put('src/Band - Clip (Official Video).webm', Buffer.concat([Buffer.from('\u001aE\u00df\u00a3 V_VP9 A_OPUS', 'latin1'), audio]));
    put('src/Some Band - Audio Only.webm', Buffer.concat([Buffer.from('\u001aE\u00df\u00a3 A_OPUS', 'latin1'), audio]));
    put('src/old.wma', audio);
    put('Music/BOOFVIZ/band/existing.txt', 'keeps its folder name');

    const found = findFiles([{ path: join(dir, 'src') }], [p.library]);
    const plan = await planLibrary(found, p);
    const where = (to: string): string => relative(dir, to).split('\\').join('/');
    expect(plan.moves.map((m) => [m.kind, where(m.to)])).toEqual([
      ['song', 'Music/BOOFVIZ/band/Album/Band - First.mp3'],
      ['song', 'Music/BOOFVIZ/band/Album/Band - Second.mp3'],
      ['video', 'data/videos/Band - Clip.webm'],
      ['song', 'Music/BOOFVIZ/band/Album/Band - First (2).mp3'],
      ['lyrics', 'data/lyrics/Band - First.lrc'],
      ['art', 'Music/BOOFVIZ/band/Album/cover.jpg'],
    ]);
    expect(plan.same.map(([a, b]) => [relative(dir, a), relative(dir, b)].map((s) => s.split('\\').join('/')))).toEqual([['src/copy/First.mp3', 'src/Band - Album/01 First.mp3']]);
    expect(plan.unplayable.map((u) => relative(dir, u).split('\\').join('/'))).toEqual(['src/old.wma', 'src/Some Band - Audio Only.webm']);

    const result = await applyPlan(plan, p, { move: false, sources: [join(dir, 'src')] });
    expect(result).toEqual({ done: 6, failed: [] });
    expect(tree(join(dir, 'src'))).toHaveLength(9); // copies leave the originals
    expect(readFileSync(join(p.library, 'band', 'Album', 'Band - First.mp3'))).toEqual(readFileSync(join(dir, 'src', 'Band - Album', '01 First.mp3')));
    expect(readFileSync(join(p.library, 'organize-log.txt'), 'utf8')).toContain('copied');

    const again = await planLibrary(findFiles([{ path: join(dir, 'src') }], [p.library]), p);
    expect(again.moves).toEqual([]);
    expect(again.same).toHaveLength(7);
  });

  it('moves, never overwrites, and clears out the folders it empties', async () => {
    const p = places();
    put('src/Band - Album/01 First.mp3', mp3('First', 'Band', 'Album'));
    put('src/Band - Album/sub/Band - Deep.mp3', audio);
    put('src/keep/Band - Kept.mp3', audio);
    put('src/keep/notes.txt', 'mine');
    const found = findFiles([{ path: join(dir, 'src') }], [p.library]);
    const plan = await planLibrary(found, p);
    put('Music/BOOFVIZ/Band/Band - Kept.mp3', 'arrived in the meantime');
    const result = await applyPlan(plan, p, { move: true, sources: [join(dir, 'src')] });
    expect(result.done).toBe(2);
    expect(result.failed.map(([f]) => relative(dir, f).split('\\').join('/'))).toEqual(['src/keep/Band - Kept.mp3']);
    expect(readFileSync(join(p.library, 'Band', 'Band - Kept.mp3'), 'utf8')).toBe('arrived in the meantime');
    expect(tree(join(dir, 'src'))).toEqual(['keep/Band - Kept.mp3', 'keep/notes.txt']);
    expect(existsSync(join(dir, 'src', 'Band - Album'))).toBe(false);
    expect(existsSync(join(dir, 'src'))).toBe(true);
  });
});
