// Her Tuesday/Friday update: applications sent since the last update, employer replies, and what waits for her.
const fs = require('fs'), path = require('path'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
const sheet = (rows) => ({ rows, getLastColumn: () => rows[0].length, getRange: (r, c) => ({ getValues: () => [rows[0]],
  setValue: (v) => { rows[r - 1][c - 1] = v; return { setFontWeight() {} }; } }),
  getDataRange: () => ({ getValues: () => rows.map(x => x.slice()) }), appendRow: (x) => rows.push(x) });
const APP = ['App ID', 'Employer', 'Title', 'Job URL', 'Resume PDF', 'Cover letter PDF', 'Status', 'Response', 'Updated', 'Applied on',
  'Work type', 'Salary range', 'Decision'];
const now = Date.now(), old = new Date(now - 10 * 86400e3);
const apps = sheet([APP,
  ['A-1', 'Acme', 'Analyst', 'https://jobs/1', 'https://drive/r1', 'https://drive/c1', 'SUBMITTED', 'INTERVIEW', new Date(), new Date(), 'Remote', '$80,000 – $90,000 a year', 'AUTO-APPROVED'],
  ['A-2', 'Beta', 'Specialist', 'https://jobs/2', '', '', 'SUBMITTED', '', old, old, 'Hybrid', 'not posted', 'AUTO-APPROVED'],
  ['A-3', 'Gamma', 'Coordinator', 'https://jobs/3', '', '', 'NEEDS YOU', '', new Date(), '', 'Remote', '', 'AUTO-APPROVED']]);
const profile = sheet([['Field', 'Value'], ['cv_text', 'cv'], ['email', 'her@example.invalid']]);
const log = sheet([['Time', 'Event', 'Details']]);
const sent = [], store = { FOLDER_ID: 'f', LAST_HER_UPDATE: String(now - 4 * 86400e3) };
const env = {
  SpreadsheetApp: { getActive: () => ({ getSheetByName: (n) => ({ Applications: apps, Profile: profile, Log: log })[n], getUrl: () => 'https://sheet', addViewer() {} }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => store[k] || null, setProperty: (k, v) => { store[k] = v; } }) },
  Session: { getScriptTimeZone: () => 'UTC', getEffectiveUser: () => ({ getEmail: () => 'her@example.invalid' }) },
  Utilities: { formatDate: () => 'Tuesday 3 November' }, DriveApp: { getFolderById: () => ({ addViewer() {} }) },
  MailApp: { sendEmail: (m) => sent.push(m) }, UrlFetchApp: {}, LockService: {}, ContentService: {}
};
const api = new Function(...Object.keys(env), src + '\nreturn { herUpdate };')(...Object.values(env));
api.herUpdate();
assert.equal(sent[0].to, 'her@example.invalid');
assert.match(sent[0].subject, /1 sent, 1 replies/);
const h = sent[0].htmlBody;
assert(h.includes('Acme') && h.includes('INTERVIEW') && h.includes('$80,000') && !h.includes('Beta — Specialist</b><br>'), h);
assert(h.includes('1 application(s) need a few minutes'), 'what waits for her');
assert(Number(store.LAST_HER_UPDATE) >= now, 'next update starts from now');
console.log('her update tests passed');
