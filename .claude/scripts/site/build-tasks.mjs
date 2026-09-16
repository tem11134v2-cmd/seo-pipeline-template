#!/usr/bin/env node
// build-tasks.mjs
// Задание автору, метатеги и theses.md. Автор ОДИН, пишет страницу целиком за один
// проход, и все, что он видит, собрано тут.
//
// ДВА РАЗДЕЛЬНЫХ ПОТОЛКА, и это главный инвариант слоя письма:
//   ИНСТРУКЦИИ (agents/site-author.md + AUTHOR.md + инструктивная часть задания) 12000,
//   из них правил-запретов 2500;
//   МАТЕРИАЛ (контракт, тезисы соседних страниц, строка лидеров) 16000.
//   Общего потолка не хватило бы: один контракт на хорошо заполненном проекте - 15000
//   знаков, и под одной крышей он вытеснил бы инструкции в ноль либо сжался сам.
//
// ПРОПОРЦИЯ считается ДВУМЯ мерками, и это не педантизм, а разделение ответственности.
//   ok_task - материала больше, чем ЗАДАНИЯ. ЖЕСТКО, валит прогон. Ровно эту болезнь
//     этап и лечит: в v7 писателю приезжало 32982 знака собранного задания, где состав,
//     порядок, функцию и длину ячейки за него уже решили три агента. Задание пишет сам
//     конвейер, и за его раздувание отвечает конвейер.
//   ok_more - материала больше, чем ВСЕХ инструкций, вместе с методичкой. Заголовок
//     пропорции, печатается всегда. Методичка на всех страницах одна и на пустом проекте
//     весит столько же, сколько на полном; при потолке инструкций 12000 и потолке
//     материала 16000 обратная пропорция значит ровно одно - контракт тоньше методички.
//     Это факт о ПРОЕКТЕ, а не дефект слоя письма, и ронять им сборку значит требовать
//     фактуру ценой несобираемого сайта. Поэтому тут предупреждение с названной причиной,
//     а недостающее и так уже лежит в gaps и в вопросах заказчику.
//
// Чего в задании НЕТ и не будет:
//   - поблочной цели в знаках. Норма знаков - проверка ПОСЛЕ письма и предупреждение;
//     цель в знаках возвращает машину долива воды до нижней границы;
//   - цифр лидеров. tainted автору не показывается вовсе: форму и состав с рынка берем,
//     цифры - никогда;
//   - фактов с publish no. Числа без публикации автору запрещены, а место в материале
//     дорогое: показать запрещенное число значит потратить место на соблазн;
//   - стоп-листов, типографики и грепаемых правил. Это работа verify-page.mjs: место в
//     промте дорогое, а машина проверяет такое дешевле и надежнее.
//
// Использование:
//   node build-tasks.mjs [<слаг|каталог>] [--dry] [--json]
//
// Exit: 0 сделано | 1 инварианты потолков нарушены (файлы записаны, счетчики в отчете)
//       | 2 отказ (нет проекта, нет плана, нет контракта, нет pages.yml).

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { today, readPages, arr, str, pageName } from "./_contract.mjs";
import { repoRoot, findDir, plain } from "./queue.mjs";
import { STRUCT, siteMaterial } from "./plan.mjs";

const die = (msg) => { console.error("[tasks] " + msg); process.exit(2); };

// ---------------------------------------------------------------- потолки
export const CAP_INSTR = 12000;
export const CAP_BAN = 2500;
export const CAP_MAT = 16000;
export const TITLE_MAX = 70;
export const DESC_MAX = 160;

// Разделители частей задания. По ним же идет счет двух потолков: файл один, а бюджета
// в нем два, и граница между ними обязана быть машиночитаемой.
export const MARK_MAT = "## 3. МАТЕРИАЛ";
// Каталожные нормы приезжают писателю В ЗАДАНИЕ, а не подкладыванием CATALOG.md: тот
// справочник на 8500 знаков адресован архитектору и разработчику, и целиком он не влезает
// в потолок инструкций 12000. Писателю нужны три числа и одна форма, и они тут.
// Печатается только каталожным страницам и узлу service_like: страница услуги за это
// место не платит.
export const CATALOG_NORMS = [
  "## 2.1. КАТАЛОЖНЫЕ НОРМЫ",
  "Центр тяжести категории - НЕ текст: ее ранжируют ассортимент, цены, наличие и доставка.",
  "Интро над листингом: ЖЕСТКИЙ потолок 500 знаков - лишние отодвигают первый товар ниже сгиба.",
  "Текст под листингом: H2 и 3-4 подраздела «как выбрать», а не полотно: структурный разбор вытягивается в генеративную выдачу, простыня с вхождениями - нет.",
  "Карточка: короткое описание ОТ ВЫГОДЫ, а не от спецификации («тихий - ставят в спальне», а не «32 дБ»); таблицу характеристик оно не пересказывает.",
  "Правило пропуска: нет значения - предложение выбрасывается ЦЕЛИКОМ; «не указано» и прочерк в товарную выдачу не печатаются никогда.",
  "Образец интро категории - AUTHOR.md, образец 3."
].join("\n");
export const CATALOG_TASK_TYPES = ["category", "facet", "product"];
export const MARK_CAPS = "## 4. ПОТОЛКИ";

// Инструкции автора, которые лежат вне задания. Их собирает следующий срез; пока файлов
// нет, они считаются нулем, и в отчете стоит строка об этом.
export const INSTR_FILES = [".claude/agents/site-author.md", ".claude/skills/site-proto/AUTHOR.md"];

// Запрет - это конструкция «нельзя», а не любое «не» в прозе. Счет идет по ЗНАКАМ строк,
// в которых запрет стоит: правило меряется местом, которое оно занимает у автора.
// Считается и СПИСОК под запретительным заголовком целиком: «Чего в тексте не
// появляется» с шестью пунктами - это шесть запретов, как их ни сформулируй.
const BAN_RE = [
  /(^|[^А-ЯA-Z])НЕ(\s|$)/,
  /нельзя|запрещ|запрет|никогда|ни при каких|не должен|не должно|не должны|не вправе|не имеет права/i,
  /не\s+(пиш|использ|делай|трогай|ставь|добавляй|выдумыв|меняй|копируй|сочиняй|заполняй|бери|печатай|приписывай)/i
];
const BAN_HEAD = /^#{1,6}\s.*(чего\s|что\s+нельзя|запрещ|не появля|не пишем|не делаем|не бывает)/i;
export function banLines(text) {
  const out = [];
  let inBan = false;
  for (const ln of String(text).split(/\r?\n/)) {
    if (/^#{1,6}\s/.test(ln)) inBan = BAN_HEAD.test(ln);
    if (!ln.trim()) continue;
    if (inBan || BAN_RE.some((re) => re.test(ln))) out.push(ln);
  }
  return out;
}
export function banChars(text) {
  return banLines(text).reduce((n, ln) => n + chars(ln) + 1, 0);
}
// Счет запретов ШТУКАМИ - для инварианта образцов: пропорция «125 не на 1 образец»
// меряется числом правил, а не их длиной. Заголовок запретительного раздела в счет не
// идет: считается то, что запрещает, а не то, что объявляет раздел.
export function banCount(text) {
  return banLines(text).filter((ln) => !/^#{1,6}\s/.test(ln)).length;
}

const chars = (s) => Array.from(String(s == null ? "" : s)).length;
const cap1 = (s) => { const t = plain(s); return t ? t[0].toUpperCase() + t.slice(1) : ""; };
const low1 = (s) => { const t = plain(s); return t ? t[0].toLowerCase() + t.slice(1) : ""; };

// ---------------------------------------------------------------- регион словами контракта
// Склонять город кодом нельзя: «в Санкт-Петербург» и «в Тверь» в метатегах хуже, чем
// отсутствие региона вовсе. Поэтому падежная форма берется оттуда, где ее уже написал
// человек: из business.what и позиционирования. Не нашлась - ставим приложением через
// запятую, оно верно при любом названии.
export function geoPhrase(project) {
  const b = project.business || {}, o = project.offer || {};
  const region = plain(b.region);
  if (!region) return { phrase: "", region: "" };
  const head = region.toLowerCase().slice(0, 5);
  // Граница слова классом, а не \b: в JS \b опирается на ASCII и перед кириллическим
  // предлогом не срабатывает вовсе, из-за чего падежная форма молча не находится.
  for (const src of [plain(b.what), plain(o.positioning)]) {
    const m = src.match(/(?:^|[\s(,])в\s+([А-Яа-яA-Za-z][^,.;:]{1,40})/);
    if (m && m[1].toLowerCase().slice(0, 5) === head) return { phrase: "в " + m[1].trim(), region };
  }
  return { phrase: ", " + region, region };
}

const hasGeo = (text, region) => region && plain(text).toLowerCase().includes(region.toLowerCase().slice(0, 5));

// ---------------------------------------------------------------- метатеги формулой
// Ручной работы по каждой странице тут нет: части складываются по порядку важности и
// обрезаются по потолку. Числа берутся ТОЛЬКО из опубликованных фактов страницы.
// H1 тут ПЛАНОВЫЙ: файл тезисов и метатеги нужны авторам до того, как написана хоть одна
// страница. Имя страницы берется из pages.json: в плане у страницы есть маркер, но у
// инфо-страницы маркера нет вовсе, и без имени ее H1 сползал бы на описание бизнеса.
export function h1Of(page, project) {
  const b = project.business || {};
  if (page.type === "home") return cap1(b.what);
  if (page.type === "landing") return cap1(page.marker || b.what);
  if (page.type === "info") return cap1(page.name || page.marker || b.what);
  return cap1(page.marker || page.name || b.what);
}

function fit(parts, max, join) {
  let out = "";
  for (const p of parts) {
    if (!p) continue;
    const next = out ? out + join + p : p;
    if (chars(next) > max) continue;
    out = next;
  }
  return out;
}

export function metaOf(page, project, hook) {
  const b = project.business || {}, o = project.offer || {};
  const { phrase, region } = geoPhrase(project);
  const h1 = h1Of(page, project);
  const base = hasGeo(h1, region) ? h1 : plain(h1 + " " + phrase).replace(" ,", ",");
  const brand = plain(b.name);
  // У главной имя компании идет ВПЕРЕДИ. Описание бизнеса и маркер первой услуги на
  // многих проектах совпадают дословно, и общая формула дала бы двум страницам один
  // title - то есть каннибализацию, сделанную нашими же руками.
  const home = page.type === "home" || page.type === "landing";
  const title = fit(home ? [brand ? `${brand}: ${base}` : base, hook] : [base, hook, brand], TITLE_MAX, " - ")
    || base.slice(0, TITLE_MAX);
  const promise = low1((o.promise || {}).result);
  const cta = plain((o.promise || {}).cta);
  const desc = fit([base + ".", promise ? cap1(promise) + "." : "", hook ? cap1(hook) + "." : "", cta ? cta + "." : ""], DESC_MAX, " ");
  return { h1, title, description: desc };
}

// ---------------------------------------------------------------- материал
// Контракт целиком, кроме derived-полей, фактов publish no и цифр рынка.
// Лестница усушки - на случай, когда контракт перерос потолок материала. Порядок ее
// задан один раз и печатается в задании: молча урезанный материал хуже, чем названный.
// Факты не режутся ни на каком шаге: ради них все и собрано.
// Лестница усушки материала. Последняя ступень несущая: на контракте, который этап 1
// пропускает до 26000 знаков, четырех необязательных срезов не хватает, и без нее потолок
// материала не держался бы вовсе. Режется при этом самое дальнее от страницы - факты,
// не привязанные ни к одному ее блоку.
export const TRIM_LADDER = ["открытые вопросы", "слова с src persona", "переводы лексикона", "ассортимент", "факты не про эту страницу"];

export function materialOf(project, drops = [], ids = []) {
  const b = { ...(project.business || {}) };
  delete b.client_pages;
  const aud = { ...(project.audience || {}) };
  const lex = { ...(project.lexicon || {}) };
  if (drops.includes("слова с src persona")) aud.words = arr(aud.words).filter((w) => str(w.src) !== "persona");
  if (drops.includes("переводы лексикона")) delete lex.translate;
  if (drops.includes("ассортимент")) delete b.assortment;
  return {
    business: b,
    offer: project.offer || {},
    audience: aud,
    facts: arr(project.facts).filter((f) => str(f.publish) === "yes")
      .filter((f) => !(drops.includes("факты не про эту страницу") && ids.length) || arr(f.q).some((q) => ids.includes(str(q)))),
    constraints: project.constraints || {},
    lexicon: lex,
    gaps: drops.includes("открытые вопросы") ? [] : arr(project.gaps)
  };
}

// Возражения по id: в контракте они лежат позиционно, а в плане и в разметке страницы
// адресуются как o<сегмент>.<возражение>. Без этой таблицы автор сверяет их счетом.
export function objectionIndex(project) {
  const out = [];
  arr((project.audience || {}).segments).forEach((s, i) => {
    arr(s.objection).forEach((ob, j) => {
      out.push(`o${i + 1}.${j + 1} | ${plain(s.name)} | «${plain(ob.says)}» | ответ: ${plain(ob.answer)}`);
    });
  });
  return out;
}

// ---------------------------------------------------------------- тезисы всех страниц
// Детерминированно и ОДИНАКОВО для всех авторов. В v7 писатели шли веером вслепую, и
// цельность потом чинилась вычитанием самоповторов; тут она задана до первой строки.
export function thesesOf(plan, project, yml) {
  const lines = [];
  // База фактов у сайта одна, и первый же факт страницы совпал бы у всех: тезисы тогда
  // перестают разводить страницы, ради чего файл и существует. Поэтому взятый факт
  // уходит в занятые, и следующая страница берет следующий по счету.
  const used = new Set();
  for (const p of arr(plan.pages)) {
    const page = p.page;
    const work = p.blocks.filter((b) => b.ord && b.mode === "work");
    const key = work.map((b) => b.id).filter((id) => id !== "hero" && !id.startsWith("cta_")).slice(0, 5);
    const h1 = h1Of(page, project);
    lines.push(`${page.url} | ${page.type} | H1: ${h1} | обещание: ${promiseOf(p, project, used)} | закрывает: ${key.join(", ") || "-"}`);
  }
  const canon = arr((project.lexicon || {}).canonical).map((c) => plain(c)).filter(Boolean);
  const head = [
    "# theses.md - о чем каждая страница сайта",
    "",
    "Файл собран машиной ДО письма и одинаков для всех авторов. Своя страница тут тоже есть:",
    "она обязана двигать свою мысль и не повторять чужую.",
    ""
  ];
  const tail = canon.length
    ? ["", "## Канон", "Повторяется ДОСЛОВНО. Перефразировать «чтобы не повторяться» запрещено: это ломает узнавание.", "", ...canon]
    : ["", "## Канон", "Канонных строк в контракте нет."];
  return head.concat(lines, tail).join("\n") + "\n";
}

// Обещание страницы. У главной и лендинга это обещание оффера, у остальных - сильнейший
// опубликованный факт страницы: иначе все строки тезисов совпадут и файл перестанет
// разводить страницы между собой.
function promiseOf(p, project, used = new Set()) {
  const byId = new Map(arr(project.facts).map((f) => [str(f.id), f]));
  const vow = plain(((project.offer || {}).promise || {}).result);
  if (p.page.type === "home" || p.page.type === "landing") return vow || "-";
  const mine = p.blocks.filter((x) => x.ord && x.mode === "work").flatMap((b) => b.answers_with).filter((a) => byId.has(a));
  const pick = mine.find((a) => !used.has(a)) || mine[0];
  if (pick) {
    used.add(pick);
    const f = byId.get(pick);
    return `${plain(f.label)} - ${plain(f.value)}`;
  }
  return vow || "-";
}

// ---------------------------------------------------------------- задание на страницу
// Форма блока у лидеров. Знаки тут НЕ повторяются построчно: на блок их приходится
// одинаково (медиана страницы на медиану блоков), и десять раз напечатанное число
// читается как поблочная цель, которой оно не является.
function leadLine(lead, id) {
  if (!lead || !lead.measured) return "замера нет";
  return plain((lead.form || {})[id]) || "форма не снята";
}
const perBlock = (lead) => (lead && lead.measured && lead.blocks_median
  ? Math.round(lead.chars_median / lead.blocks_median / 10) * 10 : 0);

export function taskOf(p, ctx) {
  const { project, yml, lead, theses } = ctx;
  const page = p.page;
  const byId = new Map(arr(project.facts).map((f) => [str(f.id), f]));
  const act = p.blocks.filter((b) => b.ord);
  const cut = p.blocks.filter((b) => !b.ord);
  const meta = metaOf(page, project, hookOf(p, project));

  // Строка FALLBACK в pages.yml - пара «условие - исход». Когда исход в ней «снят», а
  // блок на странице остался, печатать ее нельзя: автор прочтет приказ снять блок,
  // которого никто не отдавал. Тогда вместо нее печатается источник материала.
  const sm = siteMaterial(project, page);
  const removes = (fb) => /(^|[\s-])снят([,.\s]|$)/.test(fb) && !/не\s+снят/.test(fb);
  const rows = act.map((b) => {
    const row = yml.blocks.get(b.id) || [];
    const src = STRUCT[b.id] && STRUCT[b.id].has(sm) ? STRUCT[b.id].src : "";
    const linked = arr(project.facts).some((f) => str(f.publish) === "yes" && arr(f.q).includes(b.id));
    const closes = b.answers_with.join("+")
      || (src ? "материал не фактом: " + src
        : linked ? "рынок ставит блок краем: короче и без числа"
          : "фактуры нет, блок ядра идет по шаблону");
    const cells = [String(b.ord), b.id, plain(row[1]), plain(row[2]), plain(row[4]) || "норма не задана",
      leadLine(lead, b.id), closes, `${b.mode}/${b.needs}`];
    const line = cells.join(" | ");
    const fb = plain(row[6]);
    return b.mode === "tmpl" && fb && !removes(fb) ? line + `\n     по шаблону: ${fb}` : line;
  });

  const labels = act.flatMap((b) => b.answers_with).map((a) => byId.get(a)).filter(Boolean).slice(0, 3)
    .map((f) => `${plain(f.label)} ${plain(f.value)}`);
  const seg = arr((project.audience || {}).segments).map((s) => plain(s.name)).join(", ");
  const mysl = plain(`${meta.h1}: ${low1(((project.offer || {}).promise || {}).result || "")}` +
    (labels.length ? `; доказываем: ${labels.join("; ")}` : "")).slice(0, 220);

  const objs = objectionIndex(project);

  const out = [
    `# Задание: ${page.url} (${page.type})`,
    "",
    "## 1. МЫСЛЬ",
    `мысль: ${mysl}`,
    `читатель: ${seg || "сегменты не описаны"}`,
    "",
    "## 2. СОСТАВ",
    `Блоков ${act.length}, бюджет ${p.bud}.` +
      (perBlock(lead) ? ` У лидеров на блок приходится ~${perBlock(lead)} знаков - это справка о рынке, а не цель: верстка соберется под готовый текст.` : ""),
    "Колонки: ord | id | вопрос читателя | что ответ делает | ориентир знаков | форма у лидеров | чем закрываем | режим/ответ",
    "Ориентир знаков - норма рынка с допуском плюс-минус 30%, а не цель: верстка соберется под готовый текст.",
    "",
    ...rows.map((r) => "  " + r),
    "",
    cut.length ? `Снято арифметикой состава: ${cut.map((b) => b.id).join(", ")}. На страницу они не идут, дописывать их не надо.` : "Снятых блоков нет.",
    "",
    ...(CATALOG_TASK_TYPES.includes(str(page.type)) || page.from_catalog ? [CATALOG_NORMS, ""] : []),
    matPart(project, theses, lead, p, objs),
    MARK_CAPS
  ];
  return out.join("\n") + "\n";
}

// Материал одной строкой сборки: контракт, возражения по id, тезисы всех страниц и
// строка лидеров. Если контракт перерос потолок, усушка идет по лестнице и называется.
function matPart(project, theses, lead, p, objs) {
  const drops = [];
  const ids = p.blocks.filter((b) => b.ord).map((b) => str(b.id));
  const render = () => [
    MARK_MAT,
    "Контракт проекта целиком: фактура, оффер, аудитория, ограничения, лексикон, открытые вопросы.",
    "Число, которого тут нет, на страницу не идет ни в каком виде.",
    drops.length ? `Из материала снято по потолку: ${drops.join(", ")}.` : "",
    "```json",
    JSON.stringify(materialOf(project, drops, ids), null, 1),
    "```",
    "",
    "Возражения по id:",
    ...objs.map((o) => "  " + o),
    "",
    "Тезисы всех страниц сайта (theses.md):",
    "",
    theses.trim(),
    "",
    "Лидеры по своему типу страниц:",
    "  " + leadersLine(lead, p),
    ""
  ].join("\n");
  let text = render();
  for (const step of TRIM_LADDER) {
    if (chars(text) <= CAP_MAT) break;
    drops.push(step);
    text = render();
  }
  return text;
}

// Счетчики печатаются в само задание, а их длина входит в счет: поэтому считаем до
// неподвижной точки. Двух проходов хватает всегда - меняется только разрядность чисел.
export function capsBlock(c) {
  return [
    `инструкции ${c.instr} из ${CAP_INSTR}, из них запретов ${c.ban} из ${CAP_BAN}`,
    `материал ${c.mat} из ${CAP_MAT}, задание ${c.task}`,
    `материала больше, чем задания: ${c.ok_task ? "да" : "нет"}; чем всех инструкций: ${c.ok_more ? "да" : "нет"}`,
    ""
  ].join("\n");
}

export function taskWithCaps(p, ctx, outer) {
  const body = taskOf(p, ctx);
  let text = body + capsBlock({ instr: 0, ban: 0, mat: 0, task: 0, ok_task: false, ok_more: false });
  let caps = countCaps(text, outer);
  for (let i = 0; i < 3; i++) {
    const next = body + capsBlock(caps);
    const c = countCaps(next, outer);
    if (next === text) break;
    text = next; caps = c;
  }
  return { text, caps };
}

function leadersLine(lead, p) {
  if (!lead || !lead.measured) {
    return `замер не состоялся${lead ? ` (живых ${lead.alive} из ${lead.attempted})` : ""}, состав взят из скелета типа страницы; объем ${p.bud} блоков`;
  }
  const cov = Object.entries(lead.cov || {}).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 10).map(([k, v]) => `${k} ${v}`).join(", ");
  return `живых ${lead.alive} из ${lead.attempted}; блоков медиана ${lead.blocks_median}, знаков медиана ${lead.chars_median}; ` +
    `порядок: ${arr(lead.order).join(", ")}; покрытие: ${cov}`;
}

// ---------------------------------------------------------------- счет потолков
export function splitTask(text) {
  const i = text.indexOf(MARK_MAT);
  const j = text.indexOf(MARK_CAPS);
  if (i < 0 || j < 0) return { instr: text, mat: "" };
  return { instr: text.slice(0, i) + text.slice(j), mat: text.slice(i, j) };
}

export function countCaps(text, outer) {
  const { instr, mat } = splitTask(text);
  const instrAll = outer.map((o) => o.text).join("\n") + "\n" + instr;
  const i = chars(instrAll), b = banChars(instrAll), m = chars(mat);
  const t = chars(instr);
  return {
    instr: i, ban: b, mat: m, task: t,
    ok_instr: i <= CAP_INSTR, ok_ban: b <= CAP_BAN, ok_mat: m <= CAP_MAT,
    ok_task: m > t, ok_more: m > i, thin: m <= i && m > t
  };
}

// ---------------------------------------------------------------- сборка
function loadJson(f) {
  if (!existsSync(f)) return null;
  try { return JSON.parse(readFileSync(f, "utf8")); } catch { return null; }
}

const fileName = (page, taken) => pageName(page, taken);

export function buildTasks(dir, root) {
  const project = loadJson(join(dir, "project.json"));
  if (!project) die(`нет ${join(dir, "project.json")} - задание опирается на контракт, а не на догадку`);
  const plan = loadJson(join(dir, "plan.json"));
  if (!plan) die("нет plan.json - сначала node .claude/scripts/site/plan.mjs <каталог>");
  const yml = readPages(join(root, ".claude/skills/site-proto/pages.yml"));
  if (!yml) die("нет pages.yml - вопросам читателя неоткуда взяться");
  const known = new Map(arr((loadJson(join(dir, "pages.json")) || {}).pages).map((p) => [str(p.url), p]));
  for (const p of arr(plan.pages)) {
    const src = known.get(str(p.page.url)) || {};
    p.page.name = str(src.name);
    p.page.dir = str(src.dir);
  }

  const outer = INSTR_FILES
    .map((f) => ({ f, p: join(root, f) }))
    .filter((x) => existsSync(x.p))
    .map((x) => ({ f: x.f, text: readFileSync(x.p, "utf8") }));

  const theses = thesesOf(plan, project, yml);
  const leads = new Map();
  const leadOf = (c) => {
    if (!c) return null;
    if (!leads.has(c)) leads.set(c, loadJson(join(dir, "leaders", c + ".json")));
    return leads.get(c);
  };

  const taken = new Set(), tasks = [], meta = [];
  for (const p of arr(plan.pages)) {
    const name = fileName(p.page, taken);
    const lead = leadOf(str(p.cluster));
    const { text, caps } = taskWithCaps(p, { project, yml, lead, theses }, outer);
    const m = metaOf(p.page, project, hookOf(p, project));
    tasks.push({ name, page: p.page, text, caps });
    meta.push({ slug: str(p.page.slug), url: str(p.page.url), type: str(p.page.type), h1: m.h1, title: m.title, description: m.description });
  }
  return { plan, project, theses, tasks, meta, outer };
}

// Крючок метатега - число страницы, а не первое попавшееся: цена и срок продают title,
// а «2 часа по городу» в заголовке страницы про цену читается как случайность.
export const HOOK_ORDER = ["price", "hero", "steps", "cases", "docs", "geo", "numbers"];
export function hookOf(p, project) {
  const byId = new Map(arr(project.facts).map((f) => [str(f.id), f]));
  const pos = (id) => { const i = HOOK_ORDER.indexOf(id); return i < 0 ? 99 : i; };
  const f = p.blocks.filter((b) => b.ord).slice()
    .sort((a, b) => pos(a.id) - pos(b.id) || a.ord - b.ord)
    .flatMap((b) => b.answers_with)
    .map((a) => byId.get(a))
    .find((x) => x && /[0-9]/.test(str(x.value)));
  return f ? low1(f.value) : "";
}

// ---------------------------------------------------------------- CLI
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

function main() {
  const { flags, pos } = parseArgs(process.argv.slice(2));
  const root = flags.root && flags.root !== true ? resolve(String(flags.root)) : repoRoot();
  const dir = findDir(pos[0], root);
  if (!dir) die("проект не найден - сначала queue.mjs init <slug>");
  const all = buildTasks(dir, root);
  const { theses, meta, outer } = all;
  // --page сужает шаг до одной страницы. Тезисы и метатеги считаются по ВСЕМУ сайту и при
  // этом: theses.md одинаков у всех авторов по построению, и урезать его под одну правку
  // значило бы вернуть веер вслепую.
  const only = flags.page && flags.page !== true ? String(flags.page).replace(/\.md$/i, "") : "";
  if (only && !all.tasks.some((t) => t.name === only)) die(`страницы ${only} в плане нет: ${all.tasks.map((t) => t.name).join(", ")}`);
  const tasks = only ? all.tasks.filter((t) => t.name === only) : all.tasks;

  if (flags.json) {
    console.log(JSON.stringify({ v: 1, at: today(), tasks: tasks.map((t) => ({ name: t.name, url: t.page.url, caps: t.caps })), meta }, null, 2));
    return 0;
  }
  if (!flags.dry) {
    mkdirSync(join(dir, "tasks"), { recursive: true });
    for (const t of tasks) writeFileSync(join(dir, "tasks", t.name + ".md"), t.text, "utf8");
    writeFileSync(join(dir, "theses.md"), theses, "utf8");
    writeFileSync(join(dir, "tasks", "meta.json"), JSON.stringify({ v: 1, at: today(), pages: meta }, null, 2) + "\n", "utf8");
  }

  console.log(`[tasks] ${dir}`);
  const outerChars = outer.reduce((n, o) => n + chars(o.text), 0);
  console.log(`  заданий ${tasks.length} | инструкции вне задания: ${outer.length ? outer.map((o) => `${o.f} ${chars(o.text)}`).join(", ") + ` = ${outerChars}` : "их еще нет, считаются нулем"}`);
  let bad = 0, thin = 0;
  for (const t of tasks) {
    const c = t.caps;
    const flag = (ok) => (ok ? "" : " ПОТОЛОК");
    console.log(`  ${t.name.padEnd(24)} инструкции ${String(c.instr).padStart(5)}/${CAP_INSTR}${flag(c.ok_instr)} | запреты ${String(c.ban).padStart(4)}/${CAP_BAN}${flag(c.ok_ban)} | материал ${String(c.mat).padStart(5)}/${CAP_MAT}${flag(c.ok_mat)} | больше задания (${c.task}): ${c.ok_task ? "да" : "НЕТ"} | больше всех инструкций: ${c.ok_more ? "да" : "нет"}`);
    if (!(c.ok_instr && c.ok_ban && c.ok_mat && c.ok_task)) bad++;
    else if (c.thin) thin++;
  }
  if (thin) {
    console.log(`  ВНИМАНИЕ: на ${thin} стр. материала меньше, чем всех инструкций. Причина одна: контракт тоньше`);
    console.log("            методички, а методичка на всех страницах одна. Добирать надо фактуру - вопросы уже в gaps.");
  }
  const dup = meta.map((m) => m.title).filter((x, i, a) => a.indexOf(x) !== i);
  for (const d of new Set(dup)) console.log(`  ВНИМАНИЕ: title повторяется на двух страницах: ${d}`);
  for (const m of meta) {
    if (chars(m.title) > TITLE_MAX) console.log(`  ВНИМАНИЕ: ${m.url}: title ${chars(m.title)} знаков`);
    if (chars(m.description) > DESC_MAX) console.log(`  ВНИМАНИЕ: ${m.url}: description ${chars(m.description)} знаков`);
  }
  if (!flags.dry) {
    console.log(`  записано: ${join(dir, "tasks")} (задания и meta.json), ${join(dir, "theses.md")}`);
    console.log("  дальше: агент site-author пишет pages/<slug>.md по своему заданию");
  }
  if (bad) {
    const worst = tasks.find((t) => !(t.caps.ok_instr && t.caps.ok_ban && t.caps.ok_mat && t.caps.ok_task));
    const c = worst.caps;
    console.error(`[tasks] потолки нарушены на страницах: ${bad} из ${tasks.length}. Разбор по ${worst.name}:`);
    if (!c.ok_instr) console.error(`  инструкции ${c.instr} из ${CAP_INSTR}: вне задания ${outerChars} + задание ${c.task}. Резать инструкции вне задания: состав страницы короче не станет.`);
    if (!c.ok_ban) console.error(`  запретов ${c.ban} из ${CAP_BAN}: новый запрет вносится только вместе с образцом.`);
    if (!c.ok_mat) console.error(`  материал ${c.mat} из ${CAP_MAT}: контракт разросся, резать надо его, а не инструкции.`);
    if (!c.ok_task) console.error(`  материала ${c.mat} против ${c.task} знаков задания. Задание перевесило материал - это болезнь v7: конвейер решает за автора вместо того, чтобы дать ему фактуру.`);
    process.exitCode = 1;
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main();
