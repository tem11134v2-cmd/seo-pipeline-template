#!/usr/bin/env node
// render-audit-md.mjs
// Детерминированный рендер audit_data.json -> A12.md (markdown-отчёт техаудита).
// Часть шага 5 скила /seo-tehaudit. Творческая работа (что 🔴 vs 🟡, дедуп,
// приложения) - в агенте audit-writer; здесь только шаблонизация в markdown.
//
// Использование:
//   node .claude/scripts/render-audit-md.mjs <audit_dir>
// Вход:  <audit_dir>/audit_data.json
// Выход: <audit_dir>/A12.md
//
// Схема audit_data.json - см. .claude/agents/audit-writer.md и ADR-014.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const auditDirArg = process.argv[2];
if (!auditDirArg) {
  console.error("[render-audit-md] usage: node render-audit-md.mjs <audit_dir>");
  process.exit(1);
}
const auditDir = resolve(auditDirArg);
const dataPath = join(auditDir, "audit_data.json");
if (!existsSync(dataPath)) {
  console.error(`[render-audit-md] not found: ${dataPath}`);
  process.exit(1);
}

const data = JSON.parse(readFileSync(dataPath, "utf8").replace(/^﻿/, ""));

// ── helpers ──
const dash = (s) => String(s ?? "").replace(/[—–]/g, "-");
// markdown table cell: no newlines, escape pipes, hyphens only
const cell = (s) => dash(s).replace(/\r?\n+/g, " ").replace(/\|/g, "\\|").trim();
// inline text (paragraph): keep, only normalize dashes
const inl = (s) => dash(s).trim();

const out = [];
const push = (...l) => out.push(...l);

const domain = data.domain || "сайт";

push(`# Техаудит - ${inl(domain)}`, "");
push(`**Дата аудита:** ${inl(data.audit_date || "")}`);
push(`**Подготовил:** ${inl(data.prepared_by || "TIMUR SEO")}`, "", "---", "");

// ── Карточка сайта ──
if (Array.isArray(data.card) && data.card.length) {
  push("## Карточка сайта", "");
  push("| Параметр | Значение |", "|---|---|");
  for (const row of data.card) {
    push(`| ${cell(row.label)} | ${cell(row.value)} |`);
  }
  push("", "---", "");
}

// ── Итого проблем ──
const c = data.counts || {};
push("## Итого проблем", "");
push("| Приоритет | Количество |", "|---|---|");
push(`| 🔴 Критично | ${c.critical ?? 0} |`);
push(`| 🟡 Важно | ${c.important ?? 0} |`);
push(`| 🟢 Желательно | ${c.nice_to_have ?? 0} |`);
push(`| ✅ Всё ок | ${c.ok ?? 0} проверенных пунктов |`);
if (c.not_checked) push(`| ⚠️ Не удалось проверить | ${c.not_checked} |`);
push("", "---", "");

// ── Проблемы по приоритетам ──
function problemsSection(title, list) {
  if (!Array.isArray(list) || !list.length) return;
  push(`## ${title}`, "");
  push("| № | Проблема | Блок | Детали | Рекомендация |", "|---|---|---|---|---|");
  list.forEach((p, i) => {
    push(`| ${i + 1} | ${cell(p.title)} | ${cell(p.block)} | ${cell(p.details)} | ${cell(p.rec)} |`);
  });
  push("", "---", "");
}
problemsSection("🔴 Критичные проблемы", data.critical_problems);
problemsSection("🟡 Важные проблемы", data.important_problems);
problemsSection("🟢 Желательные улучшения", data.nice_problems);

// ── Проверено - всё ок ──
if (Array.isArray(data.ok_items) && data.ok_items.length) {
  push("## ✅ Проверено - всё ок", "");
  push("| № | Пункт | Статус |", "|---|---|---|");
  data.ok_items.forEach((it, i) => push(`| ${i + 1} | ${cell(it)} | ✅ |`));
  push("", "---", "");
}

// ── Не удалось проверить ──
if (Array.isArray(data.not_checked) && data.not_checked.length) {
  push("## ⚠️ Не удалось проверить", "");
  push("Эти проверки рекомендуется выполнить вручную.", "");
  push("| № | Пункт | Причина |", "|---|---|---|");
  data.not_checked.forEach((it, i) => push(`| ${i + 1} | ${cell(it.item)} | ${cell(it.reason)} |`));
  push("", "---", "");
}

// ── Мета-теги (выборка) ──
const mt = data.meta_table || {};
if (Array.isArray(mt.rows) && mt.rows.length) {
  push(`## ${inl(mt.title || "Мета-теги (выборка)")}`, "");
  push("| URL | Тип | Title (длина) | H1 (кол-во) | Desc (дл.) | Schema.org | Проблемы |",
       "|---|---|---|---|---|---|---|");
  for (const r of mt.rows) {
    push(`| ${cell(r.url)} | ${cell(r.type)} | ${cell(r.title_text)} (${r.title_len ?? 0}) | ` +
         `${cell(r.h1_text)} (${r.h1_count ?? 0}) | ${r.desc_len ?? 0} | ${cell(r.schema)} | ${cell(r.issues)} |`);
  }
  push("", "---", "");
}

// ── Аналитика ──
const a = data.analytics || {};
const hasAnalytics = a.traffic || a.sources || a.bounce_rate || a.backlinks || a.disclaimer ||
  (Array.isArray(a.high_bounce_pages) && a.high_bounce_pages.length);
if (hasAnalytics) {
  push("## Аналитика", "");
  if (a.disclaimer) push(`🟡 ${inl(a.disclaimer)}`, "");
  if (a.traffic) push(`**Трафик:** ${inl(a.traffic)}${a.trend ? `, тренд: ${inl(a.trend)}` : ""}`, "");
  if (a.sources) push(`**Источники:** ${inl(a.sources)}`, "");
  if (a.bounce_rate) push(`**Отказы:** ${inl(a.bounce_rate)}`, "");
  if (a.backlinks) push(`**Ссылочный профиль:** ${inl(a.backlinks)}`, "");
  if (Array.isArray(a.high_bounce_pages) && a.high_bounce_pages.length) {
    push("", "**Страницы с высокими отказами (> 60%):**", "");
    push("| URL | Отказы | Визиты |", "|---|---|---|");
    for (const r of a.high_bounce_pages) push(`| ${cell(r.url)} | ${cell(r.bounce)} | ${cell(r.visits)} |`);
  }
  push("", "---", "");
}

// ── Чеклист для разработчика ──
const cl = data.checklist || {};
const clHas = ["critical", "important", "nice"].some((k) => Array.isArray(cl[k]) && cl[k].length);
if (clHas) {
  push("## Чеклист для разработчика", "");
  const sub = [
    ["🔴 Критично (сделать в первую очередь)", cl.critical],
    ["🟡 Важно (сделать во вторую очередь)", cl.important],
    ["🟢 Желательно (по возможности)", cl.nice],
  ];
  for (const [h, tasks] of sub) {
    if (!Array.isArray(tasks) || !tasks.length) continue;
    push(`### ${h}`, "");
    push("| № | Задача | URL/файл | Где исправлять | Приложение |", "|---|---|---|---|---|");
    tasks.forEach((t, i) => {
      const ap = t.appendix ? `Приложение ${t.appendix}` : "-";
      push(`| ${i + 1} | ${cell(t.task)} | ${cell(t.url)} | ${cell(t.where)} | ${ap} |`);
    });
    push("");
  }
  push("---", "");
}

// ── Приложения ──
if (Array.isArray(data.appendices) && data.appendices.length) {
  push("## Приложения", "");
  data.appendices.forEach((app, idx) => {
    push(`### Приложение ${idx + 1}. ${inl(app.title)}`, "");
    if (app.intro) push(inl(app.intro), "");
    const ct = app.content_type || "text";
    const content = app.content;
    if (ct === "table" && content && Array.isArray(content.headers)) {
      const headers = content.headers.map(cell);
      push(`| ${headers.join(" | ")} |`, `|${headers.map(() => "---").join("|")}|`);
      for (const row of content.rows || []) {
        push(`| ${(row || []).map(cell).join(" | ")} |`);
      }
      push("");
    } else if (ct === "list") {
      for (const item of content || []) push(`- ${inl(item)}`);
      push("");
    } else if (ct === "code") {
      push("```", ...dash(String(content || "")).split(/\r?\n/), "```", "");
    } else if (ct === "diff") {
      push("```diff");
      for (const ln of content || []) push(`${ln.sign} ${dash(ln.line)}`);
      push("```", "");
    } else {
      push(inl(String(content || "")), "");
    }
  });
}

const md = out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
const outPath = join(auditDir, "A12.md");
writeFileSync(outPath, md, "utf8");
console.log(`[render-audit-md] wrote ${outPath} (${Buffer.byteLength(md, "utf8")} bytes)`);
