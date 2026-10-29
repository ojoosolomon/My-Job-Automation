// Jobs below the minimum fit are removed from the Jobs tab unless they already became an application.
const fs = require('fs'), path = require('path'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
const H = ['Job ID', 'Status', 'Fit score'];
const rows = [H, ['J-1', 'NEW', 80], ['J-2', 'NEW', 40], ['J-3', 'PREPARED', 50], ['J-4', 'SKIPPED — fit 60% is below 65%', 60], ['J-5', 'NEW', 65]];
const jobs = { getDataRange: () => ({ getValues: () => rows.map(x => x.slice()) }), deleteRow: (n) => rows.splice(n - 1, 1) };
const log = { appendRow() {} };
const env = { SpreadsheetApp: { getActive: () => ({ getSheetByName: (n) => n === 'Jobs' ? jobs : log }) },
  PropertiesService: {}, UrlFetchApp: {}, DriveApp: {}, MailApp: {}, LockService: {}, ContentService: {}, Utilities: {}, Session: {} };
const api = new Function(...Object.keys(env), src + '\nreturn { removeLowFitJobs_ };')(...Object.values(env));
assert.equal(api.removeLowFitJobs_(65), 2);
assert.deepEqual(rows.slice(1).map(r => r[0]), ['J-1', 'J-3', 'J-5']);
console.log('low-fit removal tests passed');
