import { describe, expect, it } from 'vitest';
import { strokeGlyph, strokeLine } from '@/engine/text/strokeFont';

describe('single-stroke font', () => {
  it('draws every Latin and Russian capital and every digit', () => {
    const chars = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', ...'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ'];
    for (const ch of chars) expect(strokeGlyph(ch), ch).not.toBeNull();
    expect(strokeGlyph('a')).toEqual(strokeGlyph('A'));
    expect(strokeGlyph(' ')).toBeNull();
  });

  it('lays a line out as one path, wrapping rows, with each word ending further along', () => {
    const p = strokeLine('HOLD THE DOOR TONIGHT', 9);
    expect(p.rows).toBe(3);
    expect(p.pts.length / 2).toBe(p.len.length);
    for (let k = 1; k < p.len.length; k++) expect(p.len[k]).toBeGreaterThanOrEqual(p.len[k - 1]);
    expect(p.wordEnd).toHaveLength(4);
    for (let k = 1; k < 4; k++) expect(p.wordEnd[k]).toBeGreaterThan(p.wordEnd[k - 1]);
    expect(p.wordEnd[3]).toBe(p.len[p.len.length - 1]);
  });
});
