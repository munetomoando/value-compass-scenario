/*
 * Cloudflare Workers — 価値観コンパス 回答ログ受信API（設計書 §8.2）
 *
 * エンドポイント:
 *   POST /api/submit   回答ログ(JSON)を受信し KV へ保存（キー: session:<uuid>）
 *
 * ※ データ取得は公開APIを設けず、管理者がアカウント認証済みの wrangler 経由で行う
 *    （リポジトリ直下: node export-from-kv.mjs）。公開の読み取り口は存在しない。
 *
 * バインディング（wrangler.toml で設定）:
 *   LOGS            KV namespace（回答ログ保存先）
 *   ALLOWED_ORIGIN  var: CORS で許可する GitHub Pages のオリジン
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";

    // CORS プリフライト
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(env, origin) });
    }

    if (url.pathname === "/api/submit" && request.method === "POST") {
      return handleSubmit(request, env, origin);
    }

    return new Response("Not Found", { status: 404 });
  }
};

// ===== CORS =====
function corsHeaders(env, origin) {
  const allowed = env.ALLOWED_ORIGIN || "";
  // 設定オリジンと一致する場合のみ許可（GitHub Pages のオリジンのみ）
  const allowOrigin = origin && origin === allowed ? origin : allowed;
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin"
  };
}

function json(body, status, extraHeaders) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: Object.assign({ "Content-Type": "application/json; charset=utf-8" }, extraHeaders || {})
  });
}

// ===== POST /api/submit =====
async function handleSubmit(request, env, origin) {
  const cors = corsHeaders(env, origin);

  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return json({ ok: false, error: "invalid_json" }, 400, cors);
  }

  // 最小限のバリデーション（匿名・個人情報は受け取らない方針: §9.2）
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.answers)) {
    return json({ ok: false, error: "invalid_payload" }, 400, cors);
  }

  // session_id はサーバ側でも検証しつつ、無ければ生成
  const sessionId = typeof payload.session_id === "string" && payload.session_id
    ? payload.session_id
    : crypto.randomUUID();

  // 保存用に正規化（受信値はそのまま保持、サーバ受信時刻を付与）
  const record = {
    session_id: sessionId,
    timestamp: payload.timestamp || new Date().toISOString(),
    received_at: new Date().toISOString(),
    answers: payload.answers,
    scores: payload.scores || null,
    quality: payload.quality || null,
    feedback: payload.feedback || null,
    app_version: payload.app_version || null,
    estimate: payload.estimate || null,
    counts: payload.counts || null,
    decisive: payload.decisive || null,
    framing: payload.framing || null,
    question_order: payload.question_order || null,
    blocks: payload.blocks || null,
    scenario_order: payload.scenario_order || null,
    demographics: payload.demographics || null
  };

  await env.LOGS.put("session:" + sessionId, JSON.stringify(record));

  return json({ ok: true, session_id: sessionId }, 200, cors);
}
