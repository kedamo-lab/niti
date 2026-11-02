'use strict';
/* A small, locally synthesized terminal signal. No audio files or network calls. */
(function () {
  const PREF_KEY = 'niti-player-level-audio-v1';
  const PLAYED_PREFIX = 'niti-player-level-sound-played-v1:';
  const CLAIM_PREFIX = 'niti-player-level-sound-claim-v1:';
  const PENDING_MS = 30000;
  const AudioContextType = window.AudioContext || window.webkitAudioContext;
  let enabled = true, context = null, pending = null, flushing = false, menuOpen = false;
  let gestureReceived = false, unavailable = !AudioContextType, lastTone = -Infinity;
  const playedHere = new Set(), activeTones = new Set();
  try { enabled = localStorage.getItem(PREF_KEY) !== 'muted'; } catch {}

  const speaker = muted => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4Z"/>${muted ? '<path d="m17 9 5 6m0-6-5 6"/>' : '<path d="M17 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>'}</svg>`;
  function storageRead(key) { try { return localStorage.getItem(key); } catch { return null; } }
  function storageWrite(key, value) { try { localStorage.setItem(key, value); return true; } catch { return false; } }
  function message(text) { if (typeof toast === 'function') toast(text); }
  function playedKey(event) { return PLAYED_PREFIX + encodeURIComponent(event.characterKey) + ':' + event.level; }
  function alreadyPlayed(event) { const key = playedKey(event); return playedHere.has(key) || storageRead(key) === '1'; }
  function statusText() {
    if (unavailable) return 'В этом браузере звук недоступен. Уведомления остаются на экране.';
    if (!enabled) return 'Без звука. Уведомления о новых уровнях остаются на экране.';
    if (!gestureReceived) return 'Нажми любую кнопку в терминале, чтобы включить звук.';
    if (context?.state === 'running') return 'Короткий сигнал при повышении уровня. Громкость — негромкая.';
    return 'Нажми «Проверить звук», чтобы разрешить воспроизведение.';
  }
  function updateControls() {
    const button = document.getElementById('playerAudioSettings');
    if (button) {
      // Keep the pointer's SVG target alive while AudioContext is unlocking.
      // Replacing its children between pointerdown and click cancels the click
      // in real browsers, so only redraw when the mute preference changes.
      const muted = String(!enabled);
      if (button.dataset.audioMuted !== muted) {
        button.innerHTML = speaker(!enabled) + '<span class="sr-only">Звук</span>';
        button.dataset.audioMuted = muted;
      }
      button.setAttribute('aria-expanded', String(menuOpen));
      button.setAttribute('aria-label', 'Звук повышения уровня: ' + (enabled ? 'включён' : 'выключен') + '. Настройки');
      button.title = enabled ? 'Звук повышения уровня включён' : 'Звук повышения уровня выключен';
      button.classList.toggle('is-muted', !enabled);
      button.classList.toggle('is-ready', enabled && context?.state === 'running');
    }
    const toggle = document.querySelector('[data-player-audio-action="toggle"]');
    if (toggle) { toggle.setAttribute('aria-pressed', String(enabled)); toggle.textContent = enabled ? 'Звук: включён' : 'Звук: выключен'; }
    const status = document.getElementById('playerAudioStatus');
    if (status) status.textContent = statusText();
    const test = document.querySelector('[data-player-audio-action="test"]');
    if (test) test.disabled = !enabled || unavailable;
  }
  function closeMenu(returnFocus = false) {
    menuOpen = false;
    document.getElementById('playerAudioPopover')?.remove();
    updateControls();
    if (returnFocus) document.getElementById('playerAudioSettings')?.focus();
  }
  function openMenu() {
    menuOpen = true;
    const wrapper = document.getElementById('playerAudioControl');
    if (!wrapper) return;
    document.body.insertAdjacentHTML('beforeend', '<section id="playerAudioPopover" class="player-audio-popover" role="dialog" aria-labelledby="playerAudioTitle"><div class="player-audio-heading"><strong id="playerAudioTitle">СИГНАЛ ПОВЫШЕНИЯ</strong><button type="button" data-player-audio-action="close" aria-label="Закрыть настройки звука">×</button></div><p id="playerAudioStatus" role="status"></p><div class="player-audio-actions"><button type="button" class="button ghost small" data-player-audio-action="toggle" aria-pressed="true">Звук: включён</button><button type="button" class="button ghost small" data-player-audio-action="test">Проверить звук</button></div></section>');
    updateControls();
    positionMenu();
    document.querySelector('#playerAudioPopover button')?.focus({preventScroll:true});
  }
  function positionMenu() {
    const popover = document.getElementById('playerAudioPopover'), button = document.getElementById('playerAudioSettings');
    if (!popover || !button) return;
    // Body mounting keeps viewport coordinates independent of the sticky
    // header's backdrop-filter containing block.
    popover.style.position = 'fixed'; popover.style.right = 'auto';
    popover.style.width = Math.min(300, Math.max(0, window.innerWidth - 24)) + 'px';
    const anchor = button.getBoundingClientRect(), panel = popover.getBoundingClientRect();
    popover.style.left = Math.max(12, Math.min(window.innerWidth - panel.width - 12, anchor.right - panel.width)) + 'px';
    popover.style.top = Math.max(12, Math.min(window.innerHeight - panel.height - 12, anchor.bottom + 11)) + 'px';
  }
  function mount() {
    const settings = document.querySelector('.terminal-display-settings');
    if (!settings || document.getElementById('playerAudioControl')) return;
    const wrapper = document.createElement('div');
    wrapper.id = 'playerAudioControl'; wrapper.className = 'player-audio-control';
    wrapper.innerHTML = '<button type="button" class="terminal-setting player-audio-trigger" id="playerAudioSettings" aria-haspopup="dialog" aria-expanded="false" aria-controls="playerAudioPopover"></button>';
    settings.append(wrapper);
    updateControls();
  }
  async function unlock() {
    if (!enabled || unavailable) return false;
    try {
      if (!context) {
        context = new AudioContextType();
        context.addEventListener?.('statechange', updateControls);
      }
      if (context.state !== 'running') await context.resume();
      updateControls();
      return context.state === 'running';
    } catch { updateControls(); return false; }
  }
  function stopTones() {
    for (const oscillator of activeTones) { try { oscillator.stop(); } catch {} }
    activeTones.clear();
  }
  function chime() {
    if (!enabled || !context || context.state !== 'running' || document.hidden || Date.now() - lastTone < 850) return false;
    lastTone = Date.now();
    try {
      const start = context.currentTime + 0.015;
      const notes = [[523.25,0,0.12],[659.25,0.13,0.12],[783.99,0.26,0.16],[1046.5,0.46,0.36]];
      for (const [frequency, offset, duration] of notes) {
        const oscillator = context.createOscillator(), gain = context.createGain();
        oscillator.type = 'triangle'; oscillator.frequency.setValueAtTime(frequency, start + offset);
        gain.gain.setValueAtTime(0.0001, start + offset);
        gain.gain.exponentialRampToValueAtTime(0.04, start + offset + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + duration);
        oscillator.connect(gain); gain.connect(context.destination);
        activeTones.add(oscillator);
        oscillator.onended = () => { activeTones.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
        oscillator.start(start + offset); oscillator.stop(start + offset + duration + 0.025);
      }
      return true;
    } catch { stopTones(); return false; }
  }
  function playClaimed(event) {
    if (!enabled || document.hidden || context?.state !== 'running' || alreadyPlayed(event)) return false;
    if (!chime()) return false;
    const key = playedKey(event);
    playedHere.add(key); storageWrite(key, '1');
    window.dispatchEvent(new CustomEvent('niti:level-sound-played', {detail:{characterKey:event.characterKey,level:event.level}}));
    return true;
  }
  async function claimAndPlay(event) {
    if (alreadyPlayed(event)) return false;
    const name = 'niti-level-sound:' + event.characterKey + ':' + event.level;
    if (navigator.locks?.request) {
      try { return await navigator.locks.request(name, {ifAvailable:true}, lock => lock ? playClaimed(event) : false); }
      catch { /* Older browsers use the same-origin storage claim below. */ }
    }
    const key = CLAIM_PREFIX + encodeURIComponent(event.characterKey) + ':' + event.level;
    const nonce = crypto.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2);
    const stored = storageWrite(key, nonce);
    if (!stored) return playClaimed(event);
    await new Promise(resolve => setTimeout(resolve, 65));
    return storageRead(key) === nonce ? playClaimed(event) : false;
  }
  async function flushPending() {
    if (flushing || !pending || !enabled || !gestureReceived || document.hidden || context?.state !== 'running') return;
    const event = pending; pending = null;
    if (Date.now() - event.at > PENDING_MS || alreadyPlayed(event)) return;
    flushing = true;
    try { await claimAndPlay(event); }
    finally { flushing = false; if (pending) void flushPending(); }
  }
  function receiveLevel(event) {
    const detail = event.detail;
    if (!detail || typeof detail.characterKey !== 'string' || !detail.characterKey || detail.characterKey.length > 220 || !Number.isInteger(detail.level) || detail.level < 2 || detail.level > 100 || !Number.isInteger(detail.previousLevel) || detail.level <= detail.previousLevel || !enabled || unavailable) return;
    const next = {characterKey:detail.characterKey,level:detail.level,at:Date.now()};
    if (alreadyPlayed(next)) return;
    pending = next;
    if (gestureReceived) void unlock().then(flushPending);
  }
  function trustedGesture(event) {
    if (!event.isTrusted || (event.type === 'keydown' && (event.repeat || event.ctrlKey || event.metaKey || event.altKey))) return;
    gestureReceived = true;
    if (enabled) void unlock().then(() => { if (!event.target.closest?.('#playerAudioControl,#playerAudioPopover')) return flushPending(); });
  }
  document.addEventListener('pointerdown', trustedGesture, {capture:true,passive:true});
  document.addEventListener('keydown', trustedGesture, true);
  document.addEventListener('click', event => {
    const trigger = event.target.closest('#playerAudioSettings');
    if (trigger) { if (menuOpen) closeMenu(); else openMenu(); return; }
    const action = event.target.closest('[data-player-audio-action]')?.dataset.playerAudioAction;
    if (action === 'close') closeMenu(true);
    else if (action === 'toggle') {
      enabled = !enabled; storageWrite(PREF_KEY, enabled ? 'enabled' : 'muted');
      if (!enabled) { pending = null; stopTones(); }
      else void unlock().then(flushPending);
      updateControls();
    } else if (action === 'test') {
      if (event.isTrusted) gestureReceived = true;
      void unlock().then(ready => { if (ready && chime()) message('Сигнал повышения уровня включён.'); updateControls(); });
    } else if (menuOpen && !event.target.closest('#playerAudioControl,#playerAudioPopover')) closeMenu();
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && menuOpen) { event.stopPropagation(); closeMenu(true); } });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopTones();
    else if (pending) { if (Date.now() - pending.at > PENDING_MS) pending = null; else void flushPending(); }
  });
  window.addEventListener('storage', event => {
    if (event.key !== PREF_KEY) return;
    enabled = event.newValue !== 'muted';
    if (!enabled) { pending = null; stopTones(); }
    updateControls();
  });
  window.addEventListener('niti:level-up', receiveLevel);
  window.addEventListener('niti:character-cleared', () => { pending = null; stopTones(); });
  window.addEventListener('resize', positionMenu);
  window.addEventListener('scroll', () => { if (menuOpen) positionMenu(); }, {passive:true});
  window.PlayerLevelAudio = {getState:() => ({enabled,ready:context?.state === 'running',supported:!unavailable,pendingLevel:pending?.level || null})};
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, {once:true}); else mount();
})();
