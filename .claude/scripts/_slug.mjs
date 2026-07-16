#!/usr/bin/env node
// _slug.mjs - единый источник транслита + построения slug/URL + валидации URL для /seo-struktura.
// Импортируют: build-structure-xlsx.mjs (URL посадок), select-top10.mjs (id страницы),
// import-structure.mjs + verify-structure.mjs (валидация URL). Одна карта, одни правила.

// --- 1. Единая карта транслита (была продублирована в build-structure-xlsx и select-top10) ---
export const TRANSLIT_MAP = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "j",
  к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
  х: "h", ц: "c", ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

export function transliterate(str) {
  return String(str || "").toLowerCase().split("").map((c) => (c in TRANSLIT_MAP ? TRANSLIT_MAP[c] : c)).join("");
}

// --- 2. Низкоуровневый базис (ПОВЕДЕНИЕ старого slugifyId - для id страницы) ---
// Транслит + [^a-z0-9]+ -> дефис + схлоп + trim + обрезка по символам. БЕЗ скобок/стоп-слов/слов-лимита.
// КРИТИЧНО: это бит-в-бит поведение старого slugifyId из select-top10.mjs - id это ключ идемпотентности
// в decisions.json, менять алгоритм id нельзя (сдвинет ключи у живых проектов).
export function slugifyBase(name, { maxLen = 60 } = {}) {
  return transliterate(name)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLen) || "page";
}

// --- 3. Стоп-слова URL (выкидываются из slug посадки; в id НЕ применяются) ---
// Сравнение идет по УЖЕ транслитерированным токенам. Список в кириллице для читаемости мейнтейнером,
// на загрузке модуля транслитерируется в латиницу. Список - осознанно редактируемая константа.
// Примечание (вердикт стратега по стоп-словам): "под" сюда НЕ включен - "под ключ" значимая коммерческая
// фраза (remont-pod-klyuch лучше, чем remont-klyuch), лимиты 5 слов / 60 символов и так держат длину.
const STOPWORDS_RU = [
  // транзакционные (в URL не несут смысла посадки, раздувают slug)
  "купить", "цена", "цены", "заказать", "заказ", "стоимость", "недорого",
  "дешево", "дешевые", "распродажа", "акция", "скидка", "прайс",
  // служебные/пояснительные (часто прилетают из названия в скобках)
  "уточнить", "например", "смотри", "см", "др", "прочее", "разное", "итд",
  // союзы/предлоги
  "в", "на", "для", "и", "с", "по", "от", "до", "из", "у", "о", "об", "к",
  "за", "над", "при", "про", "а", "но", "или", "же", "бы", "ли",
];
export const STOPWORDS = new Set(STOPWORDS_RU.map((w) => transliterate(w)));

// --- 4. Вырезание содержимого скобок целиком: ( ) [ ] { } ---
export function stripBrackets(str) {
  let s = String(str || "");
  // сматченные пары со всем содержимым (нежадно), несколько проходов на вложенность
  for (let i = 0; i < 3; i++) s = s.replace(/[([{][^)\]}]*[)\]}]/g, " ");
  // одиночные висячие скобки (незакрытые) - тоже убрать
  return s.replace(/[()[\]{}]/g, " ");
}

// --- 5. Построение slug посадки: скобки -> транслит -> стоп-слова -> лимиты по ГРАНИЦЕ слова ---
export function buildSlug(source, { maxLen = 60, maxWords = 5 } = {}) {
  const cleaned = transliterate(stripBrackets(source));
  let words = cleaned.split(/[^a-z0-9]+/).filter(Boolean);
  let kept = words.filter((w) => !STOPWORDS.has(w));
  if (kept.length === 0) kept = words;       // все оказалось стоп-словами -> не отдаем пустоту
  kept = kept.slice(0, maxWords);            // лимит по числу слов
  // лимит по длине - обрезаем ПО ГРАНИЦЕ слова (не режем слово посередине)
  const out = [];
  let len = 0;
  for (const w of kept) {
    const add = (out.length ? 1 : 0) + w.length; // +1 на дефис
    if (len + add > maxLen) break;
    out.push(w); len += add;
  }
  const slug = out.join("-").replace(/-+/g, "-").replace(/^-+|-+$/g, "");
  return slug || slugifyBase(source, { maxLen });   // жесткий фолбэк, если слово одно и оно длиннее maxLen
}

// --- 6. Префиксы по типу (как сейчас в makeUrl) ---
const PREFIX_BY_TYPE = {
  home: "/", category: "/catalog/", service: "/uslugi/", product: "/catalog/",
  article: "/blog/", info: "/", other: "/",
};

// --- 7. URL посадки. Приоритет источника + префикс + уникальность в рамках проекта ---
// ctx.marker  - маркерный запрос страницы (из markers.json), передает вызывающий по n/id.
// ctx.usedUrls - Map<string, number>, общий на весь проход (счетчик коллизий).
export function buildPageUrl(page, ctx = {}) {
  // 7.1 verbatim-источники (реальные URL клиента) - не трогаем, не слугифицируем
  if (page.client_current_url) return page.client_current_url;
  if (page.migration_target_url) return page.migration_target_url;
  if (page.type === "home") return "/";

  // 7.2 источник для генерации: МАРКЕР -> иначе page.name
  const source = (ctx.marker && String(ctx.marker).trim()) ? ctx.marker : page.name;
  let slug = buildSlug(source);

  // 7.3 уникальность в рамках проекта - осмысленная дифференциация, потом числовой суффикс
  const prefix = PREFIX_BY_TYPE[page.type] || "/";
  const used = ctx.usedUrls;
  if (used) {
    let candidate = `${prefix}${slug}/`;
    if (used.has(candidate)) {
      // (1) осмысленно: добавить slug раздела/категории, если есть
      const diff = buildSlug(page.category || page.section || "");
      if (diff && !slug.includes(diff)) {
        slug = buildSlug(`${source} ${page.category || page.section}`);
        candidate = `${prefix}${slug}/`;
      }
      // (2) иначе числовой суффикс -2, -3, ...
      let k = 2;
      while (used.has(candidate)) { candidate = `${prefix}${slug}-${k}/`; k++; }
    }
    used.set(candidate, 1);
    return candidate;
  }
  return `${prefix}${slug}/`;
}

// --- 8. Валидатор URL (переиспользуют import-structure и verify-structure) ---
// Правила: латиница/цифры/дефис/слэш, длина <= maxLen, без скобок/пробелов/кириллицы,
// без двойных слэшей и двойных дефисов. Возвращает массив причин (пустой = ок).
export function validateUrl(url, { maxLen = 70 } = {}) {
  const reasons = [];
  const u = String(url || "");
  if (!u.trim()) { reasons.push("пустой URL"); return reasons; }
  if ([...u].length > maxLen) reasons.push(`длина ${[...u].length} > ${maxLen}`);
  if (/[а-яё]/i.test(u)) reasons.push("кириллица в URL");
  if (/\s/.test(u)) reasons.push("пробелы в URL");
  if (/[()[\]{}]/.test(u)) reasons.push("скобки в URL");
  if (/\/\//.test(u)) reasons.push("двойной слэш");
  if (/--/.test(u)) reasons.push("двойной дефис");
  // разрешено: латиница/цифры/дефис/слэш (+ ведущий слэш)
  const stripped = u.replace(/[a-z0-9\-/]/gi, "");
  if (stripped) reasons.push(`недопустимые символы: ${[...new Set(stripped.split(""))].join("")}`);
  return reasons;
}
