// "Applied before" tab: jobs and employers applied to from an earlier copy are never applied to again.
const fs = require('fs'), path = require('path'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
const rows = [['Employer', 'Job URL', 'Applied on'], ['Clover Health', 'https://jobs/clover-1', '2026-10-27'], ['Oscar Health', '', '']];
const before = { getLastRow: () => rows.length, getRange: (r, c, nr, nc) => ({ getValues: () => rows.slice(r - 1, r - 1 + nr).map(x => x.slice(c - 1, c - 1 + nc)) }) };
const APP = ['App ID', 'Employer', 'Status', 'Decision time'];
const apps = { getDataRange: () => ({ getValues: () => [APP] }) };
const env = {
  SpreadsheetApp: { getActive: () => ({ getSheetByName: (n) => ({ 'Applied before': before, Applications: apps })[n] }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
  UrlFetchApp: {}, DriveApp: {}, MailApp: {}, LockService: {}, ContentService: {}, Utilities: {}, Session: {}
};
const api = new Function(...Object.keys(env), src + '\nreturn { sentBefore_, appliedRecently_ };')(...Object.values(env));
assert(api.sentBefore_().some(x => x.url === 'https://jobs/clover-1'), 'job link remembered');
assert.equal(api.appliedRecently_('Clover Health'), true, 'employer skipped for 30 days');
assert.equal(api.appliedRecently_('Oscar Health'), true, 'no date given: treated as recent');
assert.equal(api.appliedRecently_('Acme'), false);
console.log('applied-before tests passed');
