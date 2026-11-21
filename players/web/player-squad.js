'use strict';
/* A public character gallery. Only the shared persona whitelist is rendered. */
(function () {
  const MAX_PORTRAIT = 32000;
  let cachedRoom = null;
  let ownerRoomId = '';
  let ownerDraft = '';
  let ownerDirty = false;
  let busy = false;
  let feedback = '';
  let feedbackError = false;
  let mountedRoster = '';

  const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
  const short = (value, max) => typeof value === 'string' ? value.slice(0, max).trim() : '';
  function room() {
    try {
      if (typeof window.playerSessionSnapshot === 'function') {
        const next = window.playerSessionSnapshot();
        cachedRoom = next?.self ? next : null;
      }
    } catch { /* The next session update can restore the connection. */ }
    return cachedRoom?.self ? cachedRoom : null;
  }
  function portrait(value) {
    return typeof value === 'string' && value.length <= MAX_PORTRAIT && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value) ? value : '';
  }
  function roster(current) {
    if (!Array.isArray(current?.squad)) return [];
    return current.squad.slice(0, 20).filter(member => member && typeof member.id === 'string').map(member => ({
      id: short(member.id, 128), name: short(member.name, 80), age: short(member.age, 40),
      gender: short(member.gender, 80), ownerName: short(member.ownerName, 80), portrait: portrait(member.portrait),
    }));
  }
  function prepareOwner(current) {
    const id = current?.id || '';
    if (id !== ownerRoomId) {
      ownerRoomId = id; ownerDraft = short(current?.self?.ownerName, 80); ownerDirty = false;
      feedback = ''; feedbackError = false;
    } else if (!ownerDirty && document.activeElement?.id !== 'squad-owner-name' && !busy) {
      ownerDraft = short(current?.self?.ownerName, 80);
    }
  }
  function silhouette() {
    return '<svg viewBox="0 0 100 150" fill="none" stroke="currentColor" aria-hidden="true"><path d="M12 12h12M12 12v12m76-12H76m12 0v12M12 138h12m-12 0v-12m76 12H76m12 0v-12"/><circle cx="50" cy="54" r="16"/><path d="M24 109v-9a26 26 0 0 1 52 0v9M20 118h60"/><path d="M32 27h36M40 130h20" opacity=".45"/></svg>';
  }
  function card(member, current, index) {
    const own = member.id === current.self.id;
    const name = member.name || 'Персонаж пока не назван';
    return `<article class="panel squad-card ${own ? 'is-own' : ''}" aria-labelledby="squad-name-${index}"><div class="squad-card-top"><span>ЛИЧНОЕ ДЕЛО ${String(index + 1).padStart(2, '0')}</span>${own ? '<span class="squad-own-badge">ТВОЙ ПЕРСОНАЖ</span>' : '<span class="squad-dossier-stamp" aria-hidden="true">2207</span>'}</div><div class="squad-portrait ${member.portrait ? 'has-art' : ''}">${member.portrait ? `<img src="${e(member.portrait)}" alt="Арт персонажа: ${e(name)}" loading="lazy" decoding="async" draggable="false">` : `<div class="squad-no-portrait">${silhouette()}<span>Арт ещё не добавлен</span></div>`}<span class="squad-portrait-corner" aria-hidden="true"></span></div><div class="squad-card-info"><h2 id="squad-name-${index}">${e(name)}</h2><dl><div><dt>Возраст</dt><dd>${e(member.age || 'Не указан')}</dd></div><div><dt>Пол</dt><dd>${e(member.gender || 'Не указан')}</dd></div></dl><div class="squad-owner"><span class="squad-owner-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="7" r="3.5"/><path d="M5 21v-3a7 7 0 0 1 14 0v3"/></svg></span><div><span>ИГРОК</span><strong>${e(member.ownerName || 'Имя игрока пока не указано')}</strong></div></div>${own ? '<a class="text-button squad-own-link" href="#character">Открыть мою анкету</a>' : ''}</div></article>`;
  }
  function cards(current) {
    const members = roster(current);
    mountedRoster = JSON.stringify([current.self.id, members]);
    return members.length ? members.map((member, index) => card(member, current, index)).join('') : '<section class="panel squad-empty"><span class="eyebrow">ОБЩИЕ ЛИЧНЫЕ ДЕЛА</span><h2>Отряд собирается.</h2><p>Анкеты появятся здесь, когда участники заполнят сведения о своих персонажах.</p><a class="button ghost" href="#character">К моей анкете</a></section>';
  }
  function ownerForm(current) {
    return `<section class="panel squad-owner-settings"><div><span class="eyebrow">ВЛАДЕЛЕЦ АНКЕТЫ</span><h2>Как тебя представить отряду?</h2><p>Это имя игрока. Имя персонажа заполняется в его анкете.</p></div><form id="squadOwnerForm"><label for="squad-owner-name"><span>Имя игрока</span><input class="input" id="squad-owner-name" name="ownerName" type="text" autocomplete="nickname" maxlength="80" required value="${e(ownerDraft)}" placeholder="Твоё имя или ник" ${busy ? 'readonly' : ''}></label><button class="button ghost" type="submit" ${busy ? 'disabled' : ''}>${busy ? 'Сохраняю…' : 'Сохранить имя'}</button><p class="squad-owner-feedback ${feedbackError ? 'is-error' : ''}" data-squad-owner-feedback role="status">${e(feedback)}</p></form></section>`;
  }
  function connectionText() {
    let state = '';
    try { state = window.playerSessionConnection?.() || ''; } catch {}
    return navigator.onLine === false || ['offline', 'error', 'denied'].includes(state) ? 'Сохранённые сведения · ожидаем связь' : 'Общий архив отряда';
  }
  function content(current) {
    if (!current) return `<section class="panel squad-connect"><div class="squad-connect-mark" aria-hidden="true">${silhouette()}</div><span class="eyebrow">ЛИЧНЫЕ ДЕЛА ОТРЯДА</span><h2>Найди свою группу.</h2><p>Подключись к игровой комнате ведущего. Здесь появятся лица и имена твоих спутников.</p><a class="button primary" href="#session">К игровой сессии</a></section>`;
    prepareOwner(current);
    return `<div class="squad-room-heading"><div><span class="eyebrow">${e(current.name || 'ИГРОВАЯ КОМНАТА')}</span><span class="squad-archive-status" data-squad-status>${e(connectionText())}</span></div><span class="tag" data-squad-count>${roster(current).length} В ОТРЯДЕ</span></div>${ownerForm(current)}<div class="squad-grid" data-squad-grid>${cards(current)}</div><p class="squad-archive-note">Личное дело обновляется, когда игрок сохраняет сведения о персонаже. Арт можно добавить в разделе «Мой персонаж».</p>`;
  }
  function page() {
    const current = room();
    const heading = typeof head === 'function' ? head('ЛЮДИ РЯДОМ С ТОБОЙ', 'Мой отряд.', 'Участники текущей комнаты и их персонажи.') : '<div class="heading-row"><div><span class="eyebrow">ЛЮДИ РЯДОМ С ТОБОЙ</span><h1 class="page-title">Мой отряд.</h1><p class="subtitle">Участники текущей комнаты и их персонажи.</p></div></div>';
    return heading + `<div id="playerSquadRoot" data-squad-room="${e(current?.id || '')}" data-squad-connected="${current ? 'true' : 'false'}">${content(current)}</div>`;
  }
  function paint() {
    const root = document.getElementById('playerSquadRoot');
    if (!root) return;
    const current = room();
    if (root.dataset.squadRoom !== (current?.id || '') || root.dataset.squadConnected !== String(!!current)) {
      root.dataset.squadRoom = current?.id || ''; root.dataset.squadConnected = String(!!current);
      root.innerHTML = content(current); return;
    }
    if (!current) return;
    prepareOwner(current);
    const input = root.querySelector('#squad-owner-name');
    if (input && input !== document.activeElement && !ownerDirty && input.value !== ownerDraft) input.value = ownerDraft;
    if (input) input.readOnly = busy;
    const submit = root.querySelector('#squadOwnerForm button');
    if (submit) { submit.disabled = busy; submit.textContent = busy ? 'Сохраняю…' : 'Сохранить имя'; }
    const feedbackNode = root.querySelector('[data-squad-owner-feedback]');
    if (feedbackNode) { feedbackNode.textContent = feedback; feedbackNode.classList.toggle('is-error', feedbackError); }
    const status = root.querySelector('[data-squad-status]'); if (status) status.textContent = connectionText();
    const members = roster(current), signature = JSON.stringify([current.self.id, members]);
    const grid = root.querySelector('[data-squad-grid]');
    if (grid && signature !== mountedRoster) grid.innerHTML = cards(current);
    const count = root.querySelector('[data-squad-count]'); if (count) count.textContent = members.length + ' В ОТРЯДЕ';
  }
  document.addEventListener('input', event => {
    if (event.target.id !== 'squad-owner-name') return;
    ownerDraft = event.target.value; ownerDirty = true;
    event.target.setCustomValidity(''); feedback = ''; feedbackError = false;
    const status = document.querySelector('[data-squad-owner-feedback]'); if (status) status.textContent = '';
  });
  document.addEventListener('submit', async event => {
    if (event.target.id !== 'squadOwnerForm') return;
    event.preventDefault();
    if (busy) return;
    const current = room(), input = event.target.elements.ownerName, value = input.value.trim();
    input.setCustomValidity(value && value.length <= 80 ? '' : 'Укажи имя игрока — до 80 символов.');
    if (!event.target.reportValidity()) return;
    if (!current || typeof window.playerSessionSetOwnerName !== 'function') { feedback = 'Подключись к игровой сессии и повтори сохранение.'; feedbackError = true; paint(); return; }
    const id = current.id;
    busy = true; feedback = ''; feedbackError = false; paint();
    try {
      const result = await window.playerSessionSetOwnerName(value);
      if (room()?.id !== id) return;
      if (result?.error || result?.saved === false) throw new Error(result.error || 'Не удалось сохранить имя игрока.');
      if (result?.room?.self) cachedRoom = result.room;
      ownerDraft = value; ownerDirty = false; feedback = 'Имя игрока сохранено.';
    } catch (error) {
      if (room()?.id === id) { feedback = error?.message || 'Не удалось сохранить имя игрока. Повтори, когда восстановится связь.'; feedbackError = true; }
    } finally { busy = false; paint(); }
  });
  window.addEventListener('niti:session-update', event => {
    if (Object.hasOwn(event.detail || {}, 'room')) cachedRoom = event.detail.room?.self ? event.detail.room : null;
    paint();
  });
  window.addEventListener('online', paint);
  window.addEventListener('offline', paint);
  window.playerSquadPage = page;
})();
