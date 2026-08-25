#!/usr/bin/env node
// build-prototype.mjs v2 (ADR-039, двухфазная сборка прототипа)
// Фаза 1: детерминированный рендер БЛОКОВ одной страницы в render-фрагмент.
//
//   manifest.json (копия + рендер-решения от prototype-builder)
//   + kit (.claude/skills/seo-tekst/assets/: fragments + fragments-manifest.json + arrow.svg)
//   -> render.html  (ТОЛЬКО отрендеренные блоки страницы, БЕЗ shell)
//
// Режима полного per-page prototype.html больше НЕТ. Что здесь НЕ делается
// (переехало в assemble-prototype.mjs, фаза 2 - сборка всего сайта одним файлом):
//   - shell (PROTOTYPE-MASTER.html), <title>/meta, тема wireframe, css/js;
//   - legal: футер, cookie-баннер, юр-страницы, phone-placeholder, логотип/график;
//   - normYoFinal (е-с-точками -> е) и bindHanging (висячие предлоги) -
//     ассемблер прогоняет их по ИТОГОВОМУ документу целиком (вкл. стартовую
//     страницу-список и плашку возврата), к render.html они НЕ применяются.
// Попапы удалены полностью (manifest.popups не читается, POPUP_*-маркеров нет).
//
// Поля meta/legal в manifest.json ОСТАЮТСЯ - их читает ассемблер у страницы
// main_slug (site_manifest.json). Этот скрипт при рендере блоков их не использует.
//
// Переиспользуемое ЭКСПОРТИРУЕТСЯ отсюда для assemble-prototype.mjs:
//   normYoFinal, bindHanging, buildLegalScope (phone-placeholder логика),
//   renderTemplate/escapeHtml/escapeAttr/truthy, wrapFillNotes,
//   readAsset/parseJson/ASSETS.
//
// LLM пишет ТЕКСТ и выбирает блоки. Этот скрипт занимается ШАБЛОНИЗАЦИЕЙ.
// Контракт - .claude/skills/seo-tekst/assets/KIT-SPEC.md
//
// Использование:
//   node build-prototype.mjs <page_dir|manifest.json> [out.html]
//   (дефолт out - <page_dir>/render.html)
//
// Mini-template (в фрагментах):
//   {{slot}}            - escape-подстановка
//   {{{slot}}}          - raw-подстановка
//   {{item.field}}      - поле элемента внутри REPEAT
//   {{@index}}          - порядковый номер в REPEAT (с 1)
//   <!--REPEAT:path-->...<!--/REPEAT:path-->   (вложенные поддерживаются, item.features = массив строк -> {{item}})
//   <!--IF:path-->...<!--/IF:path-->           (truthy = непусто)
//   <!--CLASS:cols-->   -> "cols-" + opts.cols
//   <!--ARROW_SVG-->    -> содержимое arrow.svg

import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ASSETS = resolve(__dirname, "..", "skills", "seo-tekst", "assets");

// ---------- kit io (общее для build и assemble) ----------
export function readAsset(rel, required = true) {
  const p = join(ASSETS, rel);
  if (!existsSync(p)) {
    if (required) { console.error(`[prototype-kit] missing kit asset: ${rel}`); process.exit(1); }
    return "";
  }
  return readFileSync(p, "utf8").replace(/^﻿/, "");
}

// Разбор с диагнозом: голый стек SyntaxError не говорит оркестратору, КАКОЙ файл сломан,
// а сломанным чаще всего оказывается тот, что правили руками на гейте.
export function parseJson(raw, whatFile) {
  try {
    return JSON.parse(String(raw).replace(/^﻿/, ""));
  } catch (e) {
    console.error(`[prototype-kit] не разобран ${whatFile}: ${e && e.message ? e.message : e}`);
    process.exit(1);
  }
}

// ---------- helpers ----------
export function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
export function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

// resolve dotted path against a scope (prototype-chain aware)
function resolvePath(path, scope) {
  path = path.trim();
  if (path === "@index") return scope["@index"];
  const parts = path.split(".");
  let v = scope;
  for (const part of parts) {
    if (v == null) return undefined;
    v = v[part.trim()];
  }
  return v;
}
export function truthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  if (v == null) return false;
  if (typeof v === "string") return v.trim() !== "";
  return Boolean(v);
}

// leaf interpolation: {{{raw}}}, {{path}}, <!--CLASS:x-->
function interpolate(text, scope) {
  let out = text.replace(/\{\{\{\s*([^}]+?)\s*\}\}\}/g, (_m, p) => {
    const v = resolvePath(p, scope);
    return v == null ? "" : String(v);
  });
  out = out.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, p) => {
    const v = resolvePath(p, scope);
    return v == null ? "" : escapeHtml(String(v));
  });
  out = out.replace(/<!--CLASS:(\w+)-->/g, (_m, name) => {
    const v = resolvePath("opts." + name, scope);
    return v ? `${name}-${v}` : "";
  });
  return out;
}

// find matching close index for a given open/close tag pair (handles nested same tag)
function matchClose(str, fromIdx, openTag, closeTag) {
  let depth = 1;
  let i = fromIdx;
  while (i < str.length) {
    const nextOpen = str.indexOf(openTag, i);
    const nextClose = str.indexOf(closeTag, i);
    if (nextClose === -1) return -1;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      i = nextOpen + openTag.length;
    } else {
      depth--;
      if (depth === 0) return nextClose;
      i = nextClose + closeTag.length;
    }
  }
  return -1;
}

// recursive render of a template with control tags
export function renderTemplate(tpl, scope) {
  const openRe = /<!--(REPEAT|IF):([^>]+?)-->/;
  const m = openRe.exec(tpl);
  if (!m) return interpolate(tpl, scope);

  const kind = m[1];
  const path = m[2].trim();
  const openTag = `<!--${kind}:${path}-->`;
  const closeTag = `<!--/${kind}:${path}-->`;
  const before = tpl.slice(0, m.index);
  const innerStart = m.index + openTag.length;
  const closeIdx = matchClose(tpl, innerStart, openTag, closeTag);
  if (closeIdx === -1) {
    console.warn(`[prototype-kit] unclosed ${kind}:${path}`);
    return interpolate(tpl, scope);
  }
  const inner = tpl.slice(innerStart, closeIdx);
  const after = tpl.slice(closeIdx + closeTag.length);

  let rendered = "";
  if (kind === "IF") {
    rendered = truthy(resolvePath(path, scope)) ? renderTemplate(inner, scope) : "";
  } else {
    const arr = resolvePath(path, scope);
    if (Array.isArray(arr)) {
      rendered = arr
        .map((el, i) => {
          const child = Object.create(scope);
          child.item = el;
          child["@index"] = i + 1;
          return renderTemplate(inner, child);
        })
        .join("");
    } else if (arr != null) {
      console.warn(`[prototype-kit] REPEAT:${path} - не массив (${typeof arr}), отрендерено пусто`);
    }
  }
  return interpolate(before, scope) + rendered + renderTemplate(after, scope);
}

// wrap [ЗАПОЛНИТЬ: ...] markers in a visible span (for client review)
// Класс - .nx-fill: именно он стилизован в prototype.css (секция FILL MARKER), пунктирный
// стикер. Любое другое имя (был .pt-fill) дает пометку обычным текстом - заказчик не видит,
// что именно надо дозаполнить. Атрибут data-fill - хук для поиска пометок в готовом HTML.
export function wrapFillNotes(html) {
  return html.replace(/\[ЗАПОЛНИТЬ:[^\]]*\]/g, (m) => `<span class="nx-fill" data-fill>${escapeHtml(m)}</span>`);
}

// ---------- нормализация е-с-точками (применяет АССЕМБЛЕР по всему документу) ----------
// Буква е-с-точками запрещена в клиентских текстах (как и тире). Ассемблер нормализует
// итоговый документ перед записью на диск, как это делает assemble-html.mjs для статей.
// URL не содержат эту букву в сыром виде, поэтому замена по всему документу безопасна.
export function normYoFinal(s) {
  return String(s).replace(/ё/g, "е").replace(/Ё/g, "Е");
}

// ---------- висячие предлоги (применяет АССЕМБЛЕР по всему документу) ----------
const NBSP = "\u00A0";

// Короткие служебные слова липнут к СЛЕДУЮЩЕМУ слову: «в Казани», «под ключ», «не менее».
const GLUE_NEXT = [
  "в", "к", "с", "у", "о", "а", "и", "я",
  "во", "ко", "со", "об", "от", "до", "за", "из", "на", "по", "то", "не", "ни", "но", "да", "ну",
  "мы", "вы", "ты", "он", "их", "ее", "его", "им", "ей",
  "обо", "изо", "ото", "для", "без", "при", "под", "над", "про", "или", "ибо",
];
// Частицы липнут к ПРЕДЫДУЩЕМУ слову: «так же», «если бы» - иначе отрываются в начало
// следующей строки (после слова, к которому относятся).
const GLUE_PREV = ["же", "бы", "ли", "б"];

const LN = "\\p{L}\\p{N}";
const RE_GLUE_NEXT = new RegExp(`(?<![${LN}])(${GLUE_NEXT.join("|")}) (?=\\S)`, "giu");
const RE_GLUE_PREV = new RegExp(`(?<=[${LN}]) (?=(?:${GLUE_PREV.join("|")})(?![${LN}]))`, "giu");
// Число не отрывается от того, что за ним: «3 дня», «от 900 000 руб.» - разрыв числа
// и единицы читается хуже всего.
const RE_NUM = /(?<=\d) (?=[\p{L}\d])/gu;

// Куски, которые пропускаем целиком: HTML-комментарии (в т.ч. контракт передачи),
// <script>/<style> (там неразрывный пробел ломает код), <title> (метатеги по контракту
// не трогаем), <textarea>/<pre>/<code> (значимые пробелы) и ЛЮБОЙ тег - значения
// атрибутов (href, src, class, alt) неразрывного пробела не переживают.
// Кавычки в теге учтены, чтобы `>` внутри значения атрибута не обрывал разбор.
const RE_SKIP =
  /<!--[\s\S]*?-->|<(script|style|title|textarea|pre|code)\b[^>]*>[\s\S]*?<\/\1\s*>|<[a-zA-Z!/][^>"']*(?:(?:"[^"]*"|'[^']*')[^>"']*)*>/gi;

function nbspInText(t) {
  let out = t;
  // два прохода: после первой замены рядом может остаться второе короткое слово («в к»),
  // и его пробел тоже надо прибить.
  for (let pass = 0; pass < 2; pass++) {
    out = out
      .replace(RE_GLUE_NEXT, (_m, w) => w + NBSP)
      .replace(RE_GLUE_PREV, NBSP)
      .replace(RE_NUM, NBSP);
  }
  return out;
}

// Висячие предлоги прибиваются КОДОМ, а не руками: исходные фрагменты и тексты писателей
// держим чистыми (никаких &nbsp; в контентных файлах). Ассемблер зовет bindHanging по
// СОБРАННОМУ документу, ПОСЛЕ normYoFinal (иначе список служебных слов пришлось бы
// держать в двух написаниях) и ДО записи файла.
export function bindHanging(src) {
  let out = "";
  let last = 0;
  let m;
  RE_SKIP.lastIndex = 0;
  while ((m = RE_SKIP.exec(src)) !== null) {
    out += nbspInText(src.slice(last, m.index)) + m[0];
    last = m.index + m[0].length;
  }
  out += nbspInText(src.slice(last));

  // Страховка: замена обязана трогать ТОЛЬКО пробелы. Если длина изменилась или документ
  // без учета неразрывных пробелов перестал совпадать с исходным - что-то пошло не так,
  // отдаем исходный HTML. Сломанная сборка хуже висячего предлога.
  const flat = (s) => s.replace(/\u00A0/g, " ");
  if (out.length !== src.length || flat(out) !== flat(src)) {
    console.warn("[prototype-kit] нормализация висячих предлогов изменила не только пробелы - шаг пропущен");
    return src;
  }
  return out;
}

// ---------- юр-скоуп (применяет АССЕМБЛЕР для legal main_slug) ----------
// Производные слоты юр-скоупа (в manifest.legal их нет, считаем здесь):
//   {{phone_raw}}  - телефон без разделителей, для href="tel:..." в футере
//                    (в шапке ту же роль играет маркер <!--PHONE_RAW-->)
//   {{requisites}} - готовая скобочная группа «(ИНН X, ОГРН Y, адрес: Z)» с ведущим
//                    пробелом. Собирается только из непустых частей; если пусты все,
//                    строка пустая - и группа исчезает целиком, а не печатается
//                    скелетом «(ИНН , ОГРН , адрес: )».
//
// Телефон считается ОДИН раз и на шапку, и на футер - они обязаны совпадать. Без общего
// фолбэка футер при пустом legal.phone давал href="tel:" с пустым текстом - мертвая
// ссылка, которую verify пропускал (регексп матчил пустой tel:). Систематически всплывает
// в проектах без реквизитов (basic-анализ или --from-table), где ЗАКАЗЧИК.md нет.
//
// ОДНО поведение на два законных написания «телефона нет». Сборщику-агенту предписано не
// выдумывать реквизиты, а писать «[телефон - требует уточнения]»; раньше такая строка
// проходила как заполненный телефон, цифр в ней нет - и в href уезжал пустой tel:,
// то есть блокирующее нарушение за исполнение собственной инструкции. Теперь и пустое
// поле, и любая пометка-заглушка (нет 5+ цифр подряд) дают одно и то же: маску
// +7 (000) 000-00-00. Она заведомо нерабочая и читается человеком как «не заполнено»,
// ссылка при этом живая - пустой href="tel:" остается нарушением намеренно.
export const PHONE_PLACEHOLDER = "+7 (000) 000-00-00";

// ТРЕТЬЕ состояние телефона - `legal.phone_absent: true`: у заказчика телефона НЕТ и не будет
// (онлайн-проект без телефонного канала). Пустое поле и такое решение - разные вещи: пустое
// означает «реквизит не закрыт» и честно печатается маской, а решение означает «блока быть
// не должно». Различить их эвристикой нельзя, поэтому нужен явный флаг: его ставит оркестратор
// в legal-блок inputs.json по ответу заказчика, а не сборщик по виду пустой строки.
// При phone_absent телефон не печатается нигде (шапка, бургер, мобильная панель, футер),
// маска не подставляется, и правило verify-prototype «нет кликабельного телефона» не применяется.
export function buildLegalScope(legal = {}) {
  const reqParts = [];
  if (truthy(legal.inn)) reqParts.push(`ИНН ${legal.inn}`);
  if (truthy(legal.ogrn)) reqParts.push(`ОГРН ${legal.ogrn}`);
  if (truthy(legal.address)) reqParts.push(`адрес: ${legal.address}`);

  const phoneAbsent = truthy(legal.phone_absent);
  const phoneGiven = truthy(legal.phone) ? String(legal.phone).trim() : "";
  // При явном решении «телефона нет» поле пустым не считается: заглушке взяться неоткуда.
  const phoneMissing = !phoneAbsent && phoneGiven.replace(/\D/g, "").length < 5;
  const phone = phoneAbsent ? "" : (phoneMissing ? PHONE_PLACEHOLDER : phoneGiven);
  const phoneRaw = phone.replace(/[^\d+]/g, "");

  return {
    scope: Object.assign({}, legal, {
      phone,
      phone_raw: phoneRaw,
      requisites: reqParts.length ? ` (${reqParts.join(", ")})` : "",
    }),
    phone,
    phoneRaw,
    phoneMissing,
    phoneGiven,
    phoneAbsent,
    // Готовый текст предупреждения - ассемблер печатает его как есть, чтобы формулировка
    // «телефон не заполнен» была одна на весь конвейер (лог сборки + сводка verify).
    warning: phoneMissing
      ? `legal.phone не заполнен${phoneGiven ? ` (${phoneGiven})` : ""} - подставлена заглушка ${PHONE_PLACEHOLDER}. Выдумывать номер нельзя, реквизит закрывает заказчик.`
      : null,
  };
}

// ---------- CLI: рендер блоков одной страницы -> render.html ----------
function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error("[build-prototype] usage: node build-prototype.mjs <page_dir|manifest.json> [out.html]");
    process.exit(1);
  }
  const argPath = resolve(arg);
  let manifestPath, pageDir;
  if (existsSync(argPath) && statSync(argPath).isDirectory()) {
    pageDir = argPath;
    manifestPath = join(pageDir, "manifest.json");
  } else {
    manifestPath = argPath;
    pageDir = dirname(argPath);
  }
  const outPath = process.argv[3] ? resolve(process.argv[3]) : join(pageDir, "render.html");

  if (!existsSync(manifestPath)) {
    console.error(`[build-prototype] manifest not found: ${manifestPath}`);
    process.exit(1);
  }

  const manifest = parseJson(readFileSync(manifestPath, "utf8"), manifestPath);
  const arrowSvg = readAsset("arrow.svg", false).trim();
  const fragManifest = parseJson(readAsset("fragments-manifest.json"), "fragments-manifest.json (кит)");
  const blockToFragment = fragManifest.block_to_fragment || {};

  // ---------- render blocks ----------
  const blocks = Array.isArray(manifest.blocks) ? manifest.blocks : [];
  let blocksHtml = "";
  let renderedCount = 0;
  let formCount = 0;
  const fillNotes = [];
  const usedFragments = [];
  const unknownFragments = [];

  for (const block of blocks) {
    const type = block.type || "";
    let fragName = block.fragment || blockToFragment[type] || "cards";
    if (!fragManifest.fragments || !fragManifest.fragments[fragName]) {
      // Фолбэк остается (сборка не должна вставать), но факт подмены копится в сводку:
      // фолбэк рисует заголовок и пустую сетку под ним, то есть обещанный блок исчезает.
      // Блокирует это verify-prototype.mjs - здесь только громкий сигнал.
      console.warn(`[build-prototype] фрагмента "${fragName}" нет в ките (блок "${type}") - подставлен фолбэк cards, блок уедет пустым`);
      unknownFragments.push(`${fragName} (блок "${type}")`);
      fragName = "cards";
    }
    const fragFile = (fragManifest.fragments[fragName] && fragManifest.fragments[fragName].file) || `${fragName}.html`;
    const fragTpl = readAsset(`fragments/${fragFile}`, false);
    if (!fragTpl) {
      console.warn(`[build-prototype] fragment file missing: ${fragFile}, skipping block "${type}"`);
      continue;
    }
    if (fragName === "form") formCount++;

    const scope = Object.assign({}, block.slots || {});
    scope.opts = block.opts || {};
    if (block.h2 != null && scope.h2 == null) scope.h2 = block.h2;
    // empty_state приезжает из blueprint полем блока, а не слотом. Отдаем его фрагменту как
    // {{empty_state}}, чтобы у сборщика-агента не было повода класть его в subhead: subhead -
    // слот писателя, и подмена затирает согласованный текст мимо канона page.json (v7.1:
    // page.json - единственный источник текстов, из него собирается клиентский прототип).
    if (block.empty_state != null && scope.empty_state == null) scope.empty_state = block.empty_state;

    let rendered = renderTemplate(fragTpl, scope);
    rendered = rendered.replace(/<!--ARROW_SVG-->/g, arrowSvg);
    blocksHtml += rendered + "\n";
    renderedCount++;
    usedFragments.push(fragName);

    if (Array.isArray(block.fill_notes)) for (const fn of block.fill_notes) fillNotes.push(fn);
  }
  blocksHtml = wrapFillNotes(blocksHtml);

  // normYoFinal и bindHanging здесь НЕ применяются: ассемблер прогоняет их по итоговому
  // документу целиком (иначе стартовая страница и плашка возврата остались бы без
  // нормализации, а самопроверка bindHanging шла бы по куску вместо целого).
  writeFileSync(outPath, blocksHtml, "utf8");

  // ---------- summary ----------
  console.log(`[build-prototype] wrote ${outPath}`);
  console.log(`  blocks rendered: ${renderedCount}/${blocks.length}`);
  console.log(`  fragments: ${[...new Set(usedFragments)].join(", ")}`);
  if (unknownFragments.length) console.log(`  НЕТ В КИТЕ (подставлен cards, блок пустой): ${unknownFragments.join("; ")}`);
  console.log(`  finale forms: ${formCount}${formCount === 1 ? " (ok)" : " (WARN: expected exactly 1)"}`);
  console.log(`  fill-notes (для согласования): ${fillNotes.length}`);
  console.log(`  size: ${(Buffer.byteLength(blocksHtml, "utf8") / 1024).toFixed(1)} KB (render-фрагмент, без shell)`);
}

// Гард CLI: файл импортируется ассемблером как модуль (normYoFinal, bindHanging,
// buildLegalScope, движок) - при импорте рендер запускаться не должен.
const isCli = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isCli) main();
