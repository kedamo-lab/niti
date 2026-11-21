'use strict';
/* Shared presentation only. Campaign data and terminal permissions stay in their owners. */
(function () {
  const shapes = {
    home:'<path d="M3 10.5 12 3l9 7.5M5 9v11h5v-6h4v6h5V9"/>',
    overview:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="11" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M14 18h7m-7 3h4"/>',
    session:'<path d="M8 14a6 6 0 0 1 8 0M5 10a10 10 0 0 1 14 0M2 6a15 15 0 0 1 20 0"/><circle cx="12" cy="17" r="2"/><path d="M12 19v3"/>',
    scenes:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 4v5m8-5v5m-6 4 5 3-5 3Z"/>',
    character:'<circle cx="12" cy="7" r="3.5"/><path d="M4 21v-2a8 8 0 0 1 16 0v2M9 16l3 3 3-3"/>',
    characters:'<circle cx="9" cy="7" r="3"/><path d="M2.5 21v-2a6.5 6.5 0 0 1 13 0v2M16 4a3 3 0 0 1 0 6m2 4a6 6 0 0 1 3.5 5v2"/>',
    inventory:'<path d="M8 6V5a4 4 0 0 1 8 0v1M6 6h12l2 5v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-9l2-5Z"/><path d="M8 6v7h8V6M4 16h16m-9 0v3h2v-3"/>',
    threads:'<circle cx="5" cy="6" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="12" cy="19" r="2"/><path d="M5 8v2a4 4 0 0 0 4 4h6a4 4 0 0 0 4-4V8m-7 6v3"/>',
    secrets:'<path d="M3 10a12 12 0 0 1 18 0M5 7l-2-2m16 2 2-2M8 14v-2a4 4 0 0 1 8 0v2"/><rect x="6" y="14" width="12" height="8" rx="2"/><path d="M12 17v2"/>',
    consequences:'<path d="M3 4h18M3 20h18M4 12h4l3-5 3 10 3-5h3"/>',
    notes:'<path d="M5 3h11l4 4v14H5V3Z"/><path d="M15 3v5h5M9 12h7m-7 4h5"/>',
    journal:'<path d="M4 4h7a3 3 0 0 1 3 3v14a4 4 0 0 0-4-2H4V4Z"/><path d="M14 7a3 3 0 0 1 3-3h3v15h-2a4 4 0 0 0-4 2M7 8h3m-3 4h3"/>',
    manuscript:'<path d="M6 3h13a2 2 0 0 1 2 2v2h-4V5a2 2 0 0 1 2-2M17 7v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2h10v2a2 2 0 0 0 4 0M6 3a2 2 0 0 0-2 2v12m4-9h5m-5 4h5"/>',
    reference:'<path d="M5 3h14v18H5V3Zm0 5h14M8 3v5m0 5h8m-8 4h5"/>',
    help:'<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4m0 3v.1"/>',
    dice:'<path d="m12 2 9 5v10l-9 5-9-5V7Z M3 7l9 5 9-5m-9 5v10"/><path d="m8 5 4 2 4-2M7 12v3m10-3v3"/>',
    weapon:'<path d="M3 8h17v6H10l-2 7H4l3-9H3V8Zm12 6v3h-4M18 5v3M6 5v3"/>',
    armor:'<path d="m8 3 4 3 4-3 5 5-4 4v9H7v-9L3 8l5-5Z"/><path d="M9 13h6m-6 4h6"/>',
    medicine:'<path d="M8 3h8v4l3 4v10H5V11l3-4ZM8 7h8m-4 5v6m-3-3h6"/>',
    health:'<path d="M20.5 5.5a5 5 0 0 0-7 0L12 7l-1.5-1.5a5 5 0 0 0-7 7L12 21l8.5-8.5a5 5 0 0 0 0-7Z"/><path d="M6 12h3l2-3 2 6 2-3h3"/>',
    settings:'<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="10" cy="18" r="2"/>',
    search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    arrow:'<path d="M5 12h14m-6-6 6 6-6 6"/>',
    shield:'<path d="m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6l8-4Z"/><path d="m8 12 3 3 5-6"/>'
  };
  function icon(key) {
    return '<svg class="icon niti-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(shapes[key] || shapes.help)+'</svg>';
  }
  const brand = '<svg viewBox="0 0 64 64" fill="none" aria-hidden="true"><path class="niti-logo-frame" d="M20 3H44L61 20V44L44 61H20L3 44V20L20 3Z"/><path class="niti-logo-inner" d="M22 8H42L56 22V42L42 56H22L8 42V22L22 8Z"/><path class="niti-logo-filament-a" d="M19 44V20H26L45 44"/><path class="niti-logo-weave" d="M45 20V44H38L19 20"/><path class="niti-logo-filament-b" d="M45 20V44H38L19 20"/><path class="niti-logo-filament-a" d="M19 44V35.5M36.5 33L45 44"/><path class="niti-logo-ticks" d="M3 20H9M55 44H61M20 3V9M44 55V61"/></svg>';
  let lastView = null;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  function mountBrand() {
    const link = document.querySelector('a.brand');
    if (!link) return;
    link.classList.add('niti-brand');
    const mark = link.querySelector('.brand-mark');
    if (mark && !mark.dataset.nitiBrand) { mark.innerHTML = brand; mark.dataset.nitiBrand = 'true'; }
    const word = [...link.children].find(child => !child.classList.contains('brand-mark'));
    if (word) {
      word.classList.add('niti-brand-name');
      const name = [...word.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
      if (name) name.textContent = 'НИТИ';
    }
    document.documentElement.dataset.nitiRole = document.querySelector('script[src="player-app.js"]') || document.querySelector('#playerBackupFile') ? 'player' : 'master';
  }
  function decorateNavigation(view, changed) {
    const nav = document.getElementById('nav');
    if (!nav) return;
    const player = document.documentElement.dataset.nitiRole === 'player';
    const labels = player ? {home:'ИГРА',character:'ПЕРСОНАЖ',notes:'ИНСТРУМЕНТЫ'} : {overview:'ВЕДЕНИЕ',characters:'МИР ИСТОРИИ',journal:'ИНСТРУМЕНТЫ'};
    for (const link of nav.querySelectorAll('a.nav-item')) {
      const key = link.hash.slice(1);
      link.dataset.nitiSection = key;
      if (!link.querySelector('.niti-icon')) {
        const old = link.querySelector('svg.icon');
        if (old) old.outerHTML = icon(key);
        else link.insertAdjacentHTML('afterbegin',icon(key));
      }
      if (labels[key] && !link.previousElementSibling?.classList.contains('niti-nav-label')) {
        const label = document.createElement('div'); label.className = 'niti-nav-label'; label.textContent = labels[key]; label.setAttribute('aria-hidden','true'); link.before(label);
      }
    }
    if (window.matchMedia('(max-width:680px)').matches && (changed || lastView === null)) {
      const selected = [...nav.querySelectorAll('a.nav-item')].find(link => link.hash.slice(1) === view);
      if (selected) nav.scrollTo({left:Math.max(0,selected.offsetLeft-(nav.clientWidth-selected.offsetWidth)/2),behavior:reduced.matches ? 'auto' : 'smooth'});
    }
  }
  function decorateTools() {
    for (const link of document.querySelectorAll('.player-home-actions>a,.player-profile-summary .text-button')) {
      if (link.dataset.nitiArrow) continue;
      for (const node of link.childNodes) if (node.nodeType === Node.TEXT_NODE) node.textContent = node.textContent.replace(/\s*↗\s*$/,'');
      link.insertAdjacentHTML('beforeend',icon('arrow').replace('niti-icon','niti-icon niti-arrow-icon'));
      link.dataset.nitiArrow = 'true';
    }
    for (const arrow of document.querySelectorAll('.session-summary-arrow,.player-tools>a>b')) {
      if (!arrow.querySelector('svg')) arrow.innerHTML = icon('arrow').replace('niti-icon','niti-icon niti-arrow-icon');
    }
    const sessionIcon = document.querySelector('.session-summary-icon');
    if (sessionIcon && !sessionIcon.querySelector('svg')) sessionIcon.innerHTML = icon('session');
    for (const link of document.querySelectorAll('.player-tools>a[href]')) {
      const key = link.hash.slice(1), old = link.querySelector('svg.icon');
      if (old && !old.classList.contains('niti-icon')) old.outerHTML = icon(key);
    }
    const manuscript = document.querySelector('.topbar button[data-action="manuscript"]');
    if (manuscript && !manuscript.dataset.nitiDecorated) {
      manuscript.innerHTML = icon('manuscript')+'<span class="niti-topbar-label">Рукопись</span>';
      manuscript.title = 'Открыть рукопись модуля'; manuscript.setAttribute('aria-label','Открыть рукопись модуля'); manuscript.dataset.nitiDecorated = 'true';
    }
    const heading = document.querySelector('#workspace>.heading-row');
    if (heading && !heading.querySelector('.niti-heading-seal')) {
      const seal = document.createElement('span'); seal.className = 'niti-heading-seal'; seal.innerHTML = brand; seal.setAttribute('aria-hidden','true'); heading.append(seal);
    }
  }
  function render(view) {
    const next = String(view || location.hash.slice(1) || 'home');
    const changed = lastView !== null && lastView !== next;
    document.documentElement.dataset.nitiView = next;
    mountBrand(); decorateNavigation(next,changed); decorateTools();
    lastView = next;
  }
  window.NitiDesign = Object.freeze({icon,render,brandSVG:brand});
})();
