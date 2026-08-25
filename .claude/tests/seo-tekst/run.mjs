#!/usr/bin/env node
// run.mjs - smoke-тесты /seo-tekst v7 (программа 2026-08-22, ADR-038/039).
// Запуск: .claude\scripts\_node.cmd .claude\tests\seo-tekst\run.mjs
//
// Секции:
//   read-tekst-input.mjs v2 - мост «анализ -> тексты» (контракты 2.1-2.4):
//     --from-analysis (пустой pages.json + inputs/leader_blocks/facts), --from-draft
//     (финал после гейта состава), --from-structure (русские типы + спаривание dir_slug),
//     --from-table (аварийный ручной). Флага --from-brief в v7 НЕТ.
//   прототип v2 (ADR-039): render -> site_manifest -> assemble -> verify (этап C)
//   verify-copy.mjs: механический слой COPY-AUDIT, регистр НОВОЙ формы
//     {tone_id, axes, source} (контракт 3.2), --root для тон-вариантов (контракт 3.4),
//     продающий пол ADR-037, сверка с blueprint
//   build-handoff.mjs: пометки для верстки, контракт передачи (Texts.docx в v7.1
//     удален совсем - деливерабл текстов = прототип, build-tekst-docx.mjs не существует)
//   build-skeletons-docx.mjs: клиентский docx гейта скелетов (v7.1, контракт 3.3а)
//   диета писателя В ЗНАКАХ (ADR-020/037)
//
// Exit 0 - все тесты прошли. Exit 1 - есть провал.

import { spawnSync } from "node:child_process";
import { writeFileSync, readFileSync, readdirSync, statSync, existsSync, mkdirSync, rmSync, cpSync } from "node:fs";
import { join, resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../../..");
// Песочница уникальна на прогон. Фиксированная папка ловила залоченный файл от прошлого
// прогона и валила ВЕСЬ набор на очистке - до первой строки отчета. Уникальное имя
// (pid + время) убирает гонку, а чужие песочницы подметаются мягко, в try/catch.
const TMP_ROOT = join(PROJECT_ROOT, ".claude/tmp");
const SANDBOX_PREFIX = "seo-tekst-test";
const SANDBOX = join(TMP_ROOT, `${SANDBOX_PREFIX}-${process.pid}-${Date.now().toString(36)}`);

// Мягкое удаление: залоченный файл (антивирус, открытый проводник, чужой прогон) -
// это не повод ронять набор. Сообщаем и идем дальше.
function softRm(path) {
  try {
    rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    return true;
  } catch (err) {
    console.log(`  [note] не удалось убрать ${path}: ${err.code || err.message} - пропускаю`);
    return false;
  }
}

// Метем только ОСТЫВШИЕ песочницы: свежая может принадлежать параллельному прогону
// (CI гоняет набор в несколько заходов), и снести ее на ходу - это чужой красный набор.
const SWEEP_AGE_MS = 30 * 60 * 1000;
function sweepOldSandboxes() {
  try {
    if (!existsSync(TMP_ROOT)) return;
    for (const name of readdirSync(TMP_ROOT)) {
      if (!name.startsWith(SANDBOX_PREFIX) || name === basename(SANDBOX)) continue;
      const path = join(TMP_ROOT, name);
      try {
        if (Date.now() - statSync(path).mtimeMs < SWEEP_AGE_MS) continue;
      } catch { /* исчезла сама - и хорошо */ continue; }
      softRm(path);
    }
  } catch (err) {
    console.log(`  [note] обход старых песочниц не удался: ${err.code || err.message} - пропускаю`);
  }
}
const READ_INPUT = join(PROJECT_ROOT, ".claude/scripts/read-tekst-input.mjs");

// === Мини-фреймворк (по образцу tests/seo-temi/run.mjs) ===
let passed = 0;
let failed = 0;
const failures = [];

function step(name, fn) {
  try {
    const result = fn();
    if (result === true || result === undefined) {
      console.log(`  [test] ${name} ... PASS`);
      passed++;
    } else {
      console.log(`  [test] ${name} ... FAIL (${result})`);
      failed++;
      failures.push(`${name}: ${result}`);
    }
  } catch (err) {
    console.log(`  [test] ${name} ... FAIL (${err.message})`);
    failed++;
    failures.push(`${name}: ${err.message}`);
  }
}

// spawnSync, а не execFileSync: stderr нужен и на УСПЕШНОМ прогоне - мост печатает
// туда предупреждения (нераспознанные типы, отсутствие данных анализа), и тесты их сверяют.
function run(args) {
  const r = spawnSync(process.execPath, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return { code: r.status ?? 1, stdout: String(r.stdout || ""), stderr: String(r.stderr || "") };
}

const readJson = (p) => JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, ""));

// docx - это zip; читаем его средствами node (zlib), без внешних процессов и без временных копий.
// Раньше здесь была PowerShell-распаковка: Expand-Archive требует расширение .zip, поэтому рядом
// заводилась копия docx под .zip-именем - и она оставалась залоченной, роняя следующий прогон.
// Достаем ровно одну запись из центрального каталога zip; ZIP64 тут не нужен, документы мелкие.
function zipEntry(buf, name) {
  let eocd = -1;
  const floor = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= floor; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("не найден конец zip-каталога - файл повреждён или это не docx");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("битая запись центрального каталога zip");
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    if (buf.toString("utf8", p + 46, p + 46 + nlen) === name) {
      if (buf.readUInt32LE(lho) !== 0x04034b50) throw new Error("битый локальный заголовок zip");
      const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
      const data = buf.subarray(start, start + csize);
      if (method === 0) return data;
      if (method === 8) return inflateRawSync(data);
      throw new Error(`неизвестный метод сжатия zip: ${method}`);
    }
    p += 46 + nlen + elen + clen;
  }
  throw new Error(`в docx нет записи ${name}`);
}

function docxText(docxPath) {
  let xml;
  try {
    xml = zipEntry(readFileSync(docxPath), "word/document.xml").toString("utf8");
  } catch (err) {
    // Внятный FAIL вместо краха набора: видно, какой файл и на чем распаковка встала.
    throw new Error(`распаковка ${basename(docxPath)} не удалась: ${err.code || err.message}`);
  }
  return {
    text: (xml.match(/<w:t[^>]*>[^<]*<\/w:t>/g) || []).map((t) => t.replace(/<[^>]+>/g, "")).join("\n"),
    bulletCount: (xml.match(/<w:numPr>/g) || []).length,
  };
}

// === Фикстуры ===
sweepOldSandboxes();
try {
  mkdirSync(SANDBOX, { recursive: true });
} catch (err) {
  console.error(`[fatal] не создать песочницу ${SANDBOX}: ${err.code || err.message}`);
  process.exit(1);
}

// ──────────────────────────────────────────────────────────────────────────
console.log("=== read-tekst-input.mjs v2: мост анализ -> тексты (контракты 2.1-2.4) ===");
// ──────────────────────────────────────────────────────────────────────────

// Фикстура анализа (analyses/NNN как после этапа A): brief.json с directions[],
// leader_scan.json v2 (blocks_by_type + features_to_steal), intake.json с фактами -
// включая подтвержденный own_page-факт (контракт 1.5: source "own_page:<url>").
const dirAnalysis = join(SANDBOX, "analysis-fx");
mkdirSync(dirAnalysis, { recursive: true });
writeFileSync(join(dirAnalysis, "meta.json"), JSON.stringify({ tier: "seo", state: "completed" }), "utf8");
writeFileSync(join(dirAnalysis, "brief.json"), JSON.stringify({
  slug: "ventkazan", domain: "ventpro.ru", region: "Казань",
  directions: [
    { dir_slug: "montazh-otopleniya", name: "Монтаж отопления", source: "assortment", marker_hint: "монтаж отопления под ключ", url: "https://ventpro.ru/otoplenie/" },
    { dir_slug: "montazh-ventilyacii", name: "Монтаж вентиляции", source: "client_pages", marker_hint: "монтаж вентиляции цена", url: null },
  ],
}, null, 2), "utf8");
writeFileSync(join(dirAnalysis, "leader_scan.json"), JSON.stringify({
  leaders: [{ domain: "lider.ru" }],
  summary: { note: "фикстура" },
  blocks_by_type: {
    "Услуга": [{ block: "Первый экран (Hero)", coverage: 1, typical_order: 1 }],
    "Категория": [{ block: "Листинг товаров", coverage: 0.8, typical_order: 2 }],
  },
  features_to_steal: [{ feature: "калькулятор на первом экране", seen_at: "lider.ru", page_type: "Услуга" }],
}, null, 2), "utf8");
writeFileSync(join(dirAnalysis, "intake.json"), JSON.stringify({
  sources: [{ id: "s1", label: "созвон 12.08" }],
  facts: [
    { field: "numbers", value: "137 объектов сдано", source: "s1" },
    { field: "numbers", value: "12 монтажных бригад", source: "own_page:https://ventpro.ru/otoplenie/", quote: "12 монтажных бригад", decision_impact: true },
    { field: "guarantee", value: "3 года на монтаж по договору", source: "own_page:https://ventpro.ru/otoplenie/", decision_impact: true },
    { field: "requisites", value: "ООО ВентПро", source: "s1" },
    { field: "requisites", value: "ИНН 1650123456", source: "s1" },
    { field: "client_wordings", value: "под ключ и без субподряда", source: "s1" },
  ],
}, null, 2), "utf8");

const dirBridge = join(SANDBOX, "bridge-analysis");
mkdirSync(dirBridge, { recursive: true });

step("--from-analysis: pages.json ПУСТОЙ с source pages_draft (состав решает гейт, не мост)", () => {
  const r = run([READ_INPUT, dirBridge, "--from-analysis", dirAnalysis]);
  if (r.code !== 0) return `exit ${r.code}: ${r.stderr}`;
  const pages = readJson(join(dirBridge, "pages.json"));
  if (pages.source !== "pages_draft") return `source = ${pages.source}`;
  if (pages.count !== 0 || pages.pages.length) return `pages.json не пустой (count ${pages.count}) - мост решил состав за гейт`;
  return true;
});

step("--from-analysis: inputs.json несет analysis_dir + tier из meta анализа", () => {
  const inputs = readJson(join(dirBridge, "inputs.json"));
  if (!inputs.analysis_dir) return "analysis_dir пуст";
  if (inputs.tier !== "seo") return `tier = ${inputs.tier}, ожидался seo`;
  if (inputs.slug !== "ventkazan") return `slug = ${inputs.slug}`;
  return true;
});

step("выжимка leader_blocks.json: blocks_by_type + features_to_steal из leader_scan v2", () => {
  const lb = readJson(join(dirBridge, "leader_blocks.json"));
  if (!lb.blocks_by_type || !lb.blocks_by_type["Категория"]) return "blocks_by_type[Категория] не доехал";
  if (lb.blocks_by_type["Категория"][0].block !== "Листинг товаров") return "имя блока из словаря BLOCKS.md потеряно";
  if (!Array.isArray(lb.features_to_steal) || !lb.features_to_steal.length) return "features_to_steal пусты";
  if (lb.features_to_steal[0].feature !== "калькулятор на первом экране") return "фишка лидера потеряна";
  return true;
});

step("семена facts.json из intake: числа дословно, ВКЛЮЧАЯ own_page-факт (контракт 1.5)", () => {
  const facts = readJson(join(dirBridge, "facts.json"));
  const values = (facts.numbers || []).map((n) => n.value);
  if (!values.includes("137 объектов сдано")) return `число интейка не доехало: ${JSON.stringify(values)}`;
  if (!values.includes("12 монтажных бригад")) return "own_page-факт (numbers) не доехал до facts.json";
  if (!/3 года на монтаж по договору/.test(String(facts.product_guarantee && facts.product_guarantee.guarantee))) return "own_page-гарантия не доехала";
  if (facts.jur.entity !== "ООО ВентПро") return `jur.entity = ${facts.jur.entity}`;
  if (facts.jur.requisites.inn !== "1650123456") return `ИНН = ${facts.jur.requisites.inn}`;
  const locked = ((facts.lexicon && facts.lexicon.locked) || []).map((l) => l.phrase);
  if (locked.length !== 0) return `client_wordings НЕ должны сеяться в lexicon.locked автоматически (правило трех оснований, сверка B): ${JSON.stringify(locked)}`;
  return true;
});

// ── Засев facts.json: реквизиты и publish (боевой прогон save-arch-soft, 24.08) ──
// Три дефекта одного шва, каждый доезжал бы до живого сайта: ИНН склеивался из ВСЕХ цифр
// строки; publish:"as-is" ставился всем числам подряд, включая снятые заказчиком и чужие;
// label оставался пустым и размечался руками. Тестов на них не было - потому и не поймали.
const dirSeedAn = join(SANDBOX, "seed-analysis");
mkdirSync(dirSeedAn, { recursive: true });
writeFileSync(join(dirSeedAn, "meta.json"), JSON.stringify({ tier: "basic", state: "completed" }), "utf8");
writeFileSync(join(dirSeedAn, "brief.json"), JSON.stringify({
  slug: "save", domain: "saveschool.online", region: "Россия, формат полностью онлайн",
  forbidden_wordings: ["Софт Культура - больше 10 лет на рынке"],
}, null, 2), "utf8");
writeFileSync(join(dirSeedAn, "intake.json"), JSON.stringify({
  sources: [{ id: "s1", label: "созвон" }],
  facts: [
    // Дословный факт боевого интейка: ИНН + дата подтверждения + номер вопроса в одной строке.
    { field: "requisites", kind: "inn", value: "ИНН 240405032019 - в подвале прошлого лендинга. Требует подтверждения (подтверждено заказчиком 23.08.2026, ответ на вопрос 3)", source: "s1" },
    { field: "requisites", kind: "ogrn", value: "ОГРН уточняется, в источниках встречались 1234567890123 и 3210987654321", source: "s1" },
    { field: "numbers", value: "Старые регалии с первого экрана (СНЯТЫ по решению заказчика): 400+ студентов, 4 года, 30+ потоков", source: "s1" },
    { field: "numbers", value: "Софт Культура - больше 10 лет на рынке, курсы на 3-4 тысячи дороже", source: "s1" },
    { field: "numbers", value: "137 объектов сдано", source: "s1" },
  ],
}, null, 2), "utf8");
const dirSeed = join(SANDBOX, "seed-texts");
mkdirSync(dirSeed, { recursive: true });
run([READ_INPUT, dirSeed, "--from-analysis", dirSeedAn]);

step("засев ИНН: берется группа нужной длины, а не все цифры строки подряд", () => {
  const facts = readJson(join(dirSeed, "facts.json"));
  const inn = facts.jur.requisites.inn;
  if (inn === "240405032019230820263") return "ИНН склеен с датой подтверждения и номером вопроса - дефект вернулся";
  if (inn !== "240405032019") return `ИНН = ${inn}, ожидался 240405032019`;
  return true;
});

step("засев реквизита: несколько кандидатов -> поле пустое + строка в requisites_unresolved", () => {
  const facts = readJson(join(dirSeed, "facts.json"));
  if (facts.jur.requisites.ogrn) return `ОГРН = ${facts.jur.requisites.ogrn} - скрипт угадал там, где кандидатов двое`;
  const un = facts.jur.requisites_unresolved || [];
  if (!un.some((u) => u.field === "ogrn" && /кандидатов несколько/i.test(String(u.why))))
    return `в requisites_unresolved нет ОГРН с причиной: ${JSON.stringify(un)}`;
  return true;
});

step("засев publish: число, снятое решением заказчика -> \"no\" с основанием", () => {
  const facts = readJson(join(dirSeed, "facts.json"));
  const row = (facts.numbers || []).find((n) => /Старые регалии/.test(n.value));
  if (!row) return "факт не доехал до facts.json";
  if (row.publish !== "no") return `publish = ${row.publish} - снятые заказчиком регалии засеяны к публикации`;
  if (!String(row.publish_why || "").trim()) return "нет publish_why - ревизия не увидит, что сработало";
  return true;
});

step("засев publish: совпадение с forbidden_wordings брифа -> \"no\"", () => {
  const facts = readJson(join(dirSeed, "facts.json"));
  const row = (facts.numbers || []).find((n) => /Софт Культура/.test(n.value));
  if (!row) return "факт не доехал до facts.json";
  if (row.publish !== "no") return `publish = ${row.publish} - мост засеял к публикации то, что запретил тот же бриф`;
  if (!/forbidden_wordings/i.test(String(row.publish_why || ""))) return `publish_why не называет основание: ${row.publish_why}`;
  return true;
});

step("inputs.json: region_name - короткое имя, проза брифа сохранена в region_note", () => {
  const inputs = readJson(join(dirSeed, "inputs.json"));
  if (inputs.region_name !== "Россия") return `region_name = «${inputs.region_name}» - абзац прозы уедет в промты агентов шумом`;
  if (!/полностью онлайн/.test(String(inputs.region_note))) return "полная формулировка брифа потеряна (region_note)";
  return true;
});

step("засев чистого числа: publish as-is + label выведен машинно (label_auto)", () => {
  const facts = readJson(join(dirSeed, "facts.json"));
  const row = (facts.numbers || []).find((n) => /137 объектов/.test(n.value));
  if (!row) return "факт не доехал до facts.json";
  if (row.publish !== "as-is") return `publish = ${row.publish} - классификатор глушит чистую фактуру`;
  if (!String(row.label || "").trim()) return "label пуст - привязку опять размечать руками";
  if (row.label_auto !== true) return "нет label_auto - ревизия не отличит машинную разметку от подтвержденной";
  return true;
});

// Черновик состава - как его отдает pages-planner v2 ПОСЛЕ гейта (контракт 3.1):
// dir_slug уже проставлен планировщиком (мост берет готовым, заново не спаривает),
// include "нет" - страница снята заказчиком на гейте.
const draft = (pages) => ({ origin: "analysis", site_kind: "услуги", pages, questions: [], missing_facts: [], notes: "фикстура" });
const DRAFT_PAGES = [
  { n: 1, url: "/", type: "Главная", marker: "монтаж вентиляции казань", queries: [], dir_slug: null },
  { n: 2, url: "/montazh/", type: "Подуслуга", marker: "монтаж вентиляции в квартире", queries: ["вентиляция под ключ"], dir_slug: "montazh-ventilyacii" },
  { n: 3, url: "/montazh/", type: "Услуга", marker: "монтаж вентиляции в квартире", queries: [], dir_slug: "montazh-ventilyacii" }, // дубль url|marker
  { n: 4, url: "/otzyvy/", type: "Отзывы", marker: "отзывы вентпро", queries: [], dir_slug: null, include: "нет" },               // снята на гейте
  { n: 5, url: "/kontakty/", type: "Контакты", marker: "контакты вентпро казань", queries: [], dir_slug: null },
];
const draftPath = join(dirBridge, "pages_draft.json");
writeFileSync(draftPath, JSON.stringify(draft(DRAFT_PAGES), null, 2), "utf8");

step("--from-draft: финальный pages.json из подтвержденного черновика (дедуп + include)", () => {
  const r = run([READ_INPUT, dirBridge, "--from-draft", draftPath]);
  if (r.code !== 0) return `exit ${r.code}: ${r.stderr}`;
  const pages = readJson(join(dirBridge, "pages.json"));
  if (!/^pages_draft:/.test(pages.source)) return `source = ${pages.source}`;
  if (pages.count !== 3) return `count = ${pages.count}, ожидалось 3 (5 строк - дубль - снятая)`;
  if (pages.pages.some((p) => p.slug === "otzyvy")) return "страница include:\"нет\" просочилась в pages.json";
  return true;
});

step("--from-draft: типы нормализованы в русский словарь (Подуслуга->Услуга, Контакты->Инфо)", () => {
  const pages = readJson(join(dirBridge, "pages.json"));
  const byType = pages.pages.map((p) => p.type).sort().join(",");
  if (byType !== "Главная,Инфо,Услуга") return `типы: ${byType}`;
  const main = pages.pages.find((p) => p.type === "Главная");
  if (!main || main.slug !== "main") return `slug главной = ${main && main.slug}, ожидался "main" (на нем тон-гейт и blueprints/main.json)`;
  const svc = pages.pages.find((p) => p.type === "Услуга");
  if (svc.marker !== "монтаж вентиляции в квартире") return `маркер услуги: ${svc.marker}`;
  if (svc.queries[0] !== "вентиляция под ключ") return `queries потеряны: ${JSON.stringify(svc.queries)}`;
  return true;
});

step("--from-draft: dir_slug взят ГОТОВЫМ от pages-planner, неспаренная страница = null", () => {
  const r = run([READ_INPUT, dirBridge, "--from-draft", draftPath]);
  if (r.code !== 0) return `exit ${r.code}`;
  const pages = readJson(join(dirBridge, "pages.json"));
  const svc = pages.pages.find((p) => p.slug === "montazh");
  if (!svc || svc.dir_slug !== "montazh-ventilyacii") return `dir_slug услуги = ${svc && svc.dir_slug}`;
  const info = pages.pages.find((p) => p.slug === "kontakty");
  if (!info || info.dir_slug !== null) return `dir_slug контактов = ${info && info.dir_slug}, ожидался null`;
  if (!/спарено 1\/3/.test(r.stdout)) return "в сводке нет строки «спарено 1/3»";
  return true;
});

step("повторный вызов моста не стирает inputs.json первого вызова (в него дописывает оркестратор)", () => {
  const inputs = readJson(join(dirBridge, "inputs.json"));
  if (!inputs.analysis_dir) return "analysis_dir пропал после --from-draft";
  if (inputs.tier !== "seo") return `tier потерян: ${inputs.tier}`;
  return true;
});

step("--from-draft: slug стабилен между прогонами (на нем висят blueprints/ и pages/)", () => {
  const before = readJson(join(dirBridge, "pages.json")).pages.map((p) => p.slug).join(",");
  const r = run([READ_INPUT, dirBridge, "--from-draft", draftPath]);
  if (r.code !== 0) return `повторный прогон: exit ${r.code}`;
  const after = readJson(join(dirBridge, "pages.json")).pages.map((p) => p.slug).join(",");
  if (before !== after) return `slug поехали: ${before} -> ${after}`;
  return true;
});

step("--from-draft: все страницы сняты -> exit 2 (контракт «нет целевых»)", () => {
  const dirEmpty = join(SANDBOX, "bridge-empty");
  mkdirSync(dirEmpty, { recursive: true });
  const p = join(dirEmpty, "pages_draft.json");
  writeFileSync(p, JSON.stringify(draft(DRAFT_PAGES.map((x) => ({ ...x, include: "нет" })))), "utf8");
  const r = run([READ_INPUT, dirEmpty, "--from-draft", p]);
  if (r.code !== 2) return `exit ${r.code}, ожидался 2`;
  if (existsSync(join(dirEmpty, "pages.json"))) return "pages.json создан при пустом составе";
  return true;
});

step("--from-draft: черновика нет -> exit 1, существующий pages.json не тронут", () => {
  const snapshot = readFileSync(join(dirBridge, "pages.json"), "utf8");
  const r = run([READ_INPUT, dirBridge, "--from-draft", join(dirBridge, "no-such-file.json")]);
  if (r.code !== 1) return `exit ${r.code}, ожидался 1`;
  if (readFileSync(join(dirBridge, "pages.json"), "utf8") !== snapshot) return "pages.json перезаписан при ошибке";
  return true;
});

// Фикстура структуры: inputs.json со ссылкой на анализ + master_list с СЫРЫМИ типами
// источника - мост обязан отдать русский словарь и спарить dir_slug сам (контракт 2.2).
const dirStructFx = join(SANDBOX, "structure-fx");
mkdirSync(dirStructFx, { recursive: true });
writeFileSync(join(dirStructFx, "inputs.json"), JSON.stringify({
  slug: "ventkazan", domain: "ventpro.ru", region_name: "Казань", region_yandex: 43,
  analysis_dir: dirAnalysis.replace(/\\/g, "/"),
}, null, 2), "utf8");
writeFileSync(join(dirStructFx, "master_list.json"), JSON.stringify({ pages: [
  { url: "/", type: "home", marker: "монтаж инженерных систем казань", name: "Главная" },
  { url: "/otoplenie/montazh/", type: "Подуслуга", marker: "монтаж отопления в казани", name: "Монтаж отопления" },
  { url: "https://ventpro.ru/otoplenie/", type: "Услуга", marker: "отопительные системы", name: "Отопление" },
  { url: "/kondicionery/", type: "Кондиционеры-и-сплиты", marker: "купить кондиционер казань", name: "Кондиционеры" },
  { url: "/stati/kak-vybrat-kotel/", type: "Статья", marker: "как выбрать котел", name: "Как выбрать котел" },
] }, null, 2), "utf8");
const dirBridgeS = join(SANDBOX, "bridge-structure");
mkdirSync(dirBridgeS, { recursive: true });

step("--from-structure: русские типы (home->Главная, Подуслуга->Услуга), Статья исключена", () => {
  const r = run([READ_INPUT, dirBridgeS, "--from-structure", dirStructFx]);
  if (r.code !== 0) return `exit ${r.code}: ${r.stderr}`;
  const pages = readJson(join(dirBridgeS, "pages.json"));
  if (!/^structure:/.test(pages.source)) return `source = ${pages.source}`;
  if (pages.count !== 4) return `count = ${pages.count}, ожидалось 4 (5 строк - статья)`;
  const bySlug = Object.fromEntries(pages.pages.map((p) => [p.slug, p]));
  if (!bySlug["main"] || bySlug["main"].type !== "Главная") return `главная: ${JSON.stringify(bySlug["main"])}`;
  if (!bySlug["otoplenie-montazh"] || bySlug["otoplenie-montazh"].type !== "Услуга") return "Подуслуга не нормализована в Услугу";
  if (pages.pages.some((p) => /kak-vybrat/.test(p.slug))) return "Статья попала в коммерческий конвейер";
  if (!/исключено статей: 1/.test(r.stdout)) return "в сводке нет строки про исключенную статью";
  return true;
});

step("--from-structure: нераспознанный тип -> Инфо + предупреждение в сводке", () => {
  const r = run([READ_INPUT, dirBridgeS, "--from-structure", dirStructFx]);
  if (r.code !== 0) return `exit ${r.code}`;
  const pages = readJson(join(dirBridgeS, "pages.json"));
  const kond = pages.pages.find((p) => p.slug === "kondicionery");
  if (!kond || kond.type !== "Инфо") return `тип кондиционеров = ${kond && kond.type}, ожидался Инфо`;
  if (!/нераспознан/.test(r.stderr)) return "предупреждения о нераспознанном типе нет";
  if (!r.stderr.includes("Кондиционеры-и-сплиты")) return "сырье типа не названо в предупреждении";
  return true;
});

step("спаривание dir_slug: >= 50% токенов marker/name с marker_hint/name направления", () => {
  const pages = readJson(join(dirBridgeS, "pages.json"));
  const svc = pages.pages.find((p) => p.slug === "otoplenie-montazh");
  // «монтаж отопления в казани» против «монтаж отопления под ключ»: 2 из 3 значащих токенов
  if (!svc || svc.dir_slug !== "montazh-otopleniya") return `dir_slug = ${svc && svc.dir_slug}, ожидался montazh-otopleniya`;
  return true;
});

step("спаривание dir_slug: совпадение url направления сильнее токенов; мимо всех -> null", () => {
  const pages = readJson(join(dirBridgeS, "pages.json"));
  const otop = pages.pages.find((p) => p.slug === "otoplenie");
  // токены «отопительные системы» с направлением НЕ пересекаются - пару дает directions[].url
  if (!otop || otop.dir_slug !== "montazh-otopleniya") return `dir_slug по url = ${otop && otop.dir_slug}`;
  const kond = pages.pages.find((p) => p.slug === "kondicionery");
  if (!kond || kond.dir_slug !== null) return `неспаренная страница получила dir_slug = ${kond && kond.dir_slug}`;
  return true;
});

step("старый leader_scan без v2-полей -> leader_blocks.json НЕ создается (деградация отсутствием)", () => {
  const dirOldA = join(SANDBOX, "analysis-old");
  mkdirSync(dirOldA, { recursive: true });
  writeFileSync(join(dirOldA, "meta.json"), JSON.stringify({ tier: "basic" }), "utf8");
  writeFileSync(join(dirOldA, "brief.json"), JSON.stringify({ slug: "oldy", domain: "old.ru", region: "Казань", directions: [] }), "utf8");
  writeFileSync(join(dirOldA, "leader_scan.json"), JSON.stringify({ leaders: [{ domain: "x.ru" }], summary: {} }), "utf8");
  const dirT = join(SANDBOX, "bridge-old");
  mkdirSync(dirT, { recursive: true });
  const r = run([READ_INPUT, dirT, "--from-analysis", dirOldA]);
  if (r.code !== 0) return `exit ${r.code}: ${r.stderr}`;
  if (existsSync(join(dirT, "leader_blocks.json"))) return "leader_blocks.json создан из старого leader_scan - выжимать было нечего";
  if (!/без v2-полей/.test(r.stdout)) return "в сводке не сказано, почему выжимки нет";
  const inputs = readJson(join(dirT, "inputs.json"));
  if (inputs.tier !== "basic") return `tier = ${inputs.tier}, ожидался basic`;
  return true;
});

step("--from-table: аварийный ручной источник жив; dir_slug null (анализа нет)", () => {
  const dirTable = join(SANDBOX, "bridge-table");
  mkdirSync(dirTable, { recursive: true });
  const csv = join(dirTable, "t.csv");
  writeFileSync(csv, "URL,Тип,Маркер\n/uslugi/,Услуга,монтаж вентиляции\n", "utf8");
  const r = run([READ_INPUT, dirTable, "--from-table", csv]);
  if (r.code !== 0) return `exit ${r.code}: ${r.stderr}`;
  const pages = readJson(join(dirTable, "pages.json"));
  if (!/^table:/.test(pages.source)) return `source = ${pages.source}`;
  if (pages.count !== 1) return `count = ${pages.count}`;
  if (pages.pages[0].dir_slug !== null) return `dir_slug = ${pages.pages[0].dir_slug}, ожидался null`;
  return true;
});

step("источник не задан -> exit 1, подсказка перечисляет 4 источника v7 (--from-brief удален)", () => {
  const r = run([READ_INPUT, join(SANDBOX, "no-source")]);
  if (r.code !== 1) return `exit ${r.code}, ожидался 1`;
  for (const flag of ["--from-structure", "--from-analysis", "--from-table", "--from-draft"]) {
    if (!r.stderr.includes(flag)) return `в подсказке нет ${flag}`;
  }
  if (r.stderr.includes("--from-brief")) return "подсказка все еще предлагает удаленный --from-brief";
  return true;
});

// ──────────────────────────────────────────────────────────────────────────
console.log("");
console.log("=== прототип v2 (ADR-039): render -> site_manifest -> assemble -> verify ===");
// ──────────────────────────────────────────────────────────────────────────

const BUILD_PROTO = join(PROJECT_ROOT, ".claude/scripts/build-prototype.mjs");
const ASSEMBLE_PROTO = join(PROJECT_ROOT, ".claude/scripts/assemble-prototype.mjs");
const VERIFY_PROTO = join(PROJECT_ROOT, ".claude/scripts/verify-prototype.mjs");

// Фикстура сайта из 3 страниц: главная (документ-уровень: legal, титул), услуга,
// категория с обязательным листингом товаров (opts.filter=true).
// Телефон ГЛАВНОЙ пуст - типовой случай пути без SEO (--from-analysis): ассемблер обязан подставить
// маску +7 (000) 000-00-00, а не пустой tel:. У услуги телефон нарочно ДРУГОЙ:
// если он утечет в документ, значит ассемблер взял legal не из manifest страницы
// main_slug, а из первой попавшейся.
// В subhead услуги вшиты канарейки пост-обработки: е-с-точками (в data-литерале
// фикстуры - это разрешенное место) и висячий предлог перед «одном» - их обязан
// чинить АССЕМБЛЕР по итоговому документу, а не build-prototype в render.html.
const dirSite = join(SANDBOX, "site");

const protoBlocks = {
  hero: (h1, subhead) => ({ n: 1, type: "Первый экран (Hero)", fragment: "hero", h2: null,
    slots: { h1, subhead, cta_label: "Рассчитать стоимость" }, opts: {}, fill_notes: [] }),
  form: () => ({ n: 8, type: "Форма захвата", fragment: "form", h2: "Оставьте заявку на расчет",
    slots: { subhead: "Перезваниваем в течение рабочего дня", form_title: "Расчет стоимости", cta_label: "Отправить заявку" },
    opts: {}, fill_notes: [] }),
  listing: () => ({ n: 2, type: "Листинг товаров", fragment: "product-listing", h2: "Приточные установки",
    slots: {
      subhead: "Подберем модель под площадь объекта",
      filters: [{ name: "Производительность", options: ["до 500 куб. м/ч", "до 1500 куб. м/ч"] }],
      products: [
        { title: "Приточная установка Комфорт 350", spec: "350 куб. м/ч, до 60 кв. м", url: "#", cta: "Узнать цену", media_alt: "фото установки" },
        { title: "Приточная установка Комфорт 800", spec: "800 куб. м/ч, до 140 кв. м", url: "#", cta: "Узнать цену", media_alt: "фото установки" },
      ],
    }, opts: { filter: true }, fill_notes: [] }),
};

function seedSite(baseDir) {
  const legal = (phone) => ({ company: "ООО ВентПро", inn: "", ogrn: "", address: "", domain: "ventpro.ru", email: "info@ventpro.ru", phone });
  const mk = (slug, pageType, title, marker, blocks, phone) => {
    const d = join(baseDir, "pages", slug);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "manifest.json"), JSON.stringify({
      meta: { project: "ventpro", slug, page_type: pageType, title, description: "Проектируем и монтируем вентиляцию под ключ, гарантия 3 года.", marker },
      theme: "wireframe",
      legal: legal(phone),
      blocks,
    }, null, 2), "utf8");
  };
  mk("main", "Главная", "Монтаж вентиляции в Казани - под ключ за 14 дней", "монтаж вентиляции",
    [protoBlocks.hero("Монтаж вентиляции в Казани", "Проект и монтаж в одном договоре, сдаем за 14 дней"), protoBlocks.form()], "");
  mk("uslugi", "Услуга", "Монтаж вентиляции в квартире - смета за 1 день", "монтаж вентиляции",
    [protoBlocks.hero("Монтаж вентиляции в квартире", "Проверённая схема: смета и монтаж в одном договоре"), protoBlocks.form()], "+7 (999) 111-22-33");
  mk("catalog", "Категория", "Приточные установки - каталог с ценами", "приточные установки",
    [protoBlocks.hero("Приточные установки с монтажом в Казани", "Подбор по площади за 14 дней, монтаж своим штатом"), protoBlocks.listing(), protoBlocks.form()], "");
  writeFileSync(join(baseDir, "site_manifest.json"), JSON.stringify({
    pages: [
      { slug: "main", title: "Главная", type: "Главная", order: 1 },
      { slug: "uslugi", title: "Монтаж вентиляции", type: "Услуга", order: 2 },
      { slug: "catalog", title: "Каталог оборудования", type: "Категория", order: 3 },
    ],
    start: "__index",
    main_slug: "main",
  }, null, 2), "utf8");
}
seedSite(dirSite);

// Клон фикстуры под негативный кейс: каждый ломает свое, эталон не трогает
function cloneSite(name, mutate) {
  return cloneSite2(name, dirSite, mutate);
}
// То же для любой другой фикстуры сайта (у слотовой свой набор страниц и свой manifest).
function cloneSite2(name, src, mutate) {
  const dst = join(SANDBOX, name);
  cpSync(src, dst, { recursive: true });
  if (mutate) mutate(dst);
  return dst;
}

step("build v2: pages/<slug>/render.html без shell (пер-страничного prototype.html больше нет)", () => {
  for (const slug of ["main", "uslugi", "catalog"]) {
    const d = join(dirSite, "pages", slug);
    const r = run([BUILD_PROTO, d]);
    if (r.code !== 0) return `${slug}: exit ${r.code}: ${r.stderr}`;
    if (!existsSync(join(d, "render.html"))) return `${slug}: render.html не создан`;
    if (existsSync(join(d, "prototype.html"))) return `${slug}: создан пер-страничный prototype.html - этого режима больше нет (ADR-039)`;
  }
  const render = readFileSync(join(dirSite, "pages", "main", "render.html"), "utf8");
  if (!render.includes("pt-hero")) return "в render.html нет блоков страницы";
  for (const [what, re] of [
    ["shell (<header)", /<header/i],
    ["контракт-плашка", /pt-contract/],
    ["футер", /<footer/i],
    ["cookie-баннер", /cookie/i],
    ["попап", /popup/i],
  ]) {
    if (re.test(render)) return `в render.html протек ${what} - это уровень документа, его вставляет ассемблер`;
  }
  return true;
});

step("build v2: render НЕ пост-обработан - е-с-точками доживает до ассемблера (канарейка ADR-039)", () => {
  const render = readFileSync(join(dirSite, "pages", "uslugi", "render.html"), "utf8");
  if (!render.includes("ё")) return "е-с-точками уже вычищена в render - normYoFinal переехал из ассемблера в build-prototype";
  return true;
});

step("assemble: один документ - стартовая секция-список + секции страниц по order", () => {
  const r = run([ASSEMBLE_PROTO, dirSite]);
  if (r.code !== 0) return `exit ${r.code}: ${r.stderr} ${r.stdout}`;
  const out = join(dirSite, "prototype.html");
  if (!existsSync(out)) return "prototype.html не создан";
  const html = readFileSync(out, "utf8");
  const tag = (slug) => (html.match(new RegExp(`<section[^>]*data-page="${slug}"[^>]*>`)) || [null])[0];
  const idx = tag("__index");
  if (!idx) return "нет стартовой секции data-page=\"__index\"";
  if (!/pt-index/.test(idx)) return "стартовая секция без класса pt-index";
  if (/\bhidden\b/.test(idx)) return "стартовая секция скрыта - а открываться должен именно список страниц";
  let prev = html.indexOf(idx);
  for (const slug of ["main", "uslugi", "catalog"]) {
    const t = tag(slug);
    if (!t) return `нет секции страницы ${slug}`;
    if (!/\bhidden\b/.test(t)) return `секция ${slug} не скрыта на старте`;
    const pos = html.indexOf(t);
    if (pos < prev) return `секция ${slug} стоит раньше положенного по order`;
    prev = pos;
    if (!html.includes(`href="#p/${slug}"`)) return `в стартовом списке нет ссылки #p/${slug}`;
  }
  return true;
});

step("assemble: PT_ROUTES валиден (pages+title+start) и определен до кода prototype.js", () => {
  const html = readFileSync(join(dirSite, "prototype.html"), "utf8");
  const m = html.match(/window\.PT_ROUTES\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/);
  if (!m) return "нет <script>window.PT_ROUTES = {...}</script>";
  let routes;
  try { routes = JSON.parse(m[1]); } catch (err) { return `PT_ROUTES не парсится как JSON: ${err.message}`; }
  if (routes.start !== "__index") return `start = ${routes.start}, ожидался __index`;
  const slugs = (routes.pages || []).map((p) => p.slug).join(",");
  if (slugs !== "main,uslugi,catalog") return `pages = ${slugs}`;
  if (!(routes.pages || []).every((p) => p.title)) return "у маршрута нет title - плашке возврата нечего показывать";
  // прокси порядка: роутер читает карту при инициализации, значит определение обязано
  // стоять раньше кода prototype.js (первый addEventListener в документе - из него)
  const jsAt = html.indexOf("addEventListener");
  if (jsAt >= 0 && html.indexOf("window.PT_ROUTES") > jsAt) return "PT_ROUTES определен ПОСЛЕ подключения prototype.js";
  return true;
});

step("assemble: неймспейс id <slug>__ + переписанные href и label for; сервисные якоря глобальны", () => {
  const html = readFileSync(join(dirSite, "prototype.html"), "utf8");
  for (const slug of ["main", "uslugi", "catalog"]) {
    if (!html.includes(`id="${slug}__lead"`)) return `нет id="${slug}__lead" - id формы секции не префиксован`;
  }
  if (!html.includes('href="#main__lead"')) return "CTA hero главной не переписан на #main__lead";
  if (!html.includes('id="main__f-agree"') || !html.includes('for="main__f-agree"')) return "label for чекбокса согласия не переписан вместе с id";
  if (/id="lead"/.test(html)) return "голый id=\"lead\" остался - дубль id между секциями";
  if (!html.includes('href="#privacy"')) return "сервисный якорь #privacy пропал или получил префикс";
  if (/#(?:main|uslugi|catalog)__(?:privacy|person-data-consent|cookie|thanks)\b/.test(html)) return "сервисный якорь из закрытого списка получил префикс страницы";
  if (/href="#mainContent"/.test(html)) return "юр-страницы все еще возвращают на #mainContent - должно быть #__back";
  if (!html.includes('href="#__back"')) return "нет возврата #__back из юр-страниц";
  return true;
});

step("assemble: документ-уровень из manifest главной - пустой phone дает маску, чужой legal не течет", () => {
  const html = readFileSync(join(dirSite, "prototype.html"), "utf8");
  const tels = [...new Set(html.match(/href="tel:[^"]*"/g) || [])];
  if (!tels.length) return "tel-ссылок нет вовсе";
  if (tels.some((t) => t === 'href="tel:"')) return `пустая tel-ссылка: ${tels.join(" | ")}`;
  if (tels.length > 1) return `шапка и футер разошлись: ${tels.join(" | ")}`;
  if (/9991112233|111-22-33/.test(html)) return "в документ утек телефон НЕ главной страницы - legal обязан браться из main_slug";
  return true;
});

step("assemble: контракт один на документ, попапов нет, CTA shell переведены на pt-shell-cta", () => {
  const html = readFileSync(join(dirSite, "prototype.html"), "utf8");
  if ((html.match(/name="prototype-contract"/g) || []).length !== 1) return "машинный маркер контракта не ровно один на документ";
  if ((html.match(/class="pt-contract"/g) || []).length !== 1) return "видимая плашка контракта не ровно одна на документ";
  if (/popupTime|popupExit|pt-popup/.test(html)) return "попапы дожили до v2 - по ADR-039 они удалены полностью";
  if (/href="#lead"/.test(html)) return "CTA shell все еще ведет на #lead - должен быть pt-shell-cta с href=\"#\"";
  if (!/pt-shell-cta/.test(html)) return "класса pt-shell-cta нет - роутеру не за что зацепить скролл к форме активной секции";
  return true;
});

step("assemble: normYoFinal + bindHanging применены к итоговому документу", () => {
  const html = readFileSync(join(dirSite, "prototype.html"), "utf8");
  if (/[ёЁ]/.test(html)) return "е-с-точками осталась в итоговом документе";
  if (!html.includes("Проверенная схема")) return "слот с е-с-точками не нормализован (или фикстура услуги потерялась)";
  // NBSP кодом, а не символом - невидимый знак в исходнике теста легко потерять при правке
  const NBSP = String.fromCharCode(160);
  if (!html.includes(`в${NBSP}одном`)) return "висячий предлог «в» не привязан неразрывным пробелом";
  return true;
});

step("verify v2: собранный сайт целиком проходит (exit 0)", () => {
  const r = run([VERIFY_PROTO, dirSite]);
  if (r.code !== 0) return `exit ${r.code}: ${r.stdout} ${r.stderr}`;
  return true;
});

step("assemble: страница без render.html -> падение, битый документ не пишется", () => {
  const dst = cloneSite("site-norender", (d) => {
    rmSync(join(d, "pages", "uslugi", "render.html"), { force: true });
    rmSync(join(d, "prototype.html"), { force: true });
  });
  const r = run([ASSEMBLE_PROTO, dst]);
  if (r.code === 0) return "exit 0 при отсутствующем render.html";
  if (existsSync(join(dst, "prototype.html"))) return "при ошибке записан битый prototype.html";
  return true;
});

step("verify v2: вторая форма в секции -> exit 2 («ровно 1 форма НА СЕКЦИЮ»)", () => {
  const dst = cloneSite("site-2forms", (d) => {
    const mPath = join(d, "pages", "uslugi", "manifest.json");
    const m = readJson(mPath);
    m.blocks.push({ ...m.blocks.find((b) => b.fragment === "form"), n: 99 });
    writeFileSync(mPath, JSON.stringify(m, null, 2), "utf8");
  });
  let r = run([BUILD_PROTO, join(dst, "pages", "uslugi")]);
  if (r.code !== 0) return `пересборка render: exit ${r.code}: ${r.stderr}`;
  r = run([ASSEMBLE_PROTO, dst]);
  if (r.code !== 0) return `assemble: exit ${r.code}: ${r.stderr}`;
  r = run([VERIFY_PROTO, dst]);
  if (r.code !== 2) return `exit ${r.code}, ожидался 2`;
  if (!/форм/i.test(r.stdout + r.stderr)) return "в выводе нет причины про форму";
  return true;
});

step("verify v2: секция типа Категория без листинга товаров -> exit 2 (обязательный блок)", () => {
  const dst = cloneSite("site-nolisting", (d) => {
    const mPath = join(d, "pages", "catalog", "manifest.json");
    const m = readJson(mPath);
    m.blocks = m.blocks.filter((b) => b.fragment !== "product-listing");
    writeFileSync(mPath, JSON.stringify(m, null, 2), "utf8");
  });
  let r = run([BUILD_PROTO, join(dst, "pages", "catalog")]);
  if (r.code !== 0) return `пересборка render: exit ${r.code}: ${r.stderr}`;
  r = run([ASSEMBLE_PROTO, dst]);
  if (r.code !== 0) return `assemble: exit ${r.code}: ${r.stderr}`;
  r = run([VERIFY_PROTO, dst]);
  if (r.code !== 2) return `exit ${r.code}, ожидался 2`;
  if (!/листинг|product-listing/i.test(r.stdout + r.stderr)) return "в выводе не назван листинг товаров";
  return true;
});

step("verify v2: пустой href=\"tel:\" блокирует (exit 2, а не молчаливый пропуск)", () => {
  const dst = cloneSite("site-badtel", (d) => {
    const p = join(d, "prototype.html");
    writeFileSync(p, readFileSync(p, "utf8").replace(/href="tel:[^"]*"/g, 'href="tel:"'), "utf8");
  });
  const r = run([VERIFY_PROTO, dst]);
  if (r.code !== 2) return `exit ${r.code}, ожидался 2`;
  if (!/tel/i.test(r.stdout + r.stderr)) return "в выводе нет причины про tel";
  return true;
});

// ── Оболочка не выдумывает фактуру (боевой прогон save-arch-soft, 24.08) ──
// Ассемблер печатал в шапку график «Пн-Пт 9:00-19:00» из захардкоженного дефолта - у проекта,
// который работает полностью онлайн и офлайна не имеет. Проверку это переживало: верификаторы
// читают page.json, а выдумка жила в оболочке.
step("assemble: пустой график - в шапку не уезжают выдуманные часы работы", () => {
  const html = readFileSync(join(dirSite, "prototype.html"), "utf8");
  if (/Пн-Пт|Пн\.-Пт\.|9:00-19:00/.test(html)) return "в документе часы работы, которых нет ни в meta.schedule, ни в legal.schedule";
  if (/<span class="pt-schedule"><\/span>/.test(html)) return "пустой элемент графика остался в разметке";
  return true;
});

step("assemble: legal.schedule заполнен - график печатается как есть", () => {
  const dir = cloneSite("site-schedule", (d) => {
    const p = join(d, "pages", "main", "manifest.json");
    const m = readJson(p);
    m.legal.schedule = "Пн-Пт 10:00-18:00";
    writeFileSync(p, JSON.stringify(m, null, 2), "utf8");
  });
  const r = run([ASSEMBLE_PROTO, dir]);
  if (r.code !== 0) return `exit ${r.code}: ${r.stderr}`;
  const html = readFileSync(join(dir, "prototype.html"), "utf8");
  if (!/Пн-Пт\s*10:00-18:00/.test(html.replace(/ /g, " "))) return "заполненный график не доехал до шапки";
  return true;
});

// «Телефона нет» - решение заказчика, а не пустое поле: пустое честно печатается маской,
// решение снимает блок целиком. Эвристикой их не различить, поэтому нужен явный флаг.
step("assemble+verify: legal.phone_absent - телефона нет нигде, сборка проходит (exit 0)", () => {
  const dir = cloneSite("site-nophone", (d) => {
    for (const slug of ["main", "uslugi", "catalog"]) {
      const p = join(d, "pages", slug, "manifest.json");
      const m = readJson(p);
      m.legal.phone = "";
      m.legal.phone_absent = true;
      writeFileSync(p, JSON.stringify(m, null, 2), "utf8");
    }
  });
  const r = run([ASSEMBLE_PROTO, dir]);
  if (r.code !== 0) return `assemble exit ${r.code}: ${r.stderr}`;
  const html = readFileSync(join(dir, "prototype.html"), "utf8");
  if (/href="tel:/.test(html)) return "tel-ссылка осталась при явном решении «телефона нет»";
  if (/\+7\s*\(000\)/.test(html)) return "подставлена маска-заглушка - решение заказчика проигнорировано";
  const v = run([VERIFY_PROTO, dir]);
  if (v.code !== 0) return `verify exit ${v.code} (правило про телефон не учитывает phone_absent): ${v.stdout}`;
  return true;
});

step("verify v2: склеенный ИНН в legal главной -> exit 2 (реквизит уезжает в подвал сайта)", () => {
  const dir = cloneSite("site-badinn", (d) => {
    const p = join(d, "pages", "main", "manifest.json");
    const m = readJson(p);
    m.legal.inn = "240405032019230820263"; // ИНН + дата + номер вопроса, боевой случай
    writeFileSync(p, JSON.stringify(m, null, 2), "utf8");
  });
  run([ASSEMBLE_PROTO, dir]);
  const r = run([VERIFY_PROTO, dir]);
  if (r.code !== 2) return `exit ${r.code}, ожидался 2 - длина реквизита опять никем не проверяется`;
  if (!/ИНН|inn/i.test(r.stdout)) return "в выводе нет причины про ИНН";
  return true;
});

// ══ Слоты кита и оболочка (боевой прогон save-arch-soft, 24.08) ══
// Пять требований заказчика, которые до этого выполнить было НЕЧЕМ, и из-за которых
// пришлось писать постобработчик собранного html: адрес ссылки в карточке, кнопка под
// сеткой, плейсхолдер изображения, меню второго уровня, надпись кнопки оболочки.
const dirSlots = join(SANDBOX, "slots");
{
  const legal = { company: "ИП Рыжова", brand: "Save", inn: "", ogrn: "", address: "", domain: "save.ru", email: "info@save.ru", phone: "", phone_absent: true };
  const mk = (slug, title, blocks, extraMeta = {}) => {
    const d = join(dirSlots, "pages", slug);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "manifest.json"), JSON.stringify({
      meta: Object.assign({ project: "save", slug, page_type: "Услуга", title, description: "Учим архитектурному софту в онлайне, поток раз в месяц." }, extraMeta),
      legal, blocks,
    }, null, 2), "utf8");
  };
  const heroSlots = {
    n: 1, type: "Первый экран (Hero)", fragment: "hero", h2: null,
    slots: { h1: "Онлайн-школа архитектурного софта", subhead: "Ведем от первого урока до диплома за 4 месяца", cta_label: "Начать учиться", cta_href: "/kurs/", media_alt: "Фото студии" },
    opts: {}, fill_notes: [],
  };
  const productsSlots = {
    n: 2, type: "Каталог", fragment: "product-card", h2: "Save Market",
    slots: {
      subhead: "Шаблоны и пресеты для работы",
      items: [
        { media_alt: "обложка", title: "Пресеты для Revit", text: "Готовые семейства для рабочей документации", cta: "Подробнее", url: "/kurs/" },
        { media_alt: "обложка", title: "Шаблон InDesign", text: "Сетка портфолио под печать и экран", cta: "Подробнее" },
      ],
      section_cta_label: "Перейти в Market", section_cta_href: "/market/",
    }, opts: {}, fill_notes: [],
  };
  const cardsSlots = {
    n: 3, type: "Направления", fragment: "cards", h2: "Направления обучения",
    slots: { items: [{ media_alt: "Архитектура", title: "Архитектура", text: "Проектирование и подача", cta: "Смотреть курс", url: "/kurs/" }] },
    opts: { cols: 1 }, fill_notes: [],
  };
  const reviewsSlider = {
    n: 4, type: "Отзывы", fragment: "reviews", h2: "Что говорят студенты",
    slots: { items: [{ initial: "А", name: "Анна", pos: "студентка", text: "Разобралась в подаче за месяц, собрала портфолио и поступила." }] },
    opts: { slider: true }, fill_notes: [],
  };
  const formBlock = { n: 9, type: "Форма захвата", fragment: "form", h2: "Задать вопрос",
    slots: { subhead: "Отвечаем в рабочее время", form_title: "Ваш вопрос", cta_label: "Задать вопрос" }, opts: {}, fill_notes: [] };

  mk("main", "Save - онлайн-школа архитектурного софта", [heroSlots, productsSlots, cardsSlots, reviewsSlider], { cta_label: "Задать вопрос" });
  mk("kurs", "Курс по Revit - от основ до рабочей документации", [Object.assign({}, heroSlots, { slots: Object.assign({}, heroSlots.slots, { cta_href: "" }) }), formBlock]);
  mk("market", "Save Market - шаблоны и пресеты", [heroSlots, formBlock]);
  mk("sluzhebnaya", "Служебная страница", [heroSlots, formBlock]);
  writeFileSync(join(dirSlots, "site_manifest.json"), JSON.stringify({
    pages: [
      { slug: "main", title: "Главная", type: "Главная", order: 1 },
      { slug: "market", title: "Save Market", type: "Услуга", order: 2, url: "/market/" },
      { slug: "kurs", title: "Курс по Revit", type: "Услуга", order: 3, url: "/kurs/", parent: "market" },
      { slug: "sluzhebnaya", title: "Служебная", type: "Инфо", order: 4, nav: false },
    ],
    start: "__index", main_slug: "main",
  }, null, 2), "utf8");
  // Форму с главной снял заказчик - waiver F3 (законное основание, ADR-037).
  writeFileSync(join(dirSlots, "meta.json"), JSON.stringify({
    state: "prototype-built",
    selling_floor_waivers: [{ page: "main", rule: "F3", why: "заказчик убрал форму с главной, замена - кнопка «Задать вопрос»", source: "decisions.cta.chosen" }],
  }, null, 2), "utf8");
  for (const slug of ["main", "kurs", "market", "sluzhebnaya"]) run([BUILD_PROTO, join(dirSlots, "pages", slug)]);
}

step("кит: адрес ссылки - слот (item.url, cta_href), пустой слот дает прежний #lead", () => {
  const main = readFileSync(join(dirSlots, "pages", "main", "render.html"), "utf8");
  if (!/href="\/kurs\/"[^>]*class="btn btn--primary btn--lg pt-hero__cta"/.test(main))
    return "cta_href не доехал до кнопки первого экрана";
  if (!/<a href="\/kurs\/" class="btn btn--primary btn--block pt-product__cta">Подробнее<\/a>/.test(main))
    return "item.url не доехал до кнопки карточки товара";
  if (!/<a href="#lead" class="btn btn--primary btn--block pt-product__cta">Подробнее<\/a>/.test(main))
    return "у карточки без url потерян дефолт #lead - прежнее поведение сломано";
  const kurs = readFileSync(join(dirSlots, "pages", "kurs", "render.html"), "utf8");
  if (!/href="#lead"[^>]*pt-hero__cta/.test(kurs)) return "пустой cta_href не дал дефолт #lead";
  return true;
});

step("кит: кнопка под сеткой карточек, плейсхолдер изображения, ссылка из карточки", () => {
  const main = readFileSync(join(dirSlots, "pages", "main", "render.html"), "utf8");
  if (!/<div class="pt-section-cta"><a href="\/market\/" class="btn btn--primary">Перейти в Market<\/a><\/div>/.test(main))
    return "нет кнопки под сеткой товаров (section_cta_label/href)";
  if (!/<div class="pt-hero__media" role="img" aria-label="Фото студии">/.test(main))
    return "нет плейсхолдера изображения в первом экране (hero.media_alt)";
  if (!/<div class="pt-card__media"/.test(main)) return "нет плейсхолдера изображения в карточке (item.media_alt)";
  if (!/<a class="pt-card__link" href="\/kurs\/">Смотреть курс<\/a>/.test(main)) return "нет ссылки из карточки (item.cta + item.url)";
  return true;
});

step("кит: opts.slider дает класс без значения, opts.cols=1 - колонку (CSS о ней знает)", () => {
  const main = readFileSync(join(dirSlots, "pages", "main", "render.html"), "utf8");
  if (/slider-true/.test(main)) return "булев модификатор отрендерен как slider-true";
  if (!/<div class="pt-reviews slider">/.test(main)) return "opts.slider не дал класс slider";
  if (!/<div class="pt-cards cols-1">/.test(main)) return "opts.cols=1 не дал класс cols-1";
  const css = readFileSync(join(PROJECT_ROOT, ".claude/skills/seo-tekst/assets/prototype.css"), "utf8");
  if (!/\.pt-cards\.cols-1/.test(css)) return "класс cols-1 в CSS не описан - сборщик выставит его молча в пустоту";
  if (!/\.pt-reviews\.slider/.test(css)) return "класс slider в CSS не описан";
  return true;
});

// На боевом прогоне из 12 блоков главной три не смаппились по имени и молча упали в
// фолбэк cards. Для «CTA финальный» это прямой дефект: вместо формы встали бы карточки -
// сломанный пол F3 и нарушение «ровно 1 форма на секцию».
step("имена блоков: составные и синонимы находят свою форму, а не фолбэк cards", () => {
  const dir = join(SANDBOX, "aliases", "pages", "main");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({
    meta: { project: "save", slug: "main", page_type: "Главная", title: "Тест имен блоков" },
    legal: { company: "ИП Рыжова", domain: "save.ru", phone: "", phone_absent: true },
    blocks: [
      // fragment НЕ задан нарочно: имя блока обязано найти форму само
      { n: 1, type: "Портфолио / кейсы", h2: "Работы студентов", slots: { items: [{ media_alt: "работа", title: "Проект жилого дома", result: "Поступила в PoliMi" }] } },
      { n: 2, type: "КОМАНДА / специалисты", h2: "Кто учит", slots: { items: [{ initial: "А", name: "Анна", pos: "куратор", text: "Ведет курс по подаче и помогает собрать портфолио." }] } },
      { n: 3, type: "CTA финальный", h2: "Задать вопрос", slots: { form_title: "Ваш вопрос", cta_label: "Задать вопрос" } },
    ],
  }, null, 2), "utf8");
  const r = run([BUILD_PROTO, dir]);
  if (r.code !== 0) return `exit ${r.code}: ${r.stderr}`;
  const html = readFileSync(join(dir, "render.html"), "utf8");
  if (!/pt-portfolio/.test(html)) return "«Портфолио / кейсы» не нашел форму portfolio (составное имя)";
  if (!/pt-reviews/.test(html)) return "«КОМАНДА / специалисты» не нашла форму (регистр или составное имя)";
  if (!/id="leadForm"/.test(html)) return "«CTA финальный» собран НЕ формой - вместо формы встали бы карточки (ломает пол F3)";
  if (/НЕТ В КИТЕ|подставлен фолбэк/.test(r.stdout)) return `сборщик уходил в фолбэк: ${r.stdout}`;
  return true;
});

step("assemble: относительные адреса переведены в маршруты роутера (#p/<slug>)", () => {
  const r = run([ASSEMBLE_PROTO, dirSlots]);
  if (r.code !== 0) return `exit ${r.code}: ${r.stderr}`;
  const html = readFileSync(join(dirSlots, "prototype.html"), "utf8");
  if (/href="\/kurs\/"/.test(html)) return "адрес /kurs/ остался относительным - в одностраничном прототипе он ведет в никуда";
  if (/href="\/market\/"/.test(html)) return "адрес /market/ остался относительным";
  if (!/href="#p\/kurs"/.test(html)) return "нет маршрута #p/kurs";
  if (!/href="#p\/market"/.test(html)) return "нет маршрута #p/market";
  return true;
});

step("assemble: страница без формы - кнопки переведены на CTA-обработчик, мертвых якорей нет", () => {
  const html = readFileSync(join(dirSlots, "prototype.html"), "utf8");
  if (/href="#main__lead"/.test(html)) return "кнопки главной ведут на #main__lead, а формы на ней нет (снята waiver F3) - мертвый якорь";
  const sec = html.slice(html.indexOf('data-page="main"'), html.indexOf('data-page="market"'));
  if (!/pt-shell-cta/.test(sec)) return "кнопки страницы без формы не переведены на pt-shell-cta";
  if (!/href="#kurs__lead"/.test(html)) return "на странице С формой якорь #kurs__lead потерян - переписали лишнее";
  return true;
});

step("verify v2: waiver F3 - страница без формы проходит; мертвый якорь -> exit 2", () => {
  const ok = run([VERIFY_PROTO, dirSlots]);
  if (ok.code !== 0) return `валидный waiver F3 не учтен, exit ${ok.code}: ${ok.stdout}`;
  const dir = cloneSite2("slots-dead", dirSlots, (d) => {
    const p = join(d, "prototype.html");
    writeFileSync(p, readFileSync(p, "utf8").replace('href="#p/kurs"', 'href="#main__nope"'), "utf8");
  });
  const bad = run([VERIFY_PROTO, dir]);
  if (bad.code !== 2) return `мертвый якорь не пойман, exit ${bad.code}`;
  if (!/несуществующий якорь/.test(bad.stdout)) return "причина не названа";
  return true;
});

step("assemble: меню сайта из site_manifest - подменю по parent, nav:false исключает пункт", () => {
  const html = readFileSync(join(dirSlots, "prototype.html"), "utf8");
  if (!/<nav class="pt-nav" aria-label="Меню сайта">/.test(html)) return "меню не собрано";
  if (!/pt-nav__item--has-sub/.test(html)) return "нет пункта с подменю (parent не отработал)";
  // Сверяем по «расшитому» документу: bindHanging ставит неразрывный пробел после «по».
  const flat = html.split(String.fromCharCode(160)).join(" ");
  if (!flat.includes('<a class="pt-nav__sublink" href="#p/kurs">Курс по Revit</a>')) return "дочерний пункт не попал в подменю";
  if (/pt-nav__link[^>]*href="#p\/sluzhebnaya"/.test(html)) return "страница с nav:false попала в меню";
  if (!/pt-nav__link" href="#p\/main">Главная/.test(html)) return "верхний пункт меню потерян";
  return true;
});

step("assemble: бренд в шапке, юрлицо в подвале, надпись кнопки оболочки из meta", () => {
  const html = readFileSync(join(dirSlots, "prototype.html"), "utf8");
  if (!/<a href="#" class="pt-logo">Save<\/a>/.test(html)) return "в шапке не бренд (legal.brand)";
  if (!/ИП Рыжова/.test(html)) return "юрлицо потеряно из подвала";
  if (/Оставить заявку/.test(html)) return "надпись кнопки оболочки не параметризована - осталась запрещенная заказчиком формулировка";
  if ((html.match(/Задать вопрос/g) || []).length < 4) return "meta.cta_label подставлен не во все места оболочки";
  return true;
});

step("verify v2: ИНН с непроходящей контрольной цифрой -> exit 2, верный ИНН -> молчит", () => {
  const bad = cloneSite("site-inn-checksum", (d) => {
    const p = join(d, "pages", "main", "manifest.json");
    const m = readJson(p);
    m.legal.inn = "240405032018"; // последняя цифра испорчена: длина верная, сумма нет
    writeFileSync(p, JSON.stringify(m, null, 2), "utf8");
  });
  run([ASSEMBLE_PROTO, bad]);
  const rb = run([VERIFY_PROTO, bad]);
  if (rb.code !== 2) return `испорченный ИНН прошел: exit ${rb.code}`;
  if (!/контрольная/i.test(rb.stdout)) return "причина не названа контрольной цифрой";

  const ok = cloneSite("site-inn-ok", (d) => {
    const p = join(d, "pages", "main", "manifest.json");
    const m = readJson(p);
    m.legal.inn = "240405032019"; // настоящий ИНН заказчика с боевого прогона
    writeFileSync(p, JSON.stringify(m, null, 2), "utf8");
  });
  run([ASSEMBLE_PROTO, ok]);
  const ro = run([VERIFY_PROTO, ok]);
  if (ro.code !== 0) return `настоящий ИНН заблокирован (ложное срабатывание): ${ro.stdout}`;
  return true;
});

// ──────────────────────────────────────────────────────────────────────────
console.log("");
console.log("=== verify-copy.mjs (ремонт ложных срабатываний + метатеги) ===");
// ──────────────────────────────────────────────────────────────────────────

const VERIFY_COPY = join(PROJECT_ROOT, ".claude/scripts/verify-copy.mjs");

// verify-copy ищет inputs.json и blueprints/ на два уровня выше page.json,
// поэтому страница обязана лежать по канону: <texts_dir>/pages/<slug>/page.json
let copyCase = 0;
function copyPage({ title = "Монтаж вентиляции в Казани", description = "Монтируем вентиляцию под ключ за 14 дней, гарантия 3 года.", h1 = "Монтаж вентиляции в Казани", blocks }) {
  const dir = join(SANDBOX, "copy", `case${++copyCase}`);
  const pageDir = join(dir, "pages", "test");
  mkdirSync(pageDir, { recursive: true });
  writeFileSync(join(dir, "inputs.json"), JSON.stringify({ brand_name: "ВентПро" }), "utf8");
  writeFileSync(join(pageDir, "page.json"), JSON.stringify({
    page: { slug: "test", title, description, type: "Услуга", url: "/montazh/", marker: "монтаж вентиляции" },
    h1,
    blocks,
  }, null, 2), "utf8");
  return pageDir;
}
// Фикстура обязана проходить продающий пол (ADR-037): первый экран с цифрой в обещании
// и целевое действие с предметной надписью. Иначе каждый тест ловит ещё и пол, а не своё правило.
const HERO_OK = { n: 1, type: "Первый экран (Hero)", fragment: "hero", h2: null, slots: { h1: "Монтаж вентиляции в Казани", subhead: "Проектируем, монтируем и сдаем под пусконаладку за 14 дней", cta_label: "Рассчитать стоимость" } };

step("чистая страница -> exit 0 (фикстура не ловит сама себя)", () => {
  const r = run([VERIFY_COPY, copyPage({ blocks: [HERO_OK] })]);
  if (r.code !== 0) return `exit ${r.code}: ${r.stdout}`;
  return true;
});

// Порча реквизита ловится в истоке (facts.json), а не только на сборке: до этой проверки
// длину ИНН не смотрел никто на всем конвейере.
step("verify-copy: склеенный ИНН в facts.json -> exit 2 на каждой странице задачи", () => {
  const pageDir = copyPage({ blocks: [HERO_OK] });
  const taskDir = join(pageDir, "..", "..");
  writeFileSync(join(taskDir, "facts.json"), JSON.stringify({
    jur: { entity: "ИП Рыжова", requisites: { inn: "240405032019230820263", ogrn: "", address: "" } },
    numbers: [],
  }, null, 2), "utf8");
  const r = run([VERIFY_COPY, pageDir]);
  if (r.code !== 2) return `exit ${r.code}, ожидался 2`;
  if (!/ИНН/.test(r.stdout)) return "в выводе нет причины про ИНН";
  return true;
});

step("метатеги проверяются: длинное тире в title и е-с-точками в description -> exit 2", () => {
  const r = run([VERIFY_COPY, copyPage({
    title: "Монтаж — под ключ",
    description: "Ещё один вариант подачи, всё под ключ.",
    blocks: [HERO_OK],
  })]);
  if (r.code !== 2) return `exit ${r.code}, ожидался 2 (метатеги мимо проверки)`;
  if (!/тире/.test(r.stdout)) return "тире в title не поймано";
  if (!/ё/.test(r.stdout)) return "ё в description не поймано";
  return true;
});

step("жаргон с легальным омонимом (конверсия/сегмент в химии) -> W, не блокирует", () => {
  const r = run([VERIFY_COPY, copyPage({
    blocks: [HERO_OK, { n: 2, type: "Преимущества", fragment: "cards", h2: "Что вы получаете на выходе", slots: { items: [{ title: "Стабильный выход", text: "Конверсия метана 92 процента, сегмент трубы 400 мм по проекту." }] } }],
  })]);
  if (r.code !== 0) return `exit ${r.code}, ожидался 0: отраслевой термин заблокировал сборку`;
  if (!/контекст ниши/.test(r.stdout)) return "нет предупреждения с оговоркой про контекст ниши";
  return true;
});

step("утечка кухни без омонимов (кастдев) -> exit 2", () => {
  const r = run([VERIFY_COPY, copyPage({
    blocks: [HERO_OK, { n: 2, type: "Этапы", fragment: "steps", h2: "Как мы работаем", slots: { items: [{ title: "Шаг 1", text: "Проводим кастдев по вашей базе клиентов." }] } }],
  })]);
  if (r.code !== 2) return `exit ${r.code}, ожидался 2`;
  return true;
});

step("срочность с реальной датой в том же слоте -> W, не блокирует", () => {
  const r = run([VERIFY_COPY, copyPage({
    blocks: [HERO_OK, { n: 2, type: "Акция", fragment: "cta-mid", h2: "Субсидия на монтаж", slots: { text: "Успейте подать заявку до 15.09.2026 - прием документов закрывается." } }],
  })]);
  if (r.code !== 0) return `exit ${r.code}, ожидался 0: честный дедлайн вычищается как манипуляция`;
  return true;
});

step("срочность без даты и остатка -> exit 2", () => {
  const r = run([VERIFY_COPY, copyPage({
    blocks: [HERO_OK, { n: 2, type: "Акция", fragment: "cta-mid", h2: "Скидка", slots: { text: "Успейте оставить заявку, предложение сгорит." } }],
  })]);
  if (r.code !== 2) return `exit ${r.code}, ожидался 2`;
  return true;
});

step("hero опознается по type, а не только по fragment (проверка первого экрана не отваливается)", () => {
  const r = run([VERIFY_COPY, copyPage({
    blocks: [{ n: 1, type: "Первый экран (Hero)", fragment: "hero-alt", h2: null, slots: { h1: "Монтаж вентиляции в Казани", subhead: "Сдаем под пусконаладку 🚀" } }],
  })]);
  if (r.code !== 2) return `exit ${r.code}, ожидался 2: эмодзи на первом экране пропущено`;
  if (!/перв/i.test(r.stdout)) return "в выводе нет причины про первый экран";
  return true;
});

step("эмодзи больше чем в одном блоке -> W (счетное правило вместо «одного источника»)", () => {
  const r = run([VERIFY_COPY, copyPage({
    blocks: [
      HERO_OK,
      { n: 2, type: "Преимущества", fragment: "cards", h2: "Почему это выгодно", slots: { items: [{ title: "Сроки", text: "Сдаем за 14 дней ✅" }] } },
      { n: 3, type: "Гарантии", fragment: "cards", h2: "Что вы получаете по договору", slots: { items: [{ title: "Гарантия", text: "3 года на монтаж 🔧" }] } },
    ],
  })]);
  if (r.code !== 0) return `exit ${r.code}, ожидался 0 (эмодзи вне Hero - предупреждение)`;
  if (!/эмодзи/i.test(r.stdout)) return "предупреждения про эмодзи нет";
  return true;
});

// ──────────────────────────────────────────────────────────────────────────
console.log("");
console.log("=== verify-copy.mjs (греп-слой правил текста: только предупреждения) ===");
// ──────────────────────────────────────────────────────────────────────────

// Все проверки этого слоя - W: у конструкций есть законные употребления,
// решение принимает copy-auditor. Ни одна не имеет права дать exit 2.
function copyWarn(slotText, extra = {}) {
  return run([VERIFY_COPY, copyPage({
    ...extra,
    blocks: [HERO_OK, { n: 2, type: "Преимущества", fragment: "cards", h2: "Что вы получаете", slots: { text: slotText } }],
  })]);
}

step("противопоставление «а не» -> W, сборку не блокирует", () => {
  const r = copyWarn("Считаем смету по объекту, а не по среднему прайсу.");
  if (r.code !== 0) return `exit ${r.code}, ожидался 0`;
  if (!/контраст|противопоставл/i.test(r.stdout)) return "предупреждения про контраст нет";
  return true;
});

step("придаточное цели с отрицанием («чтобы не») -> W", () => {
  const r = copyWarn("Отсекаем нецелевые заявки, чтобы бюджет не уходил впустую.");
  if (r.code !== 0) return `exit ${r.code}, ожидался 0`;
  if (!/чтобы не|хвост|досказ/i.test(r.stdout)) return "предупреждения про хвост нет";
  return true;
});

step("третье лицо («наша компания») -> W", () => {
  const r = copyWarn("Наша компания работает с 2005 года и ведет объекты под ключ.");
  if (r.code !== 0) return `exit ${r.code}, ожидался 0`;
  if (!/треть|лиц/i.test(r.stdout)) return "предупреждения про третье лицо нет";
  return true;
});

step("смешение обращения ты/вы -> W (проверка по глаголам, а не по местоимениям)", () => {
  const r = copyWarn("Оставляете заявку и получаете смету. Дальше выбираешь удобную дату и подтверждаешь выезд.");
  if (r.code !== 0) return `exit ${r.code}, ожидался 0`;
  if (!/обращени/i.test(r.stdout)) return "предупреждения про обращение нет";
  return true;
});

step("ложное срабатывание обращения: существительное в предложном не считается «вы»-формой", () => {
  const r = copyWarn("Работаем по договору, в личном кабинете видите статус заявки.");
  if (r.code !== 0) return `exit ${r.code}, ожидался 0`;
  if (/обращени[ея] плыв/i.test(r.stdout)) return "ложное срабатывание: обращение объявлено плывущим";
  return true;
});

step("предложение длиннее 20 слов -> W (читаемость с телефона, не анти-ИИ)", () => {
  const r = copyWarn("Мы проектируем и монтируем системы вентиляции для производственных помещений любой сложности с учетом требований пожарной безопасности и санитарных норм вашего региона.");
  if (r.code !== 0) return `exit ${r.code}, ожидался 0`;
  if (!/20 слов|длин/i.test(r.stdout)) return "предупреждения про длину предложения нет";
  return true;
});

// Регистр НОВОЙ формы (контракт 3.2): { tone_id, axes: {a,b,c}|null, source }.
// axes заполняет оркестратор после тон-гейта копией осей выбранного tone_candidate.
// Старый разбор (chosen-индекс -> axes[индекс] -> recommended) МЕРТВ - легаси-веток нет.
let regCase = 0;
function registerPage(register) {
  const dir = join(SANDBOX, "copy", `reg${++regCase}`);
  const pageDir = join(dir, "pages", "test");
  mkdirSync(pageDir, { recursive: true });
  writeFileSync(join(dir, "inputs.json"), JSON.stringify({ brand_name: "ВентПро" }), "utf8");
  writeFileSync(join(dir, "strategy.json"), JSON.stringify({ decisions: { register } }), "utf8");
  writeFileSync(join(pageDir, "page.json"), JSON.stringify({
    page: { slug: "test", title: "Монтаж вентиляции в Казани", description: "Монтируем вентиляцию под ключ, гарантия 3 года." },
    h1: "Монтаж вентиляции в Казани",
    // 4 места с CTA - перебор для отбирающего (лимит 1-2); срабатывание видно только при применившемся регистре
    blocks: [
      { n: 1, type: "Первый экран (Hero)", fragment: "hero", slots: { h1: "Монтаж вентиляции в Казани", subhead: "Ведем три объекта одновременно", cta_label: "Получить расчет" } },
      { n: 2, type: "CTA", fragment: "cta-mid", slots: { cta_label: "Получить смету" } },
      { n: 3, type: "CTA", fragment: "cta-mid", slots: { cta_label: "Забрать прайс" } },
      { n: 4, type: "Форма", fragment: "form", slots: { cta_label: "Оставить заявку" } },
    ],
  }), "utf8");
  return pageDir;
}

step("register новой формы {tone_id, axes, source}: ось А «отбирающий» применяется, перебор CTA -> W", () => {
  const r = run([VERIFY_COPY, registerPage({ tone_id: "t3", axes: { a: "отбирающий", b: "функциональный", c: "официальный" }, source: "tone-gate" })]);
  if (r.code !== 0) return `exit ${r.code}, ожидался 0 (регистр только предупреждает)`;
  if (!/CTA/i.test(r.stdout)) return "предупреждения про число мест с CTA нет";
  if (!/отбирающ/i.test(r.stdout)) return "ось А из register.axes не применена - регистр не назван";
  return true;
});

step("register с source pending (тон не выбран, axes null) -> слой молчит, деловой дефолт у писателя", () => {
  const r = run([VERIFY_COPY, registerPage({ tone_id: null, axes: null, source: "pending" })]);
  if (r.code !== 0) return `exit ${r.code}, ожидался 0`;
  if (/регистр/i.test(r.stdout)) return "слой регистра сработал при невыбранном тоне";
  return true;
});

step("старая форма register (массив axes + chosen-индекс) не разбирается - легаси-ветка мертва", () => {
  const r = run([VERIFY_COPY, registerPage({ variants: ["a", "b", "c"], recommended: 1, axes: [{ a: "продающий" }, { a: "деловой" }, { a: "отбирающий" }], chosen: 2 })]);
  if (r.code !== 0) return `exit ${r.code}, ожидался 0`;
  if (/регистр/i.test(r.stdout)) return "старая форма register применилась - по контракту 3.2 ее разбор удален";
  return true;
});

step("нет strategy.json -> слой регистра молчит (штатная деградация)", () => {
  const r = copyWarn("Считаем смету по объекту.");
  if (r.code !== 0) return `exit ${r.code}`;
  if (/регистр/i.test(r.stdout)) return "слой регистра сработал без strategy.json";
  return true;
});

// ──────────────────────────────────────────────────────────────────────────
console.log("");
console.log("=== verify-copy.mjs (типографика, repeatables, сверка с blueprint) ===");
// ──────────────────────────────────────────────────────────────────────────

// Страница + blueprint рядом: verify-copy ищет blueprints/<slug>.json на два уровня выше page.json
function copyPageBp({ blocks, bpBlocks }) {
  const dir = join(SANDBOX, "copy", `bp${++copyCase}`);
  const pageDir = join(dir, "pages", "test");
  mkdirSync(pageDir, { recursive: true });
  mkdirSync(join(dir, "blueprints"), { recursive: true });
  writeFileSync(join(dir, "inputs.json"), JSON.stringify({ brand_name: "ВентПро" }), "utf8");
  writeFileSync(join(dir, "blueprints", "test.json"), JSON.stringify({ page: { slug: "test" }, blocks: bpBlocks }), "utf8");
  writeFileSync(join(pageDir, "page.json"), JSON.stringify({
    page: { slug: "test", title: "Монтаж вентиляции в Казани", description: "Монтируем вентиляцию под ключ, гарантия 3 года." },
    h1: "Монтаж вентиляции в Казани",
    blocks,
  }), "utf8");
  return pageDir;
}
const BP_HERO = { n: 1, type: "Первый экран (Hero)", fragment: "hero", limits: { h1: "20-60" } };

step("число словом («три дня») -> W", () => {
  const r = copyWarn("Отгружаем партию за три дня после оплаты.");
  if (r.code !== 0) return `exit ${r.code}, ожидался 0`;
  if (!/цифр/i.test(r.stdout)) return "предупреждения про числа цифрами нет";
  return true;
});

step("прямые кавычки в клиентском тексте -> W (в тексте только елочки)", () => {
  const r = copyWarn('Работаем по договору "под ключ" с фиксированной сметой.');
  if (r.code !== 0) return `exit ${r.code}, ожидался 0`;
  if (!/кавыч/i.test(r.stdout)) return "предупреждения про кавычки нет";
  return true;
});

step("repeatable: 1 плашка при лимите «ровно 3» -> V (ломает сетку)", () => {
  const r = run([VERIFY_COPY, copyPageBp({
    blocks: [{ n: 1, type: "Первый экран (Hero)", fragment: "hero", slots: { h1: "Монтаж вентиляции в Казани", plates: [{ title: "Сроки", text: "Сдаем за 14 дней по договору" }] } }],
    bpBlocks: [{ n: 1, type: "Первый экран (Hero)", fragment: "hero", limits: { h1: "20-60", plates: "ровно 3: title 10-30 + text 30-90" } }],
  })]);
  if (r.code !== 2) return `exit ${r.code}, ожидался 2`;
  if (!/plates|плашк/i.test(r.stdout)) return "в выводе не назван слот plates";
  return true;
});

// Лимит структурой (контракт 2.2): правило и пояснение в разных полях. Строковый лимит -
// свободная проза, и валидатор вычитывал числа из ПОЯСНЕНИЯ: строка «НЕ заполнять - плашек
// нет (правка заказчика); каталожная норма - ровно 3 плашки» давала блокирующее нарушение
// в блоке, из которого заказчик плашки прямо убрал.
step("лимит-объект: skip снимает измерение, числа из note не читаются как правило", () => {
  const r = run([VERIFY_COPY, copyPageBp({
    blocks: [{ n: 1, type: "Первый экран (Hero)", fragment: "hero", slots: { h1: "Онлайн-школа архитектурного софта", subhead: "Ведем от первого урока до диплома за 4 месяца", cta_label: "Начать учиться", plates: [{ title: "Сроки", text: "Поток стартует раз в месяц по расписанию" }] } }],
    bpBlocks: [{ n: 1, type: "Первый экран (Hero)", fragment: "hero", function: "Р", sell: "первый экран",
      limits: { h1: { min: 20, max: 60 }, plates: { skip: true, note: "плашек нет - правка заказчика; каталожная норма формы, если бы блок собирался целиком, - ровно 3 плашки" } } }],
  })]);
  if (r.code !== 0) return `exit ${r.code} - числа из пояснения снова читаются как правило: ${r.stdout}`;
  return true;
});

step("лимит-объект: exactly работает так же жестко, как строковое «ровно N»", () => {
  const r = run([VERIFY_COPY, copyPageBp({
    blocks: [{ n: 1, type: "Первый экран (Hero)", fragment: "hero", slots: { h1: "Монтаж вентиляции в Казани", plates: [{ title: "Сроки", text: "Сдаем за 14 дней по договору" }] } }],
    bpBlocks: [{ n: 1, type: "Первый экран (Hero)", fragment: "hero", limits: { h1: { min: 20, max: 60 }, plates: { count: { exactly: 3 }, title: { min: 10, max: 30 }, text: { min: 30, max: 90 } } } }],
  })]);
  if (r.code !== 2) return `exit ${r.code}, ожидался 2 (объектный лимит не проверяется)`;
  if (!/plates|плашк/i.test(r.stdout)) return "в выводе не назван слот plates";
  return true;
});

// Контракт 2.3: слова заказчика систематически короче каталожных диапазонов, и каждый
// писатель объяснял это в notes_internal отдельно. Признак ставит планировщик, не писатель.
step("verbatim: формулировка заказчика короче лимита - нарушения нет, в отчете видно почему", () => {
  const r = run([VERIFY_COPY, copyPageBp({
    blocks: [{ n: 1, type: "Первый экран (Hero)", fragment: "hero", h2: "Обучение",
      slots: { h1: "Онлайн-школа архитектурного софта", subhead: "Ведем от первого урока до диплома за 4 месяца", cta_label: "Начать учиться" } }],
    bpBlocks: [{ n: 1, type: "Первый экран (Hero)", fragment: "hero", function: "Р", sell: "первый экран",
      verbatim: ["h2", "cta_label"],
      limits: { h1: "20-60", h2: "20-70", cta_label: "15-30" } }],
  })]);
  if (r.code !== 0) return `exit ${r.code}: ${r.stdout}`;
  if (/«h2»|«cta_label»/.test(r.stdout) && /вне лимита/.test(r.stdout)) return "слово заказчика все еще меряется лимитом";
  if (!/лимит не применялся/.test(r.stdout)) return "в отчете не видно, что лимит снят и почему";
  return true;
});

step("блок есть в blueprint, но текста нет -> V (собирать HTML нельзя)", () => {
  const r = run([VERIFY_COPY, copyPageBp({
    blocks: [{ n: 1, type: "Первый экран (Hero)", fragment: "hero", slots: { h1: "Монтаж вентиляции в Казани", subhead: "Сдаем под пусконаладку за 14 дней", cta_label: "Рассчитать стоимость" } }],
    bpBlocks: [BP_HERO, { n: 2, type: "Цены", fragment: "pricing", function: "К", limits: { h2: "20-70" } }],
  })]);
  if (r.code !== 2) return `exit ${r.code}, ожидался 2`;
  if (!/blueprint|не написан|недоста/i.test(r.stdout)) return "не сказано, что блок blueprint остался без текста";
  return true;
});

step("блок в режиме «шаблон»: демо-единицы не меряются лимитом запуска (иначе сборка встанет намертво)", () => {
  const r = run([VERIFY_COPY, copyPageBp({
    blocks: [
      { n: 1, type: "Первый экран (Hero)", fragment: "hero", slots: { h1: "Монтаж вентиляции в Казани", subhead: "Сдаем под пусконаладку за 14 дней", cta_label: "Рассчитать стоимость" } },
      { n: 2, type: "Листинг", fragment: "product-listing", slots: { products: [{ title: "Приточная установка [ЗАПОЛНИТЬ: модель]" }, { title: "Вытяжной вентилятор [ЗАПОЛНИТЬ: модель]" }] } },
    ],
    bpBlocks: [
      BP_HERO,
      { n: 2, type: "Листинг", fragment: "product-listing", mode: "шаблон", demo_units: 2, limits: { products: "6-24 карточки к запуску; в прототипе 2 демо" } },
    ],
  })]);
  if (r.code !== 0) return `exit ${r.code}, ожидался 0: лимит запуска применен к демо-единицам, а текстом это не чинится`;
  return true;
});

step("состав блоков совпадает с blueprint -> сверка молчит", () => {
  const r = run([VERIFY_COPY, copyPageBp({
    blocks: [{ n: 1, type: "Первый экран (Hero)", fragment: "hero", slots: { h1: "Монтаж вентиляции в Казани", subhead: "Сдаем под пусконаладку за 14 дней", cta_label: "Рассчитать стоимость" } }],
    bpBlocks: [BP_HERO],
  })]);
  if (r.code !== 0) return `exit ${r.code}: ${r.stdout}`;
  return true;
});

// ──────────────────────────────────────────────────────────────────────────
console.log("");
console.log("=== диета контекста писателя (ADR-020) + чистота образцов ===");
// ──────────────────────────────────────────────────────────────────────────

// Замер, предписанный ADR-020 разделом 5 и не сделанный две программы подряд.
// Потолки пересмотрены 2026-08-21 (ADR-037): прежние 22 000 / 14 000 были откалиброваны
// на состоянии, где у писателя не хватало техники продажи - именно это и оказалось диагнозом.
// Числа ниже - фактическое состояние после программы плюс небольшой запас; расти дальше нельзя.
const DIET_TOTAL = 33000;   // page-writer.md + VOICE.md
const DIET_VOICE = 20500;   // VOICE.md отдельно

// Диета меряется В ЗНАКАХ, не в байтах. На кириллице wc -c врет примерно в 1.7 раза:
// на боевом прогоне по байтовой метрике VOICE.md выглядел пробившим потолок, хотя не пробивал.
step("ADR-020: обязательный вход писателя в знаках не растет", () => {
  const voice = readFileSync(join(PROJECT_ROOT, ".claude/skills/seo-tekst/assets/VOICE.md"), "utf8").length;
  const writer = readFileSync(join(PROJECT_ROOT, ".claude/agents/page-writer.md"), "utf8").length;
  const total = voice + writer;
  const line = `VOICE.md ${voice} + page-writer.md ${writer} = ${total} знаков (потолки ${DIET_VOICE} / ${DIET_TOTAL})`;
  if (voice > DIET_VOICE) return `VOICE.md пробил свой потолок: ${line}`;
  if (total > DIET_TOTAL) return `фиксированный вход писателя пробил потолок: ${line}`;
  console.log(`      ${line}`);
  return true;
});

// Диета покрывала только САМОГО ЛЕГКОГО агента: потолок стоял на писателе (12 817 знаков),
// а три самых тяжелых - block-planner, tekst-verifier, offer-strategist - и методички на
// 30-55 тысяч знаков не были ограничены ничем. Замер боевого прогона: 27 запусков субагентов,
// ~3 350 000 токенов, ~3 часа 47 минут на ОДНУ страницу в трех тон-вариантах.
// Потолки ниже - фактическое состояние после разделения BLOCKS.md плюс небольшой запас.
// Кто исполняет: автор правок этих файлов. Зачем: рост промта должен быть решением, а не
// побочным следствием дописывания абзаца; перегруженный агент теряет главное.
const CAPS = [
  [".claude/skills/seo-tekst/SKILL.md", 57500, "оркестратор"],
  [".claude/skills/seo-tekst/assets/KIT-SPEC.md", 38500, "разработчик шаблона (в промты агентов не идет)"],
  [".claude/skills/seo-tekst/assets/COPY.md", 37500, "page-writer (точечно)"],
  [".claude/skills/seo-tekst/assets/COPY-AUDIT.md", 36000, "copy-auditor"],
  [".claude/agents/block-planner.md", 31500, "block-planner"],
  [".claude/skills/seo-tekst/assets/BLOCKS.md", 31000, "block-planner"],
  [".claude/skills/seo-tekst/assets/BLOCKS-METRICS.md", 31000, "slot-mapper"],
  [".claude/agents/tekst-verifier.md", 30000, "tekst-verifier"],
  [".claude/agents/offer-strategist.md", 30000, "offer-strategist"],
  [".claude/agents/slot-mapper.md", 16500, "slot-mapper"],
  [".claude/agents/site-reviewer.md", 16000, "site-reviewer"],
  // pages-planner намеренно получил +800 знаков диеты чтения (замер прогона: 512 секунд и
  // ~150 000 токенов на черновик без единого MCP-вызова). Обмен осознанный: короткий блок
  // правил в промте против нескольких лишних файлов в контексте на каждом запуске.
  [".claude/agents/pages-planner.md", 16000, "pages-planner"],
  [".claude/agents/copy-auditor.md", 15500, "copy-auditor"],
  [".claude/agents/prototype-builder.md", 11000, "prototype-builder"],
];
// Связка «промт агента + его методички» - то, что реально уезжает в контекст до данных.
const BUNDLES = [
  ["block-planner", 62000, [".claude/agents/block-planner.md", ".claude/skills/seo-tekst/assets/BLOCKS.md"]],
  ["slot-mapper", 63000, [".claude/agents/slot-mapper.md", ".claude/skills/seo-tekst/assets/BLOCKS-METRICS.md", ".claude/skills/seo-tekst/assets/fragments-manifest.json"]],
  ["copy-auditor", 51000, [".claude/agents/copy-auditor.md", ".claude/skills/seo-tekst/assets/COPY-AUDIT.md"]],
];

step("потолки в знаках стоят на ВСЕХ тяжелых файлах, не только на писателе", () => {
  const over = [];
  for (const [rel, cap, who] of CAPS) {
    const n = readFileSync(join(PROJECT_ROOT, rel), "utf8").length;
    if (n > cap) over.push(`${rel.split("/").pop()} ${n} > ${cap} (читает ${who})`);
  }
  if (over.length) return `пробит потолок: ${over.join("; ")} - это решение владельца, а не побочный эффект правки`;
  return true;
});

step("связка «агент + его методички» не растет (то, что уезжает в контекст до данных)", () => {
  const over = [];
  const lines = [];
  for (const [who, cap, files] of BUNDLES) {
    const n = files.reduce((a, f) => a + readFileSync(join(PROJECT_ROOT, f), "utf8").length, 0);
    lines.push(`${who} ${n}/${cap}`);
    if (n > cap) over.push(`${who}: ${n} > ${cap}`);
  }
  console.log(`      ${lines.join(" | ")}`);
  if (over.length) return `фиксированный вход пробил потолок: ${over.join("; ")}`;
  return true;
});

step("разделение BLOCKS.md: у каждого агента своя половина, обе на месте", () => {
  const planner = readFileSync(join(PROJECT_ROOT, ".claude/skills/seo-tekst/assets/BLOCKS.md"), "utf8");
  const metrics = readFileSync(join(PROJECT_ROOT, ".claude/skills/seo-tekst/assets/BLOCKS-METRICS.md"), "utf8");
  // Решения - у планировщика
  for (const s of ["Таблица применимости", "Скелеты типов страниц", "Три режима сборки блока", "Регистр текста", "Рецепты блоков по типу", "Индекс блоков"]) {
    if (!planner.includes(s)) return `в BLOCKS.md нет раздела «${s}» - потерян при разделении`;
    if (metrics.includes("## " + s) || metrics.includes("### " + s)) return `раздел «${s}» задвоился в BLOCKS-METRICS.md`;
  }
  // Метрики - у slot-mapper
  for (const s of ["Полный каталог из 45 блоков", "Каталожные блоки", "Глобальные правила заголовков", "Пороговые правила по количеству"]) {
    if (!metrics.includes(s)) return `в BLOCKS-METRICS.md нет раздела «${s}»`;
  }
  // Индекс покрывает весь каталог: имя блока планировщика обязано находиться в метриках
  const idxNames = [...planner.matchAll(/^\| (?:\d+к?|-) \| ([^|]+) \|/gm)].map((m) => m[1].trim());
  if (idxNames.length < 50) return `в индексе блоков только ${idxNames.length} строк - каталог обрезан`;
  const missing = idxNames.filter((n) => !metrics.includes(n.split(" **")[0].trim()));
  if (missing.length) return `блоки индекса без метрик: ${missing.slice(0, 3).join("; ")}`;
  // Char-метрик у планировщика быть не должно: их признак - колонка ОБЪЁМ в таблице каталога
  if (/\| ОБЪ[ЁЕ]М \|/.test(planner)) return "в BLOCKS.md осталась таблица каталога с колонкой ОБЪЁМ - разделение не отработало";
  return true;
});

step("образцы в методичках не нарушают собственный свод (е-с-точками, тире)", () => {
  const files = [
    ".claude/skills/seo-tekst/assets/VOICE.md",
    ".claude/skills/seo-tekst/assets/COPY-AUDIT.md",
    ".claude/agents/page-writer.md",
  ];
  const bad = [];
  for (const rel of files) {
    const text = readFileSync(join(PROJECT_ROOT, rel), "utf8");
    for (const m of text.match(/«[^»]*»/g) || []) {
      if (/[ёЁ]/.test(m)) bad.push(`${rel}: ${m.slice(0, 60)} (е-с-точками)`);
      if (/[—–]/.test(m)) bad.push(`${rel}: ${m.slice(0, 60)} (длинное тире)`);
    }
  }
  if (bad.length) return `образец копируется в клиентский текст как есть: ${bad.slice(0, 3).join(" | ")}${bad.length > 3 ? ` и ещё ${bad.length - 3}` : ""}`;
  return true;
});

// ──────────────────────────────────────────────────────────────────────────
console.log("");
console.log("=== verify-copy.mjs: продающий пол (ADR-037) ===");
// ──────────────────────────────────────────────────────────────────────────

// Фикстура пола: свой тип страницы и свой meta.json (там живут selling_floor_waivers).
function floorPage({ type = "Услуга", blocks, waivers = null, facts = true }) {
  const dir = join(SANDBOX, "copy", `floor${++copyCase}`);
  const pageDir = join(dir, "pages", "test");
  mkdirSync(pageDir, { recursive: true });
  writeFileSync(join(dir, "inputs.json"), JSON.stringify({ brand_name: "ВентПро" }), "utf8");
  // F2 жёсткая только когда приземлять ЕСТЬ на что: пустой по публикуемым числам facts.json -
  // это дыра фактуры, а не брак текста, и пол штатно деградирует до предупреждения.
  if (facts) writeFileSync(join(dir, "facts.json"), JSON.stringify({ numbers: [{ label: "лет на рынке", value: "9", publish: "as-is" }, { label: "объектов сдано", value: "137", publish: "as-is" }] }), "utf8");
  if (waivers) writeFileSync(join(dir, "meta.json"), JSON.stringify({ state: "texts-written", selling_floor_waivers: waivers }), "utf8");
  writeFileSync(join(pageDir, "page.json"), JSON.stringify({
    page: { slug: "test", title: "Монтаж вентиляции в Казани", description: "Монтируем вентиляцию под ключ, гарантия 3 года.", type },
    h1: "Монтаж вентиляции в Казани",
    blocks,
  }), "utf8");
  return pageDir;
}
const HERO_NO_NUM = { n: 1, type: "Первый экран (Hero)", fragment: "hero", slots: { h1: "Монтаж вентиляции в Казани", subhead: "Проектируем, монтируем и сдаем под пусконаладку", cta_label: "Рассчитать стоимость" } };

// ГРАНИЦА МАШИНЫ (ADR-037 F2). Обещание приземляется тремя равноправными способами - числом из
// facts.json, названным адресатом, обещанным результатом. Грепом различим только первый, поэтому
// скрипт жёстко валит ТОЛЬКО отсутствие несущего слота, а суждение выносит tekst-verifier.
const HERO_NO_SUB = { n: 1, type: "Первый экран (Hero)", fragment: "hero", slots: { h1: "Монтаж вентиляции в Казани", cta_label: "Рассчитать стоимость" } };

step("F2: коммерческая страница без подзаголовка Hero -> exit 2 (несущий слот пуст)", () => {
  const r = run([VERIFY_COPY, floorPage({ blocks: [HERO_NO_SUB] })]);
  if (r.code !== 2) return `exit ${r.code}, ожидался 2 (нет несущего слота оффера)`;
  if (!/пол F2/.test(r.stdout)) return "нарушение не названо полом F2";
  return true;
});

step("F2: подзаголовок без числа сборку НЕ блокирует - обещание может держаться на адресате", () => {
  const r = run([VERIFY_COPY, floorPage({
    blocks: [{ n: 1, type: "Первый экран (Hero)", fragment: "hero", slots: { h1: "Монтаж вентиляции в Казани", subhead: "Сетям стоматологий: собираем приточку так, что кабинеты не простаивают", cta_label: "Рассчитать стоимость" } }],
  })]);
  if (r.code !== 0) return `exit ${r.code}, ожидался 0: скрипт судит о том, что грепом не различимо`;
  if (!/пол F2/.test(r.stdout)) return "нет предупреждения с отсылкой к tekst-verifier";
  return true;
});

step("F2: число в подзаголовке, которого нет в facts.json -> предупреждение о сочинённой цифре", () => {
  const r = run([VERIFY_COPY, floorPage({
    blocks: [{ n: 1, type: "Первый экран (Hero)", fragment: "hero", slots: { h1: "Монтаж вентиляции в Казани", subhead: "Сдаем под пусконаладку за 21 день, гарантия 12 лет", cta_label: "Рассчитать стоимость" } }],
  })]);
  if (r.code !== 0) return `exit ${r.code}, ожидался 0 (это предупреждение, а не блокировка)`;
  if (!/НЕ подтверждено facts\.json/.test(r.stdout)) return "не сказано, что число не подтверждено фактурой";
  return true;
});

step("F2: тот же случай на некоммерческом типе -> предупреждение, сборку не блокирует", () => {
  const r = run([VERIFY_COPY, floorPage({ type: "Контакты", blocks: [HERO_NO_SUB] })]);
  if (r.code !== 0) return `exit ${r.code}, ожидался 0: пол применён к странице контактов`;
  if (!/пол F2/.test(r.stdout)) return "нет мягкого напоминания про пол";
  return true;
});

step("F2: валидный waiver понижает нарушение до предупреждения", () => {
  const r = run([VERIFY_COPY, floorPage({
    blocks: [HERO_NO_SUB],
    waivers: [{ page: "test", rule: "F2", why: "заказчик снял все цифры", source: "strategy.materials_missing[цифры результата]" }],
  })]);
  if (r.code !== 0) return `exit ${r.code}, ожидался 0: waiver не сработал`;
  if (!/waiver/.test(r.stdout)) return "в отчёте не видно, что пол снят waiver'ом";
  return true;
});

step("F2: waiver без source игнорируется и об этом СООБЩАЕТСЯ", () => {
  const r = run([VERIFY_COPY, floorPage({
    blocks: [HERO_NO_SUB],
    waivers: [{ page: "test", rule: "F2", why: "не хочется", source: "" }],
  })]);
  if (r.code !== 2) return `exit ${r.code}, ожидался 2: waiver без основания принят`;
  if (!/waiver не применён/.test(r.stdout)) return "молчащий waiver: оркестратор решит, что пол снят";
  return true;
});

step("waiver со списком правил в одном поле («F1|F2|F3|F4») не применяется молча", () => {
  const r = run([VERIFY_COPY, floorPage({
    blocks: [HERO_NO_SUB],
    waivers: [{ page: "test", rule: "F1|F2|F3|F4", why: "шаблон скопирован дословно", source: "decisions.register.tone_id" }],
  })]);
  if (r.code !== 2) return `exit ${r.code}, ожидался 2: список правил в одном поле снял нарушение`;
  if (!/waiver не применён/.test(r.stdout)) return "не сказано, что waiver не разобран - это молчащий обход пола";
  return true;
});

step("F3: страница без единого целевого действия -> exit 2", () => {
  const r = run([VERIFY_COPY, floorPage({
    blocks: [{ n: 1, type: "Первый экран (Hero)", fragment: "hero", slots: { h1: "Монтаж вентиляции в Казани", subhead: "Сдаем под пусконаладку за 14 дней" } }],
  })]);
  if (r.code !== 2) return `exit ${r.code}, ожидался 2`;
  if (!/пол F3/.test(r.stdout)) return "не названо полом F3";
  return true;
});

step("F3: «Отправить» на главной кнопке -> exit 2, «Подробнее» в карточке листинга -> нет", () => {
  const bad = run([VERIFY_COPY, floorPage({
    blocks: [{ n: 1, type: "Первый экран (Hero)", fragment: "hero", slots: { h1: "Монтаж вентиляции в Казани", subhead: "Сдаем под пусконаладку за 14 дней", cta_label: "Отправить" } }],
  })]);
  if (bad.code !== 2) return `главная кнопка «Отправить» прошла: exit ${bad.code}`;
  const ok = run([VERIFY_COPY, floorPage({
    blocks: [
      { n: 1, type: "Первый экран (Hero)", fragment: "hero", slots: { h1: "Монтаж вентиляции в Казани", subhead: "Сдаем под пусконаладку за 14 дней", cta_label: "Рассчитать стоимость" } },
      { n: 2, type: "Листинг", fragment: "product-listing", slots: { products: [{ title: "Приточная установка", cta: "Подробнее" }, { title: "Вытяжной вентилятор", cta: "Подробнее" }] } },
    ],
  })]);
  if (ok.code !== 0) return `«Подробнее» в карточке листинга заблокировало сборку: exit ${ok.code}: ${ok.stdout}`;
  return true;
});

step("F2: цифра внутри имени («Bitrix24», «152-ФЗ») числом не считается", () => {
  const r = run([VERIFY_COPY, floorPage({
    blocks: [{ n: 1, type: "Первый экран (Hero)", fragment: "hero", slots: { h1: "Настройка Bitrix24 в Казани", subhead: "Внедряем Bitrix24 по 152-ФЗ и сопровождаем портал", cta_label: "Рассчитать стоимость" } }],
  })]);
  if (r.code !== 0) return `exit ${r.code}, ожидался 0: это предупреждение, а не блокировка`;
  if (/НЕ подтверждено facts\.json/.test(r.stdout)) return "«Bitrix24»/«152-ФЗ» разобраны как число - имя продукта принято за цифру обещания";
  if (!/нет числа/.test(r.stdout)) return "нет предупреждения о том, что числа в подзаголовке нет";
  return true;
});

step("F2: число в плашке не заменяет обещание в подзаголовке -> W, а не V", () => {
  const r = run([VERIFY_COPY, floorPage({
    blocks: [{ n: 1, type: "Первый экран (Hero)", fragment: "hero", slots: { h1: "Монтаж вентиляции в Казани", subhead: "Проектируем, монтируем и сдаем под пусконаладку", cta_label: "Рассчитать стоимость", plates: [{ title: "9 лет на рынке", text: "137 объектов сдано" }] } }],
  })]);
  if (r.code !== 0) return `exit ${r.code}, ожидался 0: цифра в плашке должна давать предупреждение, а не блокировать`;
  if (!/не несущем слоте|не в несущем слоте/.test(r.stdout)) return "нет предупреждения про несущий слот";
  return true;
});

step("F2: в facts.json нет публикуемых чисел -> деградация до W (дыра фактуры, не брак текста)", () => {
  const r = run([VERIFY_COPY, floorPage({ blocks: [HERO_NO_NUM], facts: false })]);
  if (r.code !== 0) return `exit ${r.code}, ожидался 0: пол требует цифру, которой в проекте нет`;
  if (!/публикуемых чисел в facts\.json нет вовсе/.test(r.stdout)) return "не сказано, что публикуемых чисел в проекте нет";
  return true;
});

step("F2: бесплатный первый шаг засчитывается за приземление обещания", () => {
  const r = run([VERIFY_COPY, floorPage({
    blocks: [{ n: 1, type: "Первый экран (Hero)", fragment: "hero", slots: { h1: "Консультация юриста по банкротству", subhead: "Разберем вашу ситуацию и честно скажем, спишутся ли долги. Бесплатно и ни к чему не обязывает", cta_label: "Записаться на разбор" } }],
  })]);
  if (r.code !== 0) return `exit ${r.code}: бесплатный шаг не зачтен за приземление`;
  return true;
});

// Тип страницы взят такой, что F1 идет в ЖЁСТКУЮ ветку: «Товар» без слов «листинг/каталог/зонтик».
// Прежняя фикстура («Товар (листинг-зонтик моделей)») отсекалась словом в типе ещё до формы
// страницы - тест проходил и с вырезанной константой CATALOG_SHAPE, то есть не проверял ничего.
// Тест парный: одна и та же страница без каталожной формы обязана валиться, с ней - проходить.
const CATALOG_BLOCKS = [
  { n: 1, type: "Хлебные крошки", fragment: "breadcrumbs", slots: {} },
  { n: 2, type: "Описание направления", fragment: "cards", h2: "Караваны разных производителей", slots: { subhead: "В наличии 12 моделей, доставка по России", items: [{ title: "Выбор", text: "Подберем модель под ваш автомобиль и бюджет" }] } },
  { n: 3, type: "Листинг", fragment: "product-listing", slots: { products: [{ title: "Караван Белка", cta: "Узнать цену и наличие" }] } },
];

step("F1: каталожный рецепт (крошки -> intro -> листинг) без Hero не блокируется", () => {
  const r = run([VERIFY_COPY, floorPage({ type: "Товар", blocks: CATALOG_BLOCKS })]);
  if (r.code !== 0) return `exit ${r.code}: каталожный рецепт заблокирован полом F1: ${r.stdout}`;
  if (!/пол F1: первого экрана нет/.test(r.stdout)) return "нет мягкого напоминания про F1 - похоже, ветка отсутствия Hero вообще не задействована";
  return true;
});

step("F1: тот же тип «Товар» БЕЗ каталожной формы -> exit 2 (жёсткая ветка достижима)", () => {
  const r = run([VERIFY_COPY, floorPage({ type: "Товар", blocks: CATALOG_BLOCKS.slice(1) })]);
  if (r.code !== 2) return `exit ${r.code}, ожидался 2: карточка товара без первого экрана прошла`;
  if (!/пол F1/.test(r.stdout)) return "не названо полом F1";
  return true;
});

step("F2: пометка [ЗАПОЛНИТЬ] в первом экране -> exit 2 (самое видное место читается недоделанным)", () => {
  const r = run([VERIFY_COPY, floorPage({
    blocks: [{ n: 1, type: "Первый экран (Hero)", fragment: "hero", slots: { h1: "Монтаж вентиляции в Казани", subhead: "Сдаем под пусконаладку за 9 лет опыта", cta_label: "Рассчитать стоимость", bonus: "[ЗАПОЛНИТЬ: бонус первого экрана]" } }],
  })]);
  if (r.code !== 2) return `exit ${r.code}, ожидался 2: дыра фактуры в Hero прошла молча`;
  if (!/ЗАПОЛНИТЬ/.test(r.stdout)) return "нарушение не названо пометкой в первом экране";
  return true;
});

step("доставка формулы: объектный рецепт без page_offer в blueprint -> exit 2", () => {
  const dir = join(SANDBOX, "copy", `po${++copyCase}`);
  const pageDir = join(dir, "pages", "test");
  mkdirSync(pageDir, { recursive: true });
  mkdirSync(join(dir, "blueprints"), { recursive: true });
  writeFileSync(join(dir, "inputs.json"), JSON.stringify({ brand_name: "ВентПро" }), "utf8");
  writeFileSync(join(dir, "strategy.json"), JSON.stringify({ offer_formula_recipe: { formula: 1, name: "РКС + выгода", h1: "маркер + регион" } }), "utf8");
  writeFileSync(join(dir, "blueprints", "test.json"), JSON.stringify({ page: { slug: "test" }, blocks: [{ n: 1, type: "Первый экран (Hero)", fragment: "hero", sell: "выгода по срокам, меряется днями, ведет к расчету", limits: { h1: "20-60" } }] }), "utf8");
  writeFileSync(join(pageDir, "page.json"), JSON.stringify({
    page: { slug: "test", title: "Монтаж вентиляции в Казани", description: "Монтируем вентиляцию под ключ, гарантия 3 года.", type: "Услуга" },
    h1: "Монтаж вентиляции в Казани",
    blocks: [HERO_OK],
  }), "utf8");
  const r = run([VERIFY_COPY, pageDir]);
  if (r.code !== 2) return `exit ${r.code}, ожидался 2: формула оффера до ТЗ не доехала, а гейт промолчал`;
  if (!/page_offer/.test(r.stdout)) return "в выводе не назван page_offer";
  return true;
});

step("доставка формулы: рецепт СТРОКОЙ (старая задача) без page_offer -> предупреждение, exit 0", () => {
  const dir = join(SANDBOX, "copy", `po${++copyCase}`);
  const pageDir = join(dir, "pages", "test");
  mkdirSync(pageDir, { recursive: true });
  mkdirSync(join(dir, "blueprints"), { recursive: true });
  writeFileSync(join(dir, "inputs.json"), JSON.stringify({ brand_name: "ВентПро" }), "utf8");
  writeFileSync(join(dir, "strategy.json"), JSON.stringify({ offer_formula_recipe: "Первая строка отвечает на вопрос что это, дальше две выгоды, замыкает кнопка." }), "utf8");
  writeFileSync(join(dir, "blueprints", "test.json"), JSON.stringify({ page: { slug: "test" }, blocks: [{ n: 1, type: "Первый экран (Hero)", fragment: "hero", sell: "выгода по срокам", limits: { h1: "20-60" } }] }), "utf8");
  writeFileSync(join(pageDir, "page.json"), JSON.stringify({
    page: { slug: "test", title: "Монтаж вентиляции в Казани", description: "Монтируем вентиляцию под ключ, гарантия 3 года.", type: "Услуга" },
    h1: "Монтаж вентиляции в Казани",
    blocks: [HERO_OK],
  }), "utf8");
  const r = run([VERIFY_COPY, pageDir]);
  if (r.code !== 0) return `exit ${r.code}, ожидался 0: старая задача обязана деградировать, а не вставать (ADR-031)`;
  if (!/page_offer/.test(r.stdout)) return "нет предупреждения про page_offer";
  return true;
});

step("F1: product-gallery считается первым экраном (у карточки товара своего hero нет)", () => {
  const r = run([VERIFY_COPY, floorPage({
    type: "Товар",
    blocks: [
      { n: 1, type: "Хлебные крошки", fragment: "breadcrumbs", slots: {} },
      { n: 2, type: "Карточка товара (галерея)", fragment: "product-gallery", slots: { h1: "Прицеп-дача Белка", subhead: "Спальных мест 4, снаряженная масса 750 кг", cta_label: "Узнать цену и наличие" } },
    ],
  })]);
  if (r.code !== 0) return `exit ${r.code}: product-gallery не зачтён как первый экран: ${r.stdout}`;
  if (/пол F1/.test(r.stdout)) return "F1 сработал на карточке товара";
  return true;
});

// ──────────────────────────────────────────────────────────────────────────
console.log("");
console.log("=== verify-copy.mjs --root: тон-варианты главной (контракт 3.4) ===");
// ──────────────────────────────────────────────────────────────────────────

// Тон-гейт: три варианта главной лежат в tone/pages/main--tN/, а общие файлы задачи
// (blueprints/main.json, meta.json с waiver, facts.json, strategy.json) - в корне texts/NNN.
// Оркестратор обязан передать корень параметром --root; blueprint и waiver ищутся по слагу
// страницы из page.json ("main"), а не по имени папки варианта ("main--t1").
const dirToneRoot = join(SANDBOX, "tone-root");
const toneVarDir = join(dirToneRoot, "tone", "pages", "main--t1");
mkdirSync(toneVarDir, { recursive: true });
mkdirSync(join(dirToneRoot, "blueprints"), { recursive: true });
writeFileSync(join(dirToneRoot, "inputs.json"), JSON.stringify({ brand_name: "ВентПро" }), "utf8");
// публикуемые числа есть -> пол F2 в жесткой ветке; без waiver страница ниже не прошла бы
writeFileSync(join(dirToneRoot, "facts.json"), JSON.stringify({ numbers: [{ label: "объектов сдано", value: "137", publish: "as-is" }] }), "utf8");
// на тон-гейте тон еще не выбран - register штатно pending (контракт 3.2)
writeFileSync(join(dirToneRoot, "strategy.json"), JSON.stringify({ decisions: { register: { tone_id: null, axes: null, source: "pending" } } }), "utf8");
writeFileSync(join(dirToneRoot, "meta.json"), JSON.stringify({
  state: "tone-written",
  selling_floor_waivers: [{ page: "main", rule: "F2", why: "заказчик снял цифры со страниц", source: "strategy.materials_missing[кейсы с числами]" }],
}), "utf8");
writeFileSync(join(dirToneRoot, "blueprints", "main.json"), JSON.stringify({
  page: { slug: "main" },
  blocks: [{ n: 1, type: "Первый экран (Hero)", fragment: "hero", limits: { h1: "20-60" } }],
}), "utf8");
// вариант тона: Hero без подзаголовка - штатное срабатывание пола F2, снятое waiver'ом page=main
writeFileSync(join(toneVarDir, "page.json"), JSON.stringify({
  page: { slug: "main", title: "Монтаж вентиляции в Казани", description: "Монтируем вентиляцию под ключ, гарантия 3 года.", type: "Главная", url: "/" },
  h1: "Монтаж вентиляции в Казани",
  blocks: [{ n: 1, type: "Первый экран (Hero)", fragment: "hero", slots: { h1: "Монтаж вентиляции в Казани", cta_label: "Рассчитать стоимость" } }],
}, null, 2), "utf8");

step("--root: blueprint main.json найден по слагу страницы, waiver page=main применен -> exit 0", () => {
  const r = run([VERIFY_COPY, toneVarDir, "--root", dirToneRoot]);
  if (r.code !== 0) return `exit ${r.code}: ${r.stdout}`;
  if (/blueprint не найден/.test(r.stdout)) return "blueprint main.json не найден - --root не довел до blueprints/ корня задачи";
  if (!/waiver/.test(r.stdout)) return "в отчете не видно, что пол F2 снят waiver'ом page=main";
  return true;
});

step("без --root тон-вариант слеп: корень угадан от папки варианта и blueprint теряется", () => {
  const r = run([VERIFY_COPY, toneVarDir]);
  if (!/blueprint не найден/.test(r.stdout)) return "blueprint нашелся без --root - раскладка tone/pages/ изменилась, проверь контракт 3.4";
  return true;
});

// ──────────────────────────────────────────────────────────────────────────
console.log("");
console.log("=== контракт передачи + build-handoff.mjs (ADR-035) ===");
// ──────────────────────────────────────────────────────────────────────────

const BUILD_HANDOFF = join(PROJECT_ROOT, ".claude/scripts/build-handoff.mjs");

step("собранный документ несет контракт: машинный маркер + видимая плашка (вставляет ассемблер)", () => {
  const html = readFileSync(join(dirSite, "prototype.html"), "utf8");
  if (!/name="prototype-contract"/.test(html)) return "нет машинного маркера prototype-contract";
  if (!/ЭТО ПРОТОТИП, А НЕ МАКЕТ/i.test(html)) return "нет комментария-контракта в head";
  if (!/pt-contract/.test(html)) return "нет видимой плашки в body";
  const head = html.slice(0, html.indexOf("</head>"));
  if (head.indexOf("charset") > 1024) return "meta charset уехал за окно предсканирования кодировки (1024 байта)";
  return true;
});

step("verify v2 ловит выпиленный контракт", () => {
  const dst = cloneSite("site-nocontract", (d) => {
    const p = join(d, "prototype.html");
    const html = readFileSync(p, "utf8")
      .replace(/<meta name="prototype-contract"[^>]*>/g, "")
      .replace(/<div class="pt-contract"[\s\S]*?<\/div>\s*<\/div>/, "");
    writeFileSync(p, html, "utf8");
  });
  const r = run([VERIFY_PROTO, dst]);
  if (r.code !== 2) return `exit ${r.code}, ожидался 2`;
  if (!/контракт|prototype-contract/i.test(r.stdout)) return "в выводе нет причины про контракт";
  return true;
});

step("build-handoff: таблица блоков с функцией, режим шаблон и открытые плейсхолдеры", () => {
  const dirH = join(SANDBOX, "handoff");
  mkdirSync(join(dirH, "pages", "main"), { recursive: true });
  mkdirSync(join(dirH, "blueprints"), { recursive: true });
  writeFileSync(join(dirH, "inputs.json"), JSON.stringify({ slug: "vent", brand_name: "ВентПро" }), "utf8");
  writeFileSync(join(dirH, "pages", "main", "page.json"), JSON.stringify({
    page: { slug: "main", title: "Монтаж вентиляции", type: "Главная", url: "/" },
    h1: "Монтаж вентиляции в Казани",
    blocks: [
      { n: 1, type: "Первый экран (Hero)", fragment: "hero", slots: { h1: "Монтаж вентиляции в Казани" }, fill_notes: ["реальное число объектов"] },
      { n: 2, type: "Цены", fragment: "pricing", slots: { h2: "Сколько стоит" }, fill_notes: [] },
    ],
  }), "utf8");
  writeFileSync(join(dirH, "blueprints", "main.json"), JSON.stringify({
    page: { slug: "main" },
    blocks: [
      { n: 1, type: "Первый экран (Hero)", fragment: "hero", function: "Р", function_why: "показывает результат и срок", mode: "рабочий" },
      { n: 2, type: "Цены", fragment: "pricing", function: "К", function_why: "человек находит свою группу", mode: "шаблон", empty_state: "Пока нет тарифов", limits: { h2: "20-70" } },
    ],
  }), "utf8");
  writeFileSync(join(dirH, "strategy.json"), JSON.stringify({ materials_missing: ["2-3 кейса с числами"] }), "utf8");
  writeFileSync(join(dirH, "facts.json"), JSON.stringify({ lexicon: { locked: [{ phrase: "под ключ и без субподряда", source: "созвон" }], canonical: [{ thought: "гарантия", wording: "Гарантия 3 года на монтаж", where: "все страницы" }] } }), "utf8");
  const r = run([BUILD_HANDOFF, dirH]);
  if (r.code !== 0) return `exit ${r.code}: ${r.stderr}`;
  const md = readFileSync(join(dirH, "HANDOFF.md"), "utf8");
  if (!/Р - результат|Р \| /.test(md)) return "функция блока не отрисована";
  if (!/показывает результат и срок/.test(md)) return "обоснование блока потеряно";
  if (!/шаблон/.test(md)) return "блок в режиме шаблон не попал в «чего намеренно нет»";
  if (!/реальное число объектов/.test(md)) return "открытые плейсхолдеры не собраны";
  if (!/под ключ и без субподряда/.test(md)) return "дословные слова заказчика не перечислены";
  if (!/Гарантия 3 года на монтаж/.test(md)) return "сквозные формулировки не перечислены";
  if (/[—–]/.test(md)) return "в документе передачи длинное/среднее тире";
  return true;
});

step("build-handoff: в правилах заполнения количество элементов не выдается за число символов", () => {
  const dirH2 = join(SANDBOX, "handoff-limits");
  mkdirSync(join(dirH2, "pages", "main"), { recursive: true });
  mkdirSync(join(dirH2, "blueprints"), { recursive: true });
  writeFileSync(join(dirH2, "inputs.json"), JSON.stringify({ slug: "vent" }), "utf8");
  writeFileSync(join(dirH2, "pages", "main", "page.json"), JSON.stringify({
    page: { slug: "main", title: "Каталог", type: "Категория", url: "/katalog/" },
    h1: "Каталог оборудования",
    blocks: [{ n: 1, type: "Листинг", fragment: "product-listing", slots: { products: [] }, fill_notes: [] }],
  }), "utf8");
  writeFileSync(join(dirH2, "blueprints", "main.json"), JSON.stringify({
    page: { slug: "main" },
    blocks: [{ n: 1, type: "Листинг", fragment: "product-listing", function: "К", function_why: "человек находит свой тип оборудования", mode: "шаблон", demo_units: 2, empty_state: "Пока ничего не нашлось - сбросьте фильтр или оставьте заявку", limits: { areas: "5-8 позиций", features: "3-7 шт. по 20-60 симв." } }],
  }), "utf8");
  const r = run([BUILD_HANDOFF, dirH2]);
  if (r.code !== 0) return `exit ${r.code}: ${r.stderr}`;
  const md = readFileSync(join(dirH2, "HANDOFF.md"), "utf8");
  const row = md.split("\n").find((l) => /^\|\s*areas\s*\|/.test(l)) || "";
  if (!row) return "строки про areas в правилах заполнения нет";
  if (/\|\s*5-8\s*\|/.test(row)) return `количество позиций напечатано как число символов: ${row.trim()}`;
  const rowF = md.split("\n").find((l) => /^\|\s*features\s*\|/.test(l)) || "";
  if (rowF && !/20-60/.test(rowF)) return `поэлементный диапазон символов потерян: ${rowF.trim()}`;
  if (!/Пока ничего не нашлось/.test(md)) return "текст пустого состояния не доехал до разработчика";
  return true;
});

// Texts.docx в v7.1 удален (решение владельца 23.08, контракты п.0.8): проверка фильтрации
// пометок осталась только на HANDOFF.md - другого документа с fill_notes больше нет.
step("служебные пометки не текут в HANDOFF, а старый формат fill_notes не теряется", () => {
  const dirN = join(SANDBOX, "notes-split");
  mkdirSync(join(dirN, "pages", "new"), { recursive: true });
  mkdirSync(join(dirN, "pages", "old"), { recursive: true });
  writeFileSync(join(dirN, "inputs.json"), JSON.stringify({ slug: "vent", brand_name: "ВентПро" }), "utf8");
  // новый формат: поле notes_internal есть -> fill_notes фильтруется строго
  writeFileSync(join(dirN, "pages", "new", "page.json"), JSON.stringify({
    page: { slug: "new", title: "Монтаж", type: "Услуга", url: "/m/" }, h1: "Монтаж вентиляции",
    blocks: [{ n: 1, type: "Hero", fragment: "hero", slots: { h1: "Монтаж вентиляции" },
      fill_notes: ["слот короче лимита: срезан хвост", "[ЗАПОЛНИТЬ: фото объекта]"],
      notes_internal: ["внутренняя заметка редактора"] }],
  }), "utf8");
  // старый формат: notes_internal нет -> голая строка это дыра фактуры, ее нельзя терять
  writeFileSync(join(dirN, "pages", "old", "page.json"), JSON.stringify({
    page: { slug: "old", title: "Цены", type: "Услуга", url: "/c/" }, h1: "Цены",
    blocks: [{ n: 1, type: "Цены", fragment: "pricing", slots: { h2: "Сколько стоит" },
      fill_notes: ["реальное число объектов"] }],
  }), "utf8");
  const rh = run([BUILD_HANDOFF, dirN]);
  if (rh.code !== 0) return `build-handoff exit ${rh.code}: ${rh.stderr}`;
  const md = readFileSync(join(dirN, "HANDOFF.md"), "utf8");
  if (/срезан хвост|внутренняя заметка/.test(md)) return "служебная пометка уехала в HANDOFF.md";
  if (!/фото объекта/.test(md) || !/реальное число объектов/.test(md)) return "открытые вопросы в HANDOFF собраны неполно";
  return true;
});

step("build-handoff: нет страниц -> exit 1, файл не создан", () => {
  const dirEmpty = join(SANDBOX, "handoff-empty");
  mkdirSync(dirEmpty, { recursive: true });
  const r = run([BUILD_HANDOFF, dirEmpty]);
  if (r.code !== 1) return `exit ${r.code}, ожидался 1`;
  if (existsSync(join(dirEmpty, "HANDOFF.md"))) return "HANDOFF.md создан при пустой задаче";
  return true;
});

// ──────────────────────────────────────────────────────────────────────────
console.log("");
console.log("=== build-skeletons-docx.mjs (v7.1: клиентский гейт скелетов, контракт 3.3а) ===");
// ──────────────────────────────────────────────────────────────────────────

const BUILD_SKELETONS = join(PROJECT_ROOT, ".claude/scripts/build-skeletons-docx.mjs");

step("Skeletons_<slug>.docx: клиентский документ без кухни, required помечен, страницы типа перечислены", () => {
  const dirSk = join(SANDBOX, "skeletons");
  mkdirSync(dirSk, { recursive: true });
  writeFileSync(join(dirSk, "inputs.json"), JSON.stringify({ slug: "ventkazan", brand_name: "ВентПро" }), "utf8");
  writeFileSync(join(dirSk, "pages.json"), JSON.stringify({ source: "structure:fx", count: 3, pages: [
    { n: 1, slug: "main", url: "/", type: "Главная", marker: "монтаж вентиляции казань", queries: [], dir_slug: null },
    { n: 2, slug: "catalog", url: "/pritochnye/", type: "Категория", marker: "приточные установки", queries: [], dir_slug: null },
    { n: 3, slug: "catalog-vent", url: "/ventilyatory/", type: "Категория", marker: "вытяжные вентиляторы", queries: [], dir_slug: null },
  ] }), "utf8");
  // 2 типа; в notes нарочно смешаны кухня (typical_order, wireframe) и клиентская часть -
  // docx обязан вычистить первое и сохранить второе; function/evidence/status не печатаются вовсе
  writeFileSync(join(dirSk, "type_skeletons.json"), JSON.stringify({
    types_present: ["Главная", "Категория"],
    skeletons: {
      "Главная": { blocks: [
        { block: "Первый экран (Hero)", function: "Р", required: false, status: "гигиена",
          evidence: "coverage 1.0 (leader_blocks)", notes: "typical_order 1",
          client_why: "За 6 секунд отвечает, что вы предлагаете и почему обращаться к вам" },
      ], order_hint: ["Первый экран (Hero)"] },
      "Категория": { blocks: [
        { block: "Форма захвата", function: "К", required: false, status: "гигиена", evidence: "рецепт",
          notes: "финал страницы", client_why: "Дает оставить заявку, когда подходящая модель не нашлась" },
        { block: "Листинг товаров", function: "К", required: true, opts: { filter: true }, status: "гигиена",
          evidence: "coverage 0.8 (leader_blocks)",
          notes: "typical_order 2; фильтр - статичный плейсхолдер (wireframe); карточки наполняет заказчик",
          client_why: "Покупатель видит весь ассортимент и фильтрует его под свою задачу" },
      ], order_hint: ["Листинг товаров", "Форма захвата"] },
    },
  }, null, 2), "utf8");
  const r = run([BUILD_SKELETONS, dirSk]);
  if (r.code !== 0) return `exit ${r.code}: ${r.stderr}`;
  const out = join(dirSk, "Skeletons_ventkazan.docx");
  if (!existsSync(out)) return "Skeletons_ventkazan.docx не создан";
  if (statSync(out).size <= 0) return "docx пустой";
  const { text } = docxText(out);
  if (!/Состав блоков страниц/.test(text)) return "нет титула документа";
  if (!/ВентПро/.test(text)) return "бренд не попал в титул";
  if (!/Покупатель видит весь ассортимент/.test(text)) return "client_why не доехал до колонки «Зачем»";
  if (!/обязательный/.test(text)) return "required-блок не помечен «(обязательный)»";
  if (!/приточные установки/.test(text) || !/вытяжные вентиляторы/.test(text)) return "список страниц типа не напечатан";
  if (/coverage|leader_blocks|typical_order/i.test(text)) return "кухня (coverage/typical_order) утекла заказчику";
  if (/wireframe/i.test(text)) return "кухонный фрагмент notes не вычищен";
  if (!/карточки наполняет заказчик/.test(text)) return "клиентская часть notes потеряна вместе с кухней";
  const listingAt = text.indexOf("Листинг товаров");
  const formAt = text.indexOf("Форма захвата");
  if (listingAt < 0 || formAt < 0 || formAt < listingAt) return "порядок строк не по order_hint (листинг обязан идти раньше формы)";
  return true;
});

// Прежняя сортировка брала hint.indexOf(имя), и одноименные блоки получали ОДИН ключ:
// второй «Каталог» перепрыгивал соседей. Планировщик обходил это, выдавая трем разным
// блокам главной разные каталожные имена - порядок сохранялся, но имена врали о содержании.
function skeletonsFixture(name, skeletons, pages) {
  const dir = join(SANDBOX, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "inputs.json"), JSON.stringify({ slug: "save", brand_name: "Save" }), "utf8");
  writeFileSync(join(dir, "pages.json"), JSON.stringify({ source: "fx", count: pages.length, pages }, null, 2), "utf8");
  writeFileSync(join(dir, "type_skeletons.json"), JSON.stringify(skeletons, null, 2), "utf8");
  return dir;
}

step("Skeletons: одноименные блоки в разных местах order_hint не ломают порядок", () => {
  const dir = skeletonsFixture("skeletons-order", {
    types_present: ["Главная"],
    skeletons: {
      "Главная": {
        blocks: [
          { block: "Первый экран (Hero)", client_why: "Отвечает, что вы предлагаете", notes: "" },
          { block: "Каталог", title_client: "Витрина обучений", client_why: "Показывает, чему учим", notes: "" },
          { block: "Отзывы", client_why: "Показывает результат чужими словами", notes: "" },
          { block: "Каталог", title_client: "Save Market", client_why: "Показывает, что можно купить отдельно", notes: "" },
        ],
        order_hint: ["Первый экран (Hero)", "Каталог", "Отзывы", "Каталог"],
      },
    },
  }, [{ n: 1, slug: "main", url: "/", type: "Главная", marker: "школа архитектурного софта" }]);
  const r = run([BUILD_SKELETONS, dir]);
  if (r.code !== 0) return `exit ${r.code}: ${r.stderr}`;
  const { text } = docxText(join(dir, "Skeletons_save.docx"));
  const at = (s) => text.indexOf(s);
  if (at("Витрина обучений") < 0 || at("Save Market") < 0) return "title_client не напечатан вместо каталожного имени";
  if (!(at("Витрина обучений") < at("Отзывы") && at("Отзывы") < at("Save Market")))
    return "порядок разъехался: второй одноименный блок перепрыгнул соседа (сортировка снова по indexOf)";
  if (/^Каталог$/m.test(text)) return "каталожное имя напечатано вместо клиентского";
  return true;
});

step("Skeletons: техническое имя блока -> ненулевой exit (заказчику такое не отправляют)", () => {
  const dir = skeletonsFixture("skeletons-tech", {
    types_present: ["Главная"],
    skeletons: {
      "Главная": {
        blocks: [{ block: "SEO-текст-низ", client_why: "Закрывает вопросы", notes: "" }],
        order_hint: ["SEO-текст-низ"],
      },
    },
  }, [{ n: 1, slug: "main", url: "/", type: "Главная", marker: "школа" }]);
  const r = run([BUILD_SKELETONS, dir]);
  if (r.code === 0) return "техническое имя ушло бы заказчику молча";
  if (!/ТЕХНИЧЕСКИЕ ИМЕНА|title_client/.test(r.stderr + r.stdout)) return "причина не названа";
  return true;
});

step("нет type_skeletons.json -> ненулевой exit, docx не создается", () => {
  const dirNo = join(SANDBOX, "skeletons-missing");
  mkdirSync(dirNo, { recursive: true });
  writeFileSync(join(dirNo, "inputs.json"), JSON.stringify({ slug: "ventkazan" }), "utf8");
  writeFileSync(join(dirNo, "pages.json"), JSON.stringify({ pages: [] }), "utf8");
  const r = run([BUILD_SKELETONS, dirNo]);
  if (r.code === 0) return "exit 0 без type_skeletons.json";
  if (!/type_skeletons/.test(r.stderr)) return "в ошибке не назван недостающий файл";
  if (existsSync(join(dirNo, "Skeletons_ventkazan.docx"))) return "docx создан без входа";
  return true;
});

// ──────────────────────────────────────────────────────────────────────────
console.log("");
console.log("=== share-record.mjs: запись Drive-ссылок одной схемой ===");
// ──────────────────────────────────────────────────────────────────────────

// Метку времени ставили руками (разъезжалась с реальностью), а схему поля документы
// описывали двумя разными наборами ключей - читатели молча считали файл незалитым.
const SHARE_RECORD = join(PROJECT_ROOT, ".claude/scripts/share-record.mjs");

step("share-record: пишет shared_at сам, соседние ключи не трогает, ревизия хранит прежнюю ссылку", () => {
  const dir = join(SANDBOX, "share-task");
  mkdirSync(dir, { recursive: true });
  let r = run([SHARE_RECORD, dir, "prototype", "--file-id", "ID1", "--link", "https://drive/1", "--mime", "text/html"]);
  if (r.code !== 0) return `первая запись: exit ${r.code}: ${r.stderr}`;
  r = run([SHARE_RECORD, dir, "skeletons", "--file-id", "ID2", "--link", "https://drive/2"]);
  if (r.code !== 0) return `вторая запись: exit ${r.code}: ${r.stderr}`;
  r = run([SHARE_RECORD, dir, "prototype", "--file-id", "ID3", "--link", "https://drive/3", "--revision", "tekst_fix"]);
  if (r.code !== 0) return `перезаливка: exit ${r.code}: ${r.stderr}`;

  const share = readJson(join(dir, "share.json"));
  if (share.prototype.drive_file_id !== "ID3") return "новая ссылка не перезаписала прежнюю";
  if (!/^\d{4}-\d{2}-\d{2}T/.test(String(share.prototype.shared_at))) return "shared_at не проставлен машинно";
  if (share.skeletons.drive_link !== "https://drive/2") return "соседний ключ затерт";
  const rev = share.prototype.revisions || [];
  if (rev.length !== 1 || rev[0].prev_drive_link !== "https://drive/1") return `прежняя ссылка потеряна: ${JSON.stringify(rev)}`;
  if ((share.skeletons.revisions || []).length !== 0) return "ревизия записана не в тот ключ";
  return true;
});

step("share-record: пустой ответ аплоада -> ненулевой exit, share.json не тронут", () => {
  const dir = join(SANDBOX, "share-task");
  const before = readFileSync(join(dir, "share.json"), "utf8");
  const r = run([SHARE_RECORD, dir, "prototype", "--file-id", "", "--link", ""]);
  if (r.code === 0) return "битая заливка записана как успешная - заказчик получит ссылку в никуда";
  if (readFileSync(join(dir, "share.json"), "utf8") !== before) return "share.json изменен при битой заливке";
  return true;
});

// === Итог ===
// Уборка мягкая: не убралось - следующий прогон подметет, набор из-за этого не падает.
softRm(SANDBOX);
console.log("");
console.log(`=== ${passed}/${passed + failed} tests passed ===`);
if (failed > 0) {
  for (const f of failures) console.error(`  FAIL: ${f}`);
  process.exit(1);
}
process.exit(0);
