import { useMemo, useState } from 'react';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useConsignees } from '@/lib/queries';

type SortKey = 'item_code' | 'name' | 'category_name' | 'quantity_on_hand' | 'unit_cost' | 'selling_price' | 'stock_value' | 'reorder_level';
const PAGE = 15;

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
  const [kind, setKind] = useState<'' | 'stock' | 'consigned'>('');
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

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    const rows = items.filter(
      (i) =>
        (!s || i.name.toLowerCase().includes(s) || i.item_code.toLowerCase().includes(s) || (i.supplier_name ?? '').toLowerCase().includes(s) || (i.consignee_name ?? '').toLowerCase().includes(s)) &&
        (!category || i.category_id === category) &&
        (!kind || (kind === 'consigned') === i.is_consigned) &&
        (!consigneeId || i.consignee_id === consigneeId) &&
        (!status || i.stock_status === status) &&
        (showArchived ? !i.is_active : true),
    );
    return sortRows(rows, sort.key, sort.dir);
  }, [items, search, category, kind, consigneeId, status, sort, showArchived]);

  const pageRows = filtered.slice((page - 1) * PAGE, page * PAGE);
  const totals = useMemo(
    () => ({
      value: filtered.reduce((a, i) => a + toNumber(i.stock_value), 0),
      low: items.filter((i) => i.is_active && i.stock_status === 'low_stock').length,
      out: items.filter((i) => i.is_active && i.stock_status === 'out_of_stock').length,
    }),
    [filtered, items],
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
    title: 'Canteen Inventory Report',
    period: `As of ${new Intl.DateTimeFormat('en-PH', { dateStyle: 'long' }).format(new Date(todayPH()))}`,
    schoolYear: activeSchoolYear?.name,
    filename: `QNHS-Inventory-${todayPH()}`,
    orientation: 'landscape',
    columns: [
      { key: 'item_code', header: 'Item Code', width: 12 },
      { key: 'name', header: 'Item Name', width: 28 },
      { key: 'category_name', header: 'Category', width: 12 },
      { key: 'type', header: 'Type / Consignee', width: 18 },
      { key: 'unit', header: 'Unit', width: 9 },
      { key: 'quantity_on_hand', header: 'Qty on Hand', format: 'qty', width: 12 },
      { key: 'unit_cost', header: 'Cost / Unit', format: 'peso', width: 12 },
      { key: 'selling_price', header: 'Selling Price', format: 'peso', width: 12 },
      { key: 'stock_value', header: 'Stock Value', format: 'peso', width: 14 },
      { key: 'reorder_level', header: 'Reorder Level', format: 'qty', width: 11 },
      { key: 'status', header: 'Status', width: 12 },
    ],
    rows: filtered.map((i) => ({ ...i, type: i.is_consigned ? `Consigned · ${i.consignee_name ?? ''}` : 'Canteen stock', status: STOCK_STATUS_LABEL[i.stock_status] })),
    totals: { item_code: 'TOTAL', stock_value: totals.value },
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
          <StatCard label="Inventory value (filtered)" value={peso(totals.value)} icon={<Boxes />} sub={`Canteen stock only · ${filtered.length} items shown`} />
          <StatCard label="Low stock" value={totals.low} icon={<SlidersHorizontal />} tone={totals.low ? 'warning' : 'default'} onClick={() => setStatus('low_stock')} sub="At or below reorder level" />
          <StatCard label="Out of stock" value={totals.out} icon={<Archive />} tone={totals.out ? 'negative' : 'default'} onClick={() => setStatus('out_of_stock')} sub="Zero or negative quantity" />
        </div>

        <Card>
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
                <Input className="pl-9" placeholder="Name, code or supplier" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
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
              <Table>
                <THead>
                  <tr>
                    <SortTH label="Code" sortKey="item_code" sort={sort} onSort={setSort} />
                    <SortTH label="Item" sortKey="name" sort={sort} onSort={setSort} />
                    <SortTH label="Category" sortKey="category_name" sort={sort} onSort={setSort} />
                    <TH>Unit</TH>
                    <SortTH label="On hand" sortKey="quantity_on_hand" sort={sort} onSort={setSort} align="right" />
                    <SortTH label="Cost price" sortKey="unit_cost" sort={sort} onSort={setSort} align="right" />
                    <SortTH label="Price" sortKey="selling_price" sort={sort} onSort={setSort} align="right" />
                    <SortTH label="Stock value" sortKey="stock_value" sort={sort} onSort={setSort} align="right" />
                    <SortTH label="Reorder" sortKey="reorder_level" sort={sort} onSort={setSort} align="right" />
                    <TH>Status</TH>
                    <TH align="right">
                      <span className="sr-only">Actions</span>
                    </TH>
                  </tr>
                </THead>
                <tbody>
                  {pageRows.map((i) => (
                    <TR key={i.id} onClick={() => navigate(`/inventory/${i.id}`)}>
                      <TD className="font-mono text-xs text-ink-muted">{i.item_code}</TD>
                      <TD className="font-medium">
                        {i.name}
                        {i.is_consigned && <div className="text-xs font-normal text-ink-muted">Consignee: {i.consignee_name ?? '—'}</div>}
                      </TD>
                      <TD className="text-ink-muted">{i.category_name ?? '—'}</TD>
                      <TD className="text-ink-muted">{i.unit}</TD>
                      <TD align="right" className="font-semibold">
                        {i.is_consigned ? <span className="font-normal text-ink-soft">—</span> : qty(i.quantity_on_hand)}
                      </TD>
                      <TD align="right">{peso(i.unit_cost)}</TD>
                      <TD align="right">{peso(i.selling_price)}</TD>
                      <TD align="right" className="font-medium">
                        {i.is_consigned ? <span className="font-normal text-ink-soft">—</span> : peso(i.stock_value)}
                      </TD>
                      <TD align="right" className="text-ink-muted">
                        {i.is_consigned ? '—' : qty(i.reorder_level)}
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
              </Table>
              <Pagination page={page} pageSize={PAGE} total={filtered.length} onPage={setPage} />
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
