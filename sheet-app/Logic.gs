/**
 * JJ-Board Sheet app: pure logic (no Google services), shared by the Sheet script and the Node tests.
 */

var ROLE_FAMILY = {  // "analyst" and "expert" titles are not in your role buckets: they match only word for word
  specialist: 'ic', associate: 'ic', coordinator: 'ic', officer: 'ic', administrator: 'ic', generalist: 'ic',
  bookkeeper: 'ic', writer: 'ic', assistant: 'ic', representative: 'ic', agent: 'ic',
  advocate: 'ic', rep: 'ic', manager: 'mgmt', lead: 'mgmt', supervisor: 'mgmt', head: 'mgmt'
};
// What a title is about. Two titles of the same family (e.g. "Executive Assistant" and "Virtual Assistant") that share
// one of these count as similar.
var CONCEPTS = {
  admin: ['executive', 'virtual', 'administrative', 'admin', 'personal', 'office', 'secretary', 'scheduling', 'calendar',
    'clerical', 'assistant', 'receptionist', 'ea', 'va'],
  operations: ['operations', 'ops', 'business', 'workflow', 'process', 'project', 'program', 'coordination',
    'implementation', 'delivery', 'strategy'],
  finance: ['finance', 'financial', 'bookkeeping', 'bookkeeper', 'accounts', 'payable', 'receivable', 'payroll', 'billing',
    'reconciliation', 'invoicing'],
  support: ['customer', 'client', 'support', 'service', 'success', 'experience', 'helpdesk', 'care', 'onboarding',
    'happiness', 'cx'],
  automation: ['automation', 'ai', 'workflow', 'nocode', 'zapier', 'integration', 'integrations', 'systems', 'prompt'],
  content: ['resume', 'content', 'writer', 'writing', 'career', 'documentation']
};
var NEGATIVE_TITLE = ['engineer', 'developer', 'software', 'sales', 'marketing', 'nurse', 'physician', 'rn', 'lpn', 'intern',
  'therapist', 'pharmacist', 'attorney', 'counsel', 'lawyer', 'scientist', 'accountant', 'cpa', 'driver', 'technician',
  'designer', 'director', 'vp', 'vice', 'chief', 'principal', 'teacher', 'tutor', 'translator', 'recruiter', 'trader',
  'analyst', 'flight', 'procurement', 'sql', 'edi', 'claims', 'fp', 'actuarial', 'underwriter', 'pilot', 'mechanic'];
// A region in the title ("Support Specialist - LATAM", "Executive Assistant (UK)") limits the job to that region.
var TITLE_REGION_CASE = /(^|[\s(\[,\/-])(LATAM|LatAm|APAC|EMEA|NAMER|NA|EU|UK|US|USA|U\.S\.|ANZ|DACH|CET|EST|PST)($|[\s)\],\/-])/;
var TITLE_REGION = /\b(latin america|north america|americas|canada|europe|india|philippines|brazil|mexico|germany|france|spain|australia|japan|nordics|united states|united kingdom|south africa|kenya|egypt|poland|netherlands|zurich|london|berlin|toronto|new york|singapore)\b/i;
// What may be left in a location after "Remote" without naming a place.
var LOCATION_FILLER = /\b(remote|flexible|full[- ]?time|part[- ]?time|contract(or)?|permanent|temporary|freelance|optional|home|based|first|only|friendly|team|company|any|location|work|from|job|position|opportunity|role|global|distributed|virtual|telecommute|wfh|and|or|in|the|of|us)\b/ig;

function words_(s) {
  return String(s || '').toLowerCase().replace(/&/g, ' and ').match(/[a-z]+/g) || [];
}

function concepts_(ws) {
  var out = {};
  ws.forEach(function (w) {
    Object.keys(CONCEPTS).forEach(function (c) { if (CONCEPTS[c].indexOf(w) >= 0) out[c] = true; });
  });
  return out;
}

/** Returns {match: 'exact'|'similar'|'none', target}. */
function matchTitle(title, targets) {
  var tw = words_(title);
  if (tw.some(function (w) { return NEGATIVE_TITLE.indexOf(w) >= 0; })) return { match: 'none', target: null };
  var norm = ' ' + tw.join(' ') + ' ';
  var best = { match: 'none', target: null, score: 0 };
  for (var i = 0; i < targets.length; i++) {
    var t = String(targets[i]).split('–')[0].split(' - ')[0];
    var tt = words_(t);
    if (!tt.length) continue;
    if (norm.indexOf(' ' + tt.join(' ') + ' ') >= 0) return { match: 'exact', target: targets[i] };
    var famT = {}, famJ = {};
    tt.forEach(function (w) { if (ROLE_FAMILY[w]) famT[ROLE_FAMILY[w]] = true; });
    tw.forEach(function (w) { if (ROLE_FAMILY[w]) famJ[ROLE_FAMILY[w]] = true; });
    var shareFam = Object.keys(famT).some(function (f) { return famJ[f]; });
    if (!shareFam) continue;
    var ct = concepts_(tt), cj = concepts_(tw);
    var shared = Object.keys(ct).filter(function (c) { return cj[c]; }).length;
    var content = tt.filter(function (w) { return !ROLE_FAMILY[w] && w !== 'and'; });
    var overlap = content.filter(function (w) { return tw.indexOf(w) >= 0; }).length / Math.max(1, content.length);
    var score = 0.4 * (shared > 0 ? 1 : 0) + 0.2 * shared + 0.4 * overlap;
    if (score > best.score) best = { match: score >= 0.6 ? 'similar' : 'none', target: targets[i], score: score };
  }
  return { match: best.match, target: best.target };
}

// ---- Who may apply: only jobs that hire someone living and working from Nigeria are kept.
var OK_NIGERIA = /\b(nigeria|nigerian|lagos|abuja)\b/i;
var OK_AFRICA = /\b(africa|african|sub-?saharan|west africa)\b/i;
var OK_WORLD = /\b(world-?wide|anywhere|global(ly)?|international(ly)?|any (country|location|time ?zone)|all (countries|locations)|work from anywhere)\b/i;
// African countries other than Nigeria: "Remote - South Africa" or "Kenya" does not include Nigeria
var OTHER_AFRICAN = /\b(south africa|kenya|ghana|egypt|morocco|tunisia|algeria|uganda|rwanda|tanzania|ethiopia|senegal|cameroon|zambia|zimbabwe|botswana|namibia|mauritius|ivory coast|c[oô]te d.ivoire)\b/i;
var PLACES = /\b(united states|usa|u\.s\.a?\.?|us|america|americas|north america|canada|mexico|latam|latin america|south america|brazil|argentina|colombia|chile|peru|uk|united kingdom|england|scotland|britain|ireland|europe|european union|eu|eea|dach|germany|france|spain|portugal|italy|netherlands|belgium|poland|romania|bulgaria|serbia|croatia|ukraine|sweden|norway|denmark|finland|estonia|lithuania|latvia|switzerland|austria|czech( republic)?|hungary|greece|turkey|israel|uae|united arab emirates|dubai|saudi arabia|qatar|india|pakistan|bangladesh|sri lanka|nepal|philippines|indonesia|vietnam|thailand|malaysia|singapore|japan|korea|china|hong kong|taiwan|australia|new zealand|apac|asia|asia pacific|emea|cet|cest|est|edt|pst|pdt|cst|mst|gmt\s*[+-]?\s*\d*|utc\s*[+-]\s*\d+)\b/i;
var STRICT_COUNTRIES = 'u\\.s\\.a?\\.?|usa|united states|america|canada|uk|u\\.k\\.|united kingdom|britain|england|ireland|eu|european union|europe|eea|germany|france|spain|portugal|netherlands|poland|india|philippines|australia|new zealand|brazil|mexico|latam|latin america|singapore|israel|south africa|kenya|ghana|egypt';
var RESTRICTIONS = [
  [new RegExp('\\b(must|need to|required to|should|have to|will need to)\\s+(currently\\s+)?(be\\s+)?(currently\\s+)?(reside|residing|live|living|located|based|be based|a resident)\\s+(with)?in\\s+(the\\s+)?(' + STRICT_COUNTRIES + ')\\b', 'i'), 'requires living in'],
  [new RegExp('\\b(' + STRICT_COUNTRIES + ')[- ](only|residents? only|based (candidates )?only|candidates only)\\b', 'i'), 'only open to'],
  [new RegExp('\\b(only (open|available) to|only (considering|accepting|hiring)|open only to)\\s+(candidates|applicants|residents|people|those)?\\s*(who are\\s+)?(based|located|living|residing)?\\s*(in\\s+)?(the\\s+)?(' + STRICT_COUNTRIES + ')\\b', 'i'), 'only open to'],
  [new RegExp('\\b(authori[sz]ed|eligible|legally (able|permitted|allowed)|permitted|right) to work (in|for|within) (the\\s+)?(' + STRICT_COUNTRIES + ')\\b', 'i'), 'needs the right to work in'],
  [/\b(in|within|from) the (US|USA)\b|\b(US|USA)[- ](only|based only|residents? only|candidates only)\b/, 'only open to the US'],
  [/\b(u\.?s\.? citizens?(hip)?|green card|security clearance|public trust clearance|\bw-?2\b|\b1099\b|social security number|\bssn\b)/i, 'needs US status'],
  [/\b(must|need to|required to|should|have to)\s+(currently\s+)?(be\s+)?(reside|residing|live|living|located|based|a resident)\s+(with)?in\s+(the\s+state\s+of\s+)?(alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming|ontario|quebec|british columbia|alberta)\b/i, 'requires living in a US state or Canadian province'],
  [/\b(not (open|available) to|cannot (hire|consider|accept)|unable to (hire|consider|accept)|excluding|except( for)?|not hiring in)\b[^.]{0,80}\b(africa|nigeria)\b/i, 'excludes Africa/Nigeria']
];
var POSITIVE_TEXT = /\b(hire|hiring|work|candidates|applicants|team members?|people|talent)\b[^.]{0,60}\b(from )?(anywhere in the world|anywhere|worldwide|any country|around the world|globally|all over the world)\b|\b(fully distributed|remote-first|remote first)\b[^.]{0,80}\b(anywhere|worldwide|any country|globally)\b/i;
var POSITIVE_AFRICA = /\b(hire|hiring|based|located|candidates|applicants|open)\b[^.]{0,60}\b(nigeria|africa|african)\b/i;

/**
 * Can someone living in Nigeria get this remote job? Returns {ok: 'yes'|'no'|'review', why}.
 * 'yes': remote and the location (or the posting) clearly includes Nigeria, Africa or anywhere in the world.
 * 'no': on-site/hybrid, or restricted to other countries (US only, "must live in the UK", "authorized to work in the US"...).
 * 'review': remote but unclear (e.g. just "Remote" or "EMEA"): checked by Gemini before preparing.
 */
function openToNigeria(location, text, workplaceType, title) {
  var loc = String(location || '').replace(/\s+/g, ' ').trim();
  var tl = String(title || ''), tr = tl.match(TITLE_REGION_CASE) || tl.match(TITLE_REGION);
  if (tr && !OK_NIGERIA.test(tl) && !/\bafrica\b/i.test(tl)) return { ok: 'no', why: 'Title limits it to a region: "' + tl.slice(0, 80) + '"' };
  var body = String(text || '').replace(/\s+/g, ' ');
  var wt = String(workplaceType || '').toLowerCase().replace(/[^a-z]/g, '');
  var all = loc + ' ' + body;
  var remote = /remote|work from home|wfh|anywhere|world-?wide|distributed|telecommut/i.test(loc) || wt === 'remote' ||
    /\b(fully|100%) remote\b|\bremote-first\b|\bremote first\b|\bremote (role|position|job|opportunity)\b/i.test(body.slice(0, 6000));
  if (wt === 'onsite' || wt === 'hybrid' || (/\b(hybrid|on-?site|in[- ]office)\b/i.test(loc) && !/remote/i.test(loc)))
    return { ok: 'no', why: 'Not remote (' + (wt || loc).slice(0, 60) + ')' };
  if (!remote) return { ok: 'no', why: 'Not a remote job' + (loc ? ' (' + loc.slice(0, 60) + ')' : '') };
  for (var i = 0; i < RESTRICTIONS.length; i++) {
    var m = all.match(RESTRICTIONS[i][0]), rule = RESTRICTIONS[i][1];
    if (!m) continue;
    if (rule !== 'excludes Africa/Nigeria' && (OK_NIGERIA.test(m[0]) || /\bafrica\b/i.test(m[0].replace(/south africa/ig, '')))) continue;
    return { ok: 'no', why: 'Posting ' + rule + ': "' + m[0].slice(0, 90) + '"' };
  }
  var locAfrica = OK_AFRICA.test(loc.replace(/south africa/ig, ''));
  if (OK_NIGERIA.test(loc)) return { ok: 'yes', why: 'Location includes Nigeria: ' + loc.slice(0, 80) };
  if (locAfrica) return { ok: 'yes', why: 'Location includes Africa: ' + loc.slice(0, 80) };
  if (OK_WORLD.test(loc) && !PLACES.test(loc.replace(OK_WORLD, ' '))) return { ok: 'yes', why: 'Open worldwide: ' + loc.slice(0, 80) };
  if (OTHER_AFRICAN.test(loc)) return { ok: 'no', why: 'Only open to ' + loc.slice(0, 80) };
  var places = loc.replace(/\bremote\b/ig, ' ').replace(OK_WORLD, ' ');
  if (PLACES.test(places)) {
    if (/\bemea\b/i.test(loc) && !/\b(uk|united kingdom|europe|eu|germany|france|spain|netherlands|poland|portugal|ireland)\b/i.test(loc))
      return { ok: 'review', why: 'EMEA: may or may not include Nigeria' };
    if (OK_WORLD.test(loc)) return { ok: 'review', why: 'Mixed location: ' + loc.slice(0, 80) };
    if (/^\W*(remote)?\W*(\(?\s*(cet|cest|est|edt|pst|pdt|cst|mst|gmt\s*[+-]?\s*\d*|utc\s*[+-]\s*\d+)[^a-z]*\)?)\W*$/i.test(loc))
      return { ok: 'review', why: 'Time zone given, country unclear: ' + loc.slice(0, 60) };
    return { ok: 'no', why: 'Only open to ' + loc.slice(0, 80) };
  }
  // a place we don't know by name ("Remote - Zürich", "New York, NY (Remote)") still limits the job to that place
  var rest = loc.replace(OK_WORLD, ' ').replace(LOCATION_FILLER, ' ').replace(/[^A-Za-zÀ-ÿ]+/g, ' ').trim();
  if (/[A-Za-zÀ-ÿ]{3,}/.test(rest)) return { ok: 'no', why: 'Only open to ' + loc.slice(0, 80) };
  if (POSITIVE_AFRICA.test(body.replace(/south africa/ig, ' '))) return { ok: 'yes', why: 'Posting says it hires in Nigeria/Africa' };
  if (POSITIVE_TEXT.test(body)) return { ok: 'yes', why: 'Posting says it hires from anywhere' };
  if (OK_WORLD.test(loc)) return { ok: 'yes', why: 'Open worldwide: ' + loc.slice(0, 80) };
  return { ok: 'review', why: 'Location rules unclear' + (loc ? ' (' + loc.slice(0, 60) + ')' : '') };
}

/**
 * When a job was posted, as a Date (or null if unknown). Takes a Date, an ISO/RFC date string, or Unix time in seconds or
 * milliseconds.
 */
function postedDate(posted) {
  if (posted === null || posted === undefined || posted === '') return null;
  var d = posted instanceof Date ? posted : typeof posted === 'number' || /^\d{9,13}$/.test(String(posted)) ?
    new Date(Number(posted) * (Number(posted) < 1e11 ? 1000 : 1)) : new Date(String(posted));
  return isNaN(d.getTime()) ? null : d;
}

/** Posted within the last `hours` hours? A job with no known posting date does not count as recent. */
function postedWithin(posted, hours, now) {
  var d = postedDate(posted);
  if (!d) return false;
  var age = (now ? new Date(now).getTime() : Date.now()) - d.getTime();
  return age <= hours * 3600e3 && age > -24 * 3600e3;  // allow small clock/time-zone differences for "future" dates
}

var MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
/** "Sept. 2023", "Sep 2023" and "September 2023" all become "september 2023". */
function normDates_(t) {
  return String(t || '').toLowerCase().replace(/\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?(?=\s|,|$)/g, function (m, a) {
    return MONTHS[['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(a.slice(0, 3))];
  }).replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
}

function numbersIn(text) {
  var m = String(text || '').match(/\d[\d,]*(?:\.\d+)?%?/g) || [];
  return m.map(function (n) { return n.replace(/,/g, '').replace(/\.$/, ''); });
}

/** Deterministic fact check of an AI-written package against the CV (source of truth). Returns list of problems. */
function checkPackage(pkg, cvText) {
  var problems = [];
  var cv = String(cvText).toLowerCase().replace(/\s+/g, ' ');
  var cvNums = {};
  numbersIn(cvText).forEach(function (n) { cvNums[n] = true; });
  function textOf() {
    var parts = [pkg.headline, pkg.summary].concat(pkg.competencies || [], pkg.certifications || [], pkg.education || [],
      pkg.cover_letter_paragraphs || []);
    (pkg.experience || []).forEach(function (e) { parts = parts.concat([e.title, e.employer, e.dates], e.bullets || []); });
    return parts.join(' \n ');
  }
  numbersIn(textOf()).forEach(function (n) {
    if (!cvNums[n] && !cvNums[n.replace('%', '')]) problems.push('Number "' + n + '" is not in your CV');
  });
  (pkg.experience || []).forEach(function (e) {
    if (e.title && cv.indexOf(String(e.title).toLowerCase().trim()) < 0) problems.push('Job title not in CV: ' + e.title);
    if (e.employer && cv.indexOf(String(e.employer).toLowerCase().trim()) < 0) problems.push('Employer not in CV: ' + e.employer);
    var cvDates = normDates_(cv);
    String(e.dates || '').split(/\s*(?:–|—|-|to)\s*/).forEach(function (d) {
      d = normDates_(d.trim());
      if (d && !/^(present|current|now|today)$/.test(d) && cvDates.indexOf(d) < 0) problems.push('Date not in CV: ' + d);
    });
    if (!(e.bullets || []).length) problems.push('No bullets for ' + e.title);
  });
  (pkg.certifications || []).concat(pkg.education || []).forEach(function (c) {
    var key = words_(c).filter(function (w) { return w.length > 3; });
    var hits = key.filter(function (w) { return cv.indexOf(w) >= 0; }).length;
    if (key.length && hits / key.length < 0.7) problems.push('Education/certification not in CV: ' + c);
  });
  return problems;
}

/** Screening-question answers come only from your Profile, never from AI. */
function answerFor(label, profile) {
  var l = String(label || '').toLowerCase();
  if (/sponsor/.test(l)) return profile.requires_sponsorship || null;
  if (/authori[sz](ed|ation) to work|work authori[sz]ation|right to work|legally (able|eligible|permitted|authori[sz]ed) to work|(eligible|permitted|able) to work (in|for)|legally work|eligible for employment/.test(l))
    return workAuthorized(l, profile);
  if (/desired salary|salary expectation|compensation expectation/.test(l)) return profile.desired_salary || null;
  if (/linkedin/.test(l)) return profile.linkedin || null;
  return null;
}

/**
 * Work authorization depends on the country asked about: Yes for the countries in Profile → work_authorized_countries
 * (default: your country, e.g. Nigeria), No for any other named country, and Profile → work_authorized (Yes) when the
 * question names no country ("Are you authorized to work in the country where you live?").
 */
var COUNTRY_WORDS = /\b(united states|u\.s\.a?\.?|usa|america|canada|united kingdom|u\.k\.|uk|britain|england|ireland|european union|eu|europe|eea|germany|france|spain|portugal|netherlands|poland|india|philippines|australia|new zealand|brazil|mexico|singapore|israel|south africa|kenya|ghana|egypt|uae|nigeria|switzerland|sweden|japan)\b/i;
function workAuthorized(label, profile) {
  var l = String(label || '').toLowerCase();
  var mine = String(profile.work_authorized_countries || profile.country || 'Nigeria').toLowerCase().split(/[,;\n]+/)
    .map(function (x) { return x.trim(); }).filter(String);
  if (mine.some(function (c) { return l.indexOf(c) >= 0; })) return 'Yes';
  if (/\bus\b/.test(String(label || '').replace(/\b(for|with|join|contact|tell) us\b/ig, '')) && /\b(in|within|for) (the )?us\b/i.test(l)) return 'No';
  if (COUNTRY_WORDS.test(l)) return 'No';
  return profile.work_authorized || profile.work_authorized_us || null;
}

var EMAIL_RULES = [
  ['HIRED', /welcome (to the team|aboard)|your (first day|start date) (is|will be)|(employment|contractor|service) (contract|agreement) (attached|for (your )?signature)|onboarding (details|documents|process|call)|we are (thrilled|excited|delighted) to (have you|welcome you)/i],
  ['OFFER', /offer (letter|of employment)|pleased to offer/i],
  ['REJECTED', /unfortunately|not (be )?(moving|proceed)|other candidates|not selected|decided not to/i],
  ['INTERVIEW', /interview|schedule (a )?(call|time)|availability|calendly/i],
  ['ASSESSMENT', /assessment|take-home|coding challenge|hackerrank|codility/i],
  ['RECEIVED', /(received|thank you for) (your )?appl|application (has been )?(received|submitted)|thanks for applying/i]
];

function classifyEmail(subject, snippet) {
  var t = String(subject || '') + ' ' + String(snippet || '');
  for (var i = 0; i < EMAIL_RULES.length; i++) if (EMAIL_RULES[i][1].test(t)) return EMAIL_RULES[i][0];
  return null;
}

/** Which application does an email belong to? Company name alone is not enough: needs domain or title too. */
var GENERIC_NAME = ['health', 'healthcare', 'care', 'inc', 'llc', 'group', 'labs', 'the', 'and', 'medical', 'clinic', 'services',
  'solutions', 'technologies', 'technology', 'company', 'corp', 'pbc', 'hq', 'co', 'systems', 'partners', 'network', 'medicine',
  'limited', 'ltd', 'global', 'africa', 'nigeria', 'digital', 'remote', 'consulting', 'agency', 'virtual', 'assistants', 'staffing'];
var ATS_SENDERS = /greenhouse|lever\.co|hire\.lever|ashbyhq|workday|myworkday|icims|smartrecruiters|jobvite|workable|bamboohr|applytojob|breezy|recruitee|successfactors|taleo|ultipro|paylocity|adp\.com/;

function nameWords_(employer) {
  var ws = words_(employer).filter(function (w) { return w.length >= 3 && GENERIC_NAME.indexOf(w) < 0; });
  return ws.length ? ws : words_(employer).filter(function (w) { return w.length >= 3; });
}

/**
 * Which application does an email belong to? Its sender domain must be the employer's (its distinctive name or the
 * domain in Companies), or it comes from an application site (Greenhouse, Lever, Workday...) and names the employer.
 */
function matchEmail(email, apps) {
  var t = ' ' + (email.subject + ' ' + email.snippet).toLowerCase().replace(/[^a-z0-9]+/g, ' ') + ' ';
  var dom = String(email.from || '').toLowerCase().split('@')[1] || '';
  var labels = dom.split('.');
  return apps.filter(function (a) {
    var ws = nameWords_(a.employer);
    if (!ws.length) return false;
    var domainHit = (a.domain && (dom === a.domain || dom.slice(-a.domain.length - 1) === '.' + a.domain)) ||
      ws.some(function (w) { return labels.some(function (l) { return l === w || (w.length >= 5 && l.indexOf(w) >= 0); }); });
    var nameHit = ws.every(function (w) { return t.indexOf(' ' + w + ' ') >= 0; });
    var titleHit = words_(a.title).filter(function (w) { return w.length > 3 && GENERIC_NAME.indexOf(w) < 0; })
      .some(function (w) { return t.indexOf(' ' + w + ' ') >= 0; });
    return domainHit || (nameHit && (ATS_SENDERS.test(dom) || titleHit));
  });
}

/**
 * Does the posting ask for applications by email? Returns {email, subjectRule} or null.
 * Only addresses next to apply/send/resume wording count; HR-accommodation, privacy and no-reply addresses are ignored.
 */
function applyEmail(text) {
  var t = String(text || '');
  var re = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, m;
  while ((m = re.exec(t))) {
    var addr = m[0].replace(/\.$/, '');
    var ctx = t.slice(Math.max(0, m.index - 160), m.index + addr.length + 60).toLowerCase();
    if (/no-?reply|privacy|unsubscribe/.test(addr.toLowerCase())) continue;
    if (/accommodat|privacy|questions about|disabilit|unsubscribe|report/.test(ctx)) continue;
    if (/(send|email|e-mail|submit|forward|apply)[^.]{0,80}(resume|cv|cover letter|application)|(resume|cv|application)[^.]{0,60}(to|at)\s*$/.test(ctx.slice(0, ctx.length - addr.length - 60)) ||
        /(apply|applications?|resumes?|cvs?)\s+(to|at|via|by email)/.test(ctx)) {
      return { email: addr, subjectRule: /subject (line|heading)|in the subject|reference (number|code)/i.test(t) };
    }
  }
  return null;
}

var STOP_WORDS = ['about', 'their', 'there', 'which', 'would', 'these', 'other', 'within', 'across', 'including', 'experience',
  'ability', 'skills', 'work', 'working', 'team', 'teams', 'company', 'role', 'position', 'candidate', 'years', 'required',
  'preferred', 'strong', 'excellent', 'benefits', 'equal', 'opportunity', 'employer', 'status', 'applicants', 'without',
  'where', 'while', 'what', 'will', 'with', 'from', 'that', 'this', 'have', 'your', 'they', 'into', 'more', 'must'];

/** How well a job fits you (0-100): title match up to 50, CV keyword overlap up to 40, open to Nigeria 10 (unclear 5). */
function fitScore(job, titles, cvText) {
  var tm = matchTitle(job.title, titles).match;
  var score = tm === 'exact' ? 50 : tm === 'similar' ? 30 : 0;
  var cv = {};
  words_(cvText).forEach(function (w) { cv[w] = true; });
  var seen = {}, kw = [];
  words_(job.text).forEach(function (w) {
    if (w.length < 5 || STOP_WORDS.indexOf(w) >= 0 || seen[w]) return;
    seen[w] = true; kw.push(w);
  });
  if (kw.length) score += Math.round(40 * Math.min(1, 1.5 * kw.filter(function (w) { return cv[w]; }).length / kw.length));
  if (job.remote === 'yes') score += 10;
  else if (job.remote === 'review') score += 5;
  return score;
}

var US_STATES = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut',
  DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana',
  IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan',
  MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire',
  NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma',
  OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas',
  UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming' };
var PACIFIC = ['CA', 'OR', 'WA', 'NV'], MOUNTAIN = ['AZ', 'CO', 'ID', 'MT', 'NM', 'UT', 'WY'],
  CENTRAL = ['AL', 'AR', 'IL', 'IA', 'KS', 'LA', 'MN', 'MS', 'MO', 'NE', 'ND', 'OK', 'SD', 'TN', 'TX', 'WI'];

function stateCode_(name) {
  var n = String(name || '').trim().toLowerCase();
  for (var k in US_STATES) if (US_STATES[k].toLowerCase() === n || k.toLowerCase() === n) return k;
  return '';
}

/**
 * Facts application forms ask for, taken only from your Profile and CV: city/state/ZIP from "location", education
 * and total years of experience from the CV text. Profile fields of the same name, when filled, win.
 */
function formFacts(p) {
  // Profile location, or the address line at the top of your CV when location is blank ("Washington, DC 20005 | ...")
  var loc = String(p.location || '').trim() || String(p.home_location || '').trim() ||
    ((String(p.cv_text || '').match(/[A-Z][A-Za-z.]+(?: [A-Z][A-Za-z.]+)*,\s*[A-Z]{2}\b(?:\s*\d{5})?/) || [''])[0]);
  var m = loc.match(/^\s*([^,]+),\s*([A-Za-z]{2})\b\s*(\d{5})?/);
  if (m && !US_STATES[m[2].toUpperCase()] && /^[A-Za-z]{3,}/.test(loc.slice(loc.indexOf(',') + 1).trim())) m = null;  // "Abuja, FCT"
  var abroad = false;
  if (!m) {  // "Glendale, Maryland 20769", or outside the US: "Abuja, FCT" / "Abuja, Federal Capital Territory, Nigeria"
    var full = loc.match(/^\s*([^,]+),\s*([A-Za-z .()]+?)\s*(\d{5,6})?\s*(?:,\s*([A-Za-z ]+))?\s*$/), code = full && stateCode_(full[2]);
    if (code) m = [full[0], full[1], code, full[3]];
    else if (full) { m = [full[0], full[1], full[2].trim(), full[3], full[4]]; abroad = true; }
  }
  var st = m ? (abroad ? m[2] : m[2].toUpperCase()) : '';
  var country = String(p.country || '').trim() || (abroad ? String(m[4] || '').trim() : 'United States');
  var cv = String(p.cv_text || '');
  var yrs = (cv.match(/(\d{1,2})\+?\s*(?:years|yrs)/i) || [])[1] || '';
  var degLine = (cv.match(/(Bachelor|Master|Associate|Doctor|Ph\.?D|MBA|MPH|MHA)[^\n]*/i) || [''])[0];
  var level = /doctor|ph\.?d/i.test(degLine) ? "Doctorate" : /master|mba|mph|mha/i.test(degLine) ? "Master's Degree" :
    /bachelor/i.test(degLine) ? "Bachelor's Degree" : /associate/i.test(degLine) ? "Associate's Degree" : '';
  var school = (cv.match(/([A-Z][A-Za-z.&' ]+ (?:University|College|Institute))|((?:University|College) of [A-Z][A-Za-z ]+)/) || [''])[0].trim();
  var degree = degLine.split(/,|\s{2,}/)[0].trim();
  var field = (degLine.match(/,\s*([A-Za-z &]+?)(?:\s+[A-Z][a-z]+ (?:University|College)|$|,)/) || [])[1] || '';
  var pick = function (own, derived) { return String(own || '').trim() || derived; };
  return {
    city: pick(p.city, m ? m[1].trim() : ''), state: pick(p.state, st),
    state_name: pick(p.state_name, US_STATES[pick(p.state, st)] || pick(p.state, st)),
    location: loc, zip: pick(p.zip, m && m[3] ? m[3] : ''), country: country, address: String(p.address || '').trim(),
    timezone: pick(p.timezone, abroad || country !== 'United States' ? '' : PACIFIC.indexOf(st) >= 0 ? 'Pacific' :
      MOUNTAIN.indexOf(st) >= 0 ? 'Mountain' : CENTRAL.indexOf(st) >= 0 ? 'Central' : st ? 'Eastern' : ''),
    years_experience: pick(p.years_experience, yrs), highest_degree: pick(p.highest_degree, level), degree: pick(p.degree, degree),
    school: pick(p.school, field && school.indexOf(field.trim() + ' ') === 0 ? school.slice(field.trim().length + 1) : school), field_of_study: pick(p.field_of_study, field.trim()),
    relocate: pick(p.willing_to_relocate, 'No'), notice_period: pick(p.notice_period, '2 weeks'),
    graduation_year: pick(p.graduation_year, ''), education_start_year: pick(p.education_start_year, '')
  };
}

function plain_(t) { return String(t || '').toLowerCase().replace(/[^a-z0-9%+]+/g, ' ').trim(); }

/**
 * Accepts only answers that are true to your record. items: [{question, kind: fact|preference|other, answer, evidence}].
 * - The answer must be one of the form's choices when it has choices.
 * - "No" is accepted for a fact question (a skill, tool, licence or experience your CV doesn't show).
 * - Anything else must quote your CV/Profile word for word (evidence), and any number in it must appear there.
 * - Preference questions (travel, shifts, commuting, relocation...) are never guessed.
 */
function verifyAnswers(items, questions, sourceText) {
  var src = plain_(sourceText), nums = {}, out = {};
  numbersIn(sourceText).forEach(function (n) { nums[n] = true; });
  (items || []).forEach(function (it) {
    var q = (questions || []).filter(function (x) { return x.question === it.question; })[0];
    var ans = String(it.answer == null ? '' : it.answer).trim();
    if (!q || !ans || it.kind === 'preference') return;
    var opts = q.options || [];
    if (opts.length) {
      var hit = opts.filter(function (o) { return plain_(o) === plain_(ans); })[0] ||
        opts.filter(function (o) { return plain_(o).indexOf(plain_(ans)) === 0 && plain_(ans).length >= 2; })[0];
      if (!hit) return;
      ans = hit;
    }
    var isNo = /^(no|false|n)\b/i.test(plain_(ans)) || /^no[ ,]/i.test(ans) || /^(0|none|zero)( years?)?$/i.test(plain_(ans));
    if (isNo) { if (it.kind === 'fact') out[q.question] = ans; return; }  // "No" / "0 years" for what your CV doesn't show
    var ev = plain_(it.evidence);
    if (ev.length < 4 || src.indexOf(ev) < 0) return;
    if (numbersIn(ans).some(function (n) { return !nums[n] && !nums[n.replace('%', '')]; })) return;
    out[q.question] = ans;
  });
  return out;
}

/**
 * Yearly salary range from structured data ({min, max, interval}) or the posting text. Returns {min, max, text} or null.
 * Hourly pay is turned into yearly (x 2080).
 */
function parseSalary(structured, text) {
  var fmt = function (n) { return '$' + Math.round(n).toLocaleString('en-US'); };
  var year = function (n, hourly) { return hourly ? n * 2080 : n; };
  if (structured && (structured.min || structured.max)) {
    var hr = /hour/i.test(String(structured.interval || ''));
    var lo = year(Number(structured.min || structured.max), hr), hi = year(Number(structured.max || structured.min), hr);
    if (lo > 1000) return { min: lo, max: hi, text: fmt(lo) + (hi !== lo ? ' – ' + fmt(hi) : '') + ' a year' };
  }
  var t = String(text || '');
  var num = function (x) { x = String(x).replace(/[$,\s]/g, ''); return /k$/i.test(x) ? parseFloat(x) * 1000 : parseFloat(x); };
  var money = '\\$\\s?\\d{1,3}(?:,\\d{3})+(?:\\.\\d{2})?|\\$\\s?\\d{2,3}(?:\\.\\d+)?\\s?[kK]|\\$\\s?\\d{2,3}(?:\\.\\d{2})?';
  var re = new RegExp('(' + money + ')\\s*(?:-|–|—|to)\\s*(' + money.replace(/\\\\\$\\\\s\?/g, '\\$?\\s?') + ')(\\s*(?:\\/|per|an|a)\\s*(?:hour|hr))?', 'i');
  var m = t.match(re);
  if (!m) return null;
  var a = num(m[1]), b = num(m[2]), hourly = !!m[3] || (a < 200 && b < 200);
  if (b < 1000 && /k/i.test(m[1]) && !/k/i.test(m[2])) b *= 1000;
  a = year(a, hourly); b = year(b, hourly);
  if (!(a > 10000 && b >= a)) return null;
  return { min: a, max: b, text: fmt(a) + ' – ' + fmt(b) + ' a year' + (hourly ? ' (from hourly pay)' : '') };
}

/**
 * Questions application forms commonly ask, with how each is answered. Shown in the Answers tab so you can see and change
 * every answer. re: a pattern matched against the question (lower case; plain syntax that works in JavaScript and Python).
 * a: the answer used ('' = only you can say: left blank until you fill it in). {placeholders} are filled in when applying.
 * Questions answered from your Profile/CV in code (name, contact, location, work authorization, sponsorship, education,
 * years of experience, how you heard, demographic "decline" answers...) are not repeated here.
 */
var QUESTION_BANK = [
  // citizenship, residence and legal
  { q: 'Are you a U.S. citizen?', re: 'u\\.?s\\.? citizen|citizen of the united states', a: 'No', why: 'You are a Nigerian citizen.' },
  { q: 'Are you a U.S. permanent resident (green card holder)?', re: 'permanent resident|green card', a: 'No', why: 'You live in Nigeria.' },
  { q: 'What is your citizenship / nationality?', re: '^(what is your )?(citizenship|nationality)( status)?\\??$|country of citizenship|which country are you a citizen', a: 'Nigerian', why: 'From your Profile.' },
  { q: 'Which country do you live in / country of residence?', re: 'country of residence|(which|what) country (do )?you (currently )?(live|reside|based)|where are you (currently )?(based|located)\\?? \\(country\\)', a: 'Nigeria', why: 'You live in Abuja, Nigeria.' },
  { q: 'Do you have a valid driver\'s license?', re: 'driver.?s? licen[cs]e|driving licen[cs]e', a: '', why: 'Only you can say.' },
  { q: 'Have you ever been convicted of a felony or crime?', re: 'convicted|conviction|felony|criminal (record|history|offen)|pled guilty|plead guilty', a: '', why: 'Legal statement: only you can answer.' },
  { q: 'Have you ever been terminated or asked to resign?', re: 'terminated|fired|discharged|asked to resign|involuntar', a: '', why: 'Only you can say.' },
  { q: 'Are you bound by a non-compete or non-solicitation agreement?', re: 'non-?compete|non-?solicit|restrictive covenant|agreement.{0,40}(prevent|restrict|limit)', a: '', why: 'Only you can say.' },
  { q: 'Are you a current or former government employee or official?', re: '(current|former).{0,20}government (employee|official)|government official|public official', a: '', why: 'Only you can say.' },
  { q: 'Are you willing to undergo a background check?', re: '(willing|able|consent|agree).{0,40}background (check|screen|verification)', a: 'Yes', why: 'Default: please check.' },
  { q: 'Do you currently hold an active security clearance?', re: 'security clearance|active clearance|(secret|top secret|public trust) clearance', a: 'No', why: 'Your CV lists no clearance.' },
  { q: 'Have you served in the U.S. military?', re: 'served in the (u\\.?s\\.? )?(military|armed forces)|military service|active duty', a: 'No', why: 'Your CV lists no military service.' },
  { q: 'Are you currently employed?', re: '^(are you )?currently employed\\??$', a: 'Yes', why: 'Your CV shows a current role (Femi Associates & Co., August 2025 to present).' },
  { q: 'May we contact your current employer?', re: 'contact your (current|present) employer|may we contact', a: 'No', why: 'Default: protects your current job. Change to Yes if fine.' },
  { q: 'Have you previously worked for us as a contractor or intern?', re: '(worked|work) for us as an? (contractor|intern|consultant)|(contractor|intern|consultant).{0,40}(for us|for this company|previously|before)', a: 'No', why: 'Default: please check.' },
  { q: 'Do you have any conflict of interest with this role?', re: 'conflict of interest', a: 'No', why: 'Default: please check.' },
  // work arrangements (remote from Abuja, any hours)
  { q: 'Are you able to work on-site / in the office?', re: '(work|come|be) (on-?site|in (the )?office|in person)|in-office days|days (per|a) week in (the )?office|hybrid schedule', a: 'No', why: 'You work remotely from Abuja, Nigeria.' },
  { q: 'Are you able to commute to the office location?', re: 'commut', a: 'No', why: 'You work remotely from Abuja, Nigeria.' },
  { q: 'Are you willing to relocate?', re: 'relocat', a: 'No', why: 'Remote roles only.' },
  { q: 'Are you willing to travel for this role?', re: 'travel', a: '', why: 'Only you can say.' },
  { q: 'Are you able to work overtime, evenings, weekends or night shifts when needed?', re: 'overtime|evenings?|weekends?|night shift|graveyard|on-?call|after hours|flexible hours|rotating shifts?', a: 'Yes', why: 'You said you can work at any time.' },
  { q: 'Can you work during US / European business hours or our time zone?', re: '\\b(eastern|est|et|edt|central|cst|pacific|pst|mountain|gmt|bst|cet|uk|us|european|australian|aest)\\b.{0,25}(hours|time ?zone|business)|core hours|(able|willing|comfortable|available|can you|open).{0,40}(hours|time ?zone|shifts?|schedule)|overlap', a: 'Yes', why: 'You said you can work at any time.' },
  { q: 'Are you seeking full-time employment?', re: 'full-?time', a: 'Yes', why: 'Default.' },
  { q: 'Are you open to contract, freelance or part-time work?', re: 'contract(or)? (role|position|work|basis)|freelance|temporary|temp-to-hire|part-?time', a: 'Yes', why: 'Default: please check.' },
  { q: 'Are you comfortable working as an independent contractor?', re: 'independent contractor|as a contractor|contractor agreement|b2b', a: 'Yes', why: 'Remote roles from Nigeria are usually contractor roles.' },
  { q: 'Do you have a quiet home workspace with reliable high-speed internet?', re: 'internet (connection|speed)|reliable internet|high-?speed internet|home office|workspace|work environment.{0,30}(quiet|private)', a: 'Yes', why: 'Default: please check.' },
  { q: 'Do you have backup power and backup internet (generator, inverter, second ISP)?', re: 'backup (power|internet|electricity|connection)|power (outage|supply|backup)|generator|inverter|\\bups\\b|load ?shedding', a: '', why: 'Only you can say (often asked for remote roles in Africa).' },
  { q: 'Do you have your own laptop or computer?', re: 'laptop|own (computer|equipment|device)|(personal|own) pc\\b|computer (that|which) meets', a: '', why: 'Only you can say.' },
  // pay
  { q: 'What is your desired hourly rate (USD)?', re: 'hourly (rate|pay|wage)|rate per hour|desired (rate|wage)|expected (hourly )?rate|usd (rate|per hour)', a: '{hourly}', why: 'From Profile → hourly_rate.' },
  { q: 'What is your expected monthly salary in Naira?', re: 'naira|\\bngn\\b|₦|monthly (salary|pay|compensation|expectation)|(salary|pay) per month', a: '{salary_ngn}', why: 'From Profile → salary_ngn.' },
  { q: 'What is your current or most recent salary?', re: 'current (salary|compensation|pay)|salary history|previous (salary|compensation)|most recent (salary|pay)', a: 'Prefer not to disclose', why: 'Default.' },
  { q: 'Is the posted pay range acceptable to you?', re: '(salary|pay|compensation|rate) range.{0,60}(acceptable|comfortable|aligned?|okay|ok\\b|work for you)|comfortable with the (salary|pay|compensation|rate)', a: 'Yes', why: 'Your range starts at $2 per hour.' },
  { q: 'How would you like to be paid?', re: 'how (would|do) you (like|prefer|want) to (be paid|receive (payment|your pay|payments))|preferred (payment|payout) (method|platform|option)|payment (method|preference)|payout method', a: 'Direct payment to my USD (domiciliary) bank account', why: 'Your preference.' },
  { q: 'Are you comfortable with variable pay or commission?', re: 'variable (pay|compensation)|commission|bonus structure|on-target earnings|\\bote\\b', a: 'Yes', why: 'Default: please check.' },
  // contact and scheduling
  { q: 'Preferred method of contact', re: 'preferred (method|way|mode) of contact|how should we contact|best way to (reach|contact)', a: 'Email', why: 'Default.' },
  { q: 'Phone type', re: '^phone type|type of phone', a: 'Mobile', why: 'Default.' },
  { q: 'WhatsApp number', re: 'whatsapp', a: '{phone}', why: 'Your phone number.' },
  { q: 'Best time to contact you / interview availability', re: 'best time|availability (for|to) (an )?interview|when are you available (for|to) (interview|talk|speak)', a: 'Any time, I am flexible across time zones', why: 'You said you can work at any time.' },
  { q: 'When can you start?', re: 'when can you start|earliest start|available to start|start date|notice period', a: 'Immediately', why: 'Your answer.' },
  { q: 'If other, please specify (how you heard about us)', re: '^if other,? (please )?specify|^other \\(please specify\\)|(hear|source).{0,60}(if other|please specify)', a: 'Company careers website', why: 'Matches your "how did you hear" answer.' },
  { q: 'Name of the employee who referred you', re: '(name of|who).{0,20}refer|referr(er|ing employee)', a: 'N/A', why: 'No referral.' },
  { q: 'Desired position or job title', re: '^(desired (position|job title|role)|position applied for|which position|job title (you are )?applying)', a: '{job_title}', why: 'The job being applied to.' },
  { q: 'Signature (type your full name)', re: 'signature|e-?sign|sign your name|type your (full )?name', a: '{full_name}', why: 'Your name, from the Profile.' },
  { q: 'Today\'s date', re: '^(today.?s )?date$|^date signed|^signature date', a: '{today}', why: 'Filled in automatically.' },
  // skills your CV and Source of Truth do show
  { q: 'Do you have experience working remotely?', re: 'experience working remote|worked remotely|remote work experience|previous(ly)? work(ed)? remote', a: 'Yes', why: 'Remote role at Femi Associates & Co. (New York, USA) since August 2025.' },
  { q: 'Do you have executive / administrative assistant experience?', re: '^(do you have )?(any )?(experience (as an?|in|with) )?(executive|administrative|virtual|personal) (assistant|support)( experience)?\\??$', a: 'Yes', why: 'Your CV shows executive and administrative support.' },
  { q: 'Do you have customer support / customer service experience?', re: '^(do you have )?(any )?(experience (in|with) )?(customer|client) (support|service|success)( experience)?\\??$', a: 'Yes', why: 'Your CV shows 1,600+ customers and client support.' },
  { q: 'Are you proficient in Excel / Google Sheets / Google Workspace?', re: '^(are you )?(proficient|comfortable|experienced|skilled) (in|with) (microsoft )?(excel|google sheets|google workspace|g ?suite|office|microsoft office|office 365|microsoft 365)\\??$', a: 'Yes', why: 'Your CV lists Excel and Google Workspace.' },
  { q: 'Do you have CRM experience (HubSpot, Salesforce, Zoho)?', re: '\\bcrm\\b|hubspot|salesforce|zoho', a: 'Yes', why: 'Your Source of Truth lists CRM systems, HubSpot, Salesforce and Zoho.' },
  { q: 'Do you have help desk / ticketing experience (Zendesk, Intercom, Freshdesk, Help Scout)?', re: 'zendesk|intercom|freshdesk|help ?scout|ticketing', a: 'Yes', why: 'Your Source of Truth lists these tools.' },
  { q: 'Do you have automation experience (Zapier, n8n, Make, Airtable)?', re: 'zapier|\\bn8n\\b|make\\.com|integromat|airtable|workflow automation|no-?code', a: 'Yes', why: 'Your Source of Truth lists Zapier, n8n, Make and Airtable.' },
  { q: 'Do you use AI tools (ChatGPT, Claude, Gemini)?', re: 'chatgpt|\\bclaude\\b|gemini|\\bai tools\\b|generative ai|\\bllm', a: 'Yes', why: 'Your Source of Truth lists ChatGPT, Claude and Gemini.' },
  { q: 'Do you have Slack / ClickUp / Trello experience?', re: '^(do you have )?(any )?(experience (with|using) )?(slack|clickup|trello|notion)( experience)?\\??$', a: 'Yes', why: 'Your Source of Truth lists Slack, ClickUp, Trello and Notion AI.' },
  { q: 'Do you have bookkeeping / reconciliation experience?', re: '^(do you have )?(any )?(experience (with|in) )?(bookkeeping|reconciliation|invoicing|payroll)( experience)?\\??$', a: 'Yes', why: 'Your CV shows bookkeeping, payroll coordination and reconciliation.' },
  { q: 'Do you have QuickBooks / Xero experience?', re: 'quickbooks|\\bxero\\b|sage|wave accounting', a: '', why: 'Not in your CV: only you can say.' },
  { q: 'Do you have Asana / Monday / Jira experience?', re: '\\basana\\b|monday\\.com|\\bjira\\b', a: '', why: 'Not in your CV: only you can say.' },
  { q: 'Do you have SQL / Tableau / Power BI experience?', re: '\\bsql\\b|tableau|power ?bi', a: '', why: 'Not in your CV: only you can say.' },
  { q: 'Do you hold a professional accounting certification (ACCA, ICAN, CPA)?', re: '\\b(acca|ican|cpa|cma|cia)\\b', a: 'No', why: 'Your CV lists no such certification.' },
  { q: 'Do you speak a language other than English?', re: 'spanish|french|portuguese|arabic|german|bilingual|other languages?|languages? (do you )?speak|fluent in', a: '', why: 'Only you can say.' },
  { q: 'What is your typing speed (WPM)?', re: 'typing speed|words per minute|\\bwpm\\b', a: '', why: 'Only you can say.' },
  // agreement-style questions
  { q: 'Do you agree to the company\'s privacy policy / data processing?', re: 'privacy (policy|notice)|data (processing|protection)|gdpr|personal (data|information)', a: 'Yes', why: 'Needed to apply.' },
  { q: 'Data transfer: do you consent to your application data being transferred and processed in other countries?', re: '^data transfer|data transfer (consent|agreement|notice)|consent to (the )?(international )?(transfer|processing) of (my |your )?(personal )?data|transfer (of )?(my |your )?(personal )?data (outside|to other|internationally|across)', a: 'Yes', why: 'Needed to apply from Nigeria to a foreign employer.' },
  { q: 'Do you agree to an arbitration agreement?', re: 'arbitration', a: 'Yes', why: 'Default: please check.' },
  { q: 'Will you sign a confidentiality / NDA agreement if hired?', re: 'confidentiality|non-?disclosure|\\bnda\\b', a: 'Yes', why: 'Default.' },
  { q: 'Will you complete a pre-employment assessment or trial task if asked?', re: 'assessment|skills test|work sample|trial (task|project|period)|test task', a: 'Yes', why: 'Default.' },
  { q: 'Are you able to perform the essential functions of the job, with or without reasonable accommodation?', re: 'essential functions', a: 'Yes', why: 'Standard question.' }
];

if (typeof module !== 'undefined') {
  module.exports = { matchTitle: matchTitle, openToNigeria: openToNigeria, numbersIn: numbersIn, checkPackage: checkPackage,
    answerFor: answerFor, workAuthorized: workAuthorized, classifyEmail: classifyEmail, matchEmail: matchEmail, applyEmail: applyEmail,
    fitScore: fitScore, formFacts: formFacts, postedDate: postedDate, postedWithin: postedWithin, verifyAnswers: verifyAnswers, parseSalary: parseSalary, QUESTION_BANK: QUESTION_BANK };
}
