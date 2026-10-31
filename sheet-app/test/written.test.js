// Which applications the applier may try, and written answers checked against the CV.
const fs = require('fs'), path = require('path'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
let reply = null;
const env = {
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => k === 'GEMINI_MODELS' ? '["gemini-2.5-flash-lite"]' : k === 'GEMINI_API_KEY' ? 'k' : null,
    setProperty() {} }) },
  Utilities: { formatDate: () => '2026-10-31', sleep() {} },
  SpreadsheetApp: { getActive: () => ({ getSheetByName: () => ({ appendRow() {}, getDataRange: () => ({ getValues: () => [['App ID'], ] }) }) }) },
  UrlFetchApp: { fetch: () => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] } }] }) }) }
};
const api = new Function(...Object.keys(env), src + '\nleverBlocked_ = function () { return false; };\nreturn { canTry_, tierOf_, writtenAnswers_ };')(...Object.values(env));
assert.equal(api.canTry_('greenhouse', 'https://boards.greenhouse.io/x'), true);
assert.equal(api.canTry_('other', 'https://careers.acme.com/jobs/1'), true, 'an employer careers page without login is tried');
assert.equal(api.canTry_('other', 'https://acme.wd1.myworkdayjobs.com/job/1'), false, 'Workday needs an account');
assert.equal(api.canTry_('other', 'https://www.linkedin.com/jobs/view/1'), false);
assert.equal(api.canTry_('other', 'https://himalayas.app/companies/acme/jobs/x'), false, 'a job board page is not the application');
assert.equal(api.canTry_('email-special', 'mailto:x@gmail.com'), false);
assert.deepEqual([api.tierOf_('greenhouse', false, ''), api.tierOf_('other', false, 'https://careers.acme.com/1'),
  api.tierOf_('other', false, 'https://acme.wd1.myworkdayjobs.com/1')], [1, 2, 3]);
// written answers: accepted only when the independent check finds every claim in the CV
const qs = [{ question: 'Describe your experience supporting Apple macOS in a professional environment', options: [], type: 'textarea' },
  { question: 'Tell us about a process you automated', options: [], type: 'textarea' },
  { question: 'Why do you want this job?', options: [], type: 'textarea' }];
const items = [
  { question: qs[0].question, kind: 'fact', answer: 'macOS support has not been a main part of my work so far. I support remote teams with Google Workspace and Slack.', evidence: '' },
  { question: qs[1].question, kind: 'fact', answer: 'I built AI-assisted workflow automation with n8n and Zapier that cut turnaround times by over 50%.', evidence: '' },
  { question: qs[2].question, kind: 'other', answer: 'I led 40 people at Google.', evidence: '' }];
reply = { results: [{ question: qs[0].question, supported: true, unsupported: '' }, { question: qs[1].question, supported: true, unsupported: '' },
  { question: qs[2].question, supported: false, unsupported: 'Google, 40 people' }] };
const got = api.writtenAnswers_(items, qs, 'Google Workspace, Slack. Built workflow automation with n8n and Zapier, reducing turnaround times by over 50%.', {});
assert.deepEqual(Object.keys(got), [qs[0].question, qs[1].question], JSON.stringify(got));
console.log('written answers and site rules tests passed');
