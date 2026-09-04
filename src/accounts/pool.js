const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 60_000;
const MAX_RATE_LIMIT_COOLDOWN_MS = 30 * 60_000;
const DEFAULT_TRANSIENT_COOLDOWN_MS = 5_000;
const MAX_TRANSIENT_COOLDOWN_MS = 30_000;

function normalizedLocks(account) {
  return account?.modelLocks && typeof account.modelLocks === "object" ? account.modelLocks : {};
}

function modelLockUntil(account, model) {
  if (!model) return 0;
  return Number(normalizedLocks(account)[model] ?? 0);
}

function isAvailable(account, now, model = null, excludedIds = null) {
  if (!account || account.enabled === false || account.status === "needs_login" || account.status === "disabled") return false;
  if (excludedIds?.has?.(account.id)) return false;
  if (Number(account.cooldownUntil ?? 0) > now) return false;
  if (modelLockUntil(account, model) > now) return false;
  return true;
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

/**
 * A compact adaptation of 9router's sticky round-robin behavior.
 * The current healthy account is reused a small number of times, then selection
 * moves to the least-recently-used healthy account. Accounts already attempted
 * by the same request are always excluded.
 */
export function chooseStickyAccount(accounts, state = {}, options = {}) {
  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new Error("No Antigravity accounts configured");
  }

  const now = Number(options.now ?? Date.now());
  const stickyLimit = Math.max(1, Number(options.stickyLimit ?? 3));
  const excludedIds = options.excludedIds instanceof Set
    ? options.excludedIds
    : new Set(options.excludedIds || []);
  const model = options.model || null;

  const available = accounts.filter((account) => isAvailable(account, now, model, excludedIds));
  if (available.length === 0) {
    throw new Error("No Antigravity accounts are currently available");
  }

  const current = available.find((account) => account.id === state?.currentId);
  const consecutive = Math.max(0, Number(state?.consecutive ?? 0));
  if (current && consecutive > 0 && consecutive < stickyLimit) {
    return {
      account: current,
      state: { currentId: current.id, consecutive: consecutive + 1 }
    };
  }

  const sorted = [...available].sort((left, right) => {
    const leftUsed = Number(left.lastUsedAt ?? 0);
    const rightUsed = Number(right.lastUsedAt ?? 0);
    if (leftUsed !== rightUsed) return leftUsed - rightUsed;
    return String(left.id || "").localeCompare(String(right.id || ""));
  });

  let selected = sorted[0];
  if (current && available.length > 1 && consecutive >= stickyLimit) {
    selected = sorted.find((account) => account.id !== current.id) || sorted[0];
  }

  return {
    account: selected,
    state: { currentId: selected.id, consecutive: 1 }
  };
}

function normalizeFailure(failure) {
  if (typeof failure === "number") return { status: failure };
  if (!failure || typeof failure !== "object") return { status: 500 };
  return failure;
}

function withModelLock(account, model, until) {
  if (!model || !(until > 0)) return account;
  return {
    ...account,
    modelLocks: {
      ...normalizedLocks(account),
      [model]: until
    }
  };
}

export function markAccountFailure(account, failure, now = Date.now()) {
  const detail = normalizeFailure(failure);
  const status = Number(detail.status || 500);
  const failures = Number(account?.failures ?? 0) + 1;
  const base = {
    ...account,
    failures,
    lastErrorAt: now
  };

  if (status === 401 || status === 403) {
    return {
      ...base,
      status: "needs_login",
      cooldownUntil: 0
    };
  }

  const model = detail.model || null;
  if (status === 409 || status === 429) {
    let until = Number(detail.resetsAtMs ?? 0);
    if (!(until > now) && Number(detail.retryAfterMs) > 0) {
      until = now + Number(detail.retryAfterMs);
    }
    if (!(until > now)) {
      const backoff = Math.min(
        DEFAULT_RATE_LIMIT_COOLDOWN_MS * 2 ** Math.min(failures - 1, 5),
        MAX_RATE_LIMIT_COOLDOWN_MS
      );
      until = now + backoff;
    }
    return {
      ...withModelLock(base, model, until),
      status: "cooldown",
      cooldownUntil: model ? Number(account?.cooldownUntil ?? 0) : until
    };
  }

  if (status === 408 || status === 500 || status === 502 || status === 503 || status === 504) {
    const transientMs = Math.min(
      DEFAULT_TRANSIENT_COOLDOWN_MS * 2 ** Math.min(failures - 1, 3),
      MAX_TRANSIENT_COOLDOWN_MS
    );
    const until = now + transientMs;
    return {
      ...withModelLock(base, model, until),
      status: "cooldown",
      cooldownUntil: model ? Number(account?.cooldownUntil ?? 0) : until
    };
  }

  return base;
}

export function markAccountSuccess(account, now = Date.now(), model = null) {
  const modelLocks = { ...normalizedLocks(account) };
  if (model) delete modelLocks[model];
  else {
    for (const key of Object.keys(modelLocks)) {
      if (Number(modelLocks[key]) <= now) delete modelLocks[key];
    }
  }

  return {
    ...account,
    status: "ready",
    failures: 0,
    cooldownUntil: 0,
    modelLocks,
    lastUsedAt: now,
    lastErrorAt: null
  };
}
