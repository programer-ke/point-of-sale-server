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

Local commands are unchanged:

```sh
yarn install --frozen-lockfile
yarn dev
```

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
claims and enforces `admin` or `staff` roles in every resolver. Local standalone
execution validates bearer tokens directly against Cognito JWKS. Cognito—not
DynamoDB—is the source of truth for passwords, groups, email verification, and
account status.

See Apollo's [AWS Lambda deployment
guide](https://www.apollographql.com/docs/apollo-server/deployment/lambda).

## Data model

The single DynamoDB table uses `PK`/`SK` entity keys and one sparse, overloaded
`GSI1` for the access patterns the MVP actually needs: ordered products and
categories, chronological sales, and chronological audit events. Strongly
consistent alias records make SKU, barcode, and category code unique without a
scan. A sale is one DynamoDB transaction containing its immutable receipt,
conditional stock decrements, and per-product audit events.

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
policy are stored at `SETTINGS#BUSINESS/PROFILE`. Updating them writes an audit
event. New sales snapshot those settings into the immutable receipt so later
branding or policy changes do not rewrite historical customer records;
pre-branding historical sales fall back to the current settings.
Cashier receipt labels prefer the employee code from the DynamoDB staff profile
and the first name from Cognito.

Cognito remains the identity source for name, email, verification state,
password, enabled state, and `admin`/`staff` roles. Employment metadata that is
owned by the business (`employeeCode`, `jobTitle`, and a non-authentication
phone number) is stored in DynamoDB at `USER#<cognito-sub>/PROFILE`. Staff can
change their own phone; an administrator manages employment fields.

## Seed the MVP catalog

Terraform creates the table and publishes its name to Parameter Store. The seed
loader only writes application records and never creates infrastructure:

```sh
export AWS_REGION=us-east-1
export AWS_PROFILE=my-profile # omit when using another standard AWS credential source
export AWS_DYNAMODB_TABLE="$(aws ssm get-parameter --name /prod/server/dynamodb-table-name --query Parameter.Value --output text)"
yarn seed:mvp
```

The default catalog is generated deterministically from the version-controlled
specification in `src/seed/mvp-catalog.ts`. It contains 10 categories and 200
realistic Kenyan retail products with EAN-13 test barcodes, SKU values, KES
prices and costs, reorder thresholds, varied opening stock, and 20 promotional
prices for checkout testing. Re-running the
loader is safe: it updates existing product metadata by SKU but preserves
current stock; only new products receive `initialStock`. Validate it without
AWS access:

```sh
yarn seed:mvp --validate-only
```

You can still pass a custom JSON seed file as the first argument.
