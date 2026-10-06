#!/usr/bin/env node
// build-forecast.mjs - шаг «Прогноз и экономика» /seo-strategiya (после tariff-architect, до strategy-writer).
// Строит кривую трафика и деньги ПО КАЖДОМУ ТАРИФУ из его состава (модель _forecast-model.mjs) и пишет
// forecast.json - единый источник чисел для прозы (strategy-writer), docx, сметы и проверок.
//
// Использование:
//   node .claude/scripts/build-forecast.mjs <strategy_dir> [--quiet]
//
// Вход:
//   <strategy_dir>/seo-strategiya_data.json - forecast_inputs (growth-strategist)
//   <strategy_dir>/tariffs.json             - состав и цены тарифов, promos (tariff-architect)
//   <strategy_dir>/inputs.json              - экономика от клиента (avg_check/conversion_rate/close_rate/margin)
//                                             перекрывает оценки агента
// Выход:
//   <strategy_dir>/forecast.json
//
// Exit:
//   0 - готово (предупреждения экономики допустимы, печатаются);
//   3 - тарифы: блок «ПРАВИЛА ТАРИФОВ» (выведенные/неизвестные ID, DEV в тарифе, цены не по каталогу, связки,
//       пары, включение - до расчета, forecast.json не пишется) или «ЭКОНОМИЧЕСКИЙ ГЕЙТ» (ROMI Роста <= 0,
//       Рост хуже Старта по чистому результату, кривая тарифа выше ниже кривой тарифа ниже; forecast.json
//       записан) -> пере-делегировать tariff-architect (1 круг);
//   2 - битый или неполный forecast_inputs -> пере-делегировать growth-strategist;
//   1 - ошибка запуска (нет файлов, битый JSON).

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  MODEL_VERSION, TARIFF_KEYS, HORIZON, CAL, ECON_DEFAULTS,
  computeAll, economicsChecks, resolveEconomics, applyClientEconomics, recommendOffer, lostNowCalc,
} from "./_forecast-model.mjs";
import { SERVICES, RETIRED_IDS, canonicalId } from "./_services.mjs";
import { nicheCard } from "./_niche.mjs";

const args = process.argv.slice(2);
const dirArg = args.find((a) => !a.startsWith("--"));
const quiet = args.includes("--quiet");
if (!dirArg) {
  console.error("[build-forecast] usage: node build-forecast.mjs <strategy_dir>");
  process.exit(1);
}
const dir = resolve(dirArg);

function readJson(name, fatal = true) {
  const p = join(dir, name);
  if (!existsSync(p)) {
    if (fatal) { console.error(`[build-forecast] не найден: ${p}`); process.exit(1); }
    return null;
  }
  try {
    return JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, ""));
  } catch (e) {
    console.error(`[build-forecast] битый JSON ${p}: ${e.message}`);
    process.exit(1);
  }
}

const data = readJson("seo-strategiya_data.json");
const tariffsRaw = readJson("tariffs.json");
const inputs = readJson("inputs.json", false) || {};

// ── Тарифы: канонические ключи (алиас rost -> growth, как в смете) ──
const KEY_ALIASES = { rost: "growth" };
const tariffs = {};
for (const k of Object.keys(tariffsRaw || {})) {
  const ck = KEY_ALIASES[k] || k;
  if (TARIFF_KEYS.includes(ck)) tariffs[ck] = tariffsRaw[k];
}
if (!tariffs.growth) {
  console.error("[build-forecast] в tariffs.json нет тарифа growth (Рост) - прогноз строить не по чему");
  process.exit(1);
}

// ── forecast_inputs: валидация ──
// Число - только настоящее: null, "", true, [] дают Number(...) = 0/1 и молча прошли бы проверку.
const isNum = (v) =>
  (typeof v === "number" && Number.isFinite(v)) ||
  (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)));
const fiRaw = data && data.forecast_inputs;
const problems = [];
if (!fiRaw || typeof fiRaw !== "object" || Array.isArray(fiRaw)) {
  problems.push("нет forecast_inputs в seo-strategiya_data.json");
} else {
  if (!isNum(fiRaw.t0) || Number(fiRaw.t0) < 0) problems.push(`t0 не число >= 0: ${JSON.stringify(fiRaw.t0)}`);
  if (!fiRaw.pages || typeof fiRaw.pages !== "object") problems.push("нет pages {existing_commercial, planned_new}");
  else {
    if (!isNum(fiRaw.pages.existing_commercial) || Number(fiRaw.pages.existing_commercial) < 0) problems.push(`pages.existing_commercial не число >= 0: ${JSON.stringify(fiRaw.pages.existing_commercial)}`);
    if (!isNum(fiRaw.pages.planned_new) || Number(fiRaw.pages.planned_new) < 0) problems.push(`pages.planned_new не число >= 0: ${JSON.stringify(fiRaw.pages.planned_new)}`);
    if (fiRaw.pages.catalog_cards != null && !isNum(fiRaw.pages.catalog_cards)) problems.push(`pages.catalog_cards не число: ${JSON.stringify(fiRaw.pages.catalog_cards)}`);
  }
  if (!fiRaw.demand || !isNum(fiRaw.demand.commercial_month) || Number(fiRaw.demand.commercial_month) < 0) problems.push("нет demand.commercial_month (сумма точных частот коммерческого спроса в регионе)");
  if (fiRaw.business_type && !ECON_DEFAULTS[fiRaw.business_type]) problems.push(`business_type неизвестен: ${fiRaw.business_type} (допустимо: ${Object.keys(ECON_DEFAULTS).join(", ")})`);
  if (fiRaw.competition && !["low", "medium", "high"].includes(fiRaw.competition)) problems.push(`competition: ${fiRaw.competition} (low|medium|high)`);
}

// ── Экономика: клиент (inputs.json) перекрывает оценку агента; проценты -> доли (econFraction в модели:
// conversion_rate и margin >= 1 - проценты, «1» = 1%; close_rate 1 = 100%) ──
const { fi, fromClient } = applyClientEconomics(fiRaw, inputs);
if (!(Number(fi.economics.avg_check) > 0)) problems.push("economics.avg_check не задан (> 0) - ни клиентом, ни оценкой по нише");
// Диапазоны долей после перевода. Значение агента вне диапазона - дефект growth-strategist (exit 2);
// клиента - предупреждение (клиент знает свой бизнес, но значение надо подтвердить).
const ECON_RANGE = { conversion_rate: [0, 0.3], close_rate: [0, 1], margin: [0, 1] };
const econWarnings = [];
for (const [k, [lo, hi]] of Object.entries(ECON_RANGE)) {
  const v = fi.economics[k];
  if (v == null || v === "") continue;
  const n = Number(v);
  const bad = !Number.isFinite(n) || n <= lo || n > hi;
  if (!bad) continue;
  const msg = `economics.${k} = ${JSON.stringify(v)} вне диапазона (${lo}; ${hi}] - доля, а не процент? (1% = 0.01)`;
  if (fromClient.includes(k)) econWarnings.push(`${msg} - значение клиента из inputs.json, подтвердить у клиента`);
  else problems.push(msg);
}

if (problems.length) {
  console.log("[build-forecast] НЕПОЛНЫЙ forecast_inputs (дефект growth-strategist):");
  for (const p of problems) console.log(`  - ${p}`);
  process.exit(2);
}

// ── Правила тарифов (RULES.md, TARIFFS.md, Шаг 10 tariff-architect) - до расчета ──
// Выведенный или неверно написанный ID модель молча не узнает (эффекта ноль, цена в затратах), цена не по
// каталогу или итог не равен сумме строк - смета и ROMI разъедутся с прайсом. Это дефект tariff-architect:
// exit 3 (тот же круг пересборки, что и экономический гейт), forecast.json не пишется.
const ruleViolations = tariffRuleViolations(tariffs, fi);
if (ruleViolations.length) {
  console.log("[build-forecast] ПРАВИЛА ТАРИФОВ (нарушения - пересобрать тарифы, прогноз не строился):");
  for (const v of ruleViolations) console.log(`  - ${v}`);
  process.exit(3);
}

function tariffRuleViolations(byKey, fiResolved) {
  const out = [];
  const NAME = { start: "Старт", growth: "Рост", max: "Максимум" };
  const PAIRS = [["BS", "FA"], ["LB", "LA"], ["PF", "PFP"], ["ART", "AR"], ["SY", "MT"]];
  const UPGRADE = { PF: "PFP", LB: "LA", ART: "AR", MT: "SY" };
  const NOT_IN_START = ["LB", "LA", "AR", "IT"];
  const idsOf = {};
  const hasPf2for1 = {};
  for (const k of TARIFF_KEYS) {
    const t = byKey[k];
    if (!t) continue;
    const name = NAME[k];
    const ids = new Set();
    let hasMonthly = false;
    const sums = { onetime: 0, monthly: 0 };
    for (const part of ["onetime", "monthly"]) {
      const list = t[part];
      if (list != null && !Array.isArray(list)) { out.push(`${name}: ${part} не массив`); continue; }
      for (const s of list || []) {
        if (!s || typeof s !== "object" || !s.id) { out.push(`${name}: строка ${part} без id`); continue; }
        // сумма строк - по всем строкам с числовой ценой (как SUM в смете), в том числе с битым ID
        if (typeof s.price === "number" && Number.isFinite(s.price)) sums[part] += s.price;
        const raw = String(s.id).trim();
        const id = canonicalId(raw);
        if (raw === "DEV" || raw.toUpperCase() === "DEV") { out.push(`${name}: DEV в тарифе - разработка сайта только блоком site_dev`); continue; }
        if (RETIRED_IDS.includes(raw.toUpperCase())) { out.push(`${name}: выведенный ID «${raw}» (линейка 06.10.2026, TARIFFS.md)`); continue; }
        if (!SERVICES[id]) {
          out.push(SERVICES[canonicalId(raw.toUpperCase())]
            ? `${name}: ID «${raw}» - пиши «${raw.toUpperCase()}» (модель и смета узнают только верхний регистр)`
            : `${name}: неизвестный ID «${raw}» (нет в каталоге TARIFFS.md)`);
          continue;
        }
        const meta = SERVICES[id];
        if (meta.type !== part) out.push(`${name}: ${id} в ${part === "onetime" ? "разовых" : "ежемесячных"}, а услуга ${meta.type === "onetime" ? "разовая" : "ежемесячная"}`);
        if (id === "ST") out.push(`${name}: ST (сателлит) - только в массиве special, не в тарифе`);
        if (!(typeof s.price === "number" && Number.isFinite(s.price) && s.price >= 0)) {
          out.push(`${name}: ${id} - price не число: ${JSON.stringify(s.price)}`);
        } else {
          if (id === "ART") {
            if (s.price !== 0) out.push(`${name}: ART - только акция: {"id": "ART", "price": 0, "regular_price": 3000, "promo": true}, сейчас price ${s.price}`);
          } else if (id === "BS") {
            if (s.price !== 5000 && s.price !== 10000) out.push(`${name}: BS ${s.price} - по каталогу 5 000 (до 10 стр.) или 10 000 (до 50 стр.)`);
          } else if (id !== "RP" && s.price !== meta.price) {
            out.push(`${name}: ${id} ${s.price} - по каталогу ${meta.price}`);
          }
        }
        if (part === "monthly" && id !== "RP") hasMonthly = true;
        ids.add(id);
      }
    }
    idsOf[k] = ids;
    const rp = (t.monthly || []).find((s) => s && canonicalId(String(s.id || "").trim()) === "RP");
    if (rp && hasMonthly && rp.price !== 0) out.push(`${name}: RP ${rp.price} - при ежемесячных работах отчетность бесплатно (0)`);
    if (rp && !hasMonthly) out.push(`${name}: RP без ежемесячных работ - при только разовых RP не ставится`);
    for (const [a, b] of PAIRS) if (ids.has(a) && ids.has(b)) out.push(`${name}: ${a} и ${b} вместе - взаимоисключающие (RULES раздел 1)`);
    if ((ids.has("SY") || ids.has("KP")) && !ids.has("PA")) out.push(`${name}: ${ids.has("SY") ? "SY" : "KP"} без PA - анализ обязателен перед структурой и текстами`);
    if (ids.has("AR") && !ids.has("IT")) out.push(`${name}: AR без IT - статьям нужны темы`);
    if (ids.has("IT") && !ids.has("AR")) out.push(`${name}: IT без AR - темы только вместе со статьями`);
    if ((ids.has("PF") || ids.has("PFP")) && !ids.has("RP")) out.push(`${name}: ${ids.has("PF") ? "PF" : "PFP"} без RP - ПФ без отчетности не ставится`);
    if (ids.has("FQ") && ids.has("KP") && !ids.has("SY")) out.push(`${name}: FQ в связке «KP без SY» - у страниц нет запросов`);
    if (ids.has("YM") && !fiResolved.local) out.push(`${name}: YM, а forecast_inputs.local = false - Карты только для локального бизнеса с адресом`);
    if (k === "start") for (const id of NOT_IN_START) if (ids.has(id)) out.push(`Старт: ${id} - не кладется в Старт (RULES раздел 5)`);
    for (const part of ["onetime", "monthly"]) {
      const total = t[`total_${part}`];
      if (total == null) continue;
      if (!(typeof total === "number" && Number.isFinite(total))) out.push(`${name}: total_${part} не число: ${JSON.stringify(total)}`);
      else if (Math.abs(total - sums[part]) > 0.5) out.push(`${name}: total_${part} ${total} != сумма цен строк ${sums[part]}`);
    }
    const promos = t.promos == null ? [] : t.promos;
    if (!Array.isArray(promos)) out.push(`${name}: promos не массив`);
    hasPf2for1[k] = Array.isArray(promos) && promos.some((p) => p && p.type === "pf_2for1");
    if (hasPf2for1[k] && !ids.has("PF") && !ids.has("PFP")) out.push(`${name}: акция «ПФ 1=2» в тарифе без PF/PFP - скидке не из чего взяться`);
  }
  // Включение: тариф выше содержит все услуги тарифа ниже (или их усиленную версию).
  for (const [lo, hi] of [["start", "growth"], ["growth", "max"]]) {
    if (!idsOf[lo] || !idsOf[hi]) continue;
    const lost = [...idsOf[lo]].filter((id) => !idsOf[hi].has(id) && !(UPGRADE[id] && idsOf[hi].has(UPGRADE[id])));
    if (lost.length) out.push(`${NAME[hi]} не включает ${NAME[lo]}: нет ${lost.join(", ")} (тариф выше содержит все услуги тарифа ниже)`);
  }
  // Акция «ПФ 1=2» - во всех тарифах с ПФ или ни в одном.
  const withPf = TARIFF_KEYS.filter((k) => idsOf[k] && (idsOf[k].has("PF") || idsOf[k].has("PFP")));
  const promoKeys = withPf.filter((k) => hasPf2for1[k]);
  if (promoKeys.length && promoKeys.length !== withPf.length) {
    out.push(`акция «ПФ 1=2» есть в ${promoKeys.map((k) => NAME[k]).join(", ")}, но нет в ${withPf.filter((k) => !hasPf2for1[k]).map((k) => NAME[k]).join(", ")} - во всех тарифах с ПФ или ни в одном`);
  }
  return out;
}

// ── Расчет ──
const res = computeAll(fi, tariffs, HORIZON);
const checks = economicsChecks(res);
const econ = resolveEconomics(fi);

const g = res.growth;
const t0 = Number(fi.t0) || 0;
const rnd = (x) => Math.round(x);
const rnd1 = (x) => Math.round(x * 10) / 10;

// Рекомендация для сметы и docx (recommendOffer в модели, ее же зовет verify-strategy.mjs): Рост по умолчанию,
// при проваленном экономическом гейте - тариф с лучшим чистым результатом за 12 мес, если он в плюсе, иначе null.
// План работ, график и потери в docx строятся по plan_tariff (= рекомендованный или Рост).
const { recommended_offer: recommendedOffer, plan_tariff: planKey } = recommendOffer(res, checks);
const pt = res[planKey] || g;

// «Деньги, которые вы теряете» (v2.1, lostNowCalc в модели - ее же зовет verify-strategy.mjs): разрыв с ориентиром
// конкурентов из топа (не больше уровня плана к 12-му мес) по БАЗОВОЙ конверсии; нет данных о конкурентах - по плану.
const lost = lostNowCalc(fi, pt);
const lostNow = {
  basis: lost.basis,
  basis_note: lost.basis === "competitors"
    ? "разрыв с медианой трафика сопоставимых конкурентов из топа (не больше уровня, который реально взять за год), по базовой конверсии"
    : "разрыв с уровнем, который реально взять за 12 мес по плану работ, по базовой конверсии",
  target_traffic: rnd(lost.target_traffic),
  traffic_month: rnd(lost.traffic_month),
  leads_month: rnd1(lost.leads_month),
  sales_month: rnd1(lost.sales_month),
  revenue_month: rnd(lost.revenue_month),
  revenue_year: rnd(lost.revenue_month * 12),
  competitors_traffic_median: lost.competitors_traffic_median,
  competitors_traffic_leader: lost.competitors_traffic_leader,
};

// Ряд «план vs без работ» для docx (тариф плана), месяцы 0..12.
const planSeries = [{ m: 0, traffic: t0, leads: 0, revenue: 0, baseline: t0 }];
for (const r of pt.months.slice(0, 12)) {
  planSeries.push({ m: r.m, traffic: rnd(r.traffic), leads: rnd1(r.leads), revenue: rnd(r.revenue), baseline: t0 });
}

function tariffOut(r) {
  return {
    ids: r.ids,
    launch_month: r.launch_month,
    cap: r.cap,
    capped_from_month: r.capped_from_month,
    checkpoints: Object.fromEntries(Object.entries(r.checkpoints).map(([k, v]) => [k, rnd(v)])),
    drivers_m12: r.drivers_m12,
    year1: r.year1,
    year2: r.year2,
    payback_month: r.payback_month,
    m12: r.m12,
    runrate_m12: r.runrate_m12 == null ? null : rnd1(r.runrate_m12),
    months: r.months.map((x) => ({
      m: x.m,
      traffic: rnd(x.traffic), traffic_commercial: rnd(x.traffic_commercial), traffic_info: rnd(x.traffic_info),
      leads: rnd1(x.leads), leads_maps: rnd1(x.leads_maps),
      sales: rnd1(x.sales), revenue: rnd(x.revenue), profit: rnd(x.profit), cost: rnd(x.cost),
      cum_profit: rnd(x.cum_profit), cum_cost: rnd(x.cum_cost), cashflow: rnd(x.cashflow),
    })),
  };
}

// Методика одной строкой (смета печатает ее как «Методика», docx - не берет). Подписи - по модели воронки,
// как на листе «Окупаемость»: one_step (магазин, инфо) - «визит -> заказ», без шага «обращение -> продажа».
const fmtPct = (x) => (Math.round(x * 1000) / 10).toLocaleString("ru-RU");
const caseNote = econ.model === "one_step"
  ? ""
  : fromClient.includes("conversion_rate")
    ? " (данные клиента)"
    : " (кейсы агентства: медиана 9,1% по целям Метрики, берем с запасом)";
const assumptionsNote = econ.model === "one_step"
  ? `Конверсия визит -> заказ ${fmtPct(econ.conversion_rate)}%${fromClient.includes("conversion_rate") ? " (данные клиента)" : " (типовая для этого типа бизнеса)"}, ` +
    `средний чек ${econ.avg_check.toLocaleString("ru-RU")} руб${econ.avg_check_source === "client" ? "" : " (оценка)"}, маржинальность ${fmtPct(econ.margin)}%. `
  : `Конверсия визит -> обращение ${fmtPct(econ.conversion_rate)}%${caseNote}, ` +
    `обращение -> продажа ${fmtPct(econ.close_rate)}%, средний чек ${econ.avg_check.toLocaleString("ru-RU")} руб` +
    `${econ.avg_check_source === "client" ? "" : " (оценка)"}, маржинальность ${fmtPct(econ.margin)}%. `;


// «Объем и конкурентность ниши» (v2.2): рынок, сила конкурентов по факторам и работы, закрывающие разрывы. Читает уже
// собранные competitors.json и metrics.json (нефатально: нет файла - строки без данных пропускаются).
let niche = null;
try {
  const competitorsJson = readJson("competitors.json", false) || {};
  const metricsJson = readJson("metrics.json", false) || {};
  niche = nicheCard({
    fi, competitors: competitorsJson, metrics: metricsJson,
    planIds: new Set(pt.ids), maxIds: new Set((res.max && res.max.ids) || []),
    planM12: pt.months[11].traffic, cap: pt.cap,
  });
} catch (e) {
  console.warn(`[build-forecast] niche: пропущен (${e.message})`);
}

const out = {
  model_version: MODEL_VERSION,
  horizon_months: HORIZON,
  recommended: planKey,
  recommended_offer: recommendedOffer,
  plan_tariff: planKey,
  launch_month: pt.launch_month,
  traffic_cap: pt.cap,
  inputs: {
    t0,
    t0_source: fi.t0_source || (data.traffic_month_estimated ? "estimated" : "keyso"),
    business_type: econ.business_type,
    competition: fi.competition || "medium",
    pages: fi.pages,
    demand: fi.demand,
    local: !!fi.local,
    maps_card: fi.maps_card || "unknown",
    economics: econ,
    economics_from_client: fromClient,
  },
  assumptions_note:
    assumptionsNote +
    (econ.ltv_factor > 1 ? `Повторные покупки одного клиента за год: x${String(Math.round(econ.ltv_factor * 10) / 10).replace(".", ",")}. ` : "") +
    (econ.sales_lag_months > 0 ? `Обращение становится продажей в среднем через ${econ.sales_lag_months} мес (цикл сделки). ` : "") +
    (pt.launch_month > 1 ? `Новый сайт выходит в поиск к ${pt.launch_month}-му мес: ежемесячные работы оплачиваются с этого месяца. ` : "") +
    `Деньги считаются только с прироста к текущему трафику. ROMI - от валовой прибыли (выручка x маржа). Оценка, не гарантия.`,
  baseline: {
    traffic_month: t0,
    leads_month: rnd1(t0 * econ.conversion_rate),
    revenue_month: rnd(t0 * econ.conversion_rate * econ.close_rate * econ.avg_check * econ.ltv_factor),
  },
  lost_now: lostNow,
  niche,
  plan_series: planSeries,
  tariffs: Object.fromEntries(Object.entries(res).map(([k, r]) => [k, tariffOut(r)])),
  checks,
  calibration_ref: {
    pf_mult_max: CAL.pf_mult_max,
    vpp: CAL.vpp[econ.business_type],
    kp_conv_mult: CAL.kp_conv_mult,
    source: "кейсы cases.timur-seo.ru (13) + портфель Monstro/Метрика (ПФ, 13 сайтов), модель v2.1",
  },
};

writeFileSync(join(dir, "forecast.json"), JSON.stringify(out, null, 2), "utf8");

// ── Сводка ──
if (!quiet) {
  const name = { start: "Старт", growth: "Рост", max: "Максимум" };
  console.log(`[build-forecast] forecast.json готов (модель ${MODEL_VERSION}). Трафик сейчас ${t0}, тип ${econ.business_type}, чек ${econ.avg_check.toLocaleString("ru-RU")}${econ.avg_check_source === "client" ? "" : " (оценка)"}.`);
  for (const k of TARIFF_KEYS) {
    const r = out.tariffs[k];
    if (!r) continue;
    const c = r.checkpoints;
    console.log(`  ${name[k].padEnd(8)} трафик m3/m6/m12: ${c.m3}/${c.m6}/${c.m12} | обращений к 12 мес: ${r.m12.leads}/мес | ROMI 12 мес: ${r.year1.romi}% | 24 мес: ${r.year2.romi}% | окупаемость: ${r.payback_month ? r.payback_month + " мес" : "> 24 мес"}`);
  }
  console.log(`  Теряете сейчас: ~${lostNow.leads_month.toLocaleString("ru-RU")} обращений и ~${lostNow.revenue_month.toLocaleString("ru-RU")} руб выручки в месяц.`);
}
if (checks.soft.length || econWarnings.length) {
  console.log("\nЭКОНОМИКА (предупреждения):");
  for (const s of [...econWarnings, ...checks.soft]) console.log(`  - ${s}`);
}
if (checks.hard.length) {
  console.log("\nЭКОНОМИЧЕСКИЙ ГЕЙТ (нарушения - пересобрать тарифы):");
  for (const h of checks.hard) console.log(`  - ${h}`);
  process.exit(3);
}
process.exit(0);
