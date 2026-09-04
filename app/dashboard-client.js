"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    cache: "no-store"
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `Request failed (${response.status})`);
  return data;
}

function relativeTime(value) {
  if (!value) return "Never";
  const diff = Math.max(0, Date.now() - Number(value));
  if (diff < 60_000) return "Just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function statusText(account) {
  if (!account.enabled) return "Disabled";
  if (account.status === "needs_login") return "Needs login";
  if (account.cooldownUntil > Date.now()) return "Cooldown";
  return "Ready";
}

function statusClass(account) {
  if (!account.enabled) return "muted";
  if (account.status === "needs_login") return "danger";
  if (account.cooldownUntil > Date.now()) return "warning";
  return "success";
}

function IconPlus() {
  return <span className="plusIcon">+</span>;
}

function Login({ status, onLogin }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/admin/login", { method: "POST", body: JSON.stringify({ password }) });
      await onLogin();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="loginShell">
      <section className="loginCard glass">
        <div className="brandMark">G</div>
        <div className="eyebrow">Gemini Critic Control</div>
        <h1>Account Pool</h1>
        <p className="subtle">Private control panel for the critic MCP.</p>
        {!status?.adminConfigured ? (
          <div className="setupNotice">
            <strong>One setting left</strong>
            <span>Add <code>ADMIN_PASSWORD</code> in Vercel → Settings → Environment Variables, then redeploy.</span>
          </div>
        ) : (
          <form onSubmit={submit} className="loginForm">
            <label>
              <span>Admin password</span>
              <input
                autoFocus
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter password"
              />
            </label>
            {error ? <div className="errorText">{error}</div> : null}
            <button className="primaryButton" disabled={busy || !password}>
              {busy ? "Signing in…" : "Open dashboard"}
            </button>
          </form>
        )}
        <div className="lockedModel"><span className="statusDot" /> Gemini 3.8 Flash High <b>LOCKED</b></div>
      </section>
    </main>
  );
}

function AddAccountModal({ status, onClose, onAdded }) {
  const [mode, setMode] = useState(status.oauthConfigured ? "oauth" : "import");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [flow, setFlow] = useState(null);
  const [callbackUrl, setCallbackUrl] = useState("");
  const [email, setEmail] = useState("");
  const [projectId, setProjectId] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [copied, setCopied] = useState(false);
  const flowRef = useRef(null);
  const popupRef = useRef(null);

  useEffect(() => {
    async function onMessage(event) {
      if (event.data?.type !== "gemini-critic-oauth") return;
      const activeFlow = flowRef.current;
      let callbackOrigin = window.location.origin;
      try {
        callbackOrigin = new URL(activeFlow?.redirectUri || window.location.origin).origin;
      } catch {
        return;
      }
      if (event.origin !== callbackOrigin) return;
      if (popupRef.current && event.source !== popupRef.current) return;
      flowRef.current = null;
      popupRef.current = null;
      setBusy(false);
      if (!event.data.ok) {
        setError(event.data.message || "Google OAuth failed");
        return;
      }
      try {
        await onAdded();
        onClose();
      } catch (err) {
        setError(err.message);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onAdded, onClose]);

  async function startOAuth(oauthMode = "native") {
    setBusy(true);
    setError("");
    setFlow(null);
    setCallbackUrl("");
    try {
      const next = await api("/api/accounts/oauth/start", {
        method: "POST",
        body: JSON.stringify({ mode: oauthMode })
      });
      flowRef.current = next;
      setFlow(next);
      const popup = window.open(
        next.authorizationUrl,
        "gemini-critic-google-oauth",
        "popup=yes,width=540,height=760,resizable=yes,scrollbars=yes"
      );
      if (!popup) {
        if (oauthMode === "web") {
          window.location.assign(next.authorizationUrl);
          return;
        }
        throw new Error("Browser blocked the Google sign-in window. Allow pop-ups for this site and try again.");
      }
      popupRef.current = popup;
      popup.focus?.();
      if (next.mode !== "web") setBusy(false);
    } catch (err) {
      setBusy(false);
      setError(err.message);
    }
  }

  async function finishOAuth() {
    setBusy(true);
    setError("");
    try {
      await api("/api/accounts/oauth/finish", {
        method: "POST",
        body: JSON.stringify({ callbackUrl, state: flow?.state })
      });
      await onAdded();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function importAccount(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/accounts", {
        method: "POST",
        body: JSON.stringify({ email, projectId, refreshToken })
      });
      await onAdded();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function copyRedirectUri() {
    if (!status.oauthRedirectUri) return;
    try {
      await navigator.clipboard?.writeText(status.oauthRedirectUri);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("Could not copy the callback URL. Select it manually.");
    }
  }

  const nativeFlowActive = flow?.mode === "manual";
  const webFlowActive = flow?.mode === "web";

  return (
    <div className="modalBackdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal glass">
        <div className="modalHeader">
          <div>
            <div className="eyebrow">ACCOUNT POOL</div>
            <h2>Add account</h2>
          </div>
          <button className="iconButton" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="segmented">
          <button className={mode === "oauth" ? "active" : ""} onClick={() => setMode("oauth")} type="button">{status.webOauthConfigured ? "Google OAuth" : "Antigravity OAuth"}</button>
          <button className={mode === "import" ? "active" : ""} onClick={() => setMode("import")} type="button">Import credential</button>
        </div>

        {mode === "oauth" ? (
          <div className="modalBody">
            {status.webOauthConfigured ? (
              <>
                <div className="setupNotice compact">
                  <strong>Recommended · one-click Google OAuth</strong>
                  <span>Choose the Google account and allow access. The account will be encrypted and added automatically, including when this dashboard is opened from a Vercel preview URL.</span>
                  <div className="redirectBox">
                    <span>Authorized redirect URI</span>
                    <code>{status.oauthRedirectUri}</code>
                    <button type="button" onClick={copyRedirectUri}>{copied ? "Copied" : "Copy"}</button>
                  </div>
                </div>

                {!webFlowActive ? (
                  <button className="primaryButton" onClick={() => startOAuth("web")} disabled={busy}>
                    {busy ? "Opening Google…" : "Continue with Google"}
                  </button>
                ) : (
                  <div className="stepRow"><span>2</span><div><b>Finish Google sign-in</b><p>This window will update automatically after Google returns. On mobile, you may return to the dashboard manually after approval.</p></div></div>
                )}

                {status.nativeOauthConfigured ? (
                  <details className="oauthFallback" open={nativeFlowActive}>
                    <summary>Use manual Antigravity OAuth instead</summary>
                    <div className="oauthFallbackBody">
                      {!nativeFlowActive ? (
                        <button className="secondaryButton" onClick={() => startOAuth("native")} disabled={busy}>
                          Open provider-native sign-in
                        </button>
                      ) : (
                        <>
                          <div className="stepRow"><span>1</span><div><b>Finish Google sign-in</b><p>Choose the Google account and allow access.</p></div></div>
                          <div className="stepRow"><span>2</span><div><b>Copy the localhost callback URL</b><p>The localhost page may not load — copy the full URL from the browser address bar.</p></div></div>
                          <label>
                            <span>Callback URL</span>
                            <textarea value={callbackUrl} onChange={(event) => setCallbackUrl(event.target.value)} placeholder="http://localhost:51121/oauth-callback?state=…&code=…" />
                          </label>
                          <button className="primaryButton" onClick={finishOAuth} disabled={busy || !callbackUrl}>
                            {busy ? "Adding…" : "Add to pool"}
                          </button>
                          <button className="secondaryButton" onClick={() => startOAuth("native")} disabled={busy}>Restart sign-in</button>
                        </>
                      )}
                    </div>
                  </details>
                ) : null}
              </>
            ) : status.nativeOauthConfigured ? (
              <>
                <div className="setupNotice compact">
                  <strong>Provider-native Antigravity OAuth</strong>
                  <span>Uses the same Antigravity Google OAuth pattern as 9router/OmniRoute. No custom Google Cloud OAuth app is required.</span>
                </div>

                {!nativeFlowActive ? (
                  <button className="primaryButton" onClick={() => startOAuth("native")} disabled={busy}>
                    {busy ? "Opening Google…" : "Continue with Antigravity"}
                  </button>
                ) : (
                  <>
                    <div className="stepRow"><span>1</span><div><b>Finish Google sign-in</b><p>Choose the Google account and allow access.</p></div></div>
                    <div className="stepRow"><span>2</span><div><b>Copy the localhost callback URL</b><p>Google redirects to localhost. If the page does not load, that is expected — copy the full URL from the address bar.</p></div></div>
                    <label>
                      <span>Callback URL</span>
                      <textarea value={callbackUrl} onChange={(event) => setCallbackUrl(event.target.value)} placeholder="http://localhost:51121/oauth-callback?state=…&code=…" />
                    </label>
                    <button className="primaryButton" onClick={finishOAuth} disabled={busy || !callbackUrl}>
                      {busy ? "Adding…" : "Add to pool"}
                    </button>
                    <button className="secondaryButton" onClick={() => startOAuth("native")} disabled={busy}>Restart sign-in</button>
                  </>
                )}
              </>
            ) : (
              <div className="setupNotice compact">
                <strong>OAuth credentials are missing</strong>
                <span>Configure <code>GOOGLE_OAUTH_CLIENT_ID</code> and <code>GOOGLE_OAUTH_CLIENT_SECRET</code> for one-click login, or configure <code>ANTIGRAVITY_CLIENT_ID</code> and <code>ANTIGRAVITY_CLIENT_SECRET</code> for the manual fallback.</span>
              </div>
            )}
          </div>
        ) : (
          <form className="modalBody" onSubmit={importAccount}>
            <p className="subtle">Paste an existing Antigravity refresh credential. Composite form <code>refresh|project|managedProject</code> is supported.</p>
            <label><span>Account label / email</span><input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="account@gmail.com" /></label>
            <label><span>Refresh credential</span><textarea className="secretArea" value={refreshToken} onChange={(event) => setRefreshToken(event.target.value)} placeholder="refresh token or refresh|project|managed" /></label>
            <label><span>Project ID <em>optional</em></span><input value={projectId} onChange={(event) => setProjectId(event.target.value)} placeholder="Auto-discover when empty" /></label>
            <button className="primaryButton" disabled={busy || !refreshToken}>{busy ? "Encrypting & saving…" : "Import account"}</button>
          </form>
        )}
        {error ? <div className="errorBanner">{error}</div> : null}
      </section>
    </div>
  );
}

export default function DashboardClient() {
  const [status, setStatus] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      const nextStatus = await api("/api/admin/status");
      setStatus(nextStatus);
      if (nextStatus.authenticated) {
        const data = await api("/api/accounts");
        setAccounts(data.accounts || []);
      } else {
        setAccounts([]);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("oauth_error")) return;
    setError("Google OAuth was not completed. Please try again.");
    url.searchParams.delete("oauth_error");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

  const available = useMemo(
    () => accounts.filter((account) => account.enabled && account.status !== "needs_login" && account.cooldownUntil <= Date.now()).length,
    [accounts]
  );

  async function toggleAccount(account) {
    try {
      await api("/api/accounts", { method: "PATCH", body: JSON.stringify({ id: account.id, enabled: !account.enabled }) });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function deleteAccount(account) {
    if (!window.confirm(`Remove ${account.email} from the pool?`)) return;
    try {
      await api("/api/accounts", { method: "DELETE", body: JSON.stringify({ id: account.id }) });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function logout() {
    await api("/api/admin/logout", { method: "POST", body: "{}" });
    await load();
  }

  if (loading) return <main className="loadingShell"><div className="spinner" /></main>;
  if (!status?.authenticated) return <Login status={status} onLogin={load} />;

  return (
    <main className="appShell">
      <header className="topBar">
        <div className="brandLine"><div className="brandMark small">G</div><div><b>Gemini Critic</b><span>Control Center</span></div></div>
        <div className="topActions"><div className="modelPill"><span className="statusDot" />Gemini 3.8 Flash High <b>LOCKED</b></div><button className="ghostButton" onClick={logout}>Sign out</button></div>
      </header>

      <section className="hero">
        <div><div className="eyebrow">REMOTE MCP</div><h1>Account pool</h1><p>Sticky rotation, per-model cooldowns and automatic failover for your authorized Antigravity accounts.</p></div>
        <button className="primaryButton addButton" onClick={() => setShowAdd(true)}><IconPlus /> Add account</button>
      </section>

      {error ? <div className="errorBanner pageError">{error}</div> : null}
      {status.storageError ? <div className="errorBanner pageError">Storage: {status.storageError}</div> : null}
      {!status.mcpProtected ? (
        <div className="setupNotice pageError">
          <strong>MCP endpoint is not bearer-protected</strong>
          <span>This is okay for initial ChatGPT connection testing, but anyone who knows the endpoint may be able to call the critic. Add <code>MCP_SHARED_SECRET</code> only if your ChatGPT MCP setup can send that bearer token.</span>
        </div>
      ) : null}

      <section className="metricsGrid">
        <article className="metric glass"><span>Service</span><strong><i className="liveDot" /> Online</strong><small>/api/mcp</small></article>
        <article className="metric glass"><span>Accounts</span><strong>{accounts.length}</strong><small>{accounts.filter((account) => account.enabled).length} enabled</small></article>
        <article className="metric glass"><span>Available now</span><strong>{available}</strong><small>ready for High</small></article>
        <article className="metric glass"><span>Storage</span><strong>{status.redisConfigured ? "Upstash" : "Missing"}</strong><small>{status.redisConfigured ? "atomic v2 pool" : "connect Redis"}</small></article>
      </section>

      <section className="contentGrid">
        <div className="poolPanel glass">
          <div className="sectionHeader"><div><div className="eyebrow">STICKY ROTATION</div><h2>Accounts</h2></div><span className="countBadge">{accounts.length}</span></div>
          {accounts.length === 0 ? (
            <div className="emptyState"><div className="emptyPlus">+</div><h3>No accounts yet</h3><p>Add the first Antigravity account. Its refresh token is encrypted before it is stored in Redis.</p><button className="secondaryButton" onClick={() => setShowAdd(true)}>Add first account</button></div>
          ) : (
            <div className="accountList">
              {accounts.map((account) => (
                <article className="accountCard" key={account.id}>
                  <div className="accountAvatar">{(account.email || "A").slice(0, 1).toUpperCase()}</div>
                  <div className="accountInfo">
                    <div className="accountTitle"><b>{account.email}</b><span className={`statusBadge ${statusClass(account)}`}>{statusText(account)}</span></div>
                    <div className="accountMeta"><span>Last used: {relativeTime(account.lastUsedAt)}</span>{account.projectId ? <span className="projectId">{account.projectId}</span> : <span>Project auto-discovery</span>}</div>
                  </div>
                  <div className="accountControls">
                    <button className={`toggle ${account.enabled ? "on" : ""}`} onClick={() => toggleAccount(account)} aria-label="Toggle account"><span /></button>
                    <button className="iconButton dangerIcon" onClick={() => deleteAccount(account)} aria-label="Delete account">×</button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        <aside className="sidePanel glass">
          <div className="eyebrow">MCP POLICY</div><h2>Critique only</h2>
          <div className="policyItem"><span>✓</span><div><b>Challenge</b><p>Attacks assumptions, edge cases and weak reasoning.</p></div></div>
          <div className="policyItem"><span>✓</span><div><b>Compare</b><p>Ranks candidate approaches and their trade-offs.</p></div></div>
          <div className="policyItem locked"><span>×</span><div><b>No execution</b><p>No shell, filesystem, git, browser, deploy or MCP tools.</p></div></div>
          <div className="endpointBox"><span>MCP endpoint</span><code>{typeof window !== "undefined" ? `${window.location.origin}/api/mcp` : "/api/mcp"}</code><button onClick={() => navigator.clipboard?.writeText(`${window.location.origin}/api/mcp`)}>Copy</button></div>
        </aside>
      </section>

      {showAdd ? <AddAccountModal status={status} onClose={() => setShowAdd(false)} onAdded={load} /> : null}
    </main>
  );
}
