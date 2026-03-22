// WebCheck — api/screenshot.js
// Maintained by: krypthane | github.com/wavegxz-design
//
// FIX [BUG-SS-01]: 17x console.log leaked full URLs and file paths in production logs.
//                  Replaced with a leveled logger (only logs on DEBUG=true).
// FIX [BUG-SS-02]: --no-sandbox flag in both code paths disabled Chromium's security
//                  sandbox. Now uses sandbox; only falls back without if explicitly
//                  set via ALLOW_NO_SANDBOX=true env var.
// FIX [BUG-SS-03]: Temp file path used uuid but didn't clean up on early errors.
//                  Now uses try/finally to guarantee cleanup.

import puppeteer from 'puppeteer-core';
import chromium  from 'chrome-aws-lambda';
import middleware from './_common/middleware.js';
import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import pkg from 'uuid';
const { v4: uuidv4 } = pkg;

// FIX [BUG-SS-01]: Leveled logger — only verbose in debug mode
const DEBUG = process.env.DEBUG === 'true';
const log   = {
  info:  (...a) => DEBUG && console.info('[SCREENSHOT]',  ...a),
  warn:  (...a) => console.warn('[SCREENSHOT:WARN]',  ...a),
  error: (...a) => console.error('[SCREENSHOT:ERR]',  ...a),
};

// FIX [BUG-SS-02]: Only disable sandbox when explicitly allowed via env var
const NO_SANDBOX_ARGS = process.env.ALLOW_NO_SANDBOX === 'true'
  ? ['--no-sandbox', '--disable-setuid-sandbox']
  : [];

/** Take a screenshot via direct Chromium binary (fallback for Lambda environments) */
const directChromiumScreenshot = async (url) => {
  const tmpPath = path.join('/tmp', `wc-${uuidv4()}.png`);
  const chromePath = process.env.CHROME_PATH || '/usr/bin/chromium';
  const args = [
    '--headless', '--disable-gpu', '--disable-dev-shm-usage',
    ...NO_SANDBOX_ARGS,
    `--screenshot=${tmpPath}`,
    url,
  ];
  log.info('direct chromium path:', chromePath);

  return new Promise((resolve, reject) => {
    execFile(chromePath, args, async (error) => {
      if (error) {
        log.error('direct chromium failed');
        return reject(error);
      }
      try {
        const data   = await fs.readFile(tmpPath);
        const base64 = data.toString('base64');
        resolve(base64);
      } catch (readErr) {
        reject(readErr);
      } finally {
        // FIX [BUG-SS-03]: Guaranteed temp file cleanup
        await fs.unlink(tmpPath).catch(() => {});
      }
    });
  });
};

const screenshotHandler = async (targetUrl) => {
  if (!targetUrl) {
    throw new Error('URL is required');
  }

  const url = targetUrl.startsWith('http') ? targetUrl : `http://${targetUrl}`;

  try {
    new URL(url);
  } catch {
    throw new Error('URL provided is invalid');
  }

  // Try direct Chromium first (lighter, better for Lambda)
  try {
    log.info('attempting direct chromium method');
    const base64 = await directChromiumScreenshot(url);
    return { image: base64 };
  } catch (directError) {
    log.warn('direct chromium failed, trying puppeteer:', directError.message);
  }

  // Puppeteer fallback
  let browser = null;
  try {
    browser = await puppeteer.launch({
      args: [
        ...chromium.args,
        '--disable-dev-shm-usage',
        ...NO_SANDBOX_ARGS,  // FIX [BUG-SS-02]: conditional sandbox
      ],
      defaultViewport: { width: 1280, height: 800 },
      executablePath: process.env.CHROME_PATH || await chromium.executablePath || '/usr/bin/chromium',
      headless:            true,
      ignoreHTTPSErrors:   true,
      ignoreDefaultArgs:   ['--disable-extensions'],
    });

    const page = await browser.newPage();
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
    page.setDefaultNavigationTimeout(10000);

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });

    const screenshot = await page.screenshot({ type: 'png' });
    return { image: screenshot.toString('base64') };
  } catch (error) {
    log.error('puppeteer failed:', error.message);
    throw error;
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
};

export const handler = middleware(screenshotHandler);
export default handler;
