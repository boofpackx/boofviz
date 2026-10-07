import { describe, expect, it } from 'vitest';
import { cleanVideoName, matchMusicVideo } from '@shared/archive';
import { clipTrick, cutClip, trickSourceBeat } from '@/engine/generators/ClipEngine';

describe('clip engine', () => {
  it('never cuts to the same clip twice running', () => {
    for (let c = 1; c < 500; c++) expect(cutClip(c, 3, 7)).not.toBe(cutClip(c - 1, 3, 7));
    expect(cutClip(5, 1, 0)).toBe(0);
  });

  it('puts tricks only at the ends of bars, longer at the end of a phrase, and none when off', () => {
    for (let beat = 0; beat < 64; beat += 0.25) {
      const t = clipTrick(beat, 4, 'mix', 1);
      const inBar = beat % 4;
      const phraseEnd = Math.floor(beat / 4) % 4 === 3;
      if (inBar < (phraseEnd ? 2 : 3)) expect(t).toBeNull();
      else expect(t?.len).toBe(phraseEnd ? 2 : 1);
      expect(clipTrick(beat, 4, 'off', 1)).toBeNull();
      expect(clipTrick(beat, 4, 'stutter', 0)).toBeNull();
    }
    expect(clipTrick(3.5, 4, 'freeze', 1)?.kind).toBe('freeze');
  });

  it('replays frames from before the trick: loops, runs backwards, scratches, holds', () => {
    const at = (kind: 'stutter' | 'reverse' | 'scratch' | 'freeze', beat: number) => trickSourceBeat({ kind, start: 3, len: 1 }, beat);
    expect(at('stutter', 3)).toBeCloseTo(2.75);
    expect(at('stutter', 3.3)).toBeCloseTo(2.8);
    expect(at('reverse', 3.5)).toBeCloseTo(2.5);
    expect(at('freeze', 3.9)).toBe(3);
    for (let b = 3; b < 4; b += 0.05) expect(at('scratch', b)).toBeGreaterThanOrEqual(2.75 - 1e-9);
  });

  it('finds your music video by file name, ignoring "(Official Video)" and the like', () => {
    const names = ['The Placeholders - Paper Lanterns (Official Music Video).mp4', 'Night Bus - Ann [HD].webm', 'Home.mp4', 'notes.txt', 'Other - Home.mp4'];
    expect(cleanVideoName(names[0])).toBe('The Placeholders - Paper Lanterns');
    expect(matchMusicVideo(names, { title: 'Paper Lanterns - 2011 Remaster', artists: ['The Placeholders'] })).toBe(names[0]);
    expect(matchMusicVideo(names, { title: 'Night Bus', artists: ['Ann', 'Bo'] })).toBe(names[1]);
    expect(matchMusicVideo(names, { title: 'Home', artists: ['Third'] })).toBe('Home.mp4');
    expect(matchMusicVideo(names, { title: 'Missing', artists: ['Nobody'] })).toBeNull();
    expect(matchMusicVideo(names, { title: '', artists: [] })).toBeNull();
  });
});
