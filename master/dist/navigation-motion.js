'use strict';
/* Animate actual section changes once; polling and local edits keep their focus. */
(function () {
  let previousView = null;
  let activeAnimation = null;
  let activeWorkspace = null;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  function stop() {
    if (activeAnimation) activeAnimation.cancel();
    activeWorkspace?.classList.remove('niti-navigation-active');
    activeAnimation = null;
    activeWorkspace = null;
  }
  function navigate(view) {
    const next = String(view || '');
    const changed = previousView !== null && previousView !== next;
    previousView = next;
    stop();
    if (!changed || reducedMotion.matches || document.hidden) return;
    const workspace = document.getElementById('workspace');
    if (!workspace || typeof workspace.animate !== 'function') return;
    workspace.classList.add('niti-navigation-active');
    const animation = workspace.animate([
      {opacity: 0, transform: 'translateY(8px)'},
      {opacity: 1, transform: 'translateY(0)'}
    ], {duration: 220, easing: 'cubic-bezier(.2,.7,.2,1)'});
    activeAnimation = animation;
    activeWorkspace = workspace;
    const finish = () => {
      if (activeAnimation !== animation) return;
      workspace.classList.remove('niti-navigation-active');
      activeAnimation = null;
      activeWorkspace = null;
    };
    animation.finished.then(finish, finish);
  }
  reducedMotion.addEventListener?.('change', event => { if (event.matches) stop(); });
  window.addEventListener('pagehide', stop);
  window.nitiAnimateNavigation = navigate;
})();
