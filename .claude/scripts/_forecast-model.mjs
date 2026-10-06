#!/usr/bin/env node
// _forecast-model.mjs - модель прогноза и экономики /seo-strategiya v2 (06.10.2026).
// Чистые функции, без I/O. Единый источник чисел для build-forecast.mjs, build-smeta-xlsx.mjs,
// build-strategy-docx.mjs и verify-strategy.mjs. Меняешь формулу или константу тут - меняется везде.
//
// Чем отличается от старой модели (_forecast-money.mjs, плоский масштаб x0,6 / x1,0 / x1,3):
// 1. Кривая у каждого тарифа своя и собирается из ВКЛАДА УСЛУГ: ПФ и техника дают быстрый старт на
//    существующих страницах, структура и тексты - новые страницы под спрос с лагом внедрения и индексации,
//    статьи - накопительный инфо-трафик, Карты - буст и прямые обращения, прототип КФ/КНДР - конверсию.
//    Старт с ПФ разгоняется за 2-3 мес почти как Рост, а на 6 и 12 мес Рост уходит вперед за счет страниц.
// 2. Калибровка по кейсам агентства (cases.timur-seo.ru, 13 проектов, данные Метрики), с поправкой на
//    отбор лучших кейсов (x0,8-0,9 к медианам). Константы и источники - в CAL ниже.
// 3. Деньги считаются только с ПРИРОСТА над текущим трафиком (m0 без работ остается у клиента и так).
// 4. Окно 24 мес: первые 12 - для ROMI года и окупаемости, второй год - работы продолжаются, сделанное
//    держится. Затраты: разовые в 1-м мес, ежемесячные каждый мес, акции (ПФ 1=2) вычитаются.
//
// Конверсия визит -> обращение по умолчанию 5% для услуг: в кейсах медиана 9,1% (Q1 7,2%, цели Метрики,
// включая клики по телефону и мессенджерам), берем с запасом. ROMI - от валовой прибыли (выручка x маржа).

export const MODEL_VERSION = "v2";
export const TARIFF_KEYS = ["start", "growth", "max"];
export const HORIZON = 24;

// ═══ Калибровка (менять осознанно, с источником) ═══
export const CAL = {
  // Визитов в месяц на коммерческую страницу в индексе на зрелости. Кейсы услуг: Q1 8,0, медиана 9,0
  // (кадровый-элемент, spk-nhs, medkomissii89, sinestet, работа-эскорт, ti-o-ty); x0,8 на отбор.
  // Для магазина это категории и посадочные фильтров; карточки товаров - отдельно (vpp_card):
  // 0,6-2 визита на карточку (vivarent, garmin).
  vpp: { services: 7, medical: 7, b2b: 6, high_ticket: 5, ecommerce: 4, info: 5 },
  vpp_card: 0.8,
  // Новые страницы сильного сайта наследуют доверие домена: визитов на новую страницу не меньше
  // 0,6 x (текущий трафик / коммерческих страниц), но не больше 4 x vpp.
  vpp_inherit_share: 0.6,
  vpp_inherit_max_mult: 4,

  // Потолок: доля суммы ТОЧНЫХ частот маркеров коммерческого спроса ниши в регионе, которую сайт
  // забирает на зрелости вместе с хвостами (кадровый-элемент 2,7% в 1-й полный мес с 54 маркерами,
  // работа-эскорт 25,7% к m9-m11). Ограничивает сверху, не задает уровень.
  demand_share_cap: { low: 0.30, medium: 0.20, high: 0.12 },

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
  // Новые сайты с ПФ: 45-75% уровня к m3 от запуска, 75-95% к m6 -> tau 2,5 (70% / 91%); tau 1,5 давал 86% / 98%
  // (быстрее кейсов) и уводил Рост от Старта уже на 3-м мес.
  new_pages_ramp_pf: { lag: 2, tau: 2.5 },
  new_pages_ramp_nopf: { lag: 2.5, tau: 3 },
  // Без ПФ в конкурентной нише новые страницы добирают меньше (кейсы: ПФ определяет скорость, а в
  // высокой конкуренции и уровень).
  nopf_level_factor: { low: 0.9, medium: 0.7, high: 0.5 },
  // Качество текстов новых страниц: есть KP (тексты в прототипе) или FQ (n-граммы) - 1,0;
  // только структура (тексты пишет клиент) - 0,75.
  content_q_with_texts: 1.0,
  content_q_structure_only: 0.75,

  // Бусты на весь коммерческий трафик (множители с лагом). Источники: кейсы техаудита (lp-teh),
  // FAQ/n-граммы и КФ - экспертная оценка по прогонам; ссылки и Карты в кейсах не замерены - оценка.
  boosts: {
    FA: { mult: 1.10, lag: 2, tau: 1.5 },        // техаудит (внедрение разработчиком клиента)
    BS: { mult: 1.08, lag: 1, tau: 1 },          // базовое SEO Tilda (делаем сами)
    MT: { mult: 1.05, lag: 1.5, tau: 1 },        // метатеги отдельно
    FQ: { mult: 1.12, lag: 2.5, tau: 2 },        // n-граммы + FAQ на коммерческих страницах
    KP_rank: { mult: 1.10, lag: 3, tau: 2 },     // КФ/КНДР лидеров на сайте - коммерческие факторы
    LB: { mult: 1.08, lag: 3, tau: 3 },
    LA: { mult: 1.15, lag: 3, tau: 3 },
    YM: { mult: 1.12, lag: 1, tau: 2 },          // Карты: активность карточки передается сайту
  },
  tech_critical_extra: 1.08,                     // FA при критичных ошибках индексации - добавка

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
  ym_leads_share: { services: 0.0015, medical: 0.002, b2b: 0.0003, high_ticket: 0.0003, ecommerce: 0.0002, info: 0 },
  ym_leads_min: 3,
  ym_leads_ramp: { lag: 1, tau: 2 },
  ym_card_create_lag: 0.5,                       // карточки нет - первая неделя уходит на оформление

  // Удержание после остановки ПФ (для справки и текста условий): плавно 0,7 + 0,3 x exp(-t/1,5), t - мес после
  // остановки (портфель: через месяц ~0,9 от пика, через 2-3 мес ~0,72; у ltenergy за 15 мес медиана 0,91).
  pf_retention: 0.7,
};

// Дефолты экономики по типу бизнеса (если клиент не назвал). Конверсия - визит -> обращение
// (звонок, заявка, мессенджер; для магазина - заказ). Консервативный край кейсов.
export const ECON_DEFAULTS = {
  services:    { model: "two_step", conversion_rate: 0.05,  close_rate: 0.3,  margin: 0.4 },
  medical:     { model: "two_step", conversion_rate: 0.05,  close_rate: 0.5,  margin: 0.4 },
  b2b:         { model: "two_step", conversion_rate: 0.03,  close_rate: 0.2,  margin: 0.35 },
  high_ticket: { model: "two_step", conversion_rate: 0.02,  close_rate: 0.05, margin: 0.2 },
  ecommerce:   { model: "one_step", conversion_rate: 0.015, close_rate: 1,    margin: 0.25 },
  info:        { model: "one_step", conversion_rate: 0.01,  close_rate: 1,    margin: 0.5 },
};

// ═══ Утилиты ═══
function num(v, dflt = 0) {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : dflt;
}
export function ramp(t, lag, tau) {
  if (t <= lag) return 0;
  return 1 - Math.exp(-(t - lag) / Math.max(tau, 0.01));
}
function boostAt(t, b, lagShift = 0) {
  return 1 + (b.mult - 1) * ramp(t, b.lag + lagShift, b.tau);
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
    basis: e.basis || "",
  };
}

// Затраты тарифа по месяцам 1..H. Разовые - в 1-й мес. Акции: promos[] с {type:"pf_2for1"} - минус цена
// ежемесячной ПФ-услуги во 2-й мес; {type:"discount", month, amount} - произвольная скидка месяца.
export function costSeries(tariff, H = HORIZON) {
  const onetime = num(tariff && tariff.total_onetime, sumPrices(tariff && tariff.onetime));
  const monthly = num(tariff && tariff.total_monthly, sumPrices(tariff && tariff.monthly));
  const out = new Array(H + 1).fill(0);
  for (let m = 1; m <= H; m++) out[m] = monthly + (m === 1 ? onetime : 0);
  for (const p of (tariff && tariff.promos) || []) {
    if (!p) continue;
    if (p.type === "pf_2for1") {
      const pf = ((tariff.monthly) || []).find((s) => s && (s.id === "PF" || s.id === "PFP"));
      const amount = num(p.amount, pf ? num(pf.price, 0) : 0);
      if (H >= 2) out[2] = Math.max(0, out[2] - amount);
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
export function trafficSeries(fi = {}, ids = new Set(), H = HORIZON) {
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

  const hasPF = ids.has("PF") || ids.has("PFP");
  const hasSY = ids.has("SY");
  // Метатеги входят в SY (TARIFFS.md; RULES.md: пара SY/MT - MT при SY не ставится). Эффект MT дает и SY,
  // иначе обязательная замена MT -> SY в тарифе выше роняла бы его кривую ниже тарифа ниже на 2-3 мес.
  const hasMT = ids.has("MT") || hasSY;
  const hasTexts = ids.has("KP") || ids.has("FQ");
  const hasKP = ids.has("KP");
  const hasAR = ids.has("AR");
  const hasYM = ids.has("YM") && local;

  // 1) Существующие страницы.
  const f = Math.min(1, Math.max(CAL.mult_floor, Math.pow(CAL.mult_ref_t0 / Math.max(t0, 1), 0.25)));
  const multMax = 1 + ((hasPF ? CAL.pf_mult_max : CAL.nopf_mult_max) - 1) * f;
  const pageTarget = (existingPages * vpp + cards * CAL.vpp_card) * (hasPF ? 1 : CAL.nopf_level_factor[comp]);
  const existTarget = Math.max(t0 * multMax, pageTarget, t0);
  const existRamp = hasPF ? CAL.pf_ramp : CAL.nopf_ramp;

  // 2) Новые страницы (только при SY).
  const contentQ = hasTexts ? CAL.content_q_with_texts : CAL.content_q_structure_only;
  const newLevel = hasSY
    ? plannedNew * vppNew * contentQ * (hasPF ? 1 : CAL.nopf_level_factor[comp])
    : 0;
  const newRamp = hasPF ? CAL.new_pages_ramp_pf : CAL.new_pages_ramp_nopf;

  // Потолок коммерческого трафика по спросу (если спрос известен).
  const cap = demandCommercial > 0
    ? Math.max(demandCommercial * CAL.demand_share_cap[comp], t0 * 1.2)
    : Infinity;

  const series = [];
  for (let m = 0; m <= H; m++) {
    const exist = m === 0 ? t0 : t0 + (existTarget - t0) * ramp(m, existRamp.lag, existRamp.tau);
    const fresh = m === 0 ? 0 : newLevel * ramp(m, newRamp.lag + implShift, newRamp.tau);
    let boost = 1;
    const parts = {};
    if (m > 0) {
      for (const id of ["FA", "BS", "MT", "FQ", "LB", "LA"]) {
        if (!(id === "MT" ? hasMT : ids.has(id))) continue;
        let b = CAL.boosts[id];
        if (id === "FA" && techCritical) b = { ...b, mult: b.mult * CAL.tech_critical_extra };
        const k = boostAt(m, b, id === "BS" ? 0 : implShift);
        boost *= k;
        parts[id] = k;
      }
      if (hasKP) {
        const k = boostAt(m, CAL.boosts.KP_rank, implShift);
        boost *= k;
        parts.KP = k;
      }
      if (hasYM) {
        const k = boostAt(m, CAL.boosts.YM, hasCard ? 0 : CAL.ym_card_create_lag);
        boost *= k;
        parts.YM = k;
      }
    }
    const commercialRaw = (exist + fresh) * boost;
    const commercial = m === 0 ? t0 : Math.max(t0, Math.min(commercialRaw, cap));

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
      const level = share > 0 ? Math.max(CAL.ym_leads_min, demandCommercial * share) : 0;
      mapsLeads = level * ramp(m, CAL.ym_leads_ramp.lag + (hasCard ? 0 : CAL.ym_card_create_lag), CAL.ym_leads_ramp.tau);
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
      exist_part: m === 0 ? t0 : Math.min(exist * boost, commercial),
      new_part: Math.max(0, commercial - Math.min(exist * boost, commercial)),
      maps_leads: mapsLeads,
      conv_mult: convMult,
      boosts: parts,
    });
  }
  return series;
}

// ═══ Деньги по тарифу ═══
export function computeTariff(fi, tariff, H = HORIZON) {
  const econ = resolveEconomics(fi);
  const ids = tariffServiceIds(tariff);
  const t0 = Math.max(0, num(fi.t0, 0));
  const traffic = trafficSeries(fi, ids, H);
  const cost = costSeries(tariff, H);
  const cr = econ.conversion_rate;
  const close = econ.close_rate;
  const check = econ.avg_check;
  const margin = econ.margin;
  const baseLeads = t0 * cr;

  const months = [];
  let cumProfit = 0, cumCost = 0, payback = null;
  for (let m = 1; m <= H; m++) {
    const tr = traffic[m];
    const leadsSite = tr.commercial * cr * tr.conv_mult - baseLeads;
    const leadsInfo = tr.info * cr * CAL.info_conv_factor;
    const leads = Math.max(0, leadsSite + leadsInfo + tr.maps_leads);
    const sales = leads * close;
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
    if (s.year1.romi <= 0) soft.push(`ROMI Старта за 12 мес ${s.year1.romi}% <= 0`);
  }
  if (g && x) {
    if (x.checkpoints.m12 + 0.5 < g.checkpoints.m12) hard.push(`трафик Максимума к 12 мес ниже Роста - состав Максимума не шире Роста`);
    if (x.year2.net < g.year2.net) soft.push(`чистый результат Максимума за 24 мес (${x.year2.net}) меньше Роста (${g.year2.net})`);
  }
  return { hard, soft };
}
