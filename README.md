# My Job Automation

A free job-application system that lives in a Google Sheet. It is built for a remote worker living in Nigeria:
**every job it lists must hire someone who lives and works from Nigeria.**

- **The Google Sheet** (`sheet-app/`) is the interface. It:
  - searches remote job boards (Remotive, Himalayas, Jobicy, Remote OK, We Work Remotely, Working Nomads, Arbeitnow) and the
    Greenhouse, Lever and Ashby job boards of about 360 companies: remote-first companies that hire worldwide, and
    companies based in the US, UK, Canada, Germany, Spain, Australia and Nigeria;
  - keeps only remote jobs open to Nigeria (worldwide, Africa, Nigeria). It drops US/UK/EU-only, "authorized to work in
    the US", W-2, on-site and hybrid jobs. When a posting is unclear, Gemini reads it and must quote the words that
    show it is open to Nigeria;
  - scores each job against your target roles and CV, best fit first;
  - writes a tailored resume and cover letter from your **Source of Truth** with the Gemini API (free tier), using its
    rules (no invented facts, no em dashes, ATS format, `Ojo_Oluwashola_[Company]_[Role]` file names);
  - fact-checks every claim against the Source of Truth and corrects the draft automatically;
  - applies by itself to the best matches each day (full auto mode);
  - lists every job it **cannot** apply to, with the reason, in the **Cannot apply** tab and in an evening email;
  - reads your Gmail and records each employer's reply: received, assessment, interview, offer, **hired**.
- **The applier** (`applier/`, GitHub Actions) fills and submits application forms on Greenhouse, Lever, Ashby,
  Workable, BambooHR, JazzHR, Breezy and Recruitee, using your approved PDFs and your saved answers. It stops (and tells
  you why) on a CAPTCHA, a login, or a question only you can answer.

Setup (about 30 minutes): **[docs/SETUP.md](docs/SETUP.md)**

| Path | What |
|---|---|
| `sheet-app/Code.gs` | The script to paste into the Sheet (built from `Logic.gs` + `Main.gs` by `build.sh`) |
| `sheet-app/appsscript.json` | Script settings (permissions, Africa/Lagos time zone, web app) |
| `applier/apply.py` | Submits the applications |
| `.github/workflows/apply.yml` | Runs the applier (started by the Sheet; every 3 hours as a backup) |
| `.github/workflows/tests.yml` | Runs all tests on every push |

Tests: `for t in sheet-app/test/*.test.js; do node $t; done` and `cd applier/tests && python -m pytest`.

Your personal details (CV, Source of Truth, phone, answers) live only in your Sheet, never in this repository.

Based on [JJ-Board](https://github.com/femiprofessionals-code/JJ-Board), adapted for Nigeria-eligible remote work.
