# Admissions Insights (prototype)

A static, dependency-free dashboard for tracking admission marketing spend
(teacher visits, events, social media ads and media) against student enquiries,
applications, admissions, fee payments and enrolments.

## Run it locally

From this folder, start any static server and open the address it prints:

    python3 -m http.server 8080

Then open http://localhost:8080. Opening `index.html` directly also works, but a
local server is recommended.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page structure and the Content-Security-Policy |
| `styles.css` | White, navy and gold theme |
| `app.js` | Data handling, saving, backup, attribution, charts and tables (no external code) |
| `campaigns_template.csv` | Column layout for the spend sheet |
| `students_template.csv` | Column layout for the student sheet |
| `logos/` | Header and sidebar logos |
| `_archive/` | Earlier versions kept for reference; not used by the app |

## Data

There are three ways to add records:

- **Enter records** (sidebar): type in a single activity (visit, event, ad or media)
  or a student enquiry. Use this for the current season as it happens.
- **Import & backup**: load CSV files exported from Excel or Google Sheets.
  Importing a sheet replaces the records of that sheet.
- **Restore from backup**: load a `.json` backup file made by this dashboard.

Records are kept in this browser (IndexedDB) and survive a reload. Browser storage
can be cleared by the browser or by IT policy, so **download a backup** after
each import and keep the file on the college drive. Files are read in the browser
and are never uploaded.

**Campaign sheet** (`channel` is one of: Teacher visit, Event, Social media ad,
Media (reels/YouTube)):

    channel, subtype, date, school, city, district, state, cost_inr, faculty

**Student sheet**:

    student_id, city, district, state, school, course, enquiry_date, status

- `date` and `enquiry_date` use YYYY-MM-DD.
- `cost_inr` is the cost in rupees for that visit, event or ad.
- `faculty` is the coordinator who made a visit or ran an event.
- Personal columns (name, phone, email, mobile, address) are detected and ignored.
- Limits: 2 MB and 20,000 rows per file.

The page starts with **synthetic demo data** (fictional schools and random
numbers). No real student records are included.

## Seasons

A season runs June to May. A date in June 2026 to May 2027 belongs to season
2026–27. The season filter and **Season comparison** page use these labels, and
any number of seasons can be compared.

## Attribution

1. **School contact:** the student's school or college had a visit or event
   before the enquiry date, in the same season. Faculty credit goes to the most
   recent visit or event before the enquiry.
2. **Area only:** no school contact, but an ad or media piece ran in the
   student's city before the enquiry. Indicative only.
3. **Unattributed:** neither of the above.

No attribution window is applied. The dashboard shows the lag in days so a
window can be chosen from real data later.

School names are matched after normalising case, punctuation, "St"/"Saint" and
words such as "HS", "High School" and "College". The **Data & import** page lists
school names that may need manual confirmation.

## Security posture

- **Content-Security-Policy** allows scripts and styles only from the same
  origin and blocks all network requests (`connect-src 'none'`).
- **No third-party scripts, fonts or CDNs.**
- **No `innerHTML` with user data.** All text is inserted with `textContent`.
- **Upload limits** and personal-column detection, as above.

### Before using real student data

The prototype runs entirely in the browser. For production:

1. Host behind Google Workspace sign-in restricted to the college domain, with
   MFA enforced at the account level.
2. Store data server-side in an encrypted database with row-level access:
   admins see everything, coordinators see only their own visits and events.
3. Replace uploads with a validated server-side import and keep an audit log of
   logins, imports and exports.
4. Set HSTS, X-Content-Type-Options and frame protection at the host, and set up
   backups.
5. Review handling of student personal data against India's Digital Personal
   Data Protection Act, 2023 before go-live.

## Known limitations

- Attribution is inferred from school name and city. It shows association, not
  cause.
- School-name matching is rule-based; very different spellings need manual
  confirmation.
- Ads and media are matched by city only, so their cost-per-admission figures are
  indicative.
