# Library Module: 13 Build Prompts

Source of truth: `docs/LIBRARY_MODULE_BLUEPRINT.md` (v2, with verified facts and locked decisions).
Branch: `library-r` (created from `demo2`). The agent commits locally and never pushes. You push `library-r` yourself.

## How to run these

1. Open a fresh Claude Code session in `eSkoolia-version1/` for each prompt. Paste one prompt, nothing else.
2. Effort: medium is enough for every prompt. Use high for prompts 1, 5 and 13 if you can, because they carry the permission fixes, the stock and money rules, and the final audit.
3. After each response: read the report, open the screens in your browser, apply the migrations it lists, then start the next prompt.
4. Every prompt reads and updates `docs/LIBRARY_PROGRESS.md`, so a new session knows exactly where the last one stopped.
5. If a response says something is blocked, fix that first. Do not start the next prompt on a red branch.

Common to every prompt: the rules in blueprint section 0.2 apply. The one-line version is at the top of each prompt.

---

## Prompt 1 — Foundations

```text
PROMPT 1 OF 13: FOUNDATIONS
Rules: docs/LIBRARY_MODULE_BLUEPRINT.md section 0.2 applies. Work on branch library-r. Stage explicit paths only. Never push. Never run migrate against the app database. Finish everything in this one response and do not ask me questions.

READ FIRST: blueprint sections 0, 0.1, 0.2, 0b, 2.1, 2.2 (table 1 and the audit columns), 2.3, 3.1, 3.2, 3.6, 3.7, 4.3, 4.4. Open the existing app: backend/apps/library/*, backend/apps/core/viewsets.py, backend/apps/core/exceptions.py, backend/apps/core/base_serializers.py, backend/apps/access_control/management/commands/seed_permissions.py and seed_module_tiers.py, frontend/components/library/LibraryPanels.tsx, frontend/lib/routes.ts, frontend/hooks/useHrApi.ts.

CHECK FIRST:
- git branch --show-current prints library-r. Record git status --short as the baseline. Other people's changes in that list are not yours.
- Run python --version and the Django version. Read backend/config/settings/test.py and state which database the tests will use.
- Run the smallest existing backend test file you can find to prove the runner works. Record the result. Do not fix unrelated failures.

BUILD:
1. Create docs/LIBRARY_PROGRESS.md with sections: Environment baseline, Prompt log (1 to 13 with status), Decisions made, Migrations to apply, Known gaps, Deviations from blueprint.
2. Convert apps/library to packages: models/, serializers/, views/ (see blueprint 3.1 layout). Move the four existing models and viewsets without changing their tables. Keep apps/library/urls.py registering the same four routes: categories, books, members, issues.
3. views/base.py: LibraryViewSet as described in blueprint 3.1 (PaginatedModelViewSet plus per-action permission codes). Delete the old SchoolScopedModelViewSet and its is_superuser early return. Inspect how the standard envelope changes response shapes. Keep the four existing pages working: if the envelope breaks something LibraryPanels.tsx relies on, adjust LibraryPanels.tsx minimally. It is deleted in prompt 13.
4. Permission codes: add every code in blueprint 3.6 to seed_permissions.py, keeping the four existing .view codes. Apply the explicit library tier map from blueprint 3.7 inside seed_module_tiers.py for module "library" only. Do not change how other modules are classified.
5. Existing four ViewSets: list and retrieve keep the existing .view codes. create, update and destroy use the new .create, .update, .delete codes. For loans keep the legacy POST and the return and overdue actions working for now, guarded by library.book_issues.issue, .return and .view. Mark them LEGACY in a comment. Prompt 5 replaces them.
6. apps/library/exceptions.py: every library error code from blueprint 2.3, as subclasses of the core exceptions. Inspect apps/core/exceptions.py first to see how a subclass sets its code and status.
7. Models and migration: add nullable created_by and updated_by to the four existing tables. Add LibrarySettings (every field in blueprint 2.2 table 1) and LibraryActivityLog (blueprint 2.2 table 18). services/settings.py: get_settings(school) creates the row lazily, filling junior_class_ids from the school's class names Nursery, LKG, UKG, Grade 1 to Grade 4. services/activity.py: log_event(school, actor, event_type, summary, **refs).
8. Endpoints: GET and PUT settings/ with library.settings.view and library.settings.manage. The counters are read-only.
9. Management command library_role_report (read-only): list roles that hold any library .view code and say that they previously could also write, so the user can review (decision D12).
10. TENANT_FEATURE_GATES: if that setting exists, add the three v1 patterns from blueprint fact 8. If it does not exist, skip and say so in the report.
11. Frontend: un-comment the Library module in lib/routes.ts with permission 'library' and sub items pointing to the four existing pages. Add types/library.ts and hooks/useLibraryApi.ts with a LibraryApiError class modelled on HrApiError and functions for settings. Build no new screens.

FILES: backend/apps/library/** , backend/apps/access_control/management/commands/seed_permissions.py, seed_module_tiers.py, frontend/lib/routes.ts, frontend/types/library.ts, frontend/hooks/useLibraryApi.ts, frontend/components/library/LibraryPanels.tsx (only if needed), docs/LIBRARY_PROGRESS.md. Also stage these planning documents, which are untracked: docs/LIBRARY_MODULE_BLUEPRINT.md, docs/LIBRARY_BUILD_PROMPTS.md, docs/LIBRARY_PIPELINE_FLOW.* and docs/LIBRARY_PORTAL_FLOW.*.

TESTS (apps/library/tests/, with fixtures: school, second school, admin, librarian-style user with codes, user with view only): cross-school 404 for each existing resource, 401 without a token, view-only user gets 403 on create, update and delete while a user holding the matching code succeeds, settings defaults and update, activity log write, tier map (every library code in exactly one tier, each tier contains the one below it).

DONE WHEN: python -m pytest apps/library passes; python manage.py makemigrations --check is clean; npx tsc --noEmit and npm run lint pass in frontend; the four existing pages still read their data; docs/LIBRARY_PROGRESS.md exists.
Priority if space is tight: permissions and tests first, then settings and activity log, then frontend skeleton.

FINISH: update docs/LIBRARY_PROGRESS.md. Stage the exact paths you changed. Commit with message "library: foundations (base viewset, permissions, settings, activity log)". Do not push. End with the report from rule 12.
```

---

## Prompt 2 — Catalogue backend

```text
PROMPT 2 OF 13: CATALOGUE BACKEND
Rules: docs/LIBRARY_MODULE_BLUEPRINT.md section 0.2 applies. Work on branch library-r. Stage explicit paths only. Never push. Never run migrate against the app database. Finish everything in this one response and do not ask me questions.

READ FIRST: docs/LIBRARY_PROGRESS.md, then blueprint sections 0b (D5, D12), 1.1 rows 2 to 6, 1.4 rules R1, R12, R13, 2.2 tables 2, 3 and 4, 2.4 (Categories and Catalogue, except bulk import), 3.1, 3.3 (Book and Add copies rows), 4.5, 4.7 (books and copies rows), 5.

CHECK FIRST: branch is library-r. The progress file shows prompt 1 done. python -m pytest apps/library passes.

BUILD:
1. Models and migration: BookCategory gains code, color_key, next_sequence. Book gains every new field in blueprint 2.2 table 3 EXCEPT purchase_order and donation (prompt 8 adds those). New BookCopy. Constraints and indexes exactly as listed. Stop writing quantity and available_quantity everywhere; keep the columns.
2. Data backfill as a RunPython migration that calls services/backfill.py (blueprint section 5 steps 3 and 4, books, copies and category part only; loan binding comes in prompt 5). Create the Uncategorised category with code UNC where needed. Add a read-only management command library_reconcile that prints books whose old available_quantity differs from the derived copy state. The migration itself writes no files.
3. services/numbering.py: category sequence taken under select_for_update, category code derivation unique per school. services/accession.py: create_book_with_copies (one transaction), add_copies, withdraw_copy (only when status is available).
4. Serializers and viewsets under views/catalogue.py: categories CRUD (delete refused with library_has_history), books list, create, retrieve, patch, delete (refused with history), add-copies, lookup, books/{id}/copies, copies list, retrieve, by-code, patch (condition only), withdraw. Filters and ordering per blueprint 2.4. List rows use annotated counts (blueprint 4.7), never per-row queries. Availability status is derived (R11). Cross-school and active-category validation per 3.3. Permission codes per 3.6. Write an activity log row for accession, add copies, and withdraw.
5. Frontend data layer only: extend types/library.ts and hooks/useLibraryApi.ts with functions for categories, books, copies, lookup. No screens. The legacy Books page may stop creating books until prompt 3. Do not spend effort on it, and say so in the report.

FILES: backend/apps/library/** and the frontend type and hook files.

TESTS: accession creates the right codes (LIB-<CAT>-<NNNN>/C<n>); code uniqueness; audience needs at least one flag; inactive category refused; add-copies appends; withdraw only when available; delete refused with history; availability filter (available, low at 0.34, issued); cross-school FK for category; permission matrix; assertNumQueries bound on the books list with 30 rows; backfill test with legacy fixtures (null category, an open loan, a lost loan, mismatched counters) plus library_reconcile output; concurrent accession in one category (Postgres-only marker).

DONE WHEN: python -m pytest apps/library passes; makemigrations --check is clean; tsc and lint pass.
Priority if space is tight: models, services, endpoints and tests first; frontend data layer last.

FINISH: update docs/LIBRARY_PROGRESS.md (list the migrations to apply and the reconcile command). Stage exact paths. Commit "library: catalogue backend (categories, books, copies, accession, backfill)". Do not push. End with the report.
```

---

## Prompt 3 — Catalogue frontend and bulk tools

```text
PROMPT 3 OF 13: CATALOGUE FRONTEND AND BULK TOOLS
Rules: docs/LIBRARY_MODULE_BLUEPRINT.md section 0.2 applies. Work on branch library-r. Stage explicit paths only. Never push. Never run migrate against the app database. Finish everything in this one response and do not ask me questions.

READ FIRST: docs/LIBRARY_PROGRESS.md, then blueprint sections 1.1 rows 2 to 6, 1.6, 2.4 (bulk import rows and copies), 3.5, 4.8 (CSV injection, bulk abuse), 8.1, 8.3 to 8.6. Study frontend/styles/tokens.css, frontend/hooks/usePermissions.ts, frontend/hooks/usePersistentPagination.ts, frontend/hooks/useDocumentBranding.ts and one existing list page of another module for styling.

CHECK FIRST: branch is library-r. Prompts 1 and 2 are done in the progress file. Backend library tests pass.

BUILD backend:
1. POST books/bulk-import/preview/ and books/bulk-import/commit/ exactly as blueprint 2.4: rows of title, author, category, copies, cost; 500-row cap; per-row errors "Missing title" and "Unrecognised category"; copies default 1 and cost default 0; neutralise leading =, +, -, @ and tab; commit revalidates on the server and is idempotent per client_batch_id (store the batch id in the activity log metadata); one activity log row per batch.
2. GET books/{id}/labels/ returning copy codes and the title line for printing.
BUILD frontend:
3. Routes: /library/catalogue as the main page. Redirect /library/books and /library/categories to it. Update the sub items in lib/routes.ts.
4. components/library/catalogue/: table with filters (search, category, age band, reader, condition, status), derived status pills, loading, empty ("No titles match this filter"), error and no-access states, server pagination; 5-step accession wizard with the required-field rules from blueprint 1.1 row 3 and server field_errors; Manage categories modal (colour dot, prefix code, title count, active toggle, add); Bulk import modal with preview and "Add N books"; Copies register modal with status and condition; Label print view using useDocumentBranding; a static scanner-setup panel (keyboard wedge recommended, camera optional).
5. Colours: add the ten category colour tokens and any missing status tokens to styles/tokens.css. Map color_key to a CSS variable. No raw hex anywhere else.
6. Gate every button with can('library.<resource>.<action>'). Background lookups use silent401.

FILES: backend/apps/library/** (bulk import and labels), frontend/app/(dashboard)/library/catalogue/**, frontend/components/library/catalogue/**, frontend/lib/routes.ts, frontend/styles/tokens.css, frontend/types/library.ts, frontend/hooks/useLibraryApi.ts, plus redirect pages for the two old routes.

TESTS: backend bulk import tests (valid, missing title, bad category, cap, formula characters, repeated batch id creates nothing). One Jest test for the wizard's step validation helper. 

DONE WHEN: backend library tests pass; tsc and lint pass; I can create a title through the wizard, import rows, view copies and print labels in the browser.
Priority if space is tight: backend and the main table and wizard first; labels and the scanner panel last.

FINISH: update docs/LIBRARY_PROGRESS.md. Stage exact paths. Commit "library: catalogue screens, bulk import, copies register, labels". Do not push. End with the report.
```

---

## Prompt 4 — Members, charges and settings

```text
PROMPT 4 OF 13: MEMBERS, CHARGES AND SETTINGS
Rules: docs/LIBRARY_MODULE_BLUEPRINT.md section 0.2 applies. Work on branch library-r. Stage explicit paths only. Never push. Never run migrate against the app database. Finish everything in this one response and do not ask me questions.

READ FIRST: docs/LIBRARY_PROGRESS.md, then blueprint sections 0b (D1 to D6, D11), 1.1 row 11, 1.4 rule R3 and R10, 2.2 tables 5 and 8, 2.4 (Members and Charges), 3.3, 4.7 (members and charges rows), 8.3.

CHECK FIRST: branch is library-r. Prompts 1 to 3 are done. Tests pass.

BUILD backend:
1. Extend LibraryMember per blueprint 2.2 table 5: teacher member type, registration_fee_amount, partial unique constraints per student and per staff, the type-matches-person check constraint. Migration plus data step: existing members get registration_fee_amount 0.
2. New Charge model (table 8). In this prompt it has the issue link but not the report link; prompt 5 adds that.
3. services/dues.py: pure functions for accrued fine (grace, daily rate, cap at the copy's replacement cost per D1 and D5), dues summary, suspension (overdue accrued fines or unpaid replacement fees, but NOT an unpaid registration fee), borrowing limit by member type. services/members.py: infer member_type per D11, default registration fee per D6 from the junior_class_ids setting.
4. Endpoints: members list (filters and annotated active_loans, total_dues, standing, registration status with no per-row queries), create (also creates the registration charge, paid now, pending, or waived at 0), retrieve, dues, patch, delete refusal with history, GET members/candidates/?type=&q= (students or staff not yet members, same school only, limited fields), members/eligible/ (roster with eligible flag and reason, used by prompt 5), charges list, collect and waive. Log activity.
BUILD frontend:
5. /library/members page: role chips, table (member, class, card, active loans versus limit, registration fee pill, total dues, standing pill), dues drawer, Register member modal using the candidates endpoint, collect fee action.
6. /library/settings page: all settings from blueprint 2.2 table 1, the junior classes as a multi-select fed by the existing classes API (inspect which endpoint other modules use), save with field errors.
7. Add Members and Settings to the sub items in lib/routes.ts. Gate buttons with can().

FILES: backend/apps/library/**, frontend/app/(dashboard)/library/members/**, .../settings/**, frontend/components/library/members/**, .../settings/**, frontend/lib/routes.ts, types and hook files.

TESTS: fine boundaries (grace, cap on and off, zero rate); suspension rule including that unpaid registration alone does not suspend; XOR constraint; one membership per person; junior default fee; type inference; cross-school student and staff ids; permission matrix; assertNumQueries bound on members list.

DONE WHEN: library tests pass; makemigrations --check clean; tsc and lint pass; I can register a student and a teacher, collect a fee, and edit settings.
Priority if space is tight: backend and tests, then Members page, then Settings page.

FINISH: update docs/LIBRARY_PROGRESS.md. Stage exact paths. Commit "library: members, charges, dues, settings". Do not push. End with the report.
```

---

## Prompt 5 — Circulation backend

```text
PROMPT 5 OF 13: CIRCULATION BACKEND
Rules: docs/LIBRARY_MODULE_BLUEPRINT.md section 0.2 applies. Work on branch library-r. Stage explicit paths only. Never push. Never run migrate against the app database. Finish everything in this one response and do not ask me questions. This is the most important prompt: correctness of stock and money matters more than speed.

READ FIRST: docs/LIBRARY_PROGRESS.md, then blueprint sections 0b (D1 to D5), 1.4 rules R1 to R10 and R16, 2.2 tables 6, 7, 8 and 9, 2.3 error codes, 2.4 (Issue Desk, Holds, Lost and damaged, charges), 3.1 service rules, 3.3, 4.5, 4.6, 4.7, 5 (loan binding), 9 (Circulation and Money rows).

CHECK FIRST: branch is library-r. Prompts 1 to 4 are done. Tests pass.

BUILD:
1. Loan model changes: copy link, renew_count, last_renewed_on, returned_at, returned_by; partial unique constraint on the open loan per copy; the check constraints. Add Hold and LostDamagedReport models and the report link on Charge. Migration plus loan backfill (bind each open loan to one copy and set that copy to issued; lost loans mark a copy lost). Extend library_reconcile to cover loans.
2. services/due_dates.py implementing D3 exactly: students get the class's next library slot at least the minimum days away, falling back to the flat period when the class has no slot (period slots arrive in prompt 9, so the lookup must return "no slot" cleanly when the table is absent or empty); teachers and staff get the flat period.
3. services/circulation.py, all inside transaction.atomic with select_for_update on the copy row and the member row: issue_copy, bulk_issue, return_loan (server computes the fine, collect or waive, optional lost or damaged report with a replacement charge per D5, releases the copy, returns hold_queue_count), renew_loan (cap, hold, overdue and R5 rules), undo_return (same user, inside undo_return_minutes, only if the copy is unchanged), place_hold, cancel_hold, create_report, mark_fee_paid, resolve_report.
4. Endpoints per blueprint 2.4: issues list, retrieve, due-today, overdue, open/lookup, issue, bulk-issue, {id}/return, {id}/undo-return, {id}/renew; holds list, create, cancel; lost-damaged list, create, patch notes, mark-fee-paid, resolve, bill. Remove the generic create, update and delete on loans and the legacy mark_returned action. The legacy Issues page stops working until prompt 6. Say so in the report. Permission codes per 3.6, waive needs library.book_issues.waive_fine plus a reason.
5. Every action writes one activity log row inside the same transaction. Notifications are NOT sent here (prompt 7). Return hold_queue_count only.
6. Frontend data layer: types and hook functions for all new endpoints. No screens.

FILES: backend/apps/library/** and the frontend type and hook files.

TESTS (full matrix from blueprint section 9): issue success; reference-only, audience, suspended and limit refusals; last-copy race (Postgres-only marker) plus a forced duplicate open loan rejected by the partial index; due-date snapping and fallback; renew cap, hold and overdue refusals; return on time, overdue with collect, overdue with waive (needs code and reason), repeated return gives 409 library_already_returned, return with damage report; undo allowed in window and refused after it or after re-issue; bulk issue eligibility and skipped reasons; holds; reports and charges transitions only forward; cross-school ids on every input; permission matrix; assertNumQueries on issues list with 30 rows; server ignores any client-sent fine or dates.

DONE WHEN: library tests pass (Postgres-only tests may be skipped, and must be listed as unverified); makemigrations --check clean; tsc and lint pass.
Priority if space is tight: services and tests first; endpoints second; frontend data layer last.

FINISH: update docs/LIBRARY_PROGRESS.md. Stage exact paths. Commit "library: circulation (issue, return, renew, undo, holds, lost and damaged)". Do not push. End with the report.
```

---

## Prompt 6 — Issue Desk and exceptions screens

```text
PROMPT 6 OF 13: ISSUE DESK AND EXCEPTIONS SCREENS
Rules: docs/LIBRARY_MODULE_BLUEPRINT.md section 0.2 applies. Work on branch library-r. Stage explicit paths only. Never push. Never run migrate against the app database. Finish everything in this one response and do not ask me questions.

READ FIRST: docs/LIBRARY_PROGRESS.md, then blueprint sections 1.1 rows 9 and 10, 1.4 rules R1 to R9, 1.6, 2.4 (Issue Desk, Holds, Lost and damaged), 8.3, 8.4, 8.5.

CHECK FIRST: branch is library-r. Prompts 1 to 5 are done. Backend library tests pass.

BUILD backend (small):
1. GET issues/desk-log/ returning today's issue, return and renewal events from the activity log (read-only, school scoped, no per-row queries). Permission library.book_issues.view.
BUILD frontend:
2. /library/issue-desk: tabs Issue, Return, Renew. One search box that stays focused; typing or a scanner's Enter resolves a code; debounced suggestions through books/lookup and issues/open/lookup with stale requests aborted and silent401. Issue tab: class picker, member picker from members/eligible with block reasons shown (suspended with the amount, at limit), a confirmation card showing the computed due date and its note, and a bulk-issue-to-class helper. Return tab: open-loan card with borrower, due date, accrued fine; "Collect and return", "Waive and return" (reason required, only when the user can waive), mark lost or damaged with a note; an undo toast driven by undo_expires_at that calls undo-return. Renew tab: shows renew count and the exact refusal reason. Right-hand "Today at the Desk" log.
3. /library/lost-damaged: table (title, borrower, type, date, notes with inline add, replacement cost, fee status, resolution), Mark fee paid, Resolve, Bill print view (use useDocumentBranding). Pending badge on the nav item.
4. Holds: a Reserve action in the catalogue row menu and a holds list in the Issue Desk when a title has no copies.
5. Overdue notice print view. Replace the old /library/issues route with a redirect to /library/issue-desk. Update the sub items in lib/routes.ts.
6. Every list has loading, empty, error and no-access states. Buttons gated with can(). No raw hex.

FILES: backend/apps/library/views/issue_desk.py and tests, frontend/app/(dashboard)/library/issue-desk/**, .../lost-damaged/**, frontend/components/library/issue-desk/**, .../lost-damaged/**, catalogue row action, lib/routes.ts, types and hook files.

TESTS: backend desk-log test (today only, school scoped). Jest tests for the helpers that build due-date notes and block reasons.

DONE WHEN: library tests pass; tsc and lint pass; in the browser I can issue, return with a fine, renew, undo a return, report damage and see the bill.
Priority if space is tight: Issue and Return tabs first, then Lost and Damaged, then Renew polish and print views.

FINISH: update docs/LIBRARY_PROGRESS.md. Stage exact paths. Commit "library: issue desk and lost and damaged screens". Do not push. End with the report.
```

---

## Prompt 7 — Console, reminders and push

```text
PROMPT 7 OF 13: CONSOLE, REMINDERS AND PUSH
Rules: docs/LIBRARY_MODULE_BLUEPRINT.md section 0.2 applies. Work on branch library-r. Stage explicit paths only. Never push. Never run migrate against the app database. Never start Celery or Redis. Finish everything in this one response and do not ask me questions.

READ FIRST: docs/LIBRARY_PROGRESS.md, then blueprint sections 0.1 facts 5 and 6, 0b (D17), 1.1 row 1, 2.4 (Console, Issue Desk remind), 4.7 (console row), 4.8 (reminder spam), 6.1 to 6.3. Open backend/apps/communication/realtime.py, backend/apps/communication/models.py (CommunicationNotification), backend/apps/chat/consumers.py, backend/apps/core/services/parent_notifications.py, frontend/hooks/usePortalNotifications.ts, backend/config/celery.py.

CHECK FIRST: branch is library-r. Prompts 1 to 6 are done. Tests pass.

BUILD backend:
1. apps/communication/realtime.py: add push_portal_event(user_id, notification) beside push_new_message, best effort with every failure swallowed.
2. services/notifications.py: the event matrix in blueprint 6.1. Resolve recipients (student to primary guardian user through Student.guardian, teacher or staff to their own user, skip with a log row when there is no user). Create a CommunicationNotification row, then push {kind: "library", event, id, title, body, link_url, created_at}. SMS and email only when notify_sms_email_enabled is true, through the existing helpers.
3. tasks.py: deliver_library_event(school_id, event, ids) started from transaction.on_commit with ids only and retry with backoff. Wire hold_ready into return_loan and replacement_fee into report creation.
4. POST issues/remind/ with issue_ids or all_overdue, capped batch, once per loan per day (409 library_reminder_already_sent for a single repeat, skipped list for batches), one log row per batch, code library.book_issues.remind.
5. GET console/summary/: tiles (titles, collection value, copies available and share, active loans, overdue, pending lost or damaged), due-today and overdue counts, holds waiting, collection mix by category, the live period card (return an empty object until prompt 9 adds period data), recent activity. Aggregate queries only, fixed small count.
BUILD frontend:
6. Extend the PortalNotification type in hooks/usePortalNotifications.ts with the library kind without breaking the message kind.
7. /library/console page: tiles, due and overdue list with "Remind all overdue", holds list, collection mix, recent activity, live period card empty state. Poll the summary every 30 seconds with silent401, pause while the tab is hidden. Add Console as the first sub item.

TESTS: recipient resolution (student to guardian, teacher to self, none skips), idempotency, push helper swallows a channel-layer failure, remind rate limit, console summary query-count bound, event rows created on return with holds and on lost report. Call task functions directly. No Celery worker.

DONE WHEN: tests pass; tsc and lint pass; no dev server was started.
Priority if space is tight: notifications and tests first, then console summary, then console page.

FINISH: update docs/LIBRARY_PROGRESS.md. Stage exact paths. Commit "library: console, reminders, notification events and push". Do not push. End with the report.
```

---

## Prompt 8 — Acquisitions and requests

```text
PROMPT 8 OF 13: ACQUISITIONS AND REQUESTS
Rules: docs/LIBRARY_MODULE_BLUEPRINT.md section 0.2 applies. Work on branch library-r. Stage explicit paths only. Never push. Never run migrate against the app database. Finish everything in this one response and do not ask me questions.

READ FIRST: docs/LIBRARY_PROGRESS.md, then blueprint sections 0b (D7, D9, D10), 1.1 row 7, 2.2 tables 10, 11, 12 and 17, the purchase_order and donation fields of table 3, 2.3 (library_invalid_state_transition), 2.4 (Acquisitions), 3.3, 4.8 (personal data), 6.1 (request_reviewed).

CHECK FIRST: branch is library-r. Prompts 1 to 7 are done. Tests pass.

BUILD backend:
1. Models and migration: PurchaseOrder, Donation, Budget, BookRequest; add purchase_order and donation links to Book. Donor contact is personal data: return it only with library.donations.view and never write it into logs or notification text.
2. services/numbering.py: PO and receipt numbers from the settings counters under row lock.
3. Endpoints per blueprint 2.4: purchase-orders CRUD with the allowed transitions (ordered to received or cancelled, payment pending to paid, no reversals, delete only when ordered and unlinked), donations (create, patch, receipt data), budgets (get, put upsert), acquisitions/summary (budget, committed, paid, remaining for an academic year), book-requests admin list and review (approved, rejected, ordered, fulfilled, forward only) which fires the request_reviewed event through services/notifications.py. Log activity.
4. The Book serializer accepts optional purchase_order and donation (same school) and the accession wizard's source step gets matching selects.
BUILD frontend:
5. /library/acquisitions: annual budget card with spent and remaining, purchase orders table plus "New PO" form, donations table plus "Log a donation" form with receipt print view, teacher requests list with a review action. Add the sub item. Gate with can(). Loading, empty, error and no-access states.

TESTS: numbering under concurrency (Postgres-only marker), every allowed and refused transition, budget maths, contact hidden without the view code, cross-school academic year, request review fires one notification, permission matrix.

DONE WHEN: tests pass; makemigrations --check clean; tsc and lint pass.
Priority if space is tight: backend and tests first, then the three tables, then print views.

FINISH: update docs/LIBRARY_PROGRESS.md. Stage exact paths. Commit "library: acquisitions, donations, budget, teacher requests queue". Do not push. End with the report.
```

---

## Prompt 9 — Periods, occupancy and stock check

```text
PROMPT 9 OF 13: PERIODS, OCCUPANCY AND STOCK CHECK
Rules: docs/LIBRARY_MODULE_BLUEPRINT.md section 0.2 applies. Work on branch library-r. Stage explicit paths only. Never push. Never run migrate against the app database. Never start Celery. Finish everything in this one response and do not ask me questions.

READ FIRST: docs/LIBRARY_PROGRESS.md, then blueprint sections 0b (D8), 1.1 rows 8 and 14, 1.4 rule R15, 2.2 tables 13 to 16, 2.4 (Periods, Stock check), 3.3, 4.7, 6.1 (unscanned_flag). Look at core.ClassPeriod, core.ClassRoom and academics.ClassTeacherAssignment.

CHECK FIRST: branch is library-r. Prompts 1 to 8 are done. Tests pass.

BUILD backend:
1. Models and migration: PeriodSlot, Visit, StockAudit, StockAuditItem with the constraints in blueprint 2.2.
2. Period endpoints: slots CRUD with conflict 409 naming the clashing slot, week grid, current slot, prep-briefing (next slot's class, books due back from that class, members blocked by dues, holds ready). Visits: check-in by card number (idempotent per slot, member and date, slot inferred from the clock and the member's class), occupancy (checked in versus scheduled computed from one grouped students query), footfall group-by.
3. Make services/due_dates.py (prompt 5) use real period slots for the student rule, and fill the Console live-period card from the current slot.
4. Stock check per blueprint 2.4: start (snapshot on-shelf copies, 409 library_audit_in_progress), list and detail with progress, items, single and bulk mark found, finish (freeze counts, value at risk, last_verified_on), cancel, mark-lost for missing items (idempotent, creates a report with source stock_audit).
5. Celery: tasks.py flag_unscanned_students scanning today's active slots past unscanned_flag_minutes, notifying the class teacher through services/notifications.py, with the activity log marker for idempotency. Add a management command library_register_periodic_tasks that idempotently creates the every-minute entry in django_celery_beat. Do not run it. Tell me to run it.
BUILD frontend:
6. /library/periods: Mon to Sat by period grid with the live marker, occupancy bar, visits-this-week bars, prep briefing, a check-in input (card number) for the librarian. Slot management form.
7. /library/stock-check: rack picker, start, grouped list with Mark found, progress bar, finish, result with missing list and Mark as lost.
8. Add both to the sub items. Gate with can().

TESTS: slot conflicts, check-in idempotency, occupancy maths, flag task sends once per slot per day, audit lifecycle, one open audit per scope, mark-lost idempotent, snapshot excludes non-available copies, due-date service now snaps to a real slot, permission matrix.

DONE WHEN: tests pass; makemigrations --check clean; tsc and lint pass.
Priority if space is tight: periods backend and stock check backend first, flag task, then the two pages.

FINISH: update docs/LIBRARY_PROGRESS.md (note the command I must run). Stage exact paths. Commit "library: periods, occupancy, unscanned flag, stock check". Do not push. End with the report.
```

---

## Prompt 10 — Oversight: logs and reports

```text
PROMPT 10 OF 13: OVERSIGHT, LOGS AND REPORTS
Rules: docs/LIBRARY_MODULE_BLUEPRINT.md section 0.2 applies. Work on branch library-r. Stage explicit paths only. Never push. Never run migrate against the app database. Finish everything in this one response and do not ask me questions.

READ FIRST: docs/LIBRARY_PROGRESS.md, then blueprint sections 0b (D9), 1.1 rows 12 and 13, 2.4 (Transactions, reports), 4.7 (activity-logs and reports rows), 4.8 (export abuse, CSV injection). Check which chart approach the repo already uses (package.json and existing report pages). Reuse it. Add no new dependency.

CHECK FIRST: branch is library-r. Prompts 1 to 9 are done. Tests pass.

BUILD backend:
1. GET activity-logs/ with filters event_type, from, to, actor, member, book and search, select_related only the actor, paginated.
2. GET activity-logs/export/: CSV streamed, same filters, capped at 50,000 rows, formula characters neutralised, requires library.activity_logs.export, and writes its own log row.
3. Reports (library.reports.view, group-by queries only, no Python loops over loans): circulation-by-category, monthly-trend, fines-and-fees (charged, collected, waived by type), budget-vs-spend. Default range is the current academic year (D9) with from and to overrides.
BUILD frontend:
4. /library/transactions: type chips, date and member filters, table (timestamp, type, details, staff), Export button gated by can(). 
5. /library/reports: four panels using the repo's existing chart approach, with the tokens and no raw hex, loading, empty and error states.
6. Add both to the sub items.

TESTS: filters, export cap, export sanitisation, export is logged, report totals against seeded loans and charges, query-count bounds, permission matrix, cross-school.

DONE WHEN: tests pass; tsc and lint pass.
Priority if space is tight: backend and tests, then Transactions, then Reports charts.

FINISH: update docs/LIBRARY_PROGRESS.md. Stage exact paths. Commit "library: transactions log, export, reports". Do not push. End with the report.
```

---

## Prompt 11 — Teacher portal

```text
PROMPT 11 OF 13: TEACHER PORTAL
Rules: docs/LIBRARY_MODULE_BLUEPRINT.md section 0.2 applies. Work on branch library-r. Stage explicit paths only. Never push. Never run migrate against the app database. Finish everything in this one response and do not ask me questions.

READ FIRST: docs/LIBRARY_PROGRESS.md, then blueprint sections 0.1 (all facts), 0b (D4, D15, D16, D17), 1.1 (teacher portal screens), 2.4 (Teacher portal table), 3.4, 4.1, 6.1, 8.2, 9 (Portals row). Study backend/apps/teacher_portal/urls.py, permissions.py, utils.py and two existing views (for example attendance and homework), frontend/lib/teacher-routes.ts, a few pages under frontend/app/(teacher-portal)/teacher/, the teacher API client under frontend/lib/api/, and the teacher notification bell.

CHECK FIRST: branch is library-r. Prompts 1 to 10 are done. Tests pass.

BUILD backend (match the sibling teacher views exactly):
1. New file apps/teacher_portal/library_views.py with APIView classes using authentication_classes [JWTAuthentication] and permission_classes [IsTeacherPortalUser]. Plain JSON, no admin envelope, no permission codes. Register the routes in apps/teacher_portal/urls.py under library/: overview, my-class, my-class/loans/{issue_id}/remind, my-books, my-books/loans/{issue_id}/renew, book-requests (GET and POST), books/search.
2. Scoping per blueprint 3.4: My Class uses get_attendance_scope(user); a loan outside that scope returns 404; no scope returns an empty list. My Books finds the teacher's LibraryMember through Staff.user; an unregistered teacher gets registered: false. Requests use requested_by = request.user and take class and section from the scope on the server.
3. Reuse services: renew uses services/circulation.renew_loan with the R5 rules; remind uses services/notifications.py once per loan per day; book request creation writes an activity log row.
BUILD frontend:
4. Add a Library module with three sub items to lib/teacher-routes.ts. Pages: teacher/library (My Class), teacher/library/my-books, teacher/library/recommend. Add functions to the teacher API client the sibling pages use. Follow the sibling pages' layout and tokens. My Class shows the next library period, the due-back list with a Send reminder button (disabled after sending). My Books shows loans with Renew or the reason it is blocked ("On hold for someone else", "Renewal limit reached", "Overdue, please return"). Recommend shows the form and own requests with status. Empty states for no class scope and not registered.
5. Register a usePortalNotifications handler on these pages that refetches with silent401. Check that the teacher bell shows the new notification_type values and fix its rendering if needed.

TESTS: wrong portal role gets 403; superuser gets 403; teacher without a staff profile gets 403; a loan of a student outside the scope returns 404; only own loans in My Books; unregistered teacher response; remind once per day; renew refusals; request creation; another school's ids return 404.

DONE WHEN: tests pass; tsc and lint pass; the Library module appears in the teacher portal nav.
Priority if space is tight: endpoints and tests, then My Books and Recommend, then My Class polish.

FINISH: update docs/LIBRARY_PROGRESS.md. Stage exact paths. Commit "library: teacher portal". Do not push. End with the report.
```

---

## Prompt 12 — Parent portal

```text
PROMPT 12 OF 13: PARENT PORTAL
Rules: docs/LIBRARY_MODULE_BLUEPRINT.md section 0.2 applies. Work on branch library-r. Stage explicit paths only. Never push. Never run migrate against the app database. Finish everything in this one response and do not ask me questions.

READ FIRST: docs/LIBRARY_PROGRESS.md, then blueprint sections 0.1 (all facts), 0b (D3, D15, D17), 1.1 (parent portal screens), 2.4 (Parent portal table), 3.4, 4.1, 8.2, 9 (Portals row). Study backend/apps/parent_portal/views.py (especially _resolve_child and ParentHomeworkView), urls.py, permissions.py, frontend/lib/parent-routes.ts, frontend/app/(parent-portal)/parent/homework/page.tsx, frontend/contexts/ParentChildContext, frontend/lib/api/parent.ts.

CHECK FIRST: branch is library-r. Prompts 1 to 11 are done. Tests pass.

BUILD backend (match the sibling parent views exactly):
1. New file apps/parent_portal/library_views.py with APIView classes using [JWTAuthentication] and [IsParentPortalUser]. Plain JSON. Import _resolve_child. Do not copy it. Routes in apps/parent_portal/urls.py under library/: current and history.
2. current: next library slot for the child's class and section (from period slots), open loans (title, copy code, due date, overdue flag, accrued fine from services/dues.py), loan limit, suspended flag, pending replacement fees, registration fee status. history: closed loans newest first, paginated, page size 20. Read only. Every query filters on the child's member record and school. A child with no member record returns an explicit registered: false response, not an error.
BUILD frontend:
3. In lib/parent-routes.ts replace the placeholder Library item (path /parent/home) with /parent/library and add History as a sub item.
4. Pages parent/library (Current and Due) and parent/library/history. Use useParentChild() and copy the child switch from the Homework page. Show the next library period, a card per open loan (overdue state in the warn token with the fine), "x of y allowed", pending replacement fees, registration fee status. History is a paginated list. Skeleton, empty and error states like the sibling pages. Add the fetch functions to lib/api/parent.ts.
5. Register a usePortalNotifications handler that refetches with silent401.

TESTS: wrong portal role and superuser get 403; a guardian asking for another guardian's child_id gets 404; an inactive child gets 404; no child_id gives 400; another school's data never appears; unregistered child response; fines and limits match services/dues.py; history pagination; query-count bound on current.

DONE WHEN: tests pass; tsc and lint pass; the parent Library page replaces the placeholder.
Priority if space is tight: endpoints and tests, then Current page, then History.

FINISH: update docs/LIBRARY_PROGRESS.md. Stage exact paths. Commit "library: parent portal". Do not push. End with the report.
```

---

## Prompt 13 — Cleanup and final audit

```text
PROMPT 13 OF 13: CLEANUP AND FINAL AUDIT
Rules: docs/LIBRARY_MODULE_BLUEPRINT.md section 0.2 applies. Work on branch library-r. Stage explicit paths only. Never push. Never run migrate against the app database. Finish everything in this one response and do not ask me questions. Do not change behaviour except where a step below says so.

READ FIRST: docs/LIBRARY_PROGRESS.md, then blueprint sections 4 (all), 5 steps 5 to 8, 9, 10 and Appendix-style checks in 0.1.

CHECK FIRST: branch is library-r. Prompts 1 to 12 are done. All library tests pass.

DO:
1. Tightening migration: only if the reconcile commands show no nulls, make Book.category required and the loan copy link required. If they show nulls, skip and report the counts.
2. Cleanup migration written but marked "apply after backup": drop the deprecated quantity and available_quantity columns. Remove all code that still reads them.
3. Delete frontend/components/library/LibraryPanels.tsx and any dead imports. Keep the redirect pages for the old routes (books, categories, issues) for one release.
4. Full regression: run the library tests, plus the tests of every app you touched (access_control, communication, teacher_portal, parent_portal, core if touched). Run npx tsc --noEmit, npm run lint, and the Jest tests for library. Report every failure. Fix only failures you caused.
5. Security and quality audit. Produce a table in docs/LIBRARY_AUDIT.md with one row per item and the file or test that proves it: school scoping on every ViewSet and every portal view, cross-school FK validation list from blueprint 3.3, no is_superuser branch in data scoping (search the library code and the portal library views), permission code on every endpoint, no client-trusted money or dates, state machines, partial unique indexes, row locking in issue, renew, return and withdraw, CSV sanitising, donor contact never logged, query-count tests for every list endpoint, portal ownership checks, push helper failure isolation. Where a row has no proof, add the missing test now.
6. Update docs/TEAM_CONTEXT.md with what was built, what was not built, known issues, and the pre-existing tier-seeding problem for other modules (blueprint fact 7).
7. Write the release steps into docs/LIBRARY_PROGRESS.md in order: migrations to apply, seed_permissions, seed_module_tiers, seed_role_templates, library_register_periodic_tasks, library_role_report, library_reconcile, and which Celery worker and beat processes must be running.

FILES: backend/apps/library/**, frontend/components/library/**, docs/LIBRARY_AUDIT.md, docs/TEAM_CONTEXT.md, docs/LIBRARY_PROGRESS.md.

DONE WHEN: all checks above are green or each failure is explained; the audit table has no row without proof.

FINISH: Stage exact paths. Commit "library: cleanup, audit and release notes". Do not push. End with the report, and list the exact commands I should run to apply and verify everything on my machine.
```
