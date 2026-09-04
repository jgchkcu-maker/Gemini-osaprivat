import test from "node:test";
import assert from "node:assert/strict";
import { chooseNextAccount, markAccountFailure } from "../src/accounts/pool.js";

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

test("429 failure applies cooldown", () => {
  const account = { id: "a", enabled: true, cooldownUntil: 0, failures: 0 };
  const next = markAccountFailure(account, 429, 1000);
  assert.equal(next.cooldownUntil > 1000, true);
  assert.equal(next.failures, 1);
});
