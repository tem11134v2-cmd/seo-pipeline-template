#!/usr/bin/env node
// verify-build.mjs
// Проверка СОБРАННОГО site.html. Последний рубеж конвейера: страницу по отдельности уже
// смотрел verify-page.mjs, тут проверяется то, что видно только на собранном документе.
//
// Шесть правил, и седьмого нет:
//   blocks   - каждый блок плана либо собран, либо объявлен в журнале исключений;
//   tainted  - чисел, снятых у лидеров, в документе нет;
//   marker   - неподставленных маркеров и заготовок не осталось;
//   dup_id   - id в документе не повторяются;
//   typo     - дефис и е без точек;
//   tail     - служебного хвоста страницы в документе нет.
//
// Три вещи, которые тут важнее кода:
//   1. ОБЪЯСНЕНИЕ ЖИВЕТ В ЖУРНАЛЕ. Хвост страницы в верстку не попадает по построению,
//      поэтому «блока нет» объясняет только запись queue.json с непустым основанием.
//      Снятый блок без основания - находка, а не решение.
//   2. ЯДОВИТЫЕ ЧИСЛА ГРЕПАЮТСЯ ЦЕЛИКОМ ПО ДОКУМЕНТУ. Разбор каждого числа делает
//      verify-page на своей странице; тут идет финальный проход по всему собранному:
//      цифра лидера могла приехать в метатег, в меню или в таблицу.
//   3. СЧЕТ ИДЕТ ПО ВИДИМОМУ ТЕКСТУ. Скрипт, стиль и теги маскируются пробелами, а не
//      вырезаются: номера строк остаются настоящими, и находку можно открыть в файле.
//
// Использование:
//   node verify-build.mjs [<слаг|каталог|файл.html>] [--json] [--root <репо>]
//
// Exit: 0 чисто | 1 есть нарушения | 2 проверять нечего.

import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { arr, str, readPages, BAD_TYPO, TYPO_NAME, pageName } from "./_contract.mjs";
import { repoRoot, findDir, isProjectDir, readQueue } from "./queue.mjs";
import { buildContext } from "./verify-page.mjs";

const die = (msg) => { console.error("[verify-build] " + msg); process.exit(2); };
const chars = (s) => Array.from(String(s == null ? "" : s)).length;
const loadJson = (f) => { try { return existsSync(f) ? JSON.parse(readFileSync(f, "utf8").replace(/^﻿/, "")) : null; } catch { return null; } };

export const RULES = [
  ["blocks", "каждый блок плана собран либо объявлен в журнале исключений"],
  ["tainted", "чисел, снятых у лидеров, в документе нет"],
  ["marker", "неподставленных маркеров и заготовок не осталось"],
  ["dup_id", "id в документе не повторяются"],
  ["typo", "типографика: дефис и е без точек"],
  ["tail", "служебного хвоста страницы в документе нет"],
  // Два правила про ЛЕСТНИЦУ, а не про текст. Без них круг усиления и повторная проверка
  // существуют только в описании: в v7 после писателя работали лишь те, кто убавляет, и
  // ровно так же тут шаг 10 выпадал бы из прогона, а дописанное усилителем не проверял бы
  // никто - усилитель пишет новый текст ПОСЛЕ единственной проверки страницы.
  ["lift", "круг усиления пройден: lift.json есть и не старше самой свежей страницы"],
  ["checked", "после последней правки страницы прогонялся verify-page: verify.json есть и не старше страниц"]
];

// Самая свежая страница проекта. Отметка времени - единственный способ увидеть, что текст
// трогали после проверки: своего состояния у конвейера нет, оно выводится из содержимого.
function newestPage(dir) {
  const pdir = join(dir, "pages");
  if (!existsSync(pdir)) return 0;
  let t = 0;
  for (const n of readdirSync(pdir).filter((x) => x.endsWith(".md"))) {
    try { t = Math.max(t, statSync(join(pdir, n)).mtimeMs); } catch { /* пропал файл - пропала и отметка */ }
  }
  return t;
}
const freshness = (dir, name) => {
  const f = join(dir, name);
  if (!existsSync(f)) return "нет";
  try { return statSync(f).mtimeMs + 1000 < newestPage(dir) ? "старше" : ""; } catch { return ""; }
};

// ---------------------------------------------------------------- разбор документа
// Маскировка вместо вырезания: длина файла не меняется, поэтому индекс находки всегда
// переводится в настоящий номер строки собранного файла.
export function mask(raw) {
  const s = raw.split("");
  const blank = (from, to) => { for (let i = from; i < to && i < s.length; i++) if (s[i] !== "\n") s[i] = " "; };
  for (const m of raw.matchAll(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi)) blank(m.index, m.index + m[0].length);
  for (const m of raw.matchAll(/<!--[\s\S]*?-->|<[^>]+>/g)) blank(m.index, m.index + m[0].length);
  return s.join("");
}

export function lineIndex(raw) {
  const starts = [0];
  for (let i = 0; i < raw.length; i++) if (raw[i] === "\n") starts.push(i + 1);
  return (idx) => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= idx) lo = mid; else hi = mid - 1; }
    return lo + 1;
  };
}

// Страницы собранного документа: кусок от одной секции page до следующей. Вложенные
// секции блоков такому разбору не мешают, а регулярное выражение на пару тегов - мешали бы.
export function sectionsOf(raw) {
  const marks = [...raw.matchAll(/<section class="page"[^>]*data-page="([^"]*)"[^>]*>/g)];
  return marks.map((m, i) => {
    const start = m.index;
    const end = i + 1 < marks.length ? marks[i + 1].index : raw.length;
    const body = raw.slice(start, end);
    return {
      url: m[1], start, end,
      blocks: new Set([...body.matchAll(/data-block="([^"]*)"/g)].map((x) => x[1]).filter(Boolean)),
      fallback: [...body.matchAll(/data-block="([^"]*)"[^>]*data-fallback/g)].map((x) => x[1])
    };
  });
}

const cut = (text, idx, len, pad = 28) => {
  const from = Math.max(0, idx - pad), to = Math.min(text.length, idx + len + pad);
  return (from > 0 ? "..." : "") + text.slice(from, to).replace(/\s+/g, " ").trim() + (to < text.length ? "..." : "");
};

// ---------------------------------------------------------------- числа
// Тонкий разбор числа (факт, арифметика на лету, смягчитель) живет в verify-page и по
// странице. Тут финальный греп: нормализуем найденное так же, как нормализован список
// ядовитых чисел, и смотрим на совпадение. Свое число сильнее: buildContext уже вычел из
// списка все, что есть в фактах и реквизитах заказчика.
const RX_NUM = /(?<![0-9а-яa-zA-ZА-Я])(\d[\d  .,]*\d|\d)/g;
const norm = (t) => String(t).replace(/[\s ]/g, "").replace(/,/g, ".").replace(/[.,]+$/, "");
const forms = (t) => { const a = norm(t), b = String(t).replace(/\D/g, ""); return b && b !== a ? [a, b] : [a]; };

// ---------------------------------------------------------------- журнал
// Одна запись на одно отступление, и лежит она там же, где все отступления конвейера.
export function journalOf(dir) {
  if (!isProjectDir(dir)) return [];
  try { return arr(readQueue(dir).journal); } catch { return []; }
}
export const explained = (journal, name, id) => journal.some((e) => {
  const s = str(e.subject);
  return s.includes(name) && new RegExp("блок\\s+" + id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![a-z0-9_])").test(s) && str(e.ground);
});

// ---------------------------------------------------------------- правила
const CHECKS = {
  // Блок плана есть в своей странице, либо запись журнала называет страницу, блок и
  // основание. Третьего исхода нет: молча исчезнувший блок - это потерянный ответ.
  blocks: (D, hit) => {
    if (!D.plan) return;
    for (const p of arr(D.plan.pages)) {
      const url = str(p.page && p.page.url);
      const sec = D.sections.find((s) => s.url === url);
      if (!sec) {
        hit({ block: url || "?", line: 1 }, "страница плана в сборке не найдена, ее блоки не проверены", url);
        continue;
      }
      const name = D.nameOf(p.page);
      const line = D.lineOf(sec.start);
      for (const b of arr(p.blocks).filter((x) => x.ord).sort((a, z) => a.ord - z.ord)) {
        if (sec.blocks.has(b.id)) continue;
        if (explained(D.journal, name, b.id)) continue;
        hit({ block: url + " " + b.id, line }, "блок плана (место " + b.ord + ", режим " + str(b.mode) + ") не собран, а записи в журнале исключений с непустым основанием по нему нет", "");
      }
    }
  },

  tainted: (D, hit) => {
    if (!D.C || !D.C.tainted.size) return;
    for (const m of D.vis.matchAll(RX_NUM)) {
      if (!forms(m[1]).some((f) => D.C.tainted.has(f))) continue;
      hit({ block: D.pageAt(m.index), line: D.lineOf(m.index) }, "«" + m[1] + "» - это число снято у лидеров: форму и состав с рынка берем, цифры никогда", cut(D.vis, m.index, m[1].length), norm(m[1]));
    }
  },

  marker: (D, hit) => {
    // Флага i тут нет намеренно: с ним «[А-Я]» ловит и строчные, и любая фраза в скобках
    // становится маркером. Регистр разрешен только там, где он ничего не ломает.
    const RX = /\{\{[^}\n]{0,60}\}\}|\$\{[^}\n]{0,40}\}|\[ЗАПОЛНИТЬ[^\]\n]{0,40}\]|\[[А-Я][А-Я ]{3,40}\]|<!--[\s\S]{0,120}?-->|(?<![a-zA-Z])(?:TODO|FIXME|[Ll]orem ipsum)(?![a-zA-Z])/g;
    for (const m of D.raw.matchAll(RX)) {
      hit({ block: D.pageAt(m.index), line: D.lineOf(m.index) }, "неподставленный маркер «" + m[0].replace(/\s+/g, " ").slice(0, 40) + "»: в собранном документе его быть не может", cut(D.raw, m.index, m[0].length), m[0].replace(/\s+/g, " "));
    }
  },

  dup_id: (D, hit) => {
    const seen = new Map();
    for (const m of D.raw.matchAll(/\sid="([^"]+)"/g)) {
      const id = m[1];
      if (!seen.has(id)) { seen.set(id, m.index); continue; }
      hit({ block: D.pageAt(m.index), line: D.lineOf(m.index) }, "id «" + id + "» уже занят строкой " + D.lineOf(seen.get(id)) + ": роутер и якоря меню уводят не туда", cut(D.raw, m.index, m[0].length));
    }
  },

  typo: (D, hit) => {
    for (const m of D.raw.matchAll(BAD_TYPO)) {
      hit({ block: D.pageAt(m.index), line: D.lineOf(m.index) }, (TYPO_NAME[m[0]] || m[0]) + " - в проекте дефис и е без точек", cut(D.raw, m.index, 1), m[0]);
    }
  },

  // Служебный хвост адресован конвейеру, а не читателю. Попал в документ - значит сборка
  // взяла страницу целиком, и заказчик читает переписку машин.
  lift: (D, hit) => {
    const st = freshness(D.dir, "lift.json");
    if (st === "нет") hit({ block: "документ", line: 1 }, "нет lift.json: круг усиления не проходили, и после письма работал только тот, кто убавляет");
    else if (st === "старше") hit({ block: "документ", line: 1 }, "lift.json старше самой свежей страницы: после последней правки усиление не считали");
  },

  checked: (D, hit) => {
    const st = freshness(D.dir, "verify.json");
    if (st === "нет") hit({ block: "документ", line: 1 }, "нет verify.json: verify-page по этим страницам целиком не прогоняли");
    else if (st === "старше") hit({ block: "документ", line: 1 }, "verify.json старше самой свежей страницы: текст, дописанный после проверки, не проверял никто");
  },

  tail: (D, hit) => {
    const RX = /(^|\n)[ \t]*(мысль|снят|слито|недостает|канон):/g;
    for (const m of D.vis.matchAll(RX)) {
      const idx = m.index + m[1].length;
      hit({ block: D.pageAt(idx), line: D.lineOf(idx) }, "строка служебного хвоста «" + m[2] + ":» в собранном документе", cut(D.vis, idx, m[0].length));
    }
  }
};

// ---------------------------------------------------------------- прогон
export function verifyBuild(file, dir, root) {
  const raw = readFileSync(file, "utf8").replace(/^﻿/, "");
  const vis = mask(raw);
  const sections = sectionsOf(raw);
  const lineOf = lineIndex(raw);
  const plan = loadJson(join(dir, "plan.json"));
  const yml = readPages(join(root, ".claude/skills/site-proto/pages.yml"));
  const C = existsSync(join(dir, "project.json")) && yml ? buildContext(dir, yml) : null;

  const taken = new Set();
  const names = new Map();
  for (const p of arr(plan && plan.pages)) {
    const page = p.page || {};
    names.set(str(page.url), pageName(page, taken));
  }

  const pageAt = (idx) => {
    for (const s of sections) if (idx >= s.start && idx < s.end) return s.url || "карта";
    return "документ";
  };
  const D = {
    raw, vis, sections, lineOf, plan, C, file, dir,
    journal: journalOf(dir), pageAt, nameOf: (page) => names.get(str(page.url)) || pageName(page)
  };

  // Одна и та же цифра приезжает в H1, в меню, в карту и в метатег: собранный документ
  // повторяет текст страницы по построению. Находка остается АДРЕСНОЙ - первое место, -
  // но не размножается: пять строк про одно число читаются как шум, а шум не читают.
  const found = [], byKey = new Map();
  for (const [id] of RULES) {
    const hit = (at, msg, frag, key) => {
      const f = { id, at, msg, frag: frag ? String(frag).replace(/\s+/g, " ").trim() : "", n: 1 };
      if (key === undefined) { found.push(f); return; }
      const k = id + "|" + key;
      const was = byKey.get(k);
      // Адрес находки - место НА СТРАНИЦЕ, а не в карте и не в метатеге: карта и меню
      // собраны из того же текста, и править там нечего.
      if (was) {
        was.n++;
        const derived = (x) => x === "карта" || x === "документ";
        if (derived(was.at.block) && !derived(at.block)) { was.at = at; was.frag = f.frag; }
        return;
      }
      byKey.set(k, f);
      found.push(f);
    };
    CHECKS[id](D, hit);
  }
  return { D, found };
}

// Реестр и код расходиться не умеют: правило без проверки не проверялось бы молча.
export function crosscheck() {
  const ids = RULES.map(([id]) => id);
  const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
  if (dup.length) return "правило объявлено дважды: " + [...new Set(dup)].join(", ");
  const noCheck = ids.filter((id) => !CHECKS[id]);
  if (noCheck.length) return "в списке есть правило, а проверки нет: " + noCheck.join(", ");
  const noRule = Object.keys(CHECKS).filter((id) => !ids.includes(id));
  if (noRule.length) return "проверка есть, а правила в списке нет: " + noRule.join(", ");
  return "";
}

function parseArgs(argv) {
  const flags = {}, pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const nx = argv[i + 1];
      if (nx === undefined || nx.startsWith("--")) flags[a.slice(2)] = true;
      else { flags[a.slice(2)] = nx; i++; }
    } else pos.push(a);
  }
  return { flags, pos };
}

function projectOf(p) {
  let d = statSync(p).isDirectory() ? resolve(p) : dirname(resolve(p));
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(d, "project.json")) || existsSync(join(d, "queue.json"))) return d;
    const up = resolve(d, ".."); if (up === d) break; d = up;
  }
  return null;
}

function main() {
  const { flags, pos } = parseArgs(process.argv.slice(2));
  const root = flags.root && flags.root !== true ? resolve(String(flags.root)) : repoRoot();
  const bad = crosscheck();
  if (bad) die(bad);

  let file = "", dir = null;
  const target = pos[0];
  if (target && /\.html?$/i.test(target) && existsSync(resolve(target))) { file = resolve(target); dir = projectOf(file); }
  else {
    dir = findDir(target, root);
    if (!dir) die("проект не найден - укажи файл сборки, слаг или каталог проекта");
    file = join(dir, "site.html");
  }
  if (!dir) die("каталог проекта не найден рядом со сборкой");
  if (!existsSync(file)) die("нет " + file + " - сначала node .claude/scripts/site/assemble.mjs " + dir);

  const { D, found } = verifyBuild(file, dir, root);
  const fb = D.sections.reduce((n, s) => n + s.fallback.length, 0);

  if (flags.json) {
    console.log(JSON.stringify({
      v: 1, dir, file, pages: D.sections.filter((s) => s.url).map((s) => ({ url: s.url, blocks: [...s.blocks], fallback: s.fallback })),
      found: found.map((f) => ({ id: f.id, block: f.at.block, line: f.at.line, n: f.n, msg: f.msg, frag: f.frag }))
    }, null, 2));
    return found.length ? 1 : 0;
  }

  console.log("[verify-build] " + file + " | " + chars(D.raw) + " знаков | страниц " + D.sections.filter((s) => s.url).length + " | правил " + RULES.length);
  if (!D.plan) console.log("  плана нет: состав сверять не с чем, правило blocks молчит");
  if (!D.C) console.log("  контракта нет: список чисел лидеров пуст, правило tainted молчит");
  if (fb) console.log("  разделов встало по порядку (метка q: не опознана): " + fb);
  for (const f of found) {
    console.log("  ОТКАЗ " + f.id.padEnd(8) + " " + f.at.block + ", строка " + f.at.line + (f.n > 1 ? " [повторов " + (f.n - 1) + "]" : "") + ": " + f.msg);
    if (f.frag) console.log("           " + f.frag);
  }
  console.log("  итого нарушений: " + found.length);
  if (!found.length) console.log("  сборка чистая: можно отдавать на сдачу.");
  return found.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) process.exit(main());
