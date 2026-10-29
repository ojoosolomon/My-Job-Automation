// End-of-day email: lists jobs it could not apply to with links, goes to summary_email, shares the files once.
const fs = require('fs'), path = require('path'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
const sheet = (rows) => ({ rows, getLastColumn: () => rows[0].length, getRange: (r, c) => ({ getValues: () => [rows[0]],
  setValue: (v) => { rows[r - 1][c - 1] = v; return { setFontWeight() {} }; } }),
  getDataRange: () => ({ getValues: () => rows.map(x => x.slice()) }), appendRow: (x) => rows.push(x) });
const APP = ['App ID', 'Job ID', 'Employer', 'Title', 'Job URL', 'Resume PDF', 'Cover letter PDF', 'Resume (Word)', 'Keyword report',
  'Fact check', 'Check details', 'Package hash', 'Decision', 'Decision time', 'Status', 'Result', 'Response', 'Updated', 'Evidence', 'History'];
const row = (o) => APP.map(c => o[c] || '');
const now = new Date();
const apps = sheet([APP,
  row({ 'App ID': 'A-1', 'Job ID': 'J-1', Employer: 'Acme', Title: 'Analyst', 'Job URL': 'https://jobs/1', 'Resume PDF': 'https://drive/r1',
        'Cover letter PDF': 'https://drive/c1', Status: 'NEEDS YOU', Result: 'Questions needing your answer: Current company', Updated: now }),
  row({ 'App ID': 'A-2', 'Job ID': 'J-2', Employer: 'Beta', Title: 'Specialist', Status: 'SUBMITTED', Updated: now })]);
const jobs = sheet([['Job ID', 'Apply URL'], ['J-1', 'https://apply/1'], ['J-2', 'https://apply/2']]);
const profile = sheet([['Field', 'Value'], ['cv_text', 'cv'], ['email', 'her@example.invalid'], ['summary_email', 'me@example.invalid']]);
const log = sheet([['Time', 'Event', 'Details']]);
const sent = [], shared = [], store = { FOLDER_ID: 'f' };
const env = {
  SpreadsheetApp: { getActive: () => ({ getSheetByName: (n) => ({ Applications: apps, Jobs: jobs, Profile: profile, Log: log })[n],
    getUrl: () => 'https://sheet', addViewer: (e) => shared.push('sheet:' + e) }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => store[k] || null, setProperty: (k, v) => { store[k] = v; } }) },
  Session: { getScriptTimeZone: () => 'UTC', getEffectiveUser: () => ({ getEmail: () => 'her@example.invalid' }) },
  Utilities: { formatDate: (d) => new Date(d).toISOString().slice(0, 10) },
  DriveApp: { getFolderById: () => ({ addViewer: (e) => shared.push('folder:' + e) }) },
  MailApp: { sendEmail: (m) => sent.push(m) }, UrlFetchApp: {}, LockService: {}, ContentService: {}
};
const api = new Function(...Object.keys(env), src + '\nreturn { dailySummary };')(...Object.values(env));
api.dailySummary();
api.dailySummary();
assert.equal(sent[0].to, 'me@example.invalid');
assert.match(sent[0].subject, /1 applied today, 1 need you/);
for (const s of ['https://apply/1', 'https://drive/r1', 'https://drive/c1', 'Current company']) assert(sent[0].htmlBody.includes(s), s);
assert.deepEqual(shared, ['folder:me@example.invalid', 'sheet:me@example.invalid'], 'shared once, view only');
console.log('summary email tests passed');
