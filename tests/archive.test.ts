import { describe, expect, it } from 'vitest';
import { archiveQuery, cacheName, parseLength, pickArchiveFile } from '@shared/archive';

describe('archive footage', () => {
  it('builds queries limited to movies before 2003', () => {
    expect(archiveQuery({ collection: 'ephemeral', search: '', yearFrom: 1950, yearTo: 1970 })).toBe('(collection:prelinger) AND mediatype:movies AND year:[1950 TO 1970]');
    expect(archiveQuery({ collection: 'newsreels', search: 'boxing', yearFrom: 1930, yearTo: 2030 })).toBe('((collection:universal_newsreels) AND (boxing)) AND mediatype:movies AND year:[1930 TO 2002]');
    expect(archiveQuery({ collection: 'custom', search: 'television', yearFrom: 1990, yearTo: 1980 })).toBe('(television) AND mediatype:movies AND year:[1990 TO 1990]');
    expect(archiveQuery({ collection: 'custom', search: '', yearFrom: 0, yearTo: 0 })).toContain('collection:prelinger');
  });

  it('picks the smallest playable MP4 derivative', () => {
    const files = [
      { name: 'film.ogv', format: 'Ogg Video', size: '100' },
      { name: 'film.mp4', format: 'h.264', size: '9000000', length: '600' },
      { name: 'film_512kb.mp4', format: '512Kb MPEG4', size: '3000000', length: '10:00' },
      { name: 'huge.mp4', format: '512Kb MPEG4', size: String(900 * 1024 * 1024) },
    ];
    expect(pickArchiveFile(files)?.name).toBe('film_512kb.mp4');
    expect(pickArchiveFile([{ name: 'a.avi', format: 'Cinepack' }])).toBeNull();
    expect(pickArchiveFile([{ name: 'odd.mp4', format: 'Something', size: 5 }])?.name).toBe('odd.mp4');
  });

  it('parses lengths and makes safe cache names', () => {
    expect(parseLength('312.5')).toBe(312.5);
    expect(parseLength('05:12')).toBe(312);
    expect(parseLength('1:00:00')).toBe(3600);
    expect(parseLength(undefined)).toBe(0);
    const n = cacheName('My Film (1957)', '../sub/dir/film 512kb.mp4');
    expect(n).not.toMatch(/[/\\\s]/);
    expect(n.endsWith('.mp4')).toBe(true);
  });
});
