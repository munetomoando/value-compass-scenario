import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import E from "../estimate.js";

const data = JSON.parse(readFileSync(new URL("../questions.json", import.meta.url)));
const { meta, questions } = data;

function choiceA(q){
  if (+q.A.income !== +q.B.income) return +q.A.income > +q.B.income ? "A" : "B";
  return "A";
}
function choiceB(q){
  for (const k of ["remote","hours","location"]) {
    const good = {remote:"可",hours:"少",location:"なし"}[k];
    if (q.A[k] === good && q.B[k] !== good) return "A";
    if (q.B[k] === good && q.A[k] !== good) return "B";
  }
  return +q.A.income > +q.B.income ? "A" : "B";
}
function synth(){
  return questions.filter(q => q.scored).map(q => ({
    q_id: q.id,
    choice: q.scenario === "A" ? choiceA(q) : choiceB(q),
    response_ms: 5000,
    scenario: q.scenario
  }));
}

test("estimate2 は beta_A/beta_B/gamma/mrs/delta を返す", () => {
  const r = E.estimate2(questions, meta, synth());
  for (const a of meta.attribute_order) {
    assert.ok(Number.isFinite(r.beta_A[a]), `beta_A.${a}`);
    assert.ok(Number.isFinite(r.beta_B[a]), `beta_B.${a}`);
    assert.ok(Number.isFinite(r.gamma[a]), `gamma.${a}`);
  }
  assert.ok("mrs_A_manyen" in r && "mrs_B_manyen" in r && "delta_wtp_manyen" in r);
  assert.ok(typeof r.scale_diff === "number");
  assert.equal(typeof r.fallback_constrained, "boolean");
});

test("育児シナリオで在宅の価値が上がる（gamma.remote>0, delta.remote>0）", () => {
  const r = E.estimate2(questions, meta, synth());
  assert.ok(r.gamma.remote > 0, `gamma.remote=${r.gamma.remote}`);
  if (r.mrs_A_manyen.remote !== null && r.mrs_B_manyen.remote !== null) {
    assert.ok(r.delta_wtp_manyen.remote > 0, `delta.remote=${r.delta_wtp_manyen.remote}`);
  }
});

test("MRSは ±500 でクリップされ 5万円刻み", () => {
  const r = E.estimate2(questions, meta, synth());
  for (const m of [r.mrs_A_manyen, r.mrs_B_manyen]) {
    for (const a of Object.keys(m)) {
      if (m[a] === null) continue;
      assert.ok(m[a] >= -500 && m[a] <= 500);
      assert.equal(m[a] % 5, 0);
    }
  }
});

test("交互作用を4属性に限定したフォールバックでは gamma.income/growth が0", () => {
  const r = E.estimate2(questions, meta, synth(), { forceConstrained: true });
  assert.equal(r.gamma.income, 0);
  assert.equal(r.gamma.growth, 0);
  assert.equal(r.fallback_constrained, true);
});
