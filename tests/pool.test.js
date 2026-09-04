import test from "node:test";
import assert from "node:assert/strict";
import {
  chooseNextAccount,
  chooseStickyAccount,
  markAccountFailure,
  markAccountSuccess
} from "../src/accounts/pool.js";

test("chooseNextAccount skips disabled and cooling accounts", () => {
  const now = 1000;
  const accounts = [
    { id: "a", enabled: false, cooldownUntil: 0 },
    { id: "b", enabled: true, cooldownUntil: 2000 },
    { id: "c", enabled: true, cooldownUntil: 0 }
  ];
  assert.equal(chooseNextAccount(accounts, 0, now).account.id, "c");
});

test("chooseNextAccount rotates deterministically", () => {
  const accounts = [
    { id: "a", enabled: true, cooldownUntil: 0 },
    { id: "b", enabled: true, cooldownUntil: 0 }
  ];
  assert.equal(chooseNextAccount(accounts, 0, 1000).account.id, "a");
  assert.equal(chooseNextAccount(accounts, 1, 1000).account.id, "b");
});

test("sticky round robin keeps current account for configured request count", () => {
  const accounts = [
    { id: "a", enabled: true, lastUsedAt: 100, cooldownUntil: 0 },
    { id: "b", enabled: true, lastUsedAt: 50, cooldownUntil: 0 }
  ];
  const first = chooseStickyAccount(accounts, { currentId: "a", consecutive: 1 }, { now: 1000, stickyLimit: 3 });
  assert.equal(first.account.id, "a");
  assert.deepEqual(first.state, { currentId: "a", consecutive: 2 });

  const third = chooseStickyAccount(accounts, { currentId: "a", consecutive: 3 }, { now: 1000, stickyLimit: 3 });
  assert.equal(third.account.id, "b");
  assert.deepEqual(third.state, { currentId: "b", consecutive: 1 });
});

test("sticky selection excludes accounts already attempted in the request", () => {
  const accounts = [
    { id: "a", enabled: true, lastUsedAt: 10, cooldownUntil: 0 },
    { id: "b", enabled: true, lastUsedAt: 20, cooldownUntil: 0 }
  ];
  const selected = chooseStickyAccount(
    accounts,
    { currentId: "a", consecutive: 1 },
    { now: 1000, excludedIds: new Set(["a"]), model: "gemini-3.8-flash-high" }
  );
  assert.equal(selected.account.id, "b");
});

test("selection skips only the locked model and can use account for another model", () => {
  const account = {
    id: "a",
    enabled: true,
    lastUsedAt: 0,
    modelLocks: { "gemini-3.8-flash-high": 5000 }
  };
  assert.throws(
    () => chooseStickyAccount([account], {}, { now: 1000, model: "gemini-3.8-flash-high" }),
    /currently available/i
  );
  assert.equal(
    chooseStickyAccount([account], {}, { now: 1000, model: "another-model" }).account.id,
    "a"
  );
});

test("429 failure uses exact upstream reset for the affected model", () => {
  const account = { id: "a", enabled: true, failures: 0, modelLocks: {} };
  const next = markAccountFailure(
    account,
    { status: 429, model: "gemini-3.8-flash-high", resetsAtMs: 20_000 },
    1000
  );
  assert.equal(next.modelLocks["gemini-3.8-flash-high"], 20_000);
  assert.equal(next.failures, 1);
});

test("429 failure honors Retry-After when exact quota reset is unavailable", () => {
  const account = { id: "a", enabled: true, failures: 0, modelLocks: {} };
  const next = markAccountFailure(
    account,
    { status: 429, model: "gemini-3.8-flash-high", retryAfterMs: 12_000 },
    1000
  );
  assert.equal(next.modelLocks["gemini-3.8-flash-high"], 13_000);
});

test("transient upstream 5xx applies a short model cooldown", () => {
  const account = { id: "a", enabled: true, failures: 0, modelLocks: {} };
  const next = markAccountFailure(account, { status: 503, model: "gemini-3.8-flash-high" }, 1000);
  assert.equal(next.modelLocks["gemini-3.8-flash-high"] > 1000, true);
  assert.equal(next.modelLocks["gemini-3.8-flash-high"] <= 31_000, true);
});

test("401/403 mark the whole account as needing login", () => {
  const account = { id: "a", enabled: true, failures: 0, modelLocks: {} };
  const next = markAccountFailure(account, { status: 401, model: "gemini-3.8-flash-high" }, 1000);
  assert.equal(next.status, "needs_login");
  assert.equal(next.cooldownUntil, 0);
});

test("success clears current model lock and resets consecutive failures", () => {
  const account = {
    id: "a",
    enabled: true,
    failures: 2,
    modelLocks: { "gemini-3.8-flash-high": 5000, "other": 9000 }
  };
  const next = markAccountSuccess(account, 1000, "gemini-3.8-flash-high");
  assert.equal(next.failures, 0);
  assert.equal(next.modelLocks["gemini-3.8-flash-high"], undefined);
  assert.equal(next.modelLocks.other, 9000);
});
