# QNHS Canteen Inventory & Financial Management System

Web application for **Quiot National High School** (School ID 312515, Schools Division of
Cebu City) that replaces the `CANTEEN REPORT.xlsx` workbook. It covers:

- inventory and stock ledger
- daily sales
- expenses, other sales and deficits
- consolidated and monthly reports
- fund allocation
- audit log
- Excel migration

**Stack:** React 18 + TypeScript + Vite, Tailwind CSS, Radix UI primitives (shadcn-style), Lucide
icons, Recharts, Supabase (Postgres, Auth, RLS, Edge Functions), deployable on Vercel.

> Financial rules and the points awaiting school confirmation are documented in
> [docs/FINANCIAL_RULES.md](docs/FINANCIAL_RULES.md).

## How correctness is enforced

- **All stock and money changes run in Postgres functions** (`supabase/migrations`). Each one checks permissions, locks the rows it touches (`SELECT … FOR UPDATE`) and writes the ledger in the same transaction.
- **Quantity on hand cannot be edited directly.** A trigger blocks direct edits. Every movement is an insert-only row in `inventory_transactions`, and the ledger always sums to the balance; the dashboard raises an alert if it ever doesn't.
- **Finalizing daily sales deducts stock exactly once per line.** Reopening a record posts auditable reversal entries. Negative stock requires an administrator exception with a written reason.
- **Calculated amounts are generated columns.** This covers line amounts, unsold quantities and stock value. Report totals come from SQL functions such as `report_daily_summary`.
- **No double counting.** A sale flagged "already included in daily sales" is excluded from Other Shares. A stock purchase becomes an expense only by explicit opt-in, and is linked to its source.
- **Posted financial records are never deleted; they are reversed.** Fund rules are frozen once activated, and allocation runs keep the amounts they posted with.
- **RLS on every table.** Viewers can never hold write permissions, and roles are never read from sign-up metadata.
- **Insert-only audit log.** Triggers record old and new values on every audited table.

## Local development

```bash
npm install
cp .env.example .env.local      # set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev
```

Tests:

```bash
npm run test:db   # runs all migrations in PGlite (Postgres/WASM): 20 acceptance tests
npm test          # unit tests: line maths + parser against CANTEEN REPORT.xlsx (if present)
npm run typecheck
```

## Supabase setup

1. **Create a project** at supabase.com, region *Southeast Asia (Singapore)*.
2. **Apply the migrations** in `supabase/migrations`, in file-name order. Either run `supabase link --project-ref <ref>` then `supabase db push`, or paste each file into the SQL editor.
3. **Disable public sign-ups:** *Authentication → Providers → Email → "Allow new users to sign up" = off*. Accounts are created only by administrators.
4. **Create the first administrator.** Add the user under *Authentication → Users*, then run this in the SQL editor:

   ```sql
   select public.bootstrap_admin('principal@deped.gov.ph');
   ```

   `bootstrap_admin` cannot be called from the app.
5. **Deploy the user-management Edge Function.** It holds the service-role key on the server only:

   ```bash
   supabase functions deploy admin-users
   ```

   After that, administrators create staff and viewer accounts from **User Management**.
6. **Review Settings.** Check *Settings → School / Financial / Reports* (the signatories come pre-filled from the workbook). Then confirm the reporting formula and the allocation rule.

Never put the `service_role` key in a `VITE_*` variable or anywhere in the frontend.

## Migrating the workbook

Go to *Settings → Excel import* and upload `CANTEEN REPORT.xlsx`. Import the sheets in this order:

1. **DAILY SALES.** Each day block becomes a finalized historical record. Imported records do not change current inventory.
2. **EXPENSES & OTHER SALES.** Each row becomes a sale, expense or deficit transaction.
3. **SUMMARY.** Its figures are kept for reconciliation only, and Actual Money is attached to the matching day. Cash carry-overs are staged for review, because they need a date.

Every batch is staged first. You review the duplicates, invalid rows and rows that need review, then commit. *Reports → Workbook Reconciliation* compares the workbook's SUMMARY figures with the recalculated totals.

## Deploying to Vercel

1. Push the repository to GitHub. The `.gitignore` keeps `*.xlsx` and `.env*` out of the repository.
2. Import the repository in Vercel. The framework is detected as Vite, and `vercel.json` sets the SPA rewrites and security headers.
3. Add the environment variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
4. In Supabase, open *Authentication → URL Configuration* and add the Vercel URL as the Site URL.

## Roles

| Role | Default permissions | Can be granted |
|---|---|---|
| Administrator | everything | n/a |
| Canteen-in-Charge / Staff | record and finalize daily sales, record expenses/other sales, view reports | inventory management, stock-in, adjustments, corrections, funds, exports, audit, users, settings, import |
| Read-only Viewer | view reports | export, audit view (never any write permission) |

## Project layout

```
supabase/migrations/   schema, security helpers, business RPCs, reports/funds/import, RLS, seed
supabase/functions/    admin-users Edge Function
src/lib/               supabase client, queries, calc, periods, import parser, export engine
src/components/        UI primitives, layout, official report renderer
src/pages/             dashboard, inventory, daily-sales, finance, reports, funds, transactions, users, settings
tests/db/              PGlite acceptance tests for the database rules
tests/unit/            line maths + workbook parser tests
```
