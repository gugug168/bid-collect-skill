#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function parseArgs(argv) {
  const out = { fields: "", requirePass: false, evidenceDir: "", checkGold: false };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--gold") out.gold = argv[++i];
    else if (arg === "--actual") out.actual = argv[++i];
    else if (arg === "--fields") out.fields = argv[++i] || "";
    else if (arg === "--evidence-dir") out.evidenceDir = argv[++i] || "";
    else if (arg === "--require-pass") out.requirePass = true;
    else if (arg === "--check-gold") out.checkGold = true;
    else if (arg === "--help") out.help = true;
    else throw new Error(`未知参数: ${arg}`);
  }
  return out;
}

function cleanText(value) {
  return String(value == null ? "" : value)
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/（/g, "(").replace(/）/g, ")")
    .replace(/：/g, ":").replace(/，/g, ",").replace(/；/g, ";")
    .replace(/[\s\u200B-\u200D\uFEFF]+/g, " ")
    .trim();
}

function cleanUrl(value) {
  try {
    const u = new URL(String(value || ""));
    u.hash = u.hash; // 明确保留官方 SPA 路由；只规范 host/scheme 默认行为。
    return u.toString().replace(/\/$/, "");
  } catch { return String(value || "").trim().replace(/\/$/, ""); }
}

function moneyNumber(value) {
  const text = cleanText(value).replace(/万元|万|元|分/g, "").replace(/[,，]/g, "");
  return /^-?\d+(?:\.\d+)?$/.test(text) ? Number(text) : Number.NaN;
}

function equalValue(expected, actual, comparison, tolerance) {
  const e = String(expected == null ? "" : expected);
  const a = String(actual == null ? "" : actual);
  if (comparison === "money_or_controlled_text") {
    const en = moneyNumber(e), an = moneyNumber(a);
    if (Number.isFinite(en) && Number.isFinite(an)) return Math.abs(en - an) <= tolerance;
    return cleanText(e) === cleanText(a);
  }
  if (comparison === "date") return cleanText(e).slice(0, 10) === cleanText(a).slice(0, 10);
  if (comparison === "datetime_minute") return cleanText(e).replace("T", " ").slice(0, 16) === cleanText(a).replace("T", " ").slice(0, 16);
  if (comparison === "url") return cleanUrl(e) === cleanUrl(a);
  return cleanText(e) === cleanText(a);
}

function verifyGold(doc) {
  const errors = [];
  if (doc.schema_version !== "nationwide-100-gold.v2") errors.push("schema_version");
  if (!Array.isArray(doc.fields) || doc.fields.length !== 17) errors.push("fields");
  if (!Array.isArray(doc.samples) || doc.samples.length !== 100) errors.push("samples");
  const ids = new Set();
  const urls = new Set();
  for (const sample of doc.samples || []) {
    if (!sample.sample_id || ids.has(sample.sample_id)) errors.push(`sample_id:${sample.sample_id}`);
    ids.add(sample.sample_id);
    if (!sample.official_url || urls.has(sample.official_url)) errors.push(`official_url:${sample.sample_id}`);
    urls.add(sample.official_url);
    for (const field of doc.fields || []) {
      const item = sample.expected && sample.expected[field];
      if (!item || !["VALUE", "NOT_DISCLOSED", "NOT_DISCLOSED_OR_RESTRICTED", "REVIEW"].includes(item.state)) errors.push(`${sample.sample_id}.${field}`);
    }
  }
  if (!Array.isArray(doc.stage_negatives) || !doc.stage_negatives.length) errors.push("stage_negatives");
  return errors;
}

function verifyEvidence(doc, evidenceDir, selectedFields) {
  if (!evidenceDir) return ["EVIDENCE_DIR_MISSING"];
  const errors = [];
  const checked = new Set();
  for (const sample of doc.samples) {
    for (const field of selectedFields) {
      for (const evidenceId of sample.expected[field].evidence || []) {
        const evidence = doc.evidence_index && doc.evidence_index[evidenceId];
        if (!evidence || !evidence.sha256 || checked.has(evidenceId)) continue;
        checked.add(evidenceId);
        const metaPath = path.join(evidenceDir, evidenceId);
        if (!fs.existsSync(metaPath)) { errors.push(`missing:${evidenceId}`); continue; }
        let meta;
        try { meta = JSON.parse(fs.readFileSync(metaPath, "utf8")); } catch { errors.push(`invalid:${evidenceId}`); continue; }
        const bodyPath = String(meta.body_path || "");
        if (!bodyPath || !fs.existsSync(bodyPath)) { errors.push(`body_missing:${evidenceId}`); continue; }
        const hash = crypto.createHash("sha256").update(fs.readFileSync(bodyPath)).digest("hex");
        if (hash !== evidence.sha256) errors.push(`hash:${evidenceId}`);
      }
    }
  }
  return errors;
}

function ratio(n, d) { return d ? n / d : null; }

function main() {
  let args;
  try { args = parseArgs(process.argv); } catch (error) { console.error(JSON.stringify({ status: "INVALID_ARGS", error: error.message })); process.exit(2); }
  if (args.help) {
    console.log("用法: node scripts/accuracy-audit.cjs --gold <gold.json> [--actual <actual.json>] [--fields a,b] [--evidence-dir <dir>] [--check-gold] [--require-pass]");
    return;
  }
  if (!args.gold || !fs.existsSync(args.gold)) { console.error(JSON.stringify({ status: "EVIDENCE_MISSING", error: "gold missing" })); process.exit(3); }
  const gold = JSON.parse(fs.readFileSync(args.gold, "utf8"));
  const goldErrors = verifyGold(gold);
  if (goldErrors.length) { console.error(JSON.stringify({ status: "INVALID_GOLD", errors: goldErrors }, null, 2)); process.exit(2); }
  if (args.checkGold && !args.actual) {
    const reviewCells = gold.samples.flatMap((sample) => gold.fields.map((field) => sample.expected[field])).filter((item) => item.state === "REVIEW").length;
    console.log(JSON.stringify({ status: reviewCells ? "INCOMPLETE" : "GOLD_VALID", samples: 100, fields: 17, review_cells: reviewCells }, null, 2));
    process.exit(reviewCells ? 3 : 0);
  }
  if (!args.actual || !fs.existsSync(args.actual)) { console.error(JSON.stringify({ status: "EVIDENCE_MISSING", error: "actual missing" })); process.exit(3); }
  const actualDoc = JSON.parse(fs.readFileSync(args.actual, "utf8"));
  const actualSamples = new Map((actualDoc.samples || actualDoc).map((sample) => [sample.sample_id, sample]));
  const selectedFields = args.fields ? args.fields.split(",").map((x) => x.trim()).filter(Boolean) : gold.fields;
  for (const field of selectedFields) if (!gold.fields.includes(field)) { console.error(JSON.stringify({ status: "INVALID_ARGS", error: `unknown field ${field}` })); process.exit(2); }
  const evidenceErrors = args.requirePass ? verifyEvidence(gold, args.evidenceDir, selectedFields) : [];
  const byField = {};
  let reviewCells = 0;
  let missingSamples = 0;
  for (const field of selectedFields) byField[field] = { correct: 0, wrong: 0, false_positive: 0, false_negative: 0, excluded: 0 };
  const failures = [];
  for (const sample of gold.samples) {
    const actual = actualSamples.get(sample.sample_id);
    if (!actual) missingSamples++;
    for (const field of selectedFields) {
      const exp = sample.expected[field];
      const got = actual ? String(actual[field] == null ? "" : actual[field]).trim() : "";
      const stat = byField[field];
      if (exp.state === "REVIEW") { reviewCells++; continue; }
      if (exp.state === "VALUE") {
        if (!got) { stat.false_negative++; failures.push({ sample_id: sample.sample_id, field, kind: "FALSE_NEGATIVE", expected: exp.value, actual: got }); }
        else if (equalValue(exp.value, got, exp.comparison, gold.comparison_contract.money_tolerance_wan)) stat.correct++;
        else { stat.wrong++; failures.push({ sample_id: sample.sample_id, field, kind: "WRONG", expected: exp.value, actual: got }); }
      } else if (got) {
        stat.false_positive++;
        failures.push({ sample_id: sample.sample_id, field, kind: "FALSE_POSITIVE", expected: "", actual: got, reason: exp.reason });
      } else stat.excluded++;
    }
  }
  let correct = 0, wrong = 0, fp = 0, fn = 0, excluded = 0;
  for (const stat of Object.values(byField)) {
    stat.union_denominator = stat.correct + stat.wrong + stat.false_positive + stat.false_negative;
    stat.union_accuracy = ratio(stat.correct, stat.union_denominator);
    stat.precision = ratio(stat.correct, stat.correct + stat.wrong + stat.false_positive);
    stat.recall = ratio(stat.correct, stat.correct + stat.wrong + stat.false_negative);
    correct += stat.correct; wrong += stat.wrong; fp += stat.false_positive; fn += stat.false_negative; excluded += stat.excluded;
  }
  const stageResults = new Map((actualDoc.stage_results || []).map((row) => [row.sample_id, row]));
  const stageNegativeFailures = gold.stage_negatives.filter((row) => stageResults.get(row.sample_id)?.emitted !== false);
  const metrics = {
    union_accuracy: ratio(correct, correct + wrong + fp + fn),
    precision: ratio(correct, correct + wrong + fp),
    recall: ratio(correct, correct + wrong + fn),
  };
  const hard = ["publishDate", "region", "title", "url"];
  const hardPass = hard.every((field) => byField[field] && byField[field].wrong === 0 && byField[field].false_positive === 0 && byField[field].false_negative === 0);
  const detailGate = selectedFields.filter((field) => !hard.includes(field)).every((field) => {
    const stat = byField[field];
    if (stat.union_denominator < 20) return stat.wrong + stat.false_positive + stat.false_negative === 0;
    return stat.union_accuracy >= 0.95 && stat.precision >= 0.95 && stat.recall >= 0.95;
  });
  const overallGate = metrics.union_accuracy >= 0.95 && metrics.precision >= 0.95 && metrics.recall >= 0.95;
  const status = reviewCells || missingSamples || evidenceErrors.length ? "INCOMPLETE" : (hardPass && detailGate && overallGate && !stageNegativeFailures.length ? "PASS" : "FAIL");
  const result = {
    status,
    selected_fields: selectedFields,
    samples_expected: gold.samples.length,
    samples_actual: actualSamples.size,
    missing_samples: missingSamples,
    review_cells: reviewCells,
    evidence_errors: evidenceErrors,
    stage_negative_failures: stageNegativeFailures,
    totals: { correct, wrong, false_positive: fp, false_negative: fn, excluded, ...metrics },
    by_field: byField,
    failures,
  };
  console.log(JSON.stringify(result, null, 2));
  if (status === "INCOMPLETE") process.exit(3);
  if (args.requirePass && status !== "PASS") process.exit(1);
}

main();
