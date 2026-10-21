# Financial rules and items for administrator confirmation

These rules were derived from `CANTEEN REPORT.xlsx` (sheets SUMMARY, DAILY SALES,
EXPENSES & OTHER SALES, TYPE OF FUNDS). Where the workbook was ambiguous, the
system preserves the source data and flags the rule for confirmation instead of
inventing a value.

## Rules implemented (from the workbook)

| Figure | Workbook source | System rule |
|---|---|---|
| Sales Amount | `DAILY SALES!G = E × F` | `sold_quantity × unit_price` (generated column) |
| Unsold Quantity | `H = D − F` | `total_quantity − sold_quantity` (generated column) |
| Unsold Amount | `I = E × H` | `unsold_quantity × unit_price` (generated column) |
| Share | `J = F` (a **quantity**) | `share_quantity`, defaults to sold quantity, editable |
| Daily Canteen Shares | `SUMMARY!D16 = 'DAILY SALES'!J15` (Σ SHARE) | Σ share quantity × **canteen share rate** (₱1.00, frozen per record at finalization) |
| Other Shares | `SUMMARY!E = SUMIF(nature="Sale")` | Σ posted *Sale* transactions **not** already included in daily sales |
| Gross Sales | `F = D + E` | Daily Canteen Shares + Other Shares |
| Expenses | `G = SUMIF(nature="Expense")` | Σ posted *Expense* transactions |
| Deficit | `H = SUMIF(nature="Deficit")` | Σ posted *Deficit* transactions — always a separate category |
| Net Sales | `I = F − (G + H)` | Gross − Expenses − Deficit (deficit deduction is a setting applied to **all** dates) |
| Remaining Money | `C54 = Net Sales + carry-over cash (C44:C46)` | Net Sales + posted cash carry-overs |
| Fund allocation | `S19:X19` percentages × `R27` (= carry-overs + Gross Sales) | Allocation rule *“Workbook allocation (SY 2025-2026)”*, basis **Gross Sales + carry-overs** |

Fund percentages found in the workbook: Supplementary Feeding Program 35%,
School Clinic Fund 5%, Faculty and Student Development Fund 15%,
H.E. Instructional Fund 10%, **School Operations Fund 25%**, **Revolving Capital 10%**
(total 100%). *Canteen Share* is listed in TYPE OF FUNDS but has no percentage,
so it is configured as **not allocatable**.

## Please confirm (shown as alerts until confirmed)

1. **Canteen share rate.** The workbook adds the SHARE quantities directly as pesos,
   which implies ₱1 per piece sold. Confirm the rate (Settings → Financial).
2. **Deficit in Net Sales.** The workbook subtracts deficits. Confirm that this is
   the approved treatment.
3. **Allocation base.** The workbook allocates percentages of *carry-over cash +
   Gross Sales* (₱37,972 in the sample) even though Net Sales for the period was
   negative (−₱18,845.60). Confirm or create a new rule (for example, basis = Net
   Sales) under Fund Allocation → Allocation rules.
4. **Actual Money.** The workbook records it, but no formula links it to the other
   figures (e.g. Mar 2: actual ₱7,348 vs. sales amount ₱6,748). The cash-variance
   alert is therefore **disabled** until the school defines the expected-cash rule.
5. **Stock purchases vs. expenses.** Recording stock-in does not create an expense
   unless “also record as expense” is ticked, so purchases already listed in
   EXPENSES & OTHER SALES are not counted twice.

## Data issues found in the workbook (flagged during import, not auto-fixed)

- **SUMMARY dates B16:B24** were stored by Excel as Feb 3, Mar 3, Apr 3 …
  (day/month swapped). The importer resolves each row's real date (Mar 2–12, 2026)
  from the daily block its formulas reference, and records a note.
- **DAILY SALES, Mar 2 — “Turon Saging”:** sold 37 of a total of 30 (negative unsold).
  The importer marks the row *Needs review*; that day is imported only after the
  quantities are corrected.
- The SUMMARY header says “DECEMBER 2025”, but the data covers March 2026.
- Rows with `0 / 0` quantities are skipped by default; an administrator can include them.

## Accounting notes

- Net Sales is a **sales balance**, not accounting profit (it doesn't deduct the cost of goods sold).
- Consignment collections (“Sales Amount” of consigned items) belong mostly to the
  consignees and are shown separately; they are not canteen revenue.
- Inventory value uses weighted-average cost by default (configurable).
