import { PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { dynamoDB, TABLE_NAME } from "../config/db";
import { getBusinessSettings } from "../repositories/pos-repository";
import { getBillingAccount, listBillingPayments, listPlatformBillingAccounts } from "../repositories/billing-repository";
import { listTenantRecords } from "../repositories/tenant-repository";
import { refreshPlatformBusinessSummary, refreshPlatformMetrics } from "../repositories/platform-repository";
import { getCognitoUser } from "../services/cognito";

const main = async () => {
  const [tenants, accounts] = await Promise.all([listTenantRecords(), listPlatformBillingAccounts()]);
  const tenantIds = new Set([...tenants.map(({ id }) => id), ...accounts.map(({ tenantId }) => tenantId)]);
  for (const tenantId of tenantIds) {
    const account = await getBillingAccount(tenantId);
    if (account) {
      const [settings, owner, payments] = await Promise.all([
        getBusinessSettings(tenantId),
        getCognitoUser(account.ownerUsername),
        listBillingPayments(tenantId),
      ]);
      await dynamoDB.send(new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { partitionKey: `TENANT#${tenantId}`, sortKey: "BILLING#ACCOUNT" },
        UpdateExpression: "SET billingContactName = if_not_exists(billingContactName, :name), billingContactEmail = if_not_exists(billingContactEmail, :email), billingContactPhone = if_not_exists(billingContactPhone, :phone)",
        ExpressionAttributeValues: {
          ":name": owner.name || account.tenantName,
          ":email": settings?.email || owner.email || account.ownerUsername,
          ":phone": settings?.phone || "",
        },
      }));
      for (const payment of payments) {
        await dynamoDB.send(new PutCommand({
          TableName: TABLE_NAME,
          Item: {
            partitionKey: `TENANT#${tenantId}`,
            sortKey: `BILLING#PAYMENT#${payment.id}`,
            accessPartition: `PLATFORM#BILLING_PAYMENT#${payment.status}`,
            accessSort: `${payment.submittedAt}#${payment.id}`,
            entityType: "billing_payment",
            ...payment,
          },
        }));
      }
    }
    await refreshPlatformBusinessSummary(tenantId);
    console.info(`refreshed platform billing projection for ${tenantId}`);
  }
  const metrics = await refreshPlatformMetrics();
  console.info(`platform billing metrics calculated at ${metrics.calculatedAt}`);
};

void main().catch((error) => { console.error(error); process.exitCode = 1; });
