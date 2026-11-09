// Shared by run.mjs, screens.mjs and check-metrics.mjs: find Playwright (not a dependency of the client) and
// launch headless Chromium with software WebGL allowed (SwiftShader on machines without a GPU).
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);

export function loadPlaywright() {
  try {
    return require('playwright');
  } catch {
    const roots = [process.env.NODE_PATH, execSync('npm root -g').toString().trim()].filter(Boolean);
    for (const r of roots) {
      try {
        return require(resolve(r, 'playwright'));
      } catch {
        /* next */
      }
    }
    throw new Error('playwright not found: npm i -D playwright (or install it globally)');
  }
}

/** Chromium flags that let WebGL2 run on SwiftShader; harmless where a real GPU exists. */
export const CHROMIUM_ARGS = ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'];

export async function launchChromium({ headed = false } = {}) {
  const { chromium } = loadPlaywright();
  return chromium.launch({ headless: !headed, args: CHROMIUM_ARGS });
}

/** Minimal --key value / --key=value parser shared by the harness scripts. */
export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      out[k] = v ?? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true');
    }
  }
  return out;
}
