# Point-of-sale architecture

## System boundary

The product is a multi-tenant SPA and GraphQL API:

- React/Vite is delivered by CloudFront from a private S3 bucket.
- Cognito owns authentication, passwords, verified email, `given_name`,
  `family_name`, and enabled state. Display names are derived from the two
  canonical name attributes.
- API Gateway validates access tokens before invoking Apollo Server on Lambda.
- DynamoDB stores tenant membership, authorization roles, business settings,
  catalog, inventory, staff employment profiles, sales, and audits.

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

Conditional alias records make SKU, barcode, category code, and M-Pesa
transaction references unique inside a business. Checkout is a DynamoDB
transaction containing the immutable sale, conditional stock decrements,
payment reference, and stock audit events.

Changing the primary key attribute names requires DynamoDB table replacement.
This repository assumes a clean-data launch; there is no data migration or
legacy dual-read path.

## Business configuration and staff

Business settings store receipt branding and a flat department list, but their
mutations update separate attributes to prevent stale branding forms from
overwriting department changes. Invite/edit forms use the department list as a
dropdown, and the API rejects values outside it. Renaming a department and its
staff assignments is atomic; deletion is rejected while a staff profile still
uses it. Sales snapshot the seller's department so later reassignment does not
rewrite historical reports.

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
creates or updates only that tenant's catalog. It preserves current stock on
existing products and applies opening stock only to newly created products.

## Reporting

Sales queries are tenant-scoped and staff mode is additionally filtered by the
authenticated Cognito `sub`. Period reports aggregate immutable sale snapshots;
current stock reports read current product state. Price changes and stock
adjustments come from audit events. CSV/PDF generation occurs in the browser
for the bounded result set returned by the API.
