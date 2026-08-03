# Operational change log

This log records dated migrations, temporary rollout requirements, and
remediation procedures. The README remains limited to evergreen setup and
repeatable operations.

## 2026-08-03 — Tenant billing rollout

### What changed

Tenant workspaces now carry a Biashara or Biashara Plus subscription, a
14-day trial, manual M-Pesa payment submissions, immutable billing documents,
server-side plan enforcement, superadmin review APIs, and daily reminders.

### Required rollout

Apply infrastructure with billing enforcement disabled, deploy this server,
and run `yarn migrate:billing --rollout-date=YYYY-MM-DD` once with operator AWS
credentials. The migration is idempotent and assigns Plus to existing VAT,
multi-store, or six-plus-user workspaces. Provision a verified Cognito user in
the `superadmin` group, deploy the compatible client, verify every tenant is
listed in Platform Billing, then enable enforcement in Terraform. Existing
tenants are marked `legacy-pending-*` for legal-acceptance history; this must
not be represented as affirmative acceptance of the new policies.

### Verification, recovery, and status

Confirm trial dates, plan selection, limits, restricted staff access, admin
read/export access, payment approval, receipt generation, and one manual worker
invocation. To recover, disable `billing_enforcement_enabled`; this also
disables the schedule without deleting billing records. Do not delete payment,
document, reference, or audit items. Legal and tax review plus real vendor and
Till configuration are required before enforcement. Status: implementation
complete; production activation pending configuration, migration, and review.

## 2026-08-03 — Human-readable generated master-data codes

### What changed

Blank category, supplier, store, employee, product, and product-unit codes now
receive short tenant-scoped identifiers. Atomic counters produce codes such as
`CAT-000001` and `SUP-000001`; explicitly supplied codes remain unchanged.

### Deployment and verification

Deploy the server before the matching client. No existing records are rewritten
and counter gaps after a failed create are harmless. Create each supported
record with a blank code and verify the returned prefix and numeric sequence.
Rollback restores mandatory manual entry but should not remove sequence items or
alter codes already assigned. Status: active.

## 2026-08-02 — Checkout policy settings and audited markdowns

### What changed

A new additive checkout-settings record controls enabled payment methods, the
default method, required customer names, and capped staff markdowns. Sale
creation enforces these policies server-side and snapshots both the effective
catalog price and any accepted override with its reason. A single audit event
is committed atomically when a sale contains overrides.

### Deployment and verification

Deploy the server before the compatible client. Existing businesses need no
migration and inherit Cash and M-Pesa, Cash as the default, optional customer
names, disabled staff markdowns, and a 10% dormant cap. Verify disabled-method
rejection, customer validation, staff cap enforcement, administrator overrides,
VAT recalculation, and retry idempotency.

### Recovery and status

The checkout-settings item can be removed to restore safe defaults; completed
sale snapshots and audits remain immutable. Status: active.

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
