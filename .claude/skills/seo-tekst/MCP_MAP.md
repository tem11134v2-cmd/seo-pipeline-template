# MCP-карта /seo-tekst (v7)

У скила почти нет MCP - и это по конструкции: вся разведка (SERP, конкуренты, лидеры, own_page-скан) сделана в `/seo-analiz` и приходит готовыми артефактами через мост (шаг 1). **Keyso и Arsenkin в текстах НЕ используются** - обнаружил у себя желание их позвать, значит пытаешься пересобрать анализ (запрещено, см. SKILL.md «Запреты»).

| Шаг / агент | Инструмент | Зачем | Обязательность |
|---|---|---|---|
| 3 `offer-strategist` | `jm_wordstat` (mode=frequency); альт. `wk_check_frequency` | сигнал стадии прогретости (ищут продукт или проблему) для формулы оффера | желательно |
| 3 `offer-strategist` | `seo_fetch_page` (profile="content") | сайт клиента: факты о компании -> тезисы и инвентарь доказательств | опционально |
| 6b `page-writer` | `seo_fetch_page` (profile="content") | ТОЛЬКО если у страницы в `recon/<dir_slug>.json` есть `own_page` (у направления был `url` живой страницы): фактура и удачные формулировки заказчика | по данным (own_page в recon) |
| 7 Drive | `mcp__gdrive-piotr__uploadFile` | Texts.docx -> Google Doc (`convertToGoogleFormat:true`) | желательно (скип, если нет `texts_folder_id`) |

**Без MCP работают:** pages-planner, block-planner, slot-mapper, copy-auditor, site-reviewer, tekst-verifier, prototype-builder, prototype-fixer - только Read/Write/Edit/Bash (скрипты сборки). Тон-превью и прототип в сеть не ходят - сборка локальная поверх kit.

## Замечания

- **JM тут только легкий `jm_wordstat`** - баланс под тяжелый `jm_text_analyze` проверять не нужно (он живет в `/seo-faq`). JM недоступен - fallback `wk_check_frequency`.
- **Регион частотности** - код Яндекса из `inputs.json.region_yandex` (Москва 213, СПб 2, ...), не Keyso-base. Null (мост не нашел кода) - оркестратор дописывает по PLAYBOOK р.8 на шаге 1; без кода - общероссийская частотность.
- **Никакой добычи поисковых данных сверх сигнала прогретости**: частотности по списку, кластеризация, позиции - не зона этого скила ни в одном источнике. Нужна семантика - `/seo-struktura`.
- `tone-preview.html` и `prototype.html` в Google-формат не конвертируются - отдаются локальными файлами (опционально `uploadFile` с `convertToGoogleFormat:false` ради общей ссылки).
