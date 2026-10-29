"""Local replicas of public hosted application forms (Greenhouse style) used only by the applier tests.
Nothing here reaches a real employer.  Run: uvicorn replica_ats:app --port 8765
"""

import html
import json
import os
import threading
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse

STORE = Path(os.environ.get("REPLICA_STORE", "/tmp/replica_ats_store.json"))
_lock = threading.Lock()
app = FastAPI(title="Replica ATS (test only)")
BANNER = '<div style="background:#b00;color:#fff;padding:8px">TEST REPLICA — NOT A REAL EMPLOYER</div>'


def _load() -> dict:
    return json.loads(STORE.read_text()) if STORE.exists() else {"submissions": []}


def _save(d: dict) -> None:
    STORE.write_text(json.dumps(d, indent=1))


# ---- Replicas of public hosted application forms (Greenhouse / Lever style) for adapter tests ----

GH_FORM = """<html><body>{banner}<h1>{title}</h1>
<form id="application_form" method="post" enctype="multipart/form-data" action="/gh/{job}">
<div class="field"><label for="first_name">First Name *</label><input id="first_name" name="first_name" required aria-required="true"></div>
<div class="field"><label for="last_name">Last Name *</label><input id="last_name" name="last_name" required aria-required="true"></div>
<div class="field"><label for="email">Email *</label><input id="email" name="email" type="email" required></div>
<div class="field"><label for="phone">Phone</label><input id="phone" name="phone"></div>
<div class="field"><label for="resume">Resume/CV *</label><input id="resume" name="resume" type="file" required></div>
<div class="field"><label for="cover_letter">Cover Letter</label><input id="cover_letter" name="cover_letter" type="file"></div>
<div class="field"><label for="q1">Are you legally authorized to work in the United States? *</label>
  <select id="q1" name="q1" required><option value="">Please select</option><option>Yes</option><option>No</option></select></div>
<div class="field"><label for="q2">Will you now or in the future require sponsorship for employment visa status? *</label>
  <select id="q2" name="q2" required><option value="">Please select</option><option>Yes</option><option>No</option></select></div>
{extra}
<fieldset><legend>Voluntary Self-Identification</legend>
<div class="field"><label for="gender">Gender</label><select id="gender" name="gender"><option value="">Please select</option><option>Male</option><option>Female</option><option>Decline To Self Identify</option></select></div>
<div class="field"><label for="veteran">Veteran Status</label><select id="veteran" name="veteran"><option value="">Please select</option><option>I am not a protected veteran</option><option>I don't wish to answer</option></select></div>
</fieldset>
<button type="submit">Submit Application</button></form></body></html>"""


@app.get("/gh/{job}", response_class=HTMLResponse)
def gh_form(job: str):
    extra = ""
    if job == "gh-captcha":  # a visible checkbox CAPTCHA a person must click
        extra = '<iframe width="304" height="78" src="about:blank#https://www.google.com/recaptcha/api2/anchor?k=x&size=normal"></iframe>'
    if job == "gh-invisible-captcha":  # background (invisible) reCAPTCHA badge, like many real Greenhouse forms
        extra = ('<div class="grecaptcha-badge" style="position:fixed;bottom:14px;right:0;width:256px;height:60px">'
                 '<iframe title="reCAPTCHA" width="256" height="60" src="about:blank#https://www.google.com/recaptcha/api2/anchor?k=x&size=invisible"></iframe></div>')
    if job == "gh-essay":
        extra = '<div class="field"><label for="q3">Why do you want to work here? *</label><textarea id="q3" name="q3" required></textarea></div>'
    return GH_FORM.format(banner=BANNER, title=html.escape(job), job=html.escape(job), extra=extra)


@app.post("/gh/{job}")
async def gh_submit(job: str, request: Request):
    form = await request.form()
    with _lock:
        d = _load()
        d["submissions"].append({"job_id": job, "client_reference": "", "confirmation": "GH",
                                 "fields": {k: (v if isinstance(v, str) else f"<file {v.filename}>") for k, v in form.items()}})
        _save(d)
    return HTMLResponse(f"<html><body>{BANNER}<h1>Thank you for applying.</h1><p>Your application has been received.</p></body></html>")


# Lever-style form: "✱" marks required questions; yes/no questions are radio buttons whose own label is just "Yes"/"No".
LV_FORM = """<html><body>{banner}<form id="application-form" method="post" enctype="multipart/form-data" action="/lever/{job}"><ul>
<li class="application-question resume"><div class="application-label">Resume/CV<span class="required">✱</span></div>
  <div class="application-field"><input type="file" name="resume" id="resume-upload-input" required></div></li>
<li class="application-question"><label><div class="application-label">Full name<span class="required">✱</span></div>
  <div class="application-field"><input type="text" name="name" required></div></label></li>
<li class="application-question"><label><div class="application-label">Email<span class="required">✱</span></div>
  <div class="application-field"><input type="email" name="email" required></div></label></li>
<li class="application-question"><label><div class="application-label">Phone</div><div class="application-field"><input type="text" name="phone"></div></label></li>
<li class="application-question"><label><div class="application-label">Current company<span class="required">✱</span></div>
  <div class="application-field"><input type="text" name="org" required></div></label></li>
<li class="application-question custom-question"><div class="application-label full-width"><div class="text">Are you legally authorized to work in the United States?<span class="required">✱</span></div></div>
  <div class="application-field full-width required-field"><ul data-qa="multiple-choice">
  <li><label><input type="radio" name="cards[c1][field0]" value="Yes" required><span class="application-answer-alternative">Yes</span></label></li>
  <li><label><input type="radio" name="cards[c1][field0]" value="No" required><span class="application-answer-alternative">No</span></label></li></ul></div></li>
<li class="application-question custom-question"><div class="application-label full-width"><div class="text">Will you now or in the future require visa sponsorship?<span class="required">✱</span></div></div>
  <div class="application-field full-width required-field"><ul data-qa="multiple-choice">
  <li><label><input type="radio" name="cards[c1][field1]" value="Yes" required><span class="application-answer-alternative">Yes</span></label></li>
  <li><label><input type="radio" name="cards[c1][field1]" value="No" required><span class="application-answer-alternative">No</span></label></li></ul></div></li>
<li class="application-question custom-question"><div class="application-label full-width"><div class="text">I confirm that the information I have provided is accurate.<span class="required">✱</span></div></div>
  <div class="application-field full-width required-field"><ul data-qa="checkboxes">
  <li><label><input type="checkbox" name="cards[c1][field2]" value="Yes" required><span class="application-answer-alternative">Yes</span></label></li></ul></div></li>
{extra}
</ul><button type="submit" style="display:none">Submit</button>
<button type="button" class="postings-btn template-btn-submit" data-qa="btn-submit" onclick="this.form.submit()">Submit application</button>
</form></body></html>"""


@app.get("/lever/{job}", response_class=HTMLResponse)
def lever_form(job: str):
    extra = ""
    if job == "lv-hcaptcha":  # hidden CAPTCHA that silently blocks the submission: clicking Submit does nothing
        return LV_FORM.format(banner=BANNER, job=html.escape(job), extra='<div class="h-captcha" data-size="invisible"></div>').replace(
            'onclick="this.form.submit()"', 'onclick="return false"')
    if job == "lv-real":  # the questions from a real Lever form that stopped her application
        extra = ('<li class="application-question custom-question"><div class="application-label full-width"><div class="text">'
                 'Do you now, or in the future require sponsorship?<span class="required">✱</span></div></div><div class="application-field">'
                 '<ul><li><label><input type="radio" name="cards[c2][field0]" value="Yes, I will require sponsorship" required>'
                 '<span>Yes, I will require sponsorship</span></label></li><li><label><input type="radio" name="cards[c2][field0]" '
                 'value="No, I will not require sponsorship" required><span>No, I will not require sponsorship</span></label></li></ul></div></li>'
                 '<li class="application-question custom-question"><div class="application-label full-width"><div class="text">'
                 'Do you have the unrestricted right to work in the United States?<span class="required">✱</span></div></div>'
                 '<div class="application-field"><select name="cards[c2][field1]" required><option value="">Select...</option>'
                 '<option>Yes</option><option>No</option></select></div></li>'
                 '<li class="application-question custom-question"><div class="application-label full-width"><div class="text">'
                 'Stay Connected | To ensure you receive status updates and interview invitations, please add no-reply@hire.lever.co '
                 'to your safe sender list and check your spam/junk folders regularly.<span class="required">✱</span></div></div>'
                 '<div class="application-field"><ul><li><label><input type="checkbox" name="cards[c2][field2]" value="I understand" required>'
                 '<span>I understand</span></label></li></ul></div></li>')
    if job == "lv-hear":
        extra = ('<li class="application-question custom-question"><div class="application-label full-width"><div class="text">'
                 'Do you hold a current CPHQ certification?<span class="required">✱</span></div></div><div class="application-field">'
                 '<ul><li><label><input type="radio" name="cards[c1][field3]" value="Yes"><span>Yes</span></label></li>'
                 '<li><label><input type="radio" name="cards[c1][field3]" value="No"><span>No</span></label></li></ul></div></li>')
    return LV_FORM.format(banner=BANNER, job=html.escape(job), extra=extra)


@app.post("/lever/{job}")
async def lever_submit(job: str, request: Request):
    form = await request.form()
    fields = {k: (v if isinstance(v, str) else f"<file {v.filename}>") for k, v in form.items()}
    with _lock:
        d = _load()
        d["submissions"].append({"job_id": job, "client_reference": "", "confirmation": "LV", "fields": fields})
        _save(d)
    return HTMLResponse(f"<html><body>{BANNER}<h3>Application submitted!</h3><p>Thanks for applying.</p></body></html>")


# Newer Greenhouse-style form: type-to-search drop-downs (React-Select-like) with a hidden "required" input each,
# a location search whose results load after a delay, and the questions forms commonly ask.
def _combo(cid, label, options, delay=0, min_chars=0):
    return (f'<div class="field"><label for="{cid}">{label} *</label><div class="select__container">'
            f'<input id="{cid}" role="combobox" aria-autocomplete="list" class="select__input" autocomplete="off" aria-required="true" '
            f'data-options=\'{json.dumps(options)}\' data-delay="{delay}" data-min="{min_chars}">'
            f'<input name="{cid}" aria-hidden="true" tabindex="-1" required style="opacity:0;position:absolute;width:1px;height:1px">'
            f'<div role="listbox" style="display:none;border:1px solid #999"></div></div></div>')


GH2_FORM = """<html><body>{banner}<form id="application-form" method="post" enctype="multipart/form-data" action="/gh2/{job}">
<div class="field"><label for="first_name">First Name *</label><input id="first_name" name="first_name" required></div>
<div class="field"><label for="last_name">Last Name *</label><input id="last_name" name="last_name" required></div>
<div class="field"><label for="email">Email *</label><input id="email" name="email" type="email" required></div>
<div class="field"><label for="phone">Phone *</label><input id="phone" name="phone" required></div>
{country}{state}{location}
<div class="field"><label for="resume">Resume/CV *</label><input id="resume" name="resume" type="file" required style="display:none"></div>
<div class="field"><label for="hear">How did you hear about this job? *</label><select id="hear" name="hear" required>
  <option value="">Select...</option><option>LinkedIn</option><option>Indeed</option><option>Company Website</option><option>Other</option></select></div>
{adult}
<div class="field"><label for="prev">Have you ever been employed by Acme Health? *</label><select id="prev" name="prev" required>
  <option value="">Select...</option><option>Yes</option><option>No</option></select></div>
<div class="field"><label for="yrs">How many years of professional experience do you have? *</label><select id="yrs" name="yrs" required>
  <option value="">Select...</option><option>0-2 years</option><option>3-5 years</option><option>6-8 years</option><option>9+ years</option></select></div>
<div class="field"><label for="edu">Highest level of education completed *</label><select id="edu" name="edu" required>
  <option value="">Select...</option><option>High School</option><option>Associate's Degree</option><option>Bachelor's Degree</option><option>Master's Degree</option></select></div>
<div class="field"><label for="school">School *</label><input id="school" name="school" required></div>
<div class="field"><label for="disc">Discipline *</label><input id="disc" name="disc" required></div>
<div class="field"><label for="start">Desired start date *</label><input id="start" name="start" required></div>
<div class="field"><label for="why">Why are you interested in this role? *</label><textarea id="why" name="why" required></textarea></div>
{gender}
<div class="field"><label><input type="checkbox" name="certify" value="yes" required> I certify that the information provided is true and complete.</label></div>
<button type="submit">Submit application</button></form>
<script>
document.querySelectorAll('input[role=combobox]').forEach(inp => {{
  const box = inp.parentElement, list = box.querySelector('[role=listbox]'), hidden = box.querySelector('input[aria-hidden]');
  const opts = JSON.parse(inp.dataset.options), delay = +inp.dataset.delay, min = +inp.dataset.min;
  const show = () => {{
    const q = inp.value.toLowerCase();
    if (q.length < min) {{ list.style.display = 'none'; return; }}
    setTimeout(() => {{
      list.innerHTML = '';
      opts.filter(o => o.toLowerCase().includes(q)).forEach(o => {{
        const d = document.createElement('div'); d.setAttribute('role', 'option'); d.textContent = o;
        d.onmousedown = e => {{ e.preventDefault(); hidden.value = o; inp.value = ''; list.style.display = 'none';
          let sv = box.querySelector('.select__single-value'); if (!sv) {{ sv = document.createElement('div'); sv.className = 'select__single-value'; box.prepend(sv); }}
          sv.textContent = o; }};
        list.appendChild(d);
      }});
      list.style.display = 'block';
    }}, delay);
  }};
  inp.addEventListener('focus', show); inp.addEventListener('input', show); inp.addEventListener('click', show);
}});
</script></body></html>"""


@app.get("/gh2/{job}", response_class=HTMLResponse)
def gh2_form(job: str):
    return GH2_FORM.format(
        banner=BANNER, job=html.escape(job),
        country=_combo("country", "Country", ["Canada", "United Kingdom", "United States", "Mexico"]),
        state=_combo("state", "State", ["California", "District of Columbia", "Maryland", "Virginia"]),
        location=_combo("candidate-location", "Location (City)", ["Washington, District of Columbia, United States",
                                                                  "Washington, Pennsylvania, United States"], delay=700, min_chars=3),
        adult=_combo("adult", "Are you at least 18 years of age?", ["Yes", "No"]),
        gender=_combo("gender", "Gender", ["Male", "Female", "Decline To Self Identify"]))


ASK_EXTRA = """<div class="field"><label for="medicaid">Do you have Medicaid compliance experience? *</label><select id="medicaid" name="medicaid" required>
  <option value="">Select...</option><option>Yes</option><option>No</option></select></div>
<div class="field"><label for="audit">Describe your audit experience *</label><textarea id="audit" name="audit" required></textarea></div>"""


@app.get("/gh2ask/{job}", response_class=HTMLResponse)
def gh2_ask_form(job: str):
    page = gh2_form(job)  # same form plus two questions only her CV can answer (posts to /gh2/)
    return HTMLResponse(page.replace('<div class="field"><label for="why">', ASK_EXTRA + '<div class="field"><label for="why">'))


# Ashby-style form: Yes/No questions are buttons, not radio buttons; the resume input is hidden behind an upload button.
ASHBY_FORM = """<html><body>{banner}<form method="post" enctype="multipart/form-data" action="/ashby/{job}">
<div><label for="_systemfield_name">Name *</label><input id="_systemfield_name" name="name" required></div>
<div><label for="_systemfield_email">Email *</label><input id="_systemfield_email" name="email" type="email" required></div>
<div><label for="_systemfield_resume">Resume *</label><input id="_systemfield_resume" name="resume" type="file" required style="display:none"></div>
<div class="q"><p class="question-title">Are you legally authorized to work in the United States? *</p>
  <div class="yesno"><button type="button" data-v="Yes">Yes</button><button type="button" data-v="No">No</button></div>
  <input type="hidden" name="auth"></div>
<div class="q"><p class="question-title">Will you now or in the future require visa sponsorship? *</p>
  <div class="yesno"><button type="button" data-v="Yes">Yes</button><button type="button" data-v="No">No</button></div>
  <input type="hidden" name="sponsor"></div>
<button type="submit">Submit Application</button></form>
<script>
document.querySelectorAll('.yesno button').forEach(b => b.onclick = () => {{
  const box = b.parentElement; box.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', 'false'));
  b.setAttribute('aria-pressed', 'true'); box.parentElement.querySelector('input[type=hidden]').value = b.dataset.v; }});
</script></body></html>"""


@app.get("/ashby/{job}", response_class=HTMLResponse)
def ashby_form(job: str):
    return ASHBY_FORM.format(banner=BANNER, job=html.escape(job))


@app.post("/ashby/{job}")
async def ashby_submit(job: str, request: Request):
    form = await request.form()
    fields = {k: (v if isinstance(v, str) else f"<file {v.filename}>") for k, v in form.items()}
    with _lock:
        d = _load()
        d["submissions"].append({"job_id": job, "client_reference": "", "confirmation": "ASHBY", "fields": fields})
        _save(d)
    return HTMLResponse(f"<html><body>{BANNER}<h2>Thanks for applying!</h2></body></html>")


@app.post("/gh2/{job}")
async def gh2_submit(job: str, request: Request):
    form = await request.form()
    fields = {k: (v if isinstance(v, str) else f"<file {v.filename}>") for k, v in form.items()}
    with _lock:
        d = _load()
        d["submissions"].append({"job_id": job, "client_reference": "", "confirmation": "GH2", "fields": fields})
        _save(d)
    return HTMLResponse(f"<html><body>{BANNER}<h1>Thank you for applying.</h1></body></html>")


PHONE_FORM = """<html><body>{banner}<form method="post" action="/phone/{job}" onsubmit="return check()">
<div class="field"><label for="first_name">First Name *</label><input id="first_name" name="first_name" required></div>
<div class="field"><label for="last_name">Last Name *</label><input id="last_name" name="last_name" required></div>
<div class="field"><label for="email">Email *</label><input id="email" name="email" type="email" required></div>
<div class="field"><label for="phone">Phone *</label><input id="phone" name="phone" required></div>
<div class="field"><label for="resume">Resume/CV *</label><input id="resume" name="resume" type="file" required></div>
<div id="err" class="error" style="display:none">Phone is invalid</div>
<button type="submit">Submit Application</button></form>
<script>function check() {{ const ok = /^\\d{{10,15}}$/.test(document.getElementById('phone').value);
  document.getElementById('err').style.display = ok ? 'none' : 'block'; return ok; }}</script></body></html>"""


@app.get("/phone/{job}", response_class=HTMLResponse)
def phone_form(job: str):
    return PHONE_FORM.format(banner=BANNER, job=html.escape(job))


@app.post("/phone/{job}")
async def phone_submit(job: str, request: Request):
    form = await request.form()
    with _lock:
        d = _load()
        d["submissions"].append({"job_id": job, "client_reference": "", "confirmation": "PHONE",
                                 "fields": {k: (v if isinstance(v, str) else f"<file {v.filename}>") for k, v in form.items()}})
        _save(d)
    return HTMLResponse(f"<html><body>{BANNER}<h1>Thank you for applying.</h1></body></html>")


# Required fields NOT marked as required; the site only says what is missing after Submit (like the forms in her report).
REJ_FORM = """<html><body>{banner}<form method="post" action="/rej/{job}" onsubmit="return check()">
<div class="field"><label for="first_name">First Name</label><input id="first_name" name="first_name"></div>
<div class="field"><label for="last_name">Last Name</label><input id="last_name" name="last_name"></div>
<div class="field"><label for="email">Email</label><input id="email" name="email" type="email"></div>
<div class="field"><label for="resume">Resume/CV</label><input id="resume" name="resume" type="file"></div>
<div class="field"><label for="sy">Start date year</label><select id="sy" name="sy"><option value=""></option><option>2010</option><option>2011</option></select></div>
<div class="field"><label for="ey">End date year</label><select id="ey" name="ey"><option value=""></option><option>2014</option><option>2015</option></select></div>
<div class="field"><label for="lic">How many years of experience with licensing clinical-related staff do you have?</label><input id="lic" name="lic"></div>
{extra}
<button type="submit">Submit Application</button></form>
<script>
function check() {{
  let ok = true;
  document.querySelectorAll('.field').forEach(f => {{
    const i = f.querySelector('input, select'); let m = f.querySelector('.helper-text--error');
    const empty = i.type === 'file' ? !i.files.length : !i.value;
    if (empty) {{ ok = false; i.setAttribute('aria-invalid', 'true');
      if (!m) {{ m = document.createElement('div'); m.className = 'helper-text--error'; m.textContent = 'This field is required'; f.appendChild(m); }} }}
    else {{ i.removeAttribute('aria-invalid'); if (m) m.remove(); }}
  }});
  return ok;
}}
</script></body></html>"""


@app.get("/rej/{job}", response_class=HTMLResponse)
def rej_form(job: str):
    extra = ('<div class="field"><label for="dcs">Do you have experience with an obscure scheduling tool? If yes, list which ones.</label>'
             '<input id="dcs" name="dcs"></div>') if job == "rej-ask" else ""
    return REJ_FORM.format(banner=BANNER, job=html.escape(job), extra=extra)


@app.post("/rej/{job}")
async def rej_submit(job: str, request: Request):
    form = await request.form()
    with _lock:
        d = _load()
        d["submissions"].append({"job_id": job, "client_reference": "", "confirmation": "REJ",
                                 "fields": {k: (v if isinstance(v, str) else f"<file {v.filename}>") for k, v in form.items()}})
        _save(d)
    return HTMLResponse(f"<html><body>{BANNER}<h1>Thank you for applying.</h1></body></html>")


@app.get("/api/all")
def all_submissions():
    return _load()["submissions"]


@app.get("/api/last")
def last_submission():
    subs = _load()["submissions"]
    return subs[-1] if subs else {}
