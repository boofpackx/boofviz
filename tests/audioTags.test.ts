import { describe, expect, it } from 'vitest';
import { songFromFile, songFromName } from '@shared/audioTags';

const bytes = (...parts: Array<string | number[] | Uint8Array>): Uint8Array => {
  const arrs = parts.map((p) => (typeof p === 'string' ? new TextEncoder().encode(p) : p instanceof Uint8Array ? p : Uint8Array.from(p)));
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
  let at = 0;
  for (const a of arrs) {
    out.set(a, at);
    at += a.length;
  }
  return out;
};
const be32 = (n: number): number[] => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le32 = (n: number): number[] => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
const syncsafe = (n: number): number[] => [(n >> 21) & 127, (n >> 14) & 127, (n >> 7) & 127, n & 127];
const utf16 = (s: string): number[] => [0xff, 0xfe, ...[...s].flatMap((c) => [c.charCodeAt(0) & 255, c.charCodeAt(0) >> 8])];

function id3v23(frames: Array<[string, Uint8Array]>): Uint8Array {
  const body = bytes(...frames.flatMap(([id, data]) => [id, be32(data.length), [0, 0], data]));
  return bytes('ID3', [3, 0, 0], syncsafe(body.length), body, [0xff, 0xfb, 0x90, 0x00]);
}

describe('local file song details', () => {
  it('reads ID3v2.3 title, artist, album and lyrics (Latin-1 and UTF-16)', () => {
    const lrc = '[00:01.00]First line\n[00:03.50]Second line';
    const file = id3v23([
      ['TIT2', bytes([0], 'Night Drive')],
      ['TPE1', bytes([1], utf16('Neon Fox'))],
      ['TALB', bytes([3], 'Late Hours')],
      ['USLT', bytes([3], 'eng', 'desc', [0], lrc)],
    ]);
    expect(songFromFile('track.mp3', file)).toEqual({ title: 'Night Drive', artists: ['Neon Fox'], album: 'Late Hours', lyrics: lrc });
  });

  it('reads FLAC Vorbis comments, several artists', () => {
    const comments = ['TITLE=Glass Rain', 'ARTIST=Ana', 'ARTIST=Bo', 'ALBUM=Weather', 'LYRICS=la la'];
    const block = bytes(le32(6), 'vendor', le32(comments.length), ...comments.flatMap((c) => [le32(new TextEncoder().encode(c).length), c]));
    const file = bytes('fLaC', [0x00, 0, 0, 34], new Uint8Array(34), [0x84, (block.length >> 16) & 255, (block.length >> 8) & 255, block.length & 255], block);
    expect(songFromFile('x.flac', file)).toEqual({ title: 'Glass Rain', artists: ['Ana', 'Bo'], album: 'Weather', lyrics: 'la la' });
  });

  it('reads M4A atoms from the end of the file', () => {
    const atom = (key: number[], value: string): Uint8Array => {
      const v = new TextEncoder().encode(value);
      const data = bytes(be32(16 + v.length), 'data', be32(1), be32(0), v);
      return bytes(be32(8 + data.length), key, data);
    };
    const items = bytes(atom([0xa9, ...'nam'.split('').map((c) => c.charCodeAt(0))], 'Tide'), atom([0xa9, ...'ART'.split('').map((c) => c.charCodeAt(0))], 'Moss'));
    const ilst = bytes(be32(8 + items.length), 'ilst', items);
    const head = bytes(be32(16), 'ftypM4A ', be32(0), new Uint8Array(64));
    expect(songFromFile('a.m4a', head, bytes(new Uint8Array(32), ilst))).toMatchObject({ title: 'Tide', artists: ['Moss'] });
  });

  it('reads WAV LIST/INFO tags, before or after the audio', () => {
    const info = (title: string, artist: string): Uint8Array => {
      const sub = (id: string, v: string): Uint8Array => {
        const t = bytes(v, [0]);
        return bytes(id, le32(t.length), t, t.length & 1 ? [0] : []);
      };
      const body = bytes('INFO', sub('INAM', title), sub('IART', artist));
      return bytes('LIST', le32(body.length), body);
    };
    const fmt = bytes('fmt ', le32(16), new Uint8Array(16));
    const data = bytes('data', le32(400), new Uint8Array(400));
    const front = bytes('RIFF', le32(0), 'WAVE', fmt, info('Quiet Interlude', 'Nobody'), data);
    expect(songFromFile('a.wav', front)).toMatchObject({ title: 'Quiet Interlude', artists: ['Nobody'] });
    // A big file: the head stops inside the audio, the tags are in the tail.
    const head = bytes('RIFF', le32(0), 'WAVE', fmt, 'data', le32(50_000_000), new Uint8Array(100));
    expect(songFromFile('b.wav', head, bytes(new Uint8Array(77), info('Late Tag', 'Tail Band')))).toMatchObject({ title: 'Late Tag', artists: ['Tail Band'] });
  });

  it('falls back to ID3v1, then to the file name', () => {
    const v1 = new Uint8Array(128);
    v1.set(new TextEncoder().encode('TAG'), 0);
    v1.set(new TextEncoder().encode('Old Song'), 3);
    v1.set(new TextEncoder().encode('Old Band'), 33);
    expect(songFromFile('whatever.mp3', new Uint8Array(16), bytes(new Uint8Array(500), v1))).toMatchObject({ title: 'Old Song', artists: ['Old Band'] });
    expect(songFromFile('C:\\Music\\07 - Neon Fox - Night Drive.mp3', new Uint8Array(16))).toEqual({ title: 'Night Drive', artists: ['Neon Fox'], album: '', lyrics: null });
    expect(songFromName('Night_Drive.wav')).toEqual({ title: 'Night Drive', artist: '' });
    expect(songFromName('Neon Fox – Night Drive (Live).flac')).toEqual({ title: 'Night Drive (Live)', artist: 'Neon Fox' });
  });

  it('never throws on junk', () => {
    const junk = Uint8Array.from({ length: 4096 }, (_, i) => (i * 97) & 255);
    expect(() => songFromFile('junk.mp3', bytes('ID3', [4, 0, 0x40, 0, 0, 0x7f, 0x7f], junk), junk)).not.toThrow();
    expect(() => songFromFile('junk.flac', bytes('fLaC', junk))).not.toThrow();
  });
});
