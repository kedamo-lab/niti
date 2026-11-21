'use strict';
/* Presentation only: reveal new sections once and keep live edits still. */
(() => {
  let previousView = null;
  let observer = null;
  const active = new Set();
  // This site's motion can be controlled independently from the OS preference.
  let motionEnabled = true;
  try { motionEnabled = localStorage.getItem('niti-display-motion') !== 'reduced'; } catch {}
  document.documentElement.dataset.motion = motionEnabled ? 'full' : 'reduced';
  window.nitiMotionAllowed = () => motionEnabled;
  const targets = '.heading-row,.player-landing-hero,.master-hero,.panel,.player-hub-card,.session-home-summary,.squad-card,.inv-panel,.inv-detail,.player-note,.sheet-portrait-panel,.sheet-special,.sheet-notebox,.sheet-skills-column,.sheet-special-allocation';

  function stop() {
    observer?.disconnect();
    observer = null;
    for (const animation of active) animation.cancel();
    active.clear();
  }
  function reveal(element, delay) {
    if (!element.isConnected || !motionEnabled || document.hidden) return;
    const animation = element.animate([
      {opacity: .15, translate: '0 26px'},
      {opacity: 1, translate: '0 0'}
    ], {duration: 720, delay, fill: 'backwards', easing: 'cubic-bezier(.16,1,.3,1)'});
    active.add(animation);
    animation.finished.then(() => active.delete(animation), () => active.delete(animation));
  }
  function navigate(view) {
    const next = String(view || '');
    const changed = previousView !== next;
    previousView = next;
    stop();
    if (!changed || !motionEnabled || document.hidden) return;
    const workspace = document.getElementById('workspace');
    if (!workspace || typeof workspace.animate !== 'function') return;
    const candidates = [...workspace.querySelectorAll(targets)];
    // A card owns its reveal; nested controls and text never animate separately.
    const cards = candidates.filter(node => !node.parentElement.closest(targets));
    if (!('IntersectionObserver' in window)) {
      cards.forEach((node, index) => reveal(node, Math.min(index * 65, 260)));
      return;
    }
    observer = new IntersectionObserver(entries => {
      let index = 0;
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer?.unobserve(entry.target);
        reveal(entry.target, Math.min(index++ * 75, 300));
      }
    }, {threshold: .05});
    cards.forEach(node => observer.observe(node));
  }
  const panel = document.getElementById('colorPanel');
  if (panel) {
    const motionButton = document.createElement('button');
    motionButton.type = 'button';
    motionButton.className = 'niti-motion-toggle';
    const paintMotion = () => {
      motionButton.textContent = 'Анимация: ' + (motionEnabled ? 'вкл' : 'выкл');
      motionButton.setAttribute('aria-pressed', String(motionEnabled));
    };
    motionButton.addEventListener('click', () => {
      motionEnabled = !motionEnabled;
      document.documentElement.dataset.motion = motionEnabled ? 'full' : 'reduced';
      try { localStorage.setItem('niti-display-motion', motionEnabled ? 'full' : 'reduced'); } catch {}
      if (!motionEnabled) stop();
      paintMotion();
    });
    paintMotion();
    panel.append(motionButton);
  }
  window.addEventListener('pagehide', stop);
  window.nitiAnimateNavigation = navigate;
  const updateHeader = () => document.body.classList.toggle('niti-scrolled', scrollY > 40);
  window.addEventListener('scroll', updateHeader, {passive: true});
  updateHeader();
  const atmosphere = document.createElement('div');
  atmosphere.className = 'niti-atmosphere';
  atmosphere.setAttribute('aria-hidden', 'true');
  document.body.prepend(atmosphere);
})();
