// Automation (rules) checks: toggle, edit, add, delete, run, idempotence, refresh, 375px.
module.exports = async (t) => {
  const { check, istToday } = t;
  const { page } = await t.fresh({ viewport: { width: 375, height: 800 } });
  await t.open(page);
  const ev = (fn, arg) => page.evaluate(fn, arg);
  await ev(async () => { await Store.setFollowUp(Store.customers()[0].id, ''); });
  const past = istToday(-10);
  const cid = await ev(async (d) => { const c = Store.customers()[0]; await Store.setFollowUp(c.id, d); return c.id; }, past);
  await t.tab(page, 'rules');

  const rules0 = await ev(() => CrmRules.list());
  check('five default rules, all enabled', rules0.length === 5 && rules0.every(r => r.enabled && r.action === 'task'), JSON.stringify(rules0.length));
  check('rules list renders', (await page.locator('#rlList .rl-item').count()) === 5);

  // Run now creates the overdue follow-up task with the contract shape
  await page.click('#rlRun');
  const tasks1 = await ev((id) => Store.col('tasks').all().filter(x => x.customerId === id && x.ruleId === 'r-fu'), cid);
  const tk = tasks1[0] || {};
  check('Run now creates a task from the overdue follow-up rule', tasks1.length === 1 && tk.source === 'rule' && tk.done === false && tk.due === istToday(0) && tk.rfqId === '' && tk.leadId === '' && !!tk.createdAt && /Overdue|overdue/.test(tk.note), JSON.stringify(tk));
  check('log says Created N tasks', /^Created \d+ tasks?$/.test(await page.textContent('#rlSummary')));

  // Idempotent
  const before = await ev(() => Store.col('tasks').all().length);
  await page.click('#rlRun'); await page.click('#rlRun');
  const after = await ev(() => Store.col('tasks').all().length);
  check('running again creates no duplicates', before === after && /Created 0 tasks/.test(await page.textContent('#rlSummary')), before + ' vs ' + after);

  // Done task is closed; open tasks only are deduped
  // Disable the rule: no new task for a different overdue customer
  const cid2 = await ev(async (d) => { const c = Store.customers()[1]; await Store.setFollowUp(c.id, d); return c.id; }, past);
  await page.locator('#rlList .rl-item[data-id="r-fu"] .rl-toggle').uncheck();
  await page.click('#rlRun');
  check('disabled rule creates nothing', (await ev((id) => Store.col('tasks').all().filter(x => x.customerId === id && x.ruleId === 'r-fu').length, cid2)) === 0);
  await page.locator('#rlList .rl-item[data-id="r-fu"] .rl-toggle').check();
  await page.click('#rlRun');
  check('re-enabled rule creates the task', (await ev((id) => Store.col('tasks').all().filter(x => x.customerId === id && x.ruleId === 'r-fu').length, cid2)) === 1);

  // Edit
  await page.click('#rlList .rl-item[data-id="r-fu"] .rl-edit');
  await page.fill('#rlName', 'Renamed rule'); await page.fill('#rlDays', '5');
  await page.click('#rlSave');
  const edited = await ev(() => CrmRules.list().find(r => r.id === 'r-fu'));
  check('edit saves name and days', edited.name === 'Renamed rule' && edited.days === 5, JSON.stringify(edited));

  // Validation
  await page.click('#rlAdd'); await page.fill('#rlName', ''); await page.click('#rlSave');
  check('empty name is refused', /name/i.test(await page.textContent('#rlErr')));
  await page.fill('#rlName', 'My rule'); await page.selectOption('#rlTrigger', 'no-contact'); await page.fill('#rlDays', '30');
  await page.click('#rlSave');
  const added = await ev(() => CrmRules.list().find(r => r.name === 'My rule'));
  check('add rule saves', !!added && added.trigger === 'no-contact' && added.days === 30 && added.enabled === true, JSON.stringify(added));

  // Delete
  await page.click('#rlList .rl-item[data-id="r-lead"] .rl-del');
  check('delete removes the rule', !(await ev(() => CrmRules.list().some(r => r.id === 'r-lead'))));

  // Refresh keeps everything
  await page.evaluate(() => App.flush());
  await t.reload(page);
  const rules2 = await ev(() => CrmRules.list());
  check('refresh keeps edits, new rule, delete and toggle', rules2.length === 5 && rules2.some(r => r.name === 'Renamed rule' && r.days === 5) && rules2.some(r => r.name === 'My rule') && !rules2.some(r => r.id === 'r-lead'), JSON.stringify(rules2.map(r => r.id)));
  const n1 = await ev(() => Store.col('tasks').all().length);
  await t.tab(page, 'rules');
  check('refresh then tab show creates no duplicate tasks', (await ev(() => Store.col('tasks').all().length)) === n1);
  check('last run log survives refresh', /^Created \d+ tasks?$/.test(await page.textContent('#rlSummary')));

  // Other triggers
  const today = istToday(0);
  await ev(async (d) => {
    await Store.col('rfqs').insert({ id: 'rfq-test-q', rfq_no: 'RQ1', part_name: 'Test part', stage: 'Quoted', stage_at: d.old, lost: false, customer_id: null });
    await Store.col('leads').insert({ id: 'lead-test', company: 'Test Lead Co', status: 'Open', created_at: new Date(Date.now() - 10 * 864e5).toISOString() });
  }, { old: istToday(-20) });
  await page.click('#rlRun');
  const trig = await ev(() => Store.col('tasks').all().filter(x => x.rfqId === 'rfq-test-q' || x.leadId === 'lead-test').map(x => x.ruleId).sort());
  check('rfq and lead rules create tasks (stuck, quoted, lead deleted)', trig.join() === 'r-q,r-stuck', trig.join());
  void today;
  check('no sideways scroll at 375px', await ev(() => document.documentElement.scrollWidth <= innerWidth));
};
