// Test runner for Varsha CRM. Run before every push:
//   NODE_PATH=$(npm root -g) node tests/smoke.js [--strict]      (or: npm i playwright, then node tests/smoke.js)
// Starts its own static server, launches Chromium, runs every tests/unit/*.js and then every tests/checks/*.js
// (all files, sorted by name; adding a module's tests needs no edit here). Exits 1 on any FAIL, or on any SKIP with --strict.
// Each test file: module.exports = async (t) => { t.check(name, ok, extra); ... }  (see the t object below).
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..');
const strict = process.argv.includes('--strict');
const types = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};
const server = http.createServer((req, res) => {
  const rel = req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]);
  const f = path.join(root, rel);
  if (!f.startsWith(root + path.sep) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(f)] || 'text/plain' });
  res.end(fs.readFileSync(f));
});

const istToday = (offset = 0) => new Date(Date.now() + offset * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

let failed = 0, passed = 0, skipped = 0;
const errors = [];            // console errors and page errors from every page opened with t.fresh()
const check = (name, ok, extra = '') => {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  ' + extra));
  if (ok) passed++; else failed++;
};
const skip = (name, why = '') => { console.log('SKIP ' + name + (why ? '  (' + why + ')' : '')); skipped++; };

const listFiles = dir => fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.js')).sort().map(f => path.join(dir, f)) : [];

(async () => {
  await new Promise(r => server.listen(0, r));
  const url = 'http://localhost:' + server.address().port + '/';
  const browser = await chromium.launch();
  const data = JSON.parse(fs.readFileSync(path.join(root, 'customers.json'), 'utf8'));
  let contexts = [];

  const t = {
    browser, url, root, data, check, skip, fs, path, errors, istToday,
    // fresh browser context + page. opts: { viewport, init (function or string init script), blockStorage, trackErrors (default true) }
    async fresh(opts = {}) {
      const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1280, height: 900 }, acceptDownloads: true });
      contexts.push(ctx);
      if (opts.blockStorage) await ctx.addInitScript(() => { Storage.prototype.setItem = function () { throw new Error('blocked'); }; });
      if (opts.init) await ctx.addInitScript(opts.init, opts.initArg);
      const page = await ctx.newPage();
      if (opts.trackErrors !== false) {
        page.on('pageerror', e => errors.push(String(e)));
        page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
      }
      return { ctx, page };
    },
    // load the app and wait until it has booted and drawn the active tab
    async open(page, query = '') {
      await page.goto(url + query);
      await page.waitForSelector('body[data-ready="1"]', { state: 'attached' });
    },
    async tab(page, id) {
      await page.click('#tab-' + id);
      await page.waitForSelector('#panel-' + id + ':not([hidden])');
    },
    async reload(page) {
      await page.reload();
      await page.waitForSelector('body[data-ready="1"]', { state: 'attached' });
    },
    row: (page, name) => page.locator('#rows tr', { hasText: name }),
    rows: page => page.locator('#rows tr:visible').count(),
    csvFile: (name, text) => ({ name, mimeType: 'text/csv', buffer: Buffer.from(text, 'utf8') }),
    async download(page, clickSelector) {
      const [dl] = await Promise.all([page.waitForEvent('download'), page.click(clickSelector)]);
      return { name: dl.suggestedFilename(), text: fs.readFileSync(await dl.path(), 'utf8') };
    },
    // e.g. t.has(page, "window.CrmRfq"). Runs as a string (the page CSP forbids eval inside the page).
    has: (page, expr) => page.evaluate('(function(){try{return !!(' + expr + ')}catch(e){return false}})()')
  };

  const files = [...listFiles(path.join(__dirname, 'unit')), ...listFiles(path.join(__dirname, 'checks'))];
  for (const f of files) {
    console.log('\n# ' + path.relative(root, f));
    try { await require(f)(t); }
    catch (e) { check(path.basename(f) + ' ran without crashing', false, e && e.stack ? e.stack : String(e)); }
    for (const c of contexts) { try { await c.close(); } catch (e) { /* already closed */ } }
    contexts = [];
  }

  await browser.close(); server.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed, ' + skipped + ' skipped' + (strict ? ' (strict)' : ''));
  const bad = failed > 0 || (strict && skipped > 0);
  console.log(bad ? (failed ? failed + ' check(s) FAILED' : 'SKIPPED checks are not allowed with --strict') : 'All checks passed');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
