/*
 * export-from-kv.mjs — 回答ログCSVを取得する（公開APIを使わず、wrangler=アカウント認証経由）
 *
 * 使い方: リポジトリ直下で  node export-from-kv.mjs
 *   事前に `wrangler login` 済みであること。
 *   出力: value-compass-logs.csv（UTF-8 BOM付き）
 *
 * 公開の /api/export は廃止したため、データ取得はこの管理者専用ツールで行う。
 */
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const NS = "c5bf6d8e591c4297a01ba3d113f9e4bd"; // 本番 LOGS namespace
const ATTR_ORDER = ["income", "location", "hours", "remote", "growth", "stability"];

function wrangler(args) {
  // stdout のみ取得（バナーは stderr 経由で端末に出る）
  return execSync("wrangler " + args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}

// wrangler 出力からJSON部分（先頭の [ または {）以降を取り出して parse
function parseJsonOutput(out, open) {
  const i = out.indexOf(open);
  if (i < 0) throw new Error("JSON出力が見つかりません:\n" + out);
  return JSON.parse(out.slice(i));
}

function csvEscape(val) {
  if (val === null || val === undefined) return "";
  let s = String(val);
  const isNumber = /^-?\d+(\.\d+)?$/.test(s);                 // 負の数値は数式扱いしない
  if (!isNumber && /^[=+\-@\t\r]/.test(s)) s = "'" + s;       // 数式インジェクション対策
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function toCsv(records) {
  const header = [
    "session_id", "timestamp", "received_at", "app_version",
    ...ATTR_ORDER.map((a) => "count_" + a),
    ...ATTR_ORDER.map((a) => "beta_" + a),
    ...ATTR_ORDER.filter((a) => a !== "income").map((a) => "mrs_" + a),
    "most_hesitated_qid", "fastest_qid", "logit_count_divergence",
    "dominant_passed", "min_response_ms",
    "agreement", "free_text", "answers_json"
  ];
  const rows = records.map((r) => {
    const scores = r.scores || r.counts || {};
    const quality = r.quality || {};
    const feedback = r.feedback || {};
    return [
      r.session_id, r.timestamp, r.received_at, r.app_version,
      ...ATTR_ORDER.map((a) => (a in scores ? scores[a] : "")),
      ...ATTR_ORDER.map((a) => (r.estimate && r.estimate.beta && a in r.estimate.beta) ? r.estimate.beta[a] : ""),
      ...ATTR_ORDER.filter((a) => a !== "income").map((a) => (r.estimate && r.estimate.mrs_manyen && a in r.estimate.mrs_manyen) ? r.estimate.mrs_manyen[a] : ""),
      (r.decisive && r.decisive.most_hesitated_qid) || "",
      (r.decisive && r.decisive.fastest_qid) || "",
      (quality.logit_count_divergence != null) ? quality.logit_count_divergence : "",
      quality.dominant_passed, quality.min_response_ms,
      feedback.agreement, feedback.free_text,
      JSON.stringify(r.answers || [])
    ].map(csvEscape).join(",");
  });
  return [header.map(csvEscape).join(","), ...rows].join("\n") + "\n";
}

console.log("KVからキー一覧を取得中…");
const keys = parseJsonOutput(wrangler(`kv key list --namespace-id ${NS} --remote`), "[")
  .map((k) => k.name)
  .filter((n) => n.startsWith("session:"));
console.log(`${keys.length} 件の回答を取得します…`);

const records = [];
for (const key of keys) {
  const out = wrangler(`kv key get "${key}" --namespace-id ${NS} --remote`);
  try {
    records.push(parseJsonOutput(out, "{"));
  } catch (e) {
    console.warn(`  ⚠ 解析できないレコードをスキップ: ${key}`);
  }
}

writeFileSync("value-compass-logs.csv", "﻿" + toCsv(records));
console.log(`✓ ${records.length} 件を value-compass-logs.csv に保存しました（UTF-8 BOM付き）`);
