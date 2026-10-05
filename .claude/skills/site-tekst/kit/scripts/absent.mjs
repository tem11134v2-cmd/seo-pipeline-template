// Модуль без CLI и без действий при загрузке: правила полей, которые заказчик снял ответом на d10 (контракт K1), одни на
// импорт (import-project.mjs) и сборку оболочки прототипа (site-parts.mjs).
// noPhone(company) - заказчик без телефона: company.no_phone (старое имя phone_absent тоже читается).
// ABSENT_KIT - business.legal.absent_fields анализа -> имена kit в company.absent (schedule -> hours, entity -> legal_name);
// телефон - не в absent, а no_phone. ABSENT_FIELDS - имена kit. absentOf(company) - снятые поля без повторов и чужих имен.
const arr = x => (Array.isArray(x) ? x : []);

export const noPhone = c => !!c && (c.no_phone === true || c.phone_absent === true);
export const ABSENT_KIT = { email: 'email', schedule: 'hours', address: 'address', entity: 'legal_name', inn: 'inn', ogrn: 'ogrn' };
export const ABSENT_FIELDS = Object.values(ABSENT_KIT);
export const absentOf = c => [...new Set(arr(c && c.absent).filter(k => ABSENT_FIELDS.includes(k)))];
