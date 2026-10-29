// In-memory fake Sheet to check the History column and old-sheet column upgrade.
const fs = require('fs'), path = require('path'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
function fakeSheet(rows) {
  const sh = { rows, getLastColumn: () => rows[0].length, getLastRow: () => rows.length,
    getRange: (r, c, nr, nc) => ({
      getValues: () => rows.slice(r - 1, r - 1 + (nr || 1)).map(x => x.slice(c - 1, c - 1 + (nc || 1))),
      getValue: () => (rows[r - 1] || [])[c - 1],
      setValue: (v) => { while (rows.length < r) rows.push([]); rows[r - 1][c - 1] = v; return { setFontWeight() {} }; } }),
    getDataRange: () => ({ getValues: () => rows.map(x => x.slice()) }), appendRow: (x) => rows.push(x) };
  return sh;
}
// an "old" Applications tab without Evidence/History columns
const oldHead = ['App ID', 'Job ID', 'Employer', 'Title', 'Job URL', 'Resume PDF', 'Cover letter PDF', 'Resume (Word)', 'Keyword report',
  'Fact check', 'Check details', 'Package hash', 'Decision', 'Decision time', 'Status', 'Result', 'Response', 'Updated'];
const apps = fakeSheet([oldHead, ['A-1', 'J-1', 'Acme', 'Analyst'].concat(Array(14).fill(''))]);
const log = fakeSheet([['Time', 'Event', 'Details']]);
const env = {
  SpreadsheetApp: { getActive: () => ({ getSheetByName: (n) => n === 'Applications' ? apps : log }) },
  Utilities: { formatDate: () => '2026-10-23 10:00' }, Session: { getScriptTimeZone: () => 'America/New_York' },
  PropertiesService: {}, UrlFetchApp: {}, DriveApp: {}, MailApp: {}, LockService: {}, ContentService: {}
};
const api = new Function(...Object.keys(env), src + '\nreturn { history_ };')(...Object.values(env));
api.history_('A-1', 'Package prepared');
api.history_('A-1', 'Her decision: APPROVE');
assert.deepEqual(apps.rows[0].slice(-9), ['Evidence', 'History', 'Fit score', 'Answer sheet', 'Posted', 'Work type', 'Location', 'Salary range', 'Applied on'], 'old sheet gets the new columns');
const hist = apps.rows[1][apps.rows[0].indexOf('History')];
assert(hist.startsWith('2026-10-23 10:00 — Her decision: APPROVE\n2026-10-23 10:00 — Package prepared'), hist);
assert(log.rows.some(r => r[1] === 'APP A-1'), 'also written to the Log tab');
console.log('history tests passed');
