import {
  DescribeTableCommand,
  waitUntilTableExists,
} from "@aws-sdk/client-dynamodb";
import dotenv from "dotenv";
import { createUser, getUserByEmail } from "../utils/db-helpers";
import { dynamoDBClient, TABLE_NAME } from "../config/db";

dotenv.config();

const tenantId = process.env.SEED_TENANT_ID || "tenant_001";

const users = [
  {
    email: "admin1@example.com",
    name: "Admin One",
    role: "admin",
    passwordHash: "seeded-development-password",
    tenantId,
    status: "active",
    permissions: ["*"],
  },
  {
    email: "admin2@example.com",
    name: "Admin Two",
    role: "admin",
    passwordHash: "seeded-development-password",
    tenantId,
    status: "active",
    permissions: ["*"],
  },
  {
    email: "staff1@example.com",
    name: "Staff One",
    role: "staff",
    passwordHash: "seeded-development-password",
    tenantId,
    status: "active",
    permissions: ["orders:read", "orders:create", "products:read"],
  },
  {
    email: "staff2@example.com",
    name: "Staff Two",
    role: "staff",
    passwordHash: "seeded-development-password",
    tenantId,
    status: "active",
    permissions: ["orders:read", "orders:create", "products:read"],
  },
];

async function ensureTableReady() {
  try {
    await dynamoDBClient.send(
      new DescribeTableCommand({ TableName: TABLE_NAME }),
    );
  } catch (error: any) {
    if (error.name === "ResourceNotFoundException") {
      throw new Error(
        `Table ${TABLE_NAME} does not exist. Deploy the server Terraform stack before seeding.`,
        { cause: error },
      );
    }
    throw error;
  }

  await waitUntilTableExists(
    { client: dynamoDBClient, maxWaitTime: 120 },
    { TableName: TABLE_NAME },
  );
}

async function main() {
  console.log(`Seeding ${users.length} users into ${TABLE_NAME}`);
  await ensureTableReady();

  for (const user of users) {
    const existingUser = await getUserByEmail(user.email);

    if (existingUser) {
      console.log(`Skipped existing user: ${user.email}`);
      continue;
    }

    const createdUser = await createUser(user);
    console.log(`Created ${createdUser.role}: ${createdUser.email}`);
  }
}

main().catch((error) => {
  console.error("Failed to seed users:", error);
  process.exitCode = 1;
});
