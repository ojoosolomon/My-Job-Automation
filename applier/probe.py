"""Test run on REAL application forms: opens them, fills every field with placeholder details, and never clicks Submit.

    python probe.py greenhouse:oscar lever:lyrahealth ashby:ramp

Prints, for each form, what it would answer and what would still need your. Uses no personal data.
"""

import os
import sys
import tempfile
import time
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).parent))
import apply  # noqa: E402

PLACEHOLDER = {
    "identity": {"full_name": "Test Person", "first_name": "Test", "last_name": "Person", "email": "test.person@example.com",
                 "phone": "2025550123", "location": "Washington, DC 20005", "linkedin": "", "current_company": "Example Care",
                 "current_title": "Case Manager"},
    "answers": {"work_authorized_us": "Yes", "requires_sponsorship": "No", "desired_salary": "", "years_experience": "7",
                "highest_degree": "Bachelor's Degree", "degree": "Bachelor of Science", "school": "Example State University",
                "field_of_study": "Public Health", "previously_employed": "No", "relocate": "No", "notice_period": "2 weeks",
                "cover_letter_body": "I am applying for this role because my experience matches it."},
}


def jobs_for(ats: str, board: str, n: int) -> list[dict]:
    if ats == "greenhouse":
        d = httpx.get(f"https://boards-api.greenhouse.io/v1/boards/{board}/jobs", timeout=30).json()
        return [{"apply_url": f"https://boards.greenhouse.io/embed/job_app?for={board}&token={j['id']}", "title": j["title"]}
                for j in d.get("jobs", [])[:n]]
    if ats == "lever":
        d = httpx.get(f"https://api.lever.co/v0/postings/{board}?mode=json", timeout=30).json()
        return [{"apply_url": j.get("applyUrl") or j["hostedUrl"] + "/apply", "title": j["text"]} for j in d[:n]]
    if ats == "ashby":
        d = httpx.get(f"https://api.ashbyhq.com/posting-api/job-board/{board}", timeout=30).json()
        return [{"apply_url": j.get("applyUrl") or j["jobUrl"] + "/application", "title": j["title"]} for j in d.get("jobs", [])[:n]]
    return []


def main() -> int:
    targets = sys.argv[1:] or os.environ.get("PROBE_BOARDS", "").split()
    per_board = int(os.environ.get("PROBE_PER_BOARD", "2"))
    pdf = Path(tempfile.mkdtemp()) / "Resume.pdf"
    pdf.write_bytes(b"%PDF-1.4\n% placeholder\n")
    totals = {}
    for t in targets:
        ats, board = t.split(":", 1)
        try:
            jobs = jobs_for(ats, board, per_board)
        except Exception as e:  # noqa: BLE001
            print(f"\n=== {t}: could not list jobs ({type(e).__name__})")
            continue
        for j in jobs:
            job = {**PLACEHOLDER, "apply_url": j["apply_url"], "ats": ats, "board": board}
            sheet = []
            t0 = time.time()
            outcome, detail = apply.submit(job, {"resume": pdf, "cover": pdf}, Path(tempfile.mkdtemp()), dry_run=True, sheet_out=sheet)
            totals[outcome] = totals.get(outcome, 0) + 1
            print(f"\n=== {t} | {j['title']} | {j['apply_url']}\n--> {outcome} in {time.time() - t0:.0f}s: {detail}", flush=True)
            for q, a in (sheet[0]["filled"] if sheet else []):
                print(f"    {q[:90]}  =>  {a[:60]}", flush=True)
    print("\nSUMMARY:", totals)
    return 0


if __name__ == "__main__":
    sys.exit(main())
