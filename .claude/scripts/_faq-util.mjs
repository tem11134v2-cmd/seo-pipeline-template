// _faq-util.mjs - общие утилиты /seo-faq
// Единый источник нормализации URL + декода сущностей + резолва self-url.
// Импортируется build-faq.mjs, build-faq-docx.mjs, verify-faq.mjs - чтобы все три
// сравнивали URL ОДИНАКОВО (иначе рассинхрон гейта и docx).
//
// Нормализация URL: host регистронезависимо, path как есть; отбросить схему, www, query, hash, index-файл, хвостовой слэш.
import { readFileSync } from "node:fs";
import { join, dirname, basename } from "node:path";

export function normalizeUrl(u) {
  if (!u) return "";
  let s = String(u).trim();
  s = s.replace(/^https?:\/\//i, "");
  s = s.replace(/^www\./i, "");
  s = s.replace(/[?#].*$/, "");
  const slash = s.indexOf("/");
  if (slash === -1) s = s.toLowerCase();
  else s = s.slice(0, slash).toLowerCase() + s.slice(slash);
  s = s.replace(/\/(index|default)\.(html?|php|aspx)$/i, "/");
  s = s.replace(/\/+$/, "");
  return s;
}

export function sameUrl(a, b) {
  const na = normalizeUrl(a), nb = normalizeUrl(b);
  return na !== "" && na === nb;
}

// Декод HTML-сущностей в порядке lt/gt/quot/amp (amp ПОСЛЕДНИМ - иначе двойной декод).
export function htmlDecode(s) {
  return String(s)
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

// Резолв self-URL страницы по pages.json. faqDir = dirname(dirname(pageDir)).
export function resolveSelfUrl(pageDir, slugHint) {
  try {
    const faqDir = dirname(dirname(pageDir));
    const pj = JSON.parse(readFileSync(join(faqDir, "pages.json"), "utf8").replace(/^﻿/, ""));
    const slug = slugHint || basename(pageDir);
    const rec = (pj.pages || []).find((p) => p.slug === slug);
    return rec ? (rec.url || "") : "";
  } catch { return ""; }
}

// Пул смежных URL из inputs.json.interlink_pool. null = файла/поля нет (деградация в W у verify).
export function readPool(pageDir) {
  try {
    const faqDir = dirname(dirname(pageDir));
    const inp = JSON.parse(readFileSync(join(faqDir, "inputs.json"), "utf8").replace(/^﻿/, ""));
    return Array.isArray(inp.interlink_pool) ? inp.interlink_pool : null;
  } catch { return null; }
}
