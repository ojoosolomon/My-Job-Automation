// Jobs already listed are checked again with the current rules: out-of-scope ones are skipped, and a job board link is
// replaced by the employer's real application form (hidden in the page's code), so the applier can send it.
const fs = require('fs'), path = require('path'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
function sheet(rows) {
  return { rows, getLastColumn: () => rows[0].length, getLastRow: () => rows.length,
    getRange: (r, c, nr, nc) => ({ getValues: () => rows.slice(r - 1, r - 1 + (nr || 1)).map(x => x.slice(c - 1, c - 1 + (nc || 1))),
      getValue: () => (rows[r - 1] || [])[c - 1],
      setValue: (v) => { while (rows.length < r) rows.push([]); rows[r - 1][c - 1] = v; return { setFontWeight() {} }; } }),
    getDataRange: () => ({ getValues: () => rows.map(x => x.slice()) }), appendRow: (x) => rows.push(x) };
}
const JOB = ['Job ID', 'Found', 'Employer', 'Title', 'Location', 'Open to Nigeria', 'Title match', 'ATS', 'Board', 'Job URL', 'Apply URL',
  'Status', 'Description', 'Fit score', 'Posted', 'Work type', 'Why eligible', 'Salary range', 'Source'];
const job = (id, title, loc, status, apply, why) => [id, '', 'Acme', title, loc, 'yes', 'similar: x', 'other', '', 'https://himalayas.app/x/' + id,
  apply || 'https://himalayas.app/x/' + id, status, 'Help our customers.', 80, new Date(), 'Remote', why || 'Open worldwide: Remote - Anywhere', '', 'Himalayas'];
const jobs = sheet([JOB,
  job('J-1', 'Customer Support Specialist', 'Remote - Anywhere in the World', 'PREPARED', 'https://himalayas.app/companies/acme/jobs/cs'),
  job('J-2', 'Senior Flight Operations Expert', 'Remote - Anywhere in the World', 'NEW'),
  job('J-3', 'Product Support Specialist - LATAM', 'Remote - Anywhere in the World', 'NEW'),
  job('J-4', 'Executive Assistant', 'Remote - Anywhere in the World', 'PREPARED', 'https://himalayas.app/companies/acme/jobs/ea')]);
const APP = ['App ID', 'Job ID', 'Employer', 'Title', 'Job URL', 'Resume PDF', 'Cover letter PDF', 'Fact check', 'Package hash', 'Decision',
  'Decision time', 'Status', 'Result', 'Updated', 'History'];
const apps = sheet([APP,
  ['A-1', 'J-1', 'Acme', 'Customer Support Specialist', 'u1', 'https://drive/file/d/RESUME1234567890123456789012/view',
    'https://drive/file/d/COVER12345678901234567890123/view', 'PASS', 'old', 'PENDING', '', 'APPLY YOURSELF', 'employer site', '', ''],
  ['A-4', 'J-4', 'Acme', 'Executive Assistant', 'u4', 'x', 'y', 'PASS', 'h', 'AUTO-APPROVED', '', 'SUBMITTED', 'sent', '', '']]);
const profile = sheet([['Field', 'Value'], ['cv_text', 'Customer support. Executive assistant.'],
  ['target_titles', 'Customer Support Specialist\nExecutive Assistant\nOperations Coordinator']]);
const log = sheet([['Time', 'Event', 'Details']]);
const page = '<script>{"job":{"title":"Customer Support","applicationLink":"https:\\/\\/boards.greenhouse.io\\/acme\\/jobs\\/4242"}}</script>';
const env = {
  SpreadsheetApp: { getActive: () => ({ getSheetByName: (n) => ({ Jobs: jobs, Applications: apps, Profile: profile, Log: log })[n] }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty() {} }) },
  UrlFetchApp: { fetch: (url) => ({ getResponseCode: () => 200, getHeaders: () => ({}), getContentText: () => /jobs\/cs$/.test(url) ? page : '' }) },
  DriveApp: { getFileById: (id) => ({ getBlob: () => ({ getBytes: () => Array.from(Buffer.from(id)) }) }) },
  Utilities: { computeDigest: (a, t) => Array.from(Buffer.from(String(t)).slice(-32)), base64Encode: (b) => Buffer.from(b).toString('base64'),
    DigestAlgorithm: {}, Charset: {}, formatDate: () => '2026-10-30 10:00' },
  Session: { getScriptTimeZone: () => 'UTC' }, MailApp: {}, LockService: {}, ContentService: {}
};
const api = new Function(...Object.keys(env), src + '\nreturn { recheckListed_ };')(...Object.values(env));
const out = api.recheckListed_(60);
const jc = (n) => JOB.indexOf(n), ac = (n) => APP.indexOf(n);
const j1 = jobs.rows[1], a1 = apps.rows[1];
assert.deepEqual([j1[jc('ATS')], j1[jc('Board')], j1[jc('Apply URL')]], ['greenhouse', 'acme', 'https://boards.greenhouse.io/embed/job_app?for=acme&token=4242'],
  'the Greenhouse link hidden in the job board page is found');
assert.deepEqual([a1[ac('Status')], a1[ac('Decision')]], ['READY FOR YOUR DECISION', 'PENDING'], 'so auto-apply can now send it');
assert.notEqual(a1[ac('Package hash')], 'old', 'the approval check covers the new address');
assert.match(String(jobs.rows[2][jc('Status')]), /^SKIPPED — Title is not one of your target roles/);
assert.match(String(jobs.rows[3][jc('Status')]), /^SKIPPED — Title limits it to a region/);
assert.equal(apps.rows[2][ac('Status')], 'SUBMITTED', 'an application already sent is never touched');
assert.equal(jobs.rows[4][jc('Apply URL')], 'https://himalayas.app/companies/acme/jobs/ea');
assert.deepEqual([out.fixed, out.dropped], [1, 2]);
console.log('recheck tests passed');
