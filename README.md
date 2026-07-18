# Point of sale server

Apollo GraphQL server with separate entry points for local development and AWS
Lambda.

## Local development

Local commands are unchanged:

```sh
npm ci
npm run dev
```

The local entry point is `src/index.ts`. `dotenv` loads `.env`, and the AWS SDK
uses its standard credential provider chain. This supports environment
credentials (including `AWS_SESSION_TOKEN`), `AWS_PROFILE`, and other standard
local AWS credential sources. A typical local `.env` contains non-secret
configuration like this:

```dotenv
AWS_REGION=us-east-1
AWS_DYNAMODB_TABLE=pos_system
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
- `NODE_ENV=production`
- AWS-generated region and temporary execution-role credentials

No application secret is currently required. GitHub Actions assumes only the
deployment role through OIDC; the running function uses its separate,
least-privilege Lambda execution role.

For an existing Web Adapter deployment, deploy the server package before
applying the native-handler infrastructure change. The package retains the old
`run.sh` launcher during this migration, so both configurations can execute the
same release. New environments should deploy infrastructure first.

See Apollo's [AWS Lambda deployment
guide](https://www.apollographql.com/docs/apollo-server/deployment/lambda).
