# Operational change log

This log records dated migrations, temporary rollout requirements, and
remediation procedures. The README remains limited to evergreen setup and
repeatable operations.

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
