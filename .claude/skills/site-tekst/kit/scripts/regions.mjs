// Регион бизнеса -> база Keys.so и код региона Яндекса (отбор конкурентов фазы 2 и импорт анализа).
// Таблицы CITIES и FEDERAL и граница B - копия из .claude/scripts/validate-project-input.mjs и .claude/scripts/site/
// _contract.mjs (/seo-struktura): одно правило на обе стороны, kit работает и без файлов шаблона. Литералы копируются
// дословно; равенство копии и оригинала сверяет набор tests/site-tekst (cases-kf-select.mjs). При правке там - поправить тут.
// Модуль без CLI: parseRegion(text) -> { city, keyso_base, yandex_id, federal, city_not_in_keyso, yandex_fallback_213 }.
// city - имя города из таблицы или null; федеральный или неизвестный регион - msk и 213 (city_not_in_keyso: true,
// yandex_fallback_213: true), как в validate-project-input.

const B = "(^|[^а-яa-z])";

const CITIES = [
  // [база Keyso, код Яндекса, имя, основа]
  ["msk", 213, "Москва", "москв|подмосков"],
  ["spb", 2, "Санкт-Петербург", "санкт|петербург|спб|питер|ленинградск|ленобл"],
  ["ekb", 54, "Екатеринбург", "екатеринбург|екб|свердловск"],
  ["nsk", 65, "Новосибирск", "новосибирск"],
  ["kzn", 43, "Казань", "казан"],
  ["nnv", 47, "Нижний Новгород", "нижн[а-я]*\\s+новгород|нижегородск|н\\.\\s*новгород"],
  ["che", 56, "Челябинск", "челябинск"],
  ["sam", 51, "Самара", "самар"],
  ["rnd", 39, "Ростов-на-Дону", "ростов"],
  ["tom", 67, "Томск", "томск"],
  ["krr", 35, "Краснодар", "краснодар|кубан"],
  ["vrn", 193, "Воронеж", "воронеж"],
  ["vlg", 38, "Волгоград", "волгоград"],
  ["ufa", 172, "Уфа", "уф(?:а|е|у|ой|ы)(?![а-я])|башкир|башкорт"],
  ["prm", 50, "Пермь", "перм"],
  ["kry", 62, "Красноярск", "красноярск"],
  ["oms", 66, "Омск", "омск"],
  ["sar", 194, "Саратов", "саратов"],
  ["tmn", 55, "Тюмень", "тюмен"],
  ["mns", 157, "Минск", "минск"],
  // код Яндекса есть, базы Keyso нет
  [null, 15, "Тула", "тул(?:а|е|у|ой|ы|ьск)(?![а-я])"],
];
const FEDERAL = new RegExp(B + "(росси|рф(?![а-я])|вся страна|по всей|снг|федеральн)");

export { CITIES, FEDERAL };

export function parseRegion(text) {
  const low = String(text ?? '').toLowerCase().replace(/\u0451/g, 'е');
  // первый по положению в строке город: «Москва и Санкт-Петербург» -> Москва
  let city = null, at = Infinity;
  for (const row of CITIES) {
    const m = new RegExp(B + '(' + row[3] + ')').exec(low);
    if (m && m.index < at) { city = row; at = m.index; }
  }
  const federal = !city && FEDERAL.test(low);
  return {
    city: city ? city[2] : null,
    keyso_base: city && city[0] ? city[0] : 'msk',
    yandex_id: city ? city[1] : 213,
    federal,
    city_not_in_keyso: !(city && city[0]),
    yandex_fallback_213: !city,
  };
}
