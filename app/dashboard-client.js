"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

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
  const [mode, setMode] = useState(status.webOauthConfigured || status.oauthConfigured ? "oauth" : "import");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [flow, setFlow] = useState(null);
  const [callbackUrl, setCallbackUrl] = useState("");
  const [email, setEmail] = useState("");
  const [projectId, setProjectId] = useState("");
  const [refreshToken, setRefreshToken] = useState("");

  useEffect(() => {
    async function onMessage(event) {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== "gemini-critic-oauth") return;
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

  async function startOAuth() {
    setBusy(true);
    setError("");
    try {
      const next = await api("/api/accounts/oauth/start", { method: "POST", body: "{}" });
      setFlow(next);
      const popup = window.open(
        next.authorizationUrl,
        "gemini-critic-google-oauth",
        "popup=yes,width=540,height=760,resizable=yes,scrollbars=yes"
      );
      if (!popup) throw new Error("Browser blocked the Google sign-in window. Allow pop-ups for this site and try again.");
      if (next.mode === "web") popup.focus?.();
      else setBusy(false);
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
          <button className={mode === "oauth" ? "active" : ""} onClick={() => setMode("oauth")}>Google OAuth</button>
          <button className={mode === "import" ? "active" : ""} onClick={() => setMode("import")}>Import credential</button>
        </div>

        {mode === "oauth" ? (
          <div className="modalBody">
            {status.webOauthConfigured ? (
              <>
                <p className="subtle">One-click sign-in. Google opens an account chooser, then the account is encrypted and added to the pool automatically.</p>
                <button className="primaryButton" onClick={startOAuth} disabled={busy}>
                  {busy ? "Waiting for Google…" : "Continue with Google"}
                </button>
                {busy ? <div className="stepRow"><span>✓</span><div><b>Finish Google sign-in</b><p>This window will update automatically after authorization.</p></div></div> : null}
              </>
            ) : status.oauthConfigured ? (
              !flow ? (
                <>
                  <div className="setupNotice compact">
                    <strong>Legacy OAuth is available</strong>
                    <span>For true one-click login create a Google <b>Web application</b> OAuth client and add <code>GOOGLE_OAUTH_CLIENT_ID</code> + <code>GOOGLE_OAUTH_CLIENT_SECRET</code>. You can still use the localhost fallback below.</span>
                  </div>
                  <button className="primaryButton" onClick={startOAuth} disabled={busy}>{busy ? "Preparing…" : "Use legacy Google login"}</button>
                </>
              ) : (
                <>
                  <div className="stepRow"><span>1</span><div><b>Google sign-in opened</b><p>Finish sign-in in the new tab.</p></div></div>
                  <div className="stepRow"><span>2</span><div><b>Copy the final localhost URL</b><p>The localhost page may fail to load. Copy the full address from the browser bar.</p></div></div>
                  <label>
                    <span>Callback URL</span>
                    <textarea value={callbackUrl} onChange={(event) => setCallbackUrl(event.target.value)} placeholder="http://localhost:51121/oauth-callback?state=…&code=…" />
                  </label>
                  <button className="primaryButton" onClick={finishOAuth} disabled={busy || !callbackUrl}>{busy ? "Adding…" : "Add to pool"}</button>
                </>
              )
            ) : (
              <div className="setupNotice compact">
                <strong>Set up Google Web OAuth once</strong>
                <span>Create a Google OAuth client of type <b>Web application</b>, authorize <code>{typeof window !== "undefined" ? `${window.location.origin}/api/accounts/oauth/callback` : "/api/accounts/oauth/callback"}</code>, then add its ID and secret to Vercel as <code>GOOGLE_OAUTH_CLIENT_ID</code> and <code>GOOGLE_OAUTH_CLIENT_SECRET</code>.</span>
              </div>
            )}
          </div>
        ) : (
          <form className="modalBody" onSubmit={importAccount}>
            <p className="subtle">Paste an existing Antigravity refresh credential. Composite form <code>refresh|project|managedProject</code> is supported.</p>
            <label><span>Account label / email</span><input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="account@gmail.com" /></label>
            <label><span>Refresh credential</span><textarea className="secretArea" value={refreshToken} onChange={(e) => setRefreshToken(e.target.value)} placeholder="refresh token or refresh|project|managed" /></label>
            <label><span>Project ID <em>optional</em></span><input value={projectId} onChange={(e) => setProjectId(e.target.value)} placeholder="Auto-discover when empty" /></label>
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

  const available = useMemo(
    () => accounts.filter((account) => account.enabled && account.status !== "needs_login" && account.cooldownUntil <= Date.now()).length,
    [accounts]
  );

  async function toggleAccount(account) {
    try {
      await api("/api/accounts", { method: "PATCH", body: JSON.stringify({ id: account.id, enabled: !account.enabled }) });
      await load();
    } catch (err) { setError(err.message); }
  }

  async function deleteAccount(account) {
    if (!window.confirm(`Remove ${account.email} from the pool?`)) return;
    try {
      await api("/api/accounts", { method: "DELETE", body: JSON.stringify({ id: account.id }) });
      await load();
    } catch (err) { setError(err.message); }
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
        <div><div className="eyebrow">REMOTE MCP</div><h1>Account pool</h1><p>One critic. Multiple Antigravity accounts. Automatic rotation when a quota is hit.</p></div>
        <button className="primaryButton addButton" onClick={() => setShowAdd(true)}><IconPlus /> Add account</button>
      </section>

      {error ? <div className="errorBanner pageError">{error}</div> : null}
      {status.storageError ? <div className="errorBanner pageError">Storage: {status.storageError}</div> : null}

      <section className="metricsGrid">
        <article className="metric glass"><span>Service</span><strong><i className="liveDot" /> Online</strong><small>/api/mcp</small></article>
        <article className="metric glass"><span>Accounts</span><strong>{accounts.length}</strong><small>{accounts.filter((a) => a.enabled).length} enabled</small></article>
        <article className="metric glass"><span>Available now</span><strong>{available}</strong><small>ready for requests</small></article>
        <article className="metric glass"><span>Storage</span><strong>{status.redisConfigured ? "Upstash" : "Missing"}</strong><small>{status.redisConfigured ? "persistent pool" : "connect Redis"}</small></article>
      </section>

      <section className="contentGrid">
        <div className="poolPanel glass">
          <div className="sectionHeader"><div><div className="eyebrow">ROTATION</div><h2>Accounts</h2></div><span className="countBadge">{accounts.length}</span></div>
          {accounts.length === 0 ? (
            <div className="emptyState"><div className="emptyPlus">+</div><h3>No accounts yet</h3><p>Add the first Antigravity account. Its refresh token will be encrypted before it reaches Redis.</p><button className="secondaryButton" onClick={() => setShowAdd(true)}>Add first account</button></div>
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
