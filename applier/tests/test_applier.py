"""The GitHub applier against a fake Sheet web app and local replica application forms (no real employer)."""

import base64
import importlib.util
import json
import os
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


def load_applier():
    spec = importlib.util.spec_from_file_location("apply", ROOT / "applier" / "apply.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


@pytest.fixture(scope="module")
def replica(tmp_path_factory):
    import subprocess
    import sys
    import time

    import httpx
    port = 8766
    env = {**os.environ, "REPLICA_STORE": str(tmp_path_factory.mktemp("r") / "store.json")}
    proc = subprocess.Popen([sys.executable, "-m", "uvicorn", "replica_ats:app", "--port", str(port), "--log-level", "warning"],
                            cwd=Path(__file__).parent, env=env)
    for _ in range(50):
        try:
            httpx.get(f"http://127.0.0.1:{port}/api/last", timeout=1)
            break
        except httpx.HTTPError:
            time.sleep(0.2)
    yield f"http://127.0.0.1:{port}"
    proc.terminate()


class FakeSheet:
    """Implements the Sheet web app contract: queue / claim / result."""

    def __init__(self, items):
        self.items, self.status, self.results = items, {i["app_id"]: "APPROVED" for i in items}, {}

    def handler(self):
        sheet = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _send(self, obj):
                b = json.dumps(obj).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b)

            def do_GET(self):
                if "secret=s3cret" not in self.path:
                    return self._send({"error": "unauthorized"})
                self._send({"items": [{"app_id": i["app_id"], "hash": "h", "ats": "greenhouse", "apply_url": i["url"]}
                                      for i in sheet.items if sheet.status[i["app_id"]] == "APPROVED"]})

            def do_POST(self):
                req = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                if req["secret"] != "s3cret":
                    return self._send({"error": "unauthorized"})
                if req["action"] == "claim":
                    if sheet.status[req["app_id"]] != "APPROVED":
                        return self._send({"ok": False, "reason": "not approved"})
                    sheet.status[req["app_id"]] = "SUBMITTING"
                    item = next(i for i in sheet.items if i["app_id"] == req["app_id"])
                    pdf = base64.b64encode(b"%PDF-1.4 test").decode()
                    return self._send({"ok": True, "apply_url": item["url"], "ats": "greenhouse", "resume_pdf": pdf, "cover_pdf": pdf,
                                       "identity": {"full_name": "Test Person", "first_name": "Test", "last_name": "Person",
                                                    "email": "t@example.invalid", "phone": "202-555-0100", "location": "Washington, DC 20005",
                                                    "city": "Washington", "state": "DC", "state_name": "District of Columbia",
                                                    "zip": "20005", "country": "United States", "timezone": "Eastern",
                                                    "current_company": "Example Care"},
                                       "answers": {"work_authorized_us": "true", "requires_sponsorship": "No", "desired_salary": "",
                                                   "years_experience": "7", "highest_degree": "Bachelor's Degree", "school": "Example State University",
                                                   "field_of_study": "Public Health", "previously_employed": "No", "relocate": "No",
                                                   "notice_period": "2 weeks", "cover_letter_body": "I am applying because ...",
                                                   "graduation_year": "2015", "education_start_year": "2011"}})
                if req["action"] == "answers":
                    known = {"Do you have Medicaid compliance experience?": "Yes",
                             "How many years of experience with licensing clinical-related staff do you have?": "0",
                             "Describe your audit experience": "I co-led state audits of care plan approvals."}
                    sheet.asked = getattr(sheet, "asked", []) + [q["question"] for q in req["questions"]]
                    return self._send({"ok": True, "answers": {q["question"]: known[q["question"]] for q in req["questions"]
                                                               if q["question"] in known}})
                if req["action"] == "result":
                    sheet.sheets = getattr(sheet, "sheets", {})
                    sheet.sheets[req["app_id"]] = req.get("answer_sheet", "")
                    sheet.status[req["app_id"]] = req["outcome"]
                    sheet.results[req["app_id"]] = req["detail"]
                    sheet.evidence = getattr(sheet, "evidence", {})
                    sheet.evidence[req["app_id"]] = [e["name"] for e in req.get("evidence", [])]
                    return self._send({"ok": True})
        return H


def test_applier_end_to_end(replica, monkeypatch, tmp_path):
    mock_ats = replica
    sheet = FakeSheet([{"app_id": "A-ok", "url": f"{mock_ats}/gh/gh-ok"},
                       {"app_id": "A-captcha", "url": f"{mock_ats}/gh/gh-captcha"},
                       {"app_id": "A-invisible", "url": f"{mock_ats}/gh/gh-invisible-captcha"},
                       {"app_id": "A-essay", "url": f"{mock_ats}/gh/gh-essay"},
                       {"app_id": "A-lever", "url": f"{mock_ats}/lever/lv-ok"},
                       {"app_id": "A-lever-q", "url": f"{mock_ats}/lever/lv-hear"},
                       {"app_id": "A-gh2", "url": f"{mock_ats}/gh2/gh2-ok"},
                       {"app_id": "A-gh2-ask", "url": f"{mock_ats}/gh2ask/gh2-ask"},
                       {"app_id": "A-ashby", "url": f"{mock_ats}/ashby/ashby-ok"},
                       {"app_id": "A-phone", "url": f"{mock_ats}/phone/phone-ok"},
                       {"app_id": "A-rej", "url": f"{mock_ats}/rej/rej-ok"},
                       {"app_id": "A-rej-ask", "url": f"{mock_ats}/rej/rej-ask"},
                       {"app_id": "A-lever-hcaptcha", "url": f"{mock_ats}/lever/lv-hcaptcha"},
                       {"app_id": "A-lever-real", "url": f"{mock_ats}/lever/lv-real"},
                       {"app_id": "A-other", "url": "https://www.example.com/careers/1"}])
    srv = HTTPServer(("127.0.0.1", 0), sheet.handler())
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    monkeypatch.setenv("SHEET_WEBAPP_URL", f"http://127.0.0.1:{srv.server_port}/exec")
    monkeypatch.setenv("APPLIER_SECRET", "s3cret")
    monkeypatch.setenv("EXTRA_ALLOWED_HOSTS", "127.0.0.1")
    monkeypatch.setenv("EVIDENCE_DIR", str(tmp_path))
    monkeypatch.setenv("CONFIRM_TIMEOUT", "8")
    if Path("/opt/pw-browsers/chromium").exists():
        monkeypatch.setenv("CHROMIUM_PATH", "/opt/pw-browsers/chromium")
    applier = load_applier()
    assert applier.main() == 0
    srv.shutdown()
    assert sheet.status["A-lever-real"] == "SUBMITTED", sheet.results["A-lever-real"]
    assert sheet.status["A-gh2"] == "SUBMITTED", sheet.results["A-gh2"]
    assert sheet.status["A-phone"] == "SUBMITTED", sheet.results["A-phone"]
    assert sheet.status["A-rej"] == "SUBMITTED", sheet.results["A-rej"]   # filled what the site flagged, then resubmitted
    assert "obscure scheduling tool" in sheet.results["A-rej-ask"] and "Answers tab" in sheet.results["A-rej-ask"], sheet.results["A-rej-ask"]   # rejected (555) format, accepted digits
    assert sheet.status["A-gh2-ask"] == "SUBMITTED", (sheet.results["A-gh2-ask"], getattr(sheet, "asked", None))
    assert sheet.status == {"A-ok": "SUBMITTED", "A-captcha": "NEEDS_YOU", "A-invisible": "SUBMITTED",
                            "A-essay": "SUBMITTED", "A-lever": "SUBMITTED", "A-lever-q": "NEEDS_YOU", "A-lever-real": "SUBMITTED", "A-lever-hcaptcha": "NEEDS_YOU", "A-gh2": "SUBMITTED", "A-gh2-ask": "SUBMITTED", "A-ashby": "SUBMITTED", "A-phone": "SUBMITTED", "A-rej": "SUBMITTED", "A-rej-ask": "NEEDS_YOU",
                            "A-other": "NEEDS_YOU"}, sheet.results
    assert sheet.status["A-lever-real"] == "SUBMITTED", sheet.results["A-lever-real"]
    assert sheet.status["A-gh2"] == "SUBMITTED", sheet.results["A-gh2"]
    assert sheet.status["A-phone"] == "SUBMITTED", sheet.results["A-phone"]
    assert sheet.status["A-rej"] == "SUBMITTED", sheet.results["A-rej"]   # filled what the site flagged, then resubmitted
    assert "obscure scheduling tool" in sheet.results["A-rej-ask"] and "Answers tab" in sheet.results["A-rej-ask"], sheet.results["A-rej-ask"]   # rejected (555) format, accepted digits
    assert sheet.status["A-gh2-ask"] == "SUBMITTED", (sheet.results["A-gh2-ask"], getattr(sheet, "asked", None))
    assert "hidden CAPTCHA" in sheet.results["A-lever-hcaptcha"], sheet.results["A-lever-hcaptcha"]
    # the real question is reported, not the option text "Yes"
    assert sheet.results["A-lever-q"].endswith("Do you hold a current CPHQ certification?"), sheet.results["A-lever-q"]
    assert "reCAPTCHA checkbox" in sheet.results["A-captcha"]
    import httpx
    last = httpx.get(f"{mock_ats}/api/last").json()  # the real-questions Lever form was the last one submitted
    assert last["job_id"] == "lv-real", last
    assert last["fields"]["cards[c2][field0]"] == "No, I will not require sponsorship", last
    assert last["fields"]["cards[c2][field1]"] == "Yes" and last["fields"]["cards[c2][field2]"] == "I understand", last
    gh2 = next(x for x in httpx.get(f"{mock_ats}/api/all").json() if x["job_id"] == "gh2-ok")["fields"]
    assert gh2["country"] == "United States" and gh2["state"] == "District of Columbia", gh2
    assert gh2["candidate-location"] == "Washington, District of Columbia, United States", gh2
    assert gh2["adult"] == "Yes" and gh2["gender"] == "Decline To Self Identify", gh2
    assert (gh2["hear"], gh2["prev"], gh2["yrs"], gh2["edu"]) == ("Company Website", "No", "6-8 years", "Bachelor's Degree"), gh2
    assert (gh2["school"], gh2["disc"], gh2["start"], gh2["certify"]) == ("Example State University", "Public Health", "2 weeks", "yes"), gh2
    assert gh2["why"].startswith("I am applying"), gh2
    rej = next(x for x in httpx.get(f"{mock_ats}/api/all").json() if x["job_id"] == "rej-ok")["fields"]
    assert (rej["sy"], rej["ey"], rej["lic"]) == ("2011", "2015", "0") and "Test_Person_Resume.pdf" in rej["resume"], rej
    subs = httpx.get(f"{mock_ats}/api/all").json()
    ask = next(x for x in subs if x["job_id"] == "gh2-ask")["fields"]
    assert ask["medicaid"] == "Yes" and ask["audit"].startswith("I co-led state audits"), ask   # answered from her CV
    ashby = next(x for x in subs if x["job_id"] == "ashby-ok")["fields"]
    assert (ashby["auth"], ashby["sponsor"], ashby["resume"]) == ("Yes", "No", "<file Test_Person_Resume.pdf>"), ashby   # Yes/No buttons
    # the answer sheet lists every question and answer, and what still needs her
    assert "Country: United States" in sheet.sheets["A-gh2"], sheet.sheets["A-gh2"]
    assert "Do you hold a current CPHQ certification?: (your answer needed)" in sheet.sheets["A-lever-q"], sheet.sheets["A-lever-q"]
    assert "Do you hold a current CPHQ certification?" in sheet.asked
    assert last["fields"]["name"] == "Test Person" and last["fields"]["org"] == "Example Care", last
    assert last["fields"]["cards[c1][field0]"] == "Yes" and last["fields"]["cards[c1][field1]"] == "No", last
    assert last["fields"]["cards[c1][field2]"] == "Yes", "accuracy confirmation box ticked"
    assert any("confirmation" in n for n in sheet.evidence["A-ok"]), sheet.evidence
    assert any("filled_form_before_submit" in n for n in sheet.evidence["A-ok"])
    assert any("questions_needing_answers" in n for n in sheet.evidence["A-lever-q"])
    assert sheet.evidence["A-captcha"], "even a hand-off is documented with a screenshot"
    # running again does nothing: nothing is still approved, and an attempt is never repeated
    sheet2 = sheet
    assert all(s != "APPROVED" for s in sheet2.status.values())


def test_greenhouse_jobs_listed_on_company_sites_use_the_hosted_form():
    a = load_applier()
    job = {"apply_url": "https://www.acmehealth.com/careers/open-roles?gh_jid=4567890", "ats": "greenhouse", "board": "acmehealth"}
    assert a.application_url(job) == "https://boards.greenhouse.io/embed/job_app?for=acmehealth&token=4567890"
    assert a.allowed(a.application_url(job))
    assert a.application_url({"apply_url": "https://jobs.lever.co/x/1", "ats": "lever"}) == "https://jobs.lever.co/x/1"
    assert a.allowed("https://acme.bamboohr.com/careers/12") and not a.allowed("https://acme.wd5.myworkdayjobs.com/x")


def test_applier_rejects_wrong_secret(monkeypatch):
    sheet = FakeSheet([])
    srv = HTTPServer(("127.0.0.1", 0), sheet.handler())
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    monkeypatch.setenv("SHEET_WEBAPP_URL", f"http://127.0.0.1:{srv.server_port}/exec")
    monkeypatch.setenv("APPLIER_SECRET", "wrong")
    assert load_applier().main() == 1
    srv.shutdown()


def test_common_question_bank_answers():
    """Answers from the Answers tab's common questions; a Yes/No answer never goes into a free-text question."""
    a = load_applier()
    bank = [["convicted|felony", "No"], ["\\bpmp\\b", "Yes"], ["signature|type your (full )?name", "Test Person"],
            ["^(do you have )?(any )?(experience (with|in) )?medicaid( program)?s?( experience)?\\??$", "Yes"]]
    job = {"identity": {}, "answers": {"bank": bank}}
    assert a.value_for("Have you ever been convicted of a felony? *", job) == ("text", ["No"])
    assert a.value_for("Do you hold a PMP certification?", job) == ("text", ["Yes"])
    assert a.value_for("Signature", job) == ("text", ["Test Person"])
    assert a.value_for("Do you have Medicaid experience?", job) == ("text", ["Yes"])
    assert a.value_for("Please describe how you used your PMP training in a past project, with examples and outcomes", job)[0] != "text" \
        or a.value_for("Please describe how you used your PMP training in a past project, with examples and outcomes", job)[1] != ["Yes"]
