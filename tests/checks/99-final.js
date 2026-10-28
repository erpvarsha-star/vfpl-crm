// A1 final checks: runs last. Safety rules, blocked storage, and no console errors anywhere.
module.exports = async (t) => {
  const { check, fs, path, root } = t;

  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
  const jsFiles = walk(path.join(root, 'js')).filter(f => f.endsWith('.js'));
  const offenders = jsFiles.filter(f => /innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(fs.readFileSync(f, 'utf8'))).map(f => path.relative(root, f));
  check('no innerHTML in any js file', jsFiles.length >= 14 && offenders.length === 0, offenders.join());

  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  check('CSP meta present', /<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https:\/\/script\.google\.com https:\/\/script\.googleusercontent\.com; base-uri 'none'; form-action 'self'; object-src 'none'">/.test(html));
  check('no inline script in index.html', !/<script(?![^>]*\bsrc=)[^>]*>/.test(html));
  const gi = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  check('.gitignore ignores csv files, data-private and node_modules', /^\*\.csv$/m.test(gi) && /^data-private\/$/m.test(gi) && /^node_modules\/?$/m.test(gi));

  const b = await t.fresh({ blockStorage: true });
  await t.open(b.page);
  await t.tab(b.page, 'list');
  check('blocked storage shows a warning', await b.page.locator('#storageWarn').isVisible());
  await b.page.locator('#rows tr', { hasText: 'ZF STEERING' }).locator('select.st').selectOption('At risk');
  check('blocked storage still lets the page work in memory', (await b.page.locator('#rows tr', { hasText: 'ZF STEERING' }).locator('select.st').inputValue()) === 'At risk');

  const ok = await t.fresh();
  await t.open(ok.page);
  check('storage warning is hidden when storage works', await ok.page.locator('#storageWarn').isHidden());

  check('no console errors', t.errors.length === 0, JSON.stringify(t.errors));
};
