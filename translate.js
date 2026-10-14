const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const readline = require('readline');

// ===== Settings =====
const CHROME_PATH = 'C:\\Chrome-bin\\chrome.exe';
const SITE_URL = 'https://tools.newzone.top/en/subtitle-translator';
const SUB_EN = path.join(__dirname, 'sub_en');
const SUB_FA = path.join(__dirname, 'sub_fa');
const PROFILE = path.join(__dirname, 'chrome-profile');
const EXT = /\.(srt|vtt|ass|ssa|sub)$/i;
const TRANSLATE_TIMEOUT = 10 * 60 * 1000;   // 10 min per file
const DOWNLOAD_TIMEOUT = 2 * 60 * 1000;     // 2 min for file to appear

// ===== Helpers =====
function waitEnter(msg) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(msg, () => { rl.close(); resolve(); }));
}

// Check if translation for a given base+ext already exists in sub_fa
function translationExists(baseName, ext) {
  if (!fs.existsSync(SUB_FA)) return false;

  const target = `${baseName}_fa${ext}`.toLowerCase();
  const items = fs.readdirSync(SUB_FA);

  // Escape baseName for safe regex
  const escapedBase = baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedExt = ext.replace('.', '\\.');
  const dupRegex = new RegExp(
    `^${escapedBase}_fa\\s*\\(\\d+\\)${escapedExt}$`,
    'i'
  );

  for (const f of items) {
    const lower = f.toLowerCase();

    // Exact match: 1_fa.vtt
    if (lower === target) {
      try {
        const size = fs.statSync(path.join(SUB_FA, f)).size;
        if (size > 100) return true;   // ignore tiny/incomplete files
      } catch {}
    }

    // Chrome duplicate pattern: 1_fa (1).vtt
    if (dupRegex.test(f)) return true;
  }
  return false;
}

// Find Translate button
async function findTranslateButton(page) {
  let btn = page.getByRole('button', { name: /^\s*translate\s*$/i }).first();
  if (await btn.count() > 0) return btn;
  btn = page.locator('button:has-text("Translate")').first();
  if (await btn.count() > 0) return btn;
  btn = page.locator('button.ant-btn-primary').first();
  if (await btn.count() > 0) return btn;
  throw new Error('Translate button not found');
}

// Find Export button
async function findExportButton(page) {
  let btn = page.getByRole('button', { name: /^\s*export\s*$/i }).first();
  if (await btn.count() > 0) return btn;
  btn = page.locator('button:has-text("Export"), span:has-text("Export"), a:has-text("Export")').first();
  if (await btn.count() > 0) return btn;
  btn = page.getByText(/^\s*export\s*$/i).first();
  if (await btn.count() > 0) return btn;
  throw new Error('Export button not found');
}

// Click "Clear all"
async function clickClearAll(page) {
  try {
    const btn = page.locator('span:has-text("Clear all"), button:has-text("Clear all")').first();
    if (await btn.count() > 0 && await btn.isVisible({ timeout: 2000 })) {
      await btn.click();
      console.log('  [CLEAR] "Clear all" clicked');
      return true;
    }
  } catch {}
  try {
    const btn = page.getByText(/^\s*Clear all\s*$/i).first();
    if (await btn.count() > 0 && await btn.isVisible({ timeout: 2000 })) {
      await btn.click();
      console.log('  [CLEAR] "Clear all" clicked');
      return true;
    }
  } catch {}
  console.log('  [CLEAR] "Clear all" not found (skipped)');
  return false;
}

// Silent download via CDP (no save dialog)
async function enableSilentDownload(context, page, downloadPath) {
  try {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Browser.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: downloadPath,
      eventsEnabled: true,
    });
    console.log('[INFO] Silent download enabled ->', downloadPath);
  } catch (err) {
    console.log('[WARN] CDP silent download failed:', err.message);
  }
}

// Wait for translation 100%
async function waitForTranslationComplete(page, timeout) {
  const start = Date.now();
  const doneSelectors = [
    'text=/Translation complete/i',
    'text=/DONE\\s+100%/i',
    'text=/100%/',
  ];
  while (Date.now() - start < timeout) {
    for (const sel of doneSelectors) {
      try {
        const el = page.locator(sel).first();
        if (await el.count() > 0 && await el.isVisible({ timeout: 500 })) {
          return true;
        }
      } catch {}
    }
    await page.waitForTimeout(1500);
  }
  throw new Error('Translation did not complete within timeout');
}

// Wait for a NEW file to appear in dir (returns filename), ignoring .crdownload
async function waitForNewFile(dir, beforeSet, timeoutMs) {
  const start = Date.now();
  let candidate = null;
  let lastSize = -1;
  let stableTicks = 0;

  while (Date.now() - start < timeoutMs) {
    const now = fs.readdirSync(dir);
    for (const f of now) {
      if (beforeSet.has(f)) continue;
      if (f.endsWith('.crdownload') || f.endsWith('.tmp') || f.startsWith('.')) continue;
      if (candidate === null) {
        candidate = f;
        console.log(`  [FS] New file appeared: ${f}`);
      }
    }
    if (candidate) {
      try {
        const size = fs.statSync(path.join(dir, candidate)).size;
        if (size === lastSize && size > 0) {
          stableTicks++;
          if (stableTicks >= 2) return candidate;
        } else {
          stableTicks = 0;
          lastSize = size;
        }
      } catch {}
    }
    await new Promise((r) => setTimeout(r, 600));
  }
  throw new Error('No new file appeared in download folder within timeout');
}

// ===== Main =====
(async () => {
  // Pre-checks
  if (!fs.existsSync(CHROME_PATH)) {
    console.error('[ERROR] Chrome not found:', CHROME_PATH);
    process.exit(1);
  }
  if (!fs.existsSync(SUB_FA)) fs.mkdirSync(SUB_FA, { recursive: true });
  if (!fs.existsSync(SUB_EN)) {
    console.error('[ERROR] Input folder not found:', SUB_EN);
    process.exit(1);
  }

  const files = fs.readdirSync(SUB_EN).filter((f) => EXT.test(f));
  if (files.length === 0) {
    console.log('[WARN] No subtitle files found in sub_en');
    process.exit(0);
  }

  console.log(`[INFO] Found ${files.length} file(s) in sub_en`);

  // Pre-scan: report which files will be skipped
  console.log('[INFO] Pre-scanning sub_fa for existing translations...');
  let alreadyDone = 0;
  for (const f of files) {
    const ext = path.extname(f);
    const base = path.basename(f, ext);
    if (translationExists(base, ext)) alreadyDone++;
  }
  console.log(`[INFO] ${alreadyDone} file(s) already translated, ${files.length - alreadyDone} to process\n`);

  if (alreadyDone === files.length) {
    console.log('[INFO] All files already translated. Nothing to do.');
    process.exit(0);
  }

  // Launch Chrome
  console.log('[INFO] Launching Chrome...');
  const context = await chromium.launchPersistentContext(PROFILE, {
    executablePath: CHROME_PATH,
    headless: false,
    acceptDownloads: true,
    slowMo: 60,
  });

  const page = context.pages()[0] || (await context.newPage());

  // Enable silent download
  await enableSilentDownload(context, page, SUB_FA);

  console.log('[INFO] Opening website...');
  await page.goto(SITE_URL, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);

  // Pause for manual setup
  console.log('\n===========================================================');
  console.log('  [PAUSED] Configure settings in the Chrome window:');
  console.log('     - Target language: Persian');
  console.log('     - Translation API: Free API GTX (or your choice)');
  console.log('     - Any other options you need');
  console.log('');
  console.log('  [WARNING] Do NOT upload any file manually.');
  console.log('');
  console.log('  [READY] When done, press Enter here in this terminal.');
  console.log('===========================================================');
  await waitEnter('\n>> Press Enter to start batch translation: ');

  // Re-apply silent download after navigation
  await enableSilentDownload(context, page, SUB_FA);

  console.log('\n[INFO] Starting batch processing...\n');

  let successCount = 0;
  let failCount = 0;
  let skipCount = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const ext = path.extname(file);
    const baseName = path.basename(file, ext);
    const outName = `${baseName}_fa${ext}`;
    const outPath = path.join(SUB_FA, outName);
    const fullPath = path.join(SUB_EN, file);

    // Skip if already translated (any variant)
    if (translationExists(baseName, ext)) {
      console.log(`[SKIP] [${i + 1}/${files.length}] Already translated: ${outName}`);
      skipCount++;
      continue;
    }

    console.log(`\n[${i + 1}/${files.length}] ==== ${file} ====`);

    try {
      // 1. Reset file input
      await page.evaluate(() => {
        document.querySelectorAll('input[type="file"]').forEach((el) => {
          el.value = '';
          el.dispatchEvent(new Event('change', { bubbles: true }));
        });
      });

      // 2. Upload file
      const fileInput = page.locator('input[type="file"]').first();
      await fileInput.setInputFiles(fullPath);
      console.log('  [UPLOAD] File uploaded');

      // 3. Click Translate
      const translateBtn = await findTranslateButton(page);
      await translateBtn.waitFor({ state: 'visible', timeout: 15000 });
      try {
        await translateBtn.evaluate((el) => new Promise((resolve) => {
          if (!el.disabled) return resolve();
          const obs = new MutationObserver(() => {
            if (!el.disabled) { obs.disconnect(); resolve(); }
          });
          obs.observe(el, { attributes: true, attributeFilter: ['disabled'] });
          setTimeout(() => { obs.disconnect(); resolve(); }, 5000);
        }));
      } catch {}
      await translateBtn.click();
      console.log('  [CLICK] Translate button clicked');

      // 4. Wait for 100%
      console.log('  [WAIT] Waiting for translation to 100%...');
      await waitForTranslationComplete(page, TRANSLATE_TIMEOUT);
      console.log('  [DONE] Reached 100%');

      // 5. Snapshot folder BEFORE clicking Export
      const beforeSet = new Set(fs.readdirSync(SUB_FA));

      // 6. Click Export
      await page.waitForTimeout(800);
      const exportBtn = await findExportButton(page);
      await exportBtn.waitFor({ state: 'visible', timeout: 20000 });
      await exportBtn.click();
      console.log('  [CLICK] Export button clicked');

      // 7. Wait for new file in sub_fa
      console.log('  [WAIT] Waiting for file in sub_fa...');
      const newFile = await waitForNewFile(SUB_FA, beforeSet, DOWNLOAD_TIMEOUT);
      const newPath = path.join(SUB_FA, newFile);
      console.log(`  [FS] Downloaded: ${newFile}`);

      // 8. Rename if needed
      if (newFile !== outName) {
        if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
        fs.renameSync(newPath, outPath);
        console.log(`  [RENAME] ${newFile} -> ${outName}`);
      } else {
        console.log(`  [NAME] Already correct: ${outName}`);
      }

      // 9. Verify
      if (fs.existsSync(outPath)) {
        const size = fs.statSync(outPath).size;
        console.log(`  [SAVE] Saved: ${outName} (${size} bytes)`);
        successCount++;
      } else {
        throw new Error('File not found after rename');
      }

      // 10. Click "Clear all"
      await page.waitForTimeout(600);
      await clickClearAll(page);
      await page.waitForTimeout(600);

    } catch (err) {
      console.error(`  [ERROR] ${err.message}`);
      failCount++;
      const shot = path.join(SUB_FA, `error_${baseName}_${Date.now()}.png`);
      try {
        await page.screenshot({ path: shot, fullPage: true });
        console.log(`  [SHOT] Screenshot: ${shot}`);
      } catch {}
      try { await clickClearAll(page); } catch {}
    }
  }

  // End
  console.log('\n===========================================================');
  console.log(`  [SUMMARY] Success: ${successCount} | Failed: ${failCount} | Skipped: ${skipCount}`);
  console.log(`  [OUTPUT] Folder: ${SUB_FA}`);
  console.log('  Chrome will stay open. Press Enter to close.');
  console.log('===========================================================');
  await waitEnter('\n>> Press Enter to close Chrome: ');

  await context.close();
  console.log('[INFO] Done.');
})();