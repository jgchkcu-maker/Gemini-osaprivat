const DEFAULT_COOLDOWN_MS = 60_000;

function isAvailable(account, now) {
  return account?.enabled !== false && account?.status !== "needs_login" && Number(account?.cooldownUntil ?? 0) <= now;
}

export function chooseNextAccount(accounts, cursor = 0, now = Date.now()) {
  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new Error("No Antigravity accounts configured");
  }

  const start = Math.abs(Number(cursor) || 0) % accounts.length;
  for (let offset = 0; offset < accounts.length; offset += 1) {
    const index = (start + offset) % accounts.length;
    if (isAvailable(accounts[index], now)) {
      return { account: accounts[index], index, nextCursor: index + 1 };
    }
  }

  throw new Error("No Antigravity accounts are currently available");
}

export function markAccountFailure(account, status, now = Date.now()) {
  const failures = Number(account?.failures ?? 0) + 1;
  if (status === 401 || status === 403) {
    return {
      ...account,
      status: "needs_login",
      failures,
      lastErrorAt: now,
      cooldownUntil: 0
    };
  }

  if (status === 429) {
    const backoff = Math.min(DEFAULT_COOLDOWN_MS * 2 ** Math.min(failures - 1, 5), 30 * 60_000);
    return {
      ...account,
      status: "cooldown",
      failures,
      lastErrorAt: now,
      cooldownUntil: now + backoff
    };
  }

  return {
    ...account,
    failures,
    lastErrorAt: now
  };
}

export function markAccountSuccess(account, now = Date.now()) {
  return {
    ...account,
    status: "ready",
    failures: 0,
    cooldownUntil: 0,
    lastUsedAt: now,
    lastErrorAt: null
  };
}
