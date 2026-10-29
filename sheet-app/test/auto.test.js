// Auto-apply: passes fact check → AUTO-APPROVED and queued; fails → waits; same employer within 30 days → skipped.
const fs = require('fs'), path = require('path'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
function fakeSheet(rows) {
  return { rows, getLastColumn: () => rows[0].length, getLastRow: () => rows.length,
    getRange: (r, c, nr, nc) => ({
      getValues: () => rows.slice(r - 1, r - 1 + (nr || 1)).map(x => x.slice(c - 1, c - 1 + (nc || 1))),
      getValue: () => (rows[r - 1] || [])[c - 1],
      setValue: (v) => { while (rows.length < r) rows.push([]); rows[r - 1][c - 1] = v; return { setFontWeight() {} }; } }),
    getDataRange: () => ({ getValues: () => rows.map(x => x.slice()) }), appendRow: (x) => rows.push(x) };
}
const env0 = { Utilities: { formatDate: (d) => new Date(d).toISOString().slice(0, 10) }, Session: { getScriptTimeZone: () => 'UTC' },
  UrlFetchApp: {}, DriveApp: {}, MailApp: {}, LockService: {}, ContentService: {} };
const load = (names) => new Function(...Object.keys(env0), 'SpreadsheetApp', 'PropertiesService', src + '\nreturn {' + names + '};');
const APP = ['App ID', 'Job ID', 'Employer', 'Title', 'Job URL', 'Resume PDF', 'Cover letter PDF', 'Resume (Word)', 'Keyword report',
  'Fact check', 'Check details', 'Package hash', 'Decision', 'Decision time', 'Status', 'Result', 'Response', 'Updated', 'Evidence', 'History'];
const appRow = (id, emp, fc, extra) => { const r = Array(APP.length).fill(''); Object.assign(r, { 0: id, 1: 'J-' + id.slice(2), 2: emp, 9: fc, 12: 'PENDING', 14: 'READY FOR YOUR DECISION' }, extra || {}); return r; };
const JOB = ['Job ID', 'Found', 'Employer', 'Title', 'Location', 'Remote US', 'Title match', 'ATS', 'Board', 'Job URL', 'Apply URL', 'Status', 'Description', 'Fit score'];
const jobRow = (id, ats) => ['J-' + id, '', '', '', '', 'yes', '', ats, '', 'u', 'u', 'PREPARED', '', ''];

const apps = fakeSheet([APP, appRow('A-1', 'Acme', 'PASS'), appRow('A-2', 'Beta', 'NEEDS YOUR CHECK'), appRow('A-3', 'Gamma', 'PASS'),
  appRow('A-4', 'Delta', 'PASS'),
  appRow('A-5', 'Eps', 'PASS', { 14: 'NEEDS YOU', 15: 'Nothing was sent. Questions needing your answer: Country; State' }),
  appRow('A-6', 'Zeta', 'PASS', { 14: 'UNCERTAIN', 15: 'Clicked submit but no confirmation appeared.' }),
  appRow('A-9', 'Old Co', 'PASS', { 13: new Date(Date.now() - 5 * 86400e3), 14: 'SUBMITTED' })]);
const jobs = fakeSheet([JOB, jobRow('1', 'greenhouse'), jobRow('2', 'lever'), jobRow('3', 'workday'), jobRow('4', 'lever'), jobRow('5', 'greenhouse'), jobRow('6', 'greenhouse')]);
const log = fakeSheet([['Time', 'Event', 'Details']]);
const ss = { getActive: () => ({ getSheetByName: (n) => ({ Applications: apps, Jobs: jobs, Log: log })[n] }) };
const props = { getProperty: () => null, setProperty() {} };
const api = load('autoApprove_, autoToday_, appliedRecently_, settings_, autoSweep_, retryStopped')(...Object.values(env0), ss, { getScriptProperties: () => props });
const s = api.settings_();
assert.deepEqual([s.auto, s.limit], [true, 8], 'auto-apply on by default, 8 a day (fits the free Gemini allowance)');
const col = (n) => APP.indexOf(n);

api.autoApprove_('A-1', 80, s);
assert.equal(apps.rows[1][col('Decision')], 'AUTO-APPROVED');
assert.equal(apps.rows[1][col('Status')], 'APPROVED — WILL SUBMIT');
api.autoApprove_('A-2', 80, s);
assert.equal(apps.rows[2][col('Decision')], 'PENDING', 'failed fact check waits for her');
api.autoApprove_('A-3', 80, s);
assert.equal(apps.rows[3][col('Decision')], 'PENDING', 'unsupported site waits for her');
assert.equal(apps.rows[3][col('Status')], 'APPLY YOURSELF', 'unsupported site is flagged for the evening email');
assert.equal(api.autoToday_(), 1);
assert.equal(api.appliedRecently_('old co'), true, 'employer applied to 5 days ago');
assert.equal(api.appliedRecently_('Beta'), false);
// a package prepared from the menu / before an update / while auto-apply was off is picked up by the sweep
api.autoSweep_();
assert.equal(apps.rows[4][col('Decision')], 'AUTO-APPROVED', 'waiting package applied by the sweep');
assert.equal(apps.rows[2][col('Decision')], 'PENDING', 'failed fact check still not applied');
// stopped before sending → retried; UNCERTAIN (may have been sent) → never retried automatically
assert.equal(api.retryStopped(true), 1);
assert.equal(apps.rows[5][col('Status')], 'APPROVED — WILL SUBMIT');
assert.equal(apps.rows[6][col('Status')], 'UNCERTAIN');
console.log('auto-apply tests passed');
