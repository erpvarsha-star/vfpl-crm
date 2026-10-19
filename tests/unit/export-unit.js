// Unit checks for the pure builders in js/export.js (no browser). Synthetic data only.
const X = require('../../js/export.js');
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

module.exports = async (t) => {
  const { check } = t;

  check('export unit: amounts are plain numbers with 2 decimals; negatives stay unguarded numbers', X.amt(1234.5) === '1234.50' && X.amt(0) === '0.00' && X.amt(-12.5) === -12.5 && X.amt(null) === '' && X.amt('x') === '');
  check('export unit: plants text', X.plantsText([{ name: 'Chakan plant', city: 'Chakan', state: 'Maharashtra' }, { name: '', city: 'Hosur', state: 'Tamil Nadu' }, { name: 'North', city: '', state: 'Delhi' }]) === 'Chakan plant (Chakan, Maharashtra); Hosur, Tamil Nadu; North (Delhi)');

  const cust = [{ id: 'a', name: 'Alpha Co', contact: 'Ann', phone: '+91 90000 11111', city: 'Pune', group: 'G', segment: 'OEM', vehicleSegment: 'CV', plants: [], last: '2026-07-01', followUp: '2026-10-20', status: 'Follow up' },
                { id: 'b', name: '=HYPERLINK("x")', contact: '', phone: '', city: '', group: '', segment: '', vehicleSegment: '', plants: [], last: '', followUp: '', status: 'Active' }];
  const base = { lastContacted: id => (id === 'a' ? '2026-10-01' : ''), logCount: id => (id === 'a' ? 2 : 0), notesFor: id => 'secret note ' + id };
  const plain = X.customerTable(cust, base);
  check('export unit: the customer header is exact', eq(plain[0], ['Customer', 'Contact person', 'Phone', 'City', 'Group', 'Segment', 'Vehicle segment', 'Plants', 'Last order', 'Follow-up', 'Status', 'Last contacted', 'Notes count']));
  check('export unit: customer rows carry last contacted and the notes count, never the note text', eq(plain[1].slice(8), ['2026-07-01', '2026-10-20', 'Follow up', '2026-10-01', 2]) && !JSON.stringify(plain).includes('secret note'));
  const withNotes = X.customerTable(cust, Object.assign({ includeNotes: true }, base));
  check('export unit: notes add a last column only when asked', withNotes[0].length === 14 && withNotes[0][13] === 'Notes' && withNotes[1][13] === 'secret note a' && plain[0].length === 13);
  const money = { a: { outstanding: 1000, overdue: -50, b1_30: 1, b31_60: 2, b61_90: 3, b90: 4, shared: null }, b: { outstanding: 5, overdue: 5, b1_30: 0, b31_60: 0, b61_90: 0, b90: 0, shared: { groupName: 'Grp', n: 2 } } };
  const amounts = X.customerTable(cust, Object.assign({ money: id => money[id], revenue: id => (id === 'a' ? { fytd: 99.999 } : null), fyLabel: '2026-27' }, base));
  check('export unit: amount columns, group amounts are labelled, revenue header names the year', amounts[0].slice(13).join('|') === 'Outstanding|Overdue|1-30 days|31-60 days|61-90 days|>90 days|Amount note|Revenue FY 2026-27 (Taxable)' &&
    amounts[1][13] === '1000.00' && amounts[1][14] === -50 && amounts[1][20] === '100.00' && /shared by 2/.test(amounts[2][19]) && amounts[2][20] === '', JSON.stringify(amounts[1]));
  const csv = X.csvText(plain);
  check('export unit: CSV starts with a BOM, quotes every field and ends with CRLF', csv.charCodeAt(0) === 0xFEFF && csv.startsWith('﻿"Customer","Contact person","Phone"') && csv.endsWith('\r\n') && csv.split('\r\n').length === 4);
  check('export unit: a formula-looking name and a phone starting with + are guarded', csv.includes('"\'=HYPERLINK(""x"")"') && csv.includes('"\'+91 90000 11111"'));
  check('export unit: TSV has tabs, no quotes, no line breaks inside a cell', (() => { const x = X.tsvText([['a\tb', 'c\nd'], ['1', '2']]); return x === 'a b\tc d\n1\t2'; })());

  const rfq = [{ rfq_no: 'R1', customer_name: 'Raw', customer_id: null, part_name: 'Hub', part_no: 'P1', qty: 5, received: '2026-10-01', quote_due: '', quoted_value: 12000, stage: 'Quoted', stage_at: '2026-10-02', next_action: '', lost: false, notes: 'private words', contact_ref: 'a@b.example' },
               { rfq_no: 'R2', customer_name: 'X', part_name: '', qty: null, quoted_value: null, stage: 'Received', lost: true, notes: '', contact_ref: '' }];
  const r0 = X.rfqTable(rfq, { customerName: r => r.customer_name });
  check('export unit: RFQ header and no notes or contact reference by default', eq(r0[0], ['RFQ no', 'Customer', 'Part name', 'Part no', 'Qty', 'Received', 'Quote due', 'Quoted value', 'Stage', 'Stage since', 'Next action', 'Lost']) && !JSON.stringify(r0).includes('private words') && !JSON.stringify(r0).includes('a@b.example') && r0[1][7] === '12000.00' && r0[2][11] === 'Yes' && r0[2][4] === '');
  const r1 = X.rfqTable(rfq, { customerName: r => r.customer_name, includeNotes: true, includeContacts: true });
  check('export unit: RFQ notes and contact reference appear when ticked', r1[0].slice(12).join() === 'Notes,Contact reference' && r1[1][12] === 'private words' && r1[1][13] === 'a@b.example');

  const lead = [{ company: 'Acme', contact_name: 'Jane', email: 'jane@x.example', phone: '+91 9', region_program: 'EU', scope: 'Hubs', segment_domain: 'CV', last_contact: '2026-01-01', bucket: 'A', action_category: 'No Response (Awaiting Data)', strategy: 'Call', next_follow_up: '', fit: 'sweet', source: 'Manual', status: 'Open', context: 'long story' }];
  const l0 = X.leadTable(lead, { bucketLabel: b => 'Label ' + b });
  check('export unit: lead header has no Email, Phone or Notes by default', eq(l0[0], ['Company', 'Key contact', 'Region / program', 'Scope', 'Segment / domain', 'Last contact', 'Bucket', 'Action category', 'Strategy', 'Next follow-up', 'Fit', 'Source', 'Status']) &&
    !JSON.stringify(l0).includes('jane@x.example') && !JSON.stringify(l0).includes('long story') && l0[1][6] === 'Label A' && l0[1][10] === 'Sweet spot');
  const l1 = X.leadTable(lead, { includeContacts: true, includeNotes: true });
  check('export unit: lead Email and Phone sit after Key contact when ticked', l1[0].slice(0, 5).join() === 'Company,Key contact,Email,Phone,Region / program' && l1[1][2] === 'jane@x.example' && l1[0][l1[0].length - 1] === 'Notes' && l1[1][l1[1].length - 1] === 'long story');

  const vt = X.visitTable([{ date: '2026-10-05', time: '', type: 'Call', customer_id: 'a', note: 'n2', done: false }, { date: '2026-10-01', time: '10:00', type: 'Visit', customer_id: 'a', note: 'n1', done: true }], { customerName: () => 'Alpha Co' });
  check('export unit: visits are oldest first, with Done, and no Note column by default', eq(vt[0], ['Date', 'Time', 'Type', 'Customer', 'Done']) && vt[1][0] === '2026-10-01' && vt[1][4] === 'Yes' && vt[2][4] === 'No');

  // backup
  const raw = {
    format: 'varsha-crm-backup-v2', exportedAt: '2026-10-19T00:00:00Z', note: 'x', customers: [{ id: 'a', name: 'Alpha Co', phone: '+91 1' }],
    callLog: [{ id: 'l1', customerId: 'a', leadId: '', at: '2026-10-01', type: 'Call', note: 'call text' }],
    rfqs: [{ id: 'r', rfq_no: 'R1', notes: 'rfq note', contact_ref: 'ref@x.example', quoted_value: 5 }], rfqHistory: [{ id: 'h', note: 'hist note' }],
    visits: [{ id: 'v', note: 'visit note' }], orders: [{ id: 'o', note: 'order note' }], ordersMeta: null, targets: { v: 1 }, extra: {}, extraDocs: {}
  };
  const copy = JSON.stringify(raw);
  const b0 = X.makeBackup(raw, lead, {});
  const s0 = JSON.stringify(b0);
  check('export unit: a backup without ticks has no note text, emails, phones or contact references', !/call text|rfq note|hist note|visit note|order note|long story|ref@x|jane@x/.test(s0) && b0.leads[0].phone === '' && b0.includes.notes === false && b0.includes.contactDetails === false && /not in the file/.test(b0.note));
  check('export unit: a backup keeps structure, quoted values and the lead names', b0.rfqs[0].quoted_value === 5 && b0.leads[0].company === 'Acme' && b0.callLog.length === 1 && b0.customers[0].id === 'a' && b0.format === 'varsha-crm-backup-v2');
  const b1 = X.makeBackup(raw, lead, { includeNotes: true, includeContacts: true });
  check('export unit: ticking both puts everything in the backup', /call text/.test(JSON.stringify(b1)) && b1.rfqs[0].contact_ref === 'ref@x.example' && b1.leads[0].email === 'jane@x.example' && b1.leads[0].context === 'long story' && b1.includes.notes && b1.includes.contactDetails);
  check('export unit: making a backup never changes the live data', JSON.stringify(raw) === copy && lead[0].email === 'jane@x.example');

  // restore planning
  check('export unit: a backup is recognised and summarised', (() => { const p = X.planRestore(JSON.stringify(b1)); return p.ok && p.summary.customers === 1 && p.summary.callLog === 1 && p.summary.leads === 1 && p.summary.targets && p.summary.notes && p.summary.contactDetails; })());
  check('export unit: a backup made without ticks says so', (() => { const p = X.planRestore(JSON.stringify(b0)); return p.ok && !p.summary.notes && !p.summary.contactDetails; })());
  check('export unit: customers.json, bad JSON and other files are refused with a reason', (() => {
    const a = X.planRestore(JSON.stringify({ note: '', customers: [] })), b = X.planRestore('not json'), c = X.planRestore('[]'), d = X.planRestore(JSON.stringify({ format: 'other', customers: [] }));
    return !a.ok && /customers\.json/.test(a.error) && !b.ok && /JSON/.test(b.error) && !c.ok && !d.ok && /not a Varsha CRM backup/.test(d.error);
  })());
};
