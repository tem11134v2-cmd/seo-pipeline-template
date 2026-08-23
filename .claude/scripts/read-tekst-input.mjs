#!/usr/bin/env node
// read-tekst-input.mjs v2 - мост "анализ -> тексты": шаг 1 /seo-tekst (ADR-038).
//
// Зачем: скил текстов ТОЛЬКО ПИШЕТ. Весь анализ (ЦА, конкуренты, разведка направлений)
// уже сделан в analyses/NNN. Мост - детерминированная часть шва: механически раскладывает
// артефакты анализа/структуры в папку задачи текстов. Без MCP, без догадок; чего нет в
// источнике - того нет в выходе (деградация только отсутствием данных, ADR-031).
//
// Использование:
//   node read-tekst-input.mjs <texts_dir> --from-structure <structure_dir>   SEO-путь: целевые страницы структуры
//   node read-tekst-input.mjs <texts_dir> --from-analysis <analysis_dir>     путь без SEO: контекст анализа; pages.json ПУСТОЙ
//                                                                            (source "pages_draft") - состав соберет гейт состава
//   node read-tekst-input.mjs <texts_dir> --from-table <path.csv|tsv>        аварийный ручной: URL / Тип / Маркер [/ запросы]
//   node read-tekst-input.mjs <texts_dir> --from-draft <pages_draft.json>    повторный вызов ПОСЛЕ гейта состава:
//                                                                            подтвержденный черновик -> финальный pages.json
//
// Создает в <texts_dir>:
//   pages.json         - всегда (перезаписывается): { source, count, pages: [{ n, slug, url, type, marker, queries[], dir_slug }] }
//                        type - русский словарь: Главная | Услуга | Категория | Товар | Инфо (Статья исключается);
//                        slug главной - всегда "main" (на это опираются тон-гейт, blueprints/main.json и site_manifest).
//                        При --from-analysis pages ПУСТОЙ: состав предлагает pages-planner v2, подтверждает заказчик
//                        на гейте, финал пишет повторный вызов моста с --from-draft (контракт 2.2).
//   inputs.json        - если не было: analysis_dir / structure_dir / tier + slug / domain / region.
//                        legal-блок мост НЕ пишет: его дописывает оркестратор из intake.json (requisites, contacts_geo)
//                        с фолбэком ЗАКАЗЧИК.md - реквизиты требуют сверки человеком, а не автопарсинга.
//   leader_blocks.json - если не было: выжимка { blocks_by_type, features_to_steal } из analyses/leader_scan.json (v2).
//                        Анализ без v2-полей - файла нет: block-planner работает по статике BLOCKS.md.
//   facts.json         - если не было: семена по схеме ADR-033 из analyses/intake.json facts[]
//                        (вкл. подтвержденные own_page-факты, source "own_page:<url>") + реквизиты из ЗАКАЗЧИК.md.
//                        Интейк двухслойный: facts[] из intake.json и intake_lexicon.json сливаются в
//                        один список перед разбором. Если intake_lexicon.json есть - лексиконные факты
//                        берутся из него; если файла нет - ищутся в intake.json.facts[] по тем же именам
//                        полей (легаси-режим однослойного интейка). Отсутствие обоих - не авария,
//                        лексикон просто пуст. Откуда взят лексикон - печатается в сводке.
//
// Существующие inputs.json / facts.json / leader_blocks.json НЕ перезаписываются: в них дописывает
// оркестратор (legal, факты и словарь с гейтов), и повторный вызов моста не должен это стирать.
//
// Exit: 0 ok | 2 нет целевых страниц (пустой pages.json при --from-analysis - штатный, exit 0) | 1 ошибка.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildSlug, slugifyBase } from "./_slug.mjs";
import { pickField } from "./_client.mjs";

const TAG = "[read-tekst-input]";
const args = process.argv.slice(2);
const textsDirArg = args[0] && !args[0].startsWith("--") ? args[0] : null;
if (!textsDirArg) {
  console.error(`${TAG} usage: node read-tekst-input.mjs <texts_dir> --from-structure <dir> | --from-analysis <dir> | --from-table <path> | --from-draft <path>`);
  process.exit(1);
}
const textsDir = resolve(textsDirArg);

function flag(name) {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : null;
}
const fromStructure = flag("--from-structure");
const fromAnalysis = flag("--from-analysis");
const fromTable = flag("--from-table");
const fromDraft = flag("--from-draft");

// Корень проекта: texts_dir = <root>/texts/NNN-slug. Нужен для ЗАКАЗЧИК.md и
// резолва относительных путей источников, когда скрипт запущен не из корня.
const projectRoot = resolve(textsDir, "..", "..");

// ---------------------------------------------------------------------------
// Мелкие помощники
// ---------------------------------------------------------------------------

function readJson(p) { return JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, "")); }

// Относительный путь источника резолвим сначала от CWD (штатный запуск из корня),
// потом от projectRoot (запуск из другого места) - чтобы мост не падал на месте запуска.
function resolveExisting(raw) {
  if (!raw) return null;
  const byCwd = resolve(raw);
  if (existsSync(byCwd)) return byCwd;
  const byRoot = resolve(projectRoot, raw);
  if (existsSync(byRoot)) return byRoot;
  return null;
}

// Найти значение по любому из ключей (регистронезависимо, по вхождению) - терпимость
// к разным написаниям колонок в источниках (как в v1).
function pick(obj, keys) {
  for (const k of Object.keys(obj || {})) {
    const norm = k.toLowerCase().trim();
    for (const want of keys) if (norm === want || norm.includes(want)) return obj[k];
  }
  return undefined;
}

// Первый массив объектов в произвольном JSON (structure_data может вкладывать pages).
function findArray(obj, depth = 0) {
  if (depth > 4 || obj == null || typeof obj !== "object") return null;
  if (Array.isArray(obj) && obj.length && typeof obj[0] === "object") return obj;
  for (const v of Object.values(obj)) {
    const found = findArray(v, depth + 1);
    if (found) return found;
  }
  return null;
}

function normQueries(q) {
  return (Array.isArray(q) ? q : []).map((x) => (typeof x === "string" ? x : String((x && x.query) || "")).trim()).filter(Boolean);
}

// path URL без протокола/домена/query - для слага и для спаривания по url.
function pathOf(u) {
  let s = String(u || "").trim();
  if (!s) return "";
  s = s.replace(/^https?:\/\/[^/]+/i, "");
  s = s.replace(/[?#].*$/, "");
  return s.replace(/^\/+|\/+$/g, "").toLowerCase();
}

const warns = [];
const notes = [];
function warn(msg) { warns.push(msg); }

// ---------------------------------------------------------------------------
// Нормализация типов -> русский словарь (контракт 2.2)
// Мотив: вся verify-цепочка (verify-copy COMMERCIAL/F1, verify-prototype v2,
// type_skeletons) различает страницы по русским типам - мост обязан отдать словарь,
// а не сырье источника (англ. коды master_list, "Подуслуга" структуры и пр.).
// ---------------------------------------------------------------------------

// Порядок проверок важен: "Главная-каталог" должна поймать "главн" раньше "каталог",
// "Карточка товара" - "товар" раньше "услуг" ловить нечего, "Категория товаров" - "категор".
function normType(raw) {
  const t = String(raw || "").toLowerCase().replace(/ё/g, "е").trim();
  if (!t) return { type: "Инфо", recognized: false };
  if (/стать|article|блог|blog/.test(t)) return { type: null, recognized: true };            // Статья - вне коммерческого конвейера
  if (/главн|home/.test(t)) return { type: "Главная", recognized: true };                    // вкл. "Главная-каталог"
  if (/категор|category|каталог/.test(t)) return { type: "Категория", recognized: true };
  if (/товар|product|карточк/.test(t)) return { type: "Товар", recognized: true };           // вкл. "Карточка товара"
  if (/услуг|service/.test(t)) return { type: "Услуга", recognized: true };                  // вкл. "Подуслуга"
  if (/инфо|info|компан|контакт|проч|other|about/.test(t)) return { type: "Инфо", recognized: true }; // О компании / Контакты / Прочее
  return { type: "Инфо", recognized: false };                                                // нераспознанное -> Инфо + предупреждение
}

// ---------------------------------------------------------------------------
// Спаривание страницы с направлением анализа (dir_slug, контракт 2.2)
// Мотив: у спаренной страницы появляются recon/<dir_slug>.json и сегменты ЦА по
// dir_slugs; неспаренная просто живет без них. Оркестратор может доспарить вручную
// правкой pages.json - это данные задачи.
// ---------------------------------------------------------------------------

const PAIR_STOPWORDS = new Set(["к", "для", "в", "под", "на"]);

// Токены: нижний регистр, е == е-с-точками, дефис = разделитель, стоп-слова вон.
function pairTokens(...strings) {
  const out = [];
  const seen = new Set();
  for (const s of strings) {
    for (const t of String(s || "").toLowerCase().replace(/ё/g, "е").split(/[^a-zа-я0-9]+/)) {
      if (!t || PAIR_STOPWORDS.has(t) || seen.has(t)) continue;
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

// Равенство токенов: точное, либо общий префикс во все слово кроме окончания
// (2 символа). Держит русскую морфологию ("отопления" == "отопление") без стемминга.
function tokEq(a, b) {
  if (a === b) return true;
  const min = Math.min(a.length, b.length);
  if (min < 4) return false;
  const need = Math.max(4, min - 2);
  let i = 0;
  const max = Math.min(a.length, b.length);
  while (i < max && a[i] === b[i]) i++;
  return i >= need;
}

// Доля совпавших токенов от меньшего набора: "монтаж отопления" против
// "монтаж отопления под ключ" дает 1.0, а не 0.5.
function pairScore(pageToks, dirToks) {
  if (!pageToks.length || !dirToks.length) return 0;
  let hit = 0;
  for (const t of pageToks) if (dirToks.some((d) => tokEq(t, d))) hit++;
  return hit / Math.min(pageToks.length, dirToks.length);
}

// directions[].url - живая страница клиента этого направления: совпадение path
// однозначнее любых токенов, поэтому проверяется первым.
function pairDirSlug(page, directions) {
  const pPath = pathOf(page.url);
  if (pPath) {
    for (const d of directions) {
      if (d.url && pathOf(d.url) === pPath) return d.dir_slug;
    }
  }
  const pt = pairTokens(page.marker, page.name);
  let best = null;
  let bestScore = 0;
  for (const d of directions) {
    const s = pairScore(pt, pairTokens(d.marker_hint, d.name));
    if (s > bestScore) { best = d; bestScore = s; }
  }
  return bestScore >= 0.5 ? best.dir_slug : null;
}

// ---------------------------------------------------------------------------
// Чтение источника страниц + контекст анализа/структуры
// ---------------------------------------------------------------------------

let source = "";
let rawPages = [];          // { url, type(сырье), marker, name, queries, dir_slug? }
let dirSlugsReady = false;  // pages_draft несет dir_slug готовым (от pages-planner) - спаривание не нужно
let emptyOk = false;        // --from-analysis: пустой pages.json штатный (состав соберет гейт), exit 2 не про него

// Контекст для inputs.json и вспомогательных артефактов.
const ctx = {
  analysisDirRaw: null,   // как передали/как записано в структуре - уходит в inputs.json
  analysisDir: null,      // резолвнутый путь для чтения файлов
  structureDirRaw: null,
  tier: null,
  slug: null,
  domain: null,
  regionName: null,
  regionYandex: null,
};

// Подхватить analysis-контекст: meta.tier + brief (slug/domain/region/directions).
function loadAnalysisCtx(rawPath) {
  ctx.analysisDirRaw = String(rawPath).replace(/\\/g, "/");
  ctx.analysisDir = resolveExisting(rawPath);
  if (!ctx.analysisDir) { warn(`папка анализа не найдена: ${rawPath} - inputs/facts/leader_blocks будут без данных анализа`); return { brief: null, directions: [] }; }
  const metaP = join(ctx.analysisDir, "meta.json");
  if (existsSync(metaP)) {
    try {
      const t = String(readJson(metaP).tier || "").trim();
      if (t === "seo" || t === "basic") ctx.tier = t;
    } catch (e) { warn(`meta.json анализа не прочитан: ${e.message}`); }
  }
  const briefP = join(ctx.analysisDir, "brief.json");
  let brief = null;
  if (existsSync(briefP)) {
    try { brief = readJson(briefP); } catch (e) { warn(`brief.json не прочитан: ${e.message}`); }
  } else warn(`нет brief.json в ${ctx.analysisDir}`);
  if (brief) {
    ctx.slug = ctx.slug || brief.slug || null;
    ctx.domain = ctx.domain || brief.domain || null;
    ctx.regionName = ctx.regionName || brief.region || null;
    // Копии из brief.json для читателей inputs.json (канон - brief; сверка B этапа B):
    // site-reviewer, tekst-verifier, page-writer, verify-copy, /seo-faq.
    ctx.brandName = ctx.brandName || brief.company_name || null;
    if (Array.isArray(brief.forbidden_wordings)) ctx.forbiddenWordings = brief.forbidden_wordings;
    if (Array.isArray(brief.not_in_assortment)) ctx.notInAssortment = brief.not_in_assortment;
  }
  const directions = brief && Array.isArray(brief.directions)
    ? brief.directions.filter((d) => d && d.dir_slug)
    : [];
  return { brief, directions };
}

let directions = [];

try {
  if (fromStructure) {
    // --- SEO-путь: целевые страницы готовой структуры ---------------------------------
    source = `structure:${fromStructure}`;
    const sdir = resolveExisting(fromStructure);
    if (!sdir) { console.error(`${TAG} папка структуры не найдена: ${fromStructure}`); process.exit(1); }
    ctx.structureDirRaw = String(fromStructure).replace(/\\/g, "/");

    // Контекст структуры: slug/domain/region + ссылка на анализ.
    const sInputsP = join(sdir, "inputs.json");
    if (existsSync(sInputsP)) {
      const si = readJson(sInputsP);
      ctx.slug = si.slug || null;
      ctx.domain = si.domain || null;
      ctx.regionName = si.region_name || null;
      ctx.regionYandex = Number.isFinite(si.region_yandex) ? si.region_yandex : null;
      if (si.analysis_dir) ({ directions } = loadAnalysisCtx(si.analysis_dir));
      else warn("в inputs.json структуры нет analysis_dir - страницы останутся без dir_slug, facts/leader_blocks без анализа");
    } else warn(`нет inputs.json в ${sdir} - контекст (slug/domain/region/анализ) не подхвачен`);
    // Структура живет только при tier=seo (гейт /seo-struktura) - фолбэк честный.
    if (!ctx.tier && ctx.analysisDir) { ctx.tier = "seo"; notes.push("tier не найден в meta.json анализа - взят seo (структура существует только при seo)"); }

    // Каскад данных структуры как в v1: полные данные -> мастер-список -> топ-10.
    const candidates = ["structure_data.json", "master_list.json", "top10.json"];
    let data = null;
    let used = null;
    for (const c of candidates) {
      const p = join(sdir, c);
      if (existsSync(p)) { data = readJson(p); used = c; break; }
    }
    if (!data) { console.error(`${TAG} нет structure_data.json / master_list.json / top10.json в ${sdir}`); process.exit(1); }
    const arr = findArray(data) || [];
    rawPages = arr.map((row) => {
      // Фильтр целевых как в v1: пустой статус = берем, иначе только "да"-подобные.
      const status = String(pick(row, ["target_status", "статус", "status", "решение"]) ?? "").toLowerCase();
      const keep = status === "" || /да|yes|true|оставля|целев/.test(status);
      if (!keep) return null;
      return {
        url: pick(row, ["url", "адрес", "путь", "path", "страница"]) || "",
        type: pick(row, ["type", "тип", "тип страницы"]) || "",
        marker: pick(row, ["marker", "маркер", "маркерный", "главный запрос", "запрос"]) || "",
        name: pick(row, ["name", "название"]) || "",
        queries: pick(row, ["queries", "запросы", "семантика"]) || [],
      };
    }).filter(Boolean);
    console.error(`${TAG} structure: ${used}, строк ${arr.length}, целевых ${rawPages.length}`);
  } else if (fromAnalysis) {
    // --- Путь без SEO: первый вызов - только контекст анализа -------------------------
    // Состав страниц мост НЕ решает: pages.json пишется ПУСТЫМ с источником "pages_draft"
    // (контракт 2.2) - оркестратор по пустому pages.json уходит на шаг 2 (pages-planner v2
    // предлагает состав из направлений брифа, заказчик подтверждает на гейте), после чего
    // мост вызывается повторно с --from-draft и пишет финальный pages.json.
    // Непустой pages.json здесь был бы дефектом: оркестратор пропустил бы обязательный гейт.
    source = "pages_draft";
    emptyOk = true;
    ({ directions } = loadAnalysisCtx(fromAnalysis));
    if (!ctx.analysisDir) process.exit(1);
    if (!directions.length) warn("в brief.json нет directions[] - pages-planner соберет состав из ассортимента/страниц клиента, но спаривать dir_slug будет не с чем");
    console.error(`${TAG} analysis: направлений-кандидатов в брифе ${directions.length}; pages.json пишу пустым - состав предложит pages-planner, подтвердит гейт, финал запишет повторный вызов моста с --from-draft`);
  } else if (fromTable) {
    // --- Аварийный ручной: URL / Тип / Маркер [/ запросы] ------------------------------
    source = `table:${fromTable}`;
    const tPath = resolveExisting(fromTable);
    if (!tPath) { console.error(`${TAG} файл таблицы не найден: ${fromTable}`); process.exit(1); }
    const raw = readFileSync(tPath, "utf8").replace(/^﻿/, "").trim();
    const sep = raw.includes("\t") ? "\t" : raw.includes(";") ? ";" : ",";
    const lines = raw.split(/\r?\n/).filter((l) => l.trim());
    const header = (lines[0] || "").toLowerCase();
    const hasHeader = /url|адрес|тип|type|маркер|marker/.test(header);
    const rows = hasHeader ? lines.slice(1) : lines;
    rawPages = rows.map((line) => {
      const c = line.split(sep).map((s) => s.trim());
      return { url: c[0] || "", type: c[1] || "", marker: c[2] || "", name: "", queries: c[3] ? c[3].split(/[|,]/).map((s) => s.trim()).filter(Boolean) : [] };
    }).filter((p) => p.url || p.marker);
    console.error(`${TAG} table: ${rawPages.length} строк (разделитель "${sep === "\t" ? "TAB" : sep}")`);
  } else if (fromDraft) {
    // --- Повторный вызов после гейта состава ------------------------------------------
    // pages_draft.json уже подтвержден заказчиком; dir_slug проставил pages-planner v2 -
    // мост берет его готовым и только приводит черновик к финальному pages.json.
    source = `pages_draft:${fromDraft}`;
    const dPath = resolveExisting(fromDraft);
    if (!dPath) { console.error(`${TAG} нет файла черновика: ${fromDraft}`); process.exit(1); }
    const draft = readJson(dPath);
    const arr = Array.isArray(draft.pages) ? draft.pages : (findArray(draft) || []);
    rawPages = arr.map((row) => {
      // Страница, снятая на гейте, помечена include "нет"/false - не берем.
      const inc = String(pick(row, ["include", "включать", "статус"]) ?? "").toLowerCase();
      if (inc && /^(нет|no|false|0|искл)/.test(inc)) return null;
      return {
        url: pick(row, ["url", "адрес", "путь", "path"]) || "",
        type: pick(row, ["type", "тип"]) || "",
        marker: pick(row, ["marker", "маркер", "название"]) || "",
        name: pick(row, ["name", "название"]) || "",
        queries: pick(row, ["queries", "запросы"]) || [],
        dir_slug: (typeof row.dir_slug === "string" && row.dir_slug.trim()) ? row.dir_slug.trim() : null,
      };
    }).filter(Boolean);
    dirSlugsReady = true;
    console.error(`${TAG} pages_draft: ${rawPages.length} подтвержденных страниц (вид сайта: ${draft.site_kind || "n/a"})`);
    if (!existsSync(join(textsDir, "inputs.json"))) warn("inputs.json в папке задачи нет - первый вызов моста (с источником анализа/структуры) был пропущен?");
  } else {
    console.error(`${TAG} не задан источник (--from-structure | --from-analysis | --from-table | --from-draft)`);
    process.exit(1);
  }
} catch (e) {
  console.error(`${TAG} ошибка чтения источника: ${e.message}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Нормализация: типы, дедуп, слаги, номера, dir_slug
// ---------------------------------------------------------------------------

const seen = new Set();
const usedSlugs = new Map();  // slug -> счетчик коллизий
const unrecognizedTypes = new Map(); // сырье типа -> сколько раз
let droppedArticles = 0;
const pages = [];

// Слаг страницы: главная всегда "main"; иначе из path URL; иначе из маркера (buildSlug
// режет стоп-слова и транзакционные "купить/цена" - слаг остается смысловым).
function makeSlug(p, type) {
  if (type === "Главная") return "main";
  const path = pathOf(p.url);
  if (path) return slugifyBase(path);
  return buildSlug(p.marker || p.name || "page");
}

for (const p of rawPages) {
  const key = (p.url || "") + "|" + (p.marker || "");
  if (seen.has(key)) continue;
  seen.add(key);

  const { type, recognized } = normType(p.type);
  if (type === null) { droppedArticles++; continue; } // Статья - исключается из коммерческого конвейера
  if (!recognized) unrecognizedTypes.set(String(p.type || "(пусто)"), (unrecognizedTypes.get(String(p.type || "(пусто)")) || 0) + 1);

  let slug = makeSlug(p, type);
  if (usedSlugs.has(slug)) {
    const k = usedSlugs.get(slug) + 1;
    usedSlugs.set(slug, k);
    if (slug === "main") warn(`в источнике больше одной главной - вторая получила slug "main-${k}", проверь состав`);
    slug = `${slug}-${k}`;
  } else {
    usedSlugs.set(slug, 1);
  }

  const dir_slug = dirSlugsReady
    ? (p.dir_slug || null)
    : (directions.length ? pairDirSlug(p, directions) : null);

  pages.push({
    n: pages.length + 1,
    slug,
    url: p.url || "",
    type,
    marker: p.marker || "",
    queries: normQueries(p.queries),
    dir_slug,
  });
}

if (pages.length === 0 && !emptyOk) {
  console.error(`${TAG} не найдено ни одной целевой страницы (структура: все "нет"? таблица пуста? на гейте сняли все? в составе одни статьи?)`);
  process.exit(2);
}

mkdirSync(textsDir, { recursive: true });
writeFileSync(join(textsDir, "pages.json"), JSON.stringify({ source, count: pages.length, pages }, null, 2), "utf8");

// ---------------------------------------------------------------------------
// inputs.json - пути и параметры задачи (создается один раз)
// ---------------------------------------------------------------------------

// slug задачи: из контекста источника, фолбэк - из имени папки texts/NNN-slug.
const dirBase = textsDir.replace(/\\/g, "/").split("/").filter(Boolean).pop() || "";
const slugFromDir = dirBase.replace(/^\d+-/, "");
const taskSlug = ctx.slug || slugFromDir || null;

const inputsPath = join(textsDir, "inputs.json");
let inputsCreated = false;
if (!existsSync(inputsPath)) {
  writeFileSync(inputsPath, JSON.stringify({
    analysis_dir: ctx.analysisDirRaw,
    structure_dir: ctx.structureDirRaw,
    tier: ctx.tier,
    slug: taskSlug,
    domain: ctx.domain,
    region_name: ctx.regionName,
    region_yandex: ctx.regionYandex,
    brand_name: ctx.brandName || null,
    forbidden_wordings: ctx.forbiddenWordings || [],
    not_in_assortment: ctx.notInAssortment || [],
    source,
  }, null, 2), "utf8");
  inputsCreated = true;
}

// ---------------------------------------------------------------------------
// leader_blocks.json - выжимка блок-матрицы лидеров (создается один раз)
// ---------------------------------------------------------------------------

let leaderBlocksStatus = "пропущен (нет анализа)";
const leaderBlocksPath = join(textsDir, "leader_blocks.json");
if (existsSync(leaderBlocksPath)) {
  leaderBlocksStatus = "уже есть - не трогаю";
} else if (ctx.analysisDir) {
  const lsPath = join(ctx.analysisDir, "leader_scan.json");
  if (!existsSync(lsPath)) {
    leaderBlocksStatus = "пропущен (нет leader_scan.json)";
  } else {
    try {
      const ls = readJson(lsPath);
      const bbt = ls.blocks_by_type && typeof ls.blocks_by_type === "object" && Object.keys(ls.blocks_by_type).length ? ls.blocks_by_type : null;
      const fts = Array.isArray(ls.features_to_steal) && ls.features_to_steal.length ? ls.features_to_steal : null;
      if (bbt || fts) {
        writeFileSync(leaderBlocksPath, JSON.stringify({ blocks_by_type: bbt || {}, features_to_steal: fts || [] }, null, 2), "utf8");
        leaderBlocksStatus = `создан (типов ${bbt ? Object.keys(bbt).length : 0}, фишек ${fts ? fts.length : 0})`;
      } else {
        leaderBlocksStatus = "пропущен (leader_scan без v2-полей blocks_by_type/features_to_steal)";
      }
    } catch (e) {
      leaderBlocksStatus = `пропущен (leader_scan.json не прочитан: ${e.message})`;
    }
  }
}

// ---------------------------------------------------------------------------
// facts.json - семена единого источника чисел (создается один раз, схема ADR-033)
// Мотив: все цифры сайта - только из facts.json (ADR-033/037). Мост сеет его
// механически из intake.json (дословные value, провенанс не пересказывается) и
// реквизитов ЗАКАЗЧИК.md; ревизию и дозаполнение на гейтах делает оркестратор.
// Спаривание internal -> public (lexicon.translate) и canonical - тоже зона
// оркестратора/стратега: мост словарь НЕ сочиняет.
// ---------------------------------------------------------------------------

// Четыре лексиконных поля - сырье для текстов; во втором слое интейка живут только они.
const LEXICON_FIELDS = new Set(["client_wordings", "internal_terms", "client_metaphors", "client_life_before_after"]);

// Откуда взят лексикон - для сводки (intake_lexicon.json | intake.json (легаси) | нет).
let lexiconOrigin = null;

// --- Реквизиты: провенанс важнее содержимого -------------------------------------------
// По ADR-033/037 любое число и реквизит из facts.json вправе напечатать писатель страниц -
// в подвал и на юридические страницы живого сайта. Поэтому реквизит, снятый НЕ у заказчика
// (соцсеть, витрина на чужой платформе, старый лендинг) и заказчиком НЕ подтвержденный,
// в facts.json не сеется вовсе. Флаг ставит intake-analyst: unconfirmed: true; терпим и
// написание status: "candidate".
function isUnconfirmedFact(f) {
  if (!f) return false;
  if (f.unconfirmed === true || String(f.unconfirmed).trim().toLowerCase() === "true") return true;
  return String(f.status || "").trim().toLowerCase() === "candidate";
}

// Стоп-фильтр легаси-фолбэка: отрицание внутри значения. "адрес домена в источниках не
// назван" - это не реквизит, а проза о его отсутствии. \b с кириллицей не работает
// (\w - только ASCII), поэтому граница слова - явный не-кириллический символ.
const REQ_NEGATION = /(?:^|[^а-яё])не\s+(?:назван|указан|уточн|подтвержд|получен|сообщ)|отсутству|неизвест|нет\s+данных/i;

// Признак адреса ДОЛЖЕН стоять в НАЧАЛЕ значения (после подписи поля и почтового индекса).
// Слово "адрес" где угодно внутри предложения адресом его не делает.
const ADDR_LABEL = /^\s*(?:(?:юр(?:идическ\S*)?\.?|почтов\S*|фактическ\S*)\s*)?адрес\s*[:\-]\s*/i;
const ADDR_INDEX = /^\s*\d{6}\s*,?\s*/;
const ADDR_START = /^\s*(?:г\.|гор\.|город\s|с\.\s|село\s|пгт|дер\.|деревня\s|пос\.|пос[её]лок\s|респ\.|республика\s|обл\.|область\s|край\s|р-н|район\s|ул\.|улица\s|просп\.|проспект\s|пр-т|пр-кт|пер\.|переулок\s|ш\.\s|шоссе\s|наб\.|набережная\s|б-р|бульвар\s|мкр|микрорайон\s|тракт\s|москва\s*,|санкт-петербург\s*,|[а-яё][а-яё-]+\s+(?:обл\.|область|край|респ\.|республика|округ)|[а-яё][а-яё-]+\s*,\s*(?:ул\.|улица|просп|пр-т|пр-кт|пер\.|переулок|ш\.|шоссе|наб\.|б-р|бульвар|мкр|г\.|гор\.|город|пос\.|пгт|с\.|дер\.|деревня))/i;

function looksLikeAddress(v) {
  const s = String(v || "").trim().replace(ADDR_LABEL, "").replace(ADDR_INDEX, "");
  return ADDR_START.test(s);
}

function buildFactsSeeds() {
  let intake = null;
  let intakeLexicon = null;
  if (ctx.analysisDir) {
    const p = join(ctx.analysisDir, "intake.json");
    if (existsSync(p)) {
      try { intake = readJson(p); } catch (e) { warn(`intake.json не прочитан: ${e.message}`); }
    } else warn(`нет intake.json в ${ctx.analysisDir} - facts.json будет только из ЗАКАЗЧИК.md`);
    // Второй слой интейка. Отсутствие - штатный легаси-режим, не ошибка.
    const lp = join(ctx.analysisDir, "intake_lexicon.json");
    if (existsSync(lp)) {
      try { intakeLexicon = readJson(lp); } catch (e) { warn(`intake_lexicon.json не прочитан: ${e.message} - лексикон беру из intake.json (легаси)`); }
    }
  }
  const mdPath = join(projectRoot, "ЗАКАЗЧИК.md");
  const md = existsSync(mdPath) ? readFileSync(mdPath, "utf8").replace(/^﻿/, "") : "";

  // sources[] лексикона дублируют intake.json - сливаем, чтобы подписи источников не потерялись.
  const srcLabel = new Map([
    ...(intake && Array.isArray(intake.sources) ? intake.sources : []),
    ...(intakeLexicon && Array.isArray(intakeLexicon.sources) ? intakeLexicon.sources : []),
  ].filter(Boolean).map((s) => [s.id, s.label || s.id]));

  // Двухслойный интейк: facts[] из обоих файлов сливаются в ОДИН список перед разбором.
  // Лексиконные факты - из intake_lexicon.json, если он есть; иначе из intake.json (легаси).
  const baseFacts = intake && Array.isArray(intake.facts) ? intake.facts : [];
  let lexFacts;
  if (intakeLexicon && Array.isArray(intakeLexicon.facts)) {
    lexFacts = intakeLexicon.facts.filter((f) => f && LEXICON_FIELDS.has(f.field));
    lexiconOrigin = `intake_lexicon.json (лексиконных фактов ${lexFacts.length})`;
  } else {
    lexFacts = baseFacts.filter((f) => f && LEXICON_FIELDS.has(f.field));
    lexiconOrigin = lexFacts.length
      ? `intake.json (легаси) (лексиконных фактов ${lexFacts.length})`
      : "нет (лексиконных фактов не найдено ни в intake_lexicon.json, ни в intake.json)";
  }
  const allFacts = [...baseFacts.filter((f) => !(f && LEXICON_FIELDS.has(f.field))), ...lexFacts];
  const by = (field) => allFacts.filter((f) => f && f.field === field && String(f.value || "").trim());
  const label = (f) => srcLabel.get(f.source) || String(f.source || "intake");

  const facts = {
    jur: { entity: "", brand_face: "", requisites: { inn: "", ogrn: "", address: "" } },
    product_guarantee: { what: "", guarantee: "", deadlines: "", prices: "[ЗАПОЛНИТЬ]" },
    numbers: [],
    opsec_restricted: [],
    lexicon: { locked: [], translate: [], canonical: [] },
  };
  const stats = { numbers: 0, own_page: 0, locked: 0, opsec: 0, internal_terms: by("internal_terms").length, requisites_unparsed: 0, requisites_candidates: 0 };

  // Реквизиты: один факт = одно поле (правило intake-analyst).
  // Основной путь - структурированное подполе kind от intake-analyst
  // (inn | ogrn | address | entity | phone | email): агент читал источник и понимает,
  // что перед ним. Регулярки ниже - ТОЛЬКО легаси-фолбэк для фактов без kind
  // (старые клиентские проекты). Что не распозналось - остается оркестратору
  // (он и так сверяет реквизиты по буквам).
  const unknownKinds = new Set();
  for (const f of by("requisites")) {
    const v = String(f.value).trim();
    // Провенанс раньше содержимого: неподтвержденный реквизит в facts.json не попадает.
    if (isUnconfirmedFact(f)) { stats.requisites_candidates++; continue; }
    const digits = v.replace(/\D+/g, "");
    const kind = String(f.kind || "").trim().toLowerCase();
    if (kind) {
      if (kind === "inn") { if (!facts.jur.requisites.inn) facts.jur.requisites.inn = digits || v; }
      else if (kind === "ogrn") { if (!facts.jur.requisites.ogrn) facts.jur.requisites.ogrn = digits || v; }
      else if (kind === "address") { if (!facts.jur.requisites.address) facts.jur.requisites.address = v; }
      else if (kind === "entity") { if (!facts.jur.entity) facts.jur.entity = v; }
      else if (kind === "phone" || kind === "email") stats.requisites_unparsed++; // контакты - в legal-блок inputs.json (оркестратор)
      else { stats.requisites_unparsed++; unknownKinds.add(kind); }
      continue;
    }
    // --- легаси-фолбэк: факт без kind ------------------------------------------------
    // Отрицание внутри значения - не реквизит, а проза о его отсутствии.
    if (REQ_NEGATION.test(v)) { stats.requisites_unparsed++; continue; }
    // Орг-форма: \b с кириллицей не работает (не \w), поэтому границы - явные не-буквы.
    if (/(?:^|[^А-Яа-яA-Za-z])(?:ООО|ИП|АО|ЗАО|ПАО|ОАО)(?:[^А-Яа-яA-Za-z]|$)/.test(v) && !facts.jur.entity) facts.jur.entity = v;
    else if (/ИНН/i.test(v) || /^\d{10}$|^\d{12}$/.test(v)) { if (!facts.jur.requisites.inn) facts.jur.requisites.inn = digits || v; }
    else if (/ОГРН/i.test(v) || /^\d{13}$|^\d{15}$/.test(v)) { if (!facts.jur.requisites.ogrn) facts.jur.requisites.ogrn = digits || v; }
    else if (looksLikeAddress(v)) { if (!facts.jur.requisites.address) facts.jur.requisites.address = v; }
    else stats.requisites_unparsed++; // телефон/email, отвергнутое фолбэком и прочее - в legal-блок inputs.json (оркестратор)
  }
  if (unknownKinds.size) warn(`у фактов requisites неизвестный kind: ${[...unknownKinds].join(", ")} - допустимы inn|ogrn|address|entity|phone|email; такие факты не разобраны`);
  const bf = by("brand_face")[0];
  if (bf) facts.jur.brand_face = String(bf.value).trim();

  // Гарантия и цены - дословно, склейка через "; " (без пересказов и арифметики).
  // guarantee - именно формулировка гарантии; поле what (что за продукт) заполняет
  // оркестратор на ревизии facts.json - в intake такого факта нет.
  const g = by("guarantee").map((f) => String(f.value).trim());
  if (g.length) facts.product_guarantee.guarantee = g.join("; ");
  const pr = by("prices").map((f) => String(f.value).trim());
  if (pr.length) facts.product_guarantee.prices = pr.join("; ");

  // Числа компании: value дословно; label пуст - его привязку ("3 дня - от чего до чего")
  // размечает оркестратор на обязательной ревизии facts.json перед письмом.
  for (const f of by("numbers")) {
    facts.numbers.push({ label: "", value: String(f.value).trim(), publish: "as-is" });
    stats.numbers++;
    if (/^own_page:/.test(String(f.source || ""))) stats.own_page++;
  }
  // own_page-факты полей prices/guarantee уже учтены выше своими полями - посчитаем для сводки.
  for (const f of [...by("prices"), ...by("guarantee")]) if (/^own_page:/.test(String(f.source || ""))) stats.own_page++;

  // OPSEC: только то, что заказчик прямо просил не публиковать (иначе intake это не пишет).
  for (const f of by("opsec")) { facts.opsec_restricted.push(String(f.value).trim()); stats.opsec++; }

  // client_wordings в lexicon.locked НЕ сеются автоматически (правило трех оснований:
  // вход в locked - только решение оркестратора на гейтах, реплика из транскрипта -
  // никогда сама по себе). Кандидаты остаются в analyses/intake.json - оркестратор
  // переносит подтвержденные по ходу гейтов.

  // Фолбэк реквизитов из ЗАКАЗЧИК.md (как раньше делал оркестратор через _client.mjs).
  if (md) {
    if (!facts.jur.entity) facts.jur.entity = pickField(md, "Юрлицо") || pickField(md, "Юридическое лицо") || pickField(md, "Название компании") || "";
    if (!facts.jur.requisites.inn) facts.jur.requisites.inn = pickField(md, "ИНН") || "";
    if (!facts.jur.requisites.ogrn) facts.jur.requisites.ogrn = pickField(md, "ОГРН") || "";
    if (!facts.jur.requisites.address) facts.jur.requisites.address = pickField(md, "Юридический адрес") || pickField(md, "Юр. адрес") || pickField(md, "Адрес") || "";
  }

  return { facts, stats };
}

const factsPath = join(textsDir, "facts.json");
let factsStatus = "уже есть - не трогаю";
if (!existsSync(factsPath)) {
  const { facts, stats } = buildFactsSeeds();
  writeFileSync(factsPath, JSON.stringify(facts, null, 2), "utf8");
  factsStatus = `создан (чисел ${stats.numbers}, из них own_page ${stats.own_page}; opsec ${stats.opsec}; locked не сеется - кандидаты в intake)`;
  if (stats.numbers) notes.push("facts.numbers засеяны с пустым label - разметь привязку каждой цифры на ревизии facts.json");
  if (stats.internal_terms) notes.push(`internal_terms в intake: ${stats.internal_terms} - спаривание internal -> public (lexicon.translate) собирает оркестратор`);
  if (stats.requisites_unparsed) notes.push(`реквизитов не разобрано механически: ${stats.requisites_unparsed} (телефон/email и пр.) - они идут в legal-блок inputs.json от оркестратора`);
  if (stats.requisites_candidates) notes.push(`реквизитов-кандидатов пропущено: ${stats.requisites_candidates} - подтвердите у заказчика`);
}

// ---------------------------------------------------------------------------
// Сводка
// ---------------------------------------------------------------------------

if (emptyOk && pages.length === 0) {
  console.log(`${TAG} pages.json: пустой (источник ${source}) - состав соберет гейт состава, финал запишет повторный вызов с --from-draft`);
} else {
  console.log(`${TAG} pages.json: ${pages.length} страниц (источник ${source})`);
  const byType = {};
  for (const p of pages) byType[p.type] = (byType[p.type] || 0) + 1;
  console.log("  по типам: " + Object.entries(byType).map(([t, c]) => `${t}=${c}`).join(", "));
  if (droppedArticles) console.log(`  исключено статей: ${droppedArticles} (тип "Статья" - вне коммерческого конвейера)`);

  const paired = pages.filter((p) => p.dir_slug).length;
  if (directions.length || dirSlugsReady) {
    const unpaired = pages.filter((p) => !p.dir_slug).map((p) => p.slug);
    console.log(`  направления: спарено ${paired}/${pages.length}` + (unpaired.length ? `; без направления: ${unpaired.slice(0, 8).join(", ")}${unpaired.length > 8 ? " ..." : ""} (без recon и сегментной ЦА; можно доспарить правкой pages.json)` : ""));
  } else {
    console.log("  направления: нет данных анализа - dir_slug везде null");
  }
}
console.log(`  inputs.json: ${inputsCreated ? `создан (tier=${ctx.tier ?? "null"}; legal дописывает оркестратор из intake)` : "уже есть - не трогаю"}`);
console.log(`  leader_blocks.json: ${leaderBlocksStatus}`);
console.log(`  facts.json: ${factsStatus}`);
console.log(`  лексикон: ${lexiconOrigin || "не проверялся (facts.json уже есть - слои интейка не читались)"}`);
for (const n of notes) console.log(`  i ${n}`);
for (const w of warns) console.error(`  ! ${w}`);
if (unrecognizedTypes.size) {
  console.error(`  ! нераспознанные типы -> Инфо: ${[...unrecognizedTypes.entries()].map(([t, c]) => `"${t}" x${c}`).join(", ")} - проверь и поправь type в pages.json, если это не Инфо`);
}
