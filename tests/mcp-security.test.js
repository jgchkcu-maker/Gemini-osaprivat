import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  getMcpAuthMode,
  isAuthorizedBearer
} from "../src/mcp/security.js";

const sourceUrl = new URL("../src/mcp/security.js", import.meta.url);

test("MCP auth mode is public without a shared secret and bearer with one", () => {
  assert.equal(getMcpAuthMode({}), "public");
  assert.equal(getMcpAuthMode({ MCP_SHARED_SECRET: "   " }), "public");
  assert.equal(getMcpAuthMode({ MCP_SHARED_SECRET: "secret-value" }), "bearer");
});

test("bearer authorization accepts only the exact configured token", () => {
  assert.equal(isAuthorizedBearer("Bearer secret-value", "secret-value"), true);
  assert.equal(isAuthorizedBearer("Bearer secret-value-extra", "secret-value"), false);
  assert.equal(isAuthorizedBearer("Basic secret-value", "secret-value"), false);
  assert.equal(isAuthorizedBearer(null, "secret-value"), false);
});

test("bearer comparison uses timingSafeEqual rather than direct string equality", async () => {
  const source = await readFile(sourceUrl, "utf8");
  assert.match(source, /timingSafeEqual/);
  assert.doesNotMatch(source, /authorization\s*===\s*expected/);
});
