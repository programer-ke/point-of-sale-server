const assert = require("node:assert/strict");

process.env.SERVICE_NAME = "test-service";

const {
  isUnexpectedError,
  logEvent,
  observeCriticalOperation,
} = require("../dist/observability.js");

async function main() {
  const records = [];
  const original = { info: console.info, warn: console.warn, error: console.error };
  console.info = (value) => records.push(JSON.parse(value));
  console.warn = (value) => records.push(JSON.parse(value));
  console.error = (value) => records.push(JSON.parse(value));

  try {
    logEvent("info", "request_test", {
      requestId: "request-1",
      idempotencyKey: "idempotency-1",
      lambdaRequestId: "lambda-1",
      operation: "completeSale",
      tenantId: "tenant-1",
      userId: "user-1",
      authorization: "Bearer secret",
      phone: "+254700000000",
      mpesaReference: "SECRET123",
    });
    assert.deepEqual(records[0], {
      timestamp: records[0].timestamp,
      level: "info",
      service: "test-service",
      event: "request_test",
      requestId: "request-1",
      idempotencyKey: "idempotency-1",
      lambdaRequestId: "lambda-1",
      operation: "completeSale",
      tenantId: "tenant-1",
      userId: "user-1",
    });
    assert.match(records[0].timestamp, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(JSON.stringify(records[0]).includes("secret"), false);
    assert.equal(JSON.stringify(records[0]).includes("254700"), false);
    assert.equal(JSON.stringify(records[0]).includes("SECRET123"), false);

    assert.equal(isUnexpectedError(new Error("validation")), false);
    assert.equal(isUnexpectedError(new TypeError("bug")), true);
    const dependencyError = Object.assign(new Error("dependency unavailable"), {
      name: "InternalServerError",
      $metadata: { httpStatusCode: 500 },
    });
    assert.equal(isUnexpectedError(dependencyError), true);

    await assert.rejects(
      () => observeCriticalOperation("sale_completion", { requestId: "request-2" }, async () => { throw new Error("Insufficient stock"); }),
      /Insufficient stock/,
    );
    assert.equal(records.at(-1).event, "critical_operation_failed");
    assert.equal(records.at(-1).critical, false);
    assert.equal(records.at(-1).outcome, "rejected");
    assert.equal(records.at(-1).errorMessage, undefined);

    await assert.rejects(
      () => observeCriticalOperation("billing_invoice_creation", { requestId: "request-3" }, async () => { throw dependencyError; }),
      /dependency unavailable/,
    );
    assert.equal(records.at(-1).critical, true);
    assert.equal(records.at(-1).level, "error");
    assert.match(records.at(-1).errorStack, /InternalServerError/);

    assert.equal(await observeCriticalOperation("sale_completion", { requestId: "request-4" }, async () => "ok"), "ok");
    assert.equal(records.at(-1).event, "critical_operation_succeeded");
    assert.equal(records.at(-1).outcome, "succeeded");
  } finally {
    console.info = original.info;
    console.warn = original.warn;
    console.error = original.error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
