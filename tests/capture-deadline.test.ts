import test from "node:test";
import assert from "node:assert/strict";
import { captureWaitRemaining } from "../apps/web/src/training/captureDeadline";

test("no movement expires after eight seconds", () => {
  assert.equal(captureWaitRemaining(1000, null, 8999), 1);
  assert.equal(captureWaitRemaining(1000, null, 9000), 0);
});
test("a late observed jab gets bounded time to finish", () => {
  assert.equal(captureWaitRemaining(1000, 8900, 9000), 2400);
  assert.equal(captureWaitRemaining(1000, 8900, 11400), 0);
  assert.equal(captureWaitRemaining(1000, 8900, 12000), 0);
});
test("early motion cannot extend the original wait indefinitely", () => {
  assert.equal(captureWaitRemaining(1000, 2000, 8999), 1);
  assert.equal(captureWaitRemaining(1000, 2000, 9000), 0);
});
