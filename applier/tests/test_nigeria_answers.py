"""Form answers for a candidate living in Nigeria (no browser needed)."""

import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("apply", ROOT / "applier" / "apply.py")
apply = importlib.util.module_from_spec(spec)
spec.loader.exec_module(apply)

JOB = {"identity": {"full_name": "Test Person", "first_name": "Test", "last_name": "Person", "city": "Abuja", "state": "FCT",
                    "state_name": "Federal Capital Territory", "country": "Nigeria", "timezone": "West Africa Time (WAT, UTC+1)",
                    "phone": "+2348000000000", "location": "Abuja, FCT, Nigeria"},
       "answers": {"work_authorized": "Yes", "work_authorized_countries": "Nigeria", "requires_sponsorship": "No", "gender": "Male",
                   "notice_period": "Immediately", "hourly_rate": "$10 per hour", "salary_ngn": "N400,000 per month",
                   "payment_method": "Direct payment to my USD bank account", "desired_salary": "$10 per hour"}}


def ans(q):
    return apply.value_for(q, JOB)


def test_work_authorization_by_country():
    assert ans("Are you legally authorized to work in the United States?") == ("text", ["No"])
    assert ans("Do you have the right to work in the UK?") == ("text", ["No"])
    assert ans("Are you authorized to work in Nigeria?") == ("text", ["Yes"])
    assert ans("Are you authorized to work in the country where you live?") == ("text", ["Yes"])
    assert ans("Are you legally eligible to work for us?") == ("text", ["Yes"])
    assert ans("Will you now or in the future require visa sponsorship?") == ("text", ["No"])


def test_residence_country_phone_and_time_zone():
    assert ans("Do you currently reside in the US?") == ("text", ["No"])
    assert ans("Are you based in Nigeria?") == ("text", ["Yes"])
    assert ans("Country")[1][0] == "Nigeria"
    assert "+234" in ans("Phone country code")[1]
    assert ans("Time zone")[1][:3] == ["West Africa Time (WAT, UTC+1)", "West Africa Time", "WAT"]
    assert ans("Location")[1][0] == "Abuja, Nigeria"
    assert apply.phone_formats("+2348000000000")[0] == "+2348000000000"


def test_gender_pay_and_start():
    assert ans("Gender")[1][0] == "Male"
    assert ans("Race / Ethnicity") == ("demographic", [])
    assert ans("Expected monthly salary (NGN)") == ("text", ["N400,000 per month"])
    assert ans("What is your hourly rate expectation?") == ("text", ["$10 per hour"])
    assert ans("How would you like to be paid?") == ("text", ["Direct payment to my USD bank account"])
    assert ans("When can you start?") == ("date", ["Immediately"])


def test_us_profile_still_works():
    us = {"identity": {"country": "United States", "timezone": "Eastern"}, "answers": {"work_authorized_us": "Yes"}}
    assert apply.value_for("Are you legally authorized to work in the United States?", us) == ("text", ["Yes"])
    assert apply.value_for("Time zone", us)[1][0] == "Eastern"


def test_employer_sites_without_login_are_tried():
    apply.SITE.clear()
    assert apply.site_domain("https://careers.acme.com/jobs/12") == "acme.com"
    assert apply.site_domain("https://jobs.acme.com.ng/apply") == "acme.com.ng"
    assert apply.allowed("https://acme.teamtailor.com/jobs/1/applications/new")
    assert not apply.allowed("https://careers.acme.com/jobs/12"), "an unknown site only for the application being sent"
    apply.SITE.append("acme.com")
    assert apply.allowed("https://careers.acme.com/jobs/12") and apply.allowed("https://acme.com/apply")
    assert not apply.allowed("https://other.com/x")
    assert not apply.allowed("https://acme.wd1.myworkdayjobs.com/en-US/careers/job/1"), "login sites are never filled in"
    apply.SITE.clear()


def test_no_experience_matches_differently_worded_choices():
    opts = ["Select...", "Expert: I have managed macOS fleets", "Some: occasional support", "None: I have not supported macOS"]
    assert apply.pick_option(opts, "no experience") == 3
    assert apply.pick_option(["Please select", "0 years", "1-2 years", "3+ years"], "None") == 1
    assert apply.pick_option(["Yes", "No"], "no experience") == 1
    assert apply.pick_option(["Advanced", "Intermediate"], "no experience") is None, "never picks a choice that is not true"


def test_alternate_addresses():
    alt = apply.alternate_urls({"apply_url": "https://boards.greenhouse.io/embed/job_app?for=acme&token=123",
                                "job_url": "https://acme.com/careers/123"}, "https://boards.greenhouse.io/embed/job_app?for=acme&token=123")
    assert alt == ["https://job-boards.greenhouse.io/acme/jobs/123", "https://boards.greenhouse.io/acme/jobs/123", "https://acme.com/careers/123"]
    assert apply.alternate_urls({"apply_url": "https://jobs.lever.co/acme/1111-2222/apply"}, "x") == ["https://jobs.lever.co/acme/1111-2222"]
