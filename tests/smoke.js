// Smoke test for Varsha CRM. Run before every push:
//   NODE_PATH=$(npm root -g) node tests/smoke.js      (or: npm i playwright, then node tests/smoke.js)
// Starts its own static server, drives the page in Chromium, exits 1 on any failure.
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..');
const types = { '.html': 'text/html', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const f = path.join(root, req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]));
  if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(f)] || 'text/plain' });
  res.end(fs.readFileSync(f));
});

const istToday = (offset = 0) => {
  const d = new Date(Date.now() + offset * 86400000);
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
};

let failed = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  ' + extra)); if (!ok) failed++; };

(async () => {
  await new Promise(r => server.listen(0, r));
  const url = 'http://localhost:' + server.address().port + '/';
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  const rows = () => page.locator('#rows tr').count();
  const reload = async () => { await page.reload(); await page.waitForSelector('#rows tr'); };
  const row = name => page.locator('#rows tr', { hasText: name });

  await page.goto(url); await page.waitForSelector('#rows tr');
  check('loads all 42 customers from customers.json', (await rows()) === 42, String(await rows()));
  check('nothing unsaved on a clean load', await page.locator('#unsaved').isHidden());

  // follow-up date in the past -> red, counted, filterable, survives refresh
  await row('ZF STEERING').locator('.fu input').fill(istToday(-3));
  check('past follow-up shows "Overdue by 3 days"', (await row('ZF STEERING').locator('.rel').innerText()) === 'Overdue by 3 days');
  const red = await row('ZF STEERING').locator('.rel').evaluate(el => getComputedStyle(el).color);
  check('overdue text is red', red === 'rgb(180, 35, 24)', red);
  check('overdue row is flagged', (await row('ZF STEERING').getAttribute('class')) === 'overdue');
  check('Overdue chip counts 1', (await page.locator('#v-overdue').innerText()) === '1');
  await reload();
  check('follow-up date survives a refresh', (await row('ZF STEERING').locator('.fu input').inputValue()) === istToday(-3));
  check('overdue row sorts to the top', (await page.locator('#rows tr').first().innerText()).includes('ZF STEERING'));

  // today and future
  await row('NEEL METAL').locator('.fu input').fill(istToday(0));
  check('today shows "Due today"', (await row('NEEL METAL').locator('.rel').innerText()) === 'Due today');
  await row('NR INDUSTRIES').locator('.fu input').fill(istToday(5));
  check('future shows "In 5 days"', (await row('NR INDUSTRIES').locator('.rel').innerText()) === 'In 5 days');
  check('future date is not red', (await row('NR INDUSTRIES').getAttribute('class')) !== 'overdue');
  check('counts: 1 overdue, 1 today, 1 next-7', (await page.locator('#v-overdue').innerText()) === '1' && (await page.locator('#v-today').innerText()) === '1' && (await page.locator('#v-week').innerText()) === '1');

  // filters survive a refresh
  await page.click('.chip[data-v="overdue"]');
  check('Overdue filter shows 1 row', (await rows()) === 1);
  await reload();
  check('filter choice survives a refresh', (await rows()) === 1 && (await page.locator('.chip[data-v="overdue"]').getAttribute('aria-pressed')) === 'true');
  await page.click('.chip[data-v="all"]');
  await page.fill('#q', 'zf');
  await reload();
  check('search text survives a refresh', (await page.inputValue('#q')) === 'zf' && (await rows()) === 1);
  await page.fill('#q', '');

  // status by hand survives a refresh
  await row('ZF STEERING').locator('select.st').selectOption('At risk');
  await reload();
  check('status survives a refresh', (await row('ZF STEERING').locator('select.st').inputValue()) === 'At risk');

  // clear a follow-up date
  await row('NR INDUSTRIES').locator('.clr').click();
  await reload();
  check('cleared follow-up stays cleared after refresh', (await row('NR INDUSTRIES').locator('.fu input').inputValue()) === '');

  // add a customer with a follow-up date
  await page.click('#openForm');
  await page.fill('input[name=name]', 'Test Forge Co');
  await page.fill('input[name=contact]', 'Rahul Patil');
  await page.fill('input[name=phone]', '9876543210');
  await page.fill('input[name=city]', 'Pune');
  await page.fill('input[name=followUp]', istToday(-1));
  await page.selectOption('select[name=status]', 'Follow up');
  await page.click('button[type=submit]');
  await reload();
  check('added customer survives a refresh', (await rows()) === 43);
  check('added customer keeps its overdue follow-up', (await row('Test Forge Co').locator('.rel').innerText()) === 'Overdue by 1 day');
  await page.click('#openForm');
  await page.fill('input[name=name]', 'test forge co');
  page.once('dialog', d => d.accept());
  await page.click('button[type=submit]');
  await page.click('#cancel');
  check('duplicate name is refused', (await rows()) === 43);

  // export carries everything
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#export')]);
  const out = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  const by = n => out.customers.find(c => c.name.startsWith(n));
  check('export has 43 customers', out.customers.length === 43);
  check('export keeps follow-up dates', by('ZF STEERING').followUp === istToday(-3) && by('Test Forge').followUp === istToday(-1));
  check('export keeps statuses', by('ZF STEERING').status === 'At risk' && by('Test Forge').status === 'Follow up');
  const keys = new Set(out.customers.flatMap(c => Object.keys(c)));
  check('export has only the expected fields (no email or GST)', [...keys].sort().join() === 'city,contact,contactFrom,disputed,followUp,last,name,phone,state,status', [...keys].join());

  // phone layout
  await page.setViewportSize({ width: 375, height: 760 });
  check('no sideways scroll on a phone', (await page.evaluate(() => document.documentElement.scrollWidth)) === 375);

  // blocked storage warns instead of failing silently
  const blocked = await browser.newContext();
  await blocked.addInitScript(() => { Storage.prototype.setItem = function () { throw new Error('blocked'); }; });
  const bp = await blocked.newPage();
  await bp.goto(url); await bp.waitForSelector('#rows tr');
  check('blocked storage shows a warning', await bp.locator('#storageWarn').isVisible());

  check('no console errors', errors.length === 0, JSON.stringify(errors));
  await browser.close(); server.close();
  console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
