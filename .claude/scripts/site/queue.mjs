#!/usr/bin/env node
// queue.mjs
// Раскладка проекта v8, вывод следующего шага ИЗ СОДЕРЖИМОГО и единый журнал исключений.
// Списка состояний тут нет намеренно: что сделано, видно по файлам. Единственное, что из
// файлов не выводится, - факт согласования с человеком; его ставит команда gate.
//
// Использование:
//   node queue.mjs init <slug> [--tier basic|seo] [--type services|shop|both]
//                              [--kind landing|multipage] [--root <dir>]
//   node queue.mjs state   [<slug|каталог>] [--json]
//   node queue.mjs docs    [<slug|каталог>] [--understood <url>] [--ask <url>]
//   node queue.mjs log <waiver|violation|gap|dropped> "<предмет>" --ground "<основание>" [<slug|каталог>]
//   node queue.mjs journal [<slug|каталог>]
//   node queue.mjs gate    [<slug|каталог>] --by "<кто согласовал>" [--ground "<основание>"]
//
// Exit: 0 сделано | 2 отказ (нет проекта, пустое основание, чужое значение поля).

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { today } from "./_contract.mjs";

export const KINDS = ["waiver", "violation", "gap", "dropped"];
const TIERS = ["basic", "seo"];
const TYPES = ["services", "shop", "both"];
const SITE_KINDS = ["landing", "multipage"];
const SLUG = /^[a-z0-9][a-z0-9-]{1,59}$/;

// Типографика репозитория: длинное и среднее тире и е-с-точками не доживают до файла.
export const plain = (s) =>
  String(s == null ? "" : s)
    .replace(/ё/g, "е").replace(/Ё/g, "Е")
    .replace(/[‒–—―−]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

const die = (msg) => { console.error("[queue] " + msg); process.exit(2); };

// ---------------------------------------------------------------- раскладка
export function repoRoot(from = process.cwd()) {
  let p = resolve(from);
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(p, ".claude"))) return p;
    const up = resolve(p, "..");
    if (up === p) break;
    p = up;
  }
  return resolve(from);
}

export const sitesDir = (root) => join(root, "sites");
export const isProjectDir = (p) => { try { return existsSync(join(p, "queue.json")); } catch { return false; } };

export function listProjects(root) {
  const d = sitesDir(root);
  if (!existsSync(d)) return [];
  return readdirSync(d)
    .map((n) => join(d, n))
    .filter((p) => { try { return statSync(p).isDirectory() && isProjectDir(p); } catch { return false; } })
    .sort();
}

// Каталог ищем в трех местах: явный путь, sites/<что дали>, совпадение по слагу.
export function findDir(arg, root = repoRoot()) {
  if (arg) {
    const direct = resolve(arg);
    if (isProjectDir(direct)) return direct;
    const inSites = join(sitesDir(root), arg);
    if (isProjectDir(inSites)) return inSites;
    const hit = listProjects(root).find(
      (d) => basename(d) === arg || basename(d).replace(/^\d+-/, "") === arg
    );
    return hit || null;
  }
  if (isProjectDir(process.cwd())) return resolve(process.cwd());
  const all = listProjects(root);
  return all.length ? all[all.length - 1] : null;
}

export const readQueue = (dir) => JSON.parse(readFileSync(join(dir, "queue.json"), "utf8"));
export const writeQueue = (dir, q) => writeFileSync(join(dir, "queue.json"), JSON.stringify(q, null, 2) + "\n", "utf8");

// ---------------------------------------------------------------- следующий шаг
// Ровно одна лестница проверок содержимого. Ни одно состояние нигде не хранится.
export function nextStep(dir) {
  if (!isProjectDir(dir)) {
    return { n: "0", name: "init", need: "каталога и queue.json", cmd: "node .claude/scripts/site/queue.mjs init <slug>" };
  }
  const q = readQueue(dir);
  const has = (...p) => existsSync(join(dir, ...p));
  if (!q.tier || !q.type || !q.site_kind) {
    return { n: "0b", name: "три вопроса оператору", need: "tier, type, site_kind в queue.json",
      cmd: "node .claude/scripts/site/queue.mjs init <slug> --tier <basic|seo> --type <services|shop|both> --kind <landing|multipage>" };
  }
  if (!has("parts", "facts.json")) return { n: "1", name: "фактура", need: "parts/facts.json", cmd: "агент site-intake; publish при засеве всегда no, чего не хватило - в gaps" };
  if (!has("parts", "market.json")) {
    const depth = q.site_kind === "landing" ? "минимальная (лендинг: 2-3 лидера, один тип страницы)"
                                            : "полная (многостраничник: по каждому типу страниц 5-8 лидеров)";
    const money = q.tier === "basic" ? "tier basic - платные инструменты не вызываются вовсе" : "tier seo - платные замеры разрешены";
    return { n: "2", name: "смыслы и разведка", need: "parts/market.json",
      cmd: `агент site-market; глубина замера ${depth}; ${money}` };
  }
  if (!has("project.json")) return { n: "3", name: "сборка контракта", need: "project.json",
    cmd: "node .claude/scripts/site/build-project.mjs <каталог>, затем node .claude/scripts/site/verify-data.mjs <каталог> --seed" };
  const d = q.docs || {};
  if (!has("docs", "understood.html") || !has("docs", "ask.html") || !String(d.understood || "").trim() || !String(d.ask || "").trim()) {
    return { n: "4", name: "два документа и Drive", need: "docs/understood.html, docs/ask.html и ссылок в queue.json",
      cmd: "node .claude/scripts/site/build-doc.mjs <каталог>, затем node .claude/scripts/site/queue.mjs docs --understood <url> --ask <url>" };
  }
  if (!(q.gate && q.gate.approved === true)) {
    return { n: "5", name: "гейт: ответы заказчика", need: "отметки согласования (единственное, что не выводится из файлов)",
      cmd: "node .claude/scripts/site/apply-answers.mjs <каталог> [--apply], затем queue.mjs gate --by \"<кто>\"" };
  }
  return { n: "-", name: "контракт согласован", need: "", cmd: "дальше /site proto: читает project.json и pages.yml" };
}

// ---------------------------------------------------------------- журнал исключений
// Одна запись, одно место, основание обязательно и непусто. Другого журнала в конвейере нет.
export function appendJournal(dir, kind, subject, ground) {
  if (!isProjectDir(dir)) throw new Error(`не проект v8: ${dir}`);
  const k = plain(kind).toLowerCase();
  if (!KINDS.includes(k)) throw new Error(`вид «${kind}» вне набора: ${KINDS.join(", ")}`);
  const s = plain(subject), g = plain(ground);
  if (!s) throw new Error("предмет записи пуст");
  if (!g) throw new Error("основание пусто - запись без основания не принимается");
  const q = readQueue(dir);
  if (!Array.isArray(q.journal)) q.journal = [];
  const entry = { id: `j${q.journal.length + 1}`, at: today(), step: nextStep(dir).n, kind: k, subject: s, ground: g };
  q.journal.push(entry);
  writeQueue(dir, q);
  return entry;
}

// ---------------------------------------------------------------- команды
function parseArgs(argv) {
  const flags = {}, pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) flags[key] = true;
      else { flags[key] = next; i++; }
    } else pos.push(a);
  }
  return { flags, pos };
}

function cmdInit(pos, flags, root) {
  const slug = plain(pos[0] || "").toLowerCase();
  if (!SLUG.test(slug)) die(`слаг «${pos[0] || ""}» не подходит: латиница, цифры и дефис, 2-60 знаков`);
  const pick = (v, list, name) => {
    if (v === undefined || v === true) return "";
    const x = plain(v).toLowerCase();
    if (!list.includes(x)) die(`${name} «${v}» вне набора: ${list.join(", ")}`);
    return x;
  };
  const tier = pick(flags.tier, TIERS, "tier");
  const type = pick(flags.type, TYPES, "type");
  const site_kind = pick(flags.kind, SITE_KINDS, "site_kind");

  const exist = listProjects(root).find((d) => basename(d).replace(/^\d+-/, "") === slug);
  if (exist) {
    const q = readQueue(exist);
    let touched = false;
    if (tier && q.tier !== tier) { q.tier = tier; touched = true; }
    if (type && q.type !== type) { q.type = type; touched = true; }
    if (site_kind && q.site_kind !== site_kind) { q.site_kind = site_kind; touched = true; }
    if (touched) writeQueue(exist, q);
    console.log(`[queue] проект уже есть: ${exist}${touched ? " (ответы оператора обновлены)" : ""}`);
    return cmdState([exist], {}, root);
  }

  const nums = listProjects(root).map((d) => parseInt(basename(d).slice(0, 3), 10)).filter((n) => Number.isInteger(n));
  const nnn = String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, "0");
  const dir = join(sitesDir(root), `${nnn}-${slug}`);
  mkdirSync(join(dir, "parts"), { recursive: true });
  mkdirSync(join(dir, "docs"), { recursive: true });
  writeQueue(dir, {
    v: 2,
    slug,
    dir: `sites/${nnn}-${slug}`,
    created: today(),
    tier, type, site_kind,
    docs: { understood: "", ask: "" },
    gate: { approved: false, by: "", at: "" },
    journal: []
  });
  console.log(`[queue] создан ${dir}`);
  return cmdState([dir], {}, root);
}

function cmdState(pos, flags, root) {
  const dir = findDir(pos[0], root);
  if (!dir) {
    console.log("[queue] проектов v8 нет.");
    console.log("  СЛЕДУЮЩИЙ ШАГ 0 init - node .claude/scripts/site/queue.mjs init <slug> --tier <basic|seo> --type <services|shop|both> --kind <landing|multipage>");
    return 0;
  }
  const q = readQueue(dir);
  const step = nextStep(dir);
  const has = (...p) => existsSync(join(dir, ...p));
  const map = [
    ["parts/facts.json", has("parts", "facts.json")],
    ["parts/market.json", has("parts", "market.json")],
    ["project.json", has("project.json")],
    ["docs/understood.html", has("docs", "understood.html")],
    ["docs/ask.html", has("docs", "ask.html")],
    ["ссылки Drive", Boolean(String((q.docs || {}).understood || "").trim() && String((q.docs || {}).ask || "").trim())],
    ["гейт", Boolean(q.gate && q.gate.approved)]
  ];
  if (flags.json) {
    console.log(JSON.stringify({ dir, slug: q.slug, tier: q.tier, type: q.type, site_kind: q.site_kind, step, have: map.filter(([, v]) => v).map(([k]) => k), missing: map.filter(([, v]) => !v).map(([k]) => k), journal: (q.journal || []).length }, null, 2));
    return 0;
  }
  const j = q.journal || [];
  const byKind = KINDS.map((k) => [k, j.filter((e) => e.kind === k).length]).filter(([, n]) => n);
  console.log(`[queue] ${dir}`);
  console.log(`  слаг ${q.slug} | tier ${q.tier || "-"} | type ${q.type || "-"} | сайт ${q.site_kind || "-"}`);
  console.log(`  есть: ${map.filter(([, v]) => v).map(([k]) => k).join(", ") || "-"}`);
  console.log(`  нет:  ${map.filter(([, v]) => !v).map(([k]) => k).join(", ") || "-"}`);
  console.log(`  журнал: ${j.length} записей${byKind.length ? " (" + byKind.map(([k, n]) => `${k} ${n}`).join(", ") + ")" : ""}`);
  if (q.gate && q.gate.approved) console.log(`  гейт пройден ${q.gate.at} - ${q.gate.by}`);
  console.log(`  СЛЕДУЮЩИЙ ШАГ ${step.n} - ${step.name}${step.need ? ` (нет ${step.need})` : ""}`);
  console.log(`    ${step.cmd}`);
  return 0;
}

function cmdDocs(pos, flags, root) {
  const dir = findDir(pos[0], root);
  if (!dir) die("проект не найден");
  const q = readQueue(dir);
  q.docs = q.docs || { understood: "", ask: "" };
  let touched = false;
  for (const [flag, key] of [["understood", "understood"], ["ask", "ask"]]) {
    const v = flags[flag];
    if (v === undefined || v === true) continue;
    q.docs[key] = plain(v);
    touched = true;
  }
  if (touched) { writeQueue(dir, q); console.log(`[queue] ссылки записаны: документ 1 ${q.docs.understood || "-"} | документ 2 ${q.docs.ask || "-"}`); }
  else console.log(`[queue] документ 1 ${q.docs.understood || "-"} | документ 2 ${q.docs.ask || "-"}`);
  return cmdState([dir], {}, root);
}

function cmdLog(pos, flags, root) {
  const [kind, subject, where] = pos;
  const dir = findDir(where, root);
  if (!dir) die("проект не найден - сначала queue.mjs init <slug>");
  if (!kind) die(`вид записи обязателен: ${KINDS.join(", ")}`);
  const ground = flags.ground === true ? "" : flags.ground;
  try {
    const e = appendJournal(dir, kind, subject, ground);
    console.log(`[queue] ${e.id} ${e.kind} (шаг ${e.step}): ${e.subject}`);
    console.log(`  основание: ${e.ground}`);
  } catch (err) { die(err.message); }
  return 0;
}

function cmdJournal(pos, flags, root) {
  const dir = findDir(pos[0], root);
  if (!dir) die("проект не найден");
  const j = readQueue(dir).journal || [];
  console.log(`[queue] журнал исключений ${dir}: записей ${j.length}`);
  for (const e of j) {
    console.log(`  ${e.id} ${e.at} ${e.kind} (шаг ${e.step}): ${e.subject}`);
    console.log(`     основание: ${e.ground}`);
  }
  if (!j.length) console.log("  пусто - отступлений не было.");
  return 0;
}

function cmdGate(pos, flags, root) {
  const dir = findDir(pos[0], root);
  if (!dir) die("проект не найден");
  const by = flags.by === true ? "" : plain(flags.by || "");
  if (!by) die("нужно имя согласовавшего: gate --by \"<кто>\" - это единственное, что не выводится из файлов");
  if (!existsSync(join(dir, "project.json"))) die("нет project.json - согласовывать нечего");
  const q = readQueue(dir);
  q.gate = { approved: true, by, at: today() };
  writeQueue(dir, q);
  console.log(`[queue] гейт пройден ${q.gate.at} - ${by}`);
  const ground = flags.ground === true ? "" : flags.ground;
  if (ground) { const e = appendJournal(dir, "waiver", "согласование гейта", ground); console.log(`  ${e.id} записан в журнал`); }
  return cmdState([dir], {}, root);
}

function main() {
  const argv = process.argv.slice(2);
  const { flags, pos } = parseArgs(argv);
  const cmd = (pos.shift() || "state").toLowerCase();
  const root = flags.root && flags.root !== true ? resolve(String(flags.root)) : repoRoot();
  switch (cmd) {
    case "init": return cmdInit(pos, flags, root);
    case "state": return cmdState(pos, flags, root);
    case "docs": return cmdDocs(pos, flags, root);
    case "log": return cmdLog(pos, flags, root);
    case "journal": return cmdJournal(pos, flags, root);
    case "gate": return cmdGate(pos, flags, root);
    default:
      die(`команда «${cmd}» неизвестна: init, state, docs, log, journal, gate`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main();
