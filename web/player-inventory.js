'use strict';

/* Ownership and quantities come from the session service. This view never creates items. */
(function () {
  const WEAPON_CATEGORIES = new Set(['weapon', 'melee', 'unarmed', 'light', 'heavy', 'throwing', 'thrown', 'explosive', 'energy']);
  const SLOTS = [['weapon', 'Оружие'], ['armor', 'Броня'], ['extra1', 'Доп. слот 1'], ['extra2', 'Доп. слот 2']];
  let cachedRoom = null;
  let selection = null;
  let pending = false;
  let retryOperation = null;
  let message = '';
  let messageKind = '';
  let lastRevision = -1;
  let lastRoomId = '';
  let lastOnline = false;
  const quantities = new Map();
  const slotChoices = new Map();

  function e(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  }
  function room() {
    if (typeof window.playerSessionSnapshot === 'function') {
      const next = window.playerSessionSnapshot();
      if (next?.self) cachedRoom = next;
      else if (next === null) cachedRoom = null;
    }
    return cachedRoom;
  }
  function online() {
    if (document.documentElement.dataset.offline === 'true' || location.protocol === 'file:' || navigator.onLine === false) return false;
    if (!room()?.self) return false;
    if (typeof window.playerSessionConnection !== 'function') return true;
    const state = window.playerSessionConnection();
    if (typeof state === 'boolean') return state;
    const status = typeof state === 'object' && state ? state.status || state.connection : state;
    return status == null || ['live', 'online', 'connected'].includes(status);
  }
  function ownItems() { return (room()?.self?.inventory || []).filter(item => Number(item.quantity) > 0); }
  function sharedItems() { return (room()?.sharedItems || []).filter(item => Number(item.quantity) > 0); }
  function itemFor(source, id) { return (source === 'shared' ? sharedItems() : ownItems()).find(item => item.id === id); }
  function selectedItem() { return selection ? itemFor(selection.source, selection.id) : null; }
  function weapon(item) { return WEAPON_CATEGORIES.has(item?.category); }
  function consumable(item) {
    return item?.consumable === true || item?.usage === 'consume' || ['consumable', 'medicine', 'food', 'ammo'].includes(item?.category);
  }
  function equipped() { return room()?.self?.equipment || room()?.self?.equipped || {}; }
  function equippedId(slot) {
    const value = equipped()[slot];
    return value && typeof value === 'object' ? value.itemId || value.id : value;
  }
  function equippedSlots(id) { return SLOTS.filter(([slot]) => equippedId(slot) === id); }
  function symbol(item) {
    if (weapon(item)) return '<path d="m4 17 8-8 3 3-8 8H4Zm8-8 4-4 3 3-4 4M4 20l-1 1M16 5l2-2 3 3-2 2"/>';
    if (item?.category === 'armor') return '<path d="m8 3 4 3 4-3 5 5-4 4v9H7v-9L3 8Zm-1 9h10M9 16h6"/>';
    if (consumable(item)) return '<path d="M8 3h8v4l3 4v10H5V11l3-4Zm0 4h8m-4 5v6m-3-3h6"/>';
    return '<path d="m12 3 9 5v9l-9 5-9-5V8Zm0 0v10m-9-5 9 5 9-5m-9 5v9"/>';
  }
  function itemImage(item, cls = '') {
    let src = '';
    const value = typeof item?.image === 'string' ? item.image : '';
    try {
      if (/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value)) src = value;
      else if (value) {
        const url = new URL(value, location.href);
        if (url.origin === location.origin && ['https:', 'http:', 'file:'].includes(url.protocol)) src = value;
      }
    } catch { /* An invalid illustration does not affect the item. */ }
    return src ? `<img class="inv-item-image ${cls}" src="${e(src)}" alt="" loading="lazy">` : `<svg class="inv-item-symbol ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${symbol(item)}</svg>`;
  }
  function categoryLabel(item) {
    return item.categoryLabel || ({weapon:'Оружие', melee:'Холодное оружие', unarmed:'Рукопашное оружие', light:'Лёгкое оружие', heavy:'Тяжёлое оружие', throwing:'Метательное оружие', thrown:'Метательное оружие', explosive:'Взрывчатка', energy:'Энергетическое оружие', armor:'Броня', medicine:'Медицина', food:'Провизия', ammo:'Боеприпасы', consumable:'Расходный предмет', tool:'Инструмент', misc:'Предмет'}[item.category]) || 'Предмет';
  }
  function button(label, action, extra = '', primary = false) {
    return `<button type="button" class="button ${primary ? 'primary' : 'ghost'} small" data-inv-action="${action}" ${extra}>${label}</button>`;
  }
  function blockActions() { return pending || !!retryOperation || !online(); }
  function statusMarkup() {
    const current = room();
    let text = !current?.self ? 'Нужна игровая сессия' : online() ? 'Снаряжение синхронизировано' : 'Связь с тайником прервана';
    if (pending) text = 'Подтверждаем действие…';
    return `<div class="inv-channel"><div><span class="eyebrow">${e(current?.name || 'ЛИЧНОЕ СНАРЯЖЕНИЕ')}</span><strong>${current?.self ? e(current.self.name) : 'Войди по приглашению ведущего'}</strong></div><span class="inv-connection ${online() ? 'is-live' : ''}" role="status"><i aria-hidden="true"></i>${text}</span></div>`;
  }
  function noticeMarkup() {
    let text = message;
    if (!online() && room()?.self && !text) text = 'Показаны последние полученные вещи. Для передачи, экипировки и использования восстанови соединение.';
    return text ? `<div class="inv-notice ${messageKind === 'error' ? 'is-error' : ''}" role="status"><span>${e(text)}</span>${retryOperation && !pending ? button('Повторить запрос', 'retry', !online() ? 'disabled' : '', true) : ''}</div>` : '';
  }
  function slotMarkup(slot, label) {
    const id = equippedId(slot), item = id ? ownItems().find(entry => entry.id === id) : null;
    return `<div class="inv-equipment-slot inv-equipment-${slot} ${item ? 'is-filled' : ''}"><span class="inv-slot-label">${e(label)}</span><button type="button" class="inv-slot-body" data-inv-action="${item ? 'select' : 'empty-slot'}" data-source="own" data-item-id="${e(item?.id || '')}" data-slot="${slot}" aria-label="${e(item ? label + ': ' + item.name + '. Открыть предмет' : label + ': пусто. Выбрать вещь для слота')}">${item ? itemImage(item) + `<strong>${e(item.name)}</strong>` : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" aria-hidden="true">${slot === 'weapon' ? symbol({category:'weapon'}) : slot === 'armor' ? symbol({category:'armor'}) : '<path d="M4 4h16v16H4Zm8 4v8m-4-4h8"/>'}</svg><small>Пусто</small>`}</button>${item ? button('Снять', 'unequip', `data-slot="${slot}" data-item-id="${e(item.id)}" ${blockActions() ? 'disabled' : ''}`) : ''}</div>`;
  }
  function bagMarkup() {
    const items = ownItems(), visible = items.slice(0, 64);
    let cells = visible.map(item => `<button type="button" class="inv-bag-cell is-occupied ${selection?.source === 'own' && selection.id === item.id ? 'is-selected' : ''} ${equippedSlots(item.id).length ? 'is-equipped' : ''}" data-inv-action="select" data-source="own" data-item-id="${e(item.id)}" aria-label="${e(item.name + ', количество ' + item.quantity)}" aria-pressed="${selection?.source === 'own' && selection.id === item.id}" title="${e(item.name)}">${itemImage(item)}<span class="inv-cell-name">${e(item.name)}</span><b>×${Number(item.quantity)}</b>${equippedSlots(item.id).length ? '<i class="inv-equipped-mark" aria-hidden="true">◆</i>' : ''}</button>`).join('');
    for (let i = visible.length; i < 64; i += 1) cells += `<span class="inv-bag-cell is-empty" aria-hidden="true"><span>${String(i + 1).padStart(2, '0')}</span></span>`;
    const overflow = items.slice(64);
    return `<div class="inv-bag-heading"><div><span class="eyebrow">ЛИЧНАЯ СУМКА</span><h2>Твои вещи</h2></div><span>${items.length} ${items.length === 1 ? 'группа предметов' : 'групп предметов'}</span></div><div class="inv-bag-grid" aria-label="Сумка с сеткой восемь на восемь">${cells}</div>${overflow.length ? `<div class="inv-overflow"><h3>Остальное снаряжение</h3>${overflow.map(item => `<button type="button" data-inv-action="select" data-source="own" data-item-id="${e(item.id)}">${e(item.name)} <b>×${Number(item.quantity)}</b></button>`).join('')}</div>` : ''}<p class="inv-grid-note">Одинаковые вещи собраны в одну ячейку. Сетка помогает разложить снаряжение; лимит переноски определяет ведущий.</p>`;
  }
  function stashMarkup() {
    const items = sharedItems();
    return `<div class="inv-stash-heading"><div><span class="eyebrow">ДОСТУПНО ВСЕЙ ГРУППЕ</span><h2>Общий тайник</h2></div><span class="tag">${items.length} ГРУПП ПРЕДМЕТОВ</span></div><p class="inv-stash-intro">Возьми вещь себе — она уйдёт из тайника. Вернёшь обратно — её сможет взять другой участник.</p><div class="inv-stash-list">${items.length ? items.map(item => `<button type="button" class="inv-stash-item ${selection?.source === 'shared' && selection.id === item.id ? 'is-selected' : ''}" data-inv-action="select" data-source="shared" data-item-id="${e(item.id)}" aria-pressed="${selection?.source === 'shared' && selection.id === item.id}"><span class="inv-stash-image">${itemImage(item)}</span><span class="inv-stash-copy"><strong>${e(item.name)}</strong><small>${e(categoryLabel(item))}</small></span><b>×${Number(item.quantity)}</b><span class="inv-stash-arrow" aria-hidden="true">↗</span></button>`).join('') : '<div class="inv-empty-stash"><span aria-hidden="true">◇</span><h3>Тайник пока пуст.</h3><p>Найденные предметы появятся здесь после выдачи ведущим или возврата другим игроком.</p></div>'}</div>`;
  }
  function stat(label, value, suffix = '') {
    const known = value !== null && value !== undefined && value !== '';
    return `<div><dt>${label}</dt><dd class="${known ? '' : 'is-unknown'}">${known ? e(value) + suffix : 'Не указано'}</dd></div>`;
  }
  function armorStats(value) {
    if (!value || typeof value !== 'object') return '';
    const keys = [['normal', 'Норма'], ['laser', 'Лазер'], ['fire', 'Огонь'], ['plasma', 'Плазма'], ['electric', 'Электро'], ['explosion', 'Взрыв'], ['explosive', 'Взрыв']];
    const seen = new Set();
    return keys.filter(([key, label]) => Object.hasOwn(value, key) && !seen.has(label) && seen.add(label)).map(([key,label]) => stat(label, value[key])).join('');
  }
  function detailsMarkup() {
    const item = selectedItem();
    if (!item) return '<div class="inv-detail-placeholder"><svg viewBox="0 0 56 56" fill="none" stroke="currentColor" aria-hidden="true"><path d="M8 8h40v40H8ZM8 21h40M21 8v40m14-40v40M8 35h40"/><path d="m36 33 12 5-5 2-2 6Z" stroke-width="2"/></svg><span class="eyebrow">ОСМОТР ПРЕДМЕТА</span><h2>Каждая вещь на своём месте.</h2><p>Выбери предмет в сумке, слоте экипировки или общем тайнике.</p></div>';
    const stats = item.stats || {}, shared = selection.source === 'shared';
    const key = selection.source + ':' + item.id;
    const quantity = Math.min(Number(item.quantity), Math.max(1, Number(quantities.get(key)) || 1));
    quantities.set(key, quantity);
    const selectedSlots = equippedSlots(item.id);
    const slots = weapon(item) ? SLOTS.filter(([slot]) => slot !== 'armor') : item.category === 'armor' ? SLOTS.filter(([slot]) => slot !== 'weapon') : SLOTS.filter(([slot]) => slot.startsWith('extra'));
    const defaultSlot = weapon(item) ? 'weapon' : item.category === 'armor' ? 'armor' : 'extra1';
    const slot = slotChoices.get(item.id) || defaultSlot;
    const actionDisabled = blockActions() ? 'disabled' : '';
    let statRows = '';
    if (weapon(item)) statRows += stat('Урон', stats.damage) + stat('Стоимость действия', stats.apCost, ' ОД') + stat('Дальность', stats.range) + stat('Боеприпасы', stats.ammo) + stat('Магазин', stats.magazine) + stat('Минимальная СИЛ', stats.minStrength) + stat('Тип урона', stats.damageType) + stat('Перезарядка', stats.reloadAp, ' ОД');
    if (item.category === 'armor') statRows += stat('Класс брони', stats.armorClass) + armorStats(stats.resistances);
    if (!weapon(item) && item.category !== 'armor') {
      statRows += stat('Стоимость использования', stats.apCost, ' ОД');
      if (stats.damage != null && stats.damage !== '') statRows += stat('Урон', stats.damage);
      if (stats.damageType != null && stats.damageType !== '') statRows += stat('Тип урона', stats.damageType);
    }
    if (stats.weight != null) statRows += stat('Вес', stats.weight);
    if (stats.price != null) statRows += stat('Стоимость', stats.price);
    if (stats.slots != null) statRows += stat('Занимает ячеек', stats.slots);
    const effects = stats.modifiers || stats.effect || item.effect || '';
    const source = item.sourceLabel || (typeof item.source === 'string' ? item.source : item.source?.label || (item.source?.table != null ? `Прикреплённый каталог · таблица ${item.source.table}${item.source.row != null ? ', строка ' + item.source.row : ''}` : ''));
    const warnings = Array.isArray(item.warnings) ? item.warnings.filter(value => typeof value === 'string') : [];
    return `<div class="inv-detail-top"><span class="eyebrow">${shared ? 'В ОБЩЕМ ТАЙНИКЕ' : 'ПРИНАДЛЕЖИТ ТЕБЕ'}</span>${button('×', 'clear', 'aria-label="Закрыть описание предмета"')}</div><div class="inv-detail-art">${itemImage(item)}</div><span class="inv-detail-category">${e(categoryLabel(item))}</span><h2 class="inv-detail-name">${e(item.name)}</h2><div class="inv-detail-amount"><span>Количество</span><strong>×${Number(item.quantity)}</strong></div>${selectedSlots.length ? `<p class="inv-owned-status">В экипировке: ${selectedSlots.map(([,label]) => e(label)).join(', ')}</p>` : ''}<dl class="inv-stats">${statRows}</dl>${effects ? `<div class="inv-item-effects"><span class="eyebrow">ОСОБЕННОСТИ</span><p>${e(effects)}</p></div>` : ''}${item.description ? `<p class="inv-item-description">${e(item.description)}</p>` : ''}<div class="inv-detail-actions"><label class="inv-quantity-label" for="invQuantity">КОЛИЧЕСТВО ДЛЯ ПЕРЕДАЧИ<input class="input" id="invQuantity" type="number" inputmode="numeric" min="1" max="${Number(item.quantity)}" step="1" value="${quantity}" ${actionDisabled}></label>${button(shared ? 'Взять себе ↗' : 'Вернуть в тайник ↙', shared ? 'take' : 'return', actionDisabled, true)}${!shared ? `<div class="inv-equip-actions"><label for="invEquipSlot" class="field-label">СЛОТ ЭКИПИРОВКИ<select class="input" id="invEquipSlot" ${actionDisabled}>${slots.map(([id,label]) => `<option value="${id}" ${slot === id ? 'selected' : ''}>${label}</option>`).join('')}</select></label>${button('Экипировать', 'equip', actionDisabled)}</div>${selectedSlots.length ? `<div class="inv-remove-slots">${selectedSlots.map(([slotId,label]) => button('Снять · ' + label, 'unequip', `data-slot="${slotId}" data-item-id="${e(item.id)}" ${actionDisabled}`)).join('')}</div>` : ''}${button(consumable(item) ? 'Использовать 1 шт.' : 'Использовать предмет', 'use', actionDisabled)}<p class="inv-action-hint">${consumable(item) ? 'Использование расходует одну вещь из твоего запаса. Эффект применяется по правилам вашей группы.' : 'Использование отмечается в сессии. Урон, ОД и специальные эффекты применяются по правилам вашей группы.'}</p>` : '<p class="inv-action-hint">Использовать и экипировать предмет сможет только тот, кто забрал его себе.</p>'}</div>${source ? `<p class="inv-source">${e(source)}</p>` : ''}${warnings.length ? `<details class="inv-catalog-notes"><summary>Примечания каталога</summary>${warnings.map(value => `<p>${e(value)}</p>`).join('')}</details>` : ''}<p class="inv-unknown-note">«Не указано» означает, что в прикреплённом каталоге нет этого значения. Его может уточнить ведущий.</p>`;
  }
  function legacyMarkup() {
    const text = typeof player !== 'undefined' ? player.profile?.inventory : '';
    return text ? `<details class="panel inv-legacy"><summary>Прежние личные записи о снаряжении</summary><p>Этот текст сохранён из прежнего листа. Общие предметы и их владельцы учитываются отдельно, в инвентаре выше.</p><div class="prewrap">${e(text)}</div></details>` : '';
  }
  function disconnectedMarkup() {
    return `<section class="panel inv-connect"><div class="inv-connect-symbol" aria-hidden="true">◇</div><span class="eyebrow">ИНВЕНТАРЬ ГРУППЫ</span><h2>${document.documentElement.dataset.offline === 'true' || location.protocol === 'file:' ? 'Общему тайнику нужен интернет.' : 'Сначала подключись к игровой комнате.'}</h2><p>Войди по приглашению ведущего. Твои вещи, экипировка и доступная общая добыча появятся здесь.</p><a class="button primary" href="#session">К игровой сессии ↗</a></section>${legacyMarkup()}`;
  }
  function contentMarkup() {
    if (!room()?.self) return disconnectedMarkup();
    return `${statusMarkup()}<div data-inv-notice>${noticeMarkup()}</div><div class="inv-layout"><section class="panel inv-board"><div class="inv-board-head"><span class="eyebrow">ПРИ ТЕБЕ</span><h2>Экипировка</h2></div><div class="inv-equipment" data-inv-equipment>${SLOTS.map(([slot,label]) => slotMarkup(slot,label)).join('')}</div><div data-inv-bag>${bagMarkup()}</div></section><aside class="panel inv-detail" data-inv-detail tabindex="-1" aria-label="Описание выбранного предмета">${detailsMarkup()}</aside><section class="panel inv-shared" data-inv-stash>${stashMarkup()}</section></div>${legacyMarkup()}`;
  }
  function page() {
    const heading = typeof head === 'function' ? head('СНАРЯЖЕНИЕ И ОБЩАЯ ДОБЫЧА', 'Инвентарь.', 'Оружие, броня и вещи твоего персонажа. Возьми нужное и верни то, чем не пользуешься.') : '<h1>Инвентарь</h1>';
    if (typeof window.playerSessionRefresh === 'function') queueMicrotask(() => window.playerSessionRefresh());
    return heading + `<div id="playerInventoryRoot">${contentMarkup()}</div>`;
  }
  function paint(force = false) {
    const root = document.getElementById('playerInventoryRoot');
    if (!root) return;
    const focused = document.activeElement;
    const focusData = focused?.matches('[data-inv-action]') && root.contains(focused) ? {...focused.dataset} : null;
    const current = room();
    const previous = selection;
    if (selection && !selectedItem()) {
      selection = null;
      if (previous.source === 'shared' && !pending && !message) { message = 'Этой вещи уже нет в общем тайнике. Возможно, её забрал другой участник.'; messageKind = ''; }
    }
    if (!current?.self || !root.querySelector('[data-inv-equipment]')) {
      root.innerHTML = contentMarkup();
      return;
    }
    const channel = root.querySelector('.inv-channel'); if (channel) channel.outerHTML = statusMarkup();
    root.querySelector('[data-inv-notice]').innerHTML = noticeMarkup();
    root.querySelector('[data-inv-equipment]').innerHTML = SLOTS.map(([slot,label]) => slotMarkup(slot,label)).join('');
    root.querySelector('[data-inv-bag]').innerHTML = bagMarkup();
    root.querySelector('[data-inv-stash]').innerHTML = stashMarkup();
    const detail = root.querySelector('[data-inv-detail]');
    const editing = detail.contains(document.activeElement) && document.activeElement.matches('input,select');
    if (!editing || force || previous !== selection) detail.innerHTML = detailsMarkup();
    lastRevision = current.revision;
    lastRoomId = current.id;
    lastOnline = online();
    if (focusData) {
      const replacement = [...root.querySelectorAll('[data-inv-action]')].find(node => ['invAction', 'source', 'itemId', 'slot'].every(key => (node.dataset[key] || '') === (focusData[key] || '')));
      if (replacement && !replacement.disabled) replacement.focus({preventScroll:true});
      else if (force) detail.focus({preventScroll:true});
    }
  }
  function operationId() { return crypto.randomUUID?.() || Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2,'0')).join(''); }
  async function perform(payload, retry = false) {
    if (pending || !online() || typeof window.playerSessionInventoryAction !== 'function') return;
    if (retryOperation && !retry) return;
    const operation = retry ? retryOperation : {operationId:operationId(), ...payload};
    if (!operation) return;
    pending = true; message = ''; messageKind = ''; paint(true);
    try {
      const data = await window.playerSessionInventoryAction(operation);
      if (data?.room?.self) cachedRoom = data.room;
      else if (data?.self) cachedRoom = data;
      retryOperation = null;
      message = ({take:'Предметы теперь у тебя.', return:'Предметы возвращены в общий тайник.', equip:'Экипировка обновлена.', unequip:'Вещь снята. Она осталась в твоей сумке.', use:'Использование предмета учтено.'})[operation.action] || 'Инвентарь обновлён.';
      messageKind = 'success';
    } catch (error) {
      const status = Number(error.status);
      if (!status || status >= 500) {
        retryOperation = operation;
        message = 'Не удалось получить подтверждение. Повтори этот запрос: повторная передача или трата не произойдёт.';
      } else {
        retryOperation = null;
        message = status === 409 ? 'Запас уже изменился. Обновляю тайник — выбери доступное количество.' : error.message || 'Действие не выполнено.';
      }
      messageKind = 'error';
      if (typeof window.playerSessionRefresh === 'function') await window.playerSessionRefresh();
    } finally { pending = false; paint(true); }
  }
  function select(source, id, scroll = false) {
    if (!itemFor(source,id)) return;
    selection = {source,id}; message = ''; messageKind = ''; paint(true);
    if (scroll && matchMedia('(max-width: 850px)').matches) {
      document.querySelector('[data-inv-detail]')?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block:'start'});
    }
  }
  document.addEventListener('click', event => {
    const target = event.target.closest('[data-inv-action]');
    if (!target || !target.closest('#playerInventoryRoot')) return;
    const action = target.dataset.invAction;
    if (action === 'select') { select(target.dataset.source, target.dataset.itemId, true); return; }
    if (action === 'clear') { selection = null; paint(true); return; }
    if (action === 'retry') { void perform(null,true); return; }
    if (action === 'empty-slot') {
      const slot = target.dataset.slot;
      const candidates = ownItems().filter(item => slot === 'weapon' ? weapon(item) : slot === 'armor' ? item.category === 'armor' : true);
      if (candidates.length) { slotChoices.set(candidates[0].id,slot); select('own',candidates[0].id,true); }
      else { message = 'В сумке пока нет вещи для этого слота. Сначала возьми подходящий предмет из тайника.'; messageKind = ''; paint(); }
      return;
    }
    if (action === 'unequip') { void perform({action,slot:target.dataset.slot,itemId:target.dataset.itemId}); return; }
    const item = selectedItem();
    if (!item) return;
    if (action === 'take' || action === 'return') {
      const input = document.getElementById('invQuantity'), n = Number(input?.value);
      if (!Number.isInteger(n) || n < 1 || n > item.quantity) {
        input?.setCustomValidity('Введи целое число от 1 до '+item.quantity+'.'); input?.reportValidity(); return;
      }
      void perform({action,itemId:item.id,quantity:n});
    }
    if (action === 'equip') {
      const slot = document.getElementById('invEquipSlot')?.value;
      if (slot) void perform({action,itemId:item.id,slot});
    }
    if (action === 'use') void perform({action,itemId:item.id,quantity:1});
  });
  document.addEventListener('input', event => {
    if (event.target.id !== 'invQuantity' || !selection) return;
    event.target.setCustomValidity('');
    quantities.set(selection.source+':'+selection.id,event.target.value);
  });
  document.addEventListener('change', event => {
    if (event.target.id === 'invEquipSlot' && selection) slotChoices.set(selection.id,event.target.value);
  });
  window.addEventListener('niti:session-update', event => {
    if (event.detail && Object.hasOwn(event.detail,'room')) cachedRoom = event.detail.room;
    const current = room();
    if ((current?.revision ?? -1) !== lastRevision || (current?.id || '') !== lastRoomId || online() !== lastOnline) paint();
  });
  window.addEventListener('offline', () => paint());
  window.addEventListener('online', () => paint());
  window.playerInventoryPage = page;
  window.playerInventoryMount = paint;
})();
