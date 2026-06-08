// 001-index-json-cache.mjs
// ADR-013: реестры задач (_index.json) стали ПРОИЗВОДНЫМ кешем - пересобираются из
// per-folder meta.json (rebuild-index.mjs) и теперь в .gitignore. Проекты, склонированные
// ДО этого решения, могли закоммитить _index.json - из-за этого при параллельной работе
// двух worktree возникают merge-конфликты. Миграция выводит эти файлы из git-индекса
// (оставляя сам файл на диске как кеш). Делается один раз на проект (ADR-013 «Минус/миграция»).

import { existsSync } from "node:fs";
import { join } from "node:path";

export const id = "001-index-json-cache";
export const description = "git rm --cached для отслеживаемых <type>/_index.json (ADR-013)";

const TASK_TYPES = [
  "articles", "strategies", "analyses", "structures",
  "topics", "metatags", "texts", "faq",
];

export default async function migrate(ctx) {
  const { targetRoot, git, log } = ctx;
  let removed = 0;
  for (const type of TASK_TYPES) {
    const rel = `${type}/_index.json`;
    // Отслеживается ли файл git-ом? ls-files --error-unmatch падает (-> null), если нет.
    const tracked = git(["ls-files", "--error-unmatch", "--", rel]);
    if (tracked === null) continue; // не в индексе - нечего делать (идемпотентность)
    // Выводим из индекса, файл на диске сохраняем (--cached).
    git(["rm", "--cached", "-q", "--", rel]);
    removed++;
    log(`выведен из git-индекса: ${rel}` + (existsSync(join(targetRoot, rel)) ? " (файл-кеш сохранён на диске)" : ""));
  }
  if (!removed) log("нет отслеживаемых _index.json - проект уже в порядке");
}
