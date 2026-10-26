'use strict';
/* Only announced missions and the participant's own rewards reach this view. */
(function () {
  const ACCESS_KEY = 'niti-player-session-v1';
  const ACCESS_ARCHIVE_PREFIX = 'niti-player-session-access-';
  const ID_PATTERN = /^[A-Za-z0-9_-]{16,100}$/;
  const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,150}$/;
  const ONLINE = document.documentElement.dataset.offline !== 'true'
    && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1');
  let access = readAccess(), snapshot = null, connection = 'idle', connectionMessage = '', lastSuccess = 0;
  let pollingTimer = 0, requestInFlight = null, joining = false, leavePrompt = false;
  let requestedRoom = roomFromValue(new URLSearchParams(location.search).get('room') || '');

  function safeText(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function readAccess() {
    try {
      const saved = JSON.parse(localStorage.getItem(ACCESS_KEY));
      return validAccess(saved) ? saved : null;
    } catch { return null; }
  }
  function validAccess(value) {
    return !!value && ID_PATTERN.test(value.roomId) && TOKEN_PATTERN.test(value.playerToken)
      && (!value.playerId || ID_PATTERN.test(value.playerId))
      && (!value.joinKey || ID_PATTERN.test(value.joinKey))
      && typeof value.name === 'string' && value.name.length <= 80;
  }
  function writeAccess(value) {
    try {
      if (value) {
        localStorage.setItem(ACCESS_KEY, JSON.stringify(value));
        localStorage.setItem(ACCESS_ARCHIVE_PREFIX + value.roomId, JSON.stringify(value));
      } else localStorage.removeItem(ACCESS_KEY);
      return true;
    } catch { return false; }
  }
  function randomKey(bytes) {
    const data = new Uint8Array(bytes);
    crypto.getRandomValues(data);
    return Array.from(data, n => n.toString(16).padStart(2, '0')).join('');
  }
  function roomFromValue(value) {
    const raw = String(value || '').trim();
    if (ID_PATTERN.test(raw)) return raw;
    try {
      const link = new URL(raw);
      const id = link.searchParams.get('room') || '';
      return ID_PATTERN.test(id) ? id : '';
    } catch { return ''; }
  }
  function notify(message) {
    if (typeof toast === 'function') toast(message);
  }
  function currentRoomId() { return requestedRoom || access?.roomId || ''; }
  function hasCurrentAccess() { return access && access.roomId === currentRoomId(); }
  function statusText() {
    if (!ONLINE) return 'Офлайн-терминал';
    if (joining) return 'Подключаем персонажа…';
    if (!hasCurrentAccess()) return 'Ожидает подключения';
    if (connection === 'loading' && !snapshot) return 'Соединяемся с сессией…';
    if (connection === 'live') return 'На связи';
    if (connection === 'denied') return 'Нужен доступ к персонажу';
    if (connection === 'missing') return 'Сессия недоступна';
    if (connection === 'offline') return 'Связь прервана';
    return 'Проверяем связь…';
  }
  function statusMarkup() {
    const label = statusText();
    return `<span class="session-connection ${connection === 'live' ? 'is-live' : ''}" data-session-status role="status"><span aria-hidden="true"></span>${safeText(label)}</span>`;
  }
  function shortTime(value) {
    const time = new Date(value);
    return Number.isFinite(time.getTime()) ? time.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  }
  function errorMarkup() {
    if (!connectionMessage) return '';
    return `<div class="session-notice" role="status">${safeText(connectionMessage)}${lastSuccess && connection !== 'live' ? `<small>Последнее обновление: ${safeText(shortTime(lastSuccess))}. Показаны последние полученные данные.</small>` : ''}</div>`;
  }
  function itemList(items, emptyText, className) {
    return `<div class="session-item-list" ${className}>${Array.isArray(items) && items.length ? items.map(item => `<div class="session-item"><span aria-hidden="true">◇</span><strong>${safeText(item.name)}</strong><b>×${safeText(item.quantity)}</b></div>`).join('') : `<p class="session-empty-copy">${emptyText}</p>`}</div>`;
  }
  function missionMarkup(room) {
    const mission = room.mission;
    if (!mission) return `<section class="panel session-mission session-mission-waiting" data-session-mission><div class="session-signal-art" aria-hidden="true"><span>⌁</span><i></i><i></i><i></i></div><div class="eyebrow">КАНАЛ ВЕДУЩЕГО ОТКРЫТ</div><h2>Ждём следующую миссию.</h2><p>Как только ведущий выберет задание, оно появится здесь. Страницу обновлять не нужно.</p></section>`;
    const complete = !!room.completedMissions?.[mission.id];
    const result = room.result?.missionId === mission.id ? room.result : null;
    return `<section class="panel session-mission ${complete ? 'is-complete' : ''}" data-session-mission><div class="session-section-label"><span class="eyebrow">${complete ? 'МИССИЯ ЗАВЕРШЕНА' : 'ПРЯМО СЕЙЧАС'}</span><span class="tag">${complete ? 'ВЫПОЛНЕНО ✓' : 'ЗАДАНИЕ ВЕДУЩЕГО'}</span></div><h2>${safeText(mission.title)}</h2><p class="session-description">${safeText(mission.description)}</p>${Array.isArray(mission.actions) && mission.actions.length ? `<div class="session-action-heading">ЧТО МОЖНО СДЕЛАТЬ</div><ol class="session-choices">${mission.actions.map((action, index) => `<li><span class="session-choice-number">${String(index + 1).padStart(2, '0')}</span><span>${safeText(action.label)}</span></li>`).join('')}</ol><p class="session-choice-hint">Выберите действие вместе с группой и сообщите ведущему.</p>` : ''}${result ? `<div class="session-announced-result"><span class="eyebrow">${result.complete ? 'ИТОГ МИССИИ' : 'СОБЫТИЕ'}</span><p>${safeText(result.summary)}</p></div>` : ''}</section>`;
  }
  function eventsMarkup(events) {
    const list = Array.isArray(events) ? events.slice().reverse() : [];
    return `<section class="panel session-history"><div class="panel-header"><h2 class="panel-title">Сигналы сессии</h2><span class="badge">${list.length}</span></div><div class="session-events" data-session-events>${list.length ? list.map(event => `<article class="session-event"><div class="session-event-top"><span>${event.complete ? 'МИССИЯ ЗАВЕРШЕНА' : 'СОБЫТИЕ'}</span><time>${safeText(shortTime(event.createdAt))}</time></div><p>${safeText(event.summary)}</p>${event.xp || event.items?.length ? `<div class="session-event-reward">${event.xp ? `<span>+${safeText(event.xp)} XP участникам события</span>` : ''}${event.items?.length ? `<span>${event.items.map(item => safeText(item.name) + ' ×' + safeText(item.quantity)).join(' · ')}</span>` : ''}</div>` : ''}</article>`).join('') : '<p class="session-empty-copy">Итоги и награды появятся здесь после решения ведущего.</p>'}</div></section>`;
  }
  function roomMarkup(room) {
    const self = room.self || { name: access?.name || '', xp: 0, inventory: [] };
    return `<div class="session-room-bar"><div><span class="eyebrow">ОБЩАЯ ИГРОВАЯ КОМНАТА</span><h2>${safeText(room.name)}</h2><span class="session-player-label">Ты: ${safeText(self.name)}</span></div><div class="session-room-controls">${statusMarkup()}<button type="button" class="button ghost small" data-session-action="refresh">Обновить</button></div></div>${errorMarkup()}<div class="session-grid"><div class="session-main-column">${missionMarkup(room)}${eventsMarkup(room.events)}</div><aside class="session-side-column"><section class="panel session-experience"><span class="eyebrow">ТВОЙ ОПЫТ В СЕССИИ</span><div class="session-xp-number"><strong data-session-xp>${safeText(self.xp || 0)}</strong><span>XP</span></div><p>Начисляет ведущий за завершённые задания.</p><small>Награды сохраняются и приходят, даже если ты временно не в сети. Учитываются события после твоего вступления.</small></section><section class="panel session-inventory"><div class="panel-header"><h2 class="panel-title">Полученное снаряжение</h2></div>${itemList(self.inventory, 'Личные награды ещё не выданы.', 'data-session-personal-items')}<p class="session-card-hint"><a class="text-button" href="#inventory">Открыть инвентарь и экипировку ↗</a></p></section><section class="panel session-inventory"><div class="panel-header"><h2 class="panel-title">Общий тайник</h2><span class="tag">НА ГРУППУ</span></div>${itemList(room.sharedItems, 'Общая добыча пока не найдена.', 'data-session-shared-items')}<p class="session-card-hint"><a class="text-button" href="#inventory">Забрать вещи из тайника ↗</a></p></section><section class="panel session-party"><div class="panel-header"><h2 class="panel-title">Участники</h2><span class="badge">${room.players?.length || 0}</span></div><ul>${(room.players || []).map(member => `<li><span class="session-member-initial" aria-hidden="true">${safeText((member.name || '?').slice(0, 1))}</span><strong>${safeText(member.name)}</strong>${member.id === self.id ? '<small>ТЫ</small>' : ''}</li>`).join('')}</ul><p class="session-card-hint">Список вошедших в сессию; он не показывает присутствие в сети.</p></section></aside></div><div class="session-access-bar"><p>Доступ к этому персонажу сохранён в браузере. Скачай его для переноса на другое устройство.</p><div><button type="button" class="button ghost small" data-session-action="export">↓ Сохранить доступ</button><button type="button" class="button ghost small" data-session-action="leave">Отключиться</button></div></div>${leavePrompt ? `<div class="session-disconnect-confirm" role="alert"><p>Отключить этот браузер от сессии? Персонаж и награды останутся в комнате. Для возвращения сохрани доступ.</p><div><button type="button" class="button ghost small" data-session-action="export">Сохранить доступ</button><button type="button" class="button ghost small" data-session-action="leave-cancel">Остаться</button><button type="button" class="button danger small" data-session-action="leave-confirm">Отключиться</button></div></div>` : ''}`;
  }
  function joinMarkup() {
    if (!ONLINE) return `<section class="panel session-offline"><div class="eyebrow">ЛИЧНЫЕ ИНСТРУМЕНТЫ ДОСТУПНЫ</div><h2>Сессия работает в интернете.</h2><p>Открой онлайн-терминал по приглашению ведущего, чтобы получать миссии и награды. Персонаж, заметки и кубики в этом файле работают без соединения.</p></section>`;
    const roomId = currentRoomId();
    const profileName = typeof player !== 'undefined' ? player.profile?.name || '' : '';
    const defaultName = access?.roomId === roomId ? access.name : profileName;
    const existingDifferent = access && requestedRoom && access.roomId !== requestedRoom;
    return `<div class="session-join-grid"><section class="panel session-join-card"><div class="eyebrow">ПРИСОЕДИНИТЬСЯ К ИСТОРИИ</div><h2>Сигнал от ведущего.</h2><p>Вставь ссылку-приглашение и укажи имя персонажа. Миссии и награды будут появляться в этом терминале.</p>${existingDifferent ? '<div class="session-notice">Открыто приглашение в другую комнату. Личные заметки и лист персонажа сохранятся. Доступ к прежней комнате останется в этом браузере.</div>' : ''}<form id="playerSessionJoinForm"><div class="field"><label class="field-label" for="player-session-room">ССЫЛКА ИЛИ КОД КОМНАТЫ</label><input class="input" id="player-session-room" name="room" value="${safeText(roomId)}" autocomplete="off" spellcheck="false" required maxlength="500" placeholder="Вставь приглашение ведущего"></div><div class="field"><label class="field-label" for="player-session-name">ИМЯ ПЕРСОНАЖА</label><input class="input" id="player-session-name" name="name" value="${safeText(defaultName || '')}" autocomplete="nickname" required maxlength="80" placeholder="Как тебя зовут в этой истории?"></div><div class="session-join-actions"><button type="submit" class="button primary" data-session-action="join-submit" ${joining ? 'disabled' : ''}>${joining ? 'Подключаем…' : 'Войти в сессию ↗'}</button><span class="session-form-feedback" data-session-form-feedback role="status">${safeText(connectionMessage)}</span></div></form><div class="session-restore-control"><button type="button" class="text-button" data-session-action="import">↥ Восстановить доступ к персонажу</button>${existingDifferent ? '<button type="button" class="text-button" data-session-action="return-current">Вернуться в прежнюю комнату</button>' : ''}</div></section><section class="panel session-join-info"><div class="session-signal-art" aria-hidden="true"><span>⌁</span><i></i><i></i><i></i></div><h2>Одна группа.<br>Общая история.</h2><ul><li><strong>Миссия и варианты действий</strong><span>Всё, что ведущий открыл для вашей группы.</span></li><li><strong>Опыт и добыча</strong><span>Появляются после подтверждённого результата.</span></li><li><strong>Твои записи остаются твоими</strong><span>Личные заметки и лист персонажа не отправляются в комнату.</span></li></ul></section></div>`;
  }
  function contentMarkup() {
    if (!ONLINE) return joinMarkup();
    if (hasCurrentAccess() && snapshot) return roomMarkup(snapshot);
    if (hasCurrentAccess() && !['denied', 'missing'].includes(connection)) return `<section class="panel session-connecting">${statusMarkup()}<h2>${connection === 'offline' ? 'Не удалось получить данные.' : 'Настраиваем приём…'}</h2><p>Твой персонаж и награды хранятся в игровой комнате.</p>${errorMarkup()}<div class="session-join-actions"><button type="button" class="button primary" data-session-action="refresh">Попробовать снова</button><button type="button" class="button ghost" data-session-action="rejoin">Ввести приглашение</button></div></section>`;
    return joinMarkup();
  }
  function page() {
    const heading = typeof head === 'function' ? head('ПРИЁМ ОТКРЫТ', 'Игровая сессия.', 'Миссии, решения и награды от ведущего в одном канале.') : '<h1>Игровая сессия</h1>';
    if (hasCurrentAccess() && !requestInFlight && !lastSuccess) queueMicrotask(() => refresh());
    return heading + `<div id="playerSessionRoot">${contentMarkup()}</div><input type="file" id="playerSessionAccessFile" accept=".json,application/json" hidden>`;
  }
  function summary() {
    const own = snapshot?.self;
    const title = !ONLINE ? 'Сессия доступна в онлайн-терминале' : snapshot?.mission?.title || (hasCurrentAccess() ? 'Игровая комната подключена' : 'Подключись к своей группе');
    return `<a href="#session" class="panel session-home-summary" data-session-home-summary><span class="session-summary-icon" aria-hidden="true">⌁</span><div><span class="eyebrow">ИГРОВАЯ СЕССИЯ</span><strong>${safeText(title)}</strong><small>${snapshot && own ? safeText(snapshot.name) + ' · ' + safeText(own.xp || 0) + ' XP' : 'Открой приглашение ведущего: миссии и награды появятся здесь.'}</small></div><span class="session-summary-arrow" aria-hidden="true">↗</span></a>`;
  }
  function stats() {
    const self = snapshot?.self;
    if (!self || !hasCurrentAccess()) return '<div data-session-character-rewards hidden></div>';
    return `<section class="panel session-character-rewards" data-session-character-rewards><div><span class="eyebrow">ИЗ ИГРОВОЙ СЕССИИ</span><strong>${safeText(self.xp || 0)} XP</strong><p>${safeText(snapshot.name)} · ${safeText(self.name)}</p></div><a class="button ghost small" href="#session">Награды и снаряжение ↗</a></section>`;
  }
  function updateMounted() {
    const root = document.getElementById('playerSessionRoot');
    if (root && (!root.querySelector('#playerSessionJoinForm') || (snapshot && hasCurrentAccess() && connection === 'live'))) root.innerHTML = contentMarkup();
    const summaryNode = document.querySelector('[data-session-home-summary]');
    if (summaryNode) summaryNode.outerHTML = summary();
    const rewardNode = document.querySelector('[data-session-character-rewards]');
    if (rewardNode) rewardNode.outerHTML = stats();
    notifySession();
  }
  function updateStatusOnly() {
    for (const node of document.querySelectorAll('[data-session-status]')) node.outerHTML = statusMarkup();
    const feedback = document.querySelector('[data-session-form-feedback]');
    if (feedback) feedback.textContent = connectionMessage;
    notifySession();
  }
  async function api(path, { method = 'GET', body, token } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch('/api/rooms' + path, {
        method, signal: controller.signal, cache: 'no-store', credentials: 'omit',
        headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(typeof data.error === 'string' ? data.error : 'Не удалось связаться с комнатой.');
        error.status = response.status;
        throw error;
      }
      return data;
    } finally { clearTimeout(timeout); }
  }
  function schedulePoll() {
    clearTimeout(pollingTimer);
    if (ONLINE && hasCurrentAccess() && !document.hidden) pollingTimer = setTimeout(refresh, 5000);
  }
  async function refresh() {
    if (!ONLINE || !hasCurrentAccess() || joining) return;
    if (requestInFlight) return requestInFlight;
    const credential = access;
    const roomId = access.roomId;
    connection = connection === 'live' && snapshot ? 'live' : 'loading';
    updateStatusOnly();
    requestInFlight = (async () => {
      try {
        const data = await api('/' + encodeURIComponent(roomId), { token: credential.playerToken });
        if (access !== credential || currentRoomId() !== roomId) return;
        if (!data.room || !data.room.self) throw new Error('Комната прислала неполные данные. Повтори подключение.');
        const changed = !snapshot || snapshot.revision !== data.room.revision || connection !== 'live';
        if (!snapshot || data.room.revision >= snapshot.revision) snapshot = data.room;
        access.playerId = data.room.self.id;
        access.name = data.room.self.name;
        writeAccess(access);
        connection = 'live'; connectionMessage = ''; lastSuccess = Date.now();
        if (changed) updateMounted(); else updateStatusOnly();
      } catch (error) {
        if (access !== credential) return;
        connection = [401, 403].includes(error.status) ? 'denied' : error.status === 404 ? 'missing' : 'offline';
        if (connection === 'denied' || connection === 'missing') snapshot = null;
        connectionMessage = connection === 'denied' ? 'Не удалось восстановить доступ. Введи приглашение или загрузи сохранённый доступ к персонажу.' : connection === 'missing' ? 'Комната не найдена. Проверь приглашение у ведущего.' : 'Не удалось обновить сессию. Проверь интернет; попробуем снова автоматически.';
        updateMounted(); updateStatusOnly();
      } finally { requestInFlight = null; schedulePoll(); }
    })();
    return requestInFlight;
  }
  async function join(form) {
    if (joining || !ONLINE) return;
    const fields = new FormData(form);
    const roomId = roomFromValue(fields.get('room'));
    const name = String(fields.get('name') || '').trim();
    const roomInput = form.elements.room, nameInput = form.elements.name;
    roomInput.setCustomValidity(roomId ? '' : 'Вставь приглашение ведущего или полный код комнаты.');
    nameInput.setCustomValidity(name && name.length <= 80 ? '' : 'Укажи имя персонажа (до 80 символов).');
    if (!form.reportValidity()) return;
    let nextAccess = access?.roomId === roomId ? access : null;
    if (!nextAccess) {
      try { const archived = JSON.parse(localStorage.getItem(ACCESS_ARCHIVE_PREFIX + roomId)); if (validAccess(archived)) nextAccess = archived; } catch {}
    }
    if (!nextAccess) nextAccess = { roomId, playerId: '', name, playerToken: randomKey(32), joinKey: randomKey(16) };
    nextAccess.name = name;
    if (!nextAccess.joinKey) nextAccess.joinKey = randomKey(16);
    if (!writeAccess(nextAccess)) {
      connectionMessage = 'Браузер не сохраняет доступ. Разреши локальное хранилище, чтобы не потерять персонажа.';
      updateStatusOnly(); return;
    }
    joining = true; connectionMessage = ''; updateStatusOnly();
    const submit = form.querySelector('[type="submit"]'); submit.disabled = true; submit.textContent = 'Подключаем…';
    try {
      const data = await api('/' + encodeURIComponent(roomId) + '/join', { method: 'POST', body: { name, joinKey: nextAccess.joinKey, playerToken: nextAccess.playerToken } });
      if (!data.room || !data.playerId || !data.room.self) throw new Error('Не удалось получить данные персонажа. Повтори вход.');
      nextAccess.playerId = data.playerId;
      if (typeof data.playerToken === 'string') nextAccess.playerToken = data.playerToken;
      access = nextAccess; requestedRoom = roomId; snapshot = data.room; lastSuccess = Date.now();
      connection = 'live'; connectionMessage = '';
      writeAccess(access);
      const url = new URL(location.href); url.searchParams.set('room', roomId); url.hash = 'session'; history.replaceState(null, '', url);
      const root = document.getElementById('playerSessionRoot'); if (root) root.innerHTML = roomMarkup(snapshot);
      notify('Ты в сессии. Приём открыт.');
    } catch (error) {
      connection = 'offline';
      connectionMessage = error.status === 404 ? 'Комната не найдена. Проверь приглашение у ведущего.' : error.status === 409 ? 'Этот доступ уже используется. Восстанови сохранённый доступ к персонажу.' : error.status === 429 ? 'В комнате достигнут лимит участников. Свяжись с ведущим.' : 'Не удалось войти. Проверь интернет и повтори попытку — второй персонаж не создастся.';
      updateStatusOnly();
    } finally {
      joining = false;
      if (submit.isConnected) { submit.disabled = false; submit.textContent = 'Войти в сессию ↗'; }
      schedulePoll();
    }
  }
  function exportAccess() {
    if (!access) return;
    const data = { kind: 'niti-player-session-access', version: 1, access: { ...access } };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = 'niti-player-access.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify('Доступ сохранён. Храни файл у себя: он открывает твоего персонажа.');
  }
  function showJoinForm() {
    connection = 'denied'; connectionMessage = ''; snapshot = null;
    const root = document.getElementById('playerSessionRoot'); if (root) root.innerHTML = joinMarkup();
  }
  document.addEventListener('submit', event => {
    if (event.target.id !== 'playerSessionJoinForm') return;
    event.preventDefault(); join(event.target);
  });
  document.addEventListener('input', event => {
    if (event.target.closest('#playerSessionJoinForm') && event.target.setCustomValidity) event.target.setCustomValidity('');
  });
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-session-action]');
    if (!button) return;
    const action = button.dataset.sessionAction;
    if (action === 'refresh') refresh();
    else if (action === 'rejoin') showJoinForm();
    else if (action === 'export') exportAccess();
    else if (action === 'import') document.getElementById('playerSessionAccessFile')?.click();
    else if (action === 'leave') { leavePrompt = true; updateMounted(); }
    else if (action === 'leave-cancel') { leavePrompt = false; updateMounted(); }
    else if (action === 'leave-confirm') {
      access = null; snapshot = null; requestedRoom = ''; lastSuccess = 0; connection = 'idle'; connectionMessage = ''; leavePrompt = false;
      writeAccess(null); clearTimeout(pollingTimer);
      const url = new URL(location.href); url.searchParams.delete('room'); history.replaceState(null, '', url);
      const root = document.getElementById('playerSessionRoot'); if (root) root.innerHTML = joinMarkup();
      notify('Этот терминал отключён. Персонаж и награды сохранены в комнате.');
    } else if (action === 'return-current') {
      requestedRoom = access?.roomId || ''; snapshot = null; connection = 'idle'; connectionMessage = ''; lastSuccess = 0;
      const url = new URL(location.href); if (requestedRoom) url.searchParams.set('room', requestedRoom); else url.searchParams.delete('room'); history.replaceState(null, '', url);
      const root = document.getElementById('playerSessionRoot'); if (root) root.innerHTML = contentMarkup();
      refresh();
    }
  });
  document.addEventListener('change', async event => {
    if (event.target.id !== 'playerSessionAccessFile') return;
    const file = event.target.files?.[0]; if (!file) return;
    try {
      if (file.size > 10000) throw new Error();
      const data = JSON.parse(await file.text());
      if (data.kind !== 'niti-player-session-access' || data.version !== 1 || !validAccess(data.access)) throw new Error();
      if (!writeAccess(data.access)) { notify('Не удалось сохранить доступ в браузере.'); return; }
      access = { ...data.access }; requestedRoom = access.roomId; snapshot = null; lastSuccess = 0; connection = 'idle'; connectionMessage = '';
      const url = new URL(location.href); url.searchParams.set('room', access.roomId); url.hash = 'session'; history.replaceState(null, '', url);
      const root = document.getElementById('playerSessionRoot'); if (root) root.innerHTML = contentMarkup();
      refresh();
    } catch { notify('Нужен файл доступа игрока, сохранённый в разделе «Игровая сессия».'); }
    event.target.value = '';
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) clearTimeout(pollingTimer); else refresh(); });
  window.addEventListener('online', refresh);
  window.addEventListener('focus', refresh);
  window.addEventListener('storage', event => {
    if (event.key !== ACCESS_KEY) return;
    access = readAccess(); snapshot = null; lastSuccess = 0; connection = 'idle'; connectionMessage = ''; requestedRoom = access?.roomId || requestedRoom;
    updateMounted(); refresh();
  });
  function notifySession() {
    window.dispatchEvent(new CustomEvent('niti:session-update', {detail: {room: ONLINE && hasCurrentAccess() ? snapshot : null, connection: ONLINE ? connection : 'offline'}}));
  }
  async function inventoryAction(operation) {
    if (!ONLINE || !hasCurrentAccess()) throw new Error('Для вещей общей группы подключись к игровой сессии.');
    const credential = access;
    try {
      const data = await api('/' + encodeURIComponent(credential.roomId) + '/inventory', {method: 'POST', token: credential.playerToken, body: operation});
      if (access !== credential || currentRoomId() !== credential.roomId) throw new Error('Комната изменилась. Открой нужную сессию.');
      if (!data.room || !data.room.self) throw new Error('Не удалось получить обновлённый инвентарь.');
      if (!snapshot || data.room.revision >= snapshot.revision) snapshot = data.room;
      connection = 'live'; connectionMessage = ''; lastSuccess = Date.now();
      updateMounted();
      return snapshot;
    } catch (error) {
      if (error.status === 409 || error.status === 403) await refresh();
      throw error;
    }
  }
  window.playerSessionSnapshot = () => ONLINE && hasCurrentAccess() ? snapshot : null;
  window.playerSessionConnection = () => ONLINE ? connection : 'offline';
  window.playerSessionInventoryAction = inventoryAction;
  window.playerSessionPage = page;
  window.playerSessionSummary = summary;
  window.playerSessionStats = stats;
  window.playerSessionRefresh = refresh;
  setTimeout(() => { if (requestedRoom && location.hash !== '#session') location.hash = 'session'; refresh(); }, 0);
})();
