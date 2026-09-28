# Leave Management / HR App

A leave management and HR records app for South African workplaces. It supports both **government** processes (Z1(a) forms, two approvers, transmittal slips to HR) and **enterprise** processes (one approver, BCEA leave). An admin switches between the two in Settings.

It runs as a plain website (no server to maintain). Data, logins and permissions live in a free **Supabase** database.

## What it does

| Who | What they can do |
| --- | --- |
| **Everyone** | Dashboard: who's out today, who's out this week, who plans to be out in the next 30 days. Team calendar by month. Other people's leave shows names and dates only, never the leave type or reason. |
| **Staff** | Apply for leave (full days, or part of a day as on Section B of the Z1). See their own balances, history and the leave log of every request (who did what, when). Cancel pending leave. Download their own filled-in Z1 form. |
| **Supervisor / manager** | Recommend (supervisor), then approve (manager / HOD), using the exact Z1 wording: *Recommended / Not recommended / Rescheduled*, then *Approved with full pay / Approved without pay / Not approved*. Remarks are required when refusing. Nobody can approve their own leave. |
| **HR** | Employee records, including private details (PERSAL number, ID number, address, salary level) that only HR and the employee can see. Set leave allowances and carried-over days per person. Leave register with filters and CSV export. Put approved forms on a **transmittal slip** and download the slip plus all forms (.zip). Mark forms captured / checked. Upload the department's own Word templates. Manage public holidays. |
| **Admin** | Everything HR can do, plus changing roles, the government / enterprise switch, organisation details and leave types. |

**Appearance (admin only, Settings → Appearance):** choose a colour palette or your organisation's own colour (adjusted automatically so text stays readable in light and dark mode). Show an illustrated empty desk and chair, or your own photo, on *Who's out today*. Add a faint background photo behind the whole app, and replace any page's illustration with a photo. Photos are shrunk in the browser before upload. Free photos for business use: [unsplash.com](https://unsplash.com), [pexels.com](https://pexels.com).

*Existing installs:* run each file in [`supabase/updates/`](supabase/updates/) once, in order, in the SQL Editor (001 adds the appearance settings and picture storage; 002 lets approvers print the complete Z1 by storing the applicant's PERSAL number on each application).

Leave days are counted as working days: weekends and South African public holidays are skipped (maternity and surrogacy leave count calendar days). Balances follow the leave cycle: calendar year for annual leave, a 3-year cycle for sick leave. Annual leave in government mode rises from 22 to 30 days after 10 years of service.

### Forms: auto-filled from your own templates

Different departments use different form designs, so the app fills **any Word (.docx) template** you upload. Type tags such as `{surname}`, `{persal_number}` or `{annual_start}` where each value should go. The full list is in the app under **Form templates → Tags you can use**.

Two starter templates are included, with no logos:

- `templates/z1a-leave-form.docx`: **your own** Z1(a) *Application for leave of absence*, with its layout unchanged. The tags sit in its existing cells and blank lines, so it stays on one page. The PERSAL number fills its 8 boxes one digit each, X marks go in the recommendation and approval boxes, and the signature lines stay blank for wet signatures.
- `templates/transmittal-slip.docx`: made from the transmittal slip you supplied, with the logos removed. One table row repeats for every application on the slip, so a single slip lists everyone.

**Government mode is not paperless.** After applying, the employee downloads the filled-in Z1, signs it and passes it to the supervisor and HOD, who record their decisions in the app and sign the paper. Anyone in that chain, and HR, can download the Z1 again at any stage with the decisions filled in (the **Z1 form** buttons). HR then batches the forms on one transmittal slip. **Enterprise mode is paperless**: no forms, templates or transmittal slips, and "PERSAL number" becomes "Employee number".

Electronic approvals are written onto the form as lines such as *"Recommended electronically by J van Wyk on 28 Sep 2026"*. The signature lines are left blank, so the form can still be printed and wet-signed if your department requires it.

## Try it now (demo mode)

With `js/config.js` left empty, the app runs a demo with made-up staff. Data is stored only in your own browser.

```bash
npm start            # then open http://localhost:8080
```

Pick a person on the sign-in screen to see what each role sees. **Demo mode is not secure** (anyone can switch user), so don't put real staff data in it.

## Going live (free)

1. **Create a Supabase project** at [supabase.com](https://supabase.com) (free plan). Pick the *Cape Town* or nearest region.
2. **Create the database**: in Supabase open **SQL Editor → New query**, paste all of [`supabase/schema.sql`](supabase/schema.sql), then press **Run**.
3. **Connect the app**: in Supabase open **Project Settings → API**. Copy the *Project URL* and the *anon public* key into [`js/config.js`](js/config.js).
4. **Set the sign-in link**: in **Authentication → URL Configuration**, set the *Site URL* to your app's web address (step 5).
5. **Publish the website** (pick one):
   - **GitHub Pages**: repository **Settings → Pages → Source: GitHub Actions**, then merge to `main`. The included workflow tests and publishes the site. *Free GitHub accounts can only use Pages on **public** repositories.*
   - **Cloudflare Pages** or **Netlify**: free for private repositories. Connect the repository, leave the build command empty, and set the output directory to `/`.
6. **Sign up first**: the first account created becomes **admin**. Everyone else signs up from the same link and starts as *staff*. The admin or HR then sets each person's role, department, supervisor, manager / HOD, PERSAL number and allowances under **Employees**.

To stop strangers signing up, turn off *Allow new users to sign up* in **Authentication → Providers → Email** and invite staff yourself from **Authentication → Users → Invite user**.

## Cost

| Item | Cost |
| --- | --- |
| Claude (building and changing the app) | Covered by your Pro plan. Large changes can hit the plan's usage limits; you then wait for them to reset, with no extra charge. |
| Supabase free plan | **R0**. 500 MB database, 1 GB file storage, 50,000 monthly users. That is years of leave records for a department. |
| Website hosting | **R0** (GitHub Pages for a public repository; Cloudflare Pages or Netlify for a private one). |
| Optional later | Supabase Pro (~US$25/month) for daily backups, no pausing and more storage. A custom domain is ~R150–R200/year. |

## Things to know (challenges)

1. **Free Supabase projects pause after 7 days without any activity.** Daily use keeps it awake. A paused project is restored with one click in the dashboard, and no data is lost.
2. **Backups**: the free plan has no automatic daily backups. Use **Leave register → Export CSV** regularly, or upgrade to Pro when the app holds your only copy of the records.
3. **Legal validity of electronic approval**: many departments still require wet signatures on the Z1 and transmittal slip. The app records who approved and when (the leave log), and the printed form keeps blank signature lines. Confirm with your HR / legal office whether the electronic record is enough.
4. **POPIA (personal information)**: ID numbers, addresses and medical certificates are personal information. Access is restricted in the database itself, not just hidden on screen. Your department may still need approval before storing staff data with an outside provider. Supabase lets you choose the Cape Town region to keep data in South Africa.
5. **Leave rules differ**: the built-in numbers follow the public service determination (government) and the BCEA (enterprise). They are defaults for HR to check and adjust in **Settings → Leave types**, not legal advice. Opening balances and capped leave (pre-2000) must be entered per person by HR.
6. **Old `.doc` forms** must be re-saved as `.docx` in Word before upload. The app explains this if someone tries.
7. **It does not connect to PERSAL**. HR still captures the approved leave on PERSAL and records that here with *Mark captured / checked*. There is no PERSAL link available to outside apps.

## Project layout

```
index.html              the page
css/app.css             styles (light and dark)
js/config.js            your Supabase URL and key
js/logic.js             leave rules: working days, holidays, balances, approval routing
js/forms.js             fills Word templates
js/api/demo.js          demo data stored in the browser
js/api/supabase.js      real backend
js/pages/*.js           the screens
supabase/schema.sql     database, permissions and workflow (run once in Supabase)
templates/*.docx        starter templates
tools/build-templates.mjs  rebuilds the starter templates
tests/                  npm test
vendor/                 docxtemplater, pizzip, supabase-js (bundled so no CDN is needed)
```

Developers: `npm install && npm test` runs the rules and template tests. `node tools/build-templates.mjs path/to/transmittal.docx` rebuilds the starter templates, converting any transmittal slip into a template.
