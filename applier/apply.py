"""Job Board applier: submits applications you approved in your Google Sheet.

Runs on GitHub Actions (hourly) or any computer:  python apply.py
Needs two secrets in the environment:
  SHEET_WEBAPP_URL   the Sheet script's web app URL
  APPLIER_SECRET     shown by Job Board menu → "Show applier connection details"

For each approved job: claim it (the Sheet re-checks approval, expiry and the exact file hashes),
fill the public Greenhouse/Lever application form with your approved PDFs and verified answers,
and report SUBMITTED / NEEDS_YOU / UNCERTAIN / NOT_SENT back to the Sheet. It stops BEFORE the
final click on a CAPTCHA, a login, or any required question without a verified answer.
Logs contain only application IDs and outcomes — never your personal data.
"""

import base64
from datetime import date, timedelta
import os
import re
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlsplit

import httpx

ALLOWED_HOSTS = {"boards.greenhouse.io", "job-boards.greenhouse.io", "jobs.lever.co", "jobs.ashbyhq.com", "apply.workable.com"} | set(
    filter(None, os.environ.get("EXTRA_ALLOWED_HOSTS", "").split(",")))
# application sites that need no account, where every employer has its own sub-domain
ALLOWED_SUFFIXES = ("bamboohr.com", "applytojob.com", "breezy.hr", "recruitee.com")
DEMOGRAPHIC = re.compile(r"gender|race|ethnic|hispanic|veteran|disabilit|sexual orientation|pronoun|transgender|lgbt", re.I)
GENDER_Q = re.compile(r"^(what is your |your |please (select|indicate) your )?(gender|sex)( identity)?\??$|^gender\b|\bgender identity\b", re.I)
# Countries a work-authorization question may name; the answer is Yes only for the countries in the Profile.
COUNTRY_WORDS = re.compile(r"\b(united states|u\.s\.a?\.?|usa|america|canada|united kingdom|u\.k\.|uk|britain|england|ireland|"
                           r"european union|eu|europe|eea|germany|france|spain|portugal|netherlands|poland|india|philippines|australia|"
                           r"new zealand|brazil|mexico|singapore|israel|south africa|kenya|ghana|egypt|uae|nigeria|switzerland|sweden|japan)\b", re.I)
CALLING_CODES = {"nigeria": "+234", "united states": "+1", "canada": "+1", "united kingdom": "+44", "ghana": "+233", "kenya": "+254",
                 "south africa": "+27"}
DECLINE = re.compile(r"decline|don.?t wish|do not wish|prefer not|not to (?:say|answer|disclose)|choose not", re.I)
CONFIRM = re.compile(r"thank(?:s| you) for (?:applying|your application|your interest|submitting)|application (?:has been |was )?(?:submitted|received|sent)|"
                     r"we.ve received your application|successfully (?:submitted|applied)|your application is (?:complete|in)", re.I)
# Many forms (e.g. Greenhouse) load an INVISIBLE reCAPTCHA/hCaptcha in the background; that is not a puzzle and is not a
# reason to stop. Only a challenge a person must solve counts.
VISIBLE_CAPTCHA_JS = r"""() => {
  const vis = el => { const r = el.getBoundingClientRect(); const st = getComputedStyle(el);
                      return r.width > 30 && r.height > 30 && st.visibility !== 'hidden' && st.display !== 'none'; };
  for (const f of document.querySelectorAll('iframe')) {
    const src = (f.getAttribute('src') || '').toLowerCase();
    if (/recaptcha\/(api2|enterprise)\/anchor/.test(src) && !/size=invisible/.test(src) && vis(f)) return 'reCAPTCHA checkbox';
    if (/hcaptcha/.test(src) && /frame=checkbox(?!-invisible)|\/checkbox/.test(src) && vis(f)) return 'hCaptcha checkbox';
    if (/challenges\.cloudflare\.com/.test(src) && vis(f)) return 'Cloudflare check';
  }
  for (const el of document.querySelectorAll('[data-captcha]')) if (vis(el)) return 'CAPTCHA';
  return '';
}"""
CHALLENGE_JS = r"""() => {
  for (const f of document.querySelectorAll('iframe')) {
    const src = (f.getAttribute('src') || '').toLowerCase(); const r = f.getBoundingClientRect();
    if ((/recaptcha\/(api2|enterprise)\/bframe/.test(src) || /hcaptcha.*challenge/.test(src)) && r.width > 100 && r.height > 100
        && getComputedStyle(f).visibility !== 'hidden') return true;
  }
  return false;
}"""


def norm(s: str) -> str:
    # Lever marks required questions with "✱", Greenhouse with "*"
    s = re.sub(r"\s+", " ", s or "").strip().lower()
    return re.sub(r"(\s*([*✱＊]|\(required\)))+$", "", s).strip()


# More application sites that need no account (each employer has its own address on them).
ALLOWED_SUFFIXES = ALLOWED_SUFFIXES + ("smartrecruiters.com", "teamtailor.com", "personio.de", "personio.com", "pinpointhq.com",
                                      "rippling.com", "dover.com", "zohorecruit.com", "zohorecruit.eu", "careers-page.com", "freshteam.com",
                                      "homerun.co", "polymer.co", "comeet.com", "hirehive.com", "jobscore.com", "applicantpro.com",
                                      "recruitcrm.io", "gohire.io", "jobvite.com", "workable.com", "ashbyhq.com", "lever.co", "greenhouse.io", "comeet.co")
# Sites that need an account and login: never filled in (the applier hands these to you).
LOGIN_HOSTS = re.compile(r"(myworkdayjobs|workday|icims|taleo|successfactors|oraclecloud|linkedin|indeed|glassdoor|wellfound|angel\.co|"
                         r"ultipro|ukg|paylocity|adp\.com|brassring|avature|phenompeople|ziprecruiter|upwork|fiverr|freelancer\.com)", re.I)
SITE = []  # the employer's own careers site for the application being sent (its domain and sub-domains are allowed)


def site_domain(url: str) -> str:
    """example.com for jobs.example.com; example.com.ng for careers.example.com.ng."""
    parts = (urlsplit(url).hostname or "").split(".")
    n = 3 if len(parts) >= 3 and parts[-2] in ("co", "com", "org", "net", "gov", "ac", "edu") and len(parts[-1]) == 2 else 2
    return ".".join(parts[-n:])


def allowed(url: str) -> bool:
    host = urlsplit(url).hostname or ""
    if LOGIN_HOSTS.search(host):
        return False
    return (host in ALLOWED_HOSTS or any(host == s or host.endswith("." + s) for s in ALLOWED_SUFFIXES)
            or any(host == d or host.endswith("." + d) for d in SITE))


def alternate_urls(job: dict, tried: str) -> list:
    """Other addresses for the same application: the job posting itself, and each site's other form address."""
    out, url = [], job.get("apply_url") or ""
    gh = re.search(r"greenhouse\.io/(?:embed/job_app\?for=)?([^/?&#]+)(?:/jobs/|&token=)(\d+)", url) or \
        re.search(r"for=([^&]+)&token=(\d+)", url)
    if gh:
        out += [f"https://job-boards.greenhouse.io/{gh.group(1)}/jobs/{gh.group(2)}", f"https://boards.greenhouse.io/{gh.group(1)}/jobs/{gh.group(2)}"]
    if re.search(r"jobs\.lever\.co/.+/apply$", url):
        out.append(url[:-len("/apply")])
    if re.search(r"jobs\.ashbyhq\.com/.+/application$", url):
        out.append(url[:-len("/application")])
    if job.get("job_url"):
        out.append(job["job_url"])
    return [u for i, u in enumerate(out) if u and u != tried and u not in out[:i]]


def application_url(job: dict) -> str:
    """Greenhouse jobs often list the employer's own careers page; every Greenhouse job also has a hosted form."""
    url = job["apply_url"]
    if allowed(url) or job.get("ats") != "greenhouse" or not job.get("board"):
        return url
    m = re.search(r"gh_jid=(\d+)", url) or re.search(r"/jobs?/(\d{5,})", url) or re.search(r"(\d{6,})", url)
    return f"https://boards.greenhouse.io/embed/job_app?for={job['board']}&token={m.group(1)}" if m else url


def yes_no(v):
    """A Sheet checkbox or TRUE/FALSE cell arrives as true/false; forms want Yes/No."""
    t = str(v).strip().lower() if v is not None else ""
    return {"true": "Yes", "false": "No"}.get(t, v)


def answer_for(label: str, answers: dict) -> str | None:
    """Kept for the work-authorization / sponsorship / salary / LinkedIn / saved answers (used by value_for)."""
    kind, vals = value_for(label, {"identity": {}, "answers": answers})
    return vals[0] if kind == "text" and vals else None


# Lone required checkboxes that only acknowledge something harmless ("I confirm my information is accurate",
# "add no-reply@hire.lever.co to your safe sender list") are ticked; anything else is left for your.
ACK = re.compile(r"safe sender|stay connected|spam|junk folder|status updates|receive (email|updates|communications|messages)|"
                 r"text messages?|\bsms\b", re.I)
CONSENT = re.compile(r"\b(i (agree|acknowledge|consent|certify|confirm|understand|have read|attest)|by checking|by submitting)\b.*"
                     r"(privacy|terms|policy|notice|accurate|true|correct|complete|information|statement)", re.I)
NEG = re.compile(r"\b(no|not|don.?t|do not|won.?t|will not|false|never)\b", re.I)
PLACEHOLDER = re.compile(r"^(select|choose|please|--|—|-)", re.I)
SOURCES = ["Company website", "Company careers page", "Careers page", "Career site", "Company Website / Careers Page",
           "Job board", "Online job board", "Job Board / Job Site", "Internet search", "Online", "Other"]


def _range(o: str):
    """(low, high) years an option like "5-7 years", "7+", "10 or more", "Less than 1 year" stands for."""
    t = o.lower()
    nums = [float(n) for n in re.findall(r"\d+(?:\.\d+)?", t)]
    if not nums:
        return None
    if re.search(r"less than|under|fewer than|<", t):
        return (0, nums[0] - 0.01)
    if re.search(r"\+|or more|more than|over|at least|>", t):
        return (nums[0], 99)
    if len(nums) >= 2:
        return (nums[0], nums[1])
    return (nums[0], nums[0])


def pick_option(options: list[str], value) -> int | None:
    """Index of the option meaning your answer. Handles Yes/No/True/False/Y/N wording and year ranges."""
    if value is None or str(value).strip() == "":
        return None
    v = norm(str(value))
    real = [(i, o) for i, o in enumerate(options) if norm(o) and not PLACEHOLDER.match(norm(o))]
    for i, o in real:
        if norm(o) == v:
            return i
    for i, o in real:
        if norm(o).startswith(v):
            return i
    same = {"yes": ("yes", "y", "true"), "no": ("no", "n", "false")}.get(v, ())
    for i, o in real:
        if norm(o).rstrip(".") in same:
            return i
    if v in ("yes", "no"):
        hits = [i for i, o in real if bool(NEG.search(o)) == (v == "no") and not re.search(r"prefer not|decline", o, re.I)]
        if len(hits) == 1:
            return hits[0]
        return None
    if re.fullmatch(r"\d+(\.\d+)?", v):  # years of experience against ranges
        n = float(v)
        for i, o in real:
            r = _range(o)
            if r and r[0] <= n <= r[1]:
                return i
        return None
    if len(v) >= 4:  # "District of Columbia" inside "Washington, District of Columbia, United States"
        for i, o in real:
            if v in norm(o):
                return i
    # "No experience" / "None" against choices worded differently ("I have not used it", "0 years", "No prior experience")
    if re.match(r"^(no|none|never|not|0|zero|n/?a)\b", v):
        none = [i for i, o in real if re.search(r"\b(no|none|never|not|0|zero|n/?a|beginner|limited|minimal|less than)\b", norm(o))
                and not DECLINE.search(o)]
        if none:
            return min(none, key=lambda i: (0 if re.search(r"\b(none|no experience|never|0|zero)\b", norm(options[i])) else 1, i))
    return None


def pick_any(options: list[str], values: list) -> int | None:
    for v in values:
        i = pick_option(options, v)
        if i is not None:
            return i
    return None


US_STATES = {"AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California", "CO": "Colorado",
             "CT": "Connecticut", "DE": "Delaware", "DC": "District of Columbia", "FL": "Florida", "GA": "Georgia", "HI": "Hawaii",
             "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana",
             "ME": "Maine", "MD": "Maryland", "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi",
             "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire", "NJ": "New Jersey",
             "NM": "New Mexico", "NY": "New York", "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma",
             "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina", "SD": "South Dakota",
             "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VT": "Vermont", "VA": "Virginia", "WA": "Washington",
             "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming"}


def phone_formats(phone) -> list:
    """US numbers as (301) 555-0123; other countries in international form (+234...), which phone fields with a country
    picker recognise. The digits are never changed."""
    d = re.sub(r"\D", "", str(phone or ""))
    if not d:
        return []
    if len(d) == 11 and d.startswith("1"):  # +1 / 1- prefix: a US number
        d = d[1:]
    if len(d) == 10:
        return [f"({d[:3]}) {d[3:6]}-{d[6:]}", d]
    return ["+" + d, d]


def with_place(ident: dict) -> dict:
    """City/state/ZIP from "Washington, DC 20005" when the Sheet didn't send them separately (older Sheet code)."""
    ident = {k: v for k, v in ident.items() if v not in (None, "")}
    loc = str(ident.get("location") or "")
    m = re.match(r"\s*([^,]+),\s*([A-Za-z]{2})\b\s*(\d{5})?", loc)
    full = None if m else re.match(r"\s*([^,]+),\s*([A-Za-z ]+?)\s*(\d{5})?\s*$", loc)
    code = next((k for k, v in US_STATES.items() if full and v.lower() == full.group(2).strip().lower()), None)
    if m or code:
        st = m.group(2).upper() if m else code
        m = m or full
        ident.setdefault("city", m.group(1).strip())
        ident.setdefault("state", st)
        ident.setdefault("state_name", US_STATES.get(st, st))
        if m.group(3):
            ident.setdefault("zip", m.group(3))
    if ident.get("state") and not ident.get("state_name"):
        ident["state_name"] = US_STATES.get(ident["state"].upper(), ident["state"])
    return ident


YES_NO_QUESTION = re.compile(r"^(do|does|are|is|have|has|will|would|can|could|did|were|was|may|should|if)\b", re.I)


def work_authorized(l: str, a: dict, ident: dict):
    """Yes for the Profile's countries (work_authorized_countries, default your country), No for any other country the
    question names, and the Profile's general answer (work_authorized) when it names none."""
    mine = [c.strip().lower() for c in re.split(r"[,;\n]+", str(a.get("work_authorized_countries") or ident.get("country") or ""))
            if c.strip()]
    if any(c in l for c in mine):
        return "Yes"
    if re.search(r"\b(in|within|for) (the )?us\b", l) and not re.search(r"\b(work|join|contact) (for |with )?us\b", l):
        return "No"
    if COUNTRY_WORDS.search(l):
        return "No"
    return a.get("work_authorized") or a.get("work_authorized_us")


def in_country(l: str, ident: dict) -> str | None:
    """'Do you live in the US?' style questions: Yes only for your own country."""
    m = re.search(r"(reside|live|located|based|currently in|resident of).{0,25}(u\.?s\.?a?|united states|america|canada|united kingdom|"
                  r"\buk\b|europe|\beu\b|nigeria|africa)", l)
    if not m:
        return None
    mine = str(ident.get("country") or "").lower()
    asked = m.group(2).replace(".", "")
    same = (mine and mine in asked) or (asked == "africa" and mine in ("nigeria", "ghana", "kenya", "south africa"))
    return "Yes" if same else "No"


def value_for(label: str, job: dict) -> tuple[str, list]:
    """What to put in a field, from your Profile/CV only. Returns (kind, candidate values, best first).
    kind: text | resume | cover | cover_text | demographic | date | unknown"""
    l, ident = norm(label), with_place(job.get("identity") or {})
    a = {k: yes_no(v) for k, v in (job.get("answers") or {}).items() if k != "custom"}
    vals = lambda *xs: [x for x in xs if x not in (None, "")]
    T = lambda *xs: ("text", vals(*xs))
    for key, val in (job.get("answers") or {}).get("custom") or []:  # your own saved answers come first
        if key and val and key.lower() in l:
            return "text", [val]
    # common questions from the Answers tab (QUESTION_BANK, with your own answers); a Yes/No answer only for a yes/no question
    for pattern, val in (job.get("answers") or {}).get("bank") or []:
        try:
            hit = re.search(pattern, l, re.I)
        except re.error:
            continue
        if hit and val:
            if norm(val) in ("yes", "no") and not (YES_NO_QUESTION.match(l) or len(l) < 50):
                continue
            return "text", [val]
    if re.search(r"resume|\bcv\b", l) and not re.search(r"how|why", l):
        return "resume", []
    if "cover letter" in l and not re.search(r"why|interest", l):
        return "cover", []
    if GENDER_Q.search(l) and a.get("gender"):
        g = str(a["gender"])
        return T(g, *({"male": ["Man", "M", "Male (he/him)"], "female": ["Woman", "F", "Female (she/her)"]}.get(g.lower(), [])))
    if DEMOGRAPHIC.search(l):
        return "demographic", []
    # consent questions that mention the phone ("By selecting YES, I consent to receive recruiting SMS messages...")
    if re.search(r"\b(sms|text messages?|texts)\b", l) or (re.search(r"consent|opt[- ]?in|by selecting", l) and re.search(r"phone|call", l)):
        return T(a.get("sms_consent") or "Yes", "I consent", "I agree", "Opt in", "Opt-in")
    # relatives or close relationships at the employer (Profile → relatives_at_employer, default No)
    if re.search(r"(family|relative|related|close (personal )?relationship|spouse|partner|household).{0,120}(employ|work)", l):
        return T(a.get("relatives_at_employer") or "No")
    if re.fullmatch(r"(work |employment )?authori[sz]ation( status)?", l):
        return T(a.get("work_authorized") or a.get("work_authorized_us"), "I authorize", "I agree", "Authorized")
    if re.search(r"(end|graduation|completion) (date )?year|year (of )?(graduation|completion)|graduat(ed|ion) year", l):
        return T(a.get("graduation_year"))
    if re.search(r"start (date )?year", l) and not re.search(r"available|work|employment", l):
        return T(a.get("education_start_year"))
    if re.search(r"sponsor|visa|immigration (support|status)|h-?1b", l):
        return T(a.get("requires_sponsorship"))
    if re.search(r"authori[sz](ed|ation) to work|work authori[sz]ation|right to work|legally (able|eligible|permitted|authori[sz]ed) to work|"
                 r"(eligible|permitted|able) to work (in|for)|legally work|eligible for employment", l):
        return T(work_authorized(l, a, ident))
    # "Do you acknowledge / understand / agree to ... (listed on this posting)?" → you accept the posting's stated terms
    if re.search(r"^(do you|please|i|can you|will you) (acknowledge|understand|confirm|agree|accept|certify|attest|have read)", l) \
            and not re.search(r"reloc|sponsor|salary|compensation", l):
        return T("Yes", "I acknowledge", "I agree", "I understand", "Acknowledged", "I confirm")
    if re.search(r"(employee|employed|worked|contractor) (of|by|for|at|with) .{0,60}(current|previous|former|before|ever)|"
                 r"(currently|previously|ever) (been )?(employed|worked|an employee)|current or (former|previous)|former employee", l):
        return T(a.get("previously_employed"))
    # instructions inside the question: 'If you answered "no", please type "N/A"' (your referral/relative answers are No)
    if re.search(r"(type|enter|write|put|answer)\s*[\"“']?\s*n/?a\b", l):
        return T("N/A")
    if re.search(r"(legal|mailing|home|street|residential) (mailing )?address", l) and "email" not in l:
        street = ident.get("address")
        full = ", ".join(x for x in [street, ident.get("city"), f"{ident.get('state', '')} {ident.get('zip', '')}".strip()] if x)
        return T(full if street else None)
    if re.search(r"(confirm(ation)?|verify).{0,20}location|city (and|&|,) state|city/state", l):
        city, st, stn = ident.get("city"), ident.get("state"), ident.get("state_name")
        return T(f"{city}, {st}" if city and st else None, f"{city}, {stn}" if city and stn else None, ident.get("location"))
    if re.search(r"accommodation", l):  # your Profile → needs_accommodation (default No)
        return T(a.get("needs_accommodation") or "No", "No, I do not", "I do not require")
    if re.search(r"(previously|already|ever) applied|applied (to|for|with) .{0,40}before", l):
        return T(a.get("previously_applied") or "No")
    if re.search(r"hear about|find (out about|this)|learn(ed)? about|how did you (find|hear|discover)|\bsource\b|referral source|where did you (see|find)", l):
        return "text", SOURCES
    if re.search(r"\b(preferred|nick) ?name", l):
        return T(ident.get("first_name"))
    if re.search(r"first name|given name|forename", l):
        return T(ident.get("first_name"))
    if re.search(r"last name|family name|surname", l):
        return T(ident.get("last_name"))
    if re.search(r"middle", l):
        return "unknown", []
    if re.fullmatch(r"(your )?(full |legal |full legal )?name", l) or re.search(r"full (legal )?name|legal name", l):
        return T(ident.get("full_name"))
    short = len(l) <= 60
    if short and re.search(r"e-?mail", l):
        return T(ident.get("email"))
    if short and re.search(r"phone", l) and re.search(r"country|code", l):
        country = ident.get("country") or "United States"
        code = CALLING_CODES.get(country.lower(), "")
        return T(country, code, f"{country} ({code})" if code else None, f"{code} {country}" if code else None)
    if short and re.search(r"phone|mobile|cell", l):
        return T(*phone_formats(ident.get("phone")))
    if "linkedin" in l:
        return T(ident.get("linkedin") or a.get("linkedin"))
    if re.search(r"(street|mailing|home)? ?address( line ?1)?$|^street", l) and "email" not in l:
        return T(ident.get("address"))
    if re.search(r"^(current |your |home )?location\b|^(city|town),? ?(and )?state|where are you (currently )?(located|based)|where do you (currently )?live", l):
        city, st, stn, ctry = ident.get("city"), ident.get("state"), ident.get("state_name"), ident.get("country")
        return T(f"{city}, {ctry}" if city and ctry and ctry != "United States" else None, f"{city}, {stn}" if city and stn else None,
                 f"{city}, {st}" if city and st else None, ident.get("location"), city)
    if re.search(r"zip|postal", l):
        return T(ident.get("zip"))
    if re.search(r"\bcity\b|town", l) and not re.search(r"reloc", l):
        return T(ident.get("city"))
    if re.search(r"\b(state|province|region)\b", l) and not re.search(r"united states|statement", l):
        return T(ident.get("state_name"), ident.get("state"))
    if re.search(r"\bcountry\b", l) and not re.search(r"phone", l) and not re.search(r"authori|eligib|right to work|citizen", l):
        country = ident.get("country") or "United States"
        return T(country, *(["United States of America", "USA", "US"] if country == "United States" else []))
    if re.search(r"time ?zone", l) and not YES_NO_QUESTION.match(l):
        tz = ident.get("timezone")
        if (ident.get("country") or "United States") == "United States":
            return T(tz, "Eastern", "EST", "ET", "Eastern Time")
        return T(tz, *([x for x in ["West Africa Time", "WAT", "GMT+1", "UTC+1", "GMT+01:00", "UTC+01:00", "(GMT+01:00) West Central Africa",
                                    "Africa/Lagos", "Lagos"]] if str(ident.get("country", "")).lower() == "nigeria" else []))
    resident = in_country(l, ident)
    if resident:
        return T(resident)
    if re.search(r"(current|most recent) (company|employer)|^(company|employer)( name)?$|name of (your )?(current )?employer", l):
        return T(ident.get("current_company"))
    if re.search(r"(current|most recent) (job )?(title|role|position)", l):
        return T(ident.get("current_title"))
    if re.search(r"18 years|over 18|at least 18|legal age|age of majority", l):
        return T("Yes")
    if re.search(r"(previously|ever|formerly|have you) (been )?(work|employ)|former employee|current or former|worked (here|for us|at)", l):
        return T(a.get("previously_employed"))
    if re.search(r"referr?ed|referral", l):
        return T("No") if not re.search(r"name|who", l) else ("unknown", [])
    if re.search(r"relocat", l):
        return T(a.get("relocate") or "No")
    if re.search(r"background (check|screen)|drug (test|screen)|screening", l):
        return T("Yes")
    if re.search(r"remote(ly)?|work from home", l) and re.search(r"able|willing|comfortable|open|okay|ok\b", l):
        return T("Yes")
    if re.search(r"english", l):
        return T("Yes", "Fluent", "Native", "Native or bilingual")
    if re.search(r"start date|available to start|availability|earliest|when can you start|notice period", l):
        return "date", vals(a.get("notice_period") or "2 weeks")
    if re.search(r"naira|\bngn\b|₦", l) and a.get("salary_ngn"):
        return T(a.get("salary_ngn"))
    if re.search(r"(hourly|per hour|rate per hour|hourly rate)", l) and a.get("hourly_rate"):
        return T(a.get("hourly_rate"))
    if re.search(r"how (would|do) you (like|prefer|want) to (be paid|receive)|payment (method|preference)|payout", l) and a.get("payment_method"):
        return T(a.get("payment_method"))
    if re.search(r"salary|compensation|pay (range|expectation)|desired pay|(hourly|pay) rate", l):
        return T(a.get("desired_salary") or "Negotiable", "Open", "Flexible")
    # total experience only: "years of experience with Salesforce" is a skill question your CV must answer, so not guessed
    if re.search(r"(total|professional|relevant|overall|work|healthcare|compliance) (years of )?experience", l) or \
            re.fullmatch(r"(how many )?years of (professional |relevant |total |work )?experience( do you have)?\??", l):
        return T(a.get("years_experience"))
    if re.search(r"highest (level of )?(education|degree)|education level|level of education|degree level", l):
        return T(a.get("highest_degree"), "Bachelor's Degree", "Bachelor's", "Bachelors", "Bachelor")
    if re.search(r"\b(school|university|college|institution)\b", l):
        return T(a.get("school"))
    if re.search(r"discipline|major|field of study|area of study", l):
        return T(a.get("field_of_study"))
    if re.search(r"^degree|degree( obtained| type)?$", l):
        return T(a.get("degree"), a.get("highest_degree"), "Bachelor's Degree")
    if "website" in l or "portfolio" in l or "github" in l:
        return T(ident.get("portfolio") or ident.get("linkedin"))
    if re.search(r"why|interest(ed)? in|motivat|tell us (about|why)|about yourself|cover letter|additional information|anything else", l):
        return "cover_text", vals(a.get("cover_letter_body"))
    return "unknown", []


def shot(page, evidence: Path, name: str) -> None:
    """Evidence screenshot (compressed JPEG) saved for your records; never fails the run."""
    try:
        page.screenshot(path=str(evidence / f"{len(list(evidence.glob('*.jpg'))) + 1:02d}_{name}.jpg"), full_page=True,
                        type="jpeg", quality=55)
    except Exception:  # noqa: BLE001
        pass


LABEL_JS = """el => {
  const txt = l => (l && !l.contains(el) && l.innerText || '').trim();
  if (el.id) { const t = txt(document.querySelector(`label[for="${el.id}"]`)); if (t) return t; }
  const own = el.closest('label'); if (own && own.innerText.trim()) return own.innerText.trim();
  // walk up a few levels to the question's own label (Lever puts it in a sibling div, not a <label>)
  let a = el.parentElement;
  for (let i = 0; a && i < 5; i++, a = a.parentElement) {
    for (const l of a.querySelectorAll('label, legend, .application-label .text, .application-label, .text')) { const t = txt(l); if (t) return t; }
  }
  return (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.name || '').trim();
}"""


# The QUESTION a radio/checkbox belongs to (its own label is just the option, e.g. "Yes").
QUESTION_JS = """el => {
  const g = el.closest('fieldset, [role=radiogroup], [role=group], .application-question, .custom-question, .field, .question');
  if (g) { for (const l of g.querySelectorAll('legend, .application-label .text, .application-label, .text, label'))
             if (!l.querySelector('input') && l.innerText.trim()) return l.innerText.trim(); }
  return '';
}"""


# What the page looks like when no confirmation appeared: visible error messages, a CAPTCHA widget, the form still there.
AFTER_SUBMIT_JS = r"""() => {
  const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  const sel = '.error, .field-error, .error-message, .application-error, [role=alert], [aria-invalid=true], [class*=error i], ' +
              '[class*=invalid i], [id*=error i], .helper-text--error';
  const errors = [...document.querySelectorAll(sel)]
    .filter(e => vis(e) && !e.querySelector('input, select, textarea') && e.tagName !== 'FORM' && e.tagName !== 'BODY')
    .map(e => (e.innerText || e.getAttribute('aria-label') || '').trim()).filter(t => t && t.length < 300)
    .filter((t, i, all) => all.indexOf(t) === i).slice(0, 6);
  const captcha = !!document.querySelector('iframe[src*="hcaptcha"], iframe[src*="recaptcha"], .h-captcha, .g-recaptcha, [data-hcaptcha-widget-id], script[src*="hcaptcha"], script[src*="recaptcha"]');
  const h = document.querySelector('h1, h2, h3');
  return { errors, captcha, form: !!document.querySelector('form'), heading: (h && h.innerText || document.title || '').trim() };
}"""


# Is this field flagged by the site after Submit (its own invalid mark, or an error message inside its field box)?
INVALID_JS = r"""e => {
  if (e.getAttribute('aria-invalid') === 'true') return true;
  try { if (e.matches(':invalid')) return true; } catch (x) {}
  const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  let box = e.parentElement;
  for (let i = 0; box && i < 5; i++, box = box.parentElement) {
    if (box.querySelectorAll('input:not([type=hidden]), select, textarea').length > 6) break;  // reached the whole form
    const msg = [...box.querySelectorAll('[class*=error i], [role=alert], [id*=error i], [class*=invalid i]')]
      .find(m => vis(m) && !m.querySelector('input, select, textarea') && (m.innerText || '').trim());
    if (msg) return true;
  }
  return false;
}"""
# A required mark next to the question rather than on the field itself ("Start date year" + a separate "*" span).
REQUIRED_NEAR_JS = r"""e => {
  let box = e.parentElement;
  for (let i = 0; box && i < 4; i++, box = box.parentElement) {
    if (box.querySelectorAll('input:not([type=hidden]), select, textarea').length > 6) return false;
    if (box.querySelector('[class*=required i], [class*=asterisk i], abbr[title*=required i]')) return true;
    const l = box.querySelector('label, legend, [class*=label i]');
    if (l && /[*✱]\s*$/.test((l.innerText || '').trim())) return true;
  }
  return false;
}"""


COMBO_JS = """e => e.getAttribute('role') === 'combobox' || !!e.getAttribute('aria-autocomplete') ||
  e.getAttribute('aria-haspopup') === 'listbox' || /select__input|select2-search|react-select/.test(e.className + ' ' + e.id)"""
HIDDEN_HELPER_JS = """e => e.getAttribute('aria-hidden') === 'true' || getComputedStyle(e).opacity === '0' || e.tabIndex < 0"""
FILLED_JS = """e => {
  if (e.tagName === 'SELECT') return e.selectedIndex > 0 && !/^(select|choose|please)/i.test(e.options[e.selectedIndex].text.trim());
  if (e.value && e.value.trim()) return true;
  const box = e.closest('[class*=select__control], [class*=container], .field, .select');  // React-Select shows the choice beside the input
  const shown = box && box.querySelector('[class*=single-value], [class*=singleValue]');
  return !!(shown && shown.innerText.trim());
}"""


def clean(label: str) -> str:
    return re.sub(r"[\s*✱]+$", "", " ".join((label or "").split()))


def combo_choose(page, el, values: list, decline: bool = False) -> bool:
    """Open a type-to-search drop-down (Greenhouse/React-Select, location search) and click the matching option."""
    def options():
        loc = page.locator("[role=option], [class*=select__option], .select2-results__option").filter(visible=True)
        return loc, [t.strip() for t in loc.all_inner_texts()]
    try:
        el.click(timeout=5000)
    except Exception:  # noqa: BLE001
        return False
    for typed in [None] + [v for v in values if v][:4]:
        if typed:
            try:
                el.fill("")
                el.type(str(typed)[:40], delay=15)
            except Exception:  # noqa: BLE001
                return False
            page.wait_for_timeout(1500)  # location searches load results from the internet
        else:
            page.wait_for_timeout(500)
        loc, texts = options()
        if not texts:
            continue
        i = next((k for k, t in enumerate(texts) if DECLINE.search(t)), None) if decline else pick_any(texts, values)
        if i is not None:
            loc.nth(i).click()
            page.wait_for_timeout(300)
            return True
    try:
        el.fill("")
        page.keyboard.press("Escape")
    except Exception:  # noqa: BLE001
        pass
    return False


def combo_peek(page, el) -> list[str]:
    """The choices of a type-to-search drop-down, without choosing one."""
    try:
        el.click(timeout=5000)
        page.wait_for_timeout(600)
        texts = [t.strip() for t in page.locator("[role=option], [class*=select__option]").filter(visible=True).all_inner_texts()]
        page.keyboard.press("Escape")
        return [t for t in texts if t][:40]
    except Exception:  # noqa: BLE001
        return []


# Yes/No questions drawn as buttons (Ashby and others) instead of radio buttons.
BUTTON_GROUPS_JS = r"""scope => {
  const out = []; let n = 0;
  document.querySelectorAll(scope + ' *').forEach(c => {
    if (c.hasAttribute('data-jj-group')) { out.push(JSON.parse(c.getAttribute('data-jj-info'))); return; }
    const bs = [...c.children].filter(b => b.tagName === 'BUTTON' && b.getAttribute('type') !== 'submit');
    if (bs.length < 2 || bs.length > 6) return;
    const texts = bs.map(b => b.innerText.trim());
    if (!texts.every(t => t && t.length < 60) || !texts.some(t => /^(yes|no)$/i.test(t))) return;
    let a = c.parentElement, q = '';
    for (let i = 0; a && i < 4 && !q; i++, a = a.parentElement) {
      for (const l of a.querySelectorAll('label, legend, [class*=question-title], [class*=title], p')) {
        if (!l.contains(c) && !c.contains(l) && l.innerText.trim()) { q = l.innerText.trim(); break; }
      }
    }
    const pressed = bs.some(b => b.getAttribute('aria-pressed') === 'true' || b.getAttribute('aria-checked') === 'true' ||
                                 /\b(active|selected|checked)\b|_active|Selected/.test(b.className));
    const info = { i: n, q, texts, pressed };
    c.setAttribute('data-jj-group', String(n)); c.setAttribute('data-jj-info', JSON.stringify(info)); n++;
    out.push(info);
  });
  return out;
}"""


def fill_button_groups(page, job: dict, log: dict, only: set | None = None, scope: str = "form") -> list[str]:
    problems = []
    for g in page.evaluate(BUTTON_GROUPS_JS, scope):
        q = clean(g["q"]) or "(unlabelled Yes/No question)"
        if g["pressed"] or (only is not None and q not in only):
            continue
        kind, values = value_for(g["q"], job)
        i = pick_any(g["texts"], values) if kind == "text" else None
        if i is not None:
            page.locator(f"[data-jj-group='{g['i']}'] > button").nth(i).click()
            log["filled"].append((q, g["texts"][i]))
        else:  # Yes/No toggles are almost always required
            log["needs"][q] = {"question": q, "options": g["texts"], "type": "radio", "multi": False}
            problems.append(q)
    return problems


def fill_field(page, el, job: dict, files: dict, done_groups: set, log: dict | None = None, only: set | None = None,
               force: set | None = None) -> str | None:
    """Fills one form field. Returns the question text if it is required and has no truthful answer, else None.
    log["filled"] gets (question, answer) pairs, log["needs"] the unanswered questions with their choices."""
    log = log if log is not None else {"filled": [], "needs": {}}
    typ = (el.get_attribute("type") or "").lower()
    tag = el.evaluate("e => e.tagName.toLowerCase()")
    if typ == "file":
        pass
    elif typ in ("radio", "checkbox"):
        pass  # custom-styled boxes are often invisible; handled below by their group
    elif not el.is_visible() or el.evaluate(HIDDEN_HELPER_JS):
        return None  # hidden helper inputs (React-Select keeps one for "required")
    label = el.evaluate(LABEL_JS)
    required = (el.get_attribute("required") is not None or el.get_attribute("aria-required") == "true"
                or "✱" in label or label.rstrip().endswith("*") or bool(el.evaluate(REQUIRED_NEAR_JS)))
    members = [el]
    option = label
    if typ in ("radio", "checkbox"):
        name = el.get_attribute("name")
        group = name or label
        if group in done_groups:
            return None
        done_groups.add(group)
        option = label
        label = el.evaluate(QUESTION_JS) or label
        members = page.locator(f"input[type={typ}][name='{name}']").all() if name else [el]
        if not any(m.is_visible() for m in members) and not el.evaluate("e => !!e.closest('label') || !!e.id"):
            return None
        required = required or any(m.get_attribute("required") is not None for m in members) or "✱" in label or label.rstrip().endswith("*")
        if typ == "checkbox" and len(members) == 1 and (CONSENT.search(label + " " + option) or ACK.search(label + " " + option)):
            el.check(force=True)
            return None
    kind, values = value_for(label, job)
    q = clean(label) or "(unlabelled required field)"
    if only is not None and q not in only:
        return None
    if force and q in force:
        required = True  # the site said this field is required
    is_combo0 = tag == "input" and typ not in ("radio", "checkbox", "file") and el.evaluate(COMBO_JS)

    def rec(v):
        log["filled"].append((q, str(v)[:300]))

    def need(detail):
        try:
            if tag == "select":
                opts = [t.strip() for t in el.locator("option").all_inner_texts() if t.strip() and not PLACEHOLDER.match(t.strip())]
            elif typ in ("radio", "checkbox"):
                opts = [m.evaluate(LABEL_JS) for m in members]
            elif is_combo0:
                opts = combo_peek(page, el)
            else:
                opts = []
        except Exception:  # noqa: BLE001
            opts = []
        log["needs"][q] = {"question": q, "options": opts[:40], "type": "textarea" if tag == "textarea" else (typ or tag),
                           "multi": typ == "checkbox" and len(members) > 1}
        return detail

    if kind == "resume":
        if typ == "file":
            el.set_input_files(str(files["resume"]))
            rec("(your approved resume PDF)")
        return None
    if kind == "cover":
        if typ == "file":
            el.set_input_files(str(files["cover"]))
            rec("(your approved cover letter PDF)")
            return None
        kind, values = "cover_text", [v for v in [job.get("answers", {}).get("cover_letter_body")] if v]
    if typ == "file":
        return q if required else None  # an unknown upload is never filled

    is_combo = tag == "input" and el.evaluate(COMBO_JS)
    already = el.evaluate(FILLED_JS) if typ not in ("radio", "checkbox") else any(m.is_checked() for m in members)

    if kind == "demographic":
        if typ in ("radio", "checkbox"):
            pick = next((m for m in members if DECLINE.search(m.evaluate(LABEL_JS))), None)
            if pick:
                pick.check(force=True)
                return None
        elif tag == "select":
            texts = el.locator("option").all_inner_texts()
            i = next((k for k, t in enumerate(texts) if DECLINE.search(t)), None)
            if i is not None:
                el.select_option(index=i)
                return None
        elif is_combo and combo_choose(page, el, [], decline=True):
            return None
        return need(q) if required and not already else None

    notice = str((job.get("answers") or {}).get("notice_period") or "2 weeks")
    if typ == "date" and kind in ("date", "text") and re.search(r"start|available|earliest|join", norm(label)):
        days = 0 if re.search(r"immediate|now|asap|today", notice, re.I) else 14
        el.fill((date.today() + timedelta(days=days)).isoformat())
        rec("today" if days == 0 else "in 2 weeks")
        return None
    if kind == "date":
        kind = "text"
    if kind == "cover_text":
        if values and tag == "textarea":
            el.fill(values[0])
            rec("(your cover letter text)")
            return None
        return need(q) if required and not already else None

    if kind == "text" and values:
        if tag == "select":
            texts = el.locator("option").all_inner_texts()
            i = pick_any(texts, values)
            if i is None:
                return None if already or not required else need(f"{q} (your answer \"{values[0]}\" is not one of: " +
                                                                  " / ".join(t.strip() for t in texts if t.strip())[:150] + ")")
            el.select_option(index=i)
            rec(texts[i].strip())
            return None
        if typ in ("radio", "checkbox"):
            texts = [m.evaluate(LABEL_JS) for m in members]
            i = pick_any(texts, values)
            if i is None:
                return None if not required else need(f"{q} (your answer \"{values[0]}\" is not one of: {' / '.join(texts)[:150]})")
            members[i].check(force=True)
            rec(texts[i])
            return None
        if is_combo:
            if combo_choose(page, el, values):
                rec(values[0])
                return None
            return None if already or not required else need(f"{q} (no matching choice for \"{values[0]}\")")
        if typ == "number":
            num = next((re.sub(r"[^\d.]", "", str(v)) for v in values if re.search(r"\d", str(v))), "")
            if num:
                el.fill(num)
                rec(num)
                return None
            return need(q) if required and not already else None
        el.fill(str(values[0]))
        rec(values[0])
        return None
    if already or not required:
        return None
    return need(q + (" (no answer in your Profile)" if kind == "text" else ""))


FIELDS = "input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=search]), select, textarea"
SUBMIT_BUTTONS = ("[data-qa=btn-submit], form button[type=submit], form input[type=submit], form button:has-text('Submit'), "
                  "button:has-text('Submit application'), button:has-text('Submit Application'), button[type=submit]:has-text('Submit')")
APPLY_BUTTON = re.compile(r"^\s*(apply( now| for this (job|position|role|opportunity))?|i.?m interested|application|start application)\s*$", re.I)


def fields_in(scope: str) -> str:
    return ", ".join(f"{scope} {f.strip()}" for f in FIELDS.split(","))


def open_form(page) -> str:
    """Gets to the application form and returns where its fields are ("form" or "body"), or "" if there is none.
    Forms built by JavaScript appear late; some pages show the job first and the form after an "Apply" button;
    some put the form in an embedded frame."""
    from playwright.sync_api import TimeoutError as PwTimeout
    for _ in range(3):
        try:
            page.wait_for_selector("input[type=email], input[type=file], form input:not([type=hidden]), form textarea", timeout=15000,
                                   state="attached")
        except PwTimeout:
            pass
        if page.locator(fields_in("form")).count() >= 3:
            return "form"
        if page.locator(fields_in("body")).count() >= 3 and page.locator("input[type=email], input[type=file]").count():
            return "body"  # a form drawn without a <form> element
        frame = next((f for f in page.frames[1:] if allowed(f.url) and f.locator(fields_in("body")).count() >= 3), None)
        if frame:
            page.goto(frame.url, wait_until="domcontentloaded")
            continue
        apply = page.locator("a, button").filter(has_text=APPLY_BUTTON).filter(visible=True)
        if apply.count():
            href = apply.first.get_attribute("href") or ""
            if href.startswith("http") and allowed(href):  # an Apply link that would open a new tab: open it here
                try:
                    page.goto(href, wait_until="domcontentloaded")
                    page.wait_for_timeout(2000)
                except PwTimeout:
                    return ""
                continue
            try:
                apply.first.click(timeout=10000)
                page.wait_for_load_state("domcontentloaded")
                page.wait_for_timeout(2000)
            except PwTimeout:
                return ""
            continue
        return ""
    return ""


def submit(job: dict, files: dict, evidence: Path, timeout_s: float = 60, headless: bool = True, ask=None,
           sheet_out: list | None = None, dry_run: bool = False) -> tuple[str, str]:
    """Returns (outcome, detail). outcome: SUBMITTED | NEEDS_YOU | UNCERTAIN | NOT_SENT
    ask(questions) -> {question: answer}: CV-based answers from the Sheet for questions your Profile doesn't cover.
    sheet_out receives the answer sheet (every question and the answer given), so you can finish any form yourself fast."""
    log = {"filled": [], "needs": {}}
    if sheet_out is not None:
        sheet_out.append(log)
    job = {**job, "answers": {**(job.get("answers") or {}), "custom": list((job.get("answers") or {}).get("custom") or [])}}
    from playwright.sync_api import TimeoutError as PwTimeout
    from playwright.sync_api import sync_playwright

    url = application_url(job)
    SITE.clear()
    if job.get("ats") == "other" and url.startswith("https://") and not LOGIN_HOSTS.search(url):
        SITE.append(site_domain(url))  # the employer's own careers page: try it (it stops on a login or CAPTCHA)
    if not allowed(url):
        return "NEEDS_YOU", "This site is not supported for automatic applying; please apply with the approved PDF."
    evidence.mkdir(parents=True, exist_ok=True)
    clicked = False
    exe = os.environ.get("CHROMIUM_PATH") or None
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=headless, executable_path=exe)
        try:
            page = browser.new_page()
            page.set_default_timeout(15000)
            page.route("**/*", lambda r: r.abort() if r.request.is_navigation_request() and not allowed(r.request.url) else r.continue_())
            resp = page.goto(url, timeout=30000, wait_until="domcontentloaded")
            # the application address can change (or be built wrongly): try the job posting and the site's other form addresses
            for alt in [u for u in alternate_urls(job, url) if allowed(u)]:
                if resp is not None and resp.status < 400:
                    break
                resp = page.goto(alt, timeout=30000, wait_until="domcontentloaded")
            if resp is None or resp.status >= 400:
                if resp is not None and resp.status in (404, 410):
                    return "CLOSED", "The job is no longer online (page not found): the employer has closed it."
                return "NEEDS_YOU", f"The application page did not open (HTTP {resp.status if resp else '?'})."
            page.wait_for_timeout(1500)
            scope = open_form(page)  # waits for the form; follows an "Apply" button or an embedded form if needed
            shot(page, evidence, "application_page")
            if page.locator("input[type=password]").count():
                return "NEEDS_YOU", "The site asks for a login/account. Nothing was sent."
            kind = page.evaluate(VISIBLE_CAPTCHA_JS)
            if kind:
                return "NEEDS_YOU", f"The form shows a {kind} that a person must complete. Nothing was sent; please submit it yourself with the approved PDF."
            if not scope:
                title = (page.title() or "").strip()[:80]
                return "NEEDS_YOU", (f"No application form found on the page ({urlsplit(page.url).hostname}: \"{title}\"). "
                                     "Nothing was sent; please apply with the approved PDF.")
            def fill_all(only=None, force=None):
                found, done_groups = [], set()
                for el in page.locator(fields_in(scope)).all():
                    try:
                        trouble = fill_field(page, el, job, files, done_groups, log, only, force)
                    except Exception:  # noqa: BLE001  (a field that can't be operated must not stop the others)
                        try:
                            trouble = clean(el.evaluate(LABEL_JS)) or "(a field that could not be filled)"
                        except Exception:  # noqa: BLE001
                            trouble = None
                    if trouble and trouble not in found:
                        found.append(trouble)
                try:
                    found += [q for q in fill_button_groups(page, job, log, only, scope) if q not in found]
                except Exception:  # noqa: BLE001
                    pass
                return found

            def answer_from_cv(problems, force=None):
                """Questions your Profile doesn't cover: the Sheet answers them from your CV only (checked against it)."""
                if not (problems and log["needs"] and ask):
                    return problems
                try:
                    answers = ask(list(log["needs"].values())) or {}
                except Exception:  # noqa: BLE001
                    answers = {}
                got = {q: a for q, a in answers.items() if a not in (None, "")}
                if not got:
                    return problems
                for q, a in got.items():
                    job["answers"]["custom"].append([norm(q), a])
                    log["needs"].pop(q, None)
                still = fill_all(set(got), force)
                return [p for p in problems if not any(p.startswith(q) for q in got)] + [p for p in still if p not in problems]

            def flagged_fields():
                out = []
                for el in page.locator(fields_in(scope)).all():
                    try:
                        if not el.evaluate(INVALID_JS):
                            continue
                        typ = (el.get_attribute("type") or "").lower()
                        q = clean(el.evaluate(QUESTION_JS) if typ in ("radio", "checkbox") else "") or clean(el.evaluate(LABEL_JS))
                        if q and q not in out:
                            out.append(q)
                    except Exception:  # noqa: BLE001
                        pass
                return out

            problems = answer_from_cv(fill_all())
            if problems:
                for q in log["needs"]:
                    log["filled"].append((q, "(your answer needed)"))
                shot(page, evidence, "questions_needing_answers")
                return "NEEDS_YOU", "Nothing was sent. Questions needing your answer: " + "; ".join(
                    re.sub(r"[\s*✱]+$", "", " ".join(q.split())) for q in problems[:6])
            shot(page, evidence, "filled_form_before_submit")
            # Only a VISIBLE submit button: Lever forms also contain a hidden one, and its "Submit application" button is type=button.
            if dry_run:  # test run on a real form: everything filled, Submit NOT clicked
                has_button = page.locator(SUBMIT_BUTTONS).filter(visible=True).count() > 0
                return "DRY_RUN", f"form filled ({len(log['filled'])} answers), Submit button {'found' if has_button else 'NOT found'}; not submitted"
            button = page.locator(SUBMIT_BUTTONS).filter(visible=True).first
            if not button.count():
                return "NEEDS_YOU", "Could not find the Submit button. Nothing was sent; please submit it yourself with the approved PDF."
            try:
                button.scroll_into_view_if_needed(timeout=5000)
                button.click(no_wait_after=True, timeout=15000)
            except PwTimeout:  # the click never happened (button covered or disabled)
                shot(page, evidence, "submit_button_not_clickable")
                return "NOT_SENT", ("The Submit button could not be clicked (covered or disabled, often because the form still wants "
                                    "something). Nothing was sent; please submit it yourself with the approved PDF.")
            clicked = True
            url_before = page.url
            def confirmed():
                try:
                    page.wait_for_function("re => new RegExp(re, 'i').test(document.body.innerText) || /confirmation|thank/i.test(location.href)",
                                           arg=CONFIRM.pattern, timeout=timeout_s * 1000)
                    return True
                except PwTimeout:
                    return False

            phone_tried = False
            for attempt in range(3):
                if confirmed():
                    break
                shot(page, evidence, f"after_submit_click_{attempt + 1}")
                if page.evaluate(CHALLENGE_JS):
                    return "NEEDS_YOU", ("A CAPTCHA puzzle appeared when Submit was clicked, so the application was NOT accepted. "
                                         "Please submit it yourself with the approved PDF.")
                after = page.evaluate(AFTER_SUBMIT_JS)
                flagged = flagged_fields() if page.locator("form").count() or scope == "body" else []
                if not (after["errors"] or flagged):
                    if page.url == url_before and after["form"] and after["captcha"]:
                        # Lever-style hidden CAPTCHA: it silently stops the submission, so the page never changes.
                        return "NEEDS_YOU", ("The site's hidden CAPTCHA check stopped the automatic submission (the page did not change). "
                                             "Most likely nothing was sent; please submit it yourself with the approved PDF.")
                    return "UNCERTAIN", ("Clicked submit but no confirmation appeared (page: " + after["heading"][:80] + ", address " +
                                         ("unchanged" if page.url == url_before else "changed") + "). Not retried; check your email for a confirmation.")
                if attempt == 2:
                    break
                # The site rejected the form, so nothing was sent. Fill what it flagged, then submit again.
                phone_flagged = re.search(r"phone", " ".join(after["errors"] + flagged), re.I)
                alt = (phone_formats(job["identity"].get("phone")) or [None, None])[-1]
                phone_q = {q for q in flagged if re.fullmatch(r"(mobile |cell )?phone( number)?", norm(q))}
                if phone_flagged and alt and not phone_tried:
                    phone_tried = True
                    for b in page.locator(fields_in(scope)).all():
                        try:
                            if re.fullmatch(r"(mobile |cell )?phone( number)?", norm(b.evaluate(LABEL_JS))):
                                b.fill(alt)
                        except Exception:  # noqa: BLE001
                            pass
                force = set(flagged) - phone_q  # the phone was just re-entered in its other format
                still = answer_from_cv(fill_all(force, force), force) if force else []
                if still:
                    for q in log["needs"]:
                        log["filled"].append((q, "(your answer needed)"))
                    shot(page, evidence, "questions_needing_answers")
                    return "NEEDS_YOU", ("Nothing was sent. The site requires answers to: " +
                                         "; ".join(re.sub(r"[\s*✱]+$", "", " ".join(q.split())) for q in still[:6]) +
                                         ". Answer them once in the Answers tab and it is sent again by itself.")
                button = page.locator(SUBMIT_BUTTONS).filter(visible=True).first
                if not button.count():
                    return "NEEDS_YOU", "Could not find the Submit button again. Nothing was sent; please submit it yourself."
                button.click(no_wait_after=True, timeout=15000)
            else:
                pass
            if not CONFIRM.search(page.inner_text("body") or "") and not re.search(r"confirmation|thank", page.url, re.I):
                after = page.evaluate(AFTER_SUBMIT_JS)
                return "NOT_SENT", ("The site still rejected the form after filling what it asked for: " + "; ".join(after["errors"])[:250] +
                                    ". Nothing was sent; please review and submit it yourself.")
            shot(page, evidence, "confirmation")
            m = CONFIRM.search(page.inner_text("body"))
            return "SUBMITTED", f"Confirmation shown: \"{m.group(0) if m else 'thank-you page'}\""
        except Exception as e:  # noqa: BLE001
            if clicked:
                return "UNCERTAIN", (f"Error after the final click ({type(e).__name__}: {str(e).splitlines()[0][:120]}); not retried. "
                                     "Check your email for a confirmation.")
            return "NOT_SENT", f"Error before submitting ({type(e).__name__}); nothing was sent."
        finally:
            browser.close()


def call(client: httpx.Client, url: str, secret: str, **body) -> dict:
    r = client.post(url, json={"secret": secret, **body}, follow_redirects=True, timeout=120)
    r.raise_for_status()
    return r.json()


def main() -> int:
    url, secret = os.environ["SHEET_WEBAPP_URL"], os.environ["APPLIER_SECRET"]
    c = httpx.Client()
    q = c.get(url, params={"action": "queue", "secret": secret}, follow_redirects=True, timeout=120)
    q.raise_for_status()
    data = q.json()
    if "error" in data:
        print("Sheet refused:", data["error"])
        return 1
    items = data.get("items", [])
    print(f"{len(items)} approved application(s) waiting")
    for it in items:
        claim = call(c, url, secret, action="claim", app_id=it["app_id"], hash=it["hash"])
        if not claim.get("ok"):
            print(it["app_id"], "skipped:", claim.get("reason"))
            continue
        with tempfile.TemporaryDirectory() as tmp:
            who = re.sub(r"[^A-Za-z0-9]+", "_", str((claim.get("identity") or {}).get("full_name") or "")).strip("_")
            pre = who + "_" if who else ""  # upload as Jane_Doe_Resume.pdf, not Resume.pdf
            files = {"resume": Path(tmp) / f"{pre}Resume.pdf", "cover": Path(tmp) / f"{pre}Cover_Letter.pdf"}
            files["resume"].write_bytes(base64.b64decode(claim["resume_pdf"]))
            files["cover"].write_bytes(base64.b64decode(claim["cover_pdf"]))
            ev_dir = Path(os.environ.get("EVIDENCE_DIR", tmp)) / it["app_id"]
            sheet = []
            ask = lambda qs, app_id=it["app_id"]: call(c, url, secret, action="answers", app_id=app_id, questions=qs).get("answers") or {}
            outcome, detail = submit(claim, files, ev_dir, timeout_s=float(os.environ.get("CONFIRM_TIMEOUT", 60)), ask=ask, sheet_out=sheet)
            answer_sheet = "\n".join(f"{q}: {a}" for q, a in (sheet[0]["filled"] if sheet else []))[:20000]
            evidence = [{"name": f.name, "b64": base64.b64encode(f.read_bytes()).decode()}
                        for f in sorted(ev_dir.glob("*.jpg"))[:6] if f.stat().st_size < 4_000_000]
        needs = list(sheet[0]["needs"]) if sheet else []
        call(c, url, secret, action="result", app_id=it["app_id"], outcome=outcome, detail=detail, evidence=evidence,
             answer_sheet=answer_sheet, needs=needs)
        print(it["app_id"], outcome)
    return 0


if __name__ == "__main__":
    sys.exit(main())
