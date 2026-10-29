// Answers tab: each question that stopped an application is listed once; when she types an answer, the applications
// waiting for it are queued again, and the answer is sent to the applier for every later form.
const fs = require('fs'), path = require('path'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
function sheet(rows) {
  return { rows, getLastColumn: () => rows[0].length, getLastRow: () => rows.length,
    getRange: (r, c, nr, nc) => ({ getValues: () => [rows[0]], getValue: () => (rows[r - 1] || [])[c - 1],
      setValues: (vals) => {
        if (vals.length !== nr || vals.some(v => v.length !== nc)) throw new Error('The number of columns in the data does not match the number of columns in the range');
        vals.forEach((v, i) => { rows[r - 1 + i] = v.slice(); }); },
      setValue: (v) => { while (rows.length < r) rows.push([]); rows[r - 1][c - 1] = v; return { setFontWeight() {} }; },
      setFontWeight() { return this; } }),
    getDataRange: () => ({ getValues: () => rows.map(x => x.slice()) }), appendRow: (x) => rows.push(x), setFrozenRows() {} };
}
const APP = ['App ID', 'Job ID', 'Employer', 'Title', 'Job URL', 'Resume PDF', 'Cover letter PDF', 'Resume (Word)', 'Keyword report',
  'Fact check', 'Check details', 'Package hash', 'Decision', 'Decision time', 'Status', 'Result', 'Response', 'Updated', 'Evidence', 'History'];
const row = (id, st) => { const r = Array(APP.length).fill(''); r[0] = id; r[9] = 'PASS'; r[12] = 'AUTO-APPROVED'; r[14] = st; return r; };
const apps = sheet([APP, row('A-1', 'NEEDS YOU'), row('A-2', 'NEEDS YOU'), row('A-3', 'SUBMITTED')]);
const answers = sheet([['Question', 'Your answer', 'Waiting applications', 'First seen']]);
const log = sheet([['Time', 'Event', 'Details']]);
const tabs = { Applications: apps, Answers: answers, Log: log };
const env = {
  SpreadsheetApp: { getActive: () => ({ getSheetByName: (n) => tabs[n], insertSheet: (n) => (tabs[n] = sheet([])) }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty() {} }) },
  Utilities: { formatDate: () => '2026-10-28 10:00' }, Session: { getScriptTimeZone: () => 'UTC' },
  UrlFetchApp: {}, DriveApp: {}, MailApp: {}, LockService: {}, ContentService: {}
};
const api = new Function(...Object.keys(env), src + '\nreturn { recordQuestions_, retryAnswered_, answersTab_ };')(...Object.values(env));
api.recordQuestions_('A-1', ['End date year', 'In what state do you currently reside? (no answer in her Profile)']);
api.recordQuestions_('A-2', ['End date year *']);
assert.deepEqual(answers.rows.slice(1).map(r => [r[0], r[2]]), [['End date year', 'A-1, A-2'], ['In what state do you currently reside?', 'A-1']]);
assert.equal(api.retryAnswered_(), 0, 'nothing retried before she answers');
answers.rows[1][1] = '2015';  // she types the answer once
assert.equal(api.retryAnswered_(), 2);
assert.deepEqual([apps.rows[1][14], apps.rows[2][14], apps.rows[3][14]], ['APPROVED — WILL SUBMIT', 'APPROVED — WILL SUBMIT', 'SUBMITTED']);
assert.equal(answers.rows[1][2], '', 'waiting list cleared');
assert.deepEqual(api.answersTab_().custom, [['end date year', '2015']], 'sent to the applier for every later form');

// the common-question bank: seeded once with defaults; a stop on a bank question waits on that row; her answer retries it
answers.rows.splice(1);
const api2 = new Function(...Object.keys(env), src + '\nreturn { seedBank_, recordQuestions_, retryAnswered_, answersTab_ };')(...Object.values(env));
answers.rows[0] = ['Question', 'Your answer', 'Waiting applications', 'First seen'];  // tab made by the older version
const n = api2.seedBank_();
assert(n > 50, 'bank seeded: ' + n);
assert.deepEqual(answers.rows[0].slice(4), ['Why this answer', 'Pattern'], 'older tab gets the new columns');
assert.equal(api2.seedBank_(), 0, 'seeded only once');
const felony = answers.rows.findIndex(r => /convicted/.test(r[0]));
assert.equal(answers.rows[felony][1], '', 'only she can answer this one');
apps.rows[1][14] = 'NEEDS YOU';
api2.recordQuestions_('A-1', ['Have you been convicted of a crime in the last 7 years? *']);
assert.equal(answers.rows[felony][2], 'A-1', 'joins the bank row instead of a new row');
answers.rows[felony][1] = 'No';
assert.equal(api2.retryAnswered_(), 1);
const tab = api2.answersTab_({ full_name: 'Test Person', today: '10/28/2026', hourly: '$36 - $43 per hour', job_title: 'Analyst' });
assert(tab.bank.some(([p, a]) => /signature/.test(p) && a === 'Test Person'), 'placeholders filled');
assert(tab.bank.some(([p, a]) => /hourly/.test(p) && a === '$36 - $43 per hour'));
assert(!tab.bank.some(([p, a]) => /driver/.test(p)), 'blank answers are not sent');
console.log('Answers tab tests passed');
