// Database acceptance tests: run with `npm run test:db`.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createDb } from './harness.mjs';

let db, admin, staff, viewer, outsider;
const num = (v) => Number(v);

async function rejects(promise, pattern) {
  await assert.rejects(promise, (e) => {
    assert.match(e.message, pattern);
    return true;
  });
}

before(async () => {
  db = await createDb();
  admin = await db.createUser('admin@qnhs.test', 'admin');
  staff = await db.createUser('staff@qnhs.test', 'staff');
  viewer = await db.createUser('viewer@qnhs.test', 'viewer', { permissions: ['finance.record', 'reports.export'] });
  outsider = randomUUID();
  await db.sql(`insert into auth.users (id, email, raw_user_meta_data) values ($1, 'new@qnhs.test', '{"role":"admin","full_name":"Sneaky"}')`, [outsider]);
});

// ------------------------------------------------------------------ auth
test('sign-up metadata cannot grant roles; new users are inactive viewers', async () => {
  const [p] = await db.sql('select role, is_active, full_name from public.profiles where id = $1', [outsider]);
  assert.equal(p.role, 'viewer');
  assert.equal(p.is_active, false);
  assert.equal(p.full_name, 'Sneaky');
  assert.deepEqual(await db.as(outsider, 'select * from public.inventory_items'), []);
  assert.deepEqual(await db.as(outsider, 'select * from public.school_settings'), []);
});

test('viewer never receives write permissions even if granted', async () => {
  const [{ my_permissions }] = await db.as(viewer, 'select public.my_permissions()');
  assert.ok(my_permissions.includes('reports.view'));
  assert.ok(my_permissions.includes('reports.export'));
  assert.ok(!my_permissions.includes('finance.record'));
  await rejects(
    db.as(viewer, `select public.create_financial_transaction('{"transaction_date":"2026-03-02","transaction_type":"expense","description":"x","amount":5}')`),
    /permission/);
});

test('users cannot escalate their own profile', async () => {
  await rejects(db.as(staff, `update public.profiles set role = 'admin' where id = auth.uid()`), /permission denied/);
  await rejects(db.as(staff, `insert into public.user_permissions (user_id, permission) values (auth.uid(), 'users.manage')`), /permission denied/);
  await rejects(db.as(staff, `select public.admin_update_user(auth.uid(), 'x', null, 'admin', true, '{}')`), /permission/);
});

test('admin cannot demote the last active administrator', async () => {
  await rejects(db.as(admin, `select public.admin_update_user($1, 'Admin', null, 'staff', true, '{}')`, [admin]), /own role/);
});

// ------------------------------------------------------------- inventory
let rice, coke;
test('create inventory item records opening stock in the ledger', async () => {
  [{ create_inventory_item: rice }] = await db.as(admin, `select public.create_inventory_item($1)`, [{
    item_code: 'fd-001', name: 'Rice', unit: 'cup', initial_quantity: 50, unit_cost: 8, selling_price: 10, reorder_level: 10,
  }]);
  const [item] = await db.sql('select * from public.inventory_items where id = $1', [rice]);
  assert.equal(item.item_code, 'FD-001');
  assert.equal(num(item.quantity_on_hand), 50);
  assert.equal(num(item.stock_value), 400);
  const ledger = await db.sql('select * from public.inventory_transactions where item_id = $1', [rice]);
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].transaction_type, 'opening');
});

test('staff and viewers cannot create items; nobody edits quantity directly', async () => {
  await rejects(db.as(staff, `select public.create_inventory_item('{"item_code":"X","name":"X","unit":"pc"}')`), /permission/);
  await rejects(db.as(admin, `update public.inventory_items set quantity_on_hand = 999 where id = $1`, [rice]), /permission denied|cannot be edited/);
  await rejects(db.sql(`update public.inventory_items set quantity_on_hand = 999 where id = $1`, [rice]), /cannot be edited directly/);
  await rejects(db.as(admin, `select public.create_inventory_item('{"item_code":"fd-001","name":"Dup","unit":"pc"}')`), /already used/);
});

test('stock-in increases quantity, uses weighted-average cost and is idempotent', async () => {
  const key = randomUUID();
  const payload = { item_id: rice, quantity: 50, unit_cost: 10, date_received: '2026-03-01', reference_no: 'OR-1', idempotency_key: key };
  const [a] = await db.as(admin, 'select public.record_stock_in($1) as id', [payload]);
  const [b] = await db.as(admin, 'select public.record_stock_in($1) as id', [payload]);
  assert.equal(a.id, b.id, 'duplicate submission returns the same receipt');
  const [item] = await db.sql('select quantity_on_hand, unit_cost from public.inventory_items where id = $1', [rice]);
  assert.equal(num(item.quantity_on_hand), 100);
  assert.equal(num(item.unit_cost), 9); // (50*8 + 50*10) / 100
  await rejects(db.as(staff, 'select public.record_stock_in($1)', [{ ...payload, idempotency_key: randomUUID() }]), /permission/);
});

test('adjustments require a reason and update stock through the ledger', async () => {
  await rejects(db.as(admin, `select public.adjust_stock($1, 'spoiled', 2, '')`, [rice]), /reason/);
  await db.as(admin, `select public.adjust_stock($1, 'spoiled', 2, 'Rice went sour')`, [rice]);
  await db.as(admin, `select public.adjust_stock($1, 'count_correction', 97, 'Physical count')`, [rice]);
  const [item] = await db.sql('select quantity_on_hand from public.inventory_items where id = $1', [rice]);
  assert.equal(num(item.quantity_on_hand), 97);
  await rejects(db.as(admin, `select public.adjust_stock($1, 'missing', 500, 'lost')`, [rice]), /Insufficient stock/);
});

// ----------------------------------------------------------- daily sales
let sale1;
test('daily sales: generated amounts and validation', async () => {
  [{ coke }] = await db.as(admin, `select public.create_inventory_item($1) as coke`, [{
    item_code: 'DR-001', name: 'Coke', unit: 'bottle', initial_quantity: 5, unit_cost: 15, selling_price: 20, reorder_level: 6,
  }]);
  await rejects(db.as(staff, 'select public.save_daily_sale(null, $1, null, null, $2)', ['2026-03-02', [
    { item_name: 'Turon Saging', consignee: 'Chaii', total_quantity: 30, unit_price: 15, sold_quantity: 37 },
  ]]), /exceeds total quantity/);

  const [{ save_daily_sale }] = await db.as(staff, 'select public.save_daily_sale(null, $1, $2, null, $3)', ['2026-03-02', 7348, [
    { item_name: 'Hot cake', consignee: 'Judy Ann', total_quantity: 37, unit_price: 10, sold_quantity: 28 },
    { inventory_item_id: rice, consignee: 'Naval', total_quantity: 17, sold_quantity: 17 }, // price from inventory
    { inventory_item_id: coke, consignee: 'Naval', total_quantity: 5, unit_price: 20, sold_quantity: 4 },
  ]]);
  sale1 = save_daily_sale.id;
  const lines = await db.sql('select * from public.daily_sale_items where daily_sale_id = $1 order by line_no', [sale1]);
  assert.deepEqual(lines.map((l) => num(l.sales_amount)), [280, 170, 80]);
  assert.deepEqual(lines.map((l) => num(l.unsold_quantity)), [9, 0, 1]);
  assert.deepEqual(lines.map((l) => num(l.unsold_amount)), [90, 0, 20]);
  assert.deepEqual(lines.map((l) => num(l.share_quantity)), [28, 17, 4], 'SHARE defaults to SOLD quantity');
  assert.equal(lines[1].item_name_snapshot, 'Rice');
  assert.equal(num(lines[1].unit_price), 10);

  await rejects(db.as(staff, 'select public.save_daily_sale(null, $1, null, null, $2)', ['2026-03-02', []]), /already exists/);
  await rejects(db.as(staff, 'select public.save_daily_sale($1, $2, null, null, $3, 99)', [sale1, '2026-03-02', []]), /changed by another user/);
});

test('finalizing deducts inventory exactly once; reopen reverses auditable', async () => {
  const qty = async (id) => num((await db.sql('select quantity_on_hand from public.inventory_items where id = $1', [id]))[0].quantity_on_hand);
  await db.as(staff, 'select public.finalize_daily_sale($1)', [sale1]);
  assert.equal(await qty(rice), 80);
  assert.equal(await qty(coke), 1);
  await rejects(db.as(staff, 'select public.finalize_daily_sale($1)', [sale1]), /already finalized/);
  await rejects(db.as(staff, 'select public.save_daily_sale($1, $2, null, null, $3)', [sale1, '2026-03-02', []]), /finalized/);
  await rejects(db.as(staff, `select public.reopen_daily_sale($1, 'typo')`, [sale1]), /permission/);

  await db.as(admin, `select public.reopen_daily_sale($1, 'Wrong sold count for Coke')`, [sale1]);
  assert.equal(await qty(rice), 97);
  assert.equal(await qty(coke), 5);
  await db.as(admin, `select public.finalize_daily_sale($1)`, [sale1]);
  assert.equal(await qty(rice), 80);

  const recon = await db.sql(`select item_name, reconciled, sold from public.report_inventory_movement('2026-03-01', '2026-03-31')`);
  assert.ok(recon.every((r) => r.reconciled), 'ledger reconciles with quantity on hand');
  assert.equal(num(recon.find((r) => r.item_name === 'Rice').sold), 17, 'reversal nets out in movement report');
  const audit = await db.sql(`select action from public.audit_logs where entity_id = $1 order by id`, [sale1]);
  assert.ok(audit.some((a) => a.action === 'reopen_daily_sale'));
});

test('negative stock requires an administrator exception with a reason', async () => {
  const [{ save_daily_sale: s }] = await db.as(staff, 'select public.save_daily_sale(null, $1, null, null, $2)', ['2026-03-03', [
    { inventory_item_id: coke, total_quantity: 3, unit_price: 20, sold_quantity: 3 },
  ]]);
  await rejects(db.as(staff, 'select public.finalize_daily_sale($1)', [s.id]), /Insufficient stock/);
  await rejects(db.as(staff, `select public.finalize_daily_sale($1, true, 'counted wrong')`, [s.id]), /permission/);
  await db.as(admin, `select public.finalize_daily_sale($1, true, 'Delivery not yet encoded')`, [s.id]);
  const [t] = await db.sql(`select is_exception, balance_after from public.inventory_transactions where reference_id in
     (select id from public.daily_sale_items where daily_sale_id = $1)`, [s.id]);
  assert.equal(t.is_exception, true);
  assert.equal(num(t.balance_after), -2);
});

// -------------------------------------------------- finance & reporting
test('consolidated report reproduces the workbook formula (March 2, 2026)', async () => {
  // Workbook day: share units 567 → Daily Canteen Shares 567; Other Shares 1096;
  // Expenses 544; Deficit 0 → Gross 1663; Net 1119.
  await db.as(admin, `select public.reopen_daily_sale($1, 'test fixture')`, [sale1]);
  await db.as(admin, 'select public.save_daily_sale($1, $2, $3, null, $4)', [sale1, '2026-03-02', 7348, [
    { item_name: 'All consigned items', total_quantity: 900, unit_price: 10, sold_quantity: 567 },
  ]]);
  await db.as(admin, 'select public.finalize_daily_sale($1)', [sale1]);
  const tx = (type, description, amount, extra = {}) =>
    db.as(staff, 'select public.create_financial_transaction($1) as id', [{
      transaction_date: '2026-03-02', transaction_type: type, description, amount, requested_by: 'Canteen-in-charge', ...extra }]);
  await tx('expense', '2 Gallons of water', 60);
  await tx('expense', 'Rice 4 kilos', 246);
  await tx('expense', 'Sir Villaver Sud-an', 38);
  await tx('expense', 'Judy Ann transpo', 200);
  await tx('sale', 'Canteen Share', 40);
  await tx('sale', 'Rice', 460);
  await tx('sale', 'Iced water', 140);
  await tx('sale', 'Canteen Share', 456);
  await tx('sale', 'Already in daily sheet', 999, { included_in_daily_sales: true }); // must NOT count
  const [{ id: wrong }] = await tx('expense', 'Typo', 1000);
  await rejects(db.as(viewer, `select public.reverse_financial_transaction($1, 'x')`, [wrong]), /permission/);
  await db.as(staff, `select public.reverse_financial_transaction($1, 'Entered twice')`, [wrong]); // own same-day

  const [r] = await db.sql(`select * from public.report_daily_summary('2026-03-02', '2026-03-02')`);
  assert.equal(num(r.daily_canteen_shares), 567);
  assert.equal(num(r.other_shares), 1096);
  assert.equal(num(r.gross_sales), 1663);
  assert.equal(num(r.expenses), 544);
  assert.equal(num(r.deficit), 0);
  assert.equal(num(r.net_sales), 1119);
  assert.equal(num(r.actual_money), 7348);
  assert.equal(num(r.included_sales), 999);
});

test('deficits stay separate and the deduction rule applies to all dates', async () => {
  await db.as(staff, 'select public.create_financial_transaction($1)', [{
    transaction_date: '2026-03-04', transaction_type: 'deficit', description: 'Deficit', amount: 173, requested_by: 'Canteen In-charge/Vendor' }]);
  let [r] = await db.sql(`select * from public.report_daily_summary('2026-03-04', '2026-03-04')`);
  assert.equal(num(r.deficit), 173);
  assert.equal(num(r.expenses), 0);
  assert.equal(num(r.net_sales), -173);
  await db.as(admin, `select public.confirm_financial_formula()`);
  await db.as(admin, `select public.update_settings('{"deduct_deficit_in_net": false}')`);
  [r] = await db.sql(`select * from public.report_daily_summary('2026-03-04', '2026-03-04')`);
  assert.equal(num(r.net_sales), 0);
  const [s] = await db.sql('select formula_confirmed_at from public.school_settings');
  assert.equal(s.formula_confirmed_at, null, 'changing the formula requires re-confirmation');
  await db.as(admin, `select public.update_settings('{"deduct_deficit_in_net": true}')`);
  await rejects(db.as(staff, `select public.update_settings('{"canteen_share_rate": 5}')`), /permission/);
});

test('edits by others require finance.correct and a reason', async () => {
  const [{ id }] = await db.as(admin, 'select public.create_financial_transaction($1) as id', [{
    transaction_date: '2026-03-05', transaction_type: 'expense', description: 'Plastic water', amount: 60 }]);
  await rejects(db.as(staff, `select public.update_financial_transaction($1, '{"amount": 70}')`, [id]), /own entries/);
  await db.sql(`update public.financial_transactions set created_at = now() - interval '3 days' where id = $1`, [id]);
  await rejects(db.as(admin, `select public.update_financial_transaction($1, '{"amount": 70}')`, [id]), /reason/);
  await db.as(admin, `select public.update_financial_transaction($1, '{"amount": 70}', 'Receipt says 70')`, [id]);
  const [log] = await db.sql(`select old_values, new_values, context from public.audit_logs
     where entity_type = 'financial_transactions' and entity_id = $1 and action = 'update' order by id desc limit 1`, [id]);
  assert.equal(log.old_values.amount, 60);
  assert.equal(log.new_values.amount, 70);
  assert.equal(log.context, 'Receipt says 70');
  await rejects(db.as(staff, `insert into public.financial_transactions (transaction_date, transaction_type, description, amount) values ('2026-03-05','sale','x',1)`), /permission denied/);
});

// ---------------------------------------------------------------- funds
test('fund allocation follows the workbook rule and cannot double-allocate', async () => {
  await db.as(admin, 'select public.create_cash_carryover($1)', [{ entry_date: '2026-03-01', description: 'January - cash', amount: 4952 }]);
  const [{ preview_fund_allocation: p }] = await db.as(admin, `select public.preview_fund_allocation('2026-03-01', '2026-03-31')`);
  assert.equal(p.rule.basis, 'gross_plus_carryover');
  assert.equal(num(p.total_percentage), 100);
  const base = num(p.totals.gross_sales) + num(p.totals.carryover);
  assert.equal(num(p.base_amount), base);
  const sfp = p.lines.find((l) => l.name === 'Supplementary Feeding Program');
  assert.equal(num(sfp.amount), Math.round(base * 35) / 100);

  await rejects(db.as(staff, `select public.run_fund_allocation('2026-03-01', '2026-03-31')`), /permission/);
  const [{ run_fund_allocation: run }] = await db.as(admin, `select public.run_fund_allocation('2026-03-01', '2026-03-31')`);
  await rejects(db.as(admin, `select public.run_fund_allocation('2026-03-15', '2026-04-15')`), /already been allocated/);

  const sfpId = sfp.fund_category_id;
  await rejects(db.as(admin, 'select public.record_fund_transaction($1)', [{
    fund_category_id: sfpId, transaction_type: 'expenditure', amount: 999999, transaction_date: '2026-03-31', description: 'Too much' }]), /Insufficient balance/);
  await db.as(admin, 'select public.record_fund_transaction($1)', [{
    fund_category_id: sfpId, transaction_type: 'expenditure', amount: 100, transaction_date: '2026-03-31', description: 'Feeding supplies' }]);
  const funds = await db.sql(`select * from public.fund_summary('2026-03-01', '2026-03-31')`);
  const f = funds.find((x) => x.code === 'SFP');
  assert.equal(num(f.closing_balance), num(sfp.amount) - 100);
  assert.equal(num(f.expenditures), 100);
  await rejects(db.sql(`delete from public.fund_transactions where fund_category_id = $1`, [sfpId]), /cannot be deleted/);
  await db.as(admin, `select public.reverse_fund_transaction(id, 'test') from public.fund_transactions where transaction_type = 'expenditure'`);
  await db.as(admin, `select public.reverse_fund_allocation($1, 'Recompute after corrections')`, [run]);
  assert.equal(num((await db.sql(`select public.fund_balance($1) as b`, [sfpId]))[0].b), 0);
});

test('activated allocation rules are immutable and new rules are validated', async () => {
  const [{ id: rule }] = await db.sql(`select id from public.allocation_rules where status = 'active'`);
  await rejects(db.sql(`update public.allocation_rule_lines set percentage = 50 where rule_id = $1`, [rule]), /cannot be changed/);
  const funds = await db.sql(`select id, code from public.fund_categories order by sort_order`);
  const [{ save_allocation_rule: draft }] = await db.as(admin, 'select public.save_allocation_rule(null, $1)', [{
    name: 'Next SY', effective_from: '2026-06-01', basis: 'net_sales',
    lines: funds.filter((f) => f.code !== 'CS').map((f) => ({ fund_category_id: f.id, percentage: 10 })) }]);
  await rejects(db.as(admin, 'select public.activate_allocation_rule($1)', [draft]), /total 60%, not 100%/);
});

// ------------------------------------------------------- audit & import
test('audit log is readable only with audit.view and is immutable', async () => {
  assert.deepEqual(await db.as(staff, 'select * from public.audit_logs limit 1'), []);
  assert.ok((await db.as(admin, 'select count(*)::int as n from public.audit_logs'))[0].n > 10);
  await rejects(db.as(admin, 'delete from public.audit_logs'), /permission denied/);
  await rejects(db.sql('delete from public.audit_logs'), /permanent/);
});

test('import: duplicates are detected and historical sales do not touch inventory', async () => {
  const before = (await db.sql('select sum(quantity_on_hand) as q from public.inventory_items'))[0].q;
  const rows = [
    { row_ref: 'E!B20', status: 'valid', mapped: { transaction_date: '2026-02-27', transaction_type: 'expense', description: '2 Gallons of water', requested_by: 'Canteen-in-charge', amount: 60, occurrence: 1 } },
    { row_ref: 'E!B21', status: 'review', mapped: { transaction_date: '2026-02-27', transaction_type: 'expense', description: 'Unclear', amount: 10, occurrence: 1 } },
  ];
  const [{ stage_import: b1 }] = await db.as(admin, 'select public.stage_import($1, $2)', [{ file_name: 'CANTEEN REPORT.xlsx', sheet_name: 'EXPENSES & OTHER SALES', target: 'financial_transactions' }, rows]);
  const [{ commit_import_batch: res }] = await db.as(admin, 'select public.commit_import_batch($1)', [b1]);
  assert.equal(res.imported, 1);
  assert.equal(res.review, 1);
  const [{ stage_import: b2 }] = await db.as(admin, 'select public.stage_import($1, $2)', [{ file_name: 'CANTEEN REPORT.xlsx', sheet_name: 'EXPENSES & OTHER SALES', target: 'financial_transactions' }, rows.slice(0, 1)]);
  const [dup] = await db.sql('select status from public.import_rows where batch_id = $1', [b2]);
  assert.equal(dup.status, 'duplicate');

  const [{ stage_import: b3 }] = await db.as(admin, 'select public.stage_import($1, $2)', [{ file_name: 'CANTEEN REPORT.xlsx', sheet_name: 'DAILY SALES', target: 'daily_sales' }, [
    { row_ref: 'D!B17', group_key: '2026-02-27', status: 'valid', mapped: { sale_date: '2026-02-27', line_no: 1, item_name: 'Rice', consignee: 'Naval', total_quantity: 17, unit_price: 10, sold_quantity: 17 } },
  ]]);
  await db.as(admin, 'select public.commit_import_batch($1)', [b3]);
  const [ds] = await db.sql(`select * from public.v_daily_sales where sale_date = '2026-02-27'`);
  assert.equal(ds.status, 'finalized');
  assert.equal(ds.inventory_posted, false);
  assert.equal(num(ds.sales_amount), 170);
  assert.equal((await db.sql('select sum(quantity_on_hand) as q from public.inventory_items'))[0].q, before);
  await rejects(db.as(staff, 'select public.stage_import($1, $2)', [{ file_name: 'x', sheet_name: 'y', target: 'daily_sales' }, []]), /permission/);
});

test('alerts come from real data', async () => {
  const alerts = await db.as(staff, 'select * from public.get_alerts()');
  const keys = alerts.map((a) => a.alert_key);
  // coke: 5 − 3 (exception sale → −2) + 4 (reopened sale1 no longer sells coke) = 2 ≤ reorder 6
  assert.ok(keys.some((k) => k.startsWith('low:' + coke)), 'coke is low on stock');
  assert.ok(alerts.some((a) => a.title.startsWith('Negative-stock exception')));
  assert.ok(keys.includes('formula'));
  assert.ok(!alerts.some((a) => a.category === 'discrepancy' && a.title.startsWith('Stock ledger mismatch')));
  assert.deepEqual(await db.as(outsider, 'select * from public.get_alerts()'), []);
});

test('dashboard metrics and ledger view work for staff', async () => {
  const [{ dashboard_metrics: m }] = await db.as(staff, `select public.dashboard_metrics('2026-03-01', '2026-03-31')`);
  assert.equal(num(m.items_low_stock), 1);
  assert.equal(num(m.items_out_of_stock), 0);
  assert.equal(num(m.daily_canteen_shares), 567 + 3, 'Mar 2 (567 shares) + Mar 3 exception sale (3 shares)');
  assert.ok(num(m.inventory_value) > 0);
  const ledger = await db.as(staff, `select kind, ref_no from public.v_transaction_ledger order by created_at desc limit 50`);
  assert.ok(ledger.some((l) => l.kind === 'daily_sale'));
  assert.ok(ledger.some((l) => l.kind === 'stock_in'));
  assert.ok(ledger.some((l) => l.kind === 'inventory_spoiled'));
});

// ------------------------------------------------------- consigned items
test('consigned items are sold through daily sales but never touch stock', async () => {
  const [{ import_products: res }] = await db.as(admin, 'select public.import_products($1)', [[
    { name: 'Hot cake', consignee: 'Judy Ann', selling_price: 10 },
    { name: 'Manok', consignee: 'Jean', selling_price: 11 },
    { name: 'Spaghetti', consignee: 'Judy Ann', selling_price: 20 },
    { name: 'Hot cake', consignee: 'Judy Ann', selling_price: 10 }, // duplicate in list
  ]]);
  assert.deepEqual(res, { created: 3, skipped: 1, new_consignees: 2 });
  const [{ import_products: again }] = await db.as(admin, 'select public.import_products($1)', [[{ name: 'hot cake', consignee: 'judy ann', selling_price: 10 }]]);
  assert.equal(again.created, 0, 're-running the import never duplicates');

  const [hc] = await db.sql(`select * from public.v_inventory_items where name = 'Hot cake'`);
  assert.equal(hc.is_consigned, true);
  assert.equal(hc.consignee_name, 'Judy Ann');
  assert.equal(hc.stock_status, 'consigned');
  assert.match(hc.item_code, /^CN-\d{4}$/);

  await rejects(db.as(admin, 'select public.record_stock_in($1)', [{ item_id: hc.id, quantity: 5, unit_cost: 7, date_received: '2026-03-01' }]), /consigned item/);
  await rejects(db.as(admin, `select public.adjust_stock($1, 'damaged', 1, 'x')`, [hc.id]), /consigned item/);
  await rejects(db.sql(`update public.inventory_items set is_consigned = false, consignee_id = null where id = $1`, [hc.id]).then(() =>
    db.sql(`update public.inventory_items set is_consigned = true where id = $1`, [hc.id])), /consignee/);
  await db.sql(`update public.inventory_items set is_consigned = true, consignee_id = (select id from public.consignees where name = 'Judy Ann') where id = $1`, [hc.id]);

  const [{ save_daily_sale: s }] = await db.as(staff, 'select public.save_daily_sale(null, $1, null, null, $2)', ['2026-03-06', [
    { inventory_item_id: hc.id, consignee: 'Judy Ann', total_quantity: 37, sold_quantity: 28 },
  ]]);
  await db.as(staff, 'select public.finalize_daily_sale($1)', [s.id]);
  const [line] = await db.sql('select posted_txn_id, sales_amount from public.daily_sale_items where daily_sale_id = $1', [s.id]);
  assert.equal(line.posted_txn_id, null);
  assert.equal(num(line.sales_amount), 280);
  assert.equal(num((await db.sql('select quantity_on_hand from public.inventory_items where id = $1', [hc.id]))[0].quantity_on_hand), 0);
  const alerts = await db.as(staff, 'select alert_key from public.get_alerts()');
  assert.ok(!alerts.some((a) => a.alert_key.includes(hc.id)), 'no stock alerts for consigned items');
  await rejects(db.as(staff, `insert into public.consignees (name) values ('Sneaky')`), /row-level security|permission/);
});
