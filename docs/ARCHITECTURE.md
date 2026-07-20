# Point-of-sale architecture

## System boundary

The product is a multi-tenant SPA and GraphQL API:

- React/Vite is delivered by CloudFront from a private S3 bucket.
- Cognito owns authentication, passwords, verified email, `given_name`,
  `family_name`, and enabled state. Display names are derived from the two
  canonical name attributes.
- API Gateway validates access tokens before invoking Apollo Server on Lambda.
- DynamoDB stores tenant membership, authorization roles, business settings,
  catalog, stores, suppliers, purchasing, lot inventory, staff profiles,
  transfers, sales, and immutable stock movements.

The system currently supports one business membership per Cognito `sub`. This
keeps administration and authorization simple. Supporting a user in several
businesses later requires changing the membership key to include tenant ID and
adding an explicit workspace selector; it must not be implemented by trusting
a tenant ID supplied by the browser.

## Authentication and tenant authorization

Self-signup creates a verified Cognito identity with no application groups.
The only API operation available in that state is business onboarding.
Onboarding creates the identity membership, tenant profile, owner staff
profile, default business settings, and mirrored Cognito `admin`/`staff` groups.

On every API request, the server resolves membership from the authenticated
Cognito `sub`. DynamoDB membership roles are authoritative. Resolver arguments
never accept a tenant ID, which prevents a client from selecting another
business's partition.

An administrator invitation creates a new Cognito user and then the membership
and staff profile. If Cognito already contains the email, the invitation fails
with a clear conflict. Existing identities are never silently attached because
that would lack user consent and could attach an account that belongs to a
different business. A future multi-business join flow should use an expiring,
single-use invitation accepted by the signed-in recipient.

Changing email updates the existing Cognito identity, so the stable `sub`
continues to own historical sales. Cognito requires verification of the new
email. Deleting a staff account deletes Cognito login access and the active
membership/profile, while immutable sale and audit snapshots remain.

## DynamoDB table

| Key | Attribute |
| --- | --- |
| Primary partition | `partitionKey` |
| Primary sort | `sortKey` |
| Access index | `AccessIndex` |
| Index partition | `accessPartition` |
| Index sort | `accessSort` |

Application entities use a tenant prefix:

| Entity/access pattern | Key shape |
| --- | --- |
| Product | `TENANT#<id>#PRODUCT#<product-id>` |
| SKU/barcode alias | `TENANT#<id>#LOOKUP#<kind>#<value>` |
| Sale | `TENANT#<id>#SALE#<sale-id>` |
| Staff profile | `TENANT#<id>#USER#<cognito-sub>` |
| Business settings | `TENANT#<id>#SETTINGS#BUSINESS` |
| Ordered products | `TENANT#<id>#CATALOG#PRODUCT` on `AccessIndex` |
| Ordered sales | `TENANT#<id>#SALE` on `AccessIndex` |
| Ordered audits | `TENANT#<id>#AUDIT` on `AccessIndex` |
| Stores and suppliers | `TENANT#<id>#STORE` / `SUPPLIER` on `AccessIndex` |
| Purchase orders and receipts | `TENANT#<id>#PURCHASE_ORDER` / `GOODS_RECEIPT` on `AccessIndex` |
| Active inventory lots | `TENANT#<id>#INVENTORY#ACTIVE` on `AccessIndex` |
| Movements and transfers | `TENANT#<id>#STOCK#MOVEMENT` / `TRANSFER` on `AccessIndex` |

Conditional alias records make SKU, barcode, category code, and M-Pesa
transaction references unique inside a business. Checkout is a DynamoDB
transaction containing the immutable sale, conditional lot decrements,
payment reference, and stock movements. Oversized, highly fragmented lot
allocations are rejected before DynamoDB's 100-operation limit.

Changing the primary key attribute names requires DynamoDB table replacement.
This repository assumes a clean-data launch; there is no data migration or
legacy dual-read path.

## Stores, staff, and inventory

Stores are first-class tenant entities. Every staff profile belongs to one
active store. Staff inventory and checkout requests derive that store on the
server; administrators may explicitly select another store. Sales snapshot the
store ID and name. Stores cannot be deactivated while they own stock, assigned
staff, open purchase orders, or open transfers.

Products contain selling price, reference buying price, base unit, and expiry
behavior but never opening stock. Supplier-product records define purchase
units, pack conversions, supplier SKUs, quoted prices, and preferred suppliers.
Reorder point and target quantity are configured per store and product.

Purchase orders progress through draft, issued, partially received, completed,
closed, or cancelled. Accepted goods create costed supplier-origin lots;
damaged and rejected goods do not enter stock. Expiry-tracked products require
expiry dates. Checkout allocates unexpired lots by earliest expiry and then
receipt date (FEFO), and snapshots actual lot cost for margin reporting.

Transfers use dispatch and receipt states and preserve batch, expiry, supplier
origin, and cost. Damage, expiry, and physical counts operate on existing lots,
so positive counts cannot create anonymous stock. Inventory-changing commands
use client-generated idempotency keys and conditional DynamoDB transactions.

## Product lifecycle

Products are never physically deleted through the application. Archive sets
`status = inactive`: the item remains available to administrators and historic
receipts, but is excluded from staff catalog/POS queries and rejected by
checkout. Administrators may reactivate it from product editing.

Categories can be edited or deleted by administrators. Category name changes
and denormalized product category names are committed in one transaction. A
category cannot be deleted while any product, including an archived product,
still references it.

## Tenant-specific seed data

The seed command requires one workspace ID:

```sh
yarn seed:mvp --tenant='<workspace-id>'
```

The workspace ID is shown to administrators in Business setup. The loader
creates or updates only that tenant's catalog and pricing. It never creates
inventory. New inventory must enter through an accepted supplier receipt.

## Reporting

Sales queries are tenant-scoped and staff mode is additionally filtered by the
authenticated Cognito `sub`. Supply-chain reports support period, store,
supplier, and expiry-window filters across purchasing, receiving, valuation,
movements, expiry, losses, and transfers. The browser provides print/PDF and
CSV output.
