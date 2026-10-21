import { useMemo, useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Archive, ArchiveRestore, Boxes, FileSpreadsheet, UserRound, Eye, MoreHorizontal, PackagePlus, Pencil, Plus, Search, SlidersHorizontal, Tags, Truck } from 'lucide-react';
import { useAuth } from '@/providers/auth';
import { useApp } from '@/providers/app';
import { useCategories, useInventory } from '@/lib/queries';
import { peso, qty, toNumber, todayPH } from '@/lib/utils';
import { STOCK_STATUS_LABEL } from '@/lib/labels';
import type { InventoryItem } from '@/lib/types';
import { PageHeader } from '@/components/layout/AppShell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/form';
import { StockBadge } from '@/components/ui/badge';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/feedback';
import { Pagination, SortTH, Table, TD, TH, THead, TR, sortRows, type SortDir } from '@/components/ui/table';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/menu';
import { ConfirmDialog } from '@/components/ui/dialog';
import { FilterBar, FilterField, StatCard } from '@/components/shared';
import { ExportMenu, PrintableReport } from '@/components/OfficialReport';
import type { OfficialReport } from '@/lib/export/report';
import { AdjustDialog, ItemDialog, StockInDialog, useArchiveItem } from './dialogs';
import { CategoriesDialog, SuppliersDialog } from './reference-dialogs';
import { ConsigneesPanel } from './ConsigneesPanel';
import { StockBreakdown } from '@/pages/dashboard/details';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useConsignees, useProductTotals } from '@/lib/queries';

type SortKey = 'name' | 'delivered' | 'sold' | 'unit_cost' | 'selling_price' | 'stock_value';
const PAGE_SIZE_KEY = 'qnhs.productsPageSize';

export default function InventoryPage() {
  const { can } = useAuth();
  const { activeSchoolYear } = useApp();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [showArchived, setShowArchived] = useState(false);
  const { data: items = [], isLoading, error, refetch } = useInventory(showArchived);
  const { data: categories = [] } = useCategories();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [kind, setKind] = useState<'' | 'stock' | 'consigned'>(() => (['stock', 'consigned'].includes(params.get('kind') ?? '') ? (params.get('kind') as 'stock' | 'consigned') : ''));
  const [valueDetail, setValueDetail] = useState(false);
  const [consigneeId, setConsigneeId] = useState('');
  const { data: consignees = [] } = useConsignees();
  const tab = params.get('tab') ?? 'products';
  const status = params.get('status') ?? '';
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'name', dir: 'asc' });
  const [page, setPage] = useState(1);

  const [itemDialog, setItemDialog] = useState<{ open: boolean; item: InventoryItem | null; consigneeId?: string }>({ open: false, item: null });
  const [stockIn, setStockIn] = useState<{ open: boolean; itemId?: string }>({ open: false });
  const [adjust, setAdjust] = useState<InventoryItem | null>(null);
  const [archive, setArchive] = useState<InventoryItem | null>(null);
  const [refDialog, setRefDialog] = useState<'categories' | 'suppliers' | null>(null);
  const archiveItem = useArchiveItem();

  const { data: productTotals } = useProductTotals();
  // running totals: handed over to the canteen so far / sold so far
  const enriched = useMemo(
    () =>
      items.map((i) => {
        const t = productTotals?.get(i.id);
        return { ...i, delivered: toNumber(t?.delivered), sold: toNumber(t?.sold), days: t?.days ?? 0, last_sale_date: t?.last_sale_date ?? null };
      }),
    [items, productTotals],
  );
  // rows per page (0 = all), remembered on this browser
  const [pageSize, setPageSize] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem(PAGE_SIZE_KEY));
      return Number.isFinite(v) && v >= 0 && localStorage.getItem(PAGE_SIZE_KEY) !== null ? v : 15;
    } catch {
      return 15;
    }
  });
  const changePageSize = (n: number) => {
    setPageSize(n);
    try {
      localStorage.setItem(PAGE_SIZE_KEY, String(n));
    } catch {
      /* storage unavailable — applies to this visit only */
    }
  };
  const filterBarRef = useRef<HTMLDivElement>(null);
  const [filterBarHeight, setFilterBarHeight] = useState(0);
  useEffect(() => {
    const el = filterBarRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setFilterBarHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [tab]);
  // every filter except stock status — the Low / Out of stock cards set that one
  const beforeStatus = useMemo(() => {
    const s = search.trim().toLowerCase();
    return enriched.filter(
      (i) =>
        (!s || i.name.toLowerCase().includes(s) || i.item_code.toLowerCase().includes(s) || (i.supplier_name ?? '').toLowerCase().includes(s) || (i.consignee_name ?? '').toLowerCase().includes(s)) &&
        (!category || i.category_id === category) &&
        (!kind || (kind === 'consigned') === i.is_consigned) &&
        (!consigneeId || i.consignee_id === consigneeId) &&
        (showArchived ? !i.is_active : true),
    );
  }, [enriched, search, category, kind, consigneeId, showArchived]);
  const filtered = useMemo(
    () => sortRows(beforeStatus.filter((i) => !status || i.stock_status === status), sort.key, sort.dir),
    [beforeStatus, status, sort],
  );

  const pageRows = pageSize > 0 ? filtered.slice((page - 1) * pageSize, page * pageSize) : filtered;
  const totals = useMemo(
    () => ({
      // unaffected by clicking the Low / Out of stock cards
      value: beforeStatus.reduce((a, i) => a + toNumber(i.stock_value), 0),
      delivered: filtered.reduce((a, i) => a + i.delivered, 0),
      sold: filtered.reduce((a, i) => a + i.sold, 0),
      low: items.filter((i) => i.is_active && i.stock_status === 'low_stock').length,
      out: items.filter((i) => i.is_active && i.stock_status === 'out_of_stock').length,
    }),
    [beforeStatus, filtered, items],
  );
  const setStatus = (v: string) => {
    const p = new URLSearchParams(params);
    p.delete('tab');
    if (v) p.set('status', v);
    else p.delete('status');
    setParams(p, { replace: true });
    setPage(1);
  };
  const filtersActive = Boolean(search || category || kind || consigneeId || status || showArchived);

  const report = (): OfficialReport => ({
    title: 'Products & Consignees',
    period: `As of ${new Intl.DateTimeFormat('en-PH', { dateStyle: 'long' }).format(new Date(todayPH()))}`,
    schoolYear: activeSchoolYear?.name,
    filename: `QNHS-Products-${todayPH()}`,
    columns: [
      { key: 'name', header: 'Product', width: 28 },
      { key: 'type', header: 'Type / Consignee', width: 20 },
      { key: 'unit', header: 'Unit', width: 9 },
      { key: 'delivered', header: 'Total Delivered', format: 'qty', width: 13 },
      { key: 'sold', header: 'Total Sold', format: 'qty', width: 12 },
      { key: 'unit_cost', header: 'Cost Price', format: 'peso', width: 12 },
      { key: 'selling_price', header: 'Selling Price', format: 'peso', width: 12 },
      { key: 'stock_value', header: 'Stock Value', format: 'peso', width: 14 },
      { key: 'status', header: 'Status', width: 12 },
    ],
    rows: filtered.map((i) => ({ ...i, type: i.is_consigned ? `Consigned · ${i.consignee_name ?? ''}` : 'Canteen stock', status: STOCK_STATUS_LABEL[i.stock_status] })),
    totals: { name: 'TOTAL', delivered: totals.delivered, sold: totals.sold, stock_value: totals.value },
  });

  return (
    <>
      <div className="no-print">
        <PageHeader
          title="Products & Consignees"
          description="Everything sold through the canteen and the consignees who supply it. Stock of canteen-owned items changes only through stock-in, sales and recorded adjustments."
          actions={
            <>
              <ExportMenu report={report} disabled={filtered.length === 0} />
              {can('inventory.manage') && (
                <Menu>
                  <MenuTrigger asChild>
                    <Button variant="secondary" size="icon" aria-label="More">
                      <MoreHorizontal />
                    </Button>
                  </MenuTrigger>
                  <MenuContent>
                    {can('import.run') && (
                      <MenuItem icon={<FileSpreadsheet />} onSelect={() => navigate('/settings/import')}>
                        Load product list from Excel
                      </MenuItem>
                    )}
                    <MenuItem icon={<Tags />} onSelect={() => setRefDialog('categories')}>
                      Manage categories
                    </MenuItem>
                    <MenuItem icon={<Truck />} onSelect={() => setRefDialog('suppliers')}>
                      Manage suppliers
                    </MenuItem>
                  </MenuContent>
                </Menu>
              )}
              {can('inventory.stock_in') && (
                <Button variant="secondary" onClick={() => setStockIn({ open: true })}>
                  <PackagePlus /> Stock-in
                </Button>
              )}
              {can('inventory.manage') && (
                <Button onClick={() => setItemDialog({ open: true, item: null })}>
                  <Plus /> Add product
                </Button>
              )}
            </>
          }
        />

        <Tabs value={tab} onValueChange={(v) => setParams(v === 'products' ? {} : { tab: v }, { replace: true })}>
        <TabsList className="mb-5">
          <TabsTrigger value="products" icon={<Boxes />}>Products</TabsTrigger>
          <TabsTrigger value="consignees" icon={<UserRound />}>Consignees</TabsTrigger>
        </TabsList>
        <TabsContent value="consignees">
          <ConsigneesPanel onAddProduct={(id) => setItemDialog({ open: true, item: null, consigneeId: id })} />
        </TabsContent>
        <TabsContent value="products">
        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <StatCard label="Inventory value (filtered)" value={peso(totals.value)} icon={<Boxes />} sub={`Canteen stock only · ${beforeStatus.length} items`} onClick={() => setValueDetail(true)} active={valueDetail} />
          <StatCard label="Low stock" value={totals.low} icon={<SlidersHorizontal />} tone={totals.low ? 'warning' : 'default'} onClick={() => setStatus(status === 'low_stock' ? '' : 'low_stock')} active={status === 'low_stock'} sub="At or below reorder level" />
          <StatCard label="Out of stock" value={totals.out} icon={<Archive />} tone={totals.out ? 'negative' : 'default'} onClick={() => setStatus(status === 'out_of_stock' ? '' : 'out_of_stock')} active={status === 'out_of_stock'} sub="Zero or negative quantity" />
        </div>

        <Card>
          <div ref={filterBarRef} className="rounded-t-2xl bg-surface lg:sticky lg:top-16 lg:z-20 lg:shadow-[0_1px_0_rgb(var(--c-surface-border))]">
          <FilterBar
            active={filtersActive}
            onClear={() => {
              setSearch('');
              setCategory('');
              setKind('');
              setConsigneeId('');
              setStatus('');
              setShowArchived(false);
            }}
          >
            <FilterField label="Search" className="min-w-[220px] flex-1">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
                <Input className="pl-9" placeholder="Product, consignee or supplier" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
              </div>
            </FilterField>
            <FilterField label="Category">
              <Select value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }}>
                <option value="">All categories</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </FilterField>
            <FilterField label="Type">
              <Select value={kind} onChange={(e) => { setKind(e.target.value as typeof kind); setPage(1); }}>
                <option value="">All products</option>
                <option value="stock">Canteen stock</option>
                <option value="consigned">Consigned items</option>
              </Select>
            </FilterField>
            <FilterField label="Consignee">
              <Select value={consigneeId} onChange={(e) => { setConsigneeId(e.target.value); setPage(1); }}>
                <option value="">All consignees</option>
                {consignees.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </FilterField>
            <FilterField label="Stock status">
              <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">All statuses</option>
                <option value="in_stock">In Stock</option>
                <option value="low_stock">Low Stock</option>
                <option value="out_of_stock">Out of Stock</option>
              </Select>
            </FilterField>
            <FilterField label="Records">
              <Select value={showArchived ? 'archived' : 'active'} onChange={(e) => { setShowArchived(e.target.value === 'archived'); setPage(1); }}>
                <option value="active">Active items</option>
                <option value="archived">Archived items</option>
              </Select>
            </FilterField>
          </FilterBar>
          </div>

          {error ? (
            <ErrorState error={error} onRetry={() => refetch()} />
          ) : isLoading ? (
            <TableSkeleton cols={8} />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<Boxes />}
              title={items.length === 0 ? 'No products yet' : 'No items match your filters'}
              description={items.length === 0 ? 'Add products one by one, or load the whole list from the DAILY SALES sheet of your workbook.' : 'Try clearing the filters.'}
              action={items.length === 0 && can('inventory.manage') && (
                <div className="flex flex-wrap justify-center gap-2">
                  {can('import.run') && (
                    <Button asChild variant="secondary">
                      <Link to="/settings/import">
                        <FileSpreadsheet /> Load from Excel
                      </Link>
                    </Button>
                  )}
                  <Button onClick={() => setItemDialog({ open: true, item: null })}>
                    <Plus /> Add first product
                  </Button>
                </div>
              )}
            />
          ) : (
            <>
              <Table stickyHeader style={{ '--sticky-top': `${64 + filterBarHeight}px` } as React.CSSProperties}>
                <THead>
                  <tr>
                    <SortTH label="Product" sortKey="name" sort={sort} onSort={setSort} />
                    <TH>Unit</TH>
                    <SortTH label="Total delivered" sortKey="delivered" sort={sort} onSort={setSort} align="right" />
                    <SortTH label="Total sold" sortKey="sold" sort={sort} onSort={setSort} align="right" />
                    <SortTH label="Cost price" sortKey="unit_cost" sort={sort} onSort={setSort} align="right" />
                    <SortTH label="Selling price" sortKey="selling_price" sort={sort} onSort={setSort} align="right" />
                    <SortTH label="Stock value" sortKey="stock_value" sort={sort} onSort={setSort} align="right" />
                    <TH>Status</TH>
                    <TH align="right">
                      <span className="sr-only">Actions</span>
                    </TH>
                  </tr>
                </THead>
                <tbody>
                  {pageRows.map((i) => (
                    <TR key={i.id} onClick={() => navigate(`/inventory/${i.id}`)}>
                      <TD className="font-medium">
                        {i.name}
                        {i.is_consigned && <div className="text-xs font-normal text-ink-muted">Consignee: {i.consignee_name ?? '—'}</div>}
                      </TD>
                      <TD className="text-ink-muted">{i.unit}</TD>
                      <TD align="right" className="font-semibold" title={i.is_consigned ? 'Handed over by the consignee on all saved daily sales sheets' : 'Stock received by the canteen (opening + stock-in)'}>
                        {qty(i.delivered)}
                        {i.days > 0 && <div className="text-[11px] font-normal text-ink-muted">{i.days} day{i.days === 1 ? '' : 's'}</div>}
                      </TD>
                      <TD align="right" className="font-semibold text-brand-700" title="Sold on all saved daily sales sheets">
                        {qty(i.sold)}
                        {i.delivered > 0 && <div className="text-[11px] font-normal text-ink-muted">{Math.round((i.sold / i.delivered) * 100)}% sold</div>}
                      </TD>
                      <TD align="right">{peso(i.unit_cost)}</TD>
                      <TD align="right">{peso(i.selling_price)}</TD>
                      <TD align="right" className="font-medium">
                        {i.is_consigned ? <span className="font-normal text-ink-soft">—</span> : peso(i.stock_value)}
                      </TD>
                      <TD>{i.is_active ? <StockBadge status={i.stock_status} /> : <span className="text-xs text-ink-muted">Archived</span>}</TD>
                      <TD align="right" onClick={(e) => e.stopPropagation()}>
                        <Menu>
                          <MenuTrigger asChild>
                            <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${i.name}`}>
                              <MoreHorizontal />
                            </Button>
                          </MenuTrigger>
                          <MenuContent>
                            <MenuItem icon={<Eye />} onSelect={() => navigate(`/inventory/${i.id}`)}>
                              View details
                            </MenuItem>
                            {can('inventory.manage') && (
                              <MenuItem icon={<Pencil />} onSelect={() => setItemDialog({ open: true, item: i })}>
                                Edit
                              </MenuItem>
                            )}
                            {can('inventory.stock_in') && i.is_active && !i.is_consigned && (
                              <MenuItem icon={<PackagePlus />} onSelect={() => setStockIn({ open: true, itemId: i.id })}>
                                Record stock-in
                              </MenuItem>
                            )}
                            {can('inventory.adjust') && i.is_active && !i.is_consigned && (
                              <MenuItem icon={<SlidersHorizontal />} onSelect={() => setAdjust(i)}>
                                Adjust stock
                              </MenuItem>
                            )}
                            {can('inventory.manage') && (
                              <>
                                <MenuSeparator />
                                <MenuItem icon={i.is_active ? <Archive /> : <ArchiveRestore />} danger={i.is_active} onSelect={() => setArchive(i)}>
                                  {i.is_active ? 'Archive' : 'Restore'}
                                </MenuItem>
                              </>
                            )}
                          </MenuContent>
                        </Menu>
                      </TD>
                    </TR>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-surface-border bg-surface-page/80 font-semibold">
                    <TD colSpan={2}>Total ({filtered.length} products)</TD>
                    <TD align="right">{qty(totals.delivered)}</TD>
                    <TD align="right" className="text-brand-700">{qty(totals.sold)}</TD>
                    <TD colSpan={2} />
                    <TD align="right">{peso(totals.value)}</TD>
                    <TD colSpan={2} />
                  </tr>
                </tfoot>
              </Table>
              <Pagination page={page} pageSize={pageSize} total={filtered.length} onPage={setPage} onPageSize={changePageSize} />
            </>
          )}
        </Card>
        </TabsContent>
        </Tabs>
      </div>

      <PrintableReport report={filtered.length ? report() : null} />

      <ItemDialog open={itemDialog.open} item={itemDialog.item} initialConsigneeId={itemDialog.consigneeId} onOpenChange={(o) => setItemDialog((s) => ({ ...s, open: o }))} />
      <StockInDialog open={stockIn.open} itemId={stockIn.itemId} onOpenChange={(o) => setStockIn((s) => ({ ...s, open: o }))} />
      <AdjustDialog open={Boolean(adjust)} item={adjust} onOpenChange={(o) => !o && setAdjust(null)} />
      <StockBreakdown kind="inventory" open={valueDetail} onOpenChange={setValueDetail} />
      <CategoriesDialog open={refDialog === 'categories'} onOpenChange={(o) => !o && setRefDialog(null)} />
      <SuppliersDialog open={refDialog === 'suppliers'} onOpenChange={(o) => !o && setRefDialog(null)} />
      <ConfirmDialog
        open={Boolean(archive)}
        onOpenChange={(o) => !o && setArchive(null)}
        title={archive?.is_active ? `Archive ${archive?.name}?` : `Restore ${archive?.name}?`}
        description={
          archive?.is_active
            ? 'Archived items are hidden from daily sales and inventory lists. Their history is kept and they can be restored later.'
            : 'The item will appear again in inventory and daily sales.'
        }
        confirmLabel={archive?.is_active ? 'Archive' : 'Restore'}
        tone={archive?.is_active ? 'danger' : 'primary'}
        loading={archiveItem.isPending}
        onConfirm={() => archive && archiveItem.mutate({ id: archive.id, active: !archive.is_active }, { onSuccess: () => setArchive(null) })}
      />
    </>
  );
}
