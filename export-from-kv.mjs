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

const NS = "2ebdd7fffa7e417280c03d81f9faab15"; // v0.3専用 LOGS namespace（title: scenario_logs）
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
  const BETA_A_ATTRS = ["income", "location", "hours", "remote", "growth", "stability"];
  const GAMMA_ATTRS = ["location", "hours", "remote", "stability"];
  const MRS_ATTRS = ["location", "hours", "remote", "growth", "stability"];
  const DELTA_ATTRS = ["hours", "remote", "location", "stability"];

  const header = [
    "session_id", "timestamp", "received_at", "app_version",
    ...ATTR_ORDER.map((a) => "count_" + a),
    ...ATTR_ORDER.map((a) => "beta_" + a),
    ...ATTR_ORDER.filter((a) => a !== "income").map((a) => "mrs_" + a),
    "most_hesitated_qid", "fastest_qid", "logit_count_divergence",
    "dominant_passed", "min_response_ms",
    "agreement", "free_text", "answers_json",
    "scenario_order",
    ...BETA_A_ATTRS.map((a) => "beta_A_" + a),
    ...GAMMA_ATTRS.map((a) => "gamma_" + a),
    ...MRS_ATTRS.map((a) => "mrsA_" + a),
    ...MRS_ATTRS.map((a) => "mrsB_" + a),
    ...DELTA_ATTRS.map((a) => "delta_" + a),
    "scale_diff", "fallback_constrained",
    "gender", "grade"
  ];
  const rows = records.map((r) => {
    const scores = r.scores || r.counts || {};
    const quality = r.quality || {};
    const feedback = r.feedback || {};
    const est = r.estimate || {};
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
      JSON.stringify(r.answers || []),
      (r.scenario_order || []).join("|"),
      ...BETA_A_ATTRS.map((a) => (est.beta_A && a in est.beta_A) ? est.beta_A[a] : ""),
      ...GAMMA_ATTRS.map((a) => (est.gamma && a in est.gamma) ? est.gamma[a] : ""),
      ...MRS_ATTRS.map((a) => (est.mrs_A_manyen && a in est.mrs_A_manyen) ? est.mrs_A_manyen[a] : ""),
      ...MRS_ATTRS.map((a) => (est.mrs_B_manyen && a in est.mrs_B_manyen) ? est.mrs_B_manyen[a] : ""),
      ...DELTA_ATTRS.map((a) => (est.delta_wtp_manyen && a in est.delta_wtp_manyen) ? est.delta_wtp_manyen[a] : ""),
      (est.scale_diff != null) ? est.scale_diff : "",
      (est.fallback_constrained != null) ? est.fallback_constrained : "",
      (r.demographics && r.demographics.gender) || "",
      (r.demographics && r.demographics.grade) || ""
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
