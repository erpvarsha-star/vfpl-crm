// Unit checks for js/store.js (Node: storage falls back to memory, the seed is passed in).
const Store = require('../../js/store.js');

module.exports = async (t) => {
  const { check, data } = t;
  const fresh = async (seed) => { Store._reset(); await Store.init({ data: seed || data }); return Store.load(); };
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  // slug and name keys
  const slugs = data.customers.map(c => Store.slug(c.name));
  check('slug: all 42 customer names give unique slugs', data.customers.length === 42 && new Set(slugs).size === 42, slugs.join());
  check('slug: example', Store.slug('ZF STEERING GEAR (INDIA) LTD') === 'zf-steering-gear-india-ltd');
  check('slug: related party ids match the design', Store.slug('VARSHA FORGINGS LTD MARKAL') === 'varsha-forgings-ltd-markal' && Store.slug('KCTR VARSHA AUTOMOTIVE PVT. LTD.') === 'kctr-varsha-automotive-pvt-ltd');
  check('slug: numbering when taken', Store.slug('A B', id => id === 'a-b') === 'a-b-2');
  check('slug: empty name', Store.slug('') === 'customer');
  check('nameKey: Laxmi Agni variants are equal',
    Store.nameKey('Laxmi Agni Components & Forging Pvt.Ltd-V') === Store.nameKey('LAXMI AGNI COMPONENTS AND FORGING PRIVATE LIMITED V'));

  // dates
  check('addDays and daysBetween', Store.addDays('2026-10-31', 1) === '2026-11-01' && Store.daysBetween('2026-10-01', '2026-10-11') === 10);
  const c = (followUp) => ({ followUp });
  check('fuKind', Store.fuKind(c(''), '2026-10-19') === 'none' && Store.fuKind(c('2026-10-18'), '2026-10-19') === 'overdue' &&
    Store.fuKind(c('2026-10-19'), '2026-10-19') === 'today' && Store.fuKind(c('2026-10-26'), '2026-10-19') === 'week' && Store.fuKind(c('2026-10-27'), '2026-10-19') === 'later');
  check('fuText', Store.fuText(c('2026-10-16'), '2026-10-19') === 'Overdue by 3 days' && Store.fuText(c('2026-10-18'), '2026-10-19') === 'Overdue by 1 day' &&
    Store.fuText(c('2026-10-19'), '2026-10-19') === 'Due today' && Store.fuText(c('2026-10-20'), '2026-10-19') === 'Tomorrow' && Store.fuText(c('2026-10-24'), '2026-10-19') === 'In 5 days');
  const l = (last) => ({ last });
  check('lastBucket', Store.lastBucket(l(''), '2026-10-19') === 'never' && Store.lastBucket(l('2026-10-01'), '2026-10-19') === '0-30' &&
    Store.lastBucket(l('2026-09-01'), '2026-10-19') === '31-60' && Store.lastBucket(l('2026-08-01'), '2026-10-19') === '61-90' && Store.lastBucket(l('2026-01-01'), '2026-10-19') === '91+');

  // seeding
  const res = await fresh();
  check('load: seeds 42 customers with stable ids', res.ok && Store.customers().length === 42 && Store.get('zf-steering-gear-india-ltd').name === 'ZF STEERING GEAR (INDIA) LTD');
  const all = Store.customers();
  check('seed: group, segment, vehicle segment and plants default to blank', all.every(x => x.group === '' && x.segment === '' && x.vehicleSegment === '' && x.plants.length === 0));
  check('seed: erpGroup comes from the file; Sangkaj Auto joins Sangkaj Industries', Store.get('sangkaj-auto-components-private-limited').erpGroup === 'SANGKAJ INDUSTRIES PVT. LTD.');
  check('seed: only Markal and KCTR are related parties', eq(all.filter(x => x.relatedParty).map(x => x.id).sort(), ['kctr-varsha-automotive-pvt-ltd', 'varsha-forgings-ltd-markal']));
  check('unsavedCount is 0 right after a clean load', Store.unsavedCount() === 0);
  check('matchGroup finds both Sangkaj customers', eq((Store.matchGroup('SANGKAJ INDUSTRIES PVT. LTD.') || []).sort(), ['sangkaj-auto-components-private-limited', 'sangkaj-industries-pvt-ltd']));
  check('matchCustomer: exact, then nameKey, else null', Store.matchCustomer('ZF STEERING GEAR (INDIA) LTD') === 'zf-steering-gear-india-ltd' &&
    Store.matchCustomer('zf steering gear india limited') === 'zf-steering-gear-india-ltd' && Store.matchCustomer('Zeta Imaginary Pvt Ltd') === null);
  await Store.setAliases({ 'Zeta Imaginary Pvt Ltd': 'nr-industries', 'Not Us Ltd': '' });
  check('aliases: remembered match and "not a CRM customer"', Store.matchCustomer('Zeta Imaginary Pvt Ltd') === 'nr-industries' && Store.matchCustomer('Not Us Ltd') === '');

  // validation and writes
  check('validate: unknown segment is refused', Store.validate({ segment: 'Whale' }, {}).ok === false && Store.validate({ segment: 'OEM' }, {}).ok === true);
  check('validate: unknown vehicle segment is refused', Store.validate({ vehicleSegment: 'Boat' }, {}).ok === false);
  check('validate: duplicate name (case-insensitive) is refused with the doc message',
    Store.validate({ name: 'zf steering gear (india) ltd' }, { add: true }).error === 'zf steering gear (india) ltd is already in the list.');
  check('validate: bad phone, long note and empty name', Store.validate({ phone: 'abc' }, {}).ok === false && Store.validate({ name: '  ' }, { add: true }).ok === false);
  let r = await Store.saveCustomer('zf-steering-gear-india-ltd', { segment: 'Whale' });
  check('saveCustomer refuses an unknown segment and changes nothing', !r.ok && Store.get('zf-steering-gear-india-ltd').segment === '');
  r = await Store.saveCustomer('zf-steering-gear-india-ltd', { plants: [{ name: 'Chakan plant', city: 'Chakan', state: 'Maharashtra' }, { name: '', city: 'Hosur', state: 'Tamil Nadu' }] });
  const zf = Store.get('zf-steering-gear-india-ltd');
  check('saving plants sets city and state from the first plant', r.ok && zf.city === 'Chakan' && zf.state === 'Maharashtra' && zf.plants.length === 2 && !!zf.plants[0].id);
  r = await Store.saveCustomer('zf-steering-gear-india-ltd', { plants: [{ name: 'x', city: '', state: '' }] });
  check('a plant with no city and no state is refused', !r.ok && /Plant 1 needs a city or a state/.test(r.error));
  await Store.saveCustomer('zf-steering-gear-india-ltd', { group: 'Zeta Group' });
  await Store.saveCustomer('nr-industries', { group: 'alpha group' });
  await Store.saveCustomer('force-motors-limited', { group: 'Zeta Group' });
  check('groups() is distinct and sorted', eq(Store.groups(), ['alpha group', 'Zeta Group']), JSON.stringify(Store.groups()));
  check('unsavedCount counts edited customers', Store.unsavedCount() === 3, String(Store.unsavedCount()));

  r = await Store.saveCustomer('sanjeev-auto-part-manufacturers-pvt-ltd', { name: 'Sanjeev Renamed' });
  check('rename keeps the id', r.ok && Store.get('sanjeev-auto-part-manufacturers-pvt-ltd').name === 'Sanjeev Renamed');
  await Store.saveCustomer('nahars-engineering-india-pvt-ltd', { contact: 'Someone' });
  const nahars = Store.customers().find(x => x.name.startsWith('Nahars'));
  check('editing contact clears the "guessed" mark', nahars.contact === 'Someone' && nahars.contactFrom === '');

  r = await Store.addCustomer({ name: 'Test Forge Co', city: 'Pune', status: 'Follow up', followUp: Store.addDays(Store.todayISO(), -1) });
  check('addCustomer: manual customer with slug id', r.ok && r.id === 'test-forge-co' && Store.get('test-forge-co').added === true);
  r = await Store.addCustomer({ name: 'TEST FORGE CO' });
  check('addCustomer: duplicate is refused', !r.ok && r.field === 'name');

  // log
  const id = 'nr-industries';
  r = await Store.addLog(id, { type: 'Note', note: '   ' });
  check('addLog: empty note is refused', !r.ok);
  r = await Store.addLog(id, { type: 'Note', note: 'x'.repeat(501) });
  check('addLog: note limited to 500', !r.ok);
  r = await Store.addLog(id, { type: 'Note', note: 'plain note', at: Store.addDays(Store.todayISO(), -5) });
  check('addLog: a Note does not count as Last contacted', r.ok && Store.lastContacted(id) === '' && Store.logCount(id) === 1);
  await Store.addLog(id, { type: 'Call', note: 'called', at: Store.addDays(Store.todayISO(), -2) });
  await Store.addLog(id, { type: 'Visit', note: 'visited', at: Store.addDays(Store.todayISO(), -9) });
  check('a Call counts as Last contacted (newest of the contact types)', Store.lastContacted(id) === Store.addDays(Store.todayISO(), -2));
  check('listLog is newest first by date', eq(Store.listLog(id).map(x => x.note), ['called', 'plain note', 'visited']));
  r = await Store.addLog(id, { type: 'Call', note: 'future', at: Store.addDays(Store.todayISO(), 3) });
  check('addLog: a future date is refused', !r.ok);

  await Store.setFollowUp(id, Store.addDays(Store.todayISO(), -3));
  r = await Store.markDone(id, { type: 'Call', note: 'done', next: Store.addDays(Store.todayISO(), 7) });
  check('markDone moves the follow-up, adds a log entry and sets Last contacted today',
    r.ok && Store.get(id).followUp === Store.addDays(Store.todayISO(), 7) && Store.lastContacted(id) === Store.todayISO() && r.entry.doneFollowUp === true);
  r = await Store.markDone(id, { next: Store.addDays(Store.todayISO(), -1) });
  check('markDone refuses a past next date', !r.ok && r.field === 'next');
  await Store.markDone(id, {});
  check('markDone without a next date clears the follow-up', Store.get(id).followUp === '');
  r = await Store.removeCustomer('zf-steering-gear-india-ltd');
  check('only manual customers can be removed', !r.ok);

  // generic collections and documents (open lists)
  const col = Store.col('rfqs');
  r = await col.insert({ customer_id: 'test-forge-co', rfq_no: 'R1' });
  check('collection insert gives id and timestamps', r.ok && !!r.row.id && !!r.row.created_at);
  r = await Store.removeCustomer('test-forge-co');
  check('a customer with an RFQ cannot be removed', !r.ok && /Remove its RFQs and visits first \(1\)/.test(r.error), r.error);
  check('refs counts RFQs', Store.refs('test-forge-co').rfqs === 1);
  r = await col.patch(col.all()[0].id, { stage: 'Quoted' });
  check('collection patch merges fields', r.ok && col.all()[0].stage === 'Quoted' && col.all()[0].rfq_no === 'R1');
  r = await col.insert({ big: 'x'.repeat(11000) });
  check('collection refuses rows over 10 KB', !r.ok);
  const leads = Store.col('leads');
  await leads.insert({ company: 'Made Up Co' });
  check('a module can add a new collection without any Store edit', leads.all().length === 1 && Store.collectionNames().indexOf('leads') !== -1);
  Store.registerCollection('leads', { backup: true });
  check('a registered collection can opt into the backup', Store.exportBackup().extra.leads.length === 1 && !('leads' in Store.exportBackup()));
  await Store.doc('lead_staging').set({ v: 1, rows: [] });
  check('a module can add a new document without any Store edit', Store.doc('lead_staging').get().v === 1 && Store.docNames().indexOf('lead_staging') !== -1);
  Store.registerDoc('dispatch_meta', { imported: true });
  check('imported documents are listed for "clear imported data"', Store.importedDocs().indexOf('dispatch_meta') !== -1 && Store.importedDocs().indexOf('money') !== -1);
  r = await Store.doc('money').set({ v: 1, aging: null });
  const exp = JSON.stringify(Store.exportCustomersJson()), bk = JSON.stringify(Store.exportBackup());
  check('exports never include money', r.ok && exp.indexOf('aging') === -1 && bk.indexOf('"aging"') === -1);
  check('exportCustomersJson has exactly the documented keys',
    Object.keys(Store.exportCustomersJson().customers[0]).join() === 'id,name,contact,contactFrom,city,state,phone,last,followUp,status,disputed,group,segment,vehicleSegment,plants,relatedParty,erpGroup');
  check('backup has the documented format and no notes in customers', Store.exportBackup().format === 'varsha-crm-backup-v2' && !('notes' in Store.exportBackup().customers[0]));
  let threw = false; try { Store.col('Bad Name'); } catch (e) { threw = true; }
  check('collection names are validated', threw);

  // seed validation
  const bad = JSON.parse(JSON.stringify(data));
  bad.customers[0].segment = 'Whale'; bad.customers[1].segment = 'Nope'; bad.customers[2].plants = [{ name: 'x' }, { city: 'Pune', state: 'MH' }];
  let notice = '';
  Store._reset(); Store.onChange((reason, d) => { if (reason === 'notice') notice = d.text; });
  await Store.init({ data: bad }); await Store.load();
  check('seed: unknown segment is left blank with a notice', Store.customers()[0].segment === '' && /2 customers had a segment value that is not in the list; it was left blank\./.test(notice), notice);
  check('seed: plants with no city and no state are dropped', Store.customers()[2].plants.length === 1 && Store.customers()[2].city === 'Pune');

  // a failed seed load reports a message and keeps the app usable
  Store._reset();
  const lr = await Store.load();
  check('load without a seed source fails with a clear message', lr.ok === false && /Could not load customers\.json/.test(lr.error));
};
