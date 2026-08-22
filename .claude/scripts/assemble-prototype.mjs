#!/usr/bin/env node
// assemble-prototype.mjs
// Сборка ЕДИНОГО HTML-прототипа сайта из отрендеренных страниц (этап C, ADR-039).
//
//   site_manifest.json (корень texts_dir; пишет оркестратор)
//   + pages/<slug>/render.html   (блоки страницы БЕЗ shell; выход build-prototype.mjs v2)
//   + pages/<slug>/manifest.json (источник истины страницы; doc-уровень берется у main_slug)
//   + kit (.claude/skills/seo-tekst/assets/: PROTOTYPE-MASTER v2 + css + js + legal)
//   -> prototype.html (весь сайт одним self-contained файлом, без фреймворков)
//
// Использование:
//   node assemble-prototype.mjs <texts_dir> [out.html]
//     <texts_dir> - корень задачи texts/NNN-slug/ (или texts/NNN/tone/ для тон-превью:
//                   свой site_manifest.json + свои pages/<slug>/render.html)
//     [out.html]  - путь результата, дефолт <texts_dir>/prototype.html
//
// Что делает (интерфейс этапа C, ADR-039):
//   - служебная стартовая секция-список <section class="pt-page pt-index" data-page="__index">
//     первой внутри <main id="ptPages">, затем по order секции страниц
//     <section class="pt-page" data-page="<slug>" hidden> с содержимым render.html;
//   - неймспейс внутри каждой страничной секции: все id -> <slug>__<id>, переписываются
//     ссылки href="#..." и label for="..."; закрытый список якорей БЕЗ префикса:
//     privacy, person-data-consent, cookie, thanks (сервисные секции - одни на документ);
//   - <script>window.PT_ROUTES = {...}</script> вставляется ПЕРЕД подключением prototype.js
//     (маркер <!--ROUTES_SCRIPT--> в shell v2);
//   - doc-уровень (legal с phone-placeholder, титул/мета, логотип/график) - из manifest.json
//     страницы main_slug; тема всегда wireframe (theme-wireframe.css инлайнится);
//   - контракт передачи ADR-035 (комментарий в head после meta charset + плашка .pt-contract
//     первым элементом body) - по одному на документ: несет их shell, ассемблер страхует
//     вставкой, если в shell их нет;
//   - финальный пост-проход по ВСЕМУ документу: normYoFinal (е-с-точками -> е)
//     + bindHanging (неразрывные пробелы у висячих предлогов).
//
// Ожидаемые маркеры shell (PROTOTYPE-MASTER.html v2): <!--META_TITLE--> <!--META_DESC-->
// <!--THEME_CSS--> <!--PROTOTYPE_CSS--> <!--LOGO--> <!--PHONE--> <!--PHONE_RAW-->
// <!--SCHEDULE--> <!--PAGES--> (внутри <main id="ptPages">) <!--FOOTER--> <!--LEGAL_PAGES-->
// <!--COOKIE_BANNER--> <!--ROUTES_SCRIPT--> <!--PROTOTYPE_JS-->; элемент #ptBackbar над header.

import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
// Общие helpers кита - из build-prototype.mjs (CLI там за гардом, импорт безопасен):
// один normYoFinal, один bindHanging, одна формулировка «телефон не заполнен» на конвейер.
import {
  readAsset,
  parseJson,
  escapeHtml,
  escapeAttr,
  truthy,
  renderTemplate,
  normYoFinal,
  bindHanging,
  buildLegalScope,
  PHONE_PLACEHOLDER,
} from "./build-prototype.mjs";

const TAG = "[assemble-prototype]";

function die(msg) {
  console.error(`${TAG} ${msg}`);
  process.exit(1);
}

// ---------- args ----------
const arg = process.argv[2];
if (!arg) {
  console.error(`${TAG} usage: node assemble-prototype.mjs <texts_dir> [out.html]`);
  process.exit(1);
}
const textsDir = resolve(arg);
if (!existsSync(textsDir) || !statSync(textsDir).isDirectory()) {
  die(`texts_dir не найден или не папка: ${textsDir}`);
}
const outPath = process.argv[3] ? resolve(process.argv[3]) : join(textsDir, "prototype.html");

function readLocal(p) {
  return readFileSync(p, "utf8").replace(/^﻿/, "");
}

// ---------- site_manifest ----------
const siteManifestPath = join(textsDir, "site_manifest.json");
if (!existsSync(siteManifestPath)) die(`site_manifest.json не найден: ${siteManifestPath}`);
const siteManifest = parseJson(readLocal(siteManifestPath), siteManifestPath);

const rawPages = Array.isArray(siteManifest.pages) ? siteManifest.pages : [];
if (!rawPages.length) die("site_manifest.json: pages пуст - собирать нечего");

for (const p of rawPages) {
  if (!p || typeof p.slug !== "string" || !p.slug.trim()) {
    die(`site_manifest.json: у страницы нет slug (${JSON.stringify(p)})`);
  }
  if (p.slug.startsWith("__")) {
    die(`site_manifest.json: slug "${p.slug}" зарезервирован (префикс __ - служебные маршруты роутера)`);
  }
}

// дубли slug - die: страницы адресуются по data-page и #p/<slug>, дубль ломает роутер
{
  const seen = new Set();
  const dupes = new Set();
  for (const p of rawPages) {
    if (seen.has(p.slug)) dupes.add(p.slug);
    seen.add(p.slug);
  }
  if (dupes.size) die(`site_manifest.json: дубли slug: ${[...dupes].join(", ")}`);
}

// сортировка по order (стабильная; страницы без order уходят в конец)
const pages = [...rawPages].sort((a, b) => {
  const ao = Number.isFinite(a.order) ? a.order : Number.MAX_SAFE_INTEGER;
  const bo = Number.isFinite(b.order) ? b.order : Number.MAX_SAFE_INTEGER;
  return ao - bo;
});

// main_slug: doc-уровень документа берется из манифеста этой страницы
let mainSlug = typeof siteManifest.main_slug === "string" && siteManifest.main_slug.trim()
  ? siteManifest.main_slug.trim()
  : "";
if (!mainSlug) {
  mainSlug = pages[0].slug;
  console.warn(`${TAG} site_manifest.json без main_slug - взята первая страница по order: ${mainSlug}`);
} else if (!pages.some((p) => p.slug === mainSlug)) {
  die(`site_manifest.json: main_slug "${mainSlug}" отсутствует в pages`);
}

const startRoute = typeof siteManifest.start === "string" && siteManifest.start.trim()
  ? siteManifest.start.trim()
  : "__index";

// ---------- render.html всех страниц ----------
const missingRenders = [];
const renders = new Map(); // slug -> html
for (const p of pages) {
  const rp = join(textsDir, "pages", p.slug, "render.html");
  if (!existsSync(rp)) {
    missingRenders.push(`pages/${p.slug}/render.html`);
    continue;
  }
  renders.set(p.slug, readLocal(rp));
}
if (missingRenders.length) {
  die(
    `нет render.html у страниц из site_manifest.json:\n  - ${missingRenders.join("\n  - ")}\n` +
      `Сначала прогони build-prototype.mjs по каждой странице (выход - render.html).`
  );
}
for (const [slug, html] of renders) {
  // render.html - фрагмент (только блоки страницы). Полный документ означает сборку
  // старым build-prototype (per-page prototype.html) - склейка двух shell друг в друга.
  if (/<!DOCTYPE|<html[\s>]/i.test(html)) {
    die(`pages/${slug}/render.html похож на ПОЛНЫЙ документ (есть <html>/<!DOCTYPE>) - нужен render-фрагмент build-prototype v2`);
  }
}

// ---------- manifest.json главной страницы (doc-уровень) ----------
const mainManifestPath = join(textsDir, "pages", mainSlug, "manifest.json");
if (!existsSync(mainManifestPath)) {
  die(`нет manifest.json главной страницы (main_slug=${mainSlug}): ${mainManifestPath}`);
}
const mainManifest = parseJson(readLocal(mainManifestPath), mainManifestPath);

// ---------- kit ----------
let shell = readAsset("PROTOTYPE-MASTER.html");
const prototypeCss = readAsset("prototype.css");
const prototypeJs = readAsset("prototype.js");
// тема всегда wireframe (ADR-039): дизайн не проектируется, фолбэков на цветные темы нет
const themeCss = readAsset("themes/theme-wireframe.css");
const footerTpl = readAsset("legal/footer.html", false);
const cookieTpl = readAsset("legal/cookie-banner.html", false);
const legalPages = ["page-privacy.html", "page-consent.html", "page-cookie.html", "page-thanks.html"]
  .map((f) => readAsset(`legal/${f}`, false))
  .filter(Boolean);

if (!shell.includes("<!--PAGES-->")) {
  die(
    `в PROTOTYPE-MASTER.html нет маркера <!--PAGES--> (внутри <main id="ptPages">) - нужен shell v2 (ADR-039). ` +
      `Похоже, кит не обновлен: старый маркер <!--BLOCKS--> ассемблер не обслуживает.`
  );
}
if (!shell.includes('id="ptBackbar"')) {
  console.warn(`${TAG} в shell не найден #ptBackbar (плашка возврата) - проверь PROTOTYPE-MASTER v2`);
}

// CTA самого shell: href="#lead" -> class="pt-shell-cta" href="#" (клик обрабатывает
// prototype.js - скролл к форме активной секции). В shell v2 это уже сделано - тогда no-op;
// переписывание здесь - страховка от кита до v2, чтобы CTA не вели на несуществующий якорь.
{
  let ctaCount = 0;
  shell = shell.replace(/<a\b[^>]*href="#lead"[^>]*>/g, (tag) => {
    ctaCount++;
    let t = tag.replace('href="#lead"', 'href="#"');
    if (/\bclass="/.test(t)) {
      if (!/\bpt-shell-cta\b/.test(t)) t = t.replace(/\bclass="/, 'class="pt-shell-cta ');
    } else {
      t = t.replace(/^<a\b/, '<a class="pt-shell-cta"');
    }
    return t;
  });
  if (ctaCount) {
    console.warn(`${TAG} shell: ${ctaCount} CTA с href="#lead" переведены на pt-shell-cta href="#" (кит не обновлен до v2)`);
  }
}

// ---------- контракт передачи ADR-035 (по одному на документ) ----------
// Штатно комментарий и плашку несет сам shell (KIT-SPEC §6.1). Если их там нет
// (усеченный shell), вставляет ассемблер - тексты дословно из кита.
const CONTRACT_COMMENT = `<!--
    charset обязан стоять ПЕРВЫМ: окно предсканирования кодировки у браузеров - первые 1024
    байта, а комментарий-контракт ниже длиннее. Не переставляй его вниз.

    ЭТО ПРОТОТИП, А НЕ МАКЕТ.

    Файл описывает СОДЕРЖАНИЕ страницы: какие блоки, в каком порядке, с каким текстом
    и с каким приоритетом. Это карта наполнения.

    Файл НЕ описывает дизайн. Черно-белая палитра, сетка, отступы, число колонок,
    размеры карточек и порядок элементов ВНУТРИ блока служебные: они выбраны для
    читаемости каркаса, а не как дизайнерское решение.

    ЧТО СОХРАНИТЬ:
      1. порядок блоков сверху вниз (это воронка, он обоснован);
      2. тексты дословно (согласованы с заказчиком и прошли копи-валидатор);
      3. все цифры и факты без изменений;
      4. один главный CTA на блок.

    ЧТО МОЖНО И НУЖНО ПЕРЕОПРЕДЕЛИТЬ:
      1. композицию и сетку внутри блока;
      2. число колонок и размеры карточек;
      3. типографику, палитру, шрифты, иконки, иллюстрации;
      4. визуальные элементы, которых в прототипе нет вовсе;
      5. объединение двух соседних блоков в один экран или разбиение одного на несколько.

    НЕ КОПИРУЙ КОМПОЗИЦИЮ ЭТОГО ФАЙЛА. Она служебная.
  -->
  <meta name="prototype-contract" content="content-map-not-layout">`;

const CONTRACT_PLATE = `<!-- Служебная плашка контракта передачи. Одна на документ, убирать нельзя (KIT-SPEC §6). -->
  <div class="pt-contract" id="prototypeContract" data-prototype-contract role="note">
    <div class="container pt-contract__row">
      <p class="pt-contract__text">
        <b class="pt-contract__title">Это прототип, а не дизайн.</b>
        Здесь зафиксировано содержание: какие блоки, в каком порядке и с каким текстом.
        Композиция, цвет, шрифты и иллюстрации появятся на следующем этапе и будут другими.
      </p>
      <button type="button" class="pt-contract__close" aria-label="Скрыть напоминание"
              onclick="this.closest('.pt-contract').remove()">&times;</button>
    </div>
  </div>`;

if (!shell.includes('name="prototype-contract"')) {
  // комментарий-контракт - строго ПОСЛЕ meta charset (окно предсканирования 1024 байта)
  const cm = /<meta charset="[^"]*"\s*\/?>/i.exec(shell);
  if (!cm) die("в shell не найден <meta charset> - некуда вставить комментарий-контракт");
  const at = cm.index + cm[0].length;
  shell = shell.slice(0, at) + "\n  " + CONTRACT_COMMENT + shell.slice(at);
  console.warn(`${TAG} в shell не было комментария-контракта - вставлен ассемблером`);
}
if (!shell.includes("data-prototype-contract")) {
  // видимая плашка - первым элементом body, до шапки
  const bm = /<body[^>]*>/i.exec(shell);
  if (!bm) die("в shell не найден <body> - некуда вставить плашку контракта");
  const at = bm.index + bm[0].length;
  shell = shell.slice(0, at) + "\n\n  " + CONTRACT_PLATE + shell.slice(at);
  console.warn(`${TAG} в shell не было плашки .pt-contract - вставлена ассемблером`);
}

// ---------- неймспейс страничной секции ----------
// Все id внутри секции -> <slug>__<id>; переписываются ссылки href="#..." и label
// for="..." (aria-атрибутов с id в ките нет - проверено, KIT-SPEC). Закрытый список
// якорей БЕЗ префикса: privacy, person-data-consent, cookie, thanks (сервисные секции -
// одни на документ). Плюс защитные исключения: пустой якорь, маршруты #p/<slug>
// и служебные #__* (роутер) префикс не получают.
const GLOBAL_ANCHORS = new Set(["privacy", "person-data-consent", "cookie", "thanks"]);
function keepAnchor(id) {
  return GLOBAL_ANCHORS.has(id) || id === "" || id.startsWith("p/") || id.startsWith("__");
}
function namespaceSection(html, slug) {
  // (?<![-\w]) отсекает атрибуты, оканчивающиеся на id/for (data-id и подобные)
  let out = html.replace(/(?<![-\w])id="([^"]+)"/g, (_m, id) => `id="${slug}__${id}"`);
  out = out.replace(/(?<![-\w])href="#([^"]*)"/g, (m, id) =>
    keepAnchor(id) ? m : `href="#${slug}__${id}"`
  );
  out = out.replace(/(?<![-\w])for="([^"]+)"/g, (m, id) =>
    keepAnchor(id) ? m : `for="${slug}__${id}"`
  );
  return out;
}

// ---------- legal + footer + cookie (doc-уровень из манифеста main_slug) ----------
const legalInfo = buildLegalScope(mainManifest.legal || {});
if (legalInfo.warning) console.warn(`${TAG} ${legalInfo.warning}`);

const footerHtml = footerTpl ? renderTemplate(footerTpl, legalInfo.scope) : "";
const cookieHtml = cookieTpl ? renderTemplate(cookieTpl, legalInfo.scope) : "";
let legalPagesHtml = legalPages.map((p) => renderTemplate(p, legalInfo.scope)).join("\n");

// Ссылок формата #mainContent в контенте быть не должно (ADR-039): возврат из
// юр-страниц - #__back. В ките v2 это уже так; переписывание здесь - страховка
// от юр-страниц до v2 (иначе возврат ведет на несуществующий id).
if (legalPagesHtml.includes('href="#mainContent"')) {
  console.warn(`${TAG} legal-страницы кита со ссылкой href="#mainContent" - переписаны на #__back`);
  legalPagesHtml = legalPagesHtml.split('href="#mainContent"').join('href="#__back"');
}

// ---------- секции: стартовый список + страницы ----------
const meta = mainManifest.meta || {};
const legal = mainManifest.legal || {};
const company = legal.company || meta.project || "Компания";

// Разметка списка - по контракту prototype.css (секция INDEX):
// section.pt-page.pt-index > .pt-index__body > заголовок + .pt-index__list
// из ссылок .pt-index__item (внутри .pt-index__type и .pt-index__name).
function buildIndexSection() {
  const items = pages
    .map((p) => {
      const typeHtml = truthy(p.type)
        ? `\n          <div class="pt-index__type">${escapeHtml(p.type)}</div>`
        : "";
      return (
        `        <a class="pt-index__item" href="#p/${escapeAttr(p.slug)}">${typeHtml}\n` +
        `          <div class="pt-index__name">${escapeHtml(p.title || p.slug)}</div>\n` +
        `        </a>`
      );
    })
    .join("\n");
  return (
    `<section class="pt-page pt-index" data-page="__index">\n` +
    `      <div class="pt-index__body">\n` +
    `        <h1 class="pt-index__title">Прототип сайта: ${escapeHtml(company)}</h1>\n` +
    `        <p class="pt-index__sub">Служебная страница-оглавление: выберите страницу, чтобы открыть ее. Вернуться к списку можно по плашке над шапкой.</p>\n` +
    `        <nav class="pt-index__list" aria-label="Страницы прототипа">\n${items}\n        </nav>\n` +
    `      </div>\n` +
    `    </section>`
  );
}

const pageSections = pages.map((p) => {
  const namespaced = namespaceSection(renders.get(p.slug), p.slug);
  return (
    `<section class="pt-page" data-page="${escapeAttr(p.slug)}" hidden>\n` +
    `${namespaced.trim()}\n` +
    `    </section>`
  );
});

const pagesHtml = [buildIndexSection(), ...pageSections].join("\n\n    ");

// ---------- PT_ROUTES ----------
const routes = {
  pages: pages.map((p) => ({ slug: p.slug, title: p.title || p.slug })),
  start: startRoute,
};
// < экранируется, чтобы содержимое JSON не могло породить </script> внутри тега
const routesJson = JSON.stringify(routes).replace(/</g, "\\u003c");
const routesScriptTag = `<script>window.PT_ROUTES = ${routesJson}</script>`;

// ---------- shell substitution ----------
const title = meta.title || meta.slug || "Прототип";
const desc = meta.description || "";
const schedule = meta.schedule || legal.schedule || "Пн-Пт 9:00-19:00";

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
  "<!--PHONE-->": escapeHtml(legalInfo.phone),
  "<!--PHONE_RAW-->": escapeAttr(legalInfo.phoneRaw),
  "<!--SCHEDULE-->": escapeHtml(schedule),
  "<!--PAGES-->": pagesHtml,
  "<!--FOOTER-->": footerHtml,
  "<!--LEGAL_PAGES-->": legalPagesHtml,
  "<!--COOKIE_BANNER-->": cookieHtml,
};

let html = shell;
for (const [marker, value] of Object.entries(subs)) {
  html = html.split(marker).join(value);
}

// PT_ROUTES - строго ПЕРЕД подключением prototype.js (роутер читает карту при старте).
// Штатно - маркер <!--ROUTES_SCRIPT--> в shell v2; нет маркера - вставка перед
// <script> с <!--PROTOTYPE_JS--> (страховка).
if (html.includes("<!--ROUTES_SCRIPT-->")) {
  html = html.split("<!--ROUTES_SCRIPT-->").join(routesScriptTag);
} else {
  const jsMarkerIdx = html.indexOf("<!--PROTOTYPE_JS-->");
  if (jsMarkerIdx === -1) die("в shell нет ни <!--ROUTES_SCRIPT-->, ни <!--PROTOTYPE_JS--> - shell сломан");
  const scriptOpenIdx = html.lastIndexOf("<script", jsMarkerIdx);
  if (scriptOpenIdx === -1) die("маркер <!--PROTOTYPE_JS--> вне <script> - shell сломан");
  console.warn(`${TAG} в shell нет маркера <!--ROUTES_SCRIPT--> - PT_ROUTES вставлен перед prototype.js`);
  html = html.slice(0, scriptOpenIdx) + routesScriptTag + "\n  " + html.slice(scriptOpenIdx);
}
html = html.split("<!--PROTOTYPE_JS-->").join(prototypeJs);

// ---------- финальные пост-проходы по ВСЕМУ документу (ADR-039) ----------
// буква е-с-точками запрещена в клиентских текстах (как и тире) - нормализуем по всей
// собранной строке перед записью: любой render.html или служебный текст ассемблера
// способен ее вернуть, и verify-prototype v2 будет краснеть на ровном месте.
html = normYoFinal(html);

// висячие предлоги прибиваются КОДОМ, а не руками: render.html и тексты писателей
// держим чистыми (никаких &nbsp; в контентных файлах), неразрывные пробелы расставляем
// здесь, на итоговом документе (включая стартовую страницу и плашки). Идет ПОСЛЕ
// нормализации е-с-точками (иначе список служебных слов пришлось бы держать в двух
// написаниях) и ДО записи файла.
html = bindHanging(html);

writeFileSync(outPath, html, "utf8");

// ---------- summary ----------
console.log(`${TAG} wrote ${outPath}`);
console.log(`  pages: ${pages.length} (+ стартовый список __index): ${pages.map((p) => p.slug).join(", ")}`);
console.log(`  main_slug: ${mainSlug}`);
console.log(`  start: ${startRoute}`);
console.log(`  theme: wireframe`);
if (legalInfo.phoneMissing) console.log(`  телефон: заглушка ${PHONE_PLACEHOLDER} - legal.phone не заполнен`);
console.log(`  size: ${(Buffer.byteLength(html, "utf8") / 1024).toFixed(1)} KB`);
