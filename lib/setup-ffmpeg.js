/**
 * `npm run setup:ffmpeg`
 *
 * Checks whether ffmpeg/ffprobe can be found, and if not, fetches a private
 * copy for this repo via the ffmpeg-static / ffprobe-static packages (which
 * ship prebuilt binaries for Windows, macOS and Linux on x64 and arm64).
 *
 * Safe to run any time - it reports what it found and changes nothing when
 * everything already works.
 */

const path = require('path');
const { spawnSync } = require('child_process');

const { REPO_ROOT, resolveFfmpeg, resolveFfprobe, describe, installHelp } = require('./ffmpeg');

const STATIC_PACKAGES = ['ffmpeg-static', 'ffprobe-static'];

/**
 * Re-check in a fresh process: this one has already cached its lookups and
 * its require() cache, so an in-process re-check would report stale results.
 */
function checkInFreshProcess() {
  const script =
    "const f=require(process.argv[1]);" +
    "const m=f.resolveFfmpeg(),p=f.resolveFfprobe();" +
    "console.log(JSON.stringify({ffmpeg:m&&f.describe(m),ffprobe:p&&f.describe(p)}));";
  const result = spawnSync(process.execPath, ['-e', script, path.join(__dirname, 'ffmpeg.js')], {
    encoding: 'utf8',
    windowsHide: true,
  });
  try {
    return JSON.parse(result.stdout.trim());
  } catch {
    return { ffmpeg: null, ffprobe: null };
  }
}

function report(label, description) {
  console.log(`  ${label.padEnd(8)} ${description || 'not found'}`);
}

function main() {
  console.log(`Platform: ${process.platform} ${process.arch} (node ${process.versions.node})\n`);

  const ffmpeg = resolveFfmpeg();
  const ffprobe = resolveFfprobe();

  console.log('Looking for ffmpeg...');
  report('ffmpeg', ffmpeg && describe(ffmpeg));
  report('ffprobe', ffprobe && describe(ffprobe));
  console.log('');

  if (ffmpeg && ffprobe) {
    console.log('All set - every video and audio tool in this repo will use these.');
    return 0;
  }

  console.log(`Fetching prebuilt binaries for ${process.platform}/${process.arch}...`);
  console.log(`  npm install --include=optional ${STATIC_PACKAGES.join(' ')}\n`);

  const isWindows = process.platform === 'win32';
  const install = spawnSync(
    isWindows ? 'npm.cmd' : 'npm',
    ['install', '--include=optional', '--no-audit', '--no-fund', ...STATIC_PACKAGES],
    {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      windowsHide: true,
      // npm is a .cmd shim on Windows, and since Node 18.20/20.12 those cannot
      // be spawned without a shell (they fail with EINVAL).
      shell: isWindows,
    }
  );

  if (install.error || install.status !== 0) {
    const reason = install.error ? install.error.message : `npm exited with code ${install.status}`;
    console.error(`\nThe download failed: ${reason}`);
    console.error('(offline, proxy, or a blocked registry?)');
    console.error('');
    console.error(installHelp());
    return 1;
  }

  const after = checkInFreshProcess();
  console.log('');
  report('ffmpeg', after.ffmpeg);
  report('ffprobe', after.ffprobe);
  console.log('');

  if (after.ffmpeg) {
    if (!after.ffprobe) {
      console.log('ffmpeg is ready. ffprobe is still missing - only tools that read');
      console.log('media metadata need it, so most things will work regardless.');
    } else {
      console.log('Done - every video and audio tool in this repo will use these.');
    }
    return 0;
  }

  console.error('Still no working ffmpeg after installing.');
  console.error('');
  console.error(installHelp());
  return 1;
}

process.exitCode = main();
