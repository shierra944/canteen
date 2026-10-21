-- =====================================================================
-- Migration 6: reference data taken from CANTEEN REPORT.xlsx
-- (no transactions, no fake figures — only configuration)
-- =====================================================================

insert into public.school_settings (id) values (1);

-- Workbook header: "SY: 2025-2026"
insert into public.school_years (name, start_date, end_date, is_active) values
  ('2025-2026', '2025-06-16', '2026-05-31', false),
  ('2026-2027', '2026-06-01', '2027-05-31', true);

insert into public.permissions (code, description, is_write, sort_order) values
  ('reports.view',               'View dashboard and financial reports', false, 10),
  ('reports.export',             'Export / print reports (Excel, PDF, CSV)', false, 11),
  ('audit.view',                 'View the audit log', false, 12),
  ('sales.record',               'Create and edit draft daily sales records', true, 20),
  ('sales.finalize',             'Finalize daily sales (deducts inventory)', true, 21),
  ('sales.correct',              'Reopen finalized daily sales for correction', true, 22),
  ('finance.record',             'Record expenses, other sales and deficits', true, 30),
  ('finance.correct',            'Correct or reverse posted financial transactions; manage cash carry-overs', true, 31),
  ('inventory.manage',           'Add, edit and archive inventory items, categories and suppliers', true, 40),
  ('inventory.stock_in',         'Record stock received', true, 41),
  ('inventory.adjust',           'Record stock adjustments and reverse stock receipts', true, 42),
  ('inventory.negative_exception','Authorise documented negative-stock exceptions', true, 43),
  ('funds.manage',               'Run fund allocations, record fund expenditures, edit allocation rules', true, 50),
  ('users.manage',               'Manage user accounts and permissions', true, 60),
  ('settings.manage',            'Change school, financial, inventory and report settings', true, 61),
  ('import.run',                 'Import historical records from Excel', true, 62);

insert into public.inventory_categories (name, description) values
  ('Food', 'Cooked food, snacks and baked goods'),
  ('Drinks', 'Beverages and bottled water'),
  ('Supplies', 'Napkins, tissue, wipes and other supplies'),
  ('Other', 'Other merchandise');

-- Workbook "NATURE OF ITEM" is the transaction type; categories add detail.
insert into public.financial_categories (transaction_type, name, sort_order) values
  ('sale', 'Canteen Share', 1),            -- e.g. "Canteen Share | Sale | Renren"
  ('sale', 'Canteen Product Sale', 2),     -- e.g. "Rice", "Iced water"
  ('sale', 'Other Revenue', 3),
  ('expense', 'Ingredients & Food Supplies', 1),  -- e.g. "Rice 4 kilos"
  ('expense', 'Water & Utilities', 2),            -- e.g. "2 Gallons of water"
  ('expense', 'Packaging & Disposables', 3),      -- e.g. "Plastic water"
  ('expense', 'Salaries & Wages', 4),             -- e.g. "Chaii Salary"
  ('expense', 'Transportation', 5),               -- e.g. "Judy Ann transpo"
  ('expense', 'Meals & Representation', 6),
  ('expense', 'Stock Purchases', 7),
  ('expense', 'Other Expense', 99),
  ('deficit', 'Cash Shortage', 1),
  ('deficit', 'Vendor Deficit', 2);

-- Workbook sheet TYPE OF FUNDS (order preserved)
insert into public.fund_categories (code, name, sort_order, is_allocatable, description) values
  ('SFP', 'Supplementary Feeding Program', 1, true, null),
  ('SCF', 'School Clinic Fund', 2, true, null),
  ('FSDF', 'Faculty and Student Development Fund', 3, true, null),
  ('HEIF', 'H.E. Instructional Fund', 4, true, null),
  ('SOF', 'School Operations Fund', 5, true, null),
  ('RC', 'Revolving Capital', 6, true, null),
  ('CS', 'Canteen Share', 7, false,
   'Listed in TYPE OF FUNDS but has no percentage in the SUMMARY allocation table. Not allocated until an administrator sets a rule.');

-- Allocation rule exactly as in SUMMARY!S19:X19 and R27 (= cash carry-overs
-- + gross sales). Activated but UNCONFIRMED: an alert asks an
-- administrator to confirm the basis and percentages.
do $$
declare
  v_rule uuid;
begin
  insert into public.allocation_rules (name, effective_from, basis, notes)
  values ('Workbook allocation (SY 2025-2026)', '2025-06-16', 'gross_plus_carryover',
          'Imported from CANTEEN REPORT.xlsx SUMMARY sheet: percentages S19:X19; base R27 = carry-over cash (C44:C46) + Gross Sales (C52). Confirm with the school before relying on it.')
  returning id into v_rule;

  insert into public.allocation_rule_lines (rule_id, fund_category_id, percentage)
  select v_rule, id, pct from (values
    ('SFP', 35), ('SCF', 5), ('FSDF', 15), ('HEIF', 10), ('SOF', 25), ('RC', 10)) as v(code, pct)
  join public.fund_categories f using (code);

  update public.allocation_rules set status = 'active', activated_at = now() where id = v_rule;
end
$$;
