#!/usr/bin/env node
// run.mjs - сторожевой набор по МАШИНЕРИИ (не по скриптам конвейера).
// Запуск: .claude\scripts\_node.cmd .claude\tests\machinery\run.mjs
//
// Зачем отдельный набор. Остальные сьюты проверяют СКРИПТЫ (сборщики, валидаторы,
// парсеры) - то, что легко вызвать с фикстурой. Обе настоящие поломки боевого
// прогона 23.08.2026 лежали не там:
//   1. агент записал битый JSON (прямая кавычка внутри строкового значения) -
//      конвейер посыпался через несколько ступеней ниже;
//   2. модельная политика docs/MODEL-POLICY.md разошлась с frontmatter агентов
//      (в клиентских клонах docs/ не синкается, а в шаблоне таблица стареет).
// Оба класса ловятся дешево и без живых MCP. Этот набор - первый шаг в ту зону.
//
// Состав:
//   1. Модельная политика против frontmatter: строка таблицы <-> файл агента,
//      совпадение модели, запрет `model: inherit`, честное число в заголовке.
//   2. Висячие ссылки на ADR: каждое упоминание ADR-NNN в .claude/** и docs/**
//      имеет файл docs/adr/NNN-*.md. Обратную сторону (ADR без ссылок) НЕ
//      проверяем - это норма.
//   3. JSON-lint в хуке check-file.sh: битый JSON валится (ненулевой код +
//      внятное сообщение), валидный проходит, маркер при провале не удаляется.
//      Хуку нужны bash и node; если их нет - шаги помечаются SKIP, набор не падает.
//   4. Узкий фолбэк того же хука при непригодном имени агента («*» из matcher,
//      пустой payload): маркер берется, только когда он в .claude/tmp/ ровно один;
//      при двух маркерах проверка пропускается без падения и маркеры не трогаются.
//
// Обоснование политики моделей - docs/MODEL-POLICY.md и ADR-024.
//
// Exit 0 - все тесты прошли (SKIP не считается провалом). Exit 1 - есть провал.

import { spawnSync } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join, resolve, dirname, basename, extname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../../..");
const AGENTS_DIR = join(PROJECT_ROOT, ".claude/agents");
const HOOKS_DIR = join(PROJECT_ROOT, ".claude/hooks");
const SCRIPTS_DIR = join(PROJECT_ROOT, ".claude/scripts");
const ADR_DIR = join(PROJECT_ROOT, "docs/adr");
const MODEL_POLICY = join(PROJECT_ROOT, "docs/MODEL-POLICY.md");
const SANDBOX = join(PROJECT_ROOT, ".claude/tmp/machinery-test");

// === Мини-фреймворк (по образцу style/run.mjs и skill-split/run.mjs) ===
let passed = 0;
let failed = 0;
let skipped = 0;
const failures = [];

function step(name, fn) {
  try {
    const result = fn();
    if (result === true || result === undefined) {
      console.log(`  [test] ${name} ... PASS`);
      passed++;
    } else if (typeof result === "string" && result.startsWith("SKIP")) {
      console.log(`  [test] ${name} ... SKIP (${result.slice(4).replace(/^:\s*/, "")})`);
      skipped++;
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

console.log("=== machinery (модельная политика / ссылки на ADR / JSON-lint в хуке) ===");

// ──────────────────────────────────────────────────────────────────────────
// 1. Модельная политика против frontmatter агентов.
// ──────────────────────────────────────────────────────────────────────────
console.log("");
console.log("=== модельная политика docs/MODEL-POLICY.md <-> .claude/agents/*.md ===");

// Строка таблицы: | agent | model | почему |. Заголовок и разделитель отсекаем.
function parsePolicyTable(src) {
  const rows = [];
  for (const line of src.split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith("|")) continue;
    if (/^\|[\s:|-]+\|$/.test(t)) continue; // разделитель |---|---|---|
    const cells = t.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 2) continue;
    const [agent, model] = cells;
    if (!agent || !model) continue;
    if (!/^[a-z0-9][a-z0-9-]*$/.test(agent)) continue; // шапка «Агент | Модель | Почему»
    rows.push({ agent, model });
  }
  return rows;
}

// frontmatter агента: name / model из блока между первой парой «---».
function parseAgentFrontmatter(file) {
  const src = readFileSync(file, "utf8");
  const m = src.match(/^\ufeff?---\r?\n([\s\S]*?)\r?\n---/);
  const head = m ? m[1] : "";
  const pick = (key) => {
    const r = head.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
    return r ? r[1].trim() : "";
  };
  return { name: pick("name"), model: pick("model") };
}

const policyExists = existsSync(MODEL_POLICY);
const policySrc = policyExists ? readFileSync(MODEL_POLICY, "utf8") : "";
const policyRows = policyExists ? parsePolicyTable(policySrc) : [];
const policyMap = new Map(policyRows.map((r) => [r.agent, r.model]));

const agentFiles = existsSync(AGENTS_DIR)
  ? readdirSync(AGENTS_DIR).filter((f) => f.endsWith(".md")).sort()
  : [];
const agents = agentFiles.map((f) => {
  const fm = parseAgentFrontmatter(join(AGENTS_DIR, f));
  return { file: f, slug: basename(f, ".md"), ...fm };
});

step("docs/MODEL-POLICY.md на месте и таблица агентов парсится", () => {
  if (!policyExists) return "docs/MODEL-POLICY.md отсутствует";
  if (policyRows.length === 0) return "в таблице не распознано ни одной строки агента";
  if (agents.length === 0) return ".claude/agents/*.md не найдены";
  return true;
});

step("каждая строка таблицы имеет файл .claude/agents/<агент>.md", () => {
  const onDisk = new Set(agents.map((a) => a.slug));
  const ghosts = policyRows.map((r) => r.agent).filter((a) => !onDisk.has(a));
  if (ghosts.length > 0) {
    return `в таблице есть агенты без файла (удалены или переименованы): ${ghosts.join(", ")}`;
  }
  return true;
});

// Подсказка на случай клиентского клона: /sync-from-template раскатывает
// .claude/{agents,...}, но НЕ docs/, поэтому там таблица стареет по объективной
// причине. В шаблоне такое расхождение - настоящий дрейф, чинить в docs/.
const DRIFT_HINT =
  "если это клиентский клон - docs/ не раскатывается /sync-from-template, см. .claude/tests/README.md";

step("каждый файл агента есть в таблице модельной политики", () => {
  const missing = agents.map((a) => a.slug).filter((a) => !policyMap.has(a));
  if (missing.length > 0) {
    return `агенты на диске отсутствуют в таблице (новые - ярус не объявлен): ${missing.join(", ")}. ${DRIFT_HINT}`;
  }
  return true;
});

step("модель в таблице совпадает с model: во frontmatter", () => {
  const diff = [];
  for (const a of agents) {
    const want = policyMap.get(a.slug);
    if (!want) continue; // покрыто предыдущим тестом
    if (want !== a.model) diff.push(`${a.slug}: таблица «${want}», frontmatter «${a.model || "(нет)"}»`);
  }
  if (diff.length > 0) return `расхождение: ${diff.join("; ")}. ${DRIFT_HINT}`;
  return true;
});

step("model: объявлен явно, model: inherit запрещен политикой", () => {
  const bad = [];
  for (const a of agents) {
    if (!a.model) bad.push(`${a.slug}: во frontmatter нет model:`);
    else if (a.model === "inherit") bad.push(`${a.slug}: model: inherit`);
  }
  if (bad.length > 0) return bad.join("; ");
  return true;
});

step("frontmatter name: совпадает с именем файла агента", () => {
  const bad = agents.filter((a) => a.name && a.name !== a.slug).map((a) => `${a.file} -> name: ${a.name}`);
  if (bad.length > 0) return `имя во frontmatter расходится с файлом: ${bad.join(", ")}`;
  return true;
});

step("заголовок «Таблица агентов (N)» называет фактическое число агентов", () => {
  const m = policySrc.match(/Таблица агентов\s*\((\d+)\)/);
  if (!m) return "SKIP: в MODEL-POLICY.md нет заголовка вида «Таблица агентов (N)»";
  const declared = Number(m[1]);
  if (declared !== policyRows.length || declared !== agents.length) {
    return `заголовок обещает ${declared}, строк в таблице ${policyRows.length}, файлов агентов ${agents.length}`;
  }
  return true;
});

// ──────────────────────────────────────────────────────────────────────────
// 2. Висячие ссылки на ADR.
// ──────────────────────────────────────────────────────────────────────────
console.log("");
console.log("=== ссылки ADR-NNN в .claude/** и docs/** <-> docs/adr/NNN-*.md ===");

const TEXT_EXT = new Set([
  ".md", ".mjs", ".js", ".cjs", ".json", ".sh", ".cmd", ".bat",
  ".txt", ".html", ".css", ".yml", ".yaml",
]);
// .claude/tmp - рабочая песочница (в .gitignore), сюда пишут сами задачи.
const SKIP_DIRS = new Set(["node_modules", ".git", "tmp"]);

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(e)) continue;
      walk(p, out);
    } else if (TEXT_EXT.has(extname(e).toLowerCase())) {
      out.push(p);
    }
  }
  return out;
}

const adrNumbers = new Set(
  (existsSync(ADR_DIR) ? readdirSync(ADR_DIR) : [])
    .map((f) => (f.match(/^(\d{3})-.*\.md$/) || [])[1])
    .filter(Boolean)
);

const scanned = [
  ...walk(join(PROJECT_ROOT, ".claude"), []),
  ...walk(join(PROJECT_ROOT, "docs"), []),
];

// Формы: ADR-024, ADR 024 (встречается в прозе). Хвостовую цифру исключаем,
// чтобы «ADR-0241» не читалось как ADR-024.
const ADR_REF = /ADR[-\s]?(\d{3})(?!\d)/g;
const refs = new Map(); // номер -> список файлов
for (const file of scanned) {
  let src;
  try {
    src = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  let m;
  ADR_REF.lastIndex = 0;
  while ((m = ADR_REF.exec(src))) {
    const num = m[1];
    if (!refs.has(num)) refs.set(num, new Set());
    refs.get(num).add(file.slice(PROJECT_ROOT.length + 1).split("\\").join("/"));
  }
}

step("сканер видит файлы и находит ссылки на ADR (санити обхода)", () => {
  if (scanned.length < 50) return `обход дал всего ${scanned.length} файлов - похоже, сломан`;
  if (adrNumbers.size === 0) return "docs/adr/ пуст или файлы названы не по схеме NNN-slug.md";
  if (refs.size === 0) return "не найдено ни одной ссылки ADR-NNN - сканер молчит вхолостую";
  return true;
});

step("нет висячих ссылок: у каждой ADR-NNN есть файл docs/adr/NNN-*.md", () => {
  const dangling = [];
  for (const [num, files] of [...refs.entries()].sort()) {
    if (adrNumbers.has(num)) continue;
    const list = [...files].slice(0, 3).join(", ");
    dangling.push(`ADR-${num} (${list}${files.size > 3 ? `, +${files.size - 3}` : ""})`);
  }
  if (dangling.length > 0) return `ссылки без файла решения: ${dangling.join("; ")}`;
  return true;
});

// ──────────────────────────────────────────────────────────────────────────
// 3. JSON-lint в хуке check-file.sh.
// Хук берет PROJECT_ROOT = cwd, читает payload из stdin, ищет маркер
// .claude/tmp/expected-<agent>-<run_id>.txt и валидирует путь из него.
// Готовим изолированный «root» в песочнице, чтобы не задеть реальный .claude/tmp.
// ──────────────────────────────────────────────────────────────────────────
console.log("");
console.log("=== JSON-lint в SubagentStop-хуке check-file.sh ===");

function findSh() {
  for (const bin of ["bash", "sh"]) {
    const r = spawnSync(bin, ["-c", "exit 0"], { encoding: "utf8" });
    if (!r.error && r.status === 0) return bin;
  }
  return null;
}

const sh = findSh();
const hookScript = join(HOOKS_DIR, "check-file.sh");
const AGENT = "zz-machinery-test";
const RUN_ID = "machinerytest";

if (existsSync(SANDBOX)) rmSync(SANDBOX, { recursive: true, force: true });

const hookRoot = join(SANDBOX, "hook-root");
const hookTmp = join(hookRoot, ".claude/tmp");
const markerPath = join(hookTmp, `expected-${AGENT}-${RUN_ID}.txt`);
const targetRel = "out/data.json";
const targetPath = join(hookRoot, targetRel);

// Битый JSON ровно того вида, что уронил боевой прогон: прямая кавычка внутри
// строкового значения. Валидный - тот же текст с кавычками-елочками.
const JSON_BROKEN =
  '{\n  "facts": [\n    { "field": "client_wordings", "value": "клиент сказал "делаем как для себя" и ушел" }\n  ]\n}\n';
const JSON_VALID =
  '{\n  "facts": [\n    { "field": "client_wordings", "value": "клиент сказал «делаем как для себя» и ушел" }\n  ]\n}\n';

// opts.payload      - что подать хуку на stdin (по умолчанию штатный payload с именем агента);
//                     строка идет как есть, объект сериализуется, null - пустой stdin.
// opts.extraMarkers  - имена ДОПОЛНИТЕЛЬНЫХ маркеров в .claude/tmp (эмуляция параллельного веера).
// Песочница пересоздается на каждый вызов: маркеры одного кейса не должны утекать в следующий.
function runHook(jsonBody, opts = {}) {
  const payload = Object.prototype.hasOwnProperty.call(opts, "payload")
    ? opts.payload
    : { agent_name: AGENT, run_id: RUN_ID };
  const extraMarkers = opts.extraMarkers || [];
  if (existsSync(hookRoot)) rmSync(hookRoot, { recursive: true, force: true });
  mkdirSync(hookTmp, { recursive: true });
  mkdirSync(dirname(targetPath), { recursive: true });
  mkdirSync(join(hookRoot, ".claude/scripts"), { recursive: true });
  // Обертка нужна хуку, когда node не лежит в PATH оболочки.
  const nodeSh = join(SCRIPTS_DIR, "_node.sh");
  if (existsSync(nodeSh)) copyFileSync(nodeSh, join(hookRoot, ".claude/scripts/_node.sh"));
  writeFileSync(targetPath, jsonBody, "utf8");
  writeFileSync(markerPath, targetRel + "\n", "utf8");
  for (const name of extraMarkers) writeFileSync(join(hookTmp, name), targetRel + "\n", "utf8");
  const input = payload === null ? "" : (typeof payload === "string" ? payload : JSON.stringify(payload));
  const r = spawnSync(sh, [hookScript], {
    cwd: hookRoot,
    encoding: "utf8",
    input,
  });
  return {
    code: r.status,
    out: (r.stdout || "") + (r.stderr || ""),
    error: r.error,
    markerLeft: existsSync(markerPath),
    extraLeft: extraMarkers.filter((n) => existsSync(join(hookTmp, n))),
  };
}

// Общая причина пропуска: без bash/node хук не работает вовсе.
function hookUnavailable(r) {
  if (r.error) return `SKIP: ${sh} запуск не удался (${r.error.code})`;
  if (/распарсить не удалось/.test(r.out)) return "SKIP: node недоступен оболочке - хук не разбирает payload";
  if (/JSON-проверка пропущена/.test(r.out)) return "SKIP: node недоступен - JSON-lint в хуке не отработал";
  return null;
}

let brokenRun = null;

step("битый JSON: хук возвращает ненулевой код и называет причину", () => {
  if (!sh) return "SKIP: sh/bash недоступна";
  if (!existsSync(hookScript)) return "SKIP: .claude/hooks/check-file.sh отсутствует";
  brokenRun = runHook(JSON_BROKEN);
  const why = hookUnavailable(brokenRun);
  if (why) return why;
  if (brokenRun.code === 0) return `exit 0 (ожидался ненулевой): ${brokenRun.out.slice(-300)}`;
  if (!/JSON не парсится/.test(brokenRun.out)) return `в выводе нет внятного сообщения про JSON: ${brokenRun.out.slice(-300)}`;
  if (!/data\.json/.test(brokenRun.out)) return "в сообщении не назван путь к файлу";
  if (!/строка \d+, колонка \d+/.test(brokenRun.out)) return "в сообщении нет позиции ошибки (строка/колонка)";
  return true;
});

step("маркер expected-*.txt после провала НЕ удален (проверка повторится после починки)", () => {
  if (!sh) return "SKIP: sh/bash недоступна";
  if (!brokenRun) return "SKIP: предыдущий шаг не выполнялся";
  const why = hookUnavailable(brokenRun);
  if (why) return why;
  if (!brokenRun.markerLeft) return "маркер удален - после починки файла хук больше ничего не проверит";
  return true;
});

step("контроль: валидный JSON проходит (exit 0) и маркер снимается", () => {
  if (!sh) return "SKIP: sh/bash недоступна";
  if (!existsSync(hookScript)) return "SKIP: .claude/hooks/check-file.sh отсутствует";
  const r = runHook(JSON_VALID);
  const why = hookUnavailable(r);
  if (why) return why;
  if (r.code !== 0) return `exit ${r.code} (ожидался 0): ${r.out.slice(-300)}`;
  if (r.markerLeft) return "маркер не снят после успешной проверки";
  return true;
});

// ──────────────────────────────────────────────────────────────────────────
// 3б. Узкий фолбэк при непригодном имени агента.
// Имя из payload бывает непригодным: "*" - это matcher из settings.json, а не имя;
// пустой payload вообще не дает имени. Тогда маркер берется, ТОЛЬКО когда он в
// .claude/tmp/ ровно один (параллельных агентов нет - спутать не с чем). Два и
// больше - проверка честно пропускается: глобального фолбэка «самый свежий любой
// маркер» нет, на веере он подхватывал маркер чужого агента.
// ──────────────────────────────────────────────────────────────────────────
console.log("");
console.log("=== узкий фолбэк check-file.sh при непригодном имени агента ===");

step("matcher «*» вместо имени + маркер ровно один -> проверка идет (битый JSON ловится)", () => {
  if (!sh) return "SKIP: sh/bash недоступна";
  if (!existsSync(hookScript)) return "SKIP: .claude/hooks/check-file.sh отсутствует";
  const r = runHook(JSON_BROKEN, { payload: { agent_name: "*", run_id: RUN_ID } });
  const why = hookUnavailable(r);
  if (why) return why;
  if (r.code === 0) return `exit 0 (ожидался ненулевой - фолбэк обязан проверить единственный маркер): ${r.out.slice(-300)}`;
  if (!/JSON не парсится/.test(r.out)) return `проверка не дошла до JSON-линта: ${r.out.slice(-300)}`;
  if (!r.markerLeft) return "маркер снят при провале - после починки файла проверка не повторится";
  return true;
});

step("имя не распарсилось + маркеров ДВА -> проверка пропущена (exit 0), маркеры целы", () => {
  if (!sh) return "SKIP: sh/bash недоступна";
  if (!existsSync(hookScript)) return "SKIP: .claude/hooks/check-file.sh отсутствует";
  const other = "expected-zz-other-agent-parallelrun.txt";
  // Битый JSON в цели: если хук вопреки правилу возьмет чужой маркер - тест увидит exit 2.
  const r = runHook(JSON_BROKEN, { payload: { matcher: "*" }, extraMarkers: [other] });
  if (r.error) return `SKIP: ${sh} запуск не удался (${r.error.code})`;
  if (r.code !== 0) return `exit ${r.code} (ожидался 0 - при двух маркерах фолбэк не работает): ${r.out.slice(-300)}`;
  if (!/маркеров в \.claude\/tmp\/: 2/.test(r.out)) return `в диагностике не названо число маркеров: ${r.out.slice(-300)}`;
  if (!r.markerLeft || r.extraLeft.length !== 1) return "хук тронул маркеры, хотя проверку пропустил";
  return true;
});

step("пустой payload + маркер ровно один -> проверка идет (валидный JSON, маркер снят)", () => {
  if (!sh) return "SKIP: sh/bash недоступна";
  if (!existsSync(hookScript)) return "SKIP: .claude/hooks/check-file.sh отсутствует";
  const r = runHook(JSON_VALID, { payload: {} });
  const why = hookUnavailable(r);
  if (why) return why;
  if (r.code !== 0) return `exit ${r.code} (ожидался 0): ${r.out.slice(-300)}`;
  if (r.markerLeft) return "маркер не снят после успешной проверки по единственному маркеру";
  return true;
});

step("агент известен, но своего маркера нет -> пропуск, чужой маркер не тронут", () => {
  if (!sh) return "SKIP: sh/bash недоступна";
  if (!existsSync(hookScript)) return "SKIP: .claude/hooks/check-file.sh отсутствует";
  const other = "expected-zz-other-agent-parallelrun.txt";
  const r = runHook(JSON_BROKEN, {
    payload: { agent_name: "zz-agent-without-marker", run_id: RUN_ID },
    extraMarkers: [other],
  });
  if (r.error) return `SKIP: ${sh} запуск не удался (${r.error.code})`;
  if (r.code !== 0) return `exit ${r.code} (ожидался 0 - чужой файл хук не проверяет): ${r.out.slice(-300)}`;
  if (!r.markerLeft || r.extraLeft.length !== 1) return "хук удалил маркер чужого агента";
  return true;
});

// Песочница за собой убирается.
if (existsSync(SANDBOX)) rmSync(SANDBOX, { recursive: true, force: true });

// === Итог ===
console.log("");
console.log(`=== ${passed}/${passed + failed} tests passed, ${skipped} skipped ===`);
if (failed > 0) {
  for (const f of failures) console.error(`  FAIL: ${f}`);
  process.exit(1);
}
process.exit(0);
