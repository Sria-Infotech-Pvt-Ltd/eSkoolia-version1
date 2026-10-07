# Library Module: Build Progress

Handoff file for the 13 build prompts (`docs/LIBRARY_BUILD_PROMPTS.md`). Read it first in every session, update it last.
Blueprint: `docs/LIBRARY_MODULE_BLUEPRINT.md`. Branch: `library-r`. Never push, never `git add -A`, never `migrate` the app database.

## Environment baseline

Recorded at the start of prompt 1 (2026-10-07).

| Item | Value |
|---|---|
| Branch | `library-r` |
| Python | 3.14.3 (system, no venv) |
| Django / DRF | 6.0.4 / 3.16.1. Production pins Django 5.1.8, so write code that works on both. |
| Test runner | pytest 9.0.3, pytest-django 4.12.0, `backend/pytest.ini` uses `config.settings.test` |
| Frontend | `npx tsc --noEmit`, `npm run lint` from `frontend/` |

**Which database the tests use.** `config/settings/test.py` picks, in order: `DATABASE_URL_TEST`, then (in CI) `DATABASE_URL`, then a derived database named `neondb_test_local` on the same server as `DATABASE_URL`, then SQLite. `backend/.env` sets `DATABASE_URL` to the shared cloud server, so with no override the tests would create and drop `neondb_test_local` there. To keep the shared server untouched, prompt 1 ran the tests on a throwaway SQLite file:

```
cd backend
DATABASE_URL_TEST=sqlite:///test_library.sqlite3 python -m pytest apps/library -p no:cacheprovider --create-db --nomigrations
rm -f test_library.sqlite3
```

`--nomigrations` is required on SQLite. The existing migration chain fails there on a Postgres-only statement in another app (`near "EXISTS": syntax error`), which is unrelated to the library and was not fixed. Consequence: tests build tables from the models, so the library migration is proven by `makemigrations --check` plus `sqlmigrate` rendering, not by running it. Postgres-only behaviour (row locks, partial-index timing) cannot be verified this way. When a test needs it, mark it skip-unless-Postgres and report it as unverified.

**Runner proof.** `apps/admissions/tests/test_smoke.py` (smallest matching file): 3 passed with the command above. Without `--nomigrations` on SQLite: 3 errors from the migration chain.

**Working tree at start** (`git status --short`, other people's changes, not part of the library work):

```
 M backend/apps/communication/serializers.py
 M backend/apps/competitions/views.py
 M backend/apps/core/serializers.py
 M backend/apps/core/views.py
 M backend/apps/hr/views.py
 M backend/apps/students/migrations/0012_repair_missing_district_column.py
 M backend/tests/test_access_control.py
 M frontend/app/(dashboard)/exams/marks-register-create/page.tsx
 M frontend/app/no-access/page.tsx
 M frontend/components/access-control/RoleManagementPanel.tsx
 M frontend/hooks/useExamsApi.ts
 M frontend/tsconfig.tsbuildinfo
?? backend/apps/exams/tests.py
?? backend/tests/test_tenant_isolation.py
```

plus the untracked library planning documents, staged in prompt 1.

**Frontend baseline (not caused by the library work).** `npx tsc --noEmit` reports 13 errors, all in `app/(dashboard)/exams/` (`marks-register-create`, `result-publish`, `schedule`). `npm run lint` exits 1 on 7 `react/no-unescaped-entities` errors in `app/(dashboard)/hr/leave/page.tsx`, `components/academics/timetable/TimetableWorkspace.tsx` and `components/hr/LeaveSetupWizard.tsx`, plus 151 warnings. No error or warning comes from a library file. Run tsc as `npx tsc --noEmit --incremental false` so it does not rewrite the already-modified `tsconfig.tsbuildinfo`.

## Prompt log

| # | Prompt | Status |
|---|---|---|
| 1 | Foundations | Done (2026-10-07). 111 backend tests pass. tsc and lint clean for library files. |
| 2 | Catalogue backend | Done (2026-10-07). 186 backend tests pass, 1 Postgres-only test skipped (unverified). tsc has no library errors. |
| 3 | Catalogue frontend and bulk tools | Done (2026-10-07). 221 backend tests pass (1 Postgres-only skipped), 18 Jest tests pass. tsc and lint show only the baseline errors from other modules. Browser behaviour not checked by me. |
| 4 | Members, charges and settings | Done (2026-10-07). 296 backend tests pass (1 Postgres-only skipped), 29 Jest tests pass. tsc and lint show only the baseline errors from other modules. Screens not checked in a browser. |
| 5 | Circulation backend | Not started |
| 6 | Issue Desk and exceptions screens | Not started |
| 7 | Console, reminders and push | Not started |
| 8 | Acquisitions and requests | Not started |
| 9 | Periods, occupancy and stock check | Not started |
| 10 | Oversight: logs and reports | Not started |
| 11 | Teacher portal | Not started |
| 12 | Parent portal | Not started |
| 13 | Cleanup and final audit | Not started |

## What prompt 1 built (for the next prompt)

- `apps/library/` is now packages: `models/` (`base`, `catalogue`, `circulation`, `settings`, `activity`), `serializers/`, `views/`, `services/` (`settings.get_settings`, `activity.log_event`), plus `exceptions.py`, `management/commands/library_role_report.py` and `tests/`. Tables of the four existing models are unchanged apart from `created_by` and `updated_by`.
- `views/base.py::LibraryViewSet`: set `model`, `serializer_class`, `permission_codes` (keyed by action: `list`, `retrieve`, `create`, `update`, `destroy` or a custom action name), optional `select_related_fields`, `default_ordering`. It fails closed when an action has no code. `list_response(queryset)` wraps list-style actions in the envelope.
- `serializers/base.py::LibraryModelSerializer` (ISO timestamps, rejects unknown keys on create) with `AUDIT_FIELDS` and `AUDIT_READ_ONLY` to reuse.
- Test fixtures in `apps/library/tests/conftest.py`: `other_school`, `librarian` (every library code), `view_only` (the four legacy view codes), `*_client`, `other_admin`, `category`, `book`, `member`, `student`, `other_*`, and the helpers `make_user(school, codes)` and `client_for(user)`.
- Permission catalogue (all of blueprint 3.6) is in `seed_permissions.py`. The tier map is in `seed_module_tiers.py` (`classify_library`, `LIBRARY_OPERATE_CODES`, `LIBRARY_MANAGE_CODES`).

## What prompt 2 built (for the next prompt)

- Models: `BookCategory` (+`code`, `color_key`, `next_sequence`, `updated_at`), `Book` (+ every table 3 field except `purchase_order` and `donation`), new `BookCopy`, and `LibraryActivityLog.copy`. `Book.category` is now PROTECT (still nullable for legacy rows).
- Services: `numbering.py` (`derive_category_code`, `next_accession_code` under `select_for_update`), `accession.py` (`create_book_with_copies`, `add_copies`, `withdraw_copy`, each one transaction with its activity row), `catalogue.py` (`annotate_copy_counts`, `availability_status`, `filter_availability`), `codes.py` (pure code helpers), `backfill.py`.
- Endpoints under `/api/v1/library/`: `categories/` CRUD, `books/` list, create (accession wizard), retrieve, patch, delete, `books/{id}/add-copies/`, `books/{id}/copies/`, `books/lookup/`, `copies/` list and retrieve, `copies/by-code/{code}/`, `copies/{id}/` PATCH (condition only), `copies/{id}/withdraw/`. Bulk import is prompt 3.
- Frontend data layer: `types/library.ts` and `hooks/useLibraryApi.ts` have categories, books, copies and lookup. No screens.
- Test helpers: `make_book(school, category, title=..., copies=n, **fields)` in `tests/conftest.py`; the `category` fixture has code `FIC`.
- `LibraryViewSet` gained `annotate_queryset` (hook, runs before the DRF search and ordering backends), `disabled_actions` (405) and `list_response(queryset, serializer_class)`.

## What prompt 3 built (for the next prompt)

- Backend: `POST books/bulk-import/preview/` and `.../commit/` (code `library.books.import`), `GET books/{id}/labels/` (code `library.book_copies.view`), in `views/catalogue.py` and `services/bulk_import.py`. `create_book_with_copies` takes `log=False` so a batch writes one activity row.
- Frontend: `/library/catalogue` (page file is thin, everything is in `components/library/catalogue/`): `CataloguePage`, `AccessionWizard` (also edits and adds copies), `CategoriesModal`, `BulkImportModal`, `CopiesRegisterModal`, `LabelPrintView`, `ScannerSetupPanel`, plus pure helpers `wizard.ts`, `bulkParse.ts`, `code39.ts`, `colors.ts` and small shared primitives in `ui.tsx` (`Modal`, `Pill`, `Btn`, `Field`, `ConfirmDialog`, `StateBox`, `SkeletonRows`, `useToast`, `describeError`, `fieldMessages`). Prompts 4 onward can reuse `ui.tsx`.
- `/library/books` and `/library/categories` are server redirects to `/library/catalogue`. `lib/routes.ts` now has Catalogue, Library Members and Book Issues as sub items (the module path is `/library/catalogue`). The retired sidebar list in `components/layout/sidebar-menu.data.ts` still points at the old routes and works through the redirects.
- `styles/tokens.css` gained ten `--cat-<key>` colours (rose, orange, amber, lime, emerald, teal, sky, indigo, violet, slate) and `--overlay`. The status tokens (ok, warn, danger, info and their soft variants) already existed, so none were added. No raw colour values exist in the new components.
- Jest: `__tests__/library/wizard.test.ts` covers step validation, bulk-text parsing, Code 39 and colour helpers.

## What prompt 4 built (for the next prompt)

- Models: `LibraryMember` (teacher type, `registration_fee_amount`, `updated_at`, partial uniques per student and per staff, `ck_library_members_type_matches_person`, student and staff FKs now PROTECT), new `Charge` (table `library_charges`, issue link only; the replacement-report link and its unique constraint are prompt 5's). `BookIssue.book` and `.member` are PROTECT now.
- Services: `dues.py` (pure: `accrued_fine`, `loan_fine`, `replacement_cost`, `borrowing_limit`, `summarise_dues`), `members.py` (`register_member`, `infer_member_type`, `default_registration_fee`, `annotate_member_dues`, `accrued_fines_by_member`, `suspended_member_ids`, `eligibility`, `holding_member_ids`), `charges.py` (`collect_charge`, `waive_charge`). Prompt 5 should reuse `loan_fine`, `eligibility` and `member_dues` rather than rewriting them.
- Endpoints: `members/` list, create, retrieve, PATCH, DELETE; `members/{id}/dues/`; `members/candidates/?type=&q=`; `members/eligible/?school_class=|member_type=&book=` (reasons: ok, suspended, limit_reached, already_holding, not_eligible_audience, reference_only); `charges/` list, retrieve, `charges/{id}/collect/`, `charges/{id}/waive/`.
- `LibraryViewSet` gained `page_context(rows)`: one hook for per-page batched context (used for accrued fines).
- Frontend: `/library/members` and `/library/settings` (components in `components/library/members/` and `components/library/settings/`, reusing `components/library/catalogue/ui.tsx`), types and hook functions for members, charges and classes, a Settings sub item gated by `library.settings.view`. `__tests__/library/members.test.ts` covers the form helpers.

## Decisions made

1. **`LibraryViewSet` does not inherit the CRUD methods of `PaginatedModelViewSet`.** Those methods wrap everything in `except Exception` and answer 400 (`retrieve_error`, `create_error`, ...). That would turn a cross-school 404 into a 400 and hide 403s and the library 409 codes. The library base re-implements the five verbs with the same success envelope and lets errors reach `config/exception_handler.py`. It also skips the base `filter_queryset`, which re-applies filters with a raw `.filter(field=value)` and rejects `?is_active=true` (the library pages send exactly that).
2. **Envelope impact on the four existing pages.** Lists keep `results`, `count`, `next`, `previous` at the top level and gain `success`, `message`, `data`, so `listData()` in `LibraryPanels.tsx` is unaffected. Create, update and return responses are now `{success, message, data}`, and the page ignores those bodies. Delete returns 204 with no body (the core base returned 204 with a body, which HTTP cannot carry). `LibraryPanels.tsx` was not edited.
3. **Permission check fails closed.** An action with no code is refused. `partial_update` uses the `update` code and `summary` the `list` code. A method the viewset does not allow skips the code check so the caller gets 405 instead of 403.
4. **No generic PUT, PATCH or DELETE on `/issues/`.** Blueprint 3.6 defines no `book_issues.create`, `.update` or `.delete` code, and the old versions adjusted stock with no check. Loans now allow GET and POST only. Create needs `book_issues.issue`, return needs `book_issues.return`, list, retrieve and overdue need `book_issues.view`.
5. **Legacy loan hardening kept inside the legacy endpoints** (prompt 5 replaces them): `status`, `return_date` and `fine_amount` are read-only on the serializer, a new loan is always `issued`, the return action ignores the request body and stamps today's date, stock moves with conditional `UPDATE ... F()` statements (two requests for the last copy cannot both pass), and a second return answers 409 `library_already_returned`.
6. **Settings.** `GET` creates the row on first read. `PUT` accepts any subset of editable fields. `po_sequence` and `donation_receipt_sequence` are read-only. `junior_class_ids` is filled once at creation from class names normalised by `Class.normalize_name` (Nursery, LKG, UKG, Grade 1 to 4) and every id sent later is checked against the caller's school. An update that changes something writes one `settings` activity row whose metadata lists the changed field names only (no values). An update that changes nothing writes no row.
7. **`log_event(school, actor, event_type, summary, **refs)`** accepts `book`, `member`, `issue` and `metadata`. It rejects an unknown event type, an unknown reference, and a reference from another school. It does not open its own transaction: call it inside the caller's `atomic()`.
8. **Unknown keys on create are rejected** with a 400 and `field_errors`. Read-only keys (`school`, `created_by`, money) are ignored, never assigned.
9. **Index names are shortened** (`idx_lib_act_school_created` and so on) because Django limits index names to 30 characters. Constraint names follow the blueprint.
10. **`library_settings.school` is a ForeignKey plus `uq_library_settings_school`** (as the blueprint names it), not a OneToOneField.
11. **`library_role_report`** lists roles holding any `library.*.view` code and, for each, the writes it used to have and no longer has. It accepts `--school <id>` and prints role names, ids and user counts only.
12. **(Prompt 2) Migrations are split in three** so the backfill can fill codes before the unique constraints that blank codes would break: `0003_catalogue` (schema), `0004_catalogue_backfill` (data, calls `services/backfill.py`, writes no files, reverse is a no-op because undoing 0003 drops the columns), `0005_catalogue_constraints` (`uq_library_books_school_accession`, `uq_library_book_categories_school_code`).
13. **Backfill copy rule.** Each legacy title gets `max(quantity, open loans + lost loans)` copies, so every loan has a copy: lost loans make that many copies `lost`, open loans make that many `issued`, the rest `available`. Loans are not bound to copies yet (prompt 5). Titles with no category go to a per-school `Uncategorised` category (code `UNC`). Categories without a code get one derived from the name (FIC, FIC2 on a clash). Legacy titles keep the model defaults for age band (`primary`), audience (all true), format (`non_fiction`), cost 0 and source `purchased`, and are not flagged anywhere for review beyond these defaults.
14. **`copies_total` excludes withdrawn copies** (they have left the collection). Availability (R11): `issued` when 0 available, `low` when available/total is at most the school's `low_stock_ratio`, otherwise `available`. The `availability` filter and the row status use the same rule.
15. **The old counters are aliases now.** `quantity` and `available_quantity` in API output equal `copies_total` and `copies_available`, so the legacy Books page shows real numbers. The stored columns are never written. The legacy Books page can no longer create titles (the accession payload needs category and copies); that is accepted until prompt 3.
16. **Legacy loans move copy rows.** `POST /issues/` locks an available copy and sets it `issued`; `return` sets one issued copy of the title back to `available`. The loan is not linked to the copy, so which copy is freed is arbitrary. Prompt 5 replaces this with real binding.
17. **`?format=` on `/books/` is a catalogue filter.** DRF reads `format` as a renderer override, so `BookViewSet` uses a content negotiator that ignores it (the API only renders JSON).
18. **`copies/by-code/{code}/`** matches case-insensitively and accepts the slash inside a code. Copy codes repeat across schools, so every lookup is school-scoped.
19. **Add copies** takes `count` and `condition`. The blueprint also lists `source`, `purchase_order` and `donation`; copies have no such columns and the links arrive in prompt 8, so they are not accepted.
20. **Call numbers are entered, not generated.** The blueprint says "generated from the prototype's rule" but the rule is not written down anywhere.
21. **Withdraw uses `library_invalid_state_transition`** (409) when the copy is not available. The activity row for withdrawing is an `accession` event with `metadata.action = "withdraw"` because no withdraw event type exists.
22. **`holds_waiting` is a constant 0** until the holds model exists (prompt 5).
23. **(Prompt 3) Bulk import normalisation.** Cells starting with `=`, `+`, `-`, `@`, tab or carriage return are neutralised by prefixing an apostrophe (a lone leading tab is collapsed as whitespace and dropped). Category matching uses the typed name, case-insensitive, within the school. Extra row rules beyond the blueprint: copies 1 to 500 per row, cost 0 to 9999999999.99, title and author length caps, a row that repeats an existing title+author (edition and part blank) or an earlier row is "Title already exists" or "Duplicate of an earlier row". A request over 500 rows, or with an invalid `client_batch_id`, is a 400.
24. **Batch idempotency** is a lookup of `metadata.client_batch_id` on the school's accession activity rows, under a lock on the school's settings row (a real lock on PostgreSQL only; unverified under concurrency). A repeat returns the stored first result (`replayed: true`, HTTP 200) whatever rows it carries. The batch's activity metadata holds ids, accession codes, row numbers and the error text of skipped rows (which can contain a category name the user typed).
25. **Labels** exclude withdrawn copies unless `?all=true`; `?copy=<id>` gives one label. The barcode is Code 39 drawn as inline SVG by `code39.ts`, so no library was added. Code 39 only carries A-Z, 0-9, `-`, `.` and `/`; a copy code outside that set prints as text only.
26. **Labels use `useDocumentBranding("student_verification")`** only for the school header image. The hook requires a document type and offers no generic one; the declaration text it returns is ignored.
27. **Catalogue filters.** "Reader" is one dropdown (students, teachers or staff), mapped to `for_students=true` and so on. Search is debounced 300 ms; stale list responses are discarded; a page past the end after filtering resets to page 1.
28. **Edit title** reuses the wizard (loads `GET books/{id}/`); its copies step becomes "Add more copies" (0 adds none) and calls `add-copies`. Copies are never removed by editing a number.
29. **Gating.** Buttons use `can()`: New accession `books.create`, Bulk import `books.import`, Manage categories `book_categories.view` (add, edit, delete need `.create`, `.update`, `.delete`), Edit `books.update`, Copies and Labels `book_copies.view`, withdraw `book_copies.withdraw`, condition edit `book_copies.update`, add copies `books.update`. The page itself needs `books.view`. Category, scanner and wizard lookups use `silent401`; saves do not.
30. **(Prompt 4) Accrued fine is computed, not stored**, per open loan: days past due minus grace days, times the daily rate, then the lower of the school cap and (when the cap-at-replacement setting is on) the copy's replacement cost (copy cost plus handling fee, or the default cost when the copy cost is 0). Due today is not overdue. Open-loan fines are computed for a whole page in one query (`accrued_fines_by_member`); the `standing` filter computes them school-wide in one query.
31. **Suspension** means accrued or pending overdue fines, or pending replacement fees, above 0. An unpaid registration fee is part of `total_dues` and `registration_due` but never suspends. `total_dues` therefore includes it; `standing` does not.
32. **Registration status** is read from the member's registration charge (pending is unpaid, paid is paid, anything else is waived). A member with no registration charge (a legacy row) shows as waived. A fee of 0 creates a charge already waived, with the note "No registration fee".
33. **Registration** takes either a student or a staff member. Staff type is inferred (teacher when the staff user holds an active role with portal type teacher, else staff) unless the request gives `teacher` or `staff`. Person ids are looked up inside the caller's school and among active people only, so another school's id gives the same "invalid choice" error as an id that does not exist. `collect_fee_now` needs `library.charges.collect` in addition to `library_members.create`. Card numbers are `LM-00001` style, generated under a lock on the school's settings row, or typed.
34. **PATCH members** accepts `is_active`, `card_no` and `member_type` (only between teacher and staff). Registration fee and the person link cannot be edited; no PUT.
35. **Delete member** is refused with `library_has_history` when any loan or charge exists. Since every new member gets a registration charge, deletion only works for legacy members with no charge. Deactivate instead.
36. **Receipt numbers** are `LIBR-<charge id, 7 digits>`; there is no counter in the settings for them.
37. **Waiving** a charge needs `charges.waive` and a reason. The waive-and-return path with `book_issues.waive_fine` belongs to prompt 5.
38. **Member migrations are split in three** like the catalogue ones: `0006_members_charges` (schema and the `Charge` table), `0007_members_data` (zero registration fees, and a check that stops with the offending member ids if any existing row would break the new constraints), `0008_members_constraints` (the two partial uniques and the type-matches-person check). Duplicate memberships or a mismatched type in existing data must be fixed by hand before `0007` passes.
39. **Settings page** sends every editable field on save (the server accepts a subset, the page sends all). Classes come from `GET /api/v1/core/classes/?page_size=200`. A school with more than 200 classes would not see the rest.

## Migrations to apply

Not applied by the build. Apply in this order on each environment.

| Migration | Contents |
|---|---|
| `library.0002_foundations` | `created_by`, `updated_by` on `library_books`, `library_book_categories`, `library_book_issues`, `library_members`. New tables `library_settings` and `library_activity_logs`. Depends on `library.0001_initial` and `tenancy.0023_backfill_missing_schooltenant_rows`. |
| `library.0003_catalogue` | Schema: category `code`, `color_key`, `next_sequence`, `updated_at`; title fields from blueprint table 3; table `library_book_copies`; `library_activity_logs.copy`; `Book.category` becomes PROTECT; `uq_lib_book_title_author` replaced by `uq_library_books_identity`; new checks and indexes. |
| `library.0004_catalogue_backfill` | Data: category codes, `Uncategorised`/`UNC`, accession codes, copies (decision 13). Idempotent. Writes no files. Take a database snapshot first (blueprint section 5 step 1). |
| `library.0005_catalogue_constraints` | `uq_library_books_school_accession`, `uq_library_book_categories_school_code`. |
| `library.0006_members_charges` | Schema: member type `teacher`, `registration_fee_amount`, `updated_at`, PROTECT on member student and staff and on loan book and member; table `library_charges`; member fee check and index. |
| `library.0007_members_data` | Data: registration fees to 0 and an integrity check. **Stops with an error listing library member ids** when a student or staff member has more than one membership, or a member's type does not match its person. Fix those rows by hand and run it again. |
| `library.0008_members_constraints` | `uq_library_members_school_student`, `uq_library_members_school_staff`, `ck_library_members_type_matches_person`. |

**Right after `0004`:** run `python manage.py library_reconcile` (read-only). It lists legacy titles whose old `available_quantity` differs from the derived available copies; the derived copy state is what the system uses, the list is for a librarian to check. Run it before circulation resumes, because the old counter stops moving afterwards. `--school <id>` narrows it.

After migrating, in this order: `seed_permissions`, `seed_module_tiers`, `seed_role_templates` (re-syncs role tiers), then `library_role_report` and review the output. The full release list is written in prompt 13.

## Known gaps

- **Role templates (D12) are not changed.** `seed_role_templates.py` gives Teaching Staff and Class Teacher `library: view` and Staff Coordinator `library: operate`; D12 says teacher and parent templates get none. That file was outside prompt 1's file list and no later prompt lists it. Decide and assign it (prompt 13 or a follow-up).
- **Roles that held library `.view` codes could previously write.** After the split they can only read. Run `library_role_report` on each environment and grant the new codes where the write access was intended.
- **Shared tier-seeding defect.** `seed_module_tiers.classify()` misclassifies dot-style codes for other modules too. Only the library has an explicit map now. Report to the owner of the other modules.
- **`TENANT_FEATURE_GATES` does not exist** in any settings module (the middleware reads it with `getattr(..., {})` and defaults to empty), so the three v1 patterns from blueprint fact 8 were not added. Adding the setting would live in `config/settings/base.py`, which prompt 1 may not edit. The frontend gate `hasFeature('library_enabled')` is not wired yet.
- **Loans are still legacy.** `BookIssue` has no copy link and no renewal, return-by or fine fields yet, and legacy `POST /issues/` does not check suspension, limits, audience or reference-only (prompt 5 replaces it with `eligibility`).
- **Library fines never become charges yet.** Charge rows of type overdue fine and replacement are only created by prompt 5; until then the Dues drawer shows accrued open-loan fines (computed) and registration fees only.
- **No Jest component tests** for the members and settings screens, only helper tests. Nothing was checked in a browser.
- **Category tighten is not done.** `Book.category` is still nullable and legacy loans are not bound to copies; blueprint section 5 migrations C and D (tighten, drop `quantity` columns) are later releases.
- **Legacy Books and Categories panels** (`LibraryPanels.tsx`) are no longer routed to; they stay in the file until prompt 13 removes it. The Members and Issues pages still use that file.
- **Not checked in a browser.** The catalogue screens, print view and scanner panel were type-checked, linted and unit-tested only; the user does the visual check.
- **No Jest component tests**: only the pure helpers are tested (as specified).
- **Print layout is basic** (CSS grid of 230 px labels, no label-sheet presets). Barcode scanning of printed Code 39 labels is untested with real hardware.
- **Backfill and the concurrent-accession test are unverified on the real database.** SQLite cannot run the migration chain, so `0004` was tested through `services.backfill.backfill_catalogue` on hand-built legacy rows, not by `migrate`. `test_concurrent_accession_in_one_category_never_repeats_a_code` is skipped unless the test database is PostgreSQL. Run both on staging.
- **Migration not executed.** SQLite cannot run the project's migration chain, so `0002_foundations` was verified by `makemigrations --check` and `sqlmigrate`, not by `migrate`. Run it on Postgres staging first.
- **Tests that need Postgres** (row locks, partial indexes): none yet. Future ones must be marked skip-unless-Postgres.
- **Frontend baseline errors** (tsc 13, lint 7) belong to the exams, HR and academics modules.

## Deviations from blueprint

- `models/` has `base.py` (shared `LibraryAuditModel`) in addition to the files listed in 3.1.
- Activity log `copy` FK was added in prompt 2.
- Add-copies does not take `source`, `purchase_order`, `donation` (decision 19). Call numbers are not generated (decision 20). `copies_total` excludes withdrawn copies (decision 14).
- Migrations 0003 to 0005 split the blueprint's migration A and B as in decision 12.
- Index names abbreviated (decision 9).
- Loans offer no generic PUT, PATCH or DELETE and use `book_issues.issue` for create (decision 4).
- Role templates untouched (Known gaps).
- `TENANT_FEATURE_GATES` skipped (Known gaps).
