#!/usr/bin/env node
// _niche.mjs - «Объем и конкурентность ниши» для /seo-strategiya (v2.2, 06.10.2026). Чистая функция, без I/O.
// Зовет build-forecast.mjs (пишет результат в forecast.json -> niche); docx рисует блок по маркеру niche_card в
// разделе «Кто в топе», смета - строки на листе «Сравнение тарифов».
//
// Зачем (запрос владельца 06.10): в прогнозе не хватало конкретики - какой рынок (сколько ищут, сколько переходов
// получают сайты из топа и что из этого реально взять) и насколько сильны конкуренты (по каким показателям, и какая
// работа закрывает каждый разрыв). Все числа - из уже собранных данных (competitors.json, metrics.json,
// forecast_inputs, прогноз модели), новых MCP-вызовов нет. Строки без данных пропускаются (старые прогоны).

function num(v) {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}
function median(arr) {
  const a = arr.filter((x) => x != null && Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}
const trafficOf = (c) => num(c && (c.traffic_month ?? c.traffic));
const pagesOf = (c) => num(c && (c.commercial_pages ?? c.pages));

// Разрыв клиента с медианой топ-3: big - у клиента меньше половины, some - меньше 80%, none - вровень или выше.
function gapLevel(client, top) {
  if (client == null || top == null || top <= 0) return "unknown";
  const r = client / top;
  return r < 0.5 ? "big" : r < 0.8 ? "some" : "none";
}

// args: { fi (forecast_inputs), competitors (competitors.json), metrics (metrics.json), planIds (Set ID тарифа плана),
//         maxIds (Set ID Максимума), planM12 (трафик тарифа плана к 12 мес), cap (потолок модели) }
export function nicheCard({ fi = {}, competitors = {}, metrics = {}, planIds = new Set(), maxIds = new Set(), planM12 = null, cap = null } = {}) {
  const direct = Array.isArray(competitors.direct) ? competitors.direct.filter((c) => c && c.domain) : [];
  const t0 = num(fi.t0) ?? num(metrics.traffic_month) ?? 0;

  // Топ-3 прямых: по трафику, при его отсутствии - по запросам в ТОП-10.
  const ranked = [...direct].sort((a, b) => ((trafficOf(b) ?? -1) - (trafficOf(a) ?? -1)) || ((num(b.top10) ?? 0) - (num(a.top10) ?? 0)));
  const top3 = ranked.slice(0, 3);
  const ct = fi.competitors_traffic || {};
  const medTraffic = median(top3.map(trafficOf)) ?? num(ct.median);
  const leaderC = ranked.find((c) => trafficOf(c) != null);
  const leader = leaderC ? { domain: leaderC.domain, traffic: trafficOf(leaderC) } : (num(ct.leader) ? { domain: null, traffic: num(ct.leader) } : null);

  const demand = fi.demand || {};
  const volume = {
    demand_exact: num(demand.commercial_month),
    demand_basis: demand.basis || null,
    leader,
    median_top3_traffic: medTraffic != null ? Math.round(medTraffic) : null,
    top3: top3.map((c) => ({ domain: c.domain, traffic: trafficOf(c), top10: num(c.top10), commercial_pages: pagesOf(c), dr: num(c.dr) })),
    client_now: Math.round(t0),
    reachable_12: planM12 != null ? Math.round(planM12) : null,
    share_of_median_12: planM12 != null && medTraffic ? Math.round((planM12 / medTraffic) * 100) : null,
    share_of_leader_12: planM12 != null && leader && leader.traffic ? Math.round((planM12 / leader.traffic) * 100) : null,
    ceiling: cap != null && Number.isFinite(cap) ? Math.round(cap) : null,
    traffic_basis: ct.basis || competitors.keyso_base || null,
  };

  const factors = [];
  const add = (key, label, top, client, gap, services, note) => {
    if (top == null && client == null) return;
    factors.push({ key, label, top3_median: top != null ? Math.round(top) : null, client: client != null ? Math.round(client) : null, gap, services, note: note || null });
  };

  // 1. Страницы под спрос -> структура (+ тексты)
  const topPages = median(top3.map(pagesOf));
  const clientPages = num(fi.pages && fi.pages.existing_commercial);
  const textSvc = planIds.has("KP") ? "KP" : planIds.has("FQ") ? "FQ" : "KP";
  add("pages", "Страниц под спрос (услуги, направления)", topPages, clientPages, gapLevel(clientPages, topPages), ["SY", textSvc]);

  // 2. Видимость: запросов в ТОП-10 -> внешнее продвижение (+ Карты), страницы
  const topVis = median(top3.map((c) => num(c.top10)));
  const clientVis = num(metrics.top10);
  const pfSvc = planIds.has("PFP") ? "PFP" : "PF";
  add("visibility", "Запросов в ТОП-10 Яндекса", topVis, clientVis, gapLevel(clientVis, topVis), fi.local ? [pfSvc, "YM"] : [pfSvc]);

  // 3. Трафик - справочно (это и есть рынок, сервис не привязываем)
  add("traffic", "Переходов из поиска в месяц", medTraffic, t0, gapLevel(t0, medTraffic), []);

  // 4. Ссылочный вес: DR (разница в пунктах) и доноры -> ссылки (только при заметном разрыве)
  const topDr = median(top3.map((c) => num(c.dr)));
  const clientDr = num(metrics.dr);
  if (topDr != null || clientDr != null) {
    const diff = topDr != null && clientDr != null ? topDr - clientDr : null;
    const gap = diff == null ? "unknown" : diff >= 8 ? "big" : diff >= 4 ? "some" : "none";
    add("links", "Ссылочный вес (DR)", topDr, clientDr, gap, gap === "none" ? [] : [maxIds.has("LA") || planIds.has("LA") ? "LA" : "LB"],
      gap === "none" ? "вес сопоставим - ссылки не главное" : "ссылки дают эффект не раньше 3-4 мес, сильнее в Google");
  }
  const topRef = median(top3.map((c) => num(c.ref_domains)));
  const clientRef = num(metrics.ref_domains ?? metrics.referring_domains);
  if (topRef != null && clientRef != null) {
    add("ref_domains", "Сайтов, которые ссылаются (доноры)", topRef, clientRef, gapLevel(clientRef, topRef), []);
  }

  // 5. Коммерческие факторы: элементы лидеров, которых нет у клиента -> анализ КФ/КНДР и прототип
  const lps = competitors.leader_pages_summary || {};
  const missing = Array.isArray(lps.client_missing) ? lps.client_missing.length : null;
  if (missing != null) {
    factors.push({ key: "commercial", label: "Элементы сайтов-лидеров, которых нет у вас (цены, отзывы, калькуляторы и т.п.)",
      top3_median: null, client: missing, gap: missing >= 5 ? "big" : missing >= 2 ? "some" : "none", services: missing >= 2 ? ["KP"] : [],
      note: null, examples: lps.client_missing.slice(0, 4).map((x) => String(typeof x === "string" ? x : (x && (x.element || x.name || x.text)) || "")).filter(Boolean) });
  }

  // 6. Статьи: лидеры растут блогом -> статьи
  const blogText = [lps.blog_usage, ...direct.map((c) => c.growth_model)].filter(Boolean).join(" ").toLowerCase();
  if (/блог|стат/.test(blogText)) {
    factors.push({ key: "blog", label: "Статьи и блог у лидеров", top3_median: null, client: null, gap: "some", services: ["AR"], note: "лидеры берут часть трафика статьями" });
  }

  // 7. Карты: локальный бизнес, карточка не подтверждена или неактивна
  if (fi.local) {
    const card = fi.maps_card || "unknown";
    factors.push({ key: "maps", label: "Карточка в Яндекс Картах", top3_median: null, client: null,
      gap: card === "verified" ? "some" : "big", services: ["YM"],
      note: card === "none" ? "карточки нет" : card === "unverified" ? "карточка не подтверждена" : card === "verified" ? "карточка есть - нужна активность" : "статус карточки не проверен" });
  }

  // Конкуренция: уровень модели + краткое основание
  const level = ["low", "medium", "high"].includes(fi.competition) ? fi.competition : "medium";
  const why = [];
  if (topDr != null) why.push(`DR лидеров около ${Math.round(topDr)}`);
  if (topPages != null) why.push(`${Math.round(topPages)} страниц под спрос`);
  if (topVis != null) why.push(`${Math.round(topVis)} запросов в ТОП-10`);

  // Что нужно, чтобы дотянуться до уровня топа: услуги из разрывов big/some - в плане или в Максимуме
  const need = new Map();
  for (const fct of factors) {
    if (fct.gap === "none") continue;
    for (const id of fct.services || []) {
      if (!need.has(id)) need.set(id, { id, factors: [], in_plan: planIds.has(id), in_max: maxIds.has(id) });
      need.get(id).factors.push(fct.key);
    }
  }

  return {
    volume,
    competition: { level, basis: why.join(", ") || null, factors },
    to_parity: [...need.values()],
  };
}
