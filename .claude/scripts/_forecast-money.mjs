#!/usr/bin/env node
// _forecast-money.mjs - единый источник денежной математики декомпозиции/окупаемости (этап 8).
// Чистые функции, без I/O. Импортируется build-smeta-xlsx.mjs, verify-strategy.mjs,
// build-strategy-docx.mjs. Меняешь формулу тут - меняется везде.
//
// Ключевой фикс этапа 8 (был рассинхрон числителя и знаменателя ROMI):
// costMonthsUsed = min(m, activeMonths) вместо m; yearCost = onetime + monthly * activeMonths
// вместо monthly * 12 всегда. Затраты на ежемесячные услуги начисляются только за реально
// оплаченные месяцы (active_months сценария), а не за все 12 - иначе сценарий "вход 3-6 мес"
// получал затраты за год при выручке за несколько месяцев.

export const TARIFF_SCALE = { start: 0.6, growth: 1.0, max: 1.3 };
export const TARIFF_KEYS = ["start", "growth", "max"];

function num(v, dflt = 0) {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : dflt;
}

// checkpoints {m0,m3,m6,m9,m12} -> трафик на месяц m (1..12), кусочно-линейная интерполяция.
export function interpCheckpoints(cp, m) {
  const src = cp || {};
  const pts = [
    { x: 0, y: num(src.m0, NaN) },
    { x: 3, y: num(src.m3, NaN) },
    { x: 6, y: num(src.m6, NaN) },
    { x: 9, y: num(src.m9, NaN) },
    { x: 12, y: num(src.m12, NaN) },
  ].filter((p) => Number.isFinite(p.y));
  if (!pts.length) return 0;
  if (m <= pts[0].x) return pts[0].y;
  if (m >= pts[pts.length - 1].x) return pts[pts.length - 1].y;
  for (let i = 1; i < pts.length; i++) {
    if (m <= pts[i].x) {
      const a = pts[i - 1], b = pts[i];
      const t = b.x === a.x ? 0 : (m - a.x) / (b.x - a.x);
      return a.y + (b.y - a.y) * t;
    }
  }
  return pts[pts.length - 1].y;
}

// active_months: число или {start,growth,max} -> число для конкретного тарифа. Кламп 1..12.
export function resolveActiveMonths(activeMonths, tariffKey) {
  let v;
  if (activeMonths && typeof activeMonths === "object") v = activeMonths[tariffKey];
  else v = activeMonths;
  v = Math.round(num(v, NaN));
  if (!Number.isFinite(v) || v < 1) v = 1;
  if (v > 12) v = 12;
  return v;
}

// Ядро: расчет по паре (сценарий x тариф).
// args: { assumptions, checkpoints, activeMonths (число/объект), tariffKey, onetime, monthly }
// Возврат: {series[], costMonths, traffic12, leads12, sales12, revMonth12,
//           yearCost, yearGross, yearProfit, yearNet, romi, payback}
// ROMI и точка окупаемости считаются ОТ ПРИБЫЛИ (выручка x маржа), не от валовой выручки -
// это консервативнее и защитимее перед клиентом (вердикт стратега, этап 8).
export function computeScenarioTariff(args = {}) {
  const a = args.assumptions || {};
  const cr = num(a.conversion_rate, 0.02);
  const close = num(a.close_rate, a.model === "one_step" ? 1 : 0.3);
  const avg = num(a.avg_check, 0);
  const margin = num(a.margin, 0.35);
  const scale = TARIFF_SCALE[args.tariffKey] ?? 1;
  const onetime = num(args.onetime, 0);
  const monthly = num(args.monthly, 0);
  const activeM = resolveActiveMonths(args.activeMonths, args.tariffKey);

  let cumRev = 0;
  let payback = null;
  const series = [];
  for (let m = 1; m <= 12; m++) {
    const traffic = interpCheckpoints(args.checkpoints, m) * scale;
    const revenue = traffic * cr * close * avg;
    cumRev += revenue;
    const cumProfit = cumRev * margin;
    const costMonthsUsed = Math.min(m, activeM); // ключевой фикс: не m, а min(m, activeM)
    const cumCost = onetime + monthly * costMonthsUsed;
    const cumCashflow = cumProfit - cumCost;
    if (payback === null && cumCashflow > 0) payback = m;
    series.push({ m, traffic, revenue, cumRevenue: cumRev, cumProfit, cumCost, cumCashflow });
  }

  const t12 = interpCheckpoints(args.checkpoints, 12) * scale;
  const leads12 = t12 * cr;
  const sales12 = leads12 * close;
  const yearCost = onetime + monthly * activeM; // ключевой фикс: activeM, не 12
  const yearGross = cumRev;
  const yearProfit = cumRev * margin;
  const yearNet = yearProfit - yearCost;
  const romi = yearCost > 0 ? (yearNet / yearCost) * 100 : 0;

  return {
    series,
    costMonths: activeM,
    traffic12: Math.round(t12),
    leads12: Math.round(leads12),
    sales12: Math.round(sales12),
    revMonth12: Math.round(sales12 * avg),
    yearCost: Math.round(yearCost),
    yearGross: Math.round(yearGross),
    yearProfit: Math.round(yearProfit),
    yearNet: Math.round(yearNet),
    romi: Math.round(romi),
    payback,
  };
}
