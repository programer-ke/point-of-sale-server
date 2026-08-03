import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { dynamoDB, TABLE_NAME } from "../config/db";
import { PRIVACY_VERSION, TERMS_VERSION, kenyaDate, type PlanCode } from "../domain/billing";
import { createBillingAccount, getBillingAccount } from "../repositories/billing-repository";
import { getBusinessSettings } from "../repositories/pos-repository";
import { listStores } from "../repositories/supply-chain-repository";
import { listTenantMemberships, type TenantRecord } from "../repositories/tenant-repository";
import { getCognitoUser } from "../services/cognito";

const rolloutDate = process.argv.find((value) => value.startsWith("--rollout-date="))?.split("=")[1] ?? process.env.BILLING_ROLLOUT_DATE ?? kenyaDate();
if (!/^\d{4}-\d{2}-\d{2}$/.test(rolloutDate)) throw new Error("Use --rollout-date=YYYY-MM-DD");

const main = async () => {
  const tenants: TenantRecord[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const response = await dynamoDB.send(new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: "entityType = :type",
      ExpressionAttributeValues: { ":type": "tenant" },
      ExclusiveStartKey: startKey,
    }));
    tenants.push(...(response.Items ?? []).map((item) => item as unknown as TenantRecord));
    startKey = response.LastEvaluatedKey;
  } while (startKey);

  for (const tenant of tenants) {
    if (await getBillingAccount(tenant.id)) { console.info(`skip ${tenant.id} already configured`); continue; }
    const [settings, stores, memberships] = await Promise.all([getBusinessSettings(tenant.id), listStores(tenant.id), listTenantMemberships(tenant.id)]);
    const users = await Promise.all(memberships.map(({ username }) => getCognitoUser(username)));
    const activeUsers = users.filter((user) => user.status !== "DISABLED").length;
    const planCode: PlanCode = settings.vatRegistered || stores.filter((store) => store.status === "active").length > 1 || activeUsers > 5 ? "biashara_plus" : "biashara";
    const owner = memberships.find(({ userId }) => userId === tenant.ownerUserId) ?? memberships.find(({ roles }) => roles.includes("admin"));
    if (!owner) throw new Error(`Tenant ${tenant.id} has no administrator membership`);
    await createBillingAccount({ tenantId: tenant.id, tenantName: tenant.name, ownerUserId: owner.userId, ownerUsername: owner.username, planCode, termsVersion: `legacy-pending-${TERMS_VERSION}`, privacyVersion: `legacy-pending-${PRIVACY_VERSION}`, acceptedBy: "system-rollout", trialStartedOn: rolloutDate });
    console.info(`configured ${tenant.id} as ${planCode}`);
  }
};

void main().catch((error) => { console.error(error); process.exitCode = 1; });
