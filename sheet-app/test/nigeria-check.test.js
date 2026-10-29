// Unclear postings ("Remote", "EMEA") are read by Gemini: YES counts only with a quote that really is in the posting.
const fs = require('fs'), path = require('path'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
function check(reply, job) {
  const props = { GEMINI_API_KEY: 'k', GEMINI_MODELS: JSON.stringify(['gemini-2.5-flash-lite']) };
  const env = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
    Utilities: { formatDate: () => '2026-10-29', sleep: () => {} },
    SpreadsheetApp: { getActive: () => ({ getSheetByName: () => ({ appendRow() {} }) }) },
    UrlFetchApp: { fetch: () => ({ getResponseCode: () => 200,
      getContentText: () => JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] } }] }) }) }
  };
  return new Function(...Object.keys(env), src + '\nreturn { checkNigeria_ };')(...Object.values(env)).checkNigeria_(job);
}
const job = { employer: 'Acme', title: 'Executive Assistant', location: 'Remote (EMEA)',
  text: 'We are a distributed team. We hire across EMEA, including Nigeria, Kenya and Egypt.' };
let r = check({ verdict: 'YES', quote: 'We hire across EMEA, including Nigeria', reason: 'Names Nigeria' }, job);
assert.equal(r.ok, 'yes'); assert.match(r.why, /including Nigeria/);
r = check({ verdict: 'YES', quote: 'Open to candidates in Nigeria', reason: 'made up' }, job);
assert.equal(r.ok, 'no', 'a quote that is not in the posting is not trusted');
r = check({ verdict: 'NO', quote: 'UK residents only', reason: 'UK only' }, { ...job, text: 'UK residents only.' });
assert.equal(r.ok, 'no'); assert.match(r.why, /^Not open to Nigeria/);
r = check({ verdict: 'UNCLEAR', quote: '', reason: 'No location rules' }, job);
assert.equal(r.ok, 'no'); assert.match(r.why, /^Not clearly open to Nigeria/);
console.log('Nigeria check tests passed');
