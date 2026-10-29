// Employer discovery: only boards that exist and have open jobs are added; a wrong board is marked "not found".
const fs = require('fs'), path = require('path'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
function fakeSheet(rows) {
  return { rows, getLastColumn: () => rows[0].length, getLastRow: () => rows.length,
    getRange: (r, c) => ({ getValues: () => [rows[r - 1].slice(c - 1)], getValue: () => (rows[r - 1] || [])[c - 1],
      setValue: (v) => { while (rows.length < r) rows.push([]); rows[r - 1][c - 1] = v; return { setFontWeight() {} }; } }),
    getDataRange: () => ({ getValues: () => rows.map(x => x.slice()) }), appendRow: (x) => rows.push(x) };
}
const companies = fakeSheet([['Name', 'ATS', 'Board', 'Domain', 'Status'], ['Paystack', 'greenhouse', 'paystack', '', '']]);
const log = fakeSheet([['Time', 'Event', 'Details']]);
const store = {};
const exists = { 'https://api.lever.co/v0/postings/cowrywise?mode=json&limit=1': '[{"id":1}]',
  'https://api.ashbyhq.com/posting-api/job-board/withmono': '{"jobs":[{"id":1}]}',
  'https://api.ashbyhq.com/posting-api/job-board/kuda': '{"jobs":[]}' };
const env = {
  SpreadsheetApp: { getActive: () => ({ getSheetByName: (n) => n === 'Companies' ? companies : log }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => store[k] || null, setProperty: (k, v) => { store[k] = v; } }) },
  UrlFetchApp: { fetchAll: (reqs) => reqs.map(r => ({ getResponseCode: () => exists[r.url] ? 200 : 404, getContentText: () => exists[r.url] || '' })) },
  Utilities: { computeDigest: (a, t) => Array.from(Buffer.from(String(t)).slice(-32)), DigestAlgorithm: {}, Charset: {} },
  Session: {}, DriveApp: {}, MailApp: {}, LockService: {}, ContentService: {}
};
const api = new Function(...Object.keys(env), src + '\nreturn { findEmployers_, boardGuesses_ };')(...Object.values(env));
assert.deepEqual(api.boardGuesses_('Chipper Cash'), ['chippercash', 'chipper-cash', 'chippercashhq', 'chippercashafrica']);
assert.deepEqual(api.boardGuesses_('Mono=mono|withmono').slice(0, 2), ['mono', 'withmono']);
const added = api.findEmployers_(60);
const names = companies.rows.slice(2).map(r => r[0] + ':' + r[1] + ':' + r[2]);
assert.deepEqual(names.sort(), ['Cowrywise:lever:cowrywise', 'Mono:ashby:withmono'], names);  // Kuda's board has no jobs; Paystack already listed
assert.equal(added, 2);
assert(store.EMPLOYERS_SEARCHED, 'finished the whole list');
console.log('employer discovery tests passed');
