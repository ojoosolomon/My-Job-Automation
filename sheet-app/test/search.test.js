// The search keeps only remote jobs open to someone living in Nigeria (worldwide, Africa, Nigeria), lists unclear ones as
// "review" for a Gemini check, and drops US/UK/EU-only, on-site and hybrid jobs. Job boards' own pages are followed to the
// employer's real application form, and the same job found on two boards is listed once.
const fs = require('fs'), path = require('path'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
function sheet(rows) {
  return { rows, getLastColumn: () => rows[0].length, getLastRow: () => rows.length,
    getRange: (r, c, nr, nc) => ({ getValues: () => rows.slice(r - 1, r - 1 + (nr || 1)).map(x => x.slice(c - 1, c - 1 + (nc || 1))),
      getValue: () => (rows[r - 1] || [])[c - 1], sort() {},
      setValue: (v) => { while (rows.length < r) rows.push([]); rows[r - 1][c - 1] = v; return { setFontWeight() {} }; } }),
    getDataRange: () => ({ getValues: () => rows.map(x => x.slice()) }), appendRow: (x) => rows.push(x), deleteRow: (n) => rows.splice(n - 1, 1) };
}
const JOB = ['Job ID', 'Found', 'Employer', 'Title', 'Location', 'Open to Nigeria', 'Title match', 'ATS', 'Board', 'Job URL', 'Apply URL',
  'Status', 'Description', 'Fit score', 'Posted', 'Work type', 'Why eligible', 'Salary range', 'Source'];
const jobs = sheet([JOB]);
const companies = sheet([['Name', 'ATS', 'Board', 'Domain', 'Status'], ['Acme', 'greenhouse', 'acme', '', ''],
  ['Remotive: customer support', 'remotive', 'customer-support', 'remotive.com', '']]);
const profile = sheet([['Field', 'Value'], ['cv_text', 'Executive assistant. Calendar management. Customer support. CRM records.'],
  ['target_titles', 'Executive Assistant\nCustomer Support Specialist\nOperations Coordinator\nVirtual Assistant'], ['location', 'Abuja, FCT']]);
const log = sheet([['Time', 'Event', 'Details']]);
const store = { MIN_FIT: '0', EMPLOYERS_SEARCHED: String(Date.now()) };
const hoursAgo = (h) => new Date(Date.now() - h * 3600e3).toISOString();
const gh = (id, title, loc, extra) => Object.assign({ id, title, location: { name: loc }, absolute_url: 'https://acme.example/jobs/' + id,
  content: 'Executive assistant role: calendar management and CRM records.', first_published: hoursAgo(5) }, extra || {});
const pages = {
  'https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true&pay_transparency=true': { jobs: [
    gh(1, 'Executive Assistant', 'Remote - Worldwide', { pay_input_ranges: [{ min_cents: 2000000, max_cents: 3000000, title: 'Annual' }] }),
    gh(2, 'Virtual Assistant', 'Remote - US'),
    gh(3, 'Operations Coordinator', 'Remote', { content: 'Applicants must be authorized to work in the United States.' }),
    gh(4, 'Executive Assistant II', 'Remote'),
    gh(5, 'Customer Support Specialist', 'Lagos, Nigeria', { content: 'This is an on-site role in our Lagos office.' }),
    gh(6, 'Virtual Assistant II', 'Remote - Worldwide', { first_published: '2023-03-01T09:00:00Z' }),
    gh(7, 'Operations Coordinator II', 'Remote - Worldwide', { first_published: hoursAgo(30) }),
    gh(8, 'Operations Coordinator III', 'Remote - Worldwide', { first_published: undefined, updated_at: hoursAgo(1) })] },
  'https://remotive.com/api/remote-jobs?category=customer-support': { jobs: [
    { id: 11, url: 'https://remotive.com/remote-jobs/customer-support/cs-11', title: 'Customer Support Specialist', company_name: 'Globex',
      candidate_required_location: 'Worldwide', description: '<p>Help customers by email and chat.</p>', publication_date: hoursAgo(2) },
    { id: 12, url: 'https://remotive.com/remote-jobs/x/ea-12', title: 'Executive Assistant', company_name: 'Acme',
      candidate_required_location: 'Worldwide', description: 'Same job as on Acme\'s own board.', publication_date: hoursAgo(2) },
    { id: 13, url: 'https://remotive.com/remote-jobs/x/va-13', title: 'Virtual Assistant', company_name: 'Initech',
      candidate_required_location: 'USA Only', description: 'Support our US team.', publication_date: hoursAgo(2) }] }
};
const html = { 'https://remotive.com/remote-jobs/customer-support/cs-11':
  '<a class="apply" href="https://boards.greenhouse.io/globex/jobs/777?utm_source=remotive">Apply for this position</a>' };
const env = {
  SpreadsheetApp: { getActive: () => ({ getSheetByName: (n) => ({ Jobs: jobs, Companies: companies, Profile: profile, Log: log })[n] }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => store[k] || null, setProperty: (k, v) => { store[k] = v; } }) },
  UrlFetchApp: { fetch: (url) => ({ getResponseCode: () => (pages[url] || html[url]) ? 200 : 404, getHeaders: () => ({}),
    getContentText: () => pages[url] ? JSON.stringify(pages[url]) : (html[url] || '') }) },
  Utilities: { computeDigest: (a, t) => Array.from(Buffer.from(String(t)).slice(-32)), DigestAlgorithm: {}, Charset: {}, formatDate: () => '2026-10-28' },
  Session: { getScriptTimeZone: () => 'UTC' }, DriveApp: {}, MailApp: {}, LockService: {}, ContentService: {}, XmlService: {}
};
const api = new Function(...Object.keys(env), src + '\nreturn { findJobs };')(...Object.values(env));
const added = api.findJobs();
const col = (n) => JOB.indexOf(n);
const got = jobs.rows.slice(1).map(r => ({ title: r[col('Title')], employer: r[col('Employer')], open: r[col('Open to Nigeria')],
  ats: r[col('ATS')], board: r[col('Board')], apply: r[col('Apply URL')], why: r[col('Why eligible')], pay: r[col('Salary range')],
  source: r[col('Source')] }));
assert.equal(added, 3, JSON.stringify(got, null, 1));
const ea = got.find(r => r.title === 'Executive Assistant');
assert.deepEqual([ea.open, ea.employer, ea.pay], ['yes', 'Acme', '$20,000 – $30,000 a year']);
assert.match(ea.why, /worldwide/i);
assert.equal(got.find(r => r.title === 'Executive Assistant II').open, 'review', 'just "Remote": checked by Gemini before preparing');
const cs = got.find(r => r.employer === 'Globex');
assert.deepEqual([cs.open, cs.ats, cs.board, cs.apply], ['yes', 'greenhouse', 'globex', 'https://boards.greenhouse.io/embed/job_app?for=globex&token=777'],
  'the job board page leads to the employer\'s Greenhouse form, which the applier can fill');
assert.equal(cs.source, 'Remotive: customer support');
assert(!got.some(r => r.title === 'Virtual Assistant' || r.title === 'Operations Coordinator' || r.title === 'Customer Support Specialist' && r.employer === 'Acme'),
  'US-only, "authorized to work in the United States" and on-site jobs are not listed');
assert.equal(got.filter(r => r.title === 'Executive Assistant').length, 1, 'the same job from two boards is listed once');
assert(/not open to Nigeria: 4/.test(log.rows[log.rows.length - 1][2]), log.rows[log.rows.length - 1][2]);
assert(!got.some(r => /II$|III$/.test(r.title) && r.title !== 'Executive Assistant II'),
  'posted in 2023, 30 hours ago, or with no posting date (only an "updated" date): not listed');
assert(/posted more than 24 h ago or no date: 3/.test(log.rows[log.rows.length - 1][2]), log.rows[log.rows.length - 1][2]);
console.log('search rules tests passed');
