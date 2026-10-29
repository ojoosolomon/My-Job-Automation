// Simulates Google's responses to check the model-rotation logic in gemini_().
const fs = require('fs'), path = require('path'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
function run(responses) {
  const props = { GEMINI_API_KEY: 'k' }, calls = [], logs = [];
  const env = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
    Utilities: { formatDate: () => '2026-10-23', sleep: () => {} },
    SpreadsheetApp: { getActive: () => ({ getSheetByName: () => ({ appendRow: r => logs.push(r[1] + ' ' + r[2]) }) }) },
    UrlFetchApp: { fetch: (url) => {
      calls.push(url);
      if (url.includes('/models?')) return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ models: [
        { name: 'models/gemini-9.9-flash', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-2.5-flash-lite', supportedGenerationMethods: ['generateContent'] }] }) };
      const m = url.match(/models\/([^:]+):/)[1];
      const r = responses[m] || [429, 'limit: 0'];
      return { getResponseCode: () => r[0], getContentText: () => r[0] === 200 ? JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }) : r[1] };
    } }
  };
  const fn = new Function(...Object.keys(env), src + '\nreturn { gemini_, props: null };');
  const api = fn(...Object.values(env));
  let out, err;
  try { out = api.gemini_('s', 'u', {}); } catch (e) { err = e.message; }
  return { out, err, calls, logs, props };
}
// newest model has no free allowance; next one works
let r = run({ 'gemini-9.9-flash': [429, 'Quota exceeded ... limit: 0, model: gemini-9.9-flash'], 'gemini-2.5-flash': [200] });
assert.deepEqual(r.out, { ok: true });
assert(r.logs.some(l => l.includes('GEMINI_MODEL_SWITCH') && l.includes('gemini-9.9-flash')));
assert(JSON.parse(r.props.GEMINI_EXHAUSTED).models.includes('gemini-9.9-flash'));
// everything used up -> clear daily-limit error with Google's message
r = run({ 'gemini-9.9-flash': [429, 'GenerateRequestsPerDayPerProjectPerModel-FreeTier'], 'gemini-2.5-flash': [429, 'PerDay'], 'gemini-2.5-flash-lite': [429, 'PerDay'] });
assert(/GEMINI_DAILY_LIMIT/.test(r.err) && /HTTP 429/.test(r.err), r.err);
// per-minute limit: waits and retries the same model
let n = 0;
r = run({ 'gemini-9.9-flash': [429, 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier'], 'gemini-2.5-flash': [200] });
assert.deepEqual(r.out, { ok: true });
console.log('Gemini rotation tests passed');
