// Workable's job search (all Workable employers): remote jobs open to Nigeria are listed with their Workable form.
// (Fakes shared with nigeria-sources.test.js.) Only remote jobs open to Nigeria in your roles are kept,
// fake-job signs are skipped, and applications to personal email addresses are never sent automatically.
const fs = require('fs'), path = require('path'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
const recent = new Date(Date.now() - 3 * 3600e3);
const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>Jobs</title>
<item><title>Virtual Assistant at Acme Nigeria Limited</title><link>https://ngjobs.example/va-1</link>
<description>Location: Remote (Nigeria). Support our CEO with calendar management. Send your CV to careers@acme.ng</description>
<pubDate>${recent.toUTCString()}</pubDate></item>
<item><title>Customer Service Representative at Bright Ltd</title><link>https://ngjobs.example/cs-2</link>
<description>Location: Lagos. Work at our Ikeja office.</description><pubDate>${recent.toUTCString()}</pubDate></item>
<item><title>Virtual Assistant at Quick Cash Ventures</title><link>https://ngjobs.example/va-3</link>
<description>Location: Remote. Pay a registration fee of N5,000 to secure your interview.</description><pubDate>${recent.toUTCString()}</pubDate></item>
<item><title>Executive Assistant at Small Biz</title><link>https://ngjobs.example/ea-4</link>
<description>Location: Remote - Nigeria. Send your CV to smallbiz.hr@gmail.com</description><pubDate>${recent.toUTCString()}</pubDate></item>
</channel></rss>`;
const workable = { name: 'Kudi Co', jobs: [
  { title: 'Operations Coordinator', shortcode: 'AB12', telecommuting: true, country: 'Nigeria', city: '', state: '',
    url: 'https://apply.workable.com/kudi/j/AB12/', application_url: 'https://apply.workable.com/kudi/j/AB12/apply/',
    description: '<p>Coordinate operations remotely.</p>', created_at: recent.toISOString() },
  { title: 'Operations Coordinator II', shortcode: 'CD34', telecommuting: false, country: 'Nigeria', city: 'Lagos',
    url: 'https://apply.workable.com/kudi/j/CD34/', description: 'Office based.', created_at: recent.toISOString() }] };
const pages = { 'https://ngjobs.example/va-1': 'To apply, send your CV to careers@acme.ng.' };
// a tiny XML reader standing in for Apps Script's XmlService
function xml(text) {
  const el = (name, body) => ({ name, body,
    getChild: (n) => { const m = body.match(new RegExp('<' + n + '[^>]*>([\\s\\S]*?)</' + n + '>')); return m ? el(n, m[1]) : null; },
    getChildren: (n) => [...body.matchAll(new RegExp('<' + n + '[^>]*>([\\s\\S]*?)</' + n + '>', 'g'))].map(m => el(n, m[1])),
    getChildText: (n) => { const m = body.match(new RegExp('<' + n + '[^>]*>([\\s\\S]*?)</' + n + '>')); return m ? m[1].trim() : null; },
    getNamespace: () => null });
  return { getRootElement: () => el('rss', text) };
}
function sheet(rows) {
  return { rows, getLastColumn: () => rows[0].length, getLastRow: () => rows.length,
    getRange: (r, c, nr, nc) => ({ getValues: () => rows.slice(r - 1, r - 1 + (nr || 1)).map(x => x.slice(c - 1, c - 1 + (nc || 1))),
      getValue: () => (rows[r - 1] || [])[c - 1], sort() {}, setValues: (v) => v.forEach((x, k) => { rows[r - 1 + k] = x; }),
      setValue: (v) => { while (rows.length < r) rows.push([]); rows[r - 1][c - 1] = v; return { setFontWeight() {} }; } }),
    getDataRange: () => ({ getValues: () => rows.map(x => x.slice()) }), appendRow: (x) => rows.push(x), deleteRow: (n) => rows.splice(n - 1, 1),
    isSheetHidden: () => true, hideSheet() {} };
}
const JOB = ['Job ID', 'Found', 'Employer', 'Title', 'Location', 'Open to Nigeria', 'Title match', 'ATS', 'Board', 'Job URL', 'Apply URL',
  'Status', 'Description', 'Fit score', 'Posted', 'Work type', 'Why eligible', 'Salary range', 'Source'];
const jobs = sheet([JOB]);
const companies = sheet([['Name', 'ATS', 'Board', 'Domain', 'Status'], ['Workable search', 'workablesearch', 'query=virtual+assistant&workplace=remote', '', '']]);
const profile = sheet([['Field', 'Value'], ['cv_text', 'Executive assistant. Calendar management. Operations coordination. Customer service.'],
  ['target_titles', 'Executive Assistant\nVirtual Assistant\nOperations Coordinator\nCustomer Service Representative']]);
const log = sheet([['Time', 'Event', 'Details']]), apps = sheet([['App ID', 'Job ID', 'Employer', 'Title', 'Job URL', 'Status', 'Result']]);
const removed = sheet([['Job URL', 'Key', 'Employer', 'Title', 'Removed on', 'Reason']]);
const store = { MIN_FIT: '0', EMPLOYERS_SEARCHED: String(Date.now()), AUTO_ONLY: 'off' };
const undatedRows = [['Key', 'First seen']];
const undatedSheet = { getLastRow: () => undatedRows.length, hideSheet() {}, isSheetHidden: () => true,
  getRange: (r, c, nr, nc) => ({ getValues: () => undatedRows.slice(r - 1, r - 1 + (nr || 1)).map(x => x.slice(c - 1, c - 1 + (nc || 2))),
    setValues: (v) => v.forEach((x, k) => { undatedRows[r - 1 + k] = x; }) }) };
const fetch = (url) => {
  const body = /jobs\.workable\.com\/api\/v1\/jobs\?query=virtual\+assistant/.test(url) ? JSON.stringify({ jobs: [
    { id: 'w1', title: 'Virtual Assistant', company: { title: 'Brightly', subdomain: 'brightly' }, shortcode: 'AA11', workplace: 'remote',
      location: { countryName: 'Worldwide' }, description: 'Support our founder. We hire from anywhere in the world.', created: recent.toISOString() },
    { id: 'w2', title: 'Virtual Assistant (US)', company: { title: 'Statesy', subdomain: 'statesy' }, shortcode: 'BB22', workplace: 'remote',
      location: { countryName: 'United States' }, description: 'US only.', created: recent.toISOString() }] }) : undefined;
  return { getResponseCode: () => body === undefined ? 404 : 200, getHeaders: () => ({}), getContentText: () => body || '' };
};
const env = {
  SpreadsheetApp: { getActive: () => ({ getSheetByName: (n) => ({ Jobs: jobs, Companies: companies, Profile: profile, Log: log,
    Applications: apps, 'Removed jobs': removed, 'Undated jobs': undatedSheet })[n] }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => store[k] || null, setProperty: (k, v) => { store[k] = v; } }) },
  UrlFetchApp: { fetch, fetchAll: (reqs) => reqs.map(r => fetch(r.url)) }, XmlService: { parse: xml },
  Utilities: { computeDigest: (a, t) => Array.from(Buffer.from(String(t)).slice(-32)), DigestAlgorithm: {}, Charset: {}, formatDate: () => '30 Oct 10:00' },
  Session: { getScriptTimeZone: () => 'UTC' }, DriveApp: {}, MailApp: {}, LockService: {}, ContentService: {}
};
// only the two test sources: the built-in ones are not part of this test
const api = new Function(...Object.keys(env), src.replace(/var STARTER_COMPANIES = \[[\s\S]*?\n\];/, 'var STARTER_COMPANIES = [];') +
  '\nreturn { findJobs };')(...Object.values(env));
api.findJobs();
const col = (n) => JOB.indexOf(n);
const got = jobs.rows.slice(1).map(r => ({ t: r[col('Title')], e: r[col('Employer')], ats: r[col('ATS')], apply: r[col('Apply URL')] }));
assert.deepEqual(got, [{ t: 'Virtual Assistant', e: 'Brightly', ats: 'workable', apply: 'https://apply.workable.com/brightly/j/AA11/apply/' }], JSON.stringify(got));
console.log('Workable search tests passed');
