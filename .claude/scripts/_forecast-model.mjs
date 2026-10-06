#!/usr/bin/env node
// _forecast-model.mjs - модель прогноза и экономики /seo-strategiya v2 (06.10.2026).
// Чистые функции, без I/O. Единый источник чисел для build-forecast.mjs, build-smeta-xlsx.mjs,
// build-strategy-docx.mjs и verify-strategy.mjs. Меняешь формулу или константу тут - меняется везде.
//
// Чем отличается от старой модели (_forecast-money.mjs, плоский масштаб x0,6 / x1,0 / x1,3):
// 1. Кривая у каждого тарифа своя и собирается из ВКЛАДА УСЛУГ: ПФ и техника дают быстрый старт на
//    существующих страницах, структура и тексты - новые страницы под спрос с лагом внедрения и индексации,
//    статьи - накопительный инфо-трафик, Карты - усиление ПФ (x1,5; без ПФ - буст) и прямые обращения,
//    ссылки - не раньше 3-4 мес (лаг 4), прототип КФ/КНДР - конверсию.
//    Старт с ПФ разгоняется за 2-3 мес почти как Рост, а на 6 и 12 мес Рост уходит вперед за счет страниц.
// 2. Калибровка по кейсам агентства (cases.timur-seo.ru, 13 проектов, данные Метрики), с поправкой на
//    отбор лучших кейсов (x0,8-0,9 к медианам). Константы и источники - в CAL ниже.
// 3. Деньги считаются только с ПРИРОСТА над текущим трафиком (m0 без работ остается у клиента и так).
// 4. Окно 24 мес: первые 12 - для ROMI года и окупаемости, второй год - работы продолжаются, сделанное
//    держится. Затраты: разовые в 1-м мес, ежемесячные каждый мес, акции (ПФ 1=2) вычитаются.
//
// Конверсия визит -> обращение по умолчанию 5% для услуг: в кейсах медиана 9,1% (Q1 7,2%, цели Метрики,
// включая клики по телефону и мессенджерам), берем с запасом. ROMI - от валовой прибыли (выручка x маржа).

export const MODEL_VERSION = "v2.3";
export const TARIFF_KEYS = ["start", "growth", "max"];
export const HORIZON = 24;

// ═══ Калибровка (менять осознанно, с источником) ═══
export const CAL = {
  // Визитов в месяц на коммерческую страницу в индексе на зрелости. Кейсы услуг: Q1 8,0, медиана 9,0
  // (кадровый-элемент, spk-nhs, medkomissii89, sinestet, работа-эскорт, ti-o-ty); x0,8 на отбор.
  // Для магазина это категории и посадочные фильтров; карточки товаров - отдельно (vpp_card):
  // 0,6-2 визита на карточку (vivarent, garmin).
  // v2.3 (приемка владельца 06.10, второй раз «слишком скептично»): у нового сайта Рост с ПФ и полным комплектом
  // давал ~250 переходов к 12-му мес у всех тарифов - уровень = страниц x 7, а ПФ и Карты меняли только скорость.
  // Практика владельца: Рост на целиком оптимизированном сайте (~35-40 страниц под спрос) выходит на ~600 переходов -
  // без ПФ за 12+ мес, с ПФ за ~6 мес; с ПФ и Картами 250+ к 3-4 мес. Кейсы (7-9 визитов) сняты в моменте, часть
  // страниц не созрела. Уровень зрелой страницы без ПФ - x2 к кейсам; ПФ поднимает его еще (pf_new_level_mult).
  vpp: { services: 15, medical: 15, b2b: 12, high_ticket: 10, ecommerce: 8, info: 10 },
  vpp_card: 0.8,
  // Существующие страницы клиента без нашей доработки: доля уровня зрелой оптимизированной страницы.
  vpp_existing_share: 0.6,
  // Новые страницы сильного сайта наследуют доверие домена: визитов на новую страницу не меньше
  // 0,6 x (текущий трафик / коммерческих страниц), но не больше 4 x vpp.
  vpp_inherit_share: 0.6,
  vpp_inherit_max_mult: 4,

  // Потолок: доля суммы ТОЧНЫХ частот маркеров коммерческого спроса ниши в регионе, которую сайт
  // забирает на зрелости вместе с хвостами (кадровый-элемент 2,7% в 1-й полный мес с 54 маркерами,
  // работа-эскорт 25,7% к m9-m11). Ограничивает сверху, не задает уровень.
  // v2.1 (боевой прогон 06.10, 5 клиентов): сумма точных частот главных фраз в 5-10 раз меньше реального спроса
  // (нет хвостов, форм с городом, области) - жесткий потолок 20% обрезал прогноз к m3-m4 у всех 5 клиентов.
  // Теперь потолок МЯГКИЙ (softCap) и берется как максимум из: точный спрос x доля (ниже), трафик лидера прямых
  // конкурентов x leader_share, медиана прямых x median_mult, текущий трафик x t0_mult.
  demand_share_cap: { low: 1.0, medium: 0.8, high: 0.6 },
  // v2.3: точный спрос маркеров - без хвостов, форм с городом и пригородов (реальный спрос в 5-10 раз больше, см. выше);
  // потолок по спросу считаем с хвостами x2,5 (у потолков Сочи 347 точных давали потолок 311 при лидере ~200 по Keys.so).
  demand_tail_mult: 2.5,
  // Keys.so занижает трафик примерно вдвое против Метрики (медиана 0,6 по 9 сайтам, добор критика) - поэтому
  // лидер x1,5: новый сайт с полной структурой может догнать и обогнать местного лидера по его оценке Keys.so.
  cap_competitors: { leader_share: 1.5, median_mult: 1.5 },
  cap_t0_mult: 2.5,
  soft_cap_knee: 0.6,                            // до 60% потолка - без среза, дальше плавно к потолку

  // Рост существующего трафика с ПФ. Калибровка по ПОРТФЕЛЮ (Monstro + Метрика, 13 сайтов на ПФ, 06.10.2026),
  // база 100+: m1 x1,03, m2 x1,42, m3 x1,72 (Q1 1,47 - Q3 1,88), m6 x2,38 (n=4), m12 x2,58 (n=3, с параллельными
  // факторами). Модель: m1 ~1,1, m2 ~1,45, m3 ~1,74, m6 ~2,08, плато 2,2 - по m3 как портфель, дальше чуть ниже.
  // Витрина кейсов (m3 x2,14) не берется: это лучшие проекты.
  pf_mult_max: 2.2,
  pf_ramp: { lag: 0.9, tau: 2.2 },
  // Без ПФ существующие страницы растут медленно (портфель без ПФ: m3 x0,88-1,03, часть сайтов падала до старта;
  // prostoevent x1,0-1,08 за 3 мес, около x1,2-1,3 к году).
  nopf_mult_max: 1.25,
  nopf_ramp: { lag: 3, tau: 4 },
  // Убывающая отдача множителя на большой базе: f = clamp((400 / t0)^0.25, 0.45, 1).
  mult_ref_t0: 400,
  mult_floor: 0.45,

  // Новые страницы под спрос (структура SY): лаг = готовность структуры + внедрение у клиента (цепочка
  // PA -> SY -> KP ~1 мес + внедрение), разгон считается от запуска страниц (t - lag).
  // v2.1: новые сайты с ПФ - 45-75% уровня к m3 от запуска, 75-95% к m6 -> tau 2,5 (70% / 91%); tau 1,5 давал
  // 86% / 98% (быстрее кейсов) и уводил Рост от Старта уже на 3-м мес. В v2.2 tau 2,0 (ниже).
  // v2.2 (практика владельца, 06.10): ПФ не только дает быстрый старт, но и ускоряет выход новых страниц в топ -
  // уровень, на который Рост без ПФ выходит за 12+ мес, с ПФ достижим за ~6 мес. С ПФ: 86% уровня через 4 мес после
  // лага (к m6); без ПФ: 90% только к ~13-му мес.
  // v2.3: lag - когда выходят новые страницы. Живой сайт: PA -> SY -> KP ~1,2 мес + внедрение разработчиком клиента
  // -> ~2,5 мес. Новый сайт: страницы выходят с запуском, разгон от запуск + live_lag. tau с ПФ 2,0 (с Картами 1,33 -
  // x1,5 быстрее; новый домен без Карт - x1,3 медленнее и на полмесяца позже), без ПФ 5,0.
  // Ориентиры владельца (~40 страниц, Рост, уровень с ПФ ~720, с ПФ и Картами ~780): живой сайт с ПФ - ~600 к 6-му мес
  // (83%), с ПФ и Картами - ~250 к 3-му и ~530 к 4-му; без ПФ - ~45% к 6-му и ~84% к 12-му («600 только за 12+ мес»);
  // новый сайт с ПФ и Картами - 100+ в 1-й мес после запуска, с ПФ без Карт на новом домене - меньше 100.
  new_pages_ramp_pf: { lag: 2.5, tau: 2.0, live_lag: 0.7 },
  new_pages_ramp_nopf: { lag: 3, tau: 5.0, live_lag: 1.0 },
  // ПФ поднимает и уровень новых страниц (держит их в топе): x1,2; Карты усиливают этот эффект x1,5 (-> x1,3),
  // ПФ Продвинутый - x1,3 к эффекту ПФ.
  pf_new_level_mult: 1.2,
  // ПФ Продвинутый (PFP, 45 000 ₽/мес - больший объем запросов для высокой конкуренции): эффект ПФ x1,3 (прирост
  // множителя существующих страниц и уровня новых) и разгон в 1,15 раза быстрее. До v2.3 PFP считался как PF -
  // Максимум платил +20 000 ₽/мес без эффекта и уходил в минус.
  pfp_strength: 1.3,
  pfp_speed: 1.15,
  // Карты (YM) повышают суммарную эффективность ПФ в среднем в 1,5 раза (практика владельца): эффект ПФ на
  // существующих страницах x1,5 и разгон в 1,5 раза быстрее (и существующих, и новых страниц).
  pf_ym_synergy: 1.5,
  // Новый сайт на новом домене без ссылочного веса: ПФ без Карт почти не выводит даже первые 100 переходов в первый
  // месяц - разгон новых страниц позже и медленнее (в 1-й мес после запуска десятки переходов, < 100); ПФ вместе с
  // Картами - обычный разгон. v2.3: 0,2 мес и x1,3 (раньше 0,5 и x1,5 - вместе с новым live_lag давало ровный 0).
  new_domain_no_ym: { extra_lag: 0.2, tau_mult: 1.3 },
  // Без ПФ в конкурентной нише новые страницы добирают меньше (кейсы: ПФ определяет скорость, а в
  // высокой конкуренции и уровень).
  // v2.2: по практике владельца без ПФ сайт выходит на тот же уровень, только вдвое дольше (12+ мес против 6) -
  // штраф уровня без ПФ мягкий, главное отличие - скорость (new_pages_ramp_nopf).
  nopf_level_factor: { low: 1.0, medium: 0.95, high: 0.8 },
  // Качество текстов новых страниц: есть KP (тексты в прототипе) или FQ (n-граммы) - 1,0;
  // только структура (тексты пишет клиент) - 0,75.
  content_q_with_texts: 1.0,
  // KP (тексты) + FQ (n-граммы и FAQ) вместе: FAQ добирает недостающие ключи и на новых страницах (приемка 06.10: без
  // этого Рост = Старт + FQ у нового сайта не отличался от Старта и проваливал гейт).
  content_q_kp_fq: 1.1,
  content_q_structure_only: 0.75,

  // Бусты на весь коммерческий трафик (множители с лагом). Источники: кейсы техаудита (lp-teh),
  // FAQ/n-граммы и КФ - экспертная оценка по прогонам; ссылки и Карты в кейсах не замерены - оценка.
  boosts: {
    // v2.2: техаудит дает заметный разовый буст только при серьезных ошибках (tech_critical: ошибки индексации,
    // зеркал, массовые дубли) - тогда x1,12; иначе почти ничего (x1,02).
    FA: { mult: 1.02, lag: 2, tau: 1.5 },        // техаудит (внедрение разработчиком клиента)
    BS: { mult: 1.08, lag: 1, tau: 1 },          // базовое SEO Tilda (делаем сами)
    MT: { mult: 1.05, lag: 1.5, tau: 1 },        // метатеги отдельно
    FQ: { mult: 1.12, lag: 2.5, tau: 2 },        // n-граммы + FAQ на коммерческих страницах
    KP_rank: { mult: 1.10, lag: 3, tau: 2 },     // КФ/КНДР лидеров на сайте - коммерческие факторы
    // v2.2: ссылки - сильнее всего на Google и не раньше чем через 3-4 мес; в Яндексе (основной трафик) слабее.
    LB: { mult: 1.06, lag: 4, tau: 3 },
    LA: { mult: 1.12, lag: 4, tau: 3 },
    // Карты без ПФ (редкий случай): только перенос веса карточки на сайт. С ПФ Карты работают через pf_ym_synergy.
    YM: { mult: 1.08, lag: 1, tau: 2 },
  },
  fa_critical_mult: 1.12,                        // FA при серьезных тех. ошибках (tech_critical)

  // Конверсия: прототип КФ/КНДР на сайте поднимает конверсию (кейсы MK: 1% -> 4%; cn-exclusive
  // 4,7% -> 9,1%) - берем x1,3 с лагом внедрения.
  kp_conv_mult: 1.25,
  kp_conv_ramp: { lag: 3, tau: 1.5 },

  // Статьи (AR, 10 шт/мес после сбора тем IT): визитов на статью на зрелости, созревание статьи.
  ar_per_month: 10,
  ar_start_month: 2,
  ar_vpa: 8,
  ar_tau: 3,
  info_cap_share: 0.08,                          // потолок инфо-трафика: доля инфо-спроса
  info_conv_factor: 0.15,                        // инфо-трафик конвертится хуже коммерческого

  // Карты (YM): прямые обращения из карточки (звонки, маршруты) - доля коммерческого спроса в месяц.
  // Кейсы MK по Картам: звонки 43 -> 148, 37 -> 329 в мес. Доля зависит от того, ищут ли бизнес на
  // карте: локальные услуги и медицина - да, дорогие и B2B-покупки - редко, магазин - почти нет.
  // v2.1 (приемка 06.10): 0,2% спроса давали медцентру 18 обращений в мес и держали на себе плюс Роста -
  // доли 0,15% (кейсы MK по Картам: +105 и +292 звонка в мес - модель заметно консервативнее), а при уже
  // существующей карточке считается только прирост (ym_existing_card_factor).
  ym_leads_share: { services: 0.0015, medical: 0.0015, b2b: 0.0002, high_ticket: 0.0002, ecommerce: 0.0001, info: 0 },
  ym_existing_card_factor: 0.7,
  ym_leads_min: 3,
  ym_leads_ramp: { lag: 1, tau: 2 },
  ym_card_create_lag: 0.5,                       // карточки нет - первая неделя уходит на оформление

  // Цикл сделки: обращение этого месяца становится продажей через N мес (дома, недвижимость - решение 3-12 мес;
  // B2B - согласования). Без лага окупаемость дорогих услуг выходила «1 мес» (боевой прогон топдом.рф).
  sales_lag_months: { high_ticket: 3, b2b: 2 },
  // Новый сайт (страниц под спрос нет): сайт выходит в поиск через N мес, ежемесячные работы (ПФ, Карты, ссылки,
  // статьи) оплачиваются с месяца запуска, а не с 1-го. Разработка у нас - 2 мес, у разработчика клиента - 3.
  launch_month: { we_develop: 2, client: 3 },
  // «Деньги, которые вы теряете» (lostNowCalc): ориентир конкурентов не ниже этой доли трафика лидера.
  lost_ref_leader_share: 0.5,

  // Удержание после остановки ПФ (для справки и текста условий): плавно 0,7 + 0,3 x exp(-t/1,5), t - мес после
  // остановки (портфель: через месяц ~0,9 от пика, через 2-3 мес ~0,72; у ltenergy за 15 мес медиана 0,91).
  pf_retention: 0.7,
};

// Дефолты экономики по типу бизнеса (если клиент не назвал). Конверсия - визит -> обращение
// (звонок, заявка, мессенджер; для магазина - заказ). Консервативный край кейсов.
// ltv_factor - покупок одного клиента за 12 мес (повторные визиты, курсы процедур, повторные заказы): выручка
// с продажи = средний чек x ltv_factor. Медицина и косметология - курсы и повторные визиты; магазин - повторные
// заказы. Агент может задать свое значение с basis.
export const ECON_DEFAULTS = {
  services:    { model: "two_step", conversion_rate: 0.05,  close_rate: 0.3,  margin: 0.4,  ltv_factor: 1 },
  medical:     { model: "two_step", conversion_rate: 0.05,  close_rate: 0.5,  margin: 0.4,  ltv_factor: 1.8 },
  b2b:         { model: "two_step", conversion_rate: 0.03,  close_rate: 0.2,  margin: 0.35, ltv_factor: 1 },
  high_ticket: { model: "two_step", conversion_rate: 0.01,  close_rate: 0.04, margin: 0.2,  ltv_factor: 1 },
  ecommerce:   { model: "one_step", conversion_rate: 0.015, close_rate: 1,    margin: 0.25, ltv_factor: 1.3 },
  info:        { model: "one_step", conversion_rate: 0.01,  close_rate: 1,    margin: 0.5,  ltv_factor: 1 },
};

// ═══ Утилиты ═══
function posOrNull(v) {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function num(v, dflt = 0) {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : dflt;
}
export function ramp(t, lag, tau) {
  if (t <= lag) return 0;
  return 1 - Math.exp(-(t - lag) / Math.max(tau, 0.01));
}
// Буст с лагом; scale - доля эффекта (на большой базе бусты слабее: тот же FAQ на 30 страницах - меньшая доля
// всего трафика сильного сайта).
function boostAt(t, b, lagShift = 0, scale = 1) {
  return 1 + (b.mult - 1) * scale * ramp(t, b.lag + lagShift, b.tau);
}

// Мягкий потолок: до knee x cap - без изменений, дальше плавно к cap (непрерывно, наклон 1 в точке излома).
export function softCap(x, cap, knee = CAL.soft_cap_knee) {
  if (!Number.isFinite(cap) || cap <= 0) return x;
  const k = knee * cap;
  if (x <= k) return x;
  const room = cap - k;
  return cap - room * Math.exp(-(x - k) / room);
}

// Потолок коммерческого трафика: максимум из оценок спроса и трафика конкурентов (см. CAL). Infinity - если
// данных нет совсем (ни спроса, ни конкурентов).
export function trafficCap(fi = {}) {
  const t0 = Math.max(0, num(fi.t0, 0));
  const comp = ["low", "medium", "high"].includes(fi.competition) ? fi.competition : "medium";
  const demandCommercial = Math.max(0, num(fi.demand && fi.demand.commercial_month, 0));
  const ct = fi.competitors_traffic || {};
  const leader = Math.max(0, num(ct.leader, 0));
  const median = Math.max(0, num(ct.median, 0));
  if (!(demandCommercial > 0) && !(leader > 0) && !(median > 0)) return Infinity;
  return Math.max(
    demandCommercial * CAL.demand_tail_mult * CAL.demand_share_cap[comp],
    leader * CAL.cap_competitors.leader_share,
    median * CAL.cap_competitors.median_mult,
    t0 * CAL.cap_t0_mult,
  );
}

// Месяц запуска сайта (с него работают новые страницы и идут ежемесячные работы). 1 - сайт уже есть.
// Явное fi.site_launch_month приоритетно; иначе новый сайт (трафика < 30 и коммерческих страниц <= 3) -
// CAL.launch_month (we_develop - разработка у нас).
export function launchMonth(fi = {}) {
  const explicit = Math.round(num(fi.site_launch_month, NaN));
  if (Number.isFinite(explicit) && explicit >= 1) return explicit;
  const t0 = Math.max(0, num(fi.t0, 0));
  const pages = Math.max(0, num(fi.pages && fi.pages.existing_commercial, 0));
  if (t0 < 30 && pages <= 3) return fi.we_develop ? CAL.launch_month.we_develop : CAL.launch_month.client;
  return 1;
}

// Нормализация ID услуг тарифа (алиасы старых ID).
export const SERVICE_ID_ALIASES = { MF: "MT", MD: "MT" };
export function tariffServiceIds(tariff) {
  const ids = new Set();
  for (const part of ["onetime", "monthly"]) {
    for (const s of (tariff && tariff[part]) || []) {
      if (!s || !s.id) continue;
      ids.add(SERVICE_ID_ALIASES[s.id] || s.id);
    }
  }
  return ids;
}

// Доля из «процента или доли» для полей экономики. conversion_rate и margin: значение >= 1 - проценты
// (1 -> 1%, 5 -> 5%, 40 -> 40%): доля 100% для них не бывает, а «1» от клиента почти всегда «1%».
// close_rate: 1 = 100% (one_step: каждое обращение - продажа), проценты - только > 1 (30 -> 30%).
// Пусто, null, не число, <= 0 - null (значения нет).
export function econFraction(key, v) {
  if (v == null || v === "" || typeof v === "boolean") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", ".").replace("%", "").trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  const isPercent = key === "close_rate" ? n > 1 : n >= 1;
  return isPercent ? n / 100 : n;
}

// Экономика прогноза: оценка агента (forecast_inputs.economics) с переводом процентов в доли, поверх нее -
// значения клиента из inputs.json (avg_check, conversion_rate, close_rate, margin). Единая точка для
// build-forecast.mjs и verify-strategy.mjs: пересчет проверки обязан совпасть с прогнозом.
// Возврат: {fi (копия с разрешенной economics), fromClient: [ключи от клиента]}.
export function applyClientEconomics(fiRaw, clientInputs) {
  const fi = JSON.parse(JSON.stringify(fiRaw || {}));
  const e = fi.economics && typeof fi.economics === "object" && !Array.isArray(fi.economics) ? fi.economics : {};
  fi.economics = e;
  // 1) оценка агента: проценты -> доли (невалидное значение оставляем - его поймает проверка диапазона)
  for (const k of ["conversion_rate", "close_rate", "margin"]) {
    const v = econFraction(k, e[k]);
    if (v != null) e[k] = v;
  }
  // 2) клиент перекрывает (уже долями - повторно не делится)
  const ci = clientInputs && typeof clientInputs === "object" && !Array.isArray(clientInputs) ? clientInputs : {};
  const fromClient = [];
  const check = ci.avg_check == null || ci.avg_check === "" ? NaN : Number(ci.avg_check);
  if (Number.isFinite(check) && check > 0) {
    e.avg_check = check;
    e.avg_check_source = "client";
    fromClient.push("avg_check");
  }
  for (const k of ["conversion_rate", "close_rate", "margin"]) {
    const v = econFraction(k, ci[k]);
    if (v != null) { e[k] = v; fromClient.push(k); }
  }
  // разработку сайта заказывают у нас - запуск нового сайта быстрее (CAL.launch_month)
  if (fi.we_develop == null && ci.we_develop === true) fi.we_develop = true;
  return { fi, fromClient };
}

// Экономика: inputs.economics поверх дефолтов по типу бизнеса.
export function resolveEconomics(fi = {}) {
  const type = ECON_DEFAULTS[fi.business_type] ? fi.business_type : "services";
  const d = ECON_DEFAULTS[type];
  const e = fi.economics || {};
  const model = e.model || d.model;
  return {
    business_type: type,
    model,
    avg_check: num(e.avg_check, 0),
    avg_check_source: e.avg_check_source || (e.avg_check ? "estimated" : "missing"),
    conversion_rate: num(e.conversion_rate, d.conversion_rate),
    close_rate: model === "one_step" ? num(e.close_rate, 1) : num(e.close_rate, d.close_rate),
    margin: num(e.margin, d.margin),
    ltv_factor: Math.max(1, num(e.ltv_factor, d.ltv_factor || 1)),
    ltv_source: e.ltv_factor != null ? (e.ltv_source || "estimated") : "default",
    sales_lag_months: CAL.sales_lag_months[type] || 0,
    // Мощность бизнеса, продаж в мес (всего, вместе с текущими): forecast_inputs.capacity_sales_month, иначе
    // economics.scale.capacity_month (v2.3: growth-strategist пишет мощность в scale, а модель ее не видела - дизайнеру-
    // одиночке прогноз давал 6-7 проектов в мес при мощности 3). null - без ограничения.
    // e.capacity_sales_month - уже разрешенная экономика (forecast.json inputs.economics -> смета)
    capacity_sales_month: posOrNull(fi.capacity_sales_month) ?? posOrNull(e.capacity_sales_month) ?? posOrNull(e.scale && e.scale.capacity_month),
    basis: e.basis || "",
  };
}

// Затраты тарифа по месяцам 1..H. Разовые - в 1-й мес. Акции: promos[] с {type:"pf_2for1"} - минус цена
// ежемесячной ПФ-услуги во 2-й мес; {type:"discount", month, amount} - произвольная скидка месяца.
// monthlyStart - месяц, с которого идут ежемесячные работы (новый сайт - с месяца запуска, см. launchMonth).
// Акция «ПФ 1=2» - бесплатен второй месяц ПФ, то есть месяц monthlyStart + 1.
export function costSeries(tariff, H = HORIZON, monthlyStart = 1) {
  const onetime = num(tariff && tariff.total_onetime, sumPrices(tariff && tariff.onetime));
  const monthly = num(tariff && tariff.total_monthly, sumPrices(tariff && tariff.monthly));
  const ms = Math.max(1, Math.round(num(monthlyStart, 1)));
  const out = new Array(H + 1).fill(0);
  for (let m = 1; m <= H; m++) out[m] = (m >= ms ? monthly : 0) + (m === 1 ? onetime : 0);
  for (const p of (tariff && tariff.promos) || []) {
    if (!p) continue;
    if (p.type === "pf_2for1") {
      const pf = ((tariff.monthly) || []).find((s) => s && (s.id === "PF" || s.id === "PFP"));
      const amount = num(p.amount, pf ? num(pf.price, 0) : 0);
      if (H >= ms + 1) out[ms + 1] = Math.max(0, out[ms + 1] - amount);
    } else if (p.type === "discount") {
      const m = Math.round(num(p.month, 1));
      if (m >= 1 && m <= H) out[m] = Math.max(0, out[m] - num(p.amount, 0));
    }
  }
  return out;
}
function sumPrices(list) {
  return (list || []).reduce((a, s) => a + num(s && s.price, 0), 0);
}

// ═══ Ядро: кривая трафика тарифа ═══
// fi - forecast_inputs (см. strategy_data_schema.json), ids - Set ID услуг тарифа.
// Экспертная оценка трафика к 12-му мес (v2.4, решение владельца 06.10): tariff-architect ставит каждому тарифу
// forecast_m12 {traffic, basis} - свою оценку по всем данным (трафик прямых лидеров в Keys.so, разрывы карточки ниши,
// состав тарифа, калибровка по кейсам), а не сумму вкладов услуг. Модель дает только ФОРМУ кривой (быстрый старт ПФ,
// запуск нового сайта, разгон страниц), уровень к 12-му мес = оценка. Нет оценки - уровень по формуле модели (легаси).
export function tariffTarget(tariff) {
  const f = tariff && tariff.forecast_m12;
  const v = f != null && typeof f === "object" ? Number(f.traffic) : Number(f);
  return Number.isFinite(v) && v > 0 ? v : null;
}

export function trafficSeries(fi = {}, ids = new Set(), H = HORIZON, target = null) {
  const t0 = Math.max(0, num(fi.t0, 0));
  const type = CAL.vpp[fi.business_type] != null ? fi.business_type : "services";
  const comp = ["low", "medium", "high"].includes(fi.competition) ? fi.competition : "medium";
  const pages = fi.pages || {};
  const existingPages = Math.max(0, num(pages.existing_commercial, 0));
  const plannedNew = Math.max(0, num(pages.planned_new, 0));
  const cards = Math.max(0, num(pages.catalog_cards, 0));
  const vpp = CAL.vpp[type];
  const vppNew = existingPages > 0 && t0 > 0
    ? Math.max(vpp, Math.min((t0 / existingPages) * CAL.vpp_inherit_share, vpp * CAL.vpp_inherit_max_mult))
    : vpp;
  const demand = fi.demand || {};
  const demandCommercial = Math.max(0, num(demand.commercial_month, 0));
  const demandInfo = Math.max(0, num(demand.info_month, 0));
  const local = !!fi.local;
  const hasCard = fi.maps_card === "verified" || fi.maps_card === "unverified";
  const techCritical = !!fi.tech_critical;
  // внедрение: свой разработчик клиента / мы (разработка сайта у нас) - сдвиг лагов
  const implShift = num(fi.implementation_lag_shift, 0);
  // новый сайт: страницы работают с месяца запуска (лаг новых страниц не меньше launch - 1 + 1 мес индексации)
  const launch = launchMonth(fi);

  const hasPF = ids.has("PF") || ids.has("PFP");
  const hasPFP = ids.has("PFP");
  const pfStrength = hasPFP ? CAL.pfp_strength : 1;              // ПФ Продвинутый - эффект ПФ сильнее
  const pfSpeed = hasPFP ? CAL.pfp_speed : 1;
  const hasSY = ids.has("SY");
  // Метатеги входят в SY (TARIFFS.md; RULES.md: пара SY/MT - MT при SY не ставится). Эффект MT дает и SY,
  // иначе обязательная замена MT -> SY в тарифе выше роняла бы его кривую ниже тарифа ниже на 2-3 мес.
  const hasMT = ids.has("MT") || hasSY;
  const hasTexts = ids.has("KP") || ids.has("FQ");
  const hasKP = ids.has("KP");
  const hasAR = ids.has("AR");
  const hasYM = ids.has("YM") && local;
  const synergy = hasPF && hasYM ? CAL.pf_ym_synergy : 1;       // Карты усиливают ПФ
  // новый сайт на новом домене: запуск позже 1-го мес или сайту меньше 6 мес
  const newDomain = launch > 1 || num(fi.site_age_months, 999) < 6;

  // 1) Существующие страницы.
  const f = Math.min(1, Math.max(CAL.mult_floor, Math.pow(CAL.mult_ref_t0 / Math.max(t0, 1), 0.25)));
  const multMax = hasPF
    ? 1 + (CAL.pf_mult_max - 1) * synergy * pfStrength * f
    : 1 + (CAL.nopf_mult_max - 1) * f;
  // существующие страницы без нашей доработки - доля уровня зрелой оптимизированной страницы (vpp_existing_share)
  const pageTarget = (existingPages * vpp * CAL.vpp_existing_share + cards * CAL.vpp_card) * (hasPF ? 1 : CAL.nopf_level_factor[comp]);
  const existTarget = Math.max(t0 * multMax, pageTarget, t0);
  const existRamp = hasPF ? { lag: CAL.pf_ramp.lag, tau: CAL.pf_ramp.tau / (synergy * pfSpeed) } : CAL.nopf_ramp;

  // 2) Новые страницы (только при SY).
  const contentQ = ids.has("KP") && ids.has("FQ") ? CAL.content_q_kp_fq : hasTexts ? CAL.content_q_with_texts : CAL.content_q_structure_only;
  // v2.3: ПФ поднимает и уровень новых страниц (x1,2; с Картами x1,3; ПФ Продвинутый - сильнее), а не только скорость
  const pfNewLevel = hasPF ? 1 + (CAL.pf_new_level_mult - 1) * synergy * pfStrength : CAL.nopf_level_factor[comp];
  const newLevel = hasSY ? plannedNew * vppNew * contentQ * pfNewLevel : 0;
  const newRampBase = hasPF ? CAL.new_pages_ramp_pf : CAL.new_pages_ramp_nopf;
  // живой сайт - страницы выходят через newRampBase.lag; новый сайт - с запуском (запуск + live_lag)
  let newLag = launch > 1 ? launch + newRampBase.live_lag : newRampBase.lag, newTau = newRampBase.tau;
  if (hasPF) {
    newTau = newTau / (synergy * pfSpeed);
    if (newDomain && !hasYM) { newLag += CAL.new_domain_no_ym.extra_lag; newTau *= CAL.new_domain_no_ym.tau_mult; }
  }
  const newRamp = { lag: newLag, tau: newTau };

  // Потолок коммерческого трафика (мягкий, см. trafficCap/softCap).
  // экспертная оценка уровня заменяет потолок (оценщик уже учел трафик лидеров) - кривая без среза, потом масштаб
  const cap = target != null ? Infinity : trafficCap(fi);

  const series = [];
  for (let m = 0; m <= H; m++) {
    const exist = m === 0 ? t0 : t0 + (existTarget - t0) * ramp(m, existRamp.lag, existRamp.tau);
    const fresh = m === 0 ? 0 : newLevel * ramp(m, newRamp.lag + implShift, newRamp.tau);
    // v2.1: бусты «на странице» (техника, метатеги, FAQ, КФ лидеров) - только на СУЩЕСТВУЮЩИЕ страницы: новые
    // страницы структуры уже делаются с метатегами и текстами (это в vpp и content_q), иначе двойной счет (приемка
    // 06.10: 9,8 визита на новую страницу против 7 по кейсам). Ссылки и Карты - на весь коммерческий трафик.
    let boostPage = 1, boostAll = 1;
    const parts = {};
    if (m > 0) {
      for (const id of ["FA", "BS", "MT", "FQ", "LB", "LA"]) {
        if (!(id === "MT" ? hasMT : ids.has(id))) continue;
        let b = CAL.boosts[id];
        if (id === "FA" && techCritical) b = { ...b, mult: CAL.fa_critical_mult };
        // ссылки у нового сайта закупаются с месяца запуска - их лаг отсчитывается от него
        const shift = id === "BS" ? 0 : (id === "LB" || id === "LA") ? implShift + Math.max(0, launch - 1) : implShift;
        const k = boostAt(m, b, shift, f);
        if (id === "LB" || id === "LA") boostAll *= k; else boostPage *= k;
        parts[id] = k;
      }
      if (hasKP) {
        const k = boostAt(m, CAL.boosts.KP_rank, implShift, f);
        boostPage *= k;
        parts.KP = k;
      }
      if (hasYM && !hasPF) {
        const k = boostAt(m, CAL.boosts.YM, Math.max(hasCard ? 0 : CAL.ym_card_create_lag, launch - 1), f);
        boostAll *= k;
        parts.YM = k;
      }
    }
    const boost = boostPage * boostAll;
    const commercialRaw = exist * boost + fresh * boostAll;
    const commercial = m === 0 ? t0 : Math.max(t0, softCap(commercialRaw, cap));
    // срез потолка делим пропорционально между существующими и новыми страницами (иначе весь срез ложился на
    // новые страницы и главная ценность структуры выглядела нулевой)
    const scaleCap = commercialRaw > 0 ? commercial / commercialRaw : 1;
    const existShown = m === 0 ? t0 : Math.max(t0, exist * boost * scaleCap);
    void boostPage;

    // 3) Статьи.
    let info = 0;
    if (hasAR && m > 0) {
      for (let k = CAL.ar_start_month; k <= m; k++) {
        const age = m - k + 0.5;
        info += CAL.ar_per_month * CAL.ar_vpa * (1 - Math.exp(-age / CAL.ar_tau));
      }
      if (demandInfo > 0) info = Math.min(info, demandInfo * CAL.info_cap_share);
    }

    // 4) Обращения из Карт (прямые, не через сайт).
    let mapsLeads = 0;
    if (hasYM && m > 0) {
      const share = CAL.ym_leads_share[type] ?? CAL.ym_leads_share.services;
      const level = share > 0 ? Math.max(CAL.ym_leads_min, demandCommercial * share) * (hasCard ? CAL.ym_existing_card_factor : 1) : 0;
      // Карты оплачиваются с месяца запуска сайта (costSeries) - и обращения из них не раньше
      mapsLeads = level * ramp(m, Math.max(CAL.ym_leads_ramp.lag + (hasCard ? 0 : CAL.ym_card_create_lag), launch - 1 + CAL.ym_leads_ramp.lag), CAL.ym_leads_ramp.tau);
    }

    // 5) Множитель конверсии (прототип КФ/КНДР внедрен).
    const convMult = hasKP && m > 0
      ? 1 + (CAL.kp_conv_mult - 1) * ramp(m, CAL.kp_conv_ramp.lag + implShift, CAL.kp_conv_ramp.tau)
      : 1;

    series.push({
      m,
      commercial,
      info,
      total: commercial + info,
      exist_part: Math.min(existShown, commercial),
      new_part: Math.max(0, commercial - Math.min(existShown, commercial)),
      capped: m > 0 && commercialRaw > CAL.soft_cap_knee * cap,
      maps_leads: mapsLeads,
      conv_mult: convMult,
      boosts: parts,
    });
  }
  if (target != null) scaleToTarget(series, t0, target, launch);
  return series;
}

// Масштаб прироста кривой к экспертной оценке m12: форма (скорость, запуск, ПФ-старт) - модели, уровень - оценки.
// Прирост коммерческого и инфо-трафика умножается на один k; модель не дала прироста - типовой разгон от запуска.
function scaleToTarget(series, t0, target, launch) {
  const goal = Math.max(t0, target);
  const raw12 = series[Math.min(12, series.length - 1)].total;
  const gain12 = raw12 - t0;
  if (gain12 > 1) {
    const k = (goal - t0) / gain12;
    for (const p of series) {
      if (p.m === 0) continue;
      p.commercial = t0 + (p.commercial - t0) * k;
      p.info *= k;
      p.total = p.commercial + p.info;
      p.exist_part = t0 + (p.exist_part - t0) * k;
      p.new_part *= k;
      p.capped = false;
    }
  } else {
    const r12 = ramp(12, launch - 0.5, 3);
    for (const p of series) {
      if (p.m === 0) continue;
      const add = (goal - t0) * (r12 > 0 ? ramp(p.m, launch - 0.5, 3) / r12 : 0);
      p.commercial = t0 + add;
      p.total = p.commercial + p.info;
      p.exist_part = t0 + add;
      p.new_part = 0;
      p.capped = false;
    }
  }
}

// ═══ Деньги по тарифу ═══
export function computeTariff(fi, tariff, H = HORIZON) {
  const econ = resolveEconomics(fi);
  const ids = tariffServiceIds(tariff);
  const t0 = Math.max(0, num(fi.t0, 0));
  const target = tariffTarget(tariff);
  const traffic = trafficSeries(fi, ids, H, target);
  const launch = launchMonth(fi);
  const cost = costSeries(tariff, H, launch);
  const cr = econ.conversion_rate;
  const close = econ.close_rate;
  const check = econ.avg_check * econ.ltv_factor;      // выручка с одной продажи за 12 мес (повторные покупки)
  const margin = econ.margin;
  const salesLag = econ.sales_lag_months;               // обращения месяца m -> продажи месяца m + lag
  // Мощность бизнеса (самозанятый, мастер-одиночка, малая бригада): дополнительных продаж в мес не больше, чем
  // бизнес физически обслужит сверх текущих (приемка 06.10: дизайнер-одиночка получал 6 проектов в мес).
  const capacity = num(econ.capacity_sales_month, NaN);
  const baseSales = t0 * cr * close;
  const extraSalesCap = Number.isFinite(capacity) && capacity > 0 ? Math.max(0, capacity - baseSales) : Infinity;
  const baseLeads = t0 * cr;
  const leadsByMonth = new Array(H + 1).fill(0);

  const months = [];
  let cumProfit = 0, cumCost = 0, payback = null;
  for (let m = 1; m <= H; m++) {
    const tr = traffic[m];
    const leadsSite = tr.commercial * cr * tr.conv_mult - baseLeads;
    const leadsInfo = tr.info * cr * CAL.info_conv_factor;
    const leads = Math.max(0, leadsSite + leadsInfo + tr.maps_leads);
    leadsByMonth[m] = leads;
    const sales = Math.min(extraSalesCap, (m - salesLag >= 1 ? leadsByMonth[m - salesLag] : 0) * close);
    const revenue = sales * check;
    const profit = revenue * margin;
    cumProfit += profit;
    cumCost += cost[m];
    if (payback === null && cumProfit >= cumCost && cumCost > 0) payback = m;
    months.push({
      m,
      traffic: tr.total,
      traffic_commercial: tr.commercial,
      traffic_info: tr.info,
      traffic_gain: tr.total - t0,
      leads, leads_site: Math.max(0, leadsSite), leads_info: leadsInfo, leads_maps: tr.maps_leads,
      sales, revenue, profit, cost: cost[m],
      cum_profit: cumProfit, cum_cost: cumCost, cashflow: cumProfit - cumCost,
    });
  }

  const sum = (from, to, key) => months.slice(from - 1, to).reduce((a, r) => a + r[key], 0);
  const y1 = {
    cost: sum(1, 12, "cost"), leads: sum(1, 12, "leads"), sales: sum(1, 12, "sales"),
    revenue: sum(1, 12, "revenue"), profit: sum(1, 12, "profit"),
  };
  y1.net = y1.profit - y1.cost;
  y1.romi = y1.cost > 0 ? (y1.net / y1.cost) * 100 : 0;
  const y2 = {
    cost: sum(1, H, "cost"), profit: sum(1, H, "profit"), revenue: sum(1, H, "revenue"),
    leads: sum(1, H, "leads"),
  };
  y2.net = y2.profit - y2.cost;
  y2.romi = y2.cost > 0 ? (y2.net / y2.cost) * 100 : 0;
  const m12 = months[11];
  const monthlyFee = num(tariff && tariff.total_monthly, 0);

  return {
    ids: [...ids],
    economics: econ,
    t0,
    launch_month: launch,
    cap: Number.isFinite(trafficCap(fi)) ? Math.round(trafficCap(fi)) : null,
    target_m12: target != null ? Math.round(target) : null,
    target_basis: target != null && tariff.forecast_m12 && typeof tariff.forecast_m12 === "object" ? String(tariff.forecast_m12.basis || "") : null,
    capped_from_month: (traffic.find((x) => x.capped) || {}).m || null,
    checkpoints: {
      m0: t0,
      m1: traffic[1].total, m2: traffic[2].total, m3: traffic[3].total, m6: traffic[6].total,
      m9: traffic[9].total, m12: traffic[12].total, m24: traffic[Math.min(24, H)].total,
    },
    drivers_m12: driversAt(traffic[12], t0),
    months,
    year1: roundObj(y1),
    year2: roundObj(y2),
    payback_month: payback,
    m12: roundObj({ traffic: m12.traffic, leads: m12.leads, sales: m12.sales, revenue: m12.revenue, profit: m12.profit }),
    runrate_m12: monthlyFee > 0 ? m12.profit / monthlyFee : null,
  };
}

function driversAt(tr, t0) {
  return {
    base: Math.round(t0),
    existing_gain: Math.round(Math.max(0, tr.exist_part - t0)),
    new_pages: Math.round(tr.new_part),
    articles: Math.round(tr.info),
    maps_leads: Math.round(tr.maps_leads * 10) / 10,
    conv_mult: Math.round(tr.conv_mult * 100) / 100,
  };
}
function roundObj(o) {
  const r = {};
  for (const k of Object.keys(o)) r[k] = Math.round(o[k]);
  return r;
}

// ═══ Все тарифы + проверки ═══
export function computeAll(fi, tariffsByKey, H = HORIZON) {
  const res = {};
  for (const k of TARIFF_KEYS) if (tariffsByKey[k]) res[k] = computeTariff(fi, tariffsByKey[k], H);
  return res;
}

// Проверки экономики (гейт шага прогноза). hard - блок (переделать тарифы), soft - предупреждение.
export const START_HARD_PREFIX = "Старт:";
export function economicsChecks(res) {
  const hard = [], soft = [];
  const s = res.start, g = res.growth, x = res.max;
  if (g) {
    if (g.year1.romi <= 0) hard.push(`ROMI Роста за 12 мес ${g.year1.romi}% <= 0 - тариф велик для экономики клиента`);
    else if (g.year1.romi < 100) soft.push(`ROMI Роста за 12 мес ${g.year1.romi}% < 100% (цель 100%+)`);
    if (g.year1.sales < 5) soft.push(`Рост: ${g.year1.sales} продаж за год - ROMI держится на единицах сделок, неустойчив`);
    if (g.year1.romi > 1500) soft.push(`ROMI Роста ${g.year1.romi}% - проверить средний чек и маржу (подозрительно высоко)`);
  }
  if (s && g) {
    if (g.checkpoints.m12 + 0.5 < s.checkpoints.m12) hard.push(`трафик Роста к 12 мес (${Math.round(g.checkpoints.m12)}) ниже Старта (${Math.round(s.checkpoints.m12)}) - состав Роста не шире Старта`);
    if (g.year1.net < s.year1.net) hard.push(`чистый результат Роста за 12 мес (${g.year1.net}) меньше Старта (${s.year1.net})`);
    if (g.year1.romi < s.year1.romi) soft.push(`ROMI Роста (${g.year1.romi}%) ниже Старта (${s.year1.romi}%) за 12 мес`);
    // v2.3 (владелец: «ROMI всегда положительный»): Старт в минусе при окупаемом Росте - состав Старта, а не экономика
    // клиента (RULES раздел 10: добавить структуру под спрос, снять неокупаемое). Рост тоже в минусе - это экономика
    // клиента (блок про Рост выше), Старт отдельно не блокируем.
    if (s.year1.romi <= 0 && g.year1.romi > 0) hard.push(`${START_HARD_PREFIX} ROMI Старта за 12 мес ${s.year1.romi}% <= 0 при окупаемом Росте - Старт не окупается: добавить структуру под спрос (PA + SY), снять неокупаемое`);
    else if (s.year1.romi <= 0) soft.push(`ROMI Старта за 12 мес ${s.year1.romi}% <= 0`);
  }
  if (g && g.capped_from_month && g.capped_from_month <= 4) {
    soft.push(`прогноз Роста уперся в потолок (${g.cap}) уже к ${g.capped_from_month}-му мес - проверь спрос (формы с городом и областью, общие запросы) и трафик конкурентов в forecast_inputs`);
  }
  if (s && g && x && s.ids.join() !== g.ids.join()) {
    const same = Math.abs(s.checkpoints.m12 - g.checkpoints.m12) <= Math.max(2, 0.02 * g.checkpoints.m12)
      && Math.abs(x.checkpoints.m12 - g.checkpoints.m12) <= Math.max(2, 0.02 * g.checkpoints.m12);
    if (same) soft.push("трафик к 12 мес у трех тарифов почти одинаковый - тарифы не различаются по результату (потолок спроса или состав)");
  }
  if (g && x) {
    if (x.checkpoints.m12 + 0.5 < g.checkpoints.m12) hard.push(`трафик Максимума к 12 мес ниже Роста - состав Максимума не шире Роста`);
    if (x.year2.net < g.year2.net) soft.push(`чистый результат Максимума за 24 мес (${x.year2.net}) меньше Роста (${g.year2.net})`);
  }
  // RULES раздел 10: цель - ROMI Максимума за 24 мес > 0 (драйверы с лучшей отдачей, а не все сразу)
  if (x && x.year2.romi <= 0) soft.push(`ROMI Максимума за 24 мес ${x.year2.romi}% <= 0 (цель > 0) - в Максимуме драйверы с лучшей отдачей, а не все сразу`);
  return { hard, soft };
}

// Рекомендация для сметы и тариф плана docx. Рост - по умолчанию. Экономический гейт не пройден (RULES раздел 10:
// «тариф велик для экономики клиента») - тариф с лучшим чистым результатом за 12 мес, если он в плюсе, иначе ни
// один (null). План работ, график и потери в docx строятся по plan_tariff (= рекомендованный или Рост).
// Единая точка для build-forecast.mjs и verify-strategy.mjs.
export function recommendOffer(res, checks = economicsChecks(res)) {
  let offer = "growth";
  // блок про Старт (START_HARD_PREFIX) рекомендацию Роста не меняет - Рост окупается
  if (checks.hard.some((h) => !h.startsWith(START_HARD_PREFIX))) {
    const best = TARIFF_KEYS.filter((k) => res[k]).sort((a, b) => res[b].year1.net - res[a].year1.net)[0];
    offer = best && res[best].year1.net > 0 ? best : null;
  }
  return { recommended_offer: offer, plan_tariff: offer || "growth" };
}

// «Деньги, которые вы теряете» (v2.1): разрыв между трафиком клиента и тем, что получают сопоставимые конкуренты из
// топа, - но не больше уровня, который реально взять планом к 12-му мес (коммерческий трафик тарифа плана). Ориентир
// конкурентов - медиана топ-3 прямых по трафику, но не ниже половины лидера (в списке прямых бывают совсем мелкие
// сайты). Считается по БАЗОВОЙ конверсии (без прототипа и без Карт): это рынок, который сейчас уходит к конкурентам,
// а не обещание плана. Нет данных о конкурентах (или ориентир не выше t0) - разрыв по плану (basis: plan).
// planRes - computeTariff тарифа плана. Возврат неокругленный (округляет build-forecast).
export function lostNowCalc(fi = {}, planRes) {
  const econ = resolveEconomics(fi);
  const t0 = Number(fi.t0) || 0;
  const ctr = fi.competitors_traffic || {};
  const median = Number(ctr.median) > 0 ? Number(ctr.median) : null;
  const leader = Number(ctr.leader) > 0 ? Number(ctr.leader) : null;
  const plan12 = planRes && planRes.months && planRes.months[11] ? planRes.months[11].traffic_commercial : t0;
  const ref = Math.max(median || 0, leader ? leader * CAL.lost_ref_leader_share : 0);
  let target = plan12, basis = "plan";
  if (ref > t0) { target = Math.min(ref, plan12); basis = "competitors"; }
  const traffic = Math.max(0, target - t0);
  const leads = traffic * econ.conversion_rate;
  const sales = leads * econ.close_rate;
  const revenue = sales * econ.avg_check * econ.ltv_factor;
  return {
    basis, target_traffic: target, traffic_month: traffic, leads_month: leads, sales_month: sales,
    revenue_month: revenue, competitors_traffic_median: median, competitors_traffic_leader: leader,
  };
}
