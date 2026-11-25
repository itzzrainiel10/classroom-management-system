# CvSU Classroom Management System (Expo SDK 58)

React Native app for Cavite State University instructors and students.

| Part | Used for |
| --- | --- |
| React Native + Expo SDK 58 (expo-router) | The mobile app (Android, iOS) |
| Lovable Cloud (Supabase) | Login, database, quiz scoring |
| Expo SQLite | Saved copy of every screen + changes made offline |
| OMR reader | **Planned, not implemented** — see `src/lib/omr.ts` |

## Run it

```bash
npm install
npx expo start
```

Scan the QR code with **Expo Go** (SDK 58) on your phone. The `.env` file already points to the
app's cloud backend.

## Build an installable Android APK

```bash
npm install -g eas-cli
eas login
eas build -p android --profile preview
```

EAS gives you a download link for the `.apk`.

## What's inside

**Instructor:** log in / sign up, dashboard with quick access, manage classes (add students by
email), create quizzes (multiple choice, due date, time limit, passing score, draft/publish),
post assignments, announcements, class schedule, monitor results (average, highest,
submitted/pending, shareable report).

**Student:** log in / sign up, dashboard with progress, my classes (activities and
announcements), quizzes (available/completed), timed quiz, results (score, pass/fail, time taken),
assignments, announcements, weekly schedule.

**Offline:** every screen keeps its last copy on the phone. Changes made without signal
(new class, students, assignments, quiz answers, …) are queued in SQLite and uploaded in order
when the phone is back online.

## Not done yet

- OMR (reading paper answer sheets) — planned only.
- File attachments on assignments.
- Microsoft sign-in.

## Backend (your own Supabase project)

Everything the server needs lives in `supabase/`:

- `migrations/20261124000000_initial_schema.sql` — the full database (tables, rules, quiz scoring).
- `config.toml` — login settings: Google sign-in and the app's return links.
- `.env` — your Google client ID and secret (private, not committed).
- `tests/quiz_rules.sql` — a dry-run check of the quiz rules.

### One-time setup

1. **Supabase project:** create a free one at https://supabase.com. Copy its *Project URL* and
   *anon public key* (Project Settings → API) into the app's `.env`:
   `EXPO_PUBLIC_SUPABASE_URL=…` and `EXPO_PUBLIC_SUPABASE_ANON_KEY=…`.
2. **Google client:** at https://console.cloud.google.com → APIs & Services:
   - *OAuth consent screen*: External, app name, your email.
   - *Credentials → Create credentials → OAuth client ID → Web application*, with authorized
     redirect URI `https://<project-ref>.supabase.co/auth/v1/callback`.
   - Put the client ID and secret in `supabase/.env`.
3. **Push it** (from the project folder):

   ```bash
   npx supabase login
   npx supabase link --project-ref <project-ref>
   npx supabase db push
   npx supabase config push
   ```

A new Google account gets the role of the screen it was used on (Student or Instructor).

## Websites: `admin-web/` and `instructor-web/`

Two separate websites (React + Vite), each with its own login, layout, routes and styling. Both use the
**same Supabase project** (database, login and security rules) as the mobile app, so all three always show
the same accounts, schedules, classes, quizzes and results.

```text
classroom-management-system/
├── admin-web/          Admin website      → http://localhost:5173   (administrators only)
│   └── src/  components/ layouts/ pages/ services/ hooks/
├── instructor-web/     Instructor website → http://localhost:5174   (approved instructors only)
│   └── src/  components/ layouts/ pages/ services/ hooks/
├── src/ app.json …     Mobile app (Expo)  → npx expo start
├── supabase/           Backend: migrations (tables, row-level security, server functions), tests, config
└── scripts/dev.mjs     Starts several dev servers at once
```

Run them separately:

```bash
cd admin-web && npm install && npm run dev          # http://localhost:5173
cd instructor-web && npm install && npm run dev     # http://localhost:5174
```

…or together from the project root:

```bash
npm run install:websites   # first time only
npm run dev:websites       # both websites
npm run dev:all            # both websites + the Expo app
```

Both can be open at the same time in one browser. They run on different ports (separate browser origins)
and keep their sessions under different keys, so an instructor signing in never signs out the admin.
There is no separate API server: the backend is the Supabase project, which checks the role on every
request (row-level security and admin-only functions). The page guards in the websites are only a convenience.

**Instructor website pages:** Dashboard, My Profile, My Subjects, My Sections, My Teaching Schedule,
Weekly Schedule, Quizzes & Exams, Assignments, Announcements, Monitor Results, Notifications, Account Settings.
Instructors can also register there; the application starts as **Pending** until an admin approves it.

### Admin website (`admin-web/`)

| Page | What it does |
| --- | --- |
| Overview | Users, classes, pending approvals, today's sign-ins, this week's activity |
| Users & roles | Search everyone, invite users, edit name / student number / role, suspend accounts |
| Classes & sections | Create classes, assign instructors, rename sections, set rooms, enroll or remove students |
| Activity log | Every sign-in, enrollment, post, publish and grade — filter and export to CSV |
| Reports | Average scores, completion, per-class and per-section performance — export to CSV |

**How it connects to the mobile app**

- Quizzes and exams an instructor **publishes** appear to enrolled students right away (no admin approval).
- **Invitations**: an invited email gets its role (and class) automatically when it signs up in the app.
- **Suspended** accounts are signed out of the app and lose access to class data.
- Admin-only accounts can't use the mobile app; they're told to use the portal.

**Making someone an admin** (never possible from the app itself) — run in the Supabase SQL editor:

```sql
insert into public.user_roles (user_id, role)
select id, 'admin' from auth.users where email = 'name@cvsu.edu.ph';
```

Not built yet: attendance tracking (the prototype's attendance numbers are replaced by quiz scores,
completion and sign-ins until attendance exists in the app).

## Instructor verification & official schedules

**Instructor sign-up is an application.** Choosing *Instructor* in the app asks for employee / faculty ID,
department and contact number; after logging in the applicant can attach proof (PDF or photo). The account
has **no instructor access** until an admin approves it in **Instructor Verification** (web). Rejections
need a reason, which the applicant sees in the app; they can correct and resend. Every decision is stored
with the admin and date (`instructor_verifications`).

**Official schedules** are managed only by admins (web → Subject / Section / Schedule Management, rooms
and current term in Settings). The database rejects, with a readable message:
overlapping classes for the same instructor, room or section (same term and day), end time before start
time, and instructors who aren't approved. Instructors see their own classes and students see their
section's classes in the app's **Schedule** tab (read-only), and both get in-app **notifications**
(bell icon) when something is assigned, changed or cancelled.

| Table | Purpose |
| --- | --- |
| `instructor_profiles` | Application + verification status (pending / approved / rejected) |
| `instructor_verifications` | History of approve / reject decisions |
| `subjects`, `sections`, `rooms` | Admin-managed reference data (sections have a year level) |
| `instructor_schedules` | Official timetable (instructor, subject, section, room, day, time, semester, AY) |
| `app_settings` | Current semester, academic year and its first / last day of classes (schedules repeat weekly between them) |
| `notifications` | In-app messages per user |
| `profiles.section_id` | The student's section (set by an admin) |

Server functions (Supabase RPC): `submit_instructor_application`, `review_instructor`, `admin_set_role`,
`claim_role`, `my_schedule`, `is_approved_instructor`. Proof documents are in the private
`instructor-proofs` storage bucket (owner + admins only).

## Quizzes & exams: question types

Each assessment is a **Quiz** or an **Exam**, and every question has its own type and points:

| Type | Student answers | Scoring |
| --- | --- | --- |
| Multiple choice | picks one of up to 4 choices | automatic |
| True or False | True / False | automatic |
| Modified True or False | True, or False + the word that makes it true | automatic (False needs the right word) |
| Identification | types the answer | automatic; several accepted answers (`JavaScript / JS`), case and spaces ignored |
| Enumeration | fills one blank per expected item | automatic, 1 point per correct item, any order |
| Essay | writes an answer | the instructor grades it (Monitor results → student → Grade answers) |

Scoring runs on the server (`submit_quiz_v2`); students never receive the answer key. Essay points and
feedback are saved with `grade_attempt`, which recomputes the total and notifies the student.
