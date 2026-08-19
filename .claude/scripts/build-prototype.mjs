#!/usr/bin/env node
// build-prototype.mjs
// Детерминированная сборка HTML-прототипа коммерческой страницы.
//
//   manifest.json (копия + рендер-решения от prototype-builder)
//   + kit (.claude/skills/seo-tekst/assets/: shell + css + js + фрагменты + темы + legal)
//   -> prototype.html  (self-contained, без фреймворков, Tilda-совместимый)
//
// LLM пишет ТЕКСТ и выбирает блоки/тему. Этот скрипт занимается ШАБЛОНИЗАЦИЕЙ.
// Контракт - .claude/skills/seo-tekst/assets/KIT-SPEC.md
//
// Использование:
//   node build-prototype.mjs <page_dir|manifest.json> [out.html]
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
import { join, resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS = resolve(__dirname, "..", "skills", "seo-tekst", "assets");

// ---------- args ----------
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
const outPath = process.argv[3] ? resolve(process.argv[3]) : join(pageDir, "prototype.html");

if (!existsSync(manifestPath)) {
  console.error(`[build-prototype] manifest not found: ${manifestPath}`);
  process.exit(1);
}

// ---------- load kit ----------
function readAsset(rel, required = true) {
  const p = join(ASSETS, rel);
  if (!existsSync(p)) {
    if (required) { console.error(`[build-prototype] missing kit asset: ${rel}`); process.exit(1); }
    return "";
  }
  return readFileSync(p, "utf8").replace(/^﻿/, "");
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8").replace(/^﻿/, ""));
const shell = readAsset("PROTOTYPE-MASTER.html");
const prototypeCss = readAsset("prototype.css");
const prototypeJs = readAsset("prototype.js");
const arrowSvg = readAsset("arrow.svg", false).trim();
const fragManifest = JSON.parse(readAsset("fragments-manifest.json"));
const blockToFragment = fragManifest.block_to_fragment || {};

const themeName = manifest.theme || "b2b";
let themeCss = readAsset(`themes/theme-${themeName}.css`, false);
if (!themeCss) {
  console.warn(`[build-prototype] theme "${themeName}" not found, falling back to b2b`);
  themeCss = readAsset("themes/theme-b2b.css");
}

const footerTpl = readAsset("legal/footer.html", false);
const cookieTpl = readAsset("legal/cookie-banner.html", false);
const legalPages = ["page-privacy.html", "page-consent.html", "page-cookie.html", "page-thanks.html"]
  .map((f) => readAsset(`legal/${f}`, false))
  .filter(Boolean);

// ---------- helpers ----------
function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeAttr(s) {
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
function truthy(v) {
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
function renderTemplate(tpl, scope) {
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
    console.warn(`[build-prototype] unclosed ${kind}:${path}`);
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
      console.warn(`[build-prototype] REPEAT:${path} - не массив (${typeof arr}), отрендерено пусто`);
    }
  }
  return interpolate(before, scope) + rendered + renderTemplate(after, scope);
}

// wrap [ЗАПОЛНИТЬ: ...] markers in a visible span (for client review)
// Класс - .nx-fill: именно он стилизован в prototype.css (секция FILL MARKER), пунктирный
// стикер. Любое другое имя (был .pt-fill) даёт пометку обычным текстом - заказчик не видит,
// что именно надо дозаполнить. Атрибут data-fill - хук для поиска пометок в готовом HTML.
function wrapFillNotes(html) {
  return html.replace(/\[ЗАПОЛНИТЬ:[^\]]*\]/g, (m) => `<span class="nx-fill" data-fill>${escapeHtml(m)}</span>`);
}

// ---------- висячие предлоги ----------
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

function bindHanging(src) {
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
  // без учёта неразрывных пробелов перестал совпадать с исходным - что-то пошло не так,
  // отдаём исходный HTML. Сломанная сборка хуже висячего предлога.
  const flat = (s) => s.replace(/\u00A0/g, " ");
  if (out.length !== src.length || flat(out) !== flat(src)) {
    console.warn("[build-prototype] нормализация висячих предлогов изменила не только пробелы - шаг пропущен");
    return src;
  }
  return out;
}

// ---------- render blocks ----------
const blocks = Array.isArray(manifest.blocks) ? manifest.blocks : [];
let blocksHtml = "";
let renderedCount = 0;
let formCount = 0;
const fillNotes = [];
const usedFragments = [];

for (const block of blocks) {
  const type = block.type || "";
  let fragName = block.fragment || blockToFragment[type] || "cards";
  if (!fragManifest.fragments || !fragManifest.fragments[fragName]) {
    console.warn(`[build-prototype] unknown fragment "${fragName}" for block "${type}", using cards`);
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

  let rendered = renderTemplate(fragTpl, scope);
  rendered = rendered.replace(/<!--ARROW_SVG-->/g, arrowSvg);
  blocksHtml += rendered + "\n";
  renderedCount++;
  usedFragments.push(fragName);

  if (Array.isArray(block.fill_notes)) for (const fn of block.fill_notes) fillNotes.push(fn);
}
blocksHtml = wrapFillNotes(blocksHtml);

// ---------- legal + footer + cookie ----------
const legal = manifest.legal || {};

// Производные слоты юр-скоупа (в manifest.legal их нет, считаем здесь):
//   {{phone_raw}}  - телефон без разделителей, для href="tel:..." в футере
//                    (в шапке ту же роль играет маркер <!--PHONE_RAW-->)
//   {{requisites}} - готовая скобочная группа «(ИНН X, ОГРН Y, адрес: Z)» с ведущим
//                    пробелом. Собирается только из непустых частей; если пусты все,
//                    строка пустая - и группа исчезает целиком, а не печатается
//                    скелетом «(ИНН , ОГРН , адрес: )».
const legalReqParts = [];
if (truthy(legal.inn)) legalReqParts.push(`ИНН ${legal.inn}`);
if (truthy(legal.ogrn)) legalReqParts.push(`ОГРН ${legal.ogrn}`);
if (truthy(legal.address)) legalReqParts.push(`адрес: ${legal.address}`);
// Телефон считаем ОДИН раз и на шапку, и на футер. Без общего фолбэка футер при пустом
// legal.phone давал href="tel:" с пустым текстом - мёртвая ссылка, которую verify пропускал
// (регексп матчил пустой tel:). Систематически всплывает в проектах без реквизитов
// (источник --from-brief, ADR-031), где ЗАКАЗЧИК.md нет.
const phone = truthy(legal.phone) ? String(legal.phone) : "+7 (000) 000-00-00";
const phoneRaw = phone.replace(/[^\d+]/g, "");
const legalScope = Object.assign({}, legal, {
  phone,
  phone_raw: phoneRaw,
  requisites: legalReqParts.length ? ` (${legalReqParts.join(", ")})` : "",
});

const footerHtml = footerTpl ? renderTemplate(footerTpl, legalScope) : "";
const cookieHtml = cookieTpl ? renderTemplate(cookieTpl, legalScope) : "";
const legalPagesHtml = legalPages.map((p) => renderTemplate(p, legalScope)).join("\n");

// ---------- shell substitution ----------
const meta = manifest.meta || {};
const title = meta.title || meta.slug || "Прототип";
const desc = meta.description || "";
const company = legal.company || meta.project || "Компания";
// phone / phoneRaw посчитаны выше вместе с legalScope - шапка и футер обязаны совпадать.
const schedule = meta.schedule || legal.schedule || "Пн-Пт 9:00-19:00";
const popups = manifest.popups || {};

const metaTitleHtml =
  `<title>${escapeHtml(title)}</title>\n` +
  `  <meta property="og:title" content="${escapeAttr(title)}">`;
const metaDescHtml = desc
  ? `<meta name="description" content="${escapeAttr(desc)}">\n` +
    `  <meta property="og:description" content="${escapeAttr(desc)}">`
  : "";

const subs = {
  "<!--META_TITLE-->": metaTitleHtml,
  "<!--META_DESC-->": metaDescHtml,
  "<!--THEME_CSS-->": themeCss,
  "<!--PROTOTYPE_CSS-->": prototypeCss,
  "<!--LOGO-->": escapeHtml(company),
  "<!--PHONE-->": escapeHtml(phone),
  "<!--PHONE_RAW-->": escapeAttr(phoneRaw),
  "<!--SCHEDULE-->": escapeHtml(schedule),
  "<!--BLOCKS-->": blocksHtml,
  "<!--FOOTER-->": footerHtml,
  "<!--LEGAL_PAGES-->": legalPagesHtml,
  "<!--COOKIE_BANNER-->": cookieHtml,
  "<!--PROTOTYPE_JS-->": prototypeJs,
  "<!--POPUP_TIME_TITLE-->": escapeHtml(popups.time_title || "Не нашли что искали?"),
  "<!--POPUP_TIME_SUB-->": escapeHtml(popups.time_sub || "Оставьте телефон - перезвоним и ответим на вопросы"),
  "<!--POPUP_TIME_CTA-->": escapeHtml(popups.time_cta || "Жду звонка"),
  "<!--POPUP_EXIT_TITLE-->": escapeHtml(popups.exit_title || "Уже уходите?"),
  "<!--POPUP_EXIT_SUB-->": escapeHtml(popups.exit_sub || "Заберите расчет стоимости - пришлем в мессенджер"),
  "<!--POPUP_EXIT_CTA-->": escapeHtml(popups.exit_cta || "Получить расчет"),
};

let html = shell;
for (const [marker, value] of Object.entries(subs)) {
  html = html.split(marker).join(value);
}

// буква ё запрещена в клиентских текстах (как и тире) - нормализуем ё->е/Ё->Е по всей
// собранной HTML-строке перед записью на диск, как это делает assemble-html.mjs для
// статей. Без этого шага любой новый фрагмент или текст писателя способен вернуть ё,
// и verify-prototype.mjs будет краснеть на ровном месте. URL не содержат сырую ё,
// поэтому замена по всему документу безопасна.
html = normYoFinal(html);

// висячие предлоги прибиваются КОДОМ, а не руками: исходные фрагменты и тексты писателей
// держим чистыми (никаких &nbsp; в контентных файлах), неразрывные пробелы расставляем
// здесь, на собранном документе. Идёт ПОСЛЕ подстановки фрагментов и ПОСЛЕ нормализации ё
// (иначе список служебных слов пришлось бы держать в двух написаниях) и ДО записи файла.
html = bindHanging(html);

writeFileSync(outPath, html, "utf8");

function normYoFinal(s) {
  return String(s).replace(/ё/g, "е").replace(/Ё/g, "Е");
}


// ---------- summary ----------
console.log(`[build-prototype] wrote ${outPath}`);
console.log(`  theme: ${themeName}`);
console.log(`  blocks rendered: ${renderedCount}/${blocks.length}`);
console.log(`  fragments: ${[...new Set(usedFragments)].join(", ")}`);
console.log(`  finale forms: ${formCount}${formCount === 1 ? " (ok)" : " (WARN: expected exactly 1)"}`);
console.log(`  fill-notes (для согласования): ${fillNotes.length}`);
console.log(`  size: ${(Buffer.byteLength(html, "utf8") / 1024).toFixed(1)} KB`);
