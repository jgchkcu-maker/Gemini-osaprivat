import test from "node:test";
import assert from "node:assert/strict";
import {
  isOAuthConfigured,
  resolveOAuthCredentials,
  resolveWebOAuthCredentials
} from "../src/accounts/oauth.js";

test("provider-native Antigravity OAuth has embedded public defaults when env is empty", () => {
  const credentials = resolveOAuthCredentials({});

  assert.match(credentials.clientId, /\.apps\.googleusercontent\.com$/);
  assert.ok(credentials.clientSecret.length > 0);
  assert.equal(isOAuthConfigured({}), true);
});

test("explicit Antigravity env credentials override embedded public defaults", () => {
  assert.deepEqual(
    resolveOAuthCredentials({
      ANTIGRAVITY_CLIENT_ID: "override-id",
      ANTIGRAVITY_CLIENT_SECRET: "override-secret"
    }),
    { clientId: "override-id", clientSecret: "override-secret" }
  );
});

test("embedded native defaults do not make custom Web OAuth configured", () => {
  assert.deepEqual(resolveWebOAuthCredentials({}), { clientId: "", clientSecret: "" });
});
