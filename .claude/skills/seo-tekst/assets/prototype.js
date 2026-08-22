/* ============================================================
   prototype.js - вся интерактивность прототипа. Чистый ES6, без фреймворков.
   Цели (id/класс): формы (чекбокс + submit, per-form), FAQ .pt-faq__item,
   бургер #burgerDrawer/#burgerOverlay, cookie #cookieBanner,
   страничные секции .pt-page[data-page] внутри #ptPages,
   служебные секции #thanksPage/#privacyPage/#personDataPage/#cookiePage,
   плашка возврата #ptBackbar/#ptBackbarTitle, CTA shell .pt-shell-cta.
   Карту маршрутов window.PT_ROUTES = {"pages":[{"slug","title"}],"start":"__index"}
   вставляет assemble-prototype.mjs отдельным <script> ПЕРЕД этим скриптом.
   Показ/скрытие секций - атрибут hidden. Состояние-классы: is-open.
   ============================================================ */
(function () {
  'use strict';

  // === ЧЕКБОКС ПДН РАЗБЛОКИРУЕТ КНОПКУ (per-form) ===
  document.querySelectorAll('form').forEach(function (form) {
    var checkbox = form.querySelector('input[type="checkbox"]');
    var submit = form.querySelector('button[type="submit"]');
    if (checkbox && submit) {
      checkbox.addEventListener('change', function () {
        submit.disabled = !checkbox.checked;
      });
    }
    // Имитация отправки формы (прототип) -> секция "Спасибо" через hash-роутер
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (checkbox && !checkbox.checked) return;
      window.location.hash = '#thanks';
      route();
    });
  });

  // === FAQ-АККОРДЕОН (.pt-faq__item = <details>) ===
  // Нативный <details> уже открывает/закрывает. Усиление: в одной группе .pt-faq
  // открыт только один пункт за раз.
  document.querySelectorAll('.pt-faq').forEach(function (group) {
    var items = group.querySelectorAll('.pt-faq__item');
    items.forEach(function (item) {
      item.addEventListener('toggle', function () {
        if (item.open) {
          items.forEach(function (other) {
            if (other !== item) other.open = false;
          });
        }
      });
    });
  });

  // === БУРГЕР-МЕНЮ ===
  function openBurger() {
    var d = document.getElementById('burgerDrawer');
    var o = document.getElementById('burgerOverlay');
    if (d) d.classList.add('is-open');
    if (o) o.classList.add('is-open');
    document.body.style.overflow = 'hidden';
  }
  function closeBurger() {
    var d = document.getElementById('burgerDrawer');
    var o = document.getElementById('burgerOverlay');
    if (d) d.classList.remove('is-open');
    if (o) o.classList.remove('is-open');
    document.body.style.overflow = '';
  }
  window.openBurger = openBurger;
  window.closeBurger = closeBurger;

  // === COOKIE BANNER (try/catch вокруг localStorage) ===
  try {
    if (!localStorage.getItem('cookieAccepted')) {
      var cb = document.getElementById('cookieBanner');
      if (cb) cb.classList.add('is-open');
    }
  } catch (e) {
    var cbf = document.getElementById('cookieBanner');
    if (cbf) cbf.classList.add('is-open');
  }
  function acceptCookie() {
    try { localStorage.setItem('cookieAccepted', '1'); } catch (e) {}
    var cb = document.getElementById('cookieBanner');
    if (cb) cb.classList.remove('is-open');
  }
  window.acceptCookie = acceptCookie;

  // === HASH-РОУТЕР (страничные секции #p/<slug> + служебные якоря) ===
  var routes = window.PT_ROUTES || { pages: [], start: '__index' };
  var startSlug = routes.start || '__index';
  var lastPage = startSlug; // последняя активная страничная секция (для #__back)

  // Закрытый список сервисных якорей БЕЗ префикса слага (ADR-039)
  var SERVICE_MAP = {
    '#thanks': 'thanksPage',
    '#privacy': 'privacyPage',
    '#person-data-consent': 'personDataPage',
    '#cookie': 'cookiePage'
  };

  function pageTitle(slug) {
    var list = routes.pages || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].slug === slug) return list[i].title || '';
    }
    return '';
  }

  function hideAllSections() {
    document.querySelectorAll('.pt-page').forEach(function (el) {
      el.hidden = true;
    });
  }

  // Плашка возврата: видна на страничных секциях, кроме стартовой.
  // slug === null - служебная секция, плашка скрыта.
  function updateBackbar(slug) {
    var bar = document.getElementById('ptBackbar');
    if (!bar) return;
    var isHidden = !slug || slug === startSlug;
    bar.hidden = isHidden;
    var title = document.getElementById('ptBackbarTitle');
    if (title) title.textContent = isHidden ? '' : pageTitle(slug);
  }

  function showPage(slug) {
    var target = document.querySelector('.pt-page[data-page="' + slug + '"]');
    if (!target) return false;
    hideAllSections();
    target.hidden = false;
    updateBackbar(slug);
    window.scrollTo(0, 0);
    return true;
  }

  function showService(id) {
    var target = document.getElementById(id);
    if (!target) return;
    hideAllSections();
    target.hidden = false;
    updateBackbar(null);
    window.scrollTo(0, 0);
  }

  function route() {
    var hash = window.location.hash;
    if (hash === '#__back') {
      // Возврат из служебной секции: на последнюю страничную (или старт)
      window.location.hash = '#p/' + lastPage; // hashchange дорисует
      return;
    }
    if (SERVICE_MAP[hash]) {
      showService(SERVICE_MAP[hash]);
      return;
    }
    if (hash.indexOf('#p/') === 0) {
      var slug = hash.slice(3);
      if (showPage(slug)) lastPage = slug;
      return;
    }
    if (!hash || hash === '#') {
      if (showPage(startSlug)) lastPage = startSlug;
      return;
    }
    // Любой другой hash (например #main__lead) секцию НЕ переключает:
    // штатный скролл браузера к якорю внутри активной секции.
  }
  window.route = route;
  window.addEventListener('hashchange', route);
  window.addEventListener('DOMContentLoaded', route);

  // === CTA SHELL (шапка, бургер, мобильная фикс-панель) ===
  // Скролл к форме АКТИВНОЙ страничной секции (id <slug>__lead);
  // на стартовой секции (и если формы нет) - скролл к самой секции.
  document.querySelectorAll('.pt-shell-cta').forEach(function (cta) {
    cta.addEventListener('click', function (e) {
      e.preventDefault();
      var active = document.querySelector('.pt-page:not([hidden])');
      if (!active) return;
      var slug = active.getAttribute('data-page');
      var lead = null;
      if (slug && slug !== startSlug) {
        lead = document.getElementById(slug + '__lead');
      }
      (lead || active).scrollIntoView();
    });
  });
})();
