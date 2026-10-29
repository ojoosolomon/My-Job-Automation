// Jobs on sites it applies to by itself are prepared first; jobs she must send herself stay under 30% of the day.
const fs = require('fs'), path = require('path'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
const sheet = (rows) => ({ rows, getRange: (r, c) => ({ setValue: (v) => { rows[r - 1][c - 1] = v; return { setFontWeight() {} }; },
  getValues: () => [rows[0]] }), getLastColumn: () => rows[0].length, getDataRange: () => ({ getValues: () => rows.map(x => x.slice()) }),
  appendRow: (x) => rows.push(x) });
const JOB = ['Job ID', 'Found', 'Employer', 'Title', 'Location', 'Open to Nigeria', 'Title match', 'ATS', 'Board', 'Job URL', 'Apply URL', 'Status', 'Description', 'Fit score'];
const job = (id, ats, title) => [id, '', 'Emp ' + id, title, '', 'yes', '', ats, '', 'u' + id, 'u' + id, 'NEW', '', ''];
const jobs = sheet([JOB, job('J-1', 'workday', 'w90'), job('J-2', 'greenhouse', 'g70'), job('J-3', 'lever', 'l80'),
  job('J-4', 'ashby', 'a66'), job('J-5', 'workday', 'w85'), job('J-6', 'greenhouse', 'g50')]);
const APP = ['App ID', 'Job ID', 'Employer', 'Title', 'Job URL', 'Resume PDF', 'Cover letter PDF', 'Resume (Word)', 'Keyword report',
  'Fact check', 'Check details', 'Package hash', 'Decision', 'Decision time', 'Status', 'Result', 'Response', 'Updated', 'Evidence', 'History'];
const apps = sheet([APP]);
const profile = sheet([['Field', 'Value'], ['cv_text', 'cv'], ['target_titles', 'x']]);
const log = sheet([['Time', 'Event', 'Details']]);
const store = {};
const env = {
  SpreadsheetApp: { getActive: () => ({ getSheetByName: (n) => ({ Jobs: jobs, Applications: apps, Profile: profile, Log: log })[n] }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => store[k] || null, setProperty: (k, v) => { store[k] = v; } }) },
  Utilities: { formatDate: () => '2026-10-27' }, Session: { getScriptTimeZone: () => 'UTC' },
  UrlFetchApp: {}, DriveApp: {}, MailApp: {}, LockService: {}, ContentService: {}
};
const prepared = [];
const api = new Function(...Object.keys(env), src + `
  fitScore = function (j) { return Number(String(j.title).slice(1)); };
  prepareJob_ = function (id) { __prepared.push(id); var t = table_(TAB.JOBS); setCells_(t, findRow_(t, 'Job ID', id), { 'Status': 'PREPARED' }); return 'Prepared'; };
  autoApprove_ = function () {};
  return { prepareNew };`.replace('__prepared', 'globalThis.__prepared'))(...Object.values(env));
globalThis.__prepared = prepared;
api.prepareNew();
assert.deepEqual(prepared, ['J-2', 'J-4', 'J-3'], 'auto sites first (Greenhouse, Ashby by fit), then Lever; account sites wait');
api.prepareNew();
assert.deepEqual(prepared.slice(3), ['J-1'], 'one site-she-applies job allowed after 3 automatic ones, the next would pass 30%');
assert.equal(jobs.rows[5][11], 'NEW', 'the other stays NEW for later');
assert.match(String(jobs.rows[6][11]), /^SKIPPED — fit 50%/, 'below the minimum fit is skipped');
console.log('priority tests passed');
