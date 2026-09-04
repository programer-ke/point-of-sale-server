import { DeleteCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { dynamoDB, TABLE_NAME } from "../config/db";
import { addBillingDays, billingGraceDays, billingStatus, kenyaDate } from "../domain/billing";
import { listBillingPayments, listPlatformBillingAccounts } from "../repositories/billing-repository";
import { requireBillingAccount } from "../repositories/billing-repository";
import { attemptCreditSettlement, expireBillingCredits, listBillingCredits } from "../repositories/billing-credit-repository";
import { advanceAccountLifecycle, purgeTenantDataPage } from "../repositories/account-lifecycle-repository";
import { listTenantMemberships } from "../repositories/tenant-repository";
import { createNotification } from "../repositories/notification-repository";
import { getCognitoUser } from "./cognito";
import { sendBillingEmail } from "./billing-email";
import { refreshPlatformBusinessSummary, refreshPlatformMetrics } from "../repositories/platform-repository";
import { logOperationFailure } from "../observability";

const reminderFor = (endOn: string, today: string, status: string, graceDays: number) => {
  const dueOn = addBillingDays(endOn, 1);
  const graceEndsOn = addBillingDays(endOn, graceDays);
  const days = (Date.parse(`${dueOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000;
  if ([7, 3, 1].includes(days)) return { key: `before-${days}`, subject: `BiasharaKit payment due in ${days} day${days === 1 ? "" : "s"}`, message: `Your subscription is paid through ${endOn}. Renew before the grace period ends to keep staff access active.` };
  if (days === 0) return { key: "due", subject: "BiasharaKit payment is due", message: `Your payment is due today, ${dueOn}. The ${graceDays}-day grace period ends ${graceEndsOn}; this does not change your renewal date.` };
  if ((status === "restricted" || status === "cancelled") && today === addBillingDays(graceEndsOn, 1)) return { key: "restricted", subject: "BiasharaKit account is Payment Defaulted", message: "The payment grace period has ended. Business administrators can still sign in to review Billing, reports, and exports." };
  return null;
};

export const processBillingReminders = async (today = kenyaDate()) => {
  const accounts = await listPlatformBillingAccounts();
  await Promise.all(accounts.map((account) => refreshPlatformBusinessSummary(account.tenantId)));
  let sent = 0;
  let failed = 0;
  for (const listedAccount of accounts) {
    const creditsBeforeExpiry = await listBillingCredits(listedAccount.tenantId);
    const expiring = creditsBeforeExpiry.filter((credit) => credit.remainingAmountKes > 0 && credit.expiresOn).map((credit) => ({ ...credit, days: (Date.parse(`${credit.expiresOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000 })).filter(({ days }) => [30, 7, 1, 0].includes(days)).sort((left, right) => left.days - right.days);
    const creditNotice = expiring.length ? { key: `credit-expiry-${expiring[0].days}`, subject: expiring[0].days === 0 ? "BiasharaKit account credit expires today" : `BiasharaKit account credit expires in ${expiring[0].days} days`, message: `KES ${expiring.reduce((total, credit) => total + credit.remainingAmountKes, 0).toLocaleString("en-KE")} of unused account credit is approaching expiry. It will be applied automatically to eligible subscription charges.` } : null;
    await expireBillingCredits(listedAccount.tenantId, today);
    const settlement = await attemptCreditSettlement(listedAccount.tenantId, "billing-worker", listedAccount);
    let account = settlement ? await requireBillingAccount(listedAccount.tenantId) : listedAccount;
    if (settlement) {
      const admins = (await listTenantMemberships(account.tenantId)).filter(({ roles }) => roles.includes("admin"));
      const users = await Promise.all(admins.map(({ username }) => getCognitoUser(username)));
      const emails = [...new Set([account.billingContactEmail || account.ownerUsername, ...users.map(({ email }) => email)].filter(Boolean).map((email) => email.toLowerCase()))];
      const message = `Account credit settled the subscription through ${settlement.periodEndsOn}.${listedAccount.workspaceState === "archived" ? " Workspace access has been restored." : ""}`;
      const deliveries = await Promise.allSettled([
        ...emails.map((to) => sendBillingEmail({ to, subject: "BiasharaKit account credit applied", heading: "Account credit applied", message })),
        ...admins.map((admin) => createNotification(account.tenantId, admin.userId, { eventKey: `billing:credit-settlement:${settlement.id}`, type: "billing", title: "Account credit applied", message, actionPath: "/dashboard/billing" })),
      ]);
      deliveries.filter((delivery) => delivery.status === "rejected").forEach((delivery) => logOperationFailure("billing_credit_settlement_delivery", (delivery as PromiseRejectedResult).reason, { tenantId: account.tenantId, entityId: settlement.id }));
    }
    const payments = await listBillingPayments(account.tenantId);
    const paymentPending = payments.some((payment) => payment.status === "submitted");
    const lifecycle = paymentPending ? { account, notice: null, purge: false } : await advanceAccountLifecycle(account, today);
    account = lifecycle.account;
    if (settlement || account.workspaceState !== listedAccount.workspaceState || account.delinquentSince !== listedAccount.delinquentSince) await refreshPlatformBusinessSummary(account.tenantId);
    const endOn = account.paidThrough ?? account.trialEndsOn;
    const reminder = lifecycle.notice ?? creditNotice ?? (!paymentPending ? reminderFor(endOn, today, billingStatus(account, today), billingGraceDays(account)) : null);
    if (!reminder && lifecycle.purge) { await purgeTenantDataPage(account); continue; }
    if (!reminder) continue;
    const eventKey = `${today}#${reminder.key}`;
    const markerKey = { partitionKey: `TENANT#${account.tenantId}`, sortKey: `BILLING#REMINDER#${eventKey}` };
    try {
      await dynamoDB.send(new PutCommand({ TableName: TABLE_NAME, Item: { ...markerKey, entityType: "billing_reminder", tenantId: account.tenantId, eventKey, status: "sending", createdAt: new Date().toISOString() }, ConditionExpression: "attribute_not_exists(partitionKey)" }));
    } catch (error) {
      if (error instanceof Error && error.name === "ConditionalCheckFailedException") {
        if (lifecycle.purge) await purgeTenantDataPage(account);
        continue;
      }
      throw error;
    }
    try {
      const admins = (await listTenantMemberships(account.tenantId)).filter(({ roles }) => roles.includes("admin"));
      const users = await Promise.all(admins.map(({ username }) => getCognitoUser(username)));
      const emails = [...new Set([account.billingContactEmail || account.ownerUsername, ...users.map(({ email }) => email)].filter(Boolean).map((email) => email.toLowerCase()))];
      await Promise.all(emails.map((to) => sendBillingEmail({ to, subject: reminder.subject, heading: reminder.subject, message: reminder.message })));
      await Promise.all(admins.map((admin) => createNotification(account.tenantId, admin.userId, {
        eventKey: `billing:${eventKey}`, type: "billing", title: reminder.subject, message: reminder.message, actionPath: "/dashboard/billing",
      })));
      await dynamoDB.send(new UpdateCommand({ TableName: TABLE_NAME, Key: markerKey, UpdateExpression: "SET #status = :sent, sentAt = :now", ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: { ":sent": "sent", ":now": new Date().toISOString() } }));
      sent += 1;
      if (lifecycle.purge) await purgeTenantDataPage(account);
    } catch (error) {
      await dynamoDB.send(new DeleteCommand({ TableName: TABLE_NAME, Key: markerKey })).catch(() => undefined);
      logOperationFailure("billing_reminder_delivery", error, { tenantId: account.tenantId, kind: reminder.key });
      failed += 1;
    }
  }
  await refreshPlatformMetrics();
  if (failed > 0) {
    const error = new Error(`${failed} billing reminder delivery attempt${failed === 1 ? "" : "s"} failed`);
    error.name = "BillingReminderDeliveryError";
    throw error;
  }
  return { checked: accounts.length, sent };
};
