// Fake Google Docs objects that behave like the real ones (Paragraph.setText returns nothing). Checks the ATS layout.
const fs = require('fs'), path = require('path'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
function run(build) {
  const paras = [], page = {};
  function Para(t, kind) {
    const p = { text: t, kind, align: null, bold: false, font: null, glyph: null, setText(x) { p.text = x; },
      setSpacingBefore() { return p; }, setSpacingAfter() { return p; }, setLineSpacing() { return p; },
      setAlignment(a) { p.align = a; return p; }, setIndentStart() { return p; }, setIndentFirstLine() { return p; },
      setGlyphType(g) { p.glyph = g; return p; },
      editAsText() { const t = { setFontFamily: (f) => { p.font = f; return t; }, setFontSize: () => t, setBold: (a, b, c) => { if (c === undefined) p.bold = a; else p.boldRange = [a, b]; return t; },
        setItalic: (i) => { p.italic = i; return t; }, setUnderline: () => t, setForegroundColor: (c) => { p.color = c; return t; } }; return t; },
      asParagraph() { return p; } };
    paras.push(p); return p;
  }
  const body = { first: null, getChild() { return body.first; }, appendParagraph: (t) => Para(t, 'p'), appendListItem: (t) => Para(t, 'li'),
    appendHorizontalRule() { paras.push({ text: '', kind: 'hr' }); },
    setPageWidth(w) { page.w = w; return body; }, setPageHeight(h) { page.h = h; return body; },
    setMarginLeft() { return body; }, setMarginRight() { return body; }, setMarginTop() { return body; }, setMarginBottom() { return body; } };
  body.first = Para('', 'p');
  const env = {
    DocumentApp: { create: () => ({ getBody: () => body, saveAndClose() {}, getId: () => 'DOC1' }),
      HorizontalAlignment: { CENTER: 'C', JUSTIFY: 'J', LEFT: 'L' }, GlyphType: { BULLET: 'BULLET' } },
    DriveApp: { getFileById: () => ({ moveTo() {} }) },
    PropertiesService: {}, UrlFetchApp: {}, SpreadsheetApp: {}, Utilities: { formatDate: () => 'October 28, 2026' },
    Session: { getScriptTimeZone: () => 'UTC' }
  };
  const api = new Function(...Object.keys(env), src + '\nreturn { buildResumeDoc_, buildCoverDoc_ };')(...Object.values(env));
  build(api);
  return { paras, page };
}
const p = { full_name: 'Test Person', location: 'Abuja, FCT', phone: '1', email: 'e', linkedin: '' };
const pkg = { headline: 'H', summary: 'S', competencies: ['A', 'B'], education: ['Ed'], certifications: ['C'],
  experience: [{ title: 'T', employer: 'E', dates: 'D', location: 'L', bullets: ['b1', 'b2'] }], cover_letter_paragraphs: ['One.', 'Two.'] };
const r = run((api) => api.buildResumeDoc_(p, pkg, 'name', {}));
const text = r.paras.map(x => x.text);
assert.equal(r.paras[0].text, 'TEST PERSON');
assert(r.paras.filter(x => x.kind === 'hr').length >= 5, 'a rule under each section heading');
assert.deepEqual([r.page.w, r.page.h], [595.3, 841.9], 'A4');
for (const h of ['SUMMARY', 'SKILLS', 'EXPERIENCE', 'EDUCATION', 'CERTIFICATIONS']) assert(text.includes(h), h);  // Source of Truth: standard headings only
assert(text.includes('A | B'), 'skills on one pipe-separated line');
const bullets = r.paras.filter(x => x.kind === 'li');
assert.deepEqual(bullets.map(x => x.text), ['b1', 'b2'], 'real bullets, no typed ● characters');
assert(bullets.every(x => x.glyph === 'BULLET' && x.align === 'J'), 'bullets justified');
assert.equal(r.paras.find(x => x.text === 'S').align, 'J', 'summary justified');
assert(text.includes('T | E') && r.paras.find(x => x.text === 'D | L').italic, 'title | employer, then dates | location in italics');
assert(r.paras.filter(x => x.kind !== 'hr').every(x => x.font === 'Calibri'), 'one standard font');
const titleLine = r.paras.find(x => x.text === 'T | E');
assert.deepEqual(titleLine.boldRange, [0, 0], 'only the job title is bold');
assert(r.paras.find(x => x.text === 'H' && x.align === 'C'), 'tagline under the name');
const c = run((api) => api.buildCoverDoc_(p, pkg, { employer: 'Acme', title: 'Analyst' }, 'cover', {}));
assert(c.paras.some(x => x.text === 'Re: Application for Analyst'));
assert.equal(c.paras[0].text, 'TEST PERSON', 'same header as the resume');
assert(c.paras.some(x => x.text === 'Acme' && x.bold), 'employer block');
assert(c.paras.filter(x => /^(One|Two)\.$/.test(x.text)).every(x => x.align === 'J'), 'letter paragraphs justified');
console.log('document-building test passed');
