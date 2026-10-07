import { describe, expect, it } from 'vitest';
import { bounce, directShot, heroWord, intensityFor, songMap } from '@/engine/generators/lyricCinema';
import { layoutLine, LYRIC_STYLES, poseLetter, timeWords } from '@/engine/generators/lyricVideoMotion';

const adv = (ch: string): number => (ch === ' ' ? 0.3 : 0.6);

describe('song shape', () => {
  it('marks repeated lines as the chorus and picks hero words', () => {
    const lines = ['We were walking home', 'Hold the door, hold the door', 'The moon was a borrowed coin', 'Hold the door, hold the door!', 'and the static on the radio'].map((text) => ({ text }));
    const map = songMap(lines);
    expect(map.chorus).toEqual([false, true, false, true, false]);
    expect(lines[2].text.split(' ')[map.hero[2]]).toBe('borrowed');
    expect(heroWord('oh yeah')).toBe(-1);
    expect(heroWord('and the radio')).toBe(2);
  });

  it('keeps verses calm and makes choruses and drops big', () => {
    expect(intensityFor(true, 0.8, 0, 1)).toBeGreaterThan(intensityFor(false, 0.8, 0, 1));
    expect(intensityFor(true, 0.8, 1, 1)).toBeGreaterThan(intensityFor(true, 0.8, 0, 1));
    expect(intensityFor(true, 1, 1, 0)).toBeCloseTo(0.7);
  });
});

describe('hero layout', () => {
  it('gives the hero word its own row and keeps the others in order', () => {
    const words = ['PAPER', 'LANTERNS', 'OVER', 'THE', 'LOT'];
    const lay = layoutLine(words, adv, 'flow', 40, 1, { index: 1, scale: 2 });
    expect(lay.words[1].scale).toBe(2);
    expect(lay.words[0].y).toBeGreaterThan(lay.words[1].y);
    expect(lay.words[2].y).toBeLessThan(lay.words[1].y);
    expect(lay.words[2].y).toBe(lay.words[3].y);
    const plain = layoutLine(words, adv, 'flow', 40, 1);
    expect(new Set(plain.words.map((w) => w.y)).size).toBe(1);
  });
});

describe('cinema styles', () => {
  const line = timeWords('HOLD THE DOOR', 10, 13);
  const lay = layoutLine(['HOLD', 'THE', 'DOOR'], adv, 'flow', 40, 3);
  const motion = (now: number, rel = 0) => ({ now, line, kick: 0.3, beat: now * 2, spb: 0.5, speed: 1, seed: 3, current: 1, rel, frac: 0.5, intensity: 1, viewW: 20, viewH: 11 });

  it('pose every letter deterministically', () => {
    for (const style of LYRIC_STYLES) {
      for (const L of lay.letters) {
        const a = poseLetter(style, L, lay.words[L.word], motion(11.2));
        const b = poseLetter(style, L, lay.words[L.word], motion(11.2));
        expect(a).toEqual(b);
        expect(Number.isFinite(a.x + a.y + a.z + a.s + a.a)).toBe(true);
      }
    }
  });

  it('roll credits upward and show teletext rows only once sung', () => {
    const L = lay.letters[0];
    const early = poseLetter('credits', L, lay.words[0], { ...motion(11), frac: 0.1 });
    const later = poseLetter('credits', L, lay.words[0], { ...motion(12), frac: 0.6 });
    expect(later.y).toBeGreaterThan(early.y);
    expect(poseLetter('teletext', L, lay.words[0], motion(11, 1)).a).toBe(0);
    expect(poseLetter('teletext', L, lay.words[0], motion(11, -1)).a).toBe(1);
  });

  it('brings highway words in from the distance', () => {
    const L = lay.letters.find((x) => x.word === 2)!;
    const before = poseLetter('highway', L, lay.words[2], motion(line.words[2].start - 1));
    const at = poseLetter('highway', L, lay.words[2], motion(line.words[2].start));
    expect(before.z).toBeLessThan(at.z);
    expect(before.a).toBeGreaterThan(0);
  });
});

describe('director', () => {
  it('locks off at zero and stays in bounds', () => {
    const base = { intensity: 1, lineStart: 0, lineEnd: 4, now: 0.1, heroStart: 0.05, chorus: true, beat: 3, drop: 1, seed: 1, flat: false };
    const off = directShot({ ...base, amount: 0 });
    expect(off.pz).toBe(1);
    expect(off.fov).toBe(1);
    const on = directShot({ ...base, amount: 1 });
    expect(Math.abs(on.px)).toBeLessThan(1.5);
    expect(on.fov).toBeLessThan(1);
    const b = bounce(123.4, 10, 6);
    expect(Math.abs(b.x)).toBeLessThanOrEqual(5);
    expect(Math.abs(b.y)).toBeLessThanOrEqual(3);
  });
});

describe('cyrillic', () => {
  it('finds the chorus and hero words in Russian lyrics', () => {
    const lines = ['Я иду по пустой улице', 'Судно уходит в ночь', 'Мы танцуем в темноте', 'Судно уходит в ночь!'].map((text) => ({ text }));
    const map = songMap(lines);
    expect(map.chorus).toEqual([false, true, false, true]);
    const hero = lines[0].text.split(' ')[map.hero[0]];
    expect(['пустой', 'улице', 'иду']).toContain(hero);
    expect(lines[2].text.split(' ')[map.hero[2]]).not.toBe('в');
  });

  it('has Cyrillic letters in the 3D letter atlas', async () => {
    const { ATLAS_CHARS } = await import('@/engine/text/sdfAtlas');
    for (const ch of 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюяЄєІіЇїҐґЎў') expect(ATLAS_CHARS).toContain(ch);
    expect(new Set(ATLAS_CHARS).size).toBe(ATLAS_CHARS.length);
  });

  it('matches .lrc files and names presets in Cyrillic', async () => {
    const { matchKey } = await import('@shared/lyrics');
    const { slugify } = await import('@/engine/presetIO');
    expect(matchKey('Молчат Дома - Судно')).toBe(matchKey('молчат дома – судно'));
    expect(matchKey('Молчат Дома - Судно')).not.toBe(matchKey('Молчат Дома - Клетка'));
    expect(matchKey('Молчат Дома - Судно')).not.toBe('');
    expect(slugify('Ночной Город')).toBe('ночной-город');
    expect(slugify('Café Noir')).toBe('cafe-noir');
    expect(slugify('Neon Stage!')).toBe('neon-stage');
  });
});
