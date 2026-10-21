import { useEffect, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BadgeCheck, Boxes, CalendarRange, Calculator, FileSpreadsheet, FileText, Plus, RefreshCw, School, Trash2, Upload } from 'lucide-react';
import { SyncPanel } from './SyncPanel';
import { useAuth } from '@/providers/auth';
import { rpc, supabase, unwrap } from '@/lib/supabase';
import { keys, useAction, useSchoolYears, useSettings } from '@/lib/queries';
import { ADJUSTMENT_TYPES } from '@/lib/labels';
import { formatDate, formatDateTime, toNumber } from '@/lib/utils';
import type { SchoolSettings, Signatory } from '@/lib/types';
import { PageHeader } from '@/components/layout/AppShell';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, Select, Switch } from '@/components/ui/form';
import { Badge } from '@/components/ui/badge';
import { Callout, Skeleton } from '@/components/ui/feedback';
import { Table, TD, TH, THead, TR } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ConfirmDialog } from '@/components/ui/dialog';

const SETTINGS_KEYS = [keys.settings, keys.reports, keys.alerts, keys.audit];

export default function SettingsPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? (can('settings.manage') ? 'school' : 'import');
  const { data: settings, isLoading } = useSettings();
  return (
    <>
      <PageHeader title="Settings" description="School information, reporting rules and configuration. Every change is recorded in the audit log." />
      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v }, { replace: true })}>
        <TabsList className="mb-5">
          {can('settings.manage') && (
            <>
              <TabsTrigger value="school" icon={<School />}>School</TabsTrigger>
              <TabsTrigger value="financial" icon={<Calculator />}>Financial</TabsTrigger>
              <TabsTrigger value="inventory" icon={<Boxes />}>Inventory</TabsTrigger>
              <TabsTrigger value="reports" icon={<FileText />}>Reports</TabsTrigger>
              <TabsTrigger value="years" icon={<CalendarRange />}>School years</TabsTrigger>
            </>
          )}
          {can('import.run') && <TabsTrigger value="import" icon={<RefreshCw />}>Data migration & sync</TabsTrigger>}
        </TabsList>
        {isLoading || !settings ? (
          <Skeleton className="h-96" />
        ) : (
          <>
            <TabsContent value="school"><SchoolTab s={settings} /></TabsContent>
            <TabsContent value="financial"><FinancialTab s={settings} /></TabsContent>
            <TabsContent value="inventory"><InventoryTab s={settings} /></TabsContent>
            <TabsContent value="reports"><ReportsTab s={settings} /></TabsContent>
            <TabsContent value="years"><YearsTab /></TabsContent>
            <TabsContent value="import">
              <SyncPanel />
              <Card>
                <CardHeader title="Step-by-step import (advanced)" description="Choose one sheet, preview and fix rows one by one before importing — or map the columns of any other sheet that lists expenses or other sales." icon={<FileSpreadsheet />} />
                <CardBody>
                  <Button asChild variant="secondary">
                    <Link to="/settings/import"><Upload /> Open the import wizard & import history</Link>
                  </Button>
                </CardBody>
              </Card>
            </TabsContent>
          </>
        )}
      </Tabs>
    </>
  );
}

function useSettingsForm(s: SchoolSettings) {
  const [f, setF] = useState<SchoolSettings>(s);
  useEffect(() => setF(s), [s]);
  const save = useAction((patch: Partial<SchoolSettings>) => rpc('update_settings', { p: patch }), { success: 'Settings saved.', invalidate: SETTINGS_KEYS });
  return { f, setF, save };
}

function SaveBar({ onSave, loading }: { onSave: () => void; loading: boolean }) {
  return (
    <div className="flex justify-end border-t border-surface-border px-5 py-3">
      <Button onClick={onSave} loading={loading}>Save changes</Button>
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-2 border-b border-surface-border px-5 py-4 last:border-0 md:grid-cols-[280px_1fr] md:gap-6">
      <div>
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="mt-0.5 text-xs leading-relaxed text-ink-muted">{hint}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}

function SchoolTab({ s }: { s: SchoolSettings }) {
  const { f, setF, save } = useSettingsForm(s);
  const fields: [keyof SchoolSettings, string][] = [
    ['school_name', 'School name'],
    ['school_id_no', 'School ID'],
    ['division', 'Division / district'],
    ['region', 'Region'],
    ['header_line1', 'Header line 1'],
    ['header_line2', 'Header line 2'],
    ['address', 'Address'],
    ['phone', 'Phone'],
    ['email', 'Email'],
    ['logo_url', 'School logo URL'],
  ];
  return (
    <Card>
      <CardHeader title="School information" description="Used in the official report header." />
      {fields.map(([k, label]) => (
        <Row key={k} label={label} hint={k === 'logo_url' ? 'Path or URL of the logo image (default /logos/qnhs.png).' : undefined}>
          <Input value={String(f[k] ?? '')} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
        </Row>
      ))}
      <SaveBar loading={save.isPending} onSave={() => save.mutate(Object.fromEntries(fields.map(([k]) => [k, f[k]])))} />
    </Card>
  );
}

function FinancialTab({ s }: { s: SchoolSettings }) {
  const { f, setF, save } = useSettingsForm(s);
  const [confirm, setConfirm] = useState(false);
  const confirmFormula = useAction(() => rpc('confirm_financial_formula'), { success: 'Financial reporting formula confirmed.', invalidate: SETTINGS_KEYS, onSuccess: () => setConfirm(false) });
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Financial reporting formula"
          description="One formula is applied consistently to every date."
          actions={s.formula_confirmed_at ? <Badge tone="green"><BadgeCheck className="size-3" /> Confirmed {formatDateTime(s.formula_confirmed_at)}</Badge> : <Badge tone="gold">Awaiting confirmation</Badge>}
        />
        <CardBody className="space-y-3">
          <div className="rounded-xl bg-surface-page p-4 font-mono text-[13px] leading-7">
            Daily Canteen Shares = Σ share quantity × ₱{toNumber(f.canteen_share_rate).toFixed(2)}
            <br />
            Other Shares = Σ posted “Sale” transactions not already in daily sales
            <br />
            Gross Sales = Daily Canteen Shares + Other Shares
            <br />
            Net Sales = Gross Sales − Expenses{f.deduct_deficit_in_net ? ' − Deficit' : ''}
          </div>
          <Callout tone="info" title="Source of these rules">
            Taken from CANTEEN REPORT.xlsx: SUMMARY!D = 'DAILY SALES' SHARE total (₱1 per piece sold), SUMMARY!F = D + E, SUMMARY!I = F − (G + H). Changing a rule requires re-confirmation; finalized daily sales keep the share rate they were finalized with.
          </Callout>
          {!s.formula_confirmed_at && (
            <Button variant="gold" onClick={() => setConfirm(true)}>
              <BadgeCheck /> Confirm formula as approved by the school
            </Button>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Rules" />
        <Row label="Canteen share rate (₱ per share unit)" hint="Workbook value: ₱1.00 per piece sold. Applies to records finalized after the change.">
          <Input type="number" min={0} step="0.01" prefix="₱" className="max-w-[180px]" value={String(f.canteen_share_rate)} onChange={(e) => setF({ ...f, canteen_share_rate: e.target.value })} />
        </Row>
        <Row label="Deduct deficits from Net Sales" hint="Workbook: Net = Gross − (Expenses + Deficit). Deficits always stay a separate category.">
          <Switch checked={f.deduct_deficit_in_net} onChange={(v) => setF({ ...f, deduct_deficit_in_net: v })} label="Deduct deficits" />
        </Row>
        <Row label="Cash variance check" hint="Optional alert comparing Actual Money with an expected amount. The workbook does not define this rule; leave disabled until the school approves one.">
          <Select className="max-w-sm" value={f.cash_variance_basis} onChange={(e) => setF({ ...f, cash_variance_basis: e.target.value as SchoolSettings['cash_variance_basis'] })}>
            <option value="disabled">Disabled</option>
            <option value="sales_amount">Actual money vs. total daily sales amount</option>
            <option value="net_cash_flow">Actual money vs. sales amount + other sales − expenses − deficit</option>
          </Select>
        </Row>
        <Row label="Currency">
          <Input value="Philippine peso (PHP, ₱)" disabled className="max-w-sm" />
        </Row>
        <SaveBar
          loading={save.isPending}
          onSave={() => save.mutate({ canteen_share_rate: f.canteen_share_rate, deduct_deficit_in_net: f.deduct_deficit_in_net, cash_variance_basis: f.cash_variance_basis })}
        />
      </Card>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Confirm the financial reporting formula?"
        description="Confirm only after the principal / canteen committee has approved how gross sales, expenses, deficits and net sales are computed. The confirmation is recorded with your name."
        confirmLabel="Confirm formula"
        loading={confirmFormula.isPending}
        onConfirm={() => confirmFormula.mutate(undefined)}
      />
    </div>
  );
}

function InventoryTab({ s }: { s: SchoolSettings }) {
  const { f, setF, save } = useSettingsForm(s);
  return (
    <Card>
      <CardHeader title="Inventory settings" />
      <Row label="Valuation method" hint="Used for unit cost when stock is received and for total inventory value.">
        <Select className="max-w-sm" value={f.inventory_valuation} onChange={(e) => setF({ ...f, inventory_valuation: e.target.value as SchoolSettings['inventory_valuation'] })}>
          <option value="weighted_average">Weighted-average cost</option>
          <option value="latest_cost">Latest purchase cost</option>
        </Select>
      </Row>
      <Row label="Default reorder level" hint="Pre-filled for new items.">
        <Input type="number" min={0} className="max-w-[160px]" value={String(f.default_reorder_level)} onChange={(e) => setF({ ...f, default_reorder_level: e.target.value })} />
      </Row>
      <Row label="Permitted stock adjustments">
        <div className="grid gap-2 sm:grid-cols-2">
          {ADJUSTMENT_TYPES.map((t) => (
            <Checkbox
              key={t.value}
              checked={f.permitted_adjustments.includes(t.value)}
              onChange={(v) => setF({ ...f, permitted_adjustments: v ? [...f.permitted_adjustments, t.value] : f.permitted_adjustments.filter((x) => x !== t.value) })}
              label={t.label}
            />
          ))}
        </div>
      </Row>
      <Row label="Expiration tracking" hint="Show expiration dates and alert before items expire.">
        <div className="flex items-center gap-4">
          <Switch checked={f.expiration_tracking} onChange={(v) => setF({ ...f, expiration_tracking: v })} label="Expiration tracking" />
          <span className="text-sm text-ink-muted">Warn</span>
          <Input type="number" min={0} max={365} className="w-20" value={f.expiry_warning_days} onChange={(e) => setF({ ...f, expiry_warning_days: Number(e.target.value) })} />
          <span className="text-sm text-ink-muted">days before</span>
        </div>
      </Row>
      <Row label="Unusual adjustment alert" hint="Adjustments at or above this value or share of stock are flagged on the dashboard.">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Input type="number" min={0} prefix="₱" className="w-32" value={String(f.unusual_adjustment_value)} onChange={(e) => setF({ ...f, unusual_adjustment_value: e.target.value })} />
          <span className="text-ink-muted">or</span>
          <Input type="number" min={0} max={100} className="w-24" value={String(f.unusual_adjustment_pct)} onChange={(e) => setF({ ...f, unusual_adjustment_pct: e.target.value })} />
          <span className="text-ink-muted">% of stock</span>
        </div>
      </Row>
      <Row label="School days" hint="Used to detect missing daily sales records.">
        <div className="flex flex-wrap gap-3">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, i) => (
            <Checkbox key={d} checked={f.school_days.includes(i + 1)} onChange={(v) => setF({ ...f, school_days: v ? [...f.school_days, i + 1].sort() : f.school_days.filter((x) => x !== i + 1) })} label={d} />
          ))}
        </div>
      </Row>
      <Row label="Missing-record lookback (days)">
        <Input type="number" min={1} max={120} className="w-24" value={f.missing_sales_lookback_days} onChange={(e) => setF({ ...f, missing_sales_lookback_days: Number(e.target.value) })} />
      </Row>
      <SaveBar
        loading={save.isPending}
        onSave={() =>
          save.mutate({
            inventory_valuation: f.inventory_valuation,
            default_reorder_level: f.default_reorder_level,
            permitted_adjustments: f.permitted_adjustments,
            expiration_tracking: f.expiration_tracking,
            expiry_warning_days: f.expiry_warning_days,
            unusual_adjustment_value: f.unusual_adjustment_value,
            unusual_adjustment_pct: f.unusual_adjustment_pct,
            school_days: f.school_days,
            missing_sales_lookback_days: f.missing_sales_lookback_days,
          })
        }
      />
    </Card>
  );
}

function ReportsTab({ s }: { s: SchoolSettings }) {
  const { f, setF, save } = useSettingsForm(s);
  const setSig = (i: number, patch: Partial<Signatory>) => setF({ ...f, signatories: f.signatories.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  return (
    <Card>
      <CardHeader title="Report settings" description="Official header lines are edited in the School tab." />
      <Row label="Authorized signatories" hint="Printed at the bottom of every official report and export.">
        <div className="space-y-2">
          {f.signatories.map((sig, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[130px_1fr_1fr_auto]">
              <Input value={sig.label} onChange={(e) => setSig(i, { label: e.target.value })} placeholder="Prepared by:" />
              <Input value={sig.name} onChange={(e) => setSig(i, { name: e.target.value })} placeholder="Full name" />
              <Input value={sig.position} onChange={(e) => setSig(i, { position: e.target.value })} placeholder="Position" />
              <Button variant="ghost" size="icon" aria-label="Remove signatory" onClick={() => setF({ ...f, signatories: f.signatories.filter((_, j) => j !== i) })}>
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button variant="secondary" size="sm" onClick={() => setF({ ...f, signatories: [...f.signatories, { label: 'Approved by:', name: '', position: '' }] })}>
            <Plus /> Add signatory
          </Button>
        </div>
      </Row>
      <Row label="Include signatories in exports">
        <Switch checked={f.export_include_signatories} onChange={(v) => setF({ ...f, export_include_signatories: v })} label="Include signatories" />
      </Row>
      <Row label="Report number prefix">
        <Input className="max-w-xs" value={f.report_number_prefix ?? ''} onChange={(e) => setF({ ...f, report_number_prefix: e.target.value })} />
      </Row>
      <Row label="Default report period">
        <Select className="max-w-xs" value={f.default_report_period} onChange={(e) => setF({ ...f, default_report_period: e.target.value as SchoolSettings['default_report_period'] })}>
          <option value="today">Today</option>
          <option value="this_week">This week</option>
          <option value="this_month">This month</option>
          <option value="this_quarter">This quarter</option>
          <option value="school_year">School year</option>
        </Select>
      </Row>
      <SaveBar
        loading={save.isPending}
        onSave={() =>
          save.mutate({
            signatories: f.signatories.filter((x) => x.name.trim()),
            export_include_signatories: f.export_include_signatories,
            report_number_prefix: f.report_number_prefix,
            default_report_period: f.default_report_period,
          })
        }
      />
    </Card>
  );
}

function YearsTab() {
  const { data: years = [] } = useSchoolYears();
  const [f, setF] = useState({ name: '', start_date: '', end_date: '' });
  const add = useAction(async () => unwrap(await supabase.from('school_years').insert(f).select('id').single()), {
    success: 'School year added.',
    invalidate: [keys.schoolYears],
    onSuccess: () => setF({ name: '', start_date: '', end_date: '' }),
  });
  const activate = useAction((id: string) => rpc('set_active_school_year', { p_id: id }), { success: 'Active school year changed.', invalidate: [keys.schoolYears, keys.dailySales, keys.finance, keys.alerts] });
  return (
    <Card>
      <CardHeader title="School years" description="Records are tagged with the school year that contains their date." />
      <CardBody>
        <form className="mb-5 grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]" onSubmit={(e) => { e.preventDefault(); add.mutate(undefined); }}>
          <Field label="Name"><Input placeholder="2027-2028" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} pattern="\d{4}-\d{4}" required /></Field>
          <Field label="Start"><Input type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} required /></Field>
          <Field label="End"><Input type="date" value={f.end_date} min={f.start_date} onChange={(e) => setF({ ...f, end_date: e.target.value })} required /></Field>
          <div className="flex items-end"><Button type="submit" loading={add.isPending}><Plus /> Add</Button></div>
        </form>
      </CardBody>
      <Table>
        <THead><tr><TH>School year</TH><TH>Start</TH><TH>End</TH><TH>Status</TH><TH /></tr></THead>
        <tbody>
          {years.map((y) => (
            <TR key={y.id}>
              <TD className="font-medium">SY {y.name}</TD>
              <TD>{formatDate(y.start_date)}</TD>
              <TD>{formatDate(y.end_date)}</TD>
              <TD>{y.is_active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</TD>
              <TD align="right">{!y.is_active && <Button size="sm" variant="secondary" onClick={() => activate.mutate(y.id)}>Set active</Button>}</TD>
            </TR>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

