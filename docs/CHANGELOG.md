# Operational change log

This log records dated migrations, temporary rollout requirements, and
remediation procedures. The README remains limited to evergreen setup and
repeatable operations.

## 2026-08-02 — Lightweight accounting and Kenyan VAT

### What changed

New workspaces can declare Kenyan VAT registration, classify products as
standard-rated, zero-rated, or exempt, snapshot inclusive VAT on sales and
receipts, and manage supplier invoices with partial payments. Appointed agents
can also calculate the 2% withholding-VAT deduction on supplier settlements.

### Deployment and verification

This release targets clean installations and deliberately performs no historic
tax reconstruction. Deploy the server before the client, create a VAT-enabled
workspace, receive a mixed-rate supplier order, complete a sale, and verify the
Money summary, printed VAT breakdown, partial-payment balance, and WHVAT split.

VAT and input-VAT values are management estimates. This release does not submit
to eTIMS, file a VAT return, or record WHVAT remittance.

### Recovery and status

Disable VAT for future transactions if setup is incorrect; transaction tax
snapshots remain immutable. Status: active.

## 2026-08-02 — Product-specific units and exact lot costing

### What changed

Package labels moved to business configuration, exact package conversions moved
to product units, and supplier products now reference those units. Inventory
lots also retain exact KES minor-unit value alongside legacy unit cost fields.

### Why

Universal conversions such as “crate equals 30 items” are incorrect across
products. Product-level conversion trees keep purchasing, selling, inventory,
and margin calculations consistent without changing historical document
snapshots.

### Affected deployments and data

Existing workspaces may contain sale variants and supplier-package records that
do not yet have product-unit identifiers. Historical sales, purchase orders,
receipts, lots, and stock movements must remain unchanged.

### Required action

Deploy the compatible backend before the product-unit client, then run once for
each existing workspace:

```sh
yarn migrate:product-units '<workspace-id>'
```

The command is idempotent and may be rerun after an interrupted attempt.

### Verification

- Open representative count and measured products and confirm their selling and
  purchasing units.
- Confirm supplier associations select the expected product unit.
- Create a draft PO and verify its snapshotted package name and base quantity.
- Confirm stock valuation matches the sum of remaining lot values.

### Recovery

Do not rewrite historical documents. If a generated product unit is incorrect,
correct or deactivate it in Product Setup and relink the supplier for future
orders. Existing PO snapshots remain authoritative.

### Status

Active until every existing workspace has been migrated and verified.
