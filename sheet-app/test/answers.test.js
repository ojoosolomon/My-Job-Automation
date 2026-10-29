// The Sheet's "answers" step end to end with a simulated Gemini reply: only answers true to her CV come back.
const fs = require('fs'), path = require('path'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
const sheet = (rows) => ({ rows, getDataRange: () => ({ getValues: () => rows.map(x => x.slice()) }), appendRow: (x) => rows.push(x) });
const profile = sheet([['Field', 'Value'], ['cv_text', 'Co-led state audits of care plan approvals. 7+ years.'],
  ['location', 'Washington, DC 20005'], ['work_authorized_us', 'Yes'], ['requires_sponsorship', 'No']]);
const log = sheet([['Time', 'Event', 'Details']]);
const store = { GEMINI_MODELS: '["gemini-2.5-flash"]', GEMINI_API_KEY: 'k' };
let sent;
const reply = { answers: [
  { question: 'Do you have Epic certification?', kind: 'fact', answer: 'No', evidence: '' },
  { question: 'Do you have HEDIS experience?', kind: 'fact', answer: 'Yes', evidence: 'HEDIS' },
  { question: 'Describe your audit experience', kind: 'fact', answer: 'I co-led state audits of care plan approvals.',
    evidence: 'Co-led state audits of care plan approvals' },
  { question: 'Willing to travel?', kind: 'preference', answer: 'Yes', evidence: '' }] };
const env = {
  SpreadsheetApp: { getActive: () => ({ getSheetByName: (n) => n === 'Profile' ? profile : log }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => store[k] || null, setProperty: (k, v) => { store[k] = v; } }) },
  UrlFetchApp: { fetch: (url, o) => { sent = JSON.parse(o.payload); return { getResponseCode: () => 200,
    getContentText: () => JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] } }] }) }; } },
  Utilities: { formatDate: () => '2026-10-27', sleep() {} }, Session: { getScriptTimeZone: () => 'UTC' },
  DriveApp: {}, MailApp: {}, LockService: {}, ContentService: {}
};
const api = new Function(...Object.keys(env), src + '\nreturn { cvAnswers_ };')(...Object.values(env));
const qs = reply.answers.map(a => ({ question: a.question, options: /Describe/.test(a.question) ? [] : ['Yes', 'No'], type: 'select' }));
const got = api.cvAnswers_(qs);
assert.deepEqual(got, { 'Do you have Epic certification?': 'No',
  'Describe your audit experience': 'I co-led state audits of care plan approvals.' });
assert(sent.contents[0].parts[0].text.includes('Washington'), 'profile facts are part of the source');
console.log('CV answers tests passed');
