// Jobs on sites it applies to by itself are prepared first; jobs she must send herself stay under 30% of the day.
const fs = require('fs'), path = require('path'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
const sheet = (rows) => ({ rows, deleteRow: (n) => rows.splice(n - 1, 1), getRange: (r, c) => ({ setValue: (v) => { rows[r - 1][c - 1] = v; return { setFontWeight() {} }; },
  getValues: () => [rows[0]] }), getLastColumn: () => rows[0].length, getDataRange: () => ({ getValues: () => rows.map(x => x.slice()) }),
  appendRow: (x) => rows.push(x) });
const JOB = ['Job ID', 'Found', 'Employer', 'Title', 'Location', 'Open to Nigeria', 'Title match', 'ATS', 'Board', 'Job URL', 'Apply URL', 'Status', 'Description', 'Fit score', 'Posted'];
const job = (id, ats, title) => [id, '', 'Emp ' + id, title, '', 'yes', '', ats, '', 'u' + id, 'u' + id, 'NEW', '', '', new Date(Date.now() - 3600e3)];
const jobs = sheet([JOB, job('J-1', 'workday', 'w90'), job('J-2', 'greenhouse', 'g70'), job('J-3', 'lever', 'l80'),
  job('J-4', 'ashby', 'a66'), job('J-5', 'workday', 'w85'), job('J-6', 'greenhouse', 'g50')]);
const APP = ['App ID', 'Job ID', 'Employer', 'Title', 'Job URL', 'Resume PDF', 'Cover letter PDF', 'Resume (Word)', 'Keyword report',
  'Fact check', 'Check details', 'Package hash', 'Decision', 'Decision time', 'Status', 'Result', 'Response', 'Updated', 'Evidence', 'History'];
const apps = sheet([APP]);
const profile = sheet([['Field', 'Value'], ['cv_text', 'cv'], ['target_titles', 'x']]);
const log = sheet([['Time', 'Event', 'Details']]);
const store = {};
const removedRows = [['Job URL', 'Key', 'Employer', 'Title', 'Removed on', 'Reason']];
const removed = { rows: removedRows, getLastRow: () => removedRows.length, getLastColumn: () => 6, isSheetHidden: () => true, hideSheet() {},
  getDataRange: () => ({ getValues: () => removedRows.map(x => x.slice()) }),
  getRange: (r, c, nr, nc) => ({ setValues: (v) => { v.forEach((x, k) => { removedRows[r - 1 + k] = x; }); },
    getValues: () => removedRows.slice(r - 1, r - 1 + (nr || 1)).map(x => x.slice(c - 1, c - 1 + (nc || 6))), setFontWeight() {} }) };
const env = {
  SpreadsheetApp: { getActive: () => ({ getSheetByName: (n) => ({ Jobs: jobs, Applications: apps, Profile: profile, Log: log, 'Removed jobs': removed })[n] }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => store[k] || null, setProperty: (k, v) => { store[k] = v; } }) },
  Utilities: { formatDate: () => '2026-10-27' }, Session: { getScriptTimeZone: () => 'UTC' },
  UrlFetchApp: {}, DriveApp: {}, MailApp: {}, LockService: {}, ContentService: {}
};
const prepared = [];
const api = new Function(...Object.keys(env), src + `
  fitScore = function (j) { return Number(String(j.title).slice(1)); };
  prepareJob_ = function (id) { __prepared.push(id); var t = table_(TAB.JOBS); setCells_(t, findRow_(t, 'Job ID', id), { 'Status': 'PREPARED' }); return 'Prepared'; };
  autoApprove_ = function () {};
  recheckListed_ = function () {};  // tested in recheck.test.js; these test titles are placeholders
  return { prepareNew };`.replace('__prepared', 'globalThis.__prepared'))(...Object.values(env));
globalThis.__prepared = prepared;
api.prepareNew();
assert.deepEqual(prepared, ['J-2', 'J-4', 'J-3'], 'auto sites first (Greenhouse, Ashby by fit), then Lever; account sites wait');
api.prepareNew();
assert.deepEqual(prepared.slice(3), ['J-1', 'J-5'], 'once no automatic job is waiting, the ones you submit yourself are prepared, best fit first');
assert(!jobs.rows.some(r => r[0] === 'J-6'), 'the job below the minimum fit is removed from Jobs');
assert.match(String(removedRows[1][5]), /^SKIPPED — fit 50%/, 'and recorded with the reason in the hidden Removed jobs tab');
// only jobs you submit yourself waiting (the case that prepared nothing before): they are prepared
const only = sheet([JOB, job('M-1', 'other', 'o90'), job('M-2', 'workday', 'w80')]);
jobs.rows.splice(0, jobs.rows.length, ...only.rows);
prepared.length = 0;
api.prepareNew();
assert.deepEqual(prepared, ['M-1', 'M-2'], 'manual-apply jobs are prepared when nothing else is waiting');
console.log('priority tests passed');
