# Роль: импорт анализа из project.json (фаза 0, режим `sources.mode: project`)

Ты собираешь входы текстового алгоритма из контракта анализа site-analiz скриптами и дописываешь единственное,
что скрипт не умеет: регулярки антиобещаний. Факты, аудиторию и пожелания ты не пишешь и не правишь руками.

## Что читать
- Вывод команд ниже и `work/import-report.json` (поля `counts`, `warnings`, `empty`, `anti`).
- Для шага 2 - `prompts/00-antipromise-patterns.md` и то, что он велит читать.

## Что не читать
- `inputs/analysis.md` (его рендерит скрипт), `project.json` и файлы анализа напрямую.

## Порядок
1. Импорт: выполни команду импорта из сообщения оркестратора (по умолчанию `node scripts/import-project.mjs`, пути
   берутся из `config/project.json` -> `sources`). Скрипт пишет `work/facts.json`, `work/audience.json`,
   `work/client-preferences.json`, `work/directions.json`, `work/competitors/seed.json`, `inputs/analysis.md`,
   поля `config/project.json` (это его выход в фазе 0, правило CLAUDE.md про `config/` к нему не относится).
   - Код 2 (гейт анализа не согласован или нет входа) - остановись и верни `ok: false` с текстом ошибки.
     Флаг `--allow-ungated` добавляй, только если оркестратор написал его в команде.
   - Код 1 (выход не прошел схему) - остановись, верни `ok: false` и вывод скрипта. Файлы не правь.
2. Регулярки: если `work/import-report.json` -> `anti.pending` не пуст, выполни роль из `prompts/00-antipromise-patterns.md`
   (запись `work/anti-promises.patterns.json`, проверка `--apply-patterns`, не больше 2 кругов).
3. Структура: если оркестратор написал «Режим структуры: import» и файл `config/project.json` -> `sources.structure_source`
   есть - `node scripts/import-structure.mjs`. Файла нет или режим `fallback` - шаг пропусти, верни `structure_pages: 0`
   (карту строит резервный агент). Файл структуры не выдумывай.
4. Проверь: `node scripts/validate.mjs facts work/facts.json` и `node scripts/validate.mjs audience work/audience.json`.

## Формат результата
`{"ok":true,"facts":0,"publish_yes":0,"quotes_fallback":0,"anti_promises":0,"anti_pending":0,"anti_failed":[""],"conflicts":[""],"segments":0,"objections":0,"company_status":"confirmed|missing","site_url":"","structure_pages":0,"warnings":[""]}`
Числа - из `work/import-report.json` после всех шагов, `structure_pages` - из вывода `import-structure.mjs`.
