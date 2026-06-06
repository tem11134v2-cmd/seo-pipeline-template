/* ============================================================
   prototype.js - вся интерактивность прототипа. Чистый ES6, без фреймворков.
   Цели (id/класс): форма #leadForm, submit #f-submit, согласие #f-agree,
   FAQ .pt-faq__item, бургер #burgerDrawer/#burgerOverlay,
   попапы #popupTime/#popupExit, cookie #cookieBanner,
   роутер-секции #thanksPage/#privacyPage/#personDataPage/#cookiePage,
   обёртка контента #mainContent.
   Состояние-классы: is-open / is-active.
   ============================================================ */
(function () {
  'use strict';

  // === ЧЕКБОКС ПДН (#f-agree) РАЗБЛОКИРУЕТ КНОПКУ (#f-submit) ===
  document.querySelectorAll('form').forEach(function (form) {
    var checkbox = form.querySelector('input[type="checkbox"]');
    var submit = form.querySelector('button[type="submit"]');
    if (checkbox && submit) {
      checkbox.addEventListener('change', function () {
        submit.disabled = !checkbox.checked;
      });
    }
    // Имитация отправки формы (прототип) -> страница "Спасибо" через hash-router
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

  // === POPUP ===
  var popupShown = { time: false, exit: false };
  function openPopup(id) {
    var el = document.getElementById(id);
    if (el) el.classList.add('is-open');
  }
  function closePopup(id) {
    var el = document.getElementById(id);
    if (el) el.classList.remove('is-open');
  }
  window.openPopup = openPopup;
  window.closePopup = closePopup;

  // Pop-up по таймеру (~50 сек) - только десктоп (innerWidth >= 901)
  if (window.innerWidth >= 901) {
    setTimeout(function () {
      if (!popupShown.time) {
        var el = document.getElementById('popupTime');
        if (el) { el.classList.add('is-open'); popupShown.time = true; }
      }
    }, 50000);
  }

  // Exit-pop-up (mouseleave, clientY < 0) - только десктоп, один раз за сессию
  if (window.innerWidth >= 901) {
    document.addEventListener('mouseleave', function (e) {
      if (e.clientY < 0 && !popupShown.exit) {
        var el = document.getElementById('popupExit');
        if (el) { el.classList.add('is-open'); popupShown.exit = true; }
      }
    });
  }

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

  // === HASH-РОУТИНГ ===
  function route() {
    var hash = window.location.hash;
    var pages = ['thanksPage', 'privacyPage', 'personDataPage', 'cookiePage'];
    pages.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.classList.remove('is-active');
    });
    var mainContent = document.getElementById('mainContent');

    var map = {
      '#thanks': 'thanksPage',
      '#privacy': 'privacyPage',
      '#person-data-consent': 'personDataPage',
      '#cookie': 'cookiePage'
    };
    if (map[hash]) {
      var target = document.getElementById(map[hash]);
      if (target) target.classList.add('is-active');
      if (mainContent) mainContent.style.display = 'none';
      window.scrollTo(0, 0);
    } else {
      if (mainContent) mainContent.style.display = '';
    }
  }
  window.route = route;
  window.addEventListener('hashchange', route);
  window.addEventListener('DOMContentLoaded', route);
})();
