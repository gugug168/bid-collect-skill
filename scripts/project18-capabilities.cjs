#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { ADAPTERS, PROJECT18_AUDIT_FIELDS } = require("./province-collect.cjs");

const ROOT = path.resolve(__dirname, "..");
const CAPABILITY_PATH = path.join(ROOT, "PROJECT18_CAPABILITIES.json");
const COVERAGE_PATH = path.join(ROOT, "reference", "COVERAGE_MATRIX.md");
const BEGIN = "<!-- PROJECT18_CAPABILITIES:BEGIN -->";
const END = "<!-- PROJECT18_CAPABILITIES:END -->";

const AUDITED_FIELDS = PROJECT18_AUDIT_FIELDS;

const FIELD_STATUSES = [
  "FIELD_VERIFIED_LIST",
  "FIELD_VERIFIED_DETAIL",
  "FIELD_VERIFIED_ATTACHMENT",
  "FIELD_PRESENT_UNPARSED",
  "FIELD_NOT_DISCLOSED",
  "FIELD_NO_SAMPLE",
  "FIELD_RESTRICTED",
  "FIELD_OCR_REQUIRED",
  "FIELD_BROWSER_REQUIRED",
  "FIELD_FAILED",
  "FIELD_UNVERIFIED",
];

const VERIFIED_STATUSES = new Set([
  "FIELD_VERIFIED_LIST",
  "FIELD_VERIFIED_DETAIL",
  "FIELD_VERIFIED_ATTACHMENT",
]);

const STATUS_CODE = {
  FIELD_VERIFIED_LIST: "VL",
  FIELD_VERIFIED_DETAIL: "VD",
  FIELD_VERIFIED_ATTACHMENT: "VA",
  FIELD_PRESENT_UNPARSED: "PU",
  FIELD_NOT_DISCLOSED: "ND",
  FIELD_NO_SAMPLE: "NS",
  FIELD_RESTRICTED: "R",
  FIELD_OCR_REQUIRED: "OCR",
  FIELD_BROWSER_REQUIRED: "BR",
  FIELD_FAILED: "F",
  FIELD_UNVERIFIED: "U",
};

const BOOTSTRAP_EVIDENCE = "bootstrap:inventory-20260820";
const GUANGDONG_EVIDENCE = "fixture:guangdong-project18-gold";
const VERIFIED_AT = "2026-08-20T00:00:00+08:00";
const BASE_COMMIT = "91877ccf73f0d5b1f10f200c9ee0c216c5ae77d2";

function initialStatus(adapter, field) {
  if (adapter !== "guangdong") return "FIELD_UNVERIFIED";
  if (["publishDate", "region", "title", "url"].includes(field)) return "FIELD_VERIFIED_LIST";
  if (["bond", "evaluation", "fullScore"].includes(field)) return "FIELD_VERIFIED_ATTACHMENT";
  return "FIELD_VERIFIED_DETAIL";
}

function createInitialCapabilities() {
  const adapters = {};
  for (const adapter of Object.keys(ADAPTERS)) {
    const fields = {};
    for (const field of AUDITED_FIELDS) {
      fields[field] = {
        status: initialStatus(adapter, field),
        evidence_id: adapter === "guangdong" ? GUANGDONG_EVIDENCE : BOOTSTRAP_EVIDENCE,
        verified_at: VERIFIED_AT,
      };
    }
    adapters[adapter] = { fields };
  }
  return {
    schema_version: "project18-capabilities.v1",
    stage: "zb",
    snapshot_at: VERIFIED_AT,
    audited_fields: AUDITED_FIELDS,
    field_statuses: FIELD_STATUSES,
    evidence: {
      [BOOTSTRAP_EVIDENCE]: {
        kind: "inventory",
        path: "scripts/province-collect.cjs",
        code_commit: BASE_COMMIT,
        code_dirty: false,
        note: "62 adapter bootstrap inventory; FIELD_UNVERIFIED is not a verified capability claim",
      },
      [GUANGDONG_EVIDENCE]: {
        kind: "fixture",
        path: "reference/evidence/guangdong-project18-gold.json",
        code_commit: BASE_COMMIT,
        code_dirty: false,
        note: "Clean-main live verification for Longcheng, Tancun and Kemu official YGP notices",
      },
    },
    adapters,
  };
}

function loadCapabilities() {
  return JSON.parse(fs.readFileSync(CAPABILITY_PATH, "utf8"));
}

function serializeCapabilities(doc) {
  return JSON.stringify(doc, null, 2).replace(
    /(\s*)"([^"]+)": \{\n\s+"status": "([^"]+)",\n\s+"evidence_id": "([^"]+)",\n\s+"verified_at": "([^"]+)"\n\s+\}/g,
    (_match, indent, field, status, evidenceId, verifiedAt) =>
      `${indent}"${field}": {"status":"${status}","evidence_id":"${evidenceId}","verified_at":"${verifiedAt}"}`,
  ) + "\n";
}

function validateCapabilities(doc, options = {}) {
  const errors = [];
  if (!doc || doc.schema_version !== "project18-capabilities.v1") errors.push("invalid schema_version");
  if (doc && doc.stage !== "zb") errors.push("stage must be zb");
  if (JSON.stringify(doc && doc.audited_fields) !== JSON.stringify(AUDITED_FIELDS)) errors.push("audited_fields order mismatch");
  if (JSON.stringify(doc && doc.field_statuses) !== JSON.stringify(FIELD_STATUSES)) errors.push("field_statuses mismatch");

  const expectedAdapters = Object.keys(ADAPTERS).sort();
  const actualAdapters = Object.keys(doc && doc.adapters || {}).sort();
  if (JSON.stringify(actualAdapters) !== JSON.stringify(expectedAdapters)) errors.push("adapter keys mismatch");
  const evidence = doc && doc.evidence || {};
  let cells = 0;
  let unverified = 0;

  for (const adapter of expectedAdapters) {
    const fields = doc && doc.adapters && doc.adapters[adapter] && doc.adapters[adapter].fields || {};
    if (JSON.stringify(Object.keys(fields)) !== JSON.stringify(AUDITED_FIELDS)) errors.push(`${adapter}: field keys/order mismatch`);
    for (const field of AUDITED_FIELDS) {
      cells++;
      const entry = fields[field];
      if (!entry || !FIELD_STATUSES.includes(entry.status)) {
        errors.push(`${adapter}.${field}: invalid status`);
        continue;
      }
      if (entry.status === "FIELD_UNVERIFIED") unverified++;
      if (!entry.evidence_id || !evidence[entry.evidence_id]) errors.push(`${adapter}.${field}: missing evidence`);
      if (!entry.verified_at || Number.isNaN(Date.parse(entry.verified_at))) errors.push(`${adapter}.${field}: invalid verified_at`);
      const ev = evidence[entry.evidence_id];
      if (VERIFIED_STATUSES.has(entry.status) && ev && ev.code_dirty !== false) errors.push(`${adapter}.${field}: verified status backed by dirty evidence`);
    }
  }

  for (const [id, ev] of Object.entries(evidence)) {
    if (!ev || !ev.kind || !ev.path) {
      errors.push(`evidence ${id}: kind/path required`);
      continue;
    }
    const resolved = path.resolve(ROOT, ev.path);
    if (!(resolved === ROOT || resolved.startsWith(ROOT + path.sep))) errors.push(`evidence ${id}: path escapes repository`);
    else if (!fs.existsSync(resolved)) errors.push(`evidence ${id}: path missing`);
  }

  if (cells !== expectedAdapters.length * AUDITED_FIELDS.length) errors.push(`cell count ${cells} != 1054`);
  if (options.requireComplete && unverified) errors.push(`${unverified} FIELD_UNVERIFIED cells remain`);
  return { ok: errors.length === 0, errors, adapter_count: expectedAdapters.length, field_count: AUDITED_FIELDS.length, cells, unverified };
}

function renderProjection(doc) {
  const legend = FIELD_STATUSES.map((status) => `${STATUS_CODE[status]}=${status}`).join("；");
  const lines = [
    BEGIN,
    "## project18 字段能力矩阵（机器真相源投影）",
    "",
    "> 本节由 `PROJECT18_CAPABILITIES.json` 生成，不在 Markdown 中手工维护。运行状态仍以 `ZB_LIVE_STATUS` 为准。",
    "",
    `- 审计范围：${Object.keys(doc.adapters).length} adapter × ${doc.audited_fields.length} 字段 = ${Object.keys(doc.adapters).length * doc.audited_fields.length} 个状态格。`,
    `- 状态代码：${legend}`,
    "",
    `| adapter | ${doc.audited_fields.join(" | ")} |`,
    `|---|${doc.audited_fields.map(() => "---").join("|")}|`,
  ];
  for (const [adapter, row] of Object.entries(doc.adapters)) {
    lines.push(`| ${adapter} | ${doc.audited_fields.map((field) => STATUS_CODE[row.fields[field].status]).join(" | ")} |`);
  }
  lines.push("", END);
  return lines.join("\n");
}

function updateProjection(markdown, projection) {
  const start = markdown.indexOf(BEGIN);
  const end = markdown.indexOf(END);
  if (start >= 0 && end > start) return markdown.slice(0, start) + projection + markdown.slice(end + END.length);
  const firstBreak = markdown.indexOf("\n");
  if (firstBreak < 0) return markdown + "\n\n" + projection + "\n";
  return markdown.slice(0, firstBreak + 1) + "\n" + projection + "\n" + markdown.slice(firstBreak + 1);
}

function projectionMatches(doc) {
  const markdown = fs.readFileSync(COVERAGE_PATH, "utf8");
  const start = markdown.indexOf(BEGIN);
  const end = markdown.indexOf(END);
  if (start < 0 || end <= start) return false;
  return markdown.slice(start, end + END.length) === renderProjection(doc);
}

function main(argv) {
  const command = argv[0] || "--check";
  if (command === "--init") {
    if (fs.existsSync(CAPABILITY_PATH)) throw new Error("PROJECT18_CAPABILITIES.json already exists");
    fs.writeFileSync(CAPABILITY_PATH, serializeCapabilities(createInitialCapabilities()), "utf8");
    return;
  }
  const doc = loadCapabilities();
  if (command === "--format") {
    fs.writeFileSync(CAPABILITY_PATH, serializeCapabilities(doc), "utf8");
    return;
  }
  if (command === "--render") {
    const markdown = fs.readFileSync(COVERAGE_PATH, "utf8");
    fs.writeFileSync(COVERAGE_PATH, updateProjection(markdown, renderProjection(doc)), "utf8");
    return;
  }
  if (command !== "--check" && command !== "--require-complete") throw new Error(`unknown command: ${command}`);
  const report = validateCapabilities(doc, { requireComplete: command === "--require-complete" });
  if (!projectionMatches(doc)) report.errors.push("COVERAGE_MATRIX projection is stale");
  report.ok = report.errors.length === 0;
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 2;
}

if (require.main === module) main(process.argv.slice(2));

module.exports = {
  AUDITED_FIELDS,
  FIELD_STATUSES,
  VERIFIED_STATUSES,
  STATUS_CODE,
  createInitialCapabilities,
  validateCapabilities,
  renderProjection,
  updateProjection,
  projectionMatches,
  serializeCapabilities,
};
