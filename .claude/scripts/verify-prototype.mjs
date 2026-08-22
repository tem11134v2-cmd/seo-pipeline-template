#!/usr/bin/env node
// verify-prototype.mjs v2 (ADR-039: прототип одним html-файлом)
// POST-FLIGHT проверка собранного одно-файлового прототипа сайта.
//
// Вход - texts_dir (корень задачи /seo-tekst):
//   texts_dir/prototype.html      - сборка assemble-prototype.mjs (весь сайт одним файлом)
//   texts_dir/site_manifest.json  - список страниц {slug,title,type,order}, start, main_slug
//   texts_dir/pages/<slug>/manifest.json - источник истины каждой страницы
//
// Два слоя проверок:
//   - глобальные (по документу): контракт передачи, стартовая секция, роутер PT_ROUTES,
//     дубли id, попапы/transition, тире и е-с-точками, телефон, header/footer/cookie;
//   - пер-страничные (по каждому manifest.json против его секции <section data-page>):
//     форма на секцию, стоп-формулы, pricing/листинг, лимиты, обязательные блоки типов.
//
// Использование:
//   node verify-prototype.mjs <texts_dir>
//
// Exit: 0 ok | 2 есть нарушения (печатает построчно) | 1 фатально (нет входных файлов).

import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ASSETS = resolve(dirname(fileURLToPath(import.meta.url)), "..", "skills", "seo-tekst", "assets");

const textsDir = process.argv[2] ? resolve(process.argv[2]) : null;
if (!textsDir) { console.error("[verify-prototype] usage: node verify-prototype.mjs <texts_dir>"); process.exit(1); }

const htmlPath = join(textsDir, "prototype.html");
const siteManifestPath = join(textsDir, "site_manifest.json");
if (!existsSync(htmlPath)) { console.error(`[verify-prototype] нет prototype.html в ${textsDir} (сборка - assemble-prototype.mjs)`); process.exit(1); }
if (!existsSync(siteManifestPath)) { console.error(`[verify-prototype] нет site_manifest.json в ${textsDir} - без него неизвестен состав страниц`); process.exit(1); }

const html = readFileSync(htmlPath, "utf8");

// site_manifest - входной контракт всей проверки: битый или пустой означает, что проверять
// нечего и НЕЧЕМ (неизвестен даже список секций), поэтому фатально, а не нарушение.
let siteManifest;
try { siteManifest = JSON.parse(readFileSync(siteManifestPath, "utf8").replace(/^﻿/, "")); }
catch (e) { console.error(`[verify-prototype] site_manifest.json не разобран: ${e && e.message ? e.message : e}`); process.exit(1); }
const sitePages = (Array.isArray(siteManifest.pages) ? siteManifest.pages : [])
  .filter((p) => p && typeof p.slug === "string" && p.slug.trim())
  .sort((a, b) => (a.order || 0) - (b.order || 0));
if (!sitePages.length) { console.error("[verify-prototype] site_manifest.pages пуст - нет страниц для проверки"); process.exit(1); }

const violations = [];
const warnings = [];
const V = (m) => violations.push(m);
const W = (m) => warnings.push(m);

// ---------- хелперы ----------
const countIn = (str, re) => (str.match(re) || []).length;
const countMatch = (re) => countIn(html, re);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Вырезает содержимое секции <section ... data-page="slug" ...> с учетом ВЛОЖЕННЫХ
// <section> (фрагменты кита сами секции), поэтому простой lazy-regexp до </section>
// обрезал бы страницу на первом же блоке.
function extractSection(doc, slug) {
  const openRe = new RegExp(`<section\\b[^>]*data-page="${escapeRe(slug)}"[^>]*>`, "i");
  const m = openRe.exec(doc);
  if (!m) return null;
  const start = m.index + m[0].length;
  const scanner = /<section\b|<\/section\s*>/gi;
  scanner.lastIndex = start;
  let depth = 1;
  let mm;
  while ((mm = scanner.exec(doc)) !== null) {
    if (mm[0].startsWith("</")) {
      depth--;
      if (depth === 0) return { openTag: m[0], inner: doc.slice(start, mm.index) };
    } else depth++;
  }
  return { openTag: m[0], inner: doc.slice(start) }; // незакрытая секция - поймается дальше
}

// ---------- загрузка manifest.json каждой страницы ----------
// Битый manifest нельзя глотать молча: раньше `catch {}` превращал его в пустой объект,
// контентные проверки становились беспредметными, и скрипт рапортовал OK по файлу,
// который никто не проверил. Здесь битый = нарушение по конкретной странице.
const pageManifests = new Map(); // slug -> {manifest, broken}
for (const p of sitePages) {
  const mp = join(textsDir, "pages", p.slug, "manifest.json");
  if (!existsSync(mp)) { pageManifests.set(p.slug, { manifest: {}, broken: "файла нет" }); continue; }
  try { pageManifests.set(p.slug, { manifest: JSON.parse(readFileSync(mp, "utf8").replace(/^﻿/, "")), broken: null }); }
  catch (e) { pageManifests.set(p.slug, { manifest: {}, broken: e && e.message ? e.message : String(e) }); }
}

// Главная страница документа: legal/титул/мета документа ассемблер берет из ее манифеста.
const mainSlug = sitePages.some((p) => p.slug === siteManifest.main_slug)
  ? siteManifest.main_slug
  : sitePages[0].slug;
const mainManifest = (pageManifests.get(mainSlug) || { manifest: {} }).manifest;

// ---------- глобальные инварианты (документ) ----------

// shell v2: ровно один header/footer/cookie-баннер на документ. Ноль - shell не отработал,
// больше одного - в render.html утек кусок shell (render обязан быть блоками без shell).
const headerCount = countMatch(/<header[\s>]/gi);
if (headerCount === 0) V("нет <header>");
else if (headerCount > 1) V(`<header> ${headerCount} - шапка одна на документ (в render.html утек shell?)`);
const footerCount = countMatch(/<footer[\s>]/gi);
if (footerCount === 0) V("нет <footer> (реквизиты - блокер модерации Директа/VK)");
else if (footerCount > 1) V(`<footer> ${footerCount} - футер один на документ`);
const cookieCount = countMatch(/id="cookieBanner"/g);
if (cookieCount === 0) V("нет cookie-баннера (#cookieBanner)");
else if (cookieCount > 1) V(`cookie-баннеров ${cookieCount} - один на документ`);
if (!/id="(privacyPage|personDataPage|cookiePage)"/.test(html)) W("нет юр-страниц (privacy/consent/cookie)");
if (!/<main[^>]*id="ptPages"/i.test(html)) V('нет <main id="ptPages"> - документ собран не ассемблером v2');

// Требуем именно НЕПУСТОЙ tel: - пустой href="tel:" (нет legal.phone) прежний регексп
// пропускал, и мертвая ссылка уезжала в футере заказчику.
if (!/href="tel:\+?\d/.test(html)) V("нет кликабельного телефона (tel: пуст или отсутствует)");
if (/href="tel:"/.test(html)) V("пустая tel-ссылка (href=\"tel:\") - телефон не подставился");
// Заглушка-маска - штатный выход ассемблера при незаполненном legal.phone (KIT-SPEC §2):
// ссылка живая, номер заведомо нерабочий. Это не брак сборки, а незакрытый реквизит,
// поэтому предупреждение, а не нарушение - но молчать нельзя, иначе маска уедет в отдачу.
if (/\+7\s*\(000\)\s*000-00-00/.test(html))
  W("телефон-заглушка +7 (000) 000-00-00 (legal.phone не заполнен) - заменить перед отдачей заказчику");

// Контракт передачи (KIT-SPEC §6.1) - по ОДНОМУ на документ, вставляет ассемблер.
if (!/<meta\s+name=["']prototype-contract["']/i.test(html))
  V('нет машинного маркера контракта (<meta name="prototype-contract" content="content-map-not-layout">) - прототип прочитают как макет');
const plaques = countMatch(/class="[^"]*\bpt-contract\b[^"]*"/g);
if (plaques === 0 && !/data-prototype-contract/.test(html))
  V("нет видимой плашки контракта (.pt-contract первым в <body>) - заказчик увидит ч/б каркас без предупреждения");
else if (plaques > 1)
  V(`плашек контракта .pt-contract: ${plaques} - должна быть ровно одна на документ (вставляет ассемблер, не render.html)`);
else if (!/<body[^>]*>\s*(?:<!--[\s\S]*?-->\s*)*<[^>]*\bpt-contract\b/.test(html))
  W("плашка контракта не первым элементом <body> (KIT-SPEC §6.1 - до шапки)");
// Окно предсканирования кодировки у браузеров - первые 1024 байта документа. Комментарий-
// контракт длиннее, поэтому обязан стоять ПОСЛЕ <meta charset>; если charset вытолкнут
// за окно - кириллика ВСЕХ прототипов поедет заказчику кракозябрами.
const charsetMatch = /<meta\s+charset[^>]*>/i.exec(html);
if (!charsetMatch) V("нет <meta charset> - кодировка документа не объявлена");
else if (Buffer.byteLength(html.slice(0, charsetMatch.index + charsetMatch[0].length), "utf8") > 1024)
  V("<meta charset> за пределами первых 1024 байт (окно предсканирования браузера) - комментарий-контракт стоит выше charset, кириллица поедет кракозябрами");
// Служебных комментариев в <head> хватает (подстановки кита), поэтому ищем именно
// контрактный: по слову «прототип» кириллицей (латинский PROTOTYPE_CSS не в счет).
const headHtml = (html.match(/<head[^>]*>([\s\S]*?)<\/head>/i) || [, ""])[1];
if (!(headHtml.match(/<!--[\s\S]*?-->/g) || []).some((c) => /прототип/i.test(c)))
  W("нет комментария-контракта в <head> (KIT-SPEC §6.1 - адресат: тот, кто откроет исходник)");

// Стартовая секция __index: список всех страниц, открывается по умолчанию.
const indexSec = extractSection(html, "__index");
if (!indexSec) V('нет стартовой секции <section class="pt-page pt-index" data-page="__index"> - документ без оглавления');
else {
  for (const p of sitePages)
    if (!indexSec.inner.includes(`href="#p/${p.slug}"`))
      V(`стартовая секция без ссылки на страницу "${p.slug}" (href="#p/${p.slug}")`);
}

// Секция на каждую страницу site_manifest. Кроме стартовой все секции изначально hidden
// (роутер показывает одну за раз) - отсутствие hidden даст «простыню» из всех страниц.
const sections = new Map(); // slug -> {openTag, inner} | null
for (const p of sitePages) {
  const sec = extractSection(html, p.slug);
  sections.set(p.slug, sec);
  if (!sec) V(`нет секции страницы <section data-page="${p.slug}"> - страница из site_manifest не попала в документ`);
  else if (!/\bhidden\b/.test(sec.openTag)) W(`секция "${p.slug}" без атрибута hidden - до старта роутера покажутся все страницы разом`);
}

// Роутер: ассемблер вставляет <script>window.PT_ROUTES = {...}</script> перед prototype.js.
const routesMatch = html.match(/window\.PT_ROUTES\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/);
if (!routesMatch) V("нет PT_ROUTES-скрипта (window.PT_ROUTES перед prototype.js) - роутер не знает страниц");
else {
  let routes = null;
  try { routes = JSON.parse(routesMatch[1]); }
  catch (e) { V(`PT_ROUTES не разобран (${e && e.message ? e.message : e})`); }
  if (routes) {
    const routeSlugs = new Set((Array.isArray(routes.pages) ? routes.pages : []).map((p) => p && p.slug).filter(Boolean));
    for (const p of sitePages)
      if (!routeSlugs.has(p.slug)) V(`PT_ROUTES не покрывает страницу "${p.slug}" - секция недостижима из роутера`);
    for (const s of routeSlugs)
      if (!sitePages.some((p) => p.slug === s)) W(`PT_ROUTES знает страницу "${s}", которой нет в site_manifest`);
    const start = siteManifest.start || "__index";
    if (routes.start !== start) W(`PT_ROUTES.start="${routes.start}" не совпадает со start site_manifest ("${start}")`);
  }
}

// Голые дубли id ломают якорную навигацию и label for: неймспейс <slug>__ обязан делать
// все id документа уникальными (сервисные privacy/person-data-consent/cookie/thanks -
// по одному на документ, им префикс не положен).
const idCounts = new Map();
for (const m of html.matchAll(/\bid="([^"]+)"/g)) idCounts.set(m[1], (idCounts.get(m[1]) || 0) + 1);
const dupes = [...idCounts].filter(([, c]) => c > 1);
if (dupes.length)
  V(`дубли id (неймспейс секций не отработал): ${dupes.slice(0, 6).map(([i, c]) => `${i} x${c}`).join(", ")}${dupes.length > 6 ? ` и еще ${dupes.length - 6}` : ""}`);

// Попапы и анимации удалены полностью (ADR-039). Нашлись - сборка шла старым shell/css.
if (/id="popup(Time|Exit)"/.test(html)) V("найдены попапы (#popupTime/#popupExit) - в v2 удалены полностью (ADR-039), собрано старым shell");
let cssTransitions = 0;
for (const m of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi))
  cssTransitions += countIn(m[1], /\btransition[a-z-]*\s*:/gi);
if (cssTransitions) V(`transition в инлайн-CSS: ${cssTransitions} - анимации удалены (ADR-039); чинить prototype.css/тему кита, не собранный HTML`);

// Навигационные хвосты старого одностраничного контракта:
//   #lead    - CTA shell обязаны стать pt-shell-cta href="#", ссылки секций - #<slug>__lead;
//   #mainContent - возврат юр-страниц в v2 ведет на #__back (последняя активная секция).
const nakedLead = countMatch(/href="#lead"/g);
if (nakedLead) V(`голые href="#lead": ${nakedLead} - CTA shell должны быть pt-shell-cta href="#", ссылки внутри секций - #<slug>__lead`);
if (/href="#mainContent"/.test(html)) V('ссылки href="#mainContent" - возврат юр-страниц в v2 ведет на #__back');
if (!/id="ptBackbar"/.test(html)) W("нет плашки возврата #ptBackbar (shell v2) - с внутренних страниц не вернуться к списку");
if (!/\bpt-shell-cta\b/.test(html)) W("нет ни одного pt-shell-cta - CTA шапки/бургера/мобильной панели не переведены на форму активной секции");

// фреймворки / запрещенное
const fw = [];
if (/\b(class|className)="[^"]*\b(react|jsx)\b/i.test(html)) fw.push("react");
if (/\sv-(if|for|bind|model|on)[=:]/.test(html)) fw.push("vue");
if (/\sng-[a-z]+=/.test(html)) fw.push("angular");
if (/\bdata-tilda/i.test(html)) fw.push("tilda-runtime");
if (/cdn\.|googleapis\.com\/css|unpkg\.com|jsdelivr/i.test(html)) fw.push("external-cdn");
if (fw.length) V(`найдены фреймворк/внешние зависимости: ${fw.join(", ")} (нужен чистый HTML/CSS/JS)`);

// длинное/среднее тире в видимом тексте
const dashes = countMatch(/—|–/g);
if (dashes > 0) V(`длинное/среднее тире (— –): ${dashes} (только дефис -)`);

// Буква е-с-точками запрещена, но на выходе штатной сборки ее быть не может:
// assemble-prototype.mjs прогоняет normYoFinal по итоговому документу перед записью.
// Поэтому здесь это не «почини текст», а канарейка на сам ассемблер: сработало - значит
// нормализация не отработала (файл собран в обход assemble-prototype.mjs или шаг выпилен).
const yos = countMatch(/[ёЁ]/g);
if (yos > 0) V(`буква е-с-точками: ${yos} - нормализация не отработала (assemble-prototype.mjs, normYoFinal): пересобери prototype.html, а не правь HTML руками`);

// Реквизиты, которых нет в SKILL-врезке про legal, но которые печатаются в футере,
// cookie-баннере и юр-страницах: без domain в подвале остается «© », без date -
// «Редакция от ». Документ-уровень, поэтому смотрим manifest ГЛАВНОЙ (main_slug).
const legalManifest = mainManifest.legal && typeof mainManifest.legal === "object" ? mainManifest.legal : null;
if (legalManifest) {
  for (const [field, where] of [["domain", "«© » в футере и в юр-страницах"], ["date", "«Редакция от » в футере"]])
    if (!String(legalManifest[field] || "").trim()) W(`legal.${field} пуст (manifest главной "${mainSlug}") - ${where} без значения`);
}

// Кит: закрытый список фрагментов (для пер-страничной проверки «фрагмент существует»).
const fragManifestPath = join(ASSETS, "fragments-manifest.json");
let knownFragments = null;
if (existsSync(fragManifestPath)) {
  try {
    const fm = JSON.parse(readFileSync(fragManifestPath, "utf8").replace(/^﻿/, ""));
    if (fm && fm.fragments && typeof fm.fragments === "object") knownFragments = new Set(Object.keys(fm.fragments));
  } catch {}
}

// ---------- пер-страничные проверки ----------
const STOP = [
  "индивидуальный подход", "широкий ассортимент", "команда профессионалов",
  "лидеры рынка", "высокое качество по доступным ценам", "многолетний опыт",
  "гарантируем результат", "опытные специалисты", "лучшие на рынке",
  "динамично развивающаяся", "гибкая система скидок", "не как у других",
];
function collectText(obj, acc = []) {
  if (obj == null) return acc;
  if (typeof obj === "string") { acc.push(obj); return acc; }
  if (Array.isArray(obj)) { for (const v of obj) collectText(v, acc); return acc; }
  if (typeof obj === "object") { for (const v of Object.values(obj)) collectText(v, acc); return acc; }
  return acc;
}

let fillCount = 0;
let totalBlocks = 0;

for (const p of sitePages) {
  const slug = p.slug;
  const tag = `[${slug}]`;
  const sec = sections.get(slug);

  // --- структурные инварианты секции ---
  if (sec) {
    // Ровно 1 форма захвата НА СЕКЦИЮ (id <slug>__leadForm). Pre-footer = микро-конверсия,
    // не дубль формы. Чекбокс-гейт prototype.js per-form, но id обязаны быть с префиксом.
    const lf = countIn(sec.inner, new RegExp(`id="${escapeRe(slug)}__leadForm"`, "g"));
    if (lf === 0) V(`${tag} нет формы захвата в секции (id ${slug}__leadForm) - правило: ровно 1 на секцию`);
    else if (lf > 1) V(`${tag} форм-захвата в секции ${lf} (правило: ровно 1 на секцию)`);
    if (!sec.inner.includes(`id="${slug}__f-agree"`)) V(`${tag} в форме нет чекбокса согласия ПДн (#${slug}__f-agree)`);
    if (!new RegExp(`id="${escapeRe(slug)}__f-submit"[^>]*disabled`).test(sec.inner))
      W(`${tag} submit формы не disabled по умолчанию (проверь чекбокс-гейт)`);
    // Неймспейс: ВСЕ id внутри секции обязаны нести префикс <slug>__ - голый id это
    // будущий дубль и битый href/label for при второй странице с тем же фрагментом.
    const naked = [];
    for (const m of sec.inner.matchAll(/\bid="([^"]+)"/g))
      if (!m[1].startsWith(`${slug}__`)) naked.push(m[1]);
    if (naked.length)
      V(`${tag} id без префикса ${slug}__ в секции: ${[...new Set(naked)].slice(0, 4).join(", ")}${naked.length > 4 ? " и еще" : ""} - неймспейс ассемблера не отработал`);
  }

  // --- контентные проверки (manifest страницы) ---
  const { manifest, broken } = pageManifests.get(slug);
  if (broken) { V(`${tag} pages/${slug}/manifest.json не разобран (${broken}) - контентные проверки страницы не выполнялись`); continue; }

  const blocks = Array.isArray(manifest.blocks) ? manifest.blocks : [];
  totalBlocks += blocks.length;
  const metaDescription = String((manifest.meta && manifest.meta.description) || "");
  const copyText = blocks.map((b) => collectText(b.slots).concat(b.h2 ? [b.h2] : []).join("  ")).concat(metaDescription ? [metaDescription] : []).join("\n").toLowerCase();

  for (const s of STOP) if (copyText.includes(s)) V(`${tag} стоп-формула в тексте: «${s}» (см. COPY-AUDIT.md П.5, таблица замен штампов - заменить на конкретику)`);

  // вложенные массивы строк: писатель мог склеить в строку - REPEAT отрендерил бы пусто
  for (const b of blocks) {
    const slots = b.slots || {};
    if (b.fragment === "pricing") {
      const tariffs = Array.isArray(slots.tariffs) ? slots.tariffs : [];
      let featuredCount = 0;
      for (const t of tariffs) {
        if (!t || typeof t !== "object") continue;
        if (!Array.isArray(t.features) || t.features.length === 0 || t.features.some((f) => typeof f !== "string"))
          V(`${tag} pricing: tariffs[].features тарифа «${t.name || "?"}» должен быть непустым массивом строк`);
        if ("featured" in t && typeof t.featured !== "boolean")
          V(`${tag} pricing: featured тарифа «${t.name || "?"}» не boolean (${JSON.stringify(t.featured)}) - строго true/false`);
        if (t.featured === true) featuredCount++;
      }
      // KIT-SPEC §2: выделенный тариф - ровно один (не «максимум»): без выделения блок
      // теряет якорь выбора, с двумя - выделение перестает быть выделением.
      if (tariffs.length && featuredCount !== 1)
        V(`${tag} pricing: featured=true у ${featuredCount} тарифов (должен быть ровно один, KIT-SPEC §2)`);
    }
    if (b.fragment === "product-listing") {
      const filters = Array.isArray(slots.filters) ? slots.filters : [];
      for (const f of filters) {
        if (!f || typeof f !== "object") continue;
        if (!Array.isArray(f.options) || f.options.length === 0 || f.options.some((o) => typeof o !== "string"))
          V(`${tag} product-listing: filters[].options фильтра «${f.name || "?"}» должен быть непустым массивом строк`);
      }
    }
  }

  // Объявленное обязано быть реализовано: fragment блока должен существовать в ките.
  // Это НАРУШЕНИЕ, а не предупреждение: сборщик при неизвестном имени молча берет фолбэк
  // `cards` и рендерит его слотами несуществующего фрагмента - блок, обещанный структурой,
  // исчезает без следа. Чинится в manifest.json одним словом (имя из fragments-manifest.json).
  if (knownFragments && knownFragments.size) {
    const unknown = new Map();
    blocks.forEach((b, i) => {
      const f = b && typeof b.fragment === "string" ? b.fragment.trim() : "";
      if (!f || knownFragments.has(f)) return;
      if (!unknown.has(f)) unknown.set(f, []);
      unknown.get(f).push(b.n || i + 1);
    });
    for (const [f, at] of unknown)
      V(`${tag} фрагмента «${f}» нет в ките (блок ${at.join(", ")}) - сборщик подставил фолбэк cards, блок уехал пустым. Возьми имя из fragments-manifest.json`);
  }

  // Обязательные блоки каталожных типов (ADR-039 п.3, типы из site_manifest.pages[].type):
  // Категория обязана нести product-listing с видимым фильтратором, Товар - product-gallery.
  const pageType = String(p.type || "").trim().toLowerCase();
  if (pageType === "категория") {
    const pl = blocks.find((b) => b && b.fragment === "product-listing");
    if (!pl) V(`${tag} тип Категория: нет обязательного блока product-listing (листинг и фильтратор обязаны быть видны, ADR-039)`);
    else if (!(pl.opts && pl.opts.filter)) V(`${tag} тип Категория: у product-listing нет opts.filter=true - фильтратор обязан быть виден (ADR-039)`);
  }
  if (pageType === "товар" && !blocks.some((b) => b && b.fragment === "product-gallery"))
    V(`${tag} тип Товар: нет обязательного блока product-gallery (ADR-039)`);

  // H1 присутствует и содержит маркер. h1 несет hero, а у типа Товар - product-gallery,
  // поэтому ищем по слоту, а не по имени фрагмента.
  const marker = (manifest.meta && manifest.meta.marker) || "";
  const h1owner = blocks.find((b) => b && b.slots && String(b.slots.h1 || "").trim());
  const h1 = h1owner ? String(h1owner.slots.h1) : "";
  if (!h1) W(`${tag} не нашел H1 (Hero/product-gallery без слота h1?)`);
  else if (marker && !h1.toLowerCase().includes(marker.toLowerCase().split(" ")[0]))
    W(`${tag} H1 не содержит маркер «${marker}» (желательно для релевантности)`);

  // мягкие бюджеты длины (предупреждения)
  // Машинная граница title одна: 70 (KIT-SPEC §2, целевые 60), и правится она у писателя
  // в page.json, а не на сборке - иначе <title> разойдется с Texts.docx.
  const metaTitle = String((manifest.meta && manifest.meta.title) || "");
  if (metaTitle.length > 70)
    W(`${tag} title ${metaTitle.length} симв - потолок 70, целевые 60 (KIT-SPEC §2). Править в page.json у писателя, не молча на сборке`);
  if (h1 && h1.length > 60) W(`${tag} H1 длинный (${h1.length} симв) - лимит 60 (COPY-AUDIT П.11 «Лимиты длины»)`);
  for (const b of blocks) {
    const h2 = b.h2 || (b.slots && b.slots.h2) || "";
    if (h2 && h2.length > 70) W(`${tag} H2 длинный (${h2.length} симв): «${h2.slice(0, 40)}...»`);
  }

  // fill-notes сводка
  for (const b of blocks) if (Array.isArray(b.fill_notes)) fillCount += b.fill_notes.length;
  fillCount += countIn(copyText, /\[заполнить/g);
}

// Страницы на диске, которых нет в site_manifest - в документ не попали, заказчик их не увидит.
const pagesRoot = join(textsDir, "pages");
if (existsSync(pagesRoot)) {
  try {
    for (const entry of readdirSync(pagesRoot)) {
      if (sitePages.some((p) => p.slug === entry)) continue;
      if (existsSync(join(pagesRoot, entry, "manifest.json")))
        W(`pages/${entry}/ есть на диске, но отсутствует в site_manifest.json - страница не попала в документ`);
    }
  } catch {}
}

// ---------- отчет ----------
const sizeKb = (statSync(htmlPath).size / 1024).toFixed(1);
console.log(`[verify-prototype] ${textsDir}  (${sizeKb} KB, страниц ${sitePages.length}, блоков суммарно ${totalBlocks})`);
if (warnings.length) { console.log("  предупреждения:"); for (const w of warnings) console.log("   ~ " + w); }
if (fillCount) console.log(`  [ЗАПОЛНИТЬ]-пометок для согласования: ${fillCount}`);

if (violations.length) {
  console.log("  НАРУШЕНИЯ:");
  for (const v of violations) console.log("   ! " + v);
  process.exit(2);
}
console.log("  OK - критичных нарушений нет.");
process.exit(0);
