// Opt-in build of the Ableton Link add-on (native/link).
//
//   npm run link:build
//
// Fetches the official Ableton Link SDK (GPLv2+, or a proprietary licence from
// Ableton: link-devs@ableton.com) into native/link/vendor and compiles a small
// Node-API module with node-gyp. Needs git and a C++ toolchain:
//   Windows: "Desktop development with C++" from Visual Studio Build Tools + Python 3
//   macOS:   Xcode command line tools        Linux: g++, make, python3
// BOOFVIZ runs fine without it; Link just shows as unavailable.
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const LINK_TAG = 'Link-3.1.3';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'native', 'link');
const vendor = join(dir, 'vendor', 'link');
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });

if (!existsSync(join(vendor, 'include', 'ableton', 'Link.hpp'))) {
  console.log(`Fetching Ableton Link SDK ${LINK_TAG}…`);
  rmSync(vendor, { recursive: true, force: true });
  run('git', ['clone', '--depth', '1', '--branch', LINK_TAG, 'https://github.com/Ableton/link.git', vendor], root);
  run('git', ['submodule', 'update', '--init', '--depth', '1', 'modules/asio-standalone'], vendor);
}

const require = createRequire(import.meta.url);
const gyp = join(dirname(require.resolve('node-gyp/package.json')), 'bin', 'node-gyp.js');
// Node-API is ABI-stable, so a module built against Node runs inside Electron unchanged.
run(process.execPath, [gyp, 'rebuild'], dir);
console.log('\nAbleton Link add-on built: native/link/build/Release/boofviz_link.node');
