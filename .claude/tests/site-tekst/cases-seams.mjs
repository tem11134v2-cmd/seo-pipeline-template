// Стыки пакетов программы 2026-09-28-audit-fixes (этап B, интеграция). Запуск:
//   node .claude/tests/site-tekst/cases-seams.mjs      код выхода 0 - все прошли (или через run.mjs рядом).
// Все во временной папке (os.tmpdir()), без сети и данных клиентов; скрипты - из kit шаблона.
// Разделы: 1. task.mjs status: decisions.md - копия шаблона прежнего kit (текст шаблона изменился) по-прежнему «копия
// шаблона», заполненный составителем файл - нет (запрос P3b -> P8); 2. report.mjs: строки импорта «<поле> снят заказчиком
// (Fxx publish no)» - технический пробел, а не вопрос заказчику (запрос P2 -> P4); 3. report.mjs: прототип устарел -
// sha данных сборки или file_sha/proto_sha проверки скриптов не совпадают с текущими (запрос P5 -> P4); 4. .gitignore:
// снимок фиксера pre-fix (fix-diff.mjs) не идет в git, журнал fix-diff.json идет (запрос P4 -> P8); 5. K8: пути живых
// блоков проекта одни у place (task.mjs isOwnPart) и сборщика (site-parts loadProjectRegistry); 6. снятые заказчиком поля
// (noPhone, absentOf) - один модуль scripts/absent.mjs у импорта и оболочки прототипа (программа 05.10, интеграция G).
// Стык K11 (report.mjs -> apply-answers -> импорт) - в .claude/tests/site/run.mjs (там фикстура анализа).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { decisionsIsTemplate, isOwnPart } from '../../skills/site-tekst/task.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const SKILL = path.join(ROOT, '.claude', 'skills', 'site-tekst');
const KIT = path.join(SKILL, 'kit');
let pass = 0, fail = 0;
const failures = [];
function check(name, ok, detail = '') {
  if (ok) pass++;
  else { fail++; failures.push(`FAIL ${name}${detail ? ': ' + String(detail).slice(0, 700) : ''}`); }
}
const rj = f => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, ''));
const wj = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, 2) + '\n'); };
const wt = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };
function run(cwd, args) {
  const r = spawnSync(process.execPath, args, { cwd, encoding: 'utf8' });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '', out: (r.stdout || '') + (r.stderr || '') };
}
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cases-seams-'));
function mkProject(name) {
  const dir = path.join(tmpRoot, name);
  for (const d of ['scripts', 'rules', 'schemas', 'config', 'html']) fs.cpSync(path.join(KIT, d), path.join(dir, d), { recursive: true });
  fs.mkdirSync(path.join(dir, 'work', 'audit'), { recursive: true });
  wj(path.join(dir, 'work', 'sitemap.json'), { pages: [{ slug: 'home', url: '/', type: 'home', subject: 'Главная', parent: '', level: 0, segment: 'S1', status: 'briefed' }] });
  return dir;
}
const sectionOf = (md, h) => { const i = md.indexOf(`## ${h}`); if (i < 0) return ''; const j = md.indexOf('\n## ', i + 3); return md.slice(i, j < 0 ? undefined : j); };

try {
  // ================================================================== 1. decisions.md: копия шаблона прежнего kit
  {
    const tpl = fs.readFileSync(path.join(KIT, 'rules', 'decisions.template.md'), 'utf8');
    // шаблон прежнего kit: те же пустые таблицы, другой текст пояснений (так было до программы 28.09: нет §8, другие шапки)
    const oldTpl = tpl.replace(/## 8\. Спорное[\s\S]*$/, '').replace('Кто что пишет', 'Кто и что пишет').replace('| Второй CTA (другое действие) |', '| Второй CTA (ссылка или кнопка в финальном блоке) |') + '\n| F.. | | | |\n';
    check('decisions: файл, равный шаблону kit, - копия шаблона', decisionsIsTemplate(tpl, tpl));
    check('decisions: копия шаблона прежнего kit (BOM, CRLF) при новом шаблоне - копия шаблона', oldTpl !== tpl && decisionsIsTemplate('﻿' + oldTpl.replace(/\n/g, '\r\n'), tpl));
    check('decisions: без файла шаблона в копии kit - по пустым таблицам', decisionsIsTemplate(oldTpl, ''));
    const row1 = tpl.replace('|---|---|---|---|\n', '|---|---|---|---|\n| F01 | конфликт | «с 2008 года» | все |\n');
    const cta = tpl.replace('| home | | |', '| home | Получить расчет | |');
    const s8 = tpl.trimEnd() + '\n| Нет d3 | раздел 3 пуст | режим doc |\n';
    check('decisions: строка §1, кнопка §3 или строка §8 - файл заполнен', !decisionsIsTemplate(row1, tpl) && !decisionsIsTemplate(cta, tpl) && !decisionsIsTemplate(s8, tpl) && !decisionsIsTemplate(row1, ''));
    const src = fs.readFileSync(path.join(SKILL, 'task.mjs'), 'utf8');
    check('decisions: status task.mjs решает «копия шаблона» через decisionsIsTemplate', /const asTemplate = v2 && decisionsIsTemplate\(/.test(src));
  }

  // ================================================================== 2. report: «снят заказчиком» - для оператора
  {
    const R = mkProject('held');
    const phone = 'телефон +7 (495) 000-00-01 снят заказчиком (F04 publish no): в company и на сайт не идет';
    const addr = 'адрес снят заказчиком (F05 publish no): в company и на сайт не идет';
    wj(path.join(R, 'work', 'facts.json'), { facts: [
      { id: 'F04', label: 'Телефон', value: '+7 (495) 000-00-01', publish: 'no', kind: 'contact' },
      { id: 'F05', label: 'Адрес', value: 'Москва', publish: 'no', kind: 'contact' },
    ], gaps: [phone, addr, 'Сколько стоит замер'] });
    const r = run(R, ['scripts/report.mjs']);
    const md = r.code === 0 ? fs.readFileSync(path.join(R, 'work', 'output', 'report.md'), 'utf8') : '';
    const ask = sectionOf(md, 'Что спросить у заказчика'), held = sectionOf(md, 'Не подтверждено или снято');
    check('report: «<поле> снят заказчиком (Fxx publish no)» - в технических пробелах, не вопрос заказчику', r.code === 0 && !/снят заказчиком/.test(ask) && /Сколько стоит замер/.test(ask)
      && /### Технические пробелы \(для оператора\)[\s\S]*телефон \+7 \(495\) 000-00-01 снят заказчиком \(F04 publish no\)/.test(held) && /адрес снят заказчиком \(F05 publish no\)/.test(held), r.code ? r.out : `${ask}\n${held}`);
    // текст строк импорта (prepareCompany) совпадает с правилом отчета
    const imp = fs.readFileSync(path.join(KIT, 'scripts', 'import-project.mjs'), 'utf8');
    check('report: import-project пишет строки снятых полей в форме, которую отчет относит к оператору', (imp.match(/снят заказчиком \(\$\{f\.id\} publish no\): в company и на сайт не идет/g) || []).length === 2, 'шаблон строки в prepareCompany изменился');
  }

  // ================================================================== 3. report: прототип устарел
  {
    const R = mkProject('stale');
    wj(path.join(R, 'work', 'facts.json'), { facts: [{ id: 'F01', label: 'Срок', value: '3 дня', publish: 'yes', kind: 'number' }], gaps: [] });
    const shaNow = () => run(R, ['--input-type=module', '-e', "import { protoDataSha } from './scripts/render-blocks.mjs'; console.log(protoDataSha());"]).stdout.trim();
    const s0 = shaNow();
    const html = `<!doctype html><html><head><meta name="proto-data-sha" content="${s0}"></head><body></body></html>\n`;
    wt(path.join(R, 'work', 'output', 'prototype.html'), html);
    const fileSha = crypto.createHash('sha1').update(html).digest('hex').slice(0, 16);
    const jsRep = path.join(R, 'work', 'output', 'prototype.js-check.json');
    wj(jsRep, { verdict: 'pass', routes_checked: 1, clicks: 0, errors: [], warnings: [], proto_sha: s0, file_sha: fileSha, checked_at: 'x' });
    const line = () => { const r = run(R, ['scripts/report.mjs']); return r.code === 0 ? (fs.readFileSync(path.join(R, 'work', 'output', 'report.md'), 'utf8').match(/^- Прототип:.*$/m) || [''])[0] : `код ${r.code}: ${r.out}`; };
    const fresh = line();
    check('report: прототип и проверка скриптов по текущим данным - без «устарело»', /^- Прототип:/.test(fresh) && !/устарело/.test(fresh), fresh);
    wj(path.join(R, 'work', 'facts.json'), { facts: [{ id: 'F01', label: 'Срок', value: '5 дней', publish: 'yes', kind: 'number' }], gaps: [] });
    const data = line();
    check('report: данные изменились после сборки - «устарело, пересобрать»', s0 !== shaNow() && /устарело, пересобрать \(данные изменились после сборки\)/.test(data) && !/другую сборку/.test(data), data);
    wj(path.join(R, 'work', 'facts.json'), { facts: [{ id: 'F01', label: 'Срок', value: '3 дня', publish: 'yes', kind: 'number' }], gaps: [] });
    wj(jsRep, { ...rj(jsRep), file_sha: '0000000000000000' });
    const other = line();
    check('report: check-site-js проверял другой файл - «устарело, пересобрать», данные свежие', /устарело, пересобрать \(check-site-js проверял другую сборку\)/.test(other) && !/данные изменились/.test(other), other);
    wj(jsRep, { ...rj(jsRep), verdict: 'skip', skip_reason: 'jsdom не найден' });
    check('report: проверка скриптов SKIP - сверки file_sha нет', !/устарело/.test(line()));
    // check-site-js пишет те же поля, по которым сверяет отчет
    const cjs = fs.readFileSync(path.join(KIT, 'scripts', 'check-site-js.mjs'), 'utf8');
    check('report: check-site-js пишет proto_sha (meta proto-data-sha) и file_sha (sha1 файла, 16 знаков)', /proto-data-sha/.test(cjs) && /file_sha: crypto\.createHash\('sha1'\)\.update\(h0\)\.digest\('hex'\)\.slice\(0, 16\)/.test(cjs));
  }

  // ================================================================== 4. .gitignore: снимок pre-fix
  {
    const probe = ['texts/001-x/work/audit/home/pre-fix/B01-hero.json', 'texts/001-x/work/audit/home/pre-fix/_snap.json', 'texts/001-x/work/audit/home/fix-diff.json', 'texts/001-x/work/audit/home/round-1.json', 'texts/001-x/work/pages/home/blocks/B01-hero.json'];
    const r = spawnSync('git', ['check-ignore', '--no-index', '--stdin'], { cwd: ROOT, input: probe.join('\n'), encoding: 'utf8' });
    if (r.error) check('.gitignore: git недоступен', false, r.error.message);
    else {
      const ign = new Set((r.stdout || '').split(/\r?\n/).filter(Boolean));
      check('.gitignore: снимок pre-fix не идет в git, журнал fix-diff.json, круги судьи и блоки - идут', ign.has(probe[0]) && ign.has(probe[1]) && !ign.has(probe[2]) && !ign.has(probe[3]) && !ign.has(probe[4]), [...ign].join(', '));
    }
    const fd = fs.readFileSync(path.join(KIT, 'scripts', 'fix-diff.mjs'), 'utf8');
    check('.gitignore: fix-diff.mjs кладет снимок в work/audit/<slug>/pre-fix', /const SNAP = path\.join\(AUDIT, 'pre-fix'\)/.test(fd));
  }

  // ================================================================== 5. K8: пути живых блоков проекта
  {
    const own = ['html/site/registry.json', 'html/site/behaviors/calc.js', 'html/site/behaviors/calc.css'];
    const notOwn = ['html/site/site.css', 'html/site/ui.json', 'html/site/behaviors/sub/x.js', 'rules/lint.json'];
    check('K8: place (isOwnPart) считает своими реестр и поведения проекта, файлы kit - нет', own.every(isOwnPart) && !notOwn.some(isOwnPart), JSON.stringify([own.map(isOwnPart), notOwn.map(isOwnPart)]));
    const sp = fs.readFileSync(path.join(KIT, 'scripts', 'site-parts.mjs'), 'utf8');
    check('K8: сборщик читает реестр из html/site и поведения из html/site/behaviors', /export function loadProjectRegistry\(dir = P\('html', 'site'\)\)/.test(sp) && /path\.join\(dir, 'behaviors'\)/.test(sp) && /path\.join\(dir, 'registry\.json'\)|'registry\.json'/.test(sp));
  }

  // ================================================================== 6. снятые заказчиком поля: один модуль на импорт и
  // оболочку прототипа (программа 05.10, пакеты A и D, интеграция G)
  {
    const ab = await import(pathToFileURL(path.join(KIT, 'scripts', 'absent.mjs')).href);
    const sp = await import(pathToFileURL(path.join(KIT, 'scripts', 'site-parts.mjs')).href);
    const src = n => fs.readFileSync(path.join(KIT, 'scripts', n), 'utf8');
    const local = /const (noPhone|absentOf|ABSENT_FIELDS|ABSENT_KIT) =/;
    check('absent.mjs: import-project и site-parts берут noPhone/absentOf из него, своих копий нет', /from '\.\/absent\.mjs'/.test(src('import-project.mjs')) && /from '\.\/absent\.mjs'/.test(src('site-parts.mjs')) && !local.test(src('import-project.mjs')) && !local.test(src('site-parts.mjs')));
    check('absent.mjs: поведение прежнее (no_phone и старое phone_absent, только поля kit без повторов), site-parts реэкспортирует то же', ab.noPhone({ phone_absent: true }) && ab.noPhone({ no_phone: true }) && !ab.noPhone({}) && !ab.noPhone(null) && JSON.stringify(ab.absentOf({ absent: ['email', 'schedule', 'hours', 'email', 'inn'] })) === '["email","hours","inn"]' && JSON.stringify(ab.ABSENT_FIELDS) === '["email","hours","address","legal_name","inn","ogrn"]' && sp.noPhone === ab.noPhone && sp.absentOf === ab.absentOf);
  }
} catch (e) {
  fail++; failures.push(`FAIL исключение: ${e.stack || e.message}`);
} finally {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 3 }); } catch { /* временная папка */ }
}

console.log(`cases-seams: ${pass} ok, ${fail} fail`);
for (const f of failures) console.log(f);
process.exit(fail ? 1 : 0);
