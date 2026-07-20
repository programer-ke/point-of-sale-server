import { GetParametersCommand, SSMClient } from "@aws-sdk/client-ssm";
import { writeFile } from "node:fs/promises";

const awsRegion = process.env.AWS_REGION ?? "us-east-1";
const environment = process.env.PROJECT_ENV ?? "prod";

if (!/^[a-z0-9-]+$/.test(environment)) {
  throw new Error(
    "PROJECT_ENV must contain only lowercase letters, numbers, and hyphens",
  );
}

const prefix = `/${environment}`;
const parameters = {
  AWS_REGION: `${prefix}/aws/region`,
  AWS_DYNAMODB_TABLE: `${prefix}/server/dynamodb-table-name`,
  COGNITO_USER_POOL_ID: `${prefix}/cognito/user-pool-id`,
  COGNITO_USER_POOL_CLIENT_ID: `${prefix}/cognito/user-pool-client-id`,
} as const;

const client = new SSMClient({ region: awsRegion });

async function loadParameters() {
  const names = Object.values(parameters);
  const response = await client.send(new GetParametersCommand({ Names: names }));

  if (response.InvalidParameters?.length) {
    throw new Error(
      `Missing SSM parameters: ${response.InvalidParameters.join(", ")}`,
    );
  }

  const valuesByPath = new Map(
    response.Parameters?.map(({ Name, Value }) => [Name, Value]) ?? [],
  );

  return Object.fromEntries(
    Object.entries(parameters).map(([key, path]) => {
      const value = valuesByPath.get(path);
      if (!value) {
        throw new Error(`SSM parameter ${path} has no value`);
      }
      if (value.includes("\n") || value.includes("\r")) {
        throw new Error(`SSM parameter ${path} contains an unsupported newline`);
      }
      return [key, value];
    }),
  );
}

async function main() {
  const values = await loadParameters();
  const outputFile = process.env.PARAMS_OUTPUT_FILE ?? ".env";

  await writeFile(
    outputFile,
    `${Object.entries(values)
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join("\n")}\n`,
    { mode: 0o600 },
  );

  console.log(
    `Loaded ${Object.keys(values).length} parameters from ${prefix} into ${outputFile}`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
