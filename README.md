# Point of sale server

Apollo GraphQL server with separate entry points for local development and the
AWS Lambda Node.js 24 runtime.

Pull requests run the complete test/package job and retain `function.zip` for
five days. The deployment job runs only on `main` and publishes the exact
artifact produced by that workflow run.

`yarn bundle:lambda` uses esbuild to produce a self-contained Node.js 24 bundle
at `lambda-package/dist/lambda.js`. Runtime dependencies, including the pinned
AWS SDK v3 clients, are bundled; Lambda does not rely on its mutable SDK copy.
The deployment zip contains only the bundle and its external source map.

## Local development

Configure an AWS CLI profile or standard AWS environment credentials, then
pull the server configuration from Parameter Store and start the server:

```sh
yarn install --frozen-lockfile
PROJECT_ENV=prod yarn params
yarn dev
```

`yarn params` writes `.env`, which is ignored by Git, and replaces it on each
run so deployed parameter changes can be pulled locally. It fails if any
required parameter is missing. Set `PARAMS_OUTPUT_FILE` to write elsewhere.

The local entry point is `src/index.ts`. `dotenv` loads `.env`, and the AWS SDK
uses its standard credential provider chain. This supports environment
credentials (including `AWS_SESSION_TOKEN`), `AWS_PROFILE`, and other standard
local AWS credential sources. A typical local `.env` contains non-secret
configuration like this:

```dotenv
AWS_REGION=us-east-1
AWS_DYNAMODB_TABLE=pos_system
COGNITO_USER_POOL_ID=us-east-1_example
COGNITO_USER_POOL_CLIENT_ID=exampleclientid
HOST=127.0.0.1
PORT=4000
```

Do not commit access keys. If environment credentials are necessary locally,
keep them only in the ignored `.env` file and include the session token when
using temporary credentials.

## Lambda

`src/lambda.ts` exports `handler` using Apollo's native API Gateway v2
integration. Terraform configures the deployed handler as
`dist/lambda.handler` and supplies:

- `AWS_DYNAMODB_TABLE`
- `COGNITO_USER_POOL_ID`
- `COGNITO_USER_POOL_CLIENT_ID`
- `TRUST_API_GATEWAY_JWT_AUTHORIZER=true`
- `NODE_ENV=production`
- AWS-generated region and temporary execution-role credentials

No application secret is currently required. GitHub Actions assumes only the
deployment role through OIDC; the running function uses its separate,
least-privilege Lambda execution role.

API Gateway validates Cognito access tokens before Lambda invocation. The
server also builds an authenticated GraphQL context from the signed authorizer
claims, resolves the user's DynamoDB business membership, and enforces `admin`
or `staff` roles in every resolver. Local standalone
execution validates bearer tokens directly against Cognito JWKS. Cognito—not
DynamoDB—is the source of truth for passwords, email, verification, and account
status. DynamoDB membership is authoritative for business and application
roles; Cognito groups are mirrored for frontend navigation but cannot grant
cross-business API access.

See Apollo's [AWS Lambda deployment
guide](https://www.apollographql.com/docs/apollo-server/deployment/lambda).

## Data model

The single DynamoDB table uses `partitionKey`/`sortKey` entity keys and one
sparse `AccessIndex` (`accessPartition`/`accessSort`) for the access patterns
the application needs: catalogs, stores, suppliers, purchase orders, receipts,
active lots, transfers, chronological sales, and stock movements. Strongly
consistent alias records make product and sale-variant SKU/barcode values, plus
category codes, unique without a
scan. A sale is one DynamoDB transaction containing its immutable receipt,
conditional FEFO lot decrements, and stock movement events.

Every business record and index partition starts with `TENANT#<tenant-id>#`.
An identity membership record maps a Cognito `sub` to exactly one business and
its roles. Resolvers derive the tenant exclusively from that authenticated
membership; no tenant ID is accepted from browser input. This isolates product
lookups, staff profiles, sales, receipts, audits, settings, dashboards, and
reports while retaining the existing table and indexes.

Receipts remain in DynamoDB and are fetched by sale ID for viewing or
reprinting. S3 is deliberately not used for generated receipt files: the
immutable sale record is the source of truth and the frontend renders the print
layout on demand. Cash sales store the tendered amount and calculated change;
M-Pesa sales store the validated transaction code. Product records can carry an
optional time-bounded promotion price, while every sale item permanently stores
the server-authoritative price and cost used at checkout.
M-Pesa codes also receive a conditional payment lookup record in the sale
transaction, preventing the same code from being accepted twice.

Admin-managed business name, address, phone, email, thank-you text, and return
policy are stored at `SETTINGS#BUSINESS/PROFILE`. Stores are separate entities
with their own inventory and optional receipt overrides. Checkout resolves the
store overrides over the global defaults and snapshots the effective result in
the immutable sale, so later branding or policy changes do not rewrite a reprint.
Cashier receipt labels prefer the employee code from the DynamoDB staff profile
and the first name from Cognito.

Cognito remains the identity source for first name, family name, email,
verification state, password, and enabled state. Application display names are
derived from the two Cognito name attributes. Employment metadata that is
owned by the business (`employeeCode`, `jobTitle`, primary/assigned stores, and a
non-authentication phone number) is stored in DynamoDB at
`USER#<cognito-sub>/PROFILE`. Staff can
change their own phone; an administrator manages employment fields and assigns
one primary plus additional active stores. Staff-selected store scope is checked
against those assignments on the server. Each new sale snapshots `storeId` and `storeName`, so moving a
staff member later does not alter historical store reporting.

Products expose a normal stock and pricing unit such as kilogram, litre, metre,
or tonne. Default buying and selling prices are per one of that unit. Inventory
transactions remain exact integers in a derived minor unit internally, so a
kilogram product may be sold as 500 g or 2.5 kg without floating-point stock.
Supplier catalog entries state both the order unit and its contents: for
example, one bag contains 25 kg or one bulk unit contains one tonne. Purchase
receipts derive the exact inventory conversion on the server. Variant prices
and identifiers are snapshotted on each sale line. Stock requisitions
optionally add request/approve/reject/convert states before the existing
dispatch-and-receive transfer workflow.

Changing a staff email updates the existing Cognito identity and requires the
new address to be verified; the stable Cognito `sub` means historical sales do
not need to be rewritten. Deleting staff removes their Cognito account,
membership, and active profile but deliberately retains immutable sales and
receipt snapshots for audit history.

## Seed the MVP catalog

Terraform creates the table and publishes its name to Parameter Store. The seed
loader only writes application records and never creates infrastructure:

```sh
export AWS_REGION=us-east-1
export AWS_PROFILE=my-profile # omit when using another standard AWS credential source
export AWS_DYNAMODB_TABLE="$(aws ssm get-parameter --name /prod/server/dynamodb-table-name --query Parameter.Value --output text)"
export POS_TENANT_ID='<workspace-id shown in Business setup>'
yarn seed:mvp

# Equivalent explicit form:
yarn seed:mvp --tenant='<workspace-id>'
```

The default dataset is generated deterministically from the version-controlled
specifications in `src/seed/mvp-catalog.ts` and `src/seed/mvp-supply-chain.ts`.
It contains 10 categories and 200 realistic Kenyan retail products with EAN-13
test barcodes, SKU values, KES buying and selling prices, units, expiry flags,
and 20 promotional prices for checkout testing. It also configures three
suppliers, 12 supplier catalog/package records, store reorder policies, and four
purchase orders demonstrating completed, partially received, issued, and draft
states. Accepted demo receipts create the inventory lots, costs, expiry dates,
and stock movements; the loader never creates anonymous opening stock.

Re-running the loader updates products and suppliers by their stable codes and
reuses its marked purchase orders instead of intentionally adding more demo
documents. Validate the full specification without AWS access:

```sh
yarn seed:mvp --validate-only
```

You can still pass a custom JSON seed file as the first argument.

Seeding always targets exactly one tenant. Categories, lookup aliases, products,
and seed audit records all receive that tenant's key prefix. It never
copies products to other businesses. A newly created business starts empty by
design; run the seed only for a chosen demo or test workspace.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for tenant boundaries, identity
ownership, DynamoDB access patterns, invitations, soft deletion, and deployment
decisions.
