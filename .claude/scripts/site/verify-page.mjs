#!/usr/bin/env node
// verify-page.mjs
// Машинная проверка написанной страницы /site proto: исполняет реестр
// .claude/skills/site-proto/rules.yml по pages/<slug>.md.
//
// Все, что ловится грепом, живет ЗДЕСЬ, а не в промте автора: место в промте дорогое и
// уходит на приемы и образцы, а числа, стоп-листы и лимиты машина проверяет дешевле и
// надежнее. В v7 было наоборот - 125 отдельных «не» на один образец во входе писателя.
//
// Четыре вещи, которые тут важнее кода:
//   1. РЕЕСТР ГЛАВНЕЕ КОДА. Список правил и их тяжесть читаются из rules.yml. Правило без
//      проверки и проверка без правила - отказ прогона (exit 2). Перенести правило из
//      block в warn можно одной строкой реестра, скрипт для этого не трогают.
//   2. НЕДОБОР ЗНАКОВ - ПРЕДУПРЕЖДЕНИЕ, А НЕ ОШИБКА. Верстка собирается под готовый текст,
//      а не текст под ячейку. Жестких лимитов ровно два вида: метатеги и интро категории.
//   3. ХВОСТ НЕ ПАРСИТСЯ НИКОГДА. Служебный хвост после последнего --- вырезается ДО всех
//      проверок. Боевой баг v7: валидатор вычитал число из пояснения и заблокировал живой
//      блок, а чинилось это вычищением чисел из пояснения.
//   4. НАХОДКА АДРЕСНАЯ. Блок, строка, найденный фрагмент. Находка, по которой нельзя
//      открыть место и посмотреть, - это шум, а шум перестают читать на третьей странице.
//
// Использование:
//   node verify-page.mjs <файл.md | слаг проекта | каталог проекта> [--json] [--root <репо>]
// Exit: 0 чисто | 1 есть блокирующие нарушения | 2 проверить нечем.

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname, basename } from "node:path";
import { arr, str, UNIT, readPages, BAD_TYPO, TYPO_NAME, pageName, today } from "./_contract.mjs";
import { repoRoot, findDir } from "./queue.mjs";

const die = (msg) => { console.error("[verify-page] " + msg); process.exit(2); };
const loadJson = (f) => { try { return existsSync(f) ? JSON.parse(readFileSync(f, "utf8").replace(/^﻿/, "")) : null; } catch { return null; } };
const chars = (s) => Array.from(String(s == null ? "" : s)).length;

// ---------------------------------------------------------------- реестр правил
// Разбор плоский и нарочно тупой: два раздела, строка «  id: "что проверяем"». Ничего
// сверх этого в реестре не бывает, и парсер, умеющий больше, развел бы реестр с кодом.
export const SECTIONS = ["block", "warn"];
export const RULES_MAX = 12;

export function readRules(p) {
  if (!existsSync(p)) return null;
  const raw = readFileSync(p, "utf8").replace(/^﻿/, "");
  const out = { block: new Map(), warn: new Map(), chars: chars(raw) };
  let section = null;
  for (const line of raw.split(/\r?\n/)) {
    if (/^\s*#/.test(line) || !line.trim()) continue;
    const head = line.match(/^([a-z_]+):\s*$/);
    if (head) { section = SECTIONS.includes(head[1]) ? head[1] : null; continue; }
    const row = line.match(/^ {2}([a-z][a-z0-9_]*):\s*"(.*)"\s*$/);
    if (row && section) out[section].set(row[1], row[2].trim());
  }
  return out;
}

// ---------------------------------------------------------------- разбор страницы
// Порядок разбора и есть защита от бага v7: сначала отрезается служебный хвост, потом
// метатеги, и только оставшееся считается клиентским текстом.
const RX_MARK = /^\s*<!--\s*q:([a-z0-9_]*)\s*(?:closes:\s*([a-z0-9.,]*))?\s*-->\s*$/i;
const RX_HEAD = /^(#{2,4})\s+(.*)$/;

export function parsePage(file) {
  const raw = readFileSync(file, "utf8").replace(/^﻿/, "");
  const lines = raw.split(/\r?\n/);
  const P = { file, slug: basename(file).replace(/\.md$/i, ""), raw, lines, meta: {}, metaLine: {}, sections: [], tail: [], h1: "", h1Line: 0 };

  // Метатеги: передняя врезка, если файл начинается с ---. Нет врезки - нет и метатегов,
  // правило жестких лимитов тогда молчит: это не дырка, а другой путь их сборки.
  let i = 0;
  if (str(lines[0]) === "---") {
    let j = 1;
    while (j < lines.length && str(lines[j]) !== "---") {
      const m = lines[j].match(/^([A-Za-z_]+):\s*(.*)$/);
      if (m) { P.meta[m[1].toLowerCase()] = m[2].trim(); P.metaLine[m[1].toLowerCase()] = j + 1; }
      j++;
    }
    if (j < lines.length) i = j + 1;
  }
  // Хвост: все после ПОСЛЕДНЕЙ строки ---. Проза хвоста не разбирается, машина читает
  // ровно две формы: «снят: <id> - причина» и «слито: <a>+<b>».
  let tailAt = -1;
  for (let k = lines.length - 1; k >= i; k--) if (str(lines[k]) === "---") { tailAt = k; break; }
  const bodyEnd = tailAt >= 0 ? tailAt : lines.length;
  P.hasTail = tailAt >= 0;
  P.bodyStart = i;
  P.bodyEnd = bodyEnd;
  P.tail = tailAt >= 0 ? lines.slice(tailAt + 1).map((s, n) => ({ n: tailAt + 2 + n, s })) : [];
  P.dropped = new Map();
  P.merged = new Set();
  P.needs = [];
  P.thought = "";
  for (const t of P.tail) {
    const s = t.s.trim();
    if (!s) continue;
    let m = /^снят:\s*([a-z0-9_]+)\s+-\s+(.+)$/i.exec(s);
    if (m) { P.dropped.set(m[1].toLowerCase(), m[2].trim()); continue; }
    m = /^слито:\s*([a-z0-9_]+)\s*\+\s*([a-z0-9_]+)\s*$/i.exec(s);
    if (m) { P.merged.add(m[1].toLowerCase()); P.merged.add(m[2].toLowerCase()); continue; }
    m = /^недостает:\s*(.+)$/i.exec(s);
    if (m) { P.needs.push(m[1].trim()); continue; }
    m = /^мысль:\s*(.+)$/i.exec(s);
    if (m && !P.thought) P.thought = m[1].trim();
  }

  // Тело: H1, затем разделы. Раздел открывает метка <!-- q:... --> либо подзаголовок без
  // метки: забытая метка дает предупреждение и позиционный фолбэк, но текст не теряет.
  let cur = null;
  const open = (qid, closes, n) => { cur = { qid: qid || "", closes: closes || [], line: n, head: "", lines: [] }; P.sections.push(cur); };
  for (let n = i; n < bodyEnd; n++) {
    const line = lines[n], num = n + 1;
    const mk = RX_MARK.exec(line);
    if (mk) { open((mk[1] || "").toLowerCase(), (mk[2] || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean), num); continue; }
    const h1 = /^#\s+(.+)$/.exec(line);
    if (h1 && !P.h1) { P.h1 = h1[1].trim(); P.h1Line = num; continue; }
    const hd = RX_HEAD.exec(line);
    if (hd) {
      if (cur && !cur.head && !cur.lines.some((l) => l.s.trim())) cur.head = hd[2].trim();
      else { open("", [], num); cur.head = hd[2].trim(); }
      cur.lines.push({ n: num, s: line });
      continue;
    }
    if (!cur) { if (!line.trim()) continue; open("", [], num); }
    cur.lines.push({ n: num, s: line });
  }
  for (const s of P.sections) {
    s.text = s.lines.map((l) => l.s).join("\n").trim();
    s.chars = chars(s.text);
  }
  P.sections = P.sections.filter((s) => s.text || s.head);
  return P;
}

// Разрешение id раздела: метка, если она известна pages.yml; иначе позиционный фолбэк по
// действующему составу плана. Опечатка в разметке не валит хороший текст - это закон.
function resolveIds(P, yml, planBlocks) {
  const active = planBlocks.filter((b) => b.ord).sort((a, b) => a.ord - b.ord).map((b) => b.id);
  P.sections.forEach((s, idx) => {
    s.known = Boolean(s.qid && yml.blocks.has(s.qid));
    s.id = s.known ? s.qid : (active[idx] || "");
    s.fallback = !s.known && Boolean(s.id);
    s.label = s.id || (s.qid ? "? " + s.qid : "раздел " + (idx + 1));
  });
  // Единицы текста: строка = адрес. Метки и хвост сюда не попадают по построению.
  P.units = [];
  if (P.h1) P.units.push({ at: { block: "H1", line: P.h1Line }, text: P.h1 });
  for (const key of ["title", "description"]) {
    if (P.meta[key]) P.units.push({ at: { block: "мета " + key, line: P.metaLine[key] }, text: P.meta[key] });
  }
  for (const s of P.sections) for (const l of s.lines) if (l.s.trim()) P.units.push({ at: { block: s.label, line: l.n }, text: l.s });
}

const addr = (at) => at.block + ", строка " + at.line;
function cut(text, idx, len, pad = 24) {
  const from = Math.max(0, idx - pad), to = Math.min(text.length, idx + len + pad);
  return (from > 0 ? "..." : "") + text.slice(from, to).replace(/\s+/g, " ").trim() + (to < text.length ? "..." : "");
}

// ---------------------------------------------------------------- числа
// Число ищется ДВУМЯ проходами и ни одним третьим: с единицей измерения («2 400 руб»,
// «21 день», «15%») и после слова-смягчителя («более 100», «от 5»). Голая цифра без
// единицы и без смягчителя не проверяется вовсе: «5 пунктов» и «3 шага» - это форма
// раздела, а не утверждение о мире, и блокировать их значило бы воевать с текстом.
const NUMBER = "(?<![0-9а-яa-zA-ZА-ЯЁ])(\\d[\\d\\u00a0 .,]*\\d|\\d)";
const RX_NUM = new RegExp(NUMBER, "g");
const RX_UNIT_NUM = new RegExp(NUMBER + "\\s*(?:[а-яё]{3,}\\s+)?(?:" + UNIT + ")", "gi");
const HEDGE_W = "около|порядка|примерно|почти|более|свыше|в районе|где-то|от|до";
const RX_HEDGE = new RegExp("(?<![а-яa-z])(" + HEDGE_W + ")\\s+" + NUMBER, "gi");
const RX_WORDY = /(?<![а-яa-z])(около|порядка|более|свыше|почти)\s+(сотн[а-яё]*|десятк[а-яё]*|тысяч[а-яё]*|полусотн[а-яё]*)/gi;

const numNorm = (t) => String(t).replace(/[\s ]/g, "").replace(/,/g, ".").replace(/[.,]+$/, "");
const numForms = (t) => { const a = numNorm(t), b = String(t).replace(/\D/g, ""); return b && b !== a ? [a, b] : [a]; };
// Два разных вида источника, и мешать их нельзя. Свободный текст (значение факта, зона
// выезда, строка must_say) отдает КАЖДОЕ свое число. Реквизит (телефон, ИНН, ОГРН) отдает
// только свою цифровую строку целиком: иначе код страны из «+7 (812)» разрешил бы на
// странице любую семерку, и «работаем 7 дней в неделю» прошло бы как подтвержденный факт.
function harvest(texts, requisites) {
  const set = new Set(), nums = [];
  for (const s of texts) {
    const text = String(s == null ? "" : s);
    if (!text) continue;
    for (const m of text.matchAll(RX_NUM)) {
      for (const f of numForms(m[1])) set.add(f);
      const v = Number(numNorm(m[1]));
      if (Number.isFinite(v) && v > 0 && nums.length < 80) nums.push(v);
    }
  }
  for (const s of requisites) {
    const digits = String(s == null ? "" : s).replace(/\D/g, "");
    if (digits.length >= 7) set.add(digits);
  }
  return { set, nums };
}

// Лестница счета на лету. Работает ТОЛЬКО по числу, которого и так нет в фактах, поэтому
// новых ложных срабатываний не добавляет: она лишь называет находку точнее, чем «числа нет
// в фактах», и автор видит, откуда машина вывела его арифметику.
const DERIV = [
  [12, "/", "годовое число поделено на 12"],
  [12, "*", "месячное число умножено на 12"],
  [30, "/", "месячное число поделено на 30"],
  [365, "/", "годовое число поделено на 365"],
  [100, "*", "доля переведена в проценты"],
  [100, "/", "проценты переведены в долю"],
  [1000, "/", "число поделено на 1000"],
  [1000, "*", "число умножено на 1000"]
];
const fmt = (v) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100));
// Допуск относительный и узкий: 0.5 процента. Абсолютный допуск в половину единицы давал
// совпадения на пустом месте (2011 поделить на 365 - это «5 лет»), и находка получала
// уверенное, но выдуманное объяснение. Не сошлось узко - правило молчит, а число все равно
// поймает num_off_facts: арифметика только НАЗЫВАЕТ находку точнее, новых не заводит.
const near = (v, p) => v > 0 && Math.abs(v - p) <= Math.max(0.005 * p, 0.001);
function derive(raw, C) {
  const p = Number(numNorm(raw));
  if (!Number.isFinite(p) || p < 3) return null;
  for (const a of C.okNum) for (const [k, op, how] of DERIV) {
    const v = op === "/" ? a / k : a * k;
    if (near(v, p)) return how + " (из " + fmt(a) + ")";
  }
  for (const a of C.okNum) for (const b of C.okNum) {
    if (b <= 0 || a === b) continue;
    const v = (a / b) * 100;
    if (v < 1000 && near(v, p)) return "процент от пары фактов (" + fmt(a) + " и " + fmt(b) + ")";
  }
  return null;
}
function classify(raw, C) {
  const forms = numForms(raw);
  if (forms.some((f) => C.ok.has(f))) return { kind: "ok" };
  if (forms.some((f) => C.tainted.has(f))) return { kind: "tainted" };
  const d = derive(raw, C);
  return d ? { kind: "arith", how: d } : { kind: "bad" };
}

// Один проход на четыре правила: число получает РОВНО ОДНУ находку, самую точную из
// возможных. Иначе одна цифра зажигала бы четыре строки отчета и адресность пропадала.
function numFindings(P, C) {
  if (P._nums) return P._nums;
  const out = [];
  for (const u of P.units) {
    const seen = new Set();
    const push = (rule, idx, raw, msg) => { if (seen.has(idx)) return; seen.add(idx); out.push({ rule, at: u.at, frag: cut(u.text, idx, String(raw).length), msg }); };
    for (const m of u.text.matchAll(RX_HEDGE)) {
      const raw = m[2], idx = m.index + m[0].length - String(raw).length;
      const c = classify(raw, C);
      if (c.kind === "ok") continue;
      if (c.kind === "tainted") push("tainted", idx, raw, "«" + m[1] + " " + raw + "» - это число снято у лидеров");
      else if (c.kind === "arith") push("arith", idx, raw, "«" + m[1] + " " + raw + "» - " + c.how);
      else push("hedge", idx, raw, "«" + m[1] + " " + raw + "» - подтвержденной цифры нет, фраза не пишется вовсе");
    }
    for (const m of u.text.matchAll(RX_UNIT_NUM)) {
      const raw = m[1], idx = m.index;
      const c = classify(raw, C);
      if (c.kind === "ok") continue;
      if (c.kind === "tainted") push("tainted", idx, raw, "«" + raw + "» - это число снято у лидеров: форму с рынка берем, цифру нет");
      else if (c.kind === "arith") push("arith", idx, raw, "«" + raw + "» - " + c.how);
      else push("num_off_facts", idx, raw, "«" + raw + "» - числа нет ни в facts[] с publish yes, ни в реквизитах заказчика");
    }
    for (const m of u.text.matchAll(RX_WORDY)) push("hedge", m.index, m[0], "«" + m[0] + "» - счета за этим нет вовсе, фраза не пишется");
  }
  P._nums = out;
  return out;
}

// ---------------------------------------------------------------- проверки
// id проверки = id правила в rules.yml. Расхождение реестра и этого объекта валит прогон.
const CTA_STOP = /^(?:отправить(?:\s+(?:заявку|сообщение|вопрос|форму|запрос))?|подробнее|узнать\s+больше|читать\s+далее|далее|перейти|submit|send|оставить\s+заявку|жми|кликни|нажми)$/i;
const RX_JARG = /(?<![а-яa-z])(сурга[йеюя][а-я]*|кастдев[а-я]*|customer\s+dev|jtbd|cjm|оффер[а-я]*|лид(?:ы|ов|ам|ами|ах|а|е|у)?|конверси[а-я]+)(?![а-яa-z])/gi;
const RX_QUOTE = /«([^»\n]{10,300})»|"([^"\n]{10,300})"/g;
const RX_LINK = /\[([^\]\n]{1,60})\]\(([^)\n]*)\)/g;
// Адрес страницы в тексте: markdown-ссылка отдельно, голый адрес отдельно. Голый ищется
// только в начале слова и только в виде /slug/ - так «2/3» и «руб./м2» не попадают.
const RX_MDLINK = /\[[^\]\n]{1,120}\]\((\/[^)\s]*)\)/g;
const RX_BAREURL = /(^|[\s(«"])(\/[a-z0-9][a-z0-9-]{2,}(?:\/[a-z0-9][a-z0-9-]{2,})*\/)/gi;
const CTA_IDS = ["cta_form", "cta_mid"];
const plainWords = (s) => String(s).toLowerCase().replace(/[^а-яa-z0-9ё ]+/gi, " ").replace(/\s+/g, " ").trim();

function buttons(P) {
  if (P._btn) return P._btn;
  const out = [];
  for (const u of P.units) {
    for (const m of u.text.matchAll(RX_LINK)) out.push({ at: u.at, label: m[1], idx: m.index, text: u.text });
    const m = /^\s*\*\*([^*\n]{1,50})\*\*\s*$/.exec(u.text) || /^\s*\[([^\]\n]{1,50})\]\s*$/.exec(u.text);
    if (m) out.push({ at: u.at, label: m[1], idx: Math.max(0, u.text.indexOf(m[1])), text: u.text });
  }
  P._btn = out;
  return out;
}

const CHECKS = {
  num_off_facts: (P, C, hit) => { for (const f of numFindings(P, C)) if (f.rule === "num_off_facts") hit(f.at, f.msg, f.frag); },
  arith: (P, C, hit) => { for (const f of numFindings(P, C)) if (f.rule === "arith") hit(f.at, f.msg, f.frag); },
  tainted: (P, C, hit) => { for (const f of numFindings(P, C)) if (f.rule === "tainted") hit(f.at, f.msg, f.frag); },
  hedge: (P, C, hit) => { for (const f of numFindings(P, C)) if (f.rule === "hedge") hit(f.at, f.msg, f.frag); },

  cta_stop: (P, C, hit) => {
    for (const b of buttons(P)) {
      const label = b.label.trim().replace(/[.!…]+$/, "").replace(/\s+/g, " ");
      if (CTA_STOP.test(label)) hit(b.at, "надпись «" + label + "» из стоп-листа: кнопка называет, что человек получит или что произойдет", cut(b.text, b.idx, b.label.length));
    }
  },

  jargon: (P, C, hit) => {
    for (const u of P.units) for (const m of u.text.matchAll(RX_JARG)) {
      const w = m[1].toLowerCase();
      // Отраслевое слово заказчика жаргоном не считается: словарь проекта старше стоп-листа.
      if (C.locked.some((l) => l.includes(w) || w.includes(l))) continue;
      hit(u.at, "«" + m[1] + "» - слово нашей кухни, читателю оно ничего не значит", cut(u.text, m.index, m[0].length));
    }
  },

  typo: (P, C, hit) => {
    for (let n = 0; n < P.lines.length; n++) {
      for (const m of P.lines[n].matchAll(BAD_TYPO)) {
        hit({ block: blockOfLine(P, n + 1), line: n + 1 }, (TYPO_NAME[m[0]] || m[0]) + " - в проекте дефис и е без точек", cut(P.lines[n], m.index, 1));
      }
    }
  },

  hard_len: (P, C, hit) => {
    const calc = (C.metaByName && C.metaByName.get(P.slug)) || {};
    for (const [k, max] of [["title", 70], ["description", 160]]) {
      const v = P.meta[k] || str(calc[k]);
      if (!v) continue;
      const n = chars(v);
      if (n > max) hit({ block: "мета " + k, line: P.metaLine[k] || 1 }, n + " знаков при жестком лимите " + max, v.slice(0, 60) + "...");
    }
    for (const s of P.sections) {
      if (s.id !== "cat_intro" || s.chars <= 500) continue;
      hit({ block: s.label, line: s.line }, "интро категории " + s.chars + " знаков при жестком лимите 500", s.text.slice(0, 60) + "...");
    }
  },

  // Адреса делает слаг-движок. Запрет на написанный руками адрес жил в промте автора,
  // хотя ловится грепом за две строки: место в промте дорогое, а тут это стоит ноль.
  bad_link: (P, C, hit) => {
    const known = (path) => C.urls.has(path) || C.urls.has(path.replace(/\/$/, "")) || C.urls.has(path.replace(/\/?$/, "/"));
    for (const u of P.units) {
      const links = [];
      for (const m of u.text.matchAll(RX_MDLINK)) {
        links.push([m.index, m.index + m[0].length]);
        const path = m[1].replace(/[?#].*$/, "");
        if (!known(path)) hit(u.at, "ссылка на " + path + " - такой страницы в pages.json нет", cut(u.text, m.index, m[0].length));
      }
      const inLink = (i) => links.some(([a, b]) => i >= a && i < b);
      for (const m of u.text.matchAll(RX_BAREURL)) {
        const i = m.index + m[1].length;
        if (inLink(i)) continue;
        hit(u.at, "адрес " + m[2] + " написан в тексте: адреса делает слаг-движок, ссылка ставится markdown-ссылкой", cut(u.text, i, m[2].length));
      }
    }
  },

  persona_quote: (P, C, hit) => {
    for (const u of P.units) for (const m of u.text.matchAll(RX_QUOTE)) {
      const q = (m[1] || m[2] || "").trim();
      const words = plainWords(q);
      if (words.split(" ").filter(Boolean).length < 4) continue;   // термин и название - не речь
      if (C.speech.some((s) => s.includes(words) || (words.includes(s) && s.length >= 12))) continue;
      hit(u.at, "прямой речи «" + q.slice(0, 50) + (q.length > 50 ? "..." : "") + "» нет в audience.words с src forum либо client", cut(u.text, m.index, m[0].length));
    }
  },

  // Первый экран не зависит от плана и от меток: H1 плюс хоть строка текста ДО первого
  // подзаголовка. Страница, которая с H1 сразу уходит в раздел, начинается не с обещания,
  // а с оглавления, и читателю нечего узнать о себе в первые две секунды.
  no_hero: (P, C, hit) => {
    if (!P.h1) { hit({ block: "страница", line: 1 }, "нет H1: первого экрана у страницы не существует", P.slug); return; }
    let seen = 0;
    for (let n = P.h1Line; n < P.bodyEnd; n++) {
      const s = P.lines[n];
      if (RX_HEAD.test(s)) break;
      if (s.trim() && !RX_MARK.test(s)) seen++;
    }
    if (!seen) hit({ block: "страница", line: P.h1Line }, "между H1 и первым подзаголовком ни строки текста: первого экрана нет", P.h1.slice(0, 60));
  },

  no_cta: (P, C, hit) => {
    if (P.sections.some((s) => CTA_IDS.includes(s.id))) return;
    if (buttons(P).length) return;
    hit({ block: "страница", line: P.h1Line || 1 }, "ни раздела cta, ни ссылки, ни строки-кнопки: читателю некуда пойти", P.slug);
  },

  fn_b_half: (P, C, hit) => {
    const named = P.sections.filter((s) => s.id && C.yml.blocks.has(s.id));
    if (named.length < 4) return;
    const b = named.filter((s) => str((C.yml.blocks.get(s.id) || [])[0]) === "В");
    if (b.length * 2 <= named.length) return;
    hit({ block: "страница", line: P.h1Line || 1 }, "разделов с функцией В " + b.length + " из " + named.length + " (" + b.map((s) => s.id).join(", ") + "): пустое место добито возражениями, страница должна становиться короче, а не оборонительнее", "");
  },

  chars_norm: (P, C, hit) => {
    for (const s of P.sections) {
      const row = s.id ? C.yml.blocks.get(s.id) : null;
      if (!row) continue;
      const m = /(\d+)\s*-\s*(\d+)/.exec(str(row[4]) || "");
      if (!m) continue;
      const lo = Math.round(+m[1] * 0.7), hi = Math.round(+m[2] * 1.3);
      if (s.chars > hi) hit({ block: s.label, line: s.line }, s.chars + " знаков, норма " + m[1] + "-" + m[2] + " с допуском автора до " + hi, s.text.slice(0, 50) + "...");
      // У режима tmpl нижней границы нет по построению: запасной вариант блока короче
      // полного, и недобор у него - правильный исход, а не недоработка.
      else if (s.chars < lo && C.mode.get(s.id) !== "tmpl") hit({ block: s.label, line: s.line }, s.chars + " знаков, норма " + m[1] + "-" + m[2] + " с допуском автора от " + lo + "; верстка соберется, но ответ короче рыночного", s.text.slice(0, 50) + "...");
    }
  },

  q_mark: (P, C, hit) => {
    for (const s of P.sections) {
      if (s.known) continue;
      const where = s.fallback ? "сборка ставит раздел на место " + s.id + " по порядку" : "позиционного места тоже нет, раздел соберется последним";
      hit({ block: s.label, line: s.line }, s.qid ? "метка q:" + s.qid + " неизвестна pages.yml, " + where : "метки q: над разделом нет, " + where, (s.head || s.text).slice(0, 50));
    }
  },

  twins: (P, C, hit) => {
    const mine = new Set(P.sections.flatMap((s) => s.closes));
    if (mine.size < 3) return;
    for (const other of arr(C.siblings)) {
      if (other.slug === P.slug || other.closes.size < 3) continue;
      const both = [...mine].filter((x) => other.closes.has(x));
      const union = new Set([...mine, ...other.closes]).size;
      if (!union || both.length / union < 0.7) continue;
      hit({ block: "страница", line: P.h1Line || 1 }, "closes: совпадает с " + other.slug + " на " + Math.round((both.length / union) * 100) + " процентов - одна мысль разными словами", both.join(","));
    }
  },

  plan_gap: (P, C, hit) => {
    if (!C.plan) return;
    const written = new Set(P.sections.map((s) => s.id).filter(Boolean));
    for (const b of arr(C.plan.blocks).filter((x) => x.ord).sort((a, z) => a.ord - z.ord)) {
      if (written.has(b.id) || P.dropped.has(b.id) || P.merged.has(b.id)) continue;
      hit({ block: b.id, line: P.h1Line || 1 }, "блок плана (место " + b.ord + ", режим " + b.mode + ") не написан и в хвосте не объявлен строкой снят: либо слито:", "");
    }
  },

  off_plan: (P, C, hit) => {
    if (!C.plan) return;
    const active = new Set(arr(C.plan.blocks).filter((b) => b.ord).map((b) => b.id));
    for (const s of P.sections) {
      if (!s.id || active.has(s.id)) continue;
      const stub = arr(C.plan.blocks).some((b) => b.id === s.id && !b.ord);
      hit({ block: s.label, line: s.line }, stub ? "раздел снят планом в stub, отвечать ему нечем" : "раздела нет в действующем составе плана", (s.head || s.text).slice(0, 50));
    }
  },

  no_thought: (P, C, hit) => {
    if (P.thought) return;
    hit({ block: "хвост", line: P.tail.length ? P.tail[0].n : P.lines.length }, P.hasTail ? "в хвосте нет строки мысль: - страница не называет, что доказывает" : "служебного хвоста нет вовсе: ни мысли, ни снятых блоков", "");
  },

  closes_empty: (P, C, hit) => {
    for (const s of P.sections) {
      if (s.closes.length || !s.id) continue;
      if (C.plan && C.mode.get(s.id) !== "work") continue;   // tmpl отвечает не фактом, и это законно
      hit({ block: s.label, line: s.line }, "нет closes: - покрытие фактов и заготовка FAQ по этому разделу слепы", (s.head || s.text).slice(0, 50));
    }
  }
};

function blockOfLine(P, n) {
  for (const s of P.sections) if (s.lines.some((l) => l.n === n)) return s.label;
  if (P.h1Line === n) return "H1";
  for (const k of Object.keys(P.metaLine)) if (P.metaLine[k] === n) return "мета " + k;
  return P.hasTail && P.tail.some((t) => t.n === n) ? "хвост" : "вне раздела";
}

// ---------------------------------------------------------------- материал проекта
export function buildContext(dir, yml) {
  const project = loadJson(join(dir, "project.json"));
  if (!project) die("нет " + join(dir, "project.json") + " - проверять числа не по чему");
  const b = project.business || {}, L = b.legal || {}, lex = project.lexicon || {}, cons = project.constraints || {};
  const pub = arr(project.facts).filter((f) => str(f.publish) === "yes");
  // Разрешенные числа: факты к публикации плюс то, что заказчик прислал сам и выдумать
  // нельзя, - реквизиты, год основания, зоны, строки must_say. Прозу агентов (оффер,
  // причины) сюда НЕ кладем: закон говорит про facts[], а не про пересказ фактов.
  const { set: ok, nums: okNum } = harvest([
    ...pub.map((f) => str(f.value)), ...pub.map((f) => str(f.label)),
    b.since != null ? String(b.since) : "", str(L.address), str(L.schedule),
    ...arr(b.geo).map(str), ...arr(cons.must_say).map(str)
  ], [str(L.phone), str(L.inn), str(L.ogrn)]);
  // Ядовитые числа: все, что снято у лидеров, по всем кластерам. Свой факт сильнее: число,
  // совпавшее с фактом заказчика, ядовитым не считается.
  const tainted = new Set();
  const ldir = join(dir, "leaders");
  if (existsSync(ldir)) {
    for (const f of readdirSync(ldir).filter((n) => n.endsWith(".json")).sort()) {
      for (const t of arr((loadJson(join(ldir, f)) || {}).tainted)) {
        for (const m of String(t).matchAll(RX_NUM)) for (const x of numForms(m[1])) if (!ok.has(x)) tainted.add(x);
      }
    }
  }
  const speech = [
    ...arr((project.audience || {}).words).filter((w) => ["forum", "client"].includes(str(w.src))).map((w) => str(w.say)),
    ...arr(cons.must_say).map(str), ...arr(lex.locked).map(str), ...arr(lex.canonical).map(str),
    str(b.name), ...pub.map((f) => str(f.value)), ...pub.map((f) => str(f.label))
  ].map(plainWords).filter((s) => s.length >= 4);
  const locked = [...arr(lex.locked), ...arr(lex.canonical)].map((s) => String(s).toLowerCase().trim()).filter((s) => s.length >= 3);
  // Метатеги считает формула и кладет в tasks/meta.json; автор их не пишет. Жесткий лимит
  // сработает только если ему есть что мерить: без этой строки hard_len молчал бы всегда,
  // а метатеги - одно из ровно двух жестких ограничений этапа.
  // Адреса сайта: их делает слаг-движок, и написанный руками адрес почти всегда чужой.
  const urls = new Set(arr((loadJson(join(dir, "pages.json")) || {}).pages).map((x) => str(x.url)).filter(Boolean));
  const metaByName = new Map();
  const mj = loadJson(join(dir, "tasks", "meta.json"));
  if (mj) { const t = new Set(); for (const m of arr(mj.pages)) metaByName.set(pageName(m, t), m); }
  return { project, ok, okNum, tainted, speech, locked, yml, dir, metaByName, urls };
}

function siblings(dir) {
  const pdir = join(dir, "pages");
  if (!existsSync(pdir)) return [];
  return readdirSync(pdir).filter((n) => n.endsWith(".md")).sort().map((n) => {
    const raw = readFileSync(join(pdir, n), "utf8");
    const set = new Set();
    for (const m of raw.matchAll(/closes:\s*([a-z0-9.,]+)/gi)) for (const x of m[1].split(",")) if (x.trim()) set.add(x.trim().toLowerCase());
    return { slug: n.replace(/\.md$/i, ""), closes: set };
  });
}

// ---------------------------------------------------------------- прогон
export function verifyPage(file, C, rules) {
  const P = parsePage(file);
  const plan = typeof C.planOf === "function" ? C.planOf(P.slug) : null;
  resolveIds(P, C.yml, plan ? arr(plan.blocks) : []);
  const ctx = Object.assign({}, C, { plan, mode: new Map(plan ? arr(plan.blocks).map((b) => [b.id, str(b.mode)]) : []) });
  const found = [];
  for (const level of SECTIONS) {
    for (const [id, line] of rules[level]) {
      const hit = (at, msg, frag) => found.push({ level, id, line, at, msg, frag: frag ? String(frag).replace(/\s+/g, " ").trim() : "" });
      CHECKS[id](P, ctx, hit);
    }
  }
  return { P, plan, found };
}

// Сверка реестра и кода. Разойтись им негде: правило без проверки молчаливо не
// проверялось бы, а проверка без правила стреляла бы мимо реестра и мимо бюджета.
export function crosscheck(rules) {
  const declared = [...rules.block.keys(), ...rules.warn.keys()];
  const dup = declared.filter((id, i) => declared.indexOf(id) !== i);
  if (dup.length) return "правило объявлено дважды: " + [...new Set(dup)].join(", ");
  for (const level of SECTIONS) {
    if (rules[level].size > RULES_MAX) return "правил " + level + ": " + rules[level].size + ", потолок " + RULES_MAX + " - новое правило добавляется только вместо старого";
  }
  const noCheck = declared.filter((id) => !CHECKS[id]);
  if (noCheck.length) return "в реестре есть правило, а проверки нет: " + noCheck.join(", ");
  const noRule = Object.keys(CHECKS).filter((id) => !declared.includes(id));
  if (noRule.length) return "проверка есть, а правила в реестре нет: " + noRule.join(", ");
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
  const rules = readRules(join(root, ".claude/skills/site-proto/rules.yml"));
  if (!rules) die("нет rules.yml - реестр правил живет там, и без него проверять нечего");
  const bad = crosscheck(rules);
  if (bad) die(bad);

  let files = [], dir = null;
  const target = pos[0];
  let whole = true;
  if (target && /\.md$/i.test(target) && existsSync(resolve(target))) { files = [resolve(target)]; dir = projectOf(resolve(target)); whole = false; }
  else {
    dir = findDir(target, root);
    if (!dir) die("проект не найден - укажи файл страницы, слаг или каталог проекта");
    const pdir = join(dir, "pages");
    if (!existsSync(pdir)) die("нет " + pdir + " - страницы еще не написаны");
    files = readdirSync(pdir).filter((n) => n.endsWith(".md")).sort().map((n) => join(pdir, n));
    // --page сужает прогон до одной страницы. Прогон не полный, значит verify.json не
    // переписывается: отметка «страницы проверены» обязана означать ВСЕ страницы.
    const only = flags.page && flags.page !== true ? String(flags.page).replace(/\.md$/i, "") : "";
    if (only) {
      files = files.filter((f) => basename(f).replace(/\.md$/i, "") === only);
      if (!files.length) die(`страницы ${only}.md в pages/ нет`);
      whole = false;
    }
  }
  if (!dir) die("каталог проекта не найден рядом со страницей");
  if (!files.length) die("страниц не найдено");

  const yml = readPages(join(root, ".claude/skills/site-proto/pages.yml"));
  if (!yml) die("нет pages.yml - вопросы читателя и нормы знаков берутся оттуда");
  const C = buildContext(dir, yml);
  C.siblings = siblings(dir);
  const planJson = loadJson(join(dir, "plan.json"));
  // Страница сводится с планом по ИМЕНИ ФАЙЛА (pageName), а не по голому слагу: у главной
  // и у лендинга слаг пуст, файл зовется index, и сверка по слагу не сходится никогда -
  // правила состава на самой важной странице сайта молчали бы всегда.
  const planByName = new Map();
  if (planJson) { const t = new Set(); for (const p of arr(planJson.pages)) planByName.set(pageName(p.page, t), p); }
  C.planOf = (slug) => planByName.get(slug) || null;

  const report = files.map((f) => verifyPage(f, C, rules));
  // Отчет ложится на диск и служит отметкой времени: verify-build смотрит, не трогали ли
  // страницу ПОСЛЕ проверки. Единственный шаг, который пишет новый текст после проверки, -
  // усиление; без этой отметки дописанное им не встречало бы ни одного из 12 правил.
  // Пишется он только при полном прогоне: проверка одной страницы полной не считается.
  if (whole && !flags.dry) {
    writeFileSync(join(dir, "verify.json"), JSON.stringify({
      v: 1, at: today(), block: report.reduce((n, r) => n + r.found.filter((f) => f.level === "block").length, 0),
      pages: report.map((r) => ({
        slug: r.P.slug, planned: Boolean(r.plan),
        block: r.found.filter((f) => f.level === "block").length,
        warn: r.found.filter((f) => f.level === "warn").length
      }))
    }, null, 2) + "\n", "utf8");
  }
  if (flags.json) {
    console.log(JSON.stringify({
      v: 1, dir, rules: { block: rules.block.size, warn: rules.warn.size },
      pages: report.map((r) => ({
        slug: r.P.slug, planned: Boolean(r.plan),
        found: r.found.map((x) => ({ level: x.level, id: x.id, block: x.at.block, line: x.at.line, msg: x.msg, frag: x.frag }))
      }))
    }, null, 2));
    return report.some((r) => r.found.some((f) => f.level === "block")) ? 1 : 0;
  }

  let nb = 0, nw = 0;
  console.log("[verify-page] " + dir + " | правил block " + rules.block.size + ", warn " + rules.warn.size + " | страниц " + files.length);
  if (!planJson) console.log("  плана нет: правила состава (plan_gap, off_plan) молчат, метки читаются без позиционного фолбэка");
  for (const r of report) {
    const b = r.found.filter((f) => f.level === "block"), w = r.found.filter((f) => f.level === "warn");
    nb += b.length; nw += w.length;
    const ofPlan = r.plan ? " из " + arr(r.plan.blocks).filter((x) => x.ord).length + " по плану" : "";
    console.log("  " + r.P.slug + ".md | разделов " + r.P.sections.length + ofPlan + " | блокирующих " + b.length + ", предупреждений " + w.length);
    for (const f of [...b, ...w]) {
      console.log("    " + (f.level === "block" ? "ОТКАЗ   " : "ВНИМАНИЕ") + " " + f.id.padEnd(14) + " " + addr(f.at) + ": " + f.msg);
      if (f.frag) console.log("             " + f.frag);
    }
  }
  console.log("  итого: блокирующих " + nb + ", предупреждений " + nw);
  if (nb) console.log("  правит site-editor и только названное: неназванное не трогает никто.");
  return nb ? 1 : 0;
}

const selfPath = resolve(fileURLToPathSafe(import.meta.url));
function fileURLToPathSafe(u) {
  let p = new URL(u).pathname;
  p = decodeURIComponent(p);
  if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1);
  return p;
}
if (process.argv[1] && resolve(process.argv[1]) === selfPath) process.exit(main());
