// Unit checks for js/csv.js (pure; no browser).
const C = require('../../js/csv.js');
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

module.exports = async (t) => {
  const { check } = t;

  check('csv parse: quotes, embedded commas and newlines', eq(C.parse('a,"b,c","d\ne"\n1,2,3\n'), [['a', 'b,c', 'd\ne'], ['1', '2', '3']]));
  check('csv parse: escaped quote', eq(C.parse('"say ""hi""",x'), [['say "hi"', 'x']]));
  check('csv parse: BOM is stripped', eq(C.parse('﻿Name,Qty\r\nA,1'), [['Name', 'Qty'], ['A', '1']]));
  check('csv parse: CRLF and LF', eq(C.parse('a,b\r\n1,2\r\n'), [['a', 'b'], ['1', '2']]) && eq(C.parse('a,b\n1,2'), [['a', 'b'], ['1', '2']]));
  check('csv parse: semicolon delimiter', eq(C.parse('a;b;c\n1;2;3'), [['a', 'b', 'c'], ['1', '2', '3']]));
  check('csv parse: tab delimiter', eq(C.parse('a\tb\n1\t2'), [['a', 'b'], ['1', '2']]));
  check('csv parse: commas inside quotes do not pick the delimiter', eq(C.parse('"a;b;c",d\n1,2'), [['a;b;c', 'd'], ['1', '2']]));

  const spec = [
    { key: 'customer', label: 'Customer', required: true, synonyms: ['Party'] },
    { key: 'd1', label: '1-30 days', required: true, synonyms: ['1-30'] },
    { key: 'erp', label: 'ERP base', required: false, pattern: /^ERP \d/ }
  ];
  const rows = [['Collections report', ''], ['', ''], ['Customer', '1-30', 'ERP 15-Oct', 'x'], ['A', '5', '9', '']];
  const h = C.findHeader(rows, spec);
  check('findHeader: finds the header below title rows', h.index === 2 && h.map.customer === 0 && h.map.d1 === 1 && h.missing.length === 0, JSON.stringify(h));
  check('findHeader: a pattern field matches "ERP 15-Oct"', h.map.erp === 2);
  const h2 = C.findHeader([['Party', 'Amount', 'Days']], spec);
  check('findHeader: missing required fields are reported with the headers found', eq(h2.missing, ['1-30 days']) && eq(h2.found, ['Party', 'Amount', 'Days']), JSON.stringify(h2));
  check('findHeader: accepts { fields } too', C.findHeader(rows, { fields: spec }).index === 2);
  check('normHeader', C.normHeader(' Pre_April (₹) ') === 'preapril' || C.normHeader(' Pre_April ') === 'preapril');
  check('normHeader keeps > and <', C.normHeader('>90') === '>90' && C.normHeader('< 5') === '<5');

  const amt = (s) => C.parseAmount(s);
  check('parseAmount "1,23,456.78"', amt('1,23,456.78').value === 123456.78);
  check('parseAmount "(1,200)" is negative', amt('(1,200)').value === -1200);
  check('parseAmount "−500" (minus sign U+2212)', amt('−500').value === -500);
  check('parseAmount "2,000 Cr" is negative, Dr is positive', amt('2,000 Cr').value === -2000 && amt('2,000 Dr').value === 2000);
  check('parseAmount "₹ 3,400"', amt('₹ 3,400').value === 3400);
  check('parseAmount "Rs. 1,000" and "INR 50"', amt('Rs. 1,000').value === 1000 && amt('INR 50').value === 50);
  check('parseAmount empty and dashes are null', amt('').ok && amt('').value === null && amt('-').value === null && amt('—').value === null && amt('–').value === null);
  check('parseAmount "12a" is not ok', amt('12a').ok === false);
  check('parseAmount "0" is 0', amt('0').ok && amt('0').value === 0);
  check('parseAmount "1,234,567" (Western) and "-2,500"', amt('1,234,567').value === 1234567 && amt('-2,500').value === -2500);
  check('parseAmount rounds to 2 decimals', amt('1.005').ok && amt('10.126').value === 10.13);

  const dt = (s) => C.parseDate(s);
  check('parseDate "05/08/2026" is day-first', dt('05/08/2026').value === '2026-08-05');
  check('parseDate "12-Jul-2026"', dt('12-Jul-2026').value === '2026-07-12');
  check('parseDate "01-Apr-26"', dt('01-Apr-26').value === '2026-04-01');
  check('parseDate "15-Oct-26" and "15 Oct 2026"', dt('15-Oct-26').value === '2026-10-15' && dt('15 Oct 2026').value === '2026-10-15');
  check('parseDate ISO, dots, dashes and 2-digit year', dt('2026-07-12').value === '2026-07-12' && dt('12.07.2026').value === '2026-07-12' && dt('12-07-2026').value === '2026-07-12' && dt('12/07/26').value === '2026-07-12');
  check('parseDate rejects "31/02/2026" and nonsense', dt('31/02/2026').ok === false && dt('hello').ok === false && dt('12-Foo-2026').ok === false);
  check('parseDate empty is null', dt('').ok && dt('').value === null);

  check('parseInt', C.parseInt('1,200').value === 1200 && C.parseInt('').value === null && C.parseInt('12.5').ok === false && C.parseInt('x').ok === false);

  check('safeCell guards formulas', C.safeCell('=1+1') === "'=1+1" && C.safeCell('+91 98') === "'+91 98" && C.safeCell('-x') === "'-x" && C.safeCell('@a') === "'@a");
  check('safeCell leaves normal text and numbers alone', C.safeCell('Pune') === 'Pune' && C.safeCell(-5) === '-5' && C.safeCell(null) === '');
  check('toCSV quotes every cell, doubles quotes, CRLF between rows', C.toCSV([['Customer', 'Note'], ['A "x"', 'a,b']]) === '"Customer","Note"\r\n"A ""x""","a,b"');
  check('toCSV guards formulas', C.toCSV([['=HYPERLINK("x")']]) === '"\'=HYPERLINK(""x"")"');
  check('toTSV: tabs and newlines become spaces', C.toTSV([['a\tb', 'c\nd'], ['e', 'f']]) === 'a b\tc d\ne\tf');
  check('toCSV output parses back', eq(C.parse(C.toCSV([['a,b', 'c"d'], ['e\nf', 'g']])), [['a,b', 'c"d'], ['e\nf', 'g']]));
};
