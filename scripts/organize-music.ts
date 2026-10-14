// Gathers downloaded music into one tidy library: songs as
// Music/BOOFVIZ/Artist/Album/"Artist - Title.mp3", .lrc lyrics into BOOFVIZ's
// lyrics folder and music videos into its videos folder, both named
// "Artist - Title" so BOOFVIZ finds them for the playing song. Shows the plan
// first; nothing is copied or moved until you say yes.
//   npm run music:organize                          (Desktop and Downloads)
//   npm run music:organize -- "D:\Old music" --move
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { applyPlan, findFiles, planLibrary, type Kind, type Move, type Places, type Source } from './musicLibrary';

const HELP = `Organize your downloaded music for BOOFVIZ

  npm run music:organize                       look through your Desktop and Downloads
  npm run music:organize -- "<folder>" ...     look through these folders instead

  --to="<folder>"   where the library goes (default: your Music folder\\BOOFVIZ)
  --move            move the files instead of copying them
  --yes             don't ask before copying or moving

It shows what it found and where each file would go, then asks before
changing anything. Copying leaves your originals where they are, and no
file is ever overwritten. Songs go to <library>\\Artist\\Album\\"Artist - Title.mp3";
lyrics (.lrc) and music videos go to BOOFVIZ's own lyrics and videos folders.`;

const argv = process.argv.slice(2);
const flag = (name: string): boolean => argv.includes(name);
if (flag('--help') || flag('-h')) {
  console.log(HELP);
  process.exit(0);
}
const toAt = argv.indexOf('--to');
const folders = argv.filter((a, i) => !a.startsWith('--') && !(toAt >= 0 && i === toAt + 1));
// PowerShell can swallow npm's "--"; npm then passes the options on as npm_config_* variables
// ("--to <folder>" arrives as to=true, "--to=<folder>" whole).
const envTo = process.env.npm_config_to;
const to = toAt >= 0 ? argv[toAt + 1] : (argv.find((a) => a.startsWith('--to='))?.slice(5) ?? (envTo !== 'true' ? envTo : undefined));
const move = flag('--move') || process.env.npm_config_move === 'true';
const unknown = argv.filter((a) => a.startsWith('--') && !['--to', '--move', '--yes'].includes(a) && !a.startsWith('--to='));
if (unknown.length || (toAt >= 0 && !to) || (envTo === 'true' && !to)) {
  console.error(unknown.length ? `Unknown option ${unknown.join(', ')}\n` : 'Give the library folder as --to="<folder>"\n');
  console.log(HELP);
  process.exit(1);
}

/** The Desktop (OneDrive's too) and Music folders, wherever Windows keeps them. */
function knownFolders(): { desktop: string[]; music: string } {
  const home = homedir();
  const desktop = [join(home, 'Desktop'), join(home, 'OneDrive', 'Desktop')];
  let music = join(home, 'Music');
  if (process.platform === 'win32') {
    try {
      const script = "[Console]::OutputEncoding = [Text.Encoding]::UTF8; [Environment]::GetFolderPath('Desktop'); [Environment]::GetFolderPath('MyMusic')";
      const [d, m] = execFileSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8', timeout: 20000 }).split(/\r?\n/).map((s) => s.trim());
      if (d) desktop.unshift(d);
      if (m && existsSync(m)) music = m;
    } catch {
      // The usual places, then.
    }
  }
  const seen = new Set<string>();
  return { desktop: desktop.filter((d) => existsSync(d) && !seen.has(d.toLowerCase()) && !!seen.add(d.toLowerCase())), music };
}

/** BOOFVIZ's data folder, as Electron's app.getPath('appData') + "BOOFVIZ" (src/main/settingsStore.ts). */
function boofvizData(): string {
  const home = homedir();
  if (process.platform === 'win32') return join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), 'BOOFVIZ');
  if (process.platform === 'darwin') return join(home, 'Library', 'Application Support', 'BOOFVIZ');
  return join(process.env.XDG_CONFIG_HOME || join(home, '.config'), 'BOOFVIZ');
}

const home = homedir();
const show = (p: string): string => (p.startsWith(home + sep) ? relative(home, p) : p);
const known = knownFolders();
const data = boofvizData();
const places: Places = {
  library: resolve(to || join(known.music, 'BOOFVIZ')),
  lyrics: join(data, 'lyrics'),
  videos: join(data, 'videos'),
};
const sources: Source[] = folders.length ? folders.map((f) => ({ path: resolve(f) })) : [...known.desktop.map((d) => ({ path: d, loose: true })), { path: join(home, 'Downloads'), loose: true }];
for (const s of sources) if (folders.length && !existsSync(s.path)) console.log(`Can't find ${s.path}`);
const looking = sources.filter((s) => existsSync(s.path));
if (!looking.length) process.exit(1);

console.log(`\nLooking through ${looking.map((s) => show(s.path)).join(', ')}${folders.length ? '' : ' (folders with songs in them)'}`);
const found = findFiles(looking, [places.library, data]);
const progress = (verb: string) => (done: number, total: number): void => {
  if (process.stdout.isTTY) process.stdout.write(`\r${verb} ${done} of ${total} files…${done === total ? '\n' : ''}`);
};
const plan = await planLibrary(found, places, found.length > 200 ? progress('Reading') : undefined);

const SECTIONS: Array<[Kind[], string, string]> = [
  [['song', 'art'], 'Songs', places.library],
  [['lyrics'], 'Lyrics', places.lyrics],
  [['video'], 'Music videos', places.videos],
];
for (const [kinds, title, root] of SECTIONS) {
  const moves = plan.moves.filter((m) => kinds.includes(m.kind));
  if (!moves.length) continue;
  console.log(`\n${title} → ${root}`);
  const byDir = new Map<string, Move[]>();
  for (const m of moves) byDir.set(dirname(m.to), [...(byDir.get(dirname(m.to)) ?? []), m]);
  for (const [dir, list] of [...byDir].sort(([a], [b]) => a.localeCompare(b))) {
    if (dir !== root) console.log(`  ${relative(root, dir)}${sep}`);
    const indent = dir !== root ? '    ' : '  ';
    for (const m of list) console.log(`${indent}${m.to.slice(dir.length + 1)}   <- ${show(m.from)}`);
  }
}
if (plan.same.length) {
  console.log(`\nAlready there, or the same file twice (skipped): ${plan.same.length}`);
  for (const [from, other] of plan.same.slice(0, 20)) console.log(`  ${show(from)}  =  ${show(other)}`);
  if (plan.same.length > 20) console.log(`  …and ${plan.same.length - 20} more`);
}
if (plan.unplayable.length) {
  console.log(`\nLeft where they are (BOOFVIZ can't play these; convert them to MP3 or FLAC first):`);
  for (const p of plan.unplayable) console.log(`  ${show(p)}`);
}

const count = (k: Kind): number => plan.moves.filter((m) => m.kind === k).length;
const artists = new Set(plan.moves.filter((m) => m.kind === 'song').map((m) => relative(places.library, m.to).split(sep)[0])).size;
const n = (k: number, one: string, many = `${one}s`): string => `${k} ${k === 1 ? one : many}`;
const parts = [`${n(count('song'), 'song')} by ${n(artists, 'artist')}`, count('lyrics') && n(count('lyrics'), 'lyrics file'), count('video') && n(count('video'), 'music video'), count('art') && n(count('art'), 'album cover')].filter(Boolean);
if (!plan.moves.length) {
  console.log(`\nNothing new to organize${found.length ? '' : ': no songs found there'}.`);
  process.exit(0);
}
console.log(`\n${parts.join(', ')}.`);

let go = flag('--yes');
if (!go && process.stdin.isTTY) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(move ? 'Move them into place now? [y/N] ' : 'Copy them into place now? Your originals stay where they are. [y/N] ');
  rl.close();
  go = /^y(es)?$/i.test(answer.trim());
}
if (!go) {
  console.log(process.stdin.isTTY ? 'Nothing changed.' : 'Nothing changed (run it again with --yes to go ahead).');
  process.exit(0);
}

const result = await applyPlan(plan, places, { move, sources: looking.map((s) => s.path), onProgress: progress(move ? 'Moving' : 'Copying') });
console.log(`\n${move ? 'Moved' : 'Copied'} ${result.done} files. The list of what went where is in ${join(places.library, 'organize-log.txt')}.`);
for (const [from, why] of result.failed) console.log(`  Couldn't do ${show(from)}: ${why}`);
console.log(`
Your music:    ${places.library}
  Drop any song on the BOOFVIZ control window (or click Local file and browse there).
Lyrics:        ${places.lyrics}
Music videos:  ${places.videos}
  BOOFVIZ picks these up by name for the song that's playing.`);
if (result.failed.length) process.exitCode = 1;
