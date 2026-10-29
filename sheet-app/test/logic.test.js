const assert = require('assert');
const fs = require('fs'), path = require('path');
const L = (() => { const m = { exports: {} }; new Function('module', fs.readFileSync(path.join(__dirname, '..', 'Logic.gs'), 'utf8'))(m); return m.exports; })();
const T = ['Executive Assistant', 'Virtual Assistant', 'Operations Coordinator', 'Customer Support Specialist', 'Finance Operations Associate'];

assert.equal(L.matchTitle('Senior Executive Assistant to the CEO', T).match, 'exact');
assert.equal(L.matchTitle('Administrative Assistant (Remote)', T).match, 'similar');
assert.equal(L.matchTitle('Client Support Representative', T).match, 'similar');
assert.equal(L.matchTitle('Software Engineer, Operations', T).match, 'none');
assert.equal(L.matchTitle('Sales Development Representative', T).match, 'none');
assert.equal(L.matchTitle('Registered Nurse', T).match, 'none');

// open to someone living in Nigeria: worldwide, Africa or Nigeria; never US/UK/EU-only, on-site or hybrid
const N = (loc, text, wt) => L.openToNigeria(loc, text || '', wt).ok;
assert.equal(N('Remote - Worldwide'), 'yes');
assert.equal(N('Anywhere in the World'), 'yes');
assert.equal(N('Remote - Africa'), 'yes');
assert.equal(N('Lagos, Nigeria (Remote)'), 'yes');
assert.equal(N('Remote', 'We hire from anywhere in the world.'), 'yes');
assert.equal(N('Remote', 'We are hiring across Africa, including Nigeria and Kenya.'), 'yes');
assert.equal(N('Remote - US'), 'no');
assert.equal(N('Remote - United States'), 'no');
assert.equal(N('Remote - Europe'), 'no');
assert.equal(N('Remote - South Africa'), 'no', 'another African country only');
assert.equal(N('Remote', 'Applicants must be authorized to work in the United States.'), 'no');
assert.equal(N('Anywhere', 'You must be based in the UK.'), 'no', 'the posting text wins over the location line');
assert.equal(N('Remote', 'This role is open to candidates in the US only.'), 'no');
assert.equal(N('Remote', 'Remote role. W-2 employee.'), 'no');
assert.equal(N('Remote', 'We hire globally, except Africa.'), 'no');
assert.equal(N('New York, NY', 'This is an on-site role'), 'no');
assert.equal(N('Abuja, Nigeria', '', 'hybrid'), 'no', 'you work remotely only');
assert.equal(N('Remote', 'Tell us why you want to work for us.'), 'review', '"for us" is not the US');
assert.equal(N('Remote (EMEA)'), 'review');
assert.equal(N('Remote (EST)'), 'review', 'a time zone is not a country rule (you work any hours)');
assert(/US/.test(L.openToNigeria('Remote - US', '').why), 'the reason is recorded');
console.log('Nigeria eligibility ok');

// work authorization depends on the country asked about
const wa = { country: 'Nigeria', work_authorized: 'Yes' };
assert.equal(L.workAuthorized('Are you legally authorized to work in the United States?', wa), 'No');
assert.equal(L.workAuthorized('Are you authorized to work in the UK?', wa), 'No');
assert.equal(L.workAuthorized('Are you authorized to work in Nigeria?', wa), 'Yes');
assert.equal(L.workAuthorized('Are you authorized to work in the country where you reside?', wa), 'Yes');
assert.equal(L.workAuthorized('Are you legally eligible to work for us?', wa), 'Yes');
console.log('work authorization ok');

const cv = `Program Coordinator, Care Services September 2023 to Present Washington, DC
Achieved a 75% on-time approval rate on care plans (9 of 12 annually).
Direct Support Professional Sample Support Services April 2023 to October 2024
Bachelor of Science, Public Health Example State University. Project Management Professional (PMP) Project Management Institute, 2026`;
const good = { headline: 'Compliance', summary: 'Compliance professional', competencies: ['Audit Readiness'],
  experience: [{ title: 'Program Coordinator, Care Services', employer: '', dates: 'September 2023 – Present',
                 bullets: ['Achieved a 75% on-time approval rate (9 of 12 annually)'] },
               { title: 'Direct Support Professional', employer: 'Sample Support Services', dates: 'April 2023 – October 2024', bullets: ['Supported people'] }],
  education: ['Bachelor of Science, Public Health, Example State University'], certifications: ['Project Management Professional (PMP), 2026'],
  cover_letter_paragraphs: ['I am applying.'] };
assert.deepEqual(L.checkPackage(good, cv), []);
const bad = JSON.parse(JSON.stringify(good));
bad.experience[0].bullets.push('Increased audit scores by 40%');
bad.experience[1].employer = 'Johns Hopkins';
bad.certifications.push('Certified Compliance and Ethics Professional (CCEP)');
const probs = L.checkPackage(bad, cv);
assert(probs.some(p => p.includes('40%')), probs);
assert(probs.some(p => p.includes('Johns Hopkins')), probs);
assert(probs.some(p => p.includes('CCEP')), probs);

const prof = { work_authorized: 'Yes', country: 'Nigeria', requires_sponsorship: 'No', desired_salary: '' };
assert.equal(L.answerFor('Are you legally authorized to work in the United States?', prof), 'No');
assert.equal(L.answerFor('Are you legally authorized to work in Nigeria?', prof), 'Yes');
assert.equal(L.answerFor('Will you now or in the future require sponsorship?', prof), 'No');
assert.equal(L.answerFor('What is your desired salary?', prof), null);
assert.equal(L.answerFor('Why do you want to work here?', prof), null);

assert.equal(L.classifyEmail('Thank you for your application', ''), 'RECEIVED');
assert.equal(L.classifyEmail('Next steps', 'We would like to schedule an interview'), 'INTERVIEW');
assert.equal(L.classifyEmail('Update', 'Unfortunately we have decided not to move forward'), 'REJECTED');
assert.equal(L.classifyEmail('Offer of employment', 'We are pleased to offer you the role'), 'OFFER');
assert.equal(L.classifyEmail('Welcome to the team!', 'Your start date is Monday. Onboarding details below.'), 'HIRED');
const apps = [{ id: 'A1', employer: 'Oscar Health', title: 'Compliance Analyst' }, { id: 'A2', employer: 'Headway', title: 'Program Analyst' }];
assert.deepEqual(L.matchEmail({ from: 'no-reply@hioscar.com', subject: 'Thanks', snippet: '' }, apps).map(a => a.id), ['A1']);
assert.deepEqual(L.matchEmail({ from: 'x@greenhouse-mail.io', subject: 'Headway update', snippet: '' }, apps).map(a => a.id), ['A2'], 'application site naming the employer');
assert.deepEqual(L.matchEmail({ from: 'news@example.com', subject: 'Headway update', snippet: '' }, apps), [], 'a name alone from another sender is not enough');
assert.deepEqual(L.matchEmail({ from: 'x@greenhouse-mail.io', subject: 'Headway: Program Analyst application', snippet: '' }, apps).map(a => a.id), ['A2']);
console.log('all Sheet-app logic tests passed');

// email applications
assert.equal(L.applyEmail('To apply, send your resume and cover letter to careers@acme-health.com.').email, 'careers@acme-health.com');
assert.equal(L.applyEmail('Applications to jobs@clinic.org by Friday.').email, 'jobs@clinic.org');
assert.equal(L.applyEmail('For accommodation requests during the application process contact hr@acme.com'), null);
assert.equal(L.applyEmail('Questions? privacy@acme.com'), null);
assert.equal(L.applyEmail('Apply through our careers page.'), null);
assert.equal(L.applyEmail('Email your CV to hiring@x.org with the job reference number in the subject line.').subjectRule, true);
console.log('email-application detection tests passed');

// fit ranking: a matching title with CV keywords beats a weak match
const fcv = 'Executive support, calendar management, CRM records, workflow automation with Zapier and n8n, Google Workspace';
const strong = L.fitScore({ title: 'Executive Assistant', text: 'Calendar management, CRM records and workflow automation in Google Workspace', remote: 'yes' }, T, fcv);
const weak = L.fitScore({ title: 'Administrative Assistant', text: 'Warehouse forklift inventory shipping logistics', remote: 'review' }, T, fcv);
assert.ok(strong > weak && strong >= 80 && strong <= 100, 'fit ' + strong + ' vs ' + weak);
assert.equal(L.fitScore({ title: 'Software Engineer', text: '', remote: 'no' }, T, fcv), 0);
console.log('fitScore ok');

// facts for a Nigerian address
const ng = L.formFacts({ location: 'Abuja, FCT', country: 'Nigeria', timezone: 'West Africa Time (WAT, UTC+1)', notice_period: 'Immediately', cv_text: '6+ years' });
assert.deepEqual([ng.city, ng.state, ng.country, ng.timezone, ng.notice_period, ng.years_experience],
  ['Abuja', 'FCT', 'Nigeria', 'West Africa Time (WAT, UTC+1)', 'Immediately', '6']);
const ng2 = L.formFacts({ location: 'Abuja, Federal Capital Territory, Nigeria', cv_text: '' });
assert.deepEqual([ng2.city, ng2.state, ng2.country, ng2.timezone], ['Abuja', 'Federal Capital Territory', 'Nigeria', '']);
console.log('Nigerian formFacts ok');

// facts for application forms come from her Profile/CV
const ff = L.formFacts({ location: 'Washington, DC 20005', cv_text: 'Compliance professional with 7+ years ensuring audit readiness.\nEDUCATION\nBachelor of Science, Public Health\nExample State University\n' });
assert.deepEqual([ff.city, ff.state, ff.state_name, ff.zip, ff.country, ff.timezone], ['Washington', 'DC', 'District of Columbia', '20005', 'United States', 'Eastern']);
assert.deepEqual([ff.years_experience, ff.highest_degree, ff.school, ff.field_of_study], ['7', "Bachelor's Degree", 'Example State University', 'Public Health']);
const real = L.formFacts({ location: 'Washington, DC 20005', cv_text: 'EDUCATION AND CERTIFICATIONS\nBachelor of Science, Public Health\nExample State University, Springfield, MD\nProject Management Institute, 2026' });
assert.deepEqual([real.highest_degree, real.degree, real.school, real.field_of_study], ["Bachelor's Degree", 'Bachelor of Science', 'Example State University', 'Public Health']);
assert.equal(L.formFacts({ location: 'Austin, TX', cv_text: '', years_experience: '9' }).years_experience, '9', 'Profile value wins');
console.log('formFacts ok');

// AI answers are accepted only when true to her record
const qs = [{ question: 'Do you have HEDIS reporting experience?', options: ['Yes', 'No'] },
  { question: 'Do you have Epic certification?', options: ['Yes', 'No'] },
  { question: 'Are you willing to travel 25%?', options: ['Yes', 'No'] },
  { question: 'Describe your audit experience', options: [] },
  { question: 'How many audits have you led?', options: [] },
  { question: 'Do you have a PMP?', options: ['Yes', 'No'] }];
const src = 'Co-led state audits of care plan approvals. Project Management Professional (PMP), 2026. 7+ years';
const ok = L.verifyAnswers([
  { question: qs[0].question, kind: 'fact', answer: 'Yes', evidence: 'HEDIS reporting' },        // not in CV → rejected
  { question: qs[1].question, kind: 'fact', answer: 'No', evidence: '' },                        // true to her record
  { question: qs[2].question, kind: 'preference', answer: 'Yes', evidence: '' },                 // never guessed
  { question: qs[3].question, kind: 'fact', answer: 'I co-led state audits of care plan approvals.', evidence: 'Co-led state audits of care plan approvals' },
  { question: qs[4].question, kind: 'fact', answer: '12', evidence: 'Co-led state audits' },       // invented number → rejected
  { question: qs[5].question, kind: 'fact', answer: 'yes', evidence: 'Project Management Professional (PMP)' },
  { question: 'Years licensing clinical staff?', kind: 'fact', answer: '0', evidence: '' }], qs.concat([{ question: 'Years licensing clinical staff?', options: [] }]), src);
assert.deepEqual(ok, { 'Do you have Epic certification?': 'No', 'Describe your audit experience': 'I co-led state audits of care plan approvals.',
  'Do you have a PMP?': 'Yes', 'Years licensing clinical staff?': '0' });
console.log('verifyAnswers ok');

// salary: structured, yearly text, k-notation, hourly
assert.equal(L.parseSalary({ min: 80000, max: 95000, interval: 'per-year-salary' }).min, 80000);
assert.equal(L.parseSalary({ min: 40, max: 45, interval: 'per-hour-wage' }).max, 93600);
assert.deepEqual(['min', 'max'].map(k => L.parseSalary(null, 'The pay range is $72,000 - $88,500 per year.')[k]), [72000, 88500]);
assert.deepEqual(['min', 'max'].map(k => L.parseSalary(null, 'Salary: $65k–$80k')[k]), [65000, 80000]);
assert.deepEqual(['min', 'max'].map(k => L.parseSalary(null, 'Pay: $30.00 - $34.50 per hour')[k]), [62400, 71760]);
assert.equal(L.parseSalary(null, 'We offer competitive pay and $500 sign-on bonus'), null);
console.log('salary ok');

// dates in any month spelling match the CV
assert.deepEqual(L.checkPackage({ headline: 'x', summary: 'x', experience: [{ title: 'Analyst', employer: '', dates: 'Sept. 2023 – Present', bullets: ['x'] }] },
  'Analyst September 2023 to Present'), []);
// emails: the employer's own domain, or an application site naming the employer; never a generic word like "health"
const appsE = [{ employer: 'Clover Health', title: 'Compliance Analyst' }, { employer: 'Oscar Health', title: 'Quality Analyst', domain: 'hioscar.com' }];
assert.deepEqual(L.matchEmail({ from: 'jobs@cloverhealth.com', subject: 'Thank you for applying', snippet: '' }, appsE).map(a => a.employer), ['Clover Health']);
assert.deepEqual(L.matchEmail({ from: 'no-reply@hioscar.com', subject: 'Update', snippet: '' }, appsE).map(a => a.employer), ['Oscar Health']);
assert.deepEqual(L.matchEmail({ from: 'no-reply@us.greenhouse-mail.io', subject: 'Thank you for applying to Clover Health', snippet: '' }, appsE).map(a => a.employer), ['Clover Health']);
assert.deepEqual(L.matchEmail({ from: 'news@healthline.com', subject: 'Health tips: thank you for applying these', snippet: '' }, appsE), []);
assert.deepEqual(L.matchEmail({ from: 'jobs@otherhealth.com', subject: 'Your application to Acme Health', snippet: '' }, appsE), []);
// full state names
const md = L.formFacts({ location: 'Glendale, Maryland 20769', cv_text: '' });
assert.deepEqual([md.city, md.state, md.state_name, md.zip], ['Glendale', 'MD', 'Maryland', '20769']);
assert.equal(L.formFacts({ home_location: 'Glendale, MD', cv_text: '' }).state, 'MD', 'home_location when location is blank');
console.log('dates, email matching and state names ok');

// job age: only jobs posted in the last 24 hours (Set maximum job age)
const now = Date.parse('2026-10-29T12:00:00Z');
assert.equal(L.postedWithin('2026-10-29T02:00:00Z', 24, now), true);
assert.equal(L.postedWithin('2026-10-27T12:00:00Z', 24, now), false);
assert.equal(L.postedWithin('2023-03-01', 24, now), false);
assert.equal(L.postedWithin(Math.floor(now / 1000) - 3600, 24, now), true, 'Unix seconds');
assert.equal(L.postedWithin(now - 3600e3, 24, now), true, 'Unix milliseconds');
assert.equal(L.postedWithin('Wed, 29 Oct 2026 08:00:00 +0000', 24, now), true, 'RSS date');
assert.equal(L.postedWithin('', 24, now), false, 'no date: not counted as recent');
assert.equal(L.postedWithin('not a date', 24, now), false);
assert.equal(L.postedWithin('2026-10-27T12:00:00Z', 72, now), true, 'a longer limit when you choose one');
console.log('job age ok');
