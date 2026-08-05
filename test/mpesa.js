const assert = require("node:assert/strict");
const {
  callbackTokenHash,
  mpesaPhoneFingerprint,
  mpesaWholeAmount,
  normalizeC2bConfirmation,
  normalizeMpesaPhone,
  normalizeStkCallback,
} = require("../dist/domain/mpesa");

assert.equal(normalizeMpesaPhone("0712 345 678"), "254712345678");
assert.equal(normalizeMpesaPhone("+254 112 345 678"), "254112345678");
assert.throws(() => normalizeMpesaPhone("0201234567"), /valid Kenyan/);
assert.equal(mpesaWholeAmount(100.01), 101);
assert.equal(mpesaWholeAmount(100), 100);
assert.notEqual(mpesaPhoneFingerprint("0712345678").phoneHash, "254712345678");
assert.equal(callbackTokenHash("secret"), callbackTokenHash("secret"));

const stk = normalizeStkCallback({ Body: { stkCallback: {
  MerchantRequestID: "merchant-1", CheckoutRequestID: "checkout-1", ResultCode: 0, ResultDesc: "Success",
  CallbackMetadata: { Item: [
    { Name: "Amount", Value: 101 }, { Name: "MpesaReceiptNumber", Value: "TGH1234567" },
    { Name: "TransactionDate", Value: 20260804120000 }, { Name: "PhoneNumber", Value: 254712345678 },
  ] },
} } }, "123456");
assert.equal(stk.payment.receiptNumber, "TGH1234567");
assert.equal(stk.payment.amountKes, 101);
assert.equal(stk.payment.source, "stk");

const c2b = normalizeC2bConfirmation({ TransID: "TGH1234567", TransAmount: "101.00", TransTime: "20260804120000", BusinessShortCode: "123456", MSISDN: "254712345678", FirstName: "Must not persist" });
assert.equal(c2b.receiptNumber, stk.payment.receiptNumber, "STK and C2B must normalize to the same canonical receipt identity");
assert.equal(c2b.amountKes, stk.payment.amountKes);
assert.equal(c2b.source, "c2b");
assert.equal(c2b.FirstName, undefined);

const failed = normalizeStkCallback({ Body: { stkCallback: { MerchantRequestID: "merchant-2", CheckoutRequestID: "checkout-2", ResultCode: 1032, ResultDesc: "Cancelled" } } }, "123456");
assert.equal(failed.payment, undefined, "failed STK callbacks must not create payments");

console.log("M-Pesa domain tests passed");
