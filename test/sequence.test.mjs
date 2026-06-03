import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import S from "../sequence.js";

const data = JSON.parse(readFileSync(new URL("../questions.json", import.meta.url)));

test("シーケンスは 練習1 + 本番20 + 支配1 = 22 要素", () => {
  const seq = S.buildSequence(data.questions, () => 0.5);
  assert.equal(seq.length, 22);
  assert.equal(seq.filter(q => q.type === "practice").length, 1);
  assert.equal(seq.filter(q => q.type === "main").length, 20);
  assert.equal(seq.filter(q => q.type === "dominant").length, 1);
});

test("各本番設問に scenario が付き、同一シナリオは連続ブロックになる", () => {
  const seq = S.buildSequence(data.questions, () => 0.5);
  const mains = seq.filter(q => q.type === "main");
  const firstScenario = mains[0].scenario;
  for (let i = 0; i < 10; i++) assert.equal(mains[i].scenario, firstScenario);
  for (let i = 10; i < 20; i++) assert.notEqual(mains[i].scenario, firstScenario);
});

test("提示順はrandで反転する（A先/B先）", () => {
  const seqLow = S.buildSequence(data.questions, () => 0.1);
  const seqHigh = S.buildSequence(data.questions, () => 0.9);
  const first = s => s.filter(q => q.type === "main")[0].scenario;
  assert.notEqual(first(seqLow), first(seqHigh));
});
