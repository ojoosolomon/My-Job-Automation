# Setup (free, about 30 minutes)

There are two pieces:

1. **Your Google Sheet**, in **ojo.osolomon@gmail.com**. It finds jobs, writes your documents, applies by email,
   and reads your Gmail.
2. **The applier**, in the GitHub repository **ojoosolomon/My-Job-Automation**. It fills and submits application forms.

Do part B signed in to Google as **ojo.osolomon@gmail.com**, and parts C and D signed in to GitHub as **ojoosolomon**.

## A. Free Gemini key (2 minutes)

1. Go to <https://aistudio.google.com> → **Get API key** → **Create API key**.
2. Copy it.

## B. Your Sheet (15 minutes)

1. Go to <https://sheets.google.com> → **Blank spreadsheet** → name it `My Job Board`.
2. Click **Extensions → Apps Script**. In the editor:
   1. Delete everything in `Code.gs`.
   2. Paste the whole of [`sheet-app/Code.gs`](../sheet-app/Code.gs). On GitHub, open the file and use the **Copy raw
      file** button.
   3. Click the **gear (Project Settings)**, tick **Show "appsscript.json" manifest file**, and go back to the editor.
   4. Open `appsscript.json`, replace its contents with [`sheet-app/appsscript.json`](../sheet-app/appsscript.json),
      then click **Save**.
3. Go back to the Sheet and **reload the page**. A **Job Board** menu appears.
4. Click **Job Board → 1. Set up (run once)**.
   - Google shows "Google hasn't verified this app". Click **Advanced → Go to (your project) → Allow**.
   - Paste the Gemini key when asked.
   - This creates the tabs and a `Job Board applications` folder in your Drive, and sets the schedules: find jobs
     every 4 hours, prepare and apply every hour, check email every hour, and an evening summary at 7:30 pm (Lagos time).
5. Fill your profile:
   1. Open the **Profile** tab.
   2. Click **File → Import → Upload** and choose `Ojo_Oluwashola_profile_for_sheet.csv` (the file Claude sent you).
   3. Choose **Replace current sheet** → **Import data**.
   4. Check these rows and change any that are wrong:
      - `zip`: it says `900001` (Abuja). Put your own area's postal code.
      - `portfolio`: add a portfolio or GitHub link if you have one.
      - `desired_salary`, `hourly_rate` and `salary_ngn`: what forms receive when they ask about pay.
6. Turn on the applier connection:
   1. In Apps Script, click **Deploy → New deployment**.
   2. Click the gear → **Web app**.
   3. Set **Execute as: Me** and **Who has access: Anyone**.
   4. Click **Deploy** and copy the **Web app URL**.
   5. In the Sheet, click **Job Board → Show applier connection details** and copy the **APPLIER_SECRET**.

   The web app only answers requests that carry this secret.

## C. The applier on GitHub (10 minutes)

In <https://github.com/ojoosolomon/My-Job-Automation>:

1. **Settings → General → Danger zone → Change visibility → Private** (recommended: the run logs stay private).
2. **Settings → Secrets and variables → Actions → New repository secret.** Add two:
   - `SHEET_WEBAPP_URL`: the Web app URL from B6.
   - `APPLIER_SECRET`: the secret from B6.
3. Open the **Actions** tab. If GitHub asks, click **I understand my workflows, go ahead and enable them**.
4. Click **Job Board applier → Run workflow** to test it. With nothing queued yet it says
   "0 approved application(s) waiting".

**Cost:** free. Private repositories get 2,000 free GitHub Actions minutes a month. A run with nothing to do takes
about 20 seconds; each application takes 2 to 3 minutes.

## D. Instant applying (5 minutes, recommended)

GitHub's own schedule is often hours late. With this, the Sheet starts the applier the moment a job is ready:

1. On GitHub, click your profile picture → **Settings → Developer settings → Personal access tokens →
   Fine-grained tokens → Generate new token**.
2. Fill in the token form:
   - Name: `Job Board`.
   - Expiration: 1 year.
   - Resource owner: **ojoosolomon**.
   - Repository access: **Only select repositories → My-Job-Automation**.
3. Under **Permissions → Repository permissions → Actions**, choose **Read and write**.
4. Click **Generate token** and copy it.
5. In the Sheet, click **Job Board → Connect GitHub for instant applying**, paste the token, and click OK. It should
   say "Connected".

## E. First run

1. **Job Board → Find jobs now.** The **Jobs** tab fills with jobs open to Nigeria, best fit first. The
   **Why eligible** column says why each one qualifies. The **Log** tab says how many jobs were left out as not open to
   Nigeria, and why.
2. **Job Board → Prepare today's best matches now.** Within minutes the **Applications** tab shows the prepared resume,
   cover letter and fact check, and applying starts by itself.
3. **Job Board → Check auto-apply status** says whether everything is connected.

From then on everything runs by itself.

## How it works day to day

**Full auto mode (on from the start).** Every hour the Sheet prepares the best new matches. It applies without asking
when all of these hold:

- the fact check is **PASS**;
- the job is on a site the applier can fill, or takes applications by email;
- you have not applied to that employer in the last 30 days;
- the day's limit is not reached.

The default limit is **8 a day**, best fit first. Change it with **Job Board → Set daily application limit**. On
the free Gemini key, 8 to 10 a day is the safe maximum: each application uses 2 to 4 Gemini requests.

**Who it applies to.** Remote jobs only, and only when the job is open to someone living in Nigeria:

- **Kept:** location says worldwide, anywhere, Africa or Nigeria, or the posting says it hires from anywhere or in
  Africa.
- **Checked first:** just "Remote", "EMEA" or a time zone. Gemini reads the posting and must quote the words that show
  it hires in Nigeria. Otherwise the job is marked **SKIPPED** with the reason.
- **Never kept:** US/UK/EU/other-country-only jobs, "must live in…", "authorized to work in the US/UK…", W-2,
  security clearance or citizenship requirements, on-site and hybrid jobs.

You can work any hours, so a time zone requirement on its own is never a reason to skip a job.

**Only fresh jobs.** Only jobs **posted in the last 24 hours** are listed and applied to. Jobs with no posting date are
left out too. Older jobs still waiting in the Jobs tab are removed at the next search. A job that goes past 24 hours
before its turn is marked **SKIPPED — posted more than 24 hours ago**. To change the limit (for example 72 for three
days), use **Job Board → Set maximum job age (hours)**.

**Statuses in the Applications tab:**

| Status | Meaning |
|---|---|
| SUBMITTED | Sent (by the applier, by email, or by you) |
| APPROVED — WILL SUBMIT / WILL EMAIL | Being sent now |
| NEEDS YOU | The form had a CAPTCHA, a login or a question only you can answer. **Result** says which |
| APPLY YOURSELF | The site needs an account (Workday, iCIMS, LinkedIn…) or is the employer's own site. The documents are ready |
| NEEDS YOUR CHECK | The fact check found a claim it could not correct. Set Decision to APPROVE after checking, or REJECT |
| UNCERTAIN | Submit was clicked but no confirmation appeared. Check your email |

The **Cannot apply** tab lists every application it could not send, with the reason, links to the job and your
documents. The 7:30 pm email lists the same jobs with a ready answer sheet for each form. Each takes about 3 minutes:
open the application page, upload the PDFs, copy the answers, then set **Decision → APPLIED MYSELF**.

**Employer replies.** Every hour the Sheet reads your Gmail. When an employer writes, the **Response** column becomes
**RECEIVED**, **ASSESSMENT**, **INTERVIEW**, **OFFER**, **HIRED** or **REJECTED**. The **History** column records each
email. The **Pipeline** tab counts them.

**Answers tab.** It has about 65 common application questions with your answers, for example US citizen: No,
nationality: Nigerian, any hours: Yes, start: Immediately, payment: direct to USD account. Some are blank because only
you can answer them: driver's licence, criminal record, backup power and internet, own laptop, typing speed, other
languages, QuickBooks/Asana/SQL. Fill these in once. Until then, a form that asks one stops and waits. When an
application stops on a new question, the question is added here. Type the answer once, and the waiting applications
are sent again by themselves.

**Updates by email.** You get a summary every evening at 7:30 pm, and an update every Tuesday and Friday at 9 am.

## Honest limits

- **Not yet run against the live job boards.** The search, eligibility rules, documents and form filling are tested here
  with copies of each board's data and replica application forms. The live job-board feeds could not be reached from
  the build environment. Watch the first runs: any source that fails is named in the **Log** tab after "Find jobs"
  and in the **Companies** tab Status column.
- **Company list is best-effort.** About 150 companies are guessed on Greenhouse, Lever and Ashby. Only boards that exist
  are added. Add your own in the **Companies** tab: ats = greenhouse, lever or ashby, board = the name in the
  company's job-board link.
- **LinkedIn is never automated** (it breaks LinkedIn's rules and can get your account banned). Add a LinkedIn job with
  **Job Board → Add a job from a link…** and the documents are prepared for you to submit.
- **CAPTCHAs** on some sites (often Lever) stop automatic submission. Those jobs come to you with the documents ready.
- **Gemini free tier privacy:** Google may use the text sent (your CV and the job posting) to improve its products.

**After every code update, redeploy the web app:** Apps Script → **Deploy → Manage deployments → pencil (Edit) →
Version: New version → Deploy**. The URL stays the same.
