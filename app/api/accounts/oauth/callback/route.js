import { finishOAuthCallback } from "../../../../../src/accounts/oauth.js";
import { addAccount } from "../../../../../src/accounts/store.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function popupHtml({ ok, message, email = "", origin }) {
  const payload = JSON.stringify({ type: "gemini-critic-oauth", ok, message, email }).replace(/</g, "\\u003c");
  const targetOrigin = JSON.stringify(origin).replace(/</g, "\\u003c");
  const title = ok ? "Account added" : "OAuth failed";
  const body = ok
    ? `${email || "Google account"} was added to the pool. You can close this window.`
    : message;
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{margin:0;background:#09090c;color:#f7f7fb;font-family:system-ui,-apple-system,sans-serif;display:grid;min-height:100vh;place-items:center;padding:24px;box-sizing:border-box}.card{max-width:420px;padding:28px;border:1px solid #2b2b35;border-radius:28px;background:#15151bcc;box-shadow:0 24px 80px #0008}h1{margin:0 0 10px;font-size:28px}p{color:#b8b8c6;line-height:1.5}.dot{width:12px;height:12px;border-radius:50%;background:${ok ? "#5de1b5" : "#ff6b7a"};display:inline-block;margin-right:8px}</style></head>
<body><div class="card"><h1><span class="dot"></span>${title}</h1><p>${String(body).replace(/[<>&]/g, "")}</p></div>
<script>try{if(window.opener){window.opener.postMessage(${payload},${targetOrigin});setTimeout(()=>window.close(),500)}}catch(e){}</script></body></html>`;
}

export async function GET(request) {
  const url = new URL(request.url);
  const origin = url.origin;
  try {
    const credentials = await finishOAuthCallback({
      state: url.searchParams.get("state"),
      code: url.searchParams.get("code"),
      error: url.searchParams.get("error")
    });
    const account = await addAccount({
      email: credentials.email,
      projectId: credentials.projectId,
      refreshToken: credentials.refreshToken,
      oauthClientType: credentials.oauthClientType
    });
    return new Response(popupHtml({ ok: true, message: "Account added", email: account.email, origin }), {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(popupHtml({ ok: false, message, origin }), {
      status: 400,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }
    });
  }
}
