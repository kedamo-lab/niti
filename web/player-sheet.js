'use strict';
/* The character form mirrors the supplied PDF. Ownership lives in the session inventory. */
(function () {
  const SPECIAL_ROWS = [
    ['S', 'strength', 'Сила'], ['P', 'perception', 'Восприятие'],
    ['E', 'endurance', 'Выносливость'], ['C', 'charisma', 'Харизма'],
    ['I', 'intelligence', 'Интеллект'], ['A', 'agility', 'Ловкость'], ['L', 'luck', 'Удача']
  ];
  const SKILLS = [
    ['small_guns', 'Легкое оружие'], ['big_guns', 'Тяжелое оружие'],
    ['energy_weapons', 'Энергооружие'], ['unarmed', 'Рукопашное оружие'],
    ['melee', 'Холодное оружие'], ['throwing', 'Метательное оружие'],
    ['first_aid', 'Первая помощь'], ['doctor', 'Доктор'], ['sneak', 'Скрытность'],
    ['lockpick', 'Взлом замков'], ['steal', 'Воровство'], ['traps', 'Ловушки'],
    ['science', 'Наука'], ['repair', 'Ремонт'], ['speech', 'Красноречие'],
    ['barter', 'Торговля'], ['gambling', 'Азартные игры'], ['outdoorsman', 'Скиталец']
  ];
  const WEAPON_FIELDS = [
    ['weapon_name', 'Название'], ['weapon_damage', 'Урон'], ['weapon_range', 'Дальность'],
    ['weapon_ap', 'ОД'], ['weapon_ammo', 'Боезапас']
  ];
  const ARMOR_FIELDS = [
    ['armor_name', 'Название'], ['armor_ac', 'КБ'], ['armor_normal', 'Норма'],
    ['armor_laser', 'Лазер'], ['armor_plasma', 'Плазма'], ['armor_electro', 'Электро'], ['armor_explosion', 'Взрыв']
  ];
  const SIMPLE_FIELDS = ['name', 'gender', 'age', 'initiative', 'action_points', 'armor_class', 'experience', 'level', 'health', 'traits_1', 'traits_2', 'perks', 'wounds'];
  const FIELD_NAMES = [...SIMPLE_FIELDS, ...SPECIAL_ROWS.flatMap(([, name]) => [name, name + '_modifier']), ...SKILLS.flatMap(([name]) => ['tag_' + name, 'skill_' + name]), ...WEAPON_FIELDS.map(([name]) => name), ...ARMOR_FIELDS.map(([name]) => name)];
  const FIELD_SET = new Set(FIELD_NAMES);
  const TAG_FIELDS = new Set(SKILLS.map(([name]) => 'tag_' + name));
  const LONG_FIELDS = new Set(['perks', 'wounds', ...WEAPON_FIELDS.map(([name]) => name), ...ARMOR_FIELDS.map(([name]) => name)]);
  let saveTimer = 0;
  let rememberedRoom = null;

  function escapeText(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[character]));
  }
  function limitFor(name) { return LONG_FIELDS.has(name) ? 12000 : name.startsWith('skill_') || name.endsWith('_modifier') || SPECIAL_ROWS.some(([, value]) => value === name) ? 40 : 300; }
  function modifier(value) {
    if (!/^-?\d+$/.test(String(value).trim())) return '';
    const number = Number(value);
    if (!Number.isSafeInteger(number)) return '';
    return number - 5 >= 0 ? '+' + (number - 5) : String(number - 5);
  }
  function validSheet(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value) && value.version === 1
      && Object.keys(value).length === FIELD_NAMES.length + 1
      && FIELD_NAMES.every(name => TAG_FIELDS.has(name) ? typeof value[name] === 'boolean' : typeof value[name] === 'string' && value[name].length <= limitFor(name));
  }
  function normalizeSheet(value, profile) {
    const result = {version: 1};
    for (const name of FIELD_NAMES) {
      result[name] = TAG_FIELDS.has(name) ? typeof value?.[name] === 'boolean' ? value[name] : false
        : typeof value?.[name] === 'string' ? value[name].slice(0, limitFor(name)) : '';
    }
    if (value?.version === 1) return result;
    if (profile && typeof profile === 'object') {
      result.name = String(profile.name || '').slice(0, 300);
      result.health = String(profile.hp || '').slice(0, 300);
      result.armor_class = String(profile.defence || '').slice(0, 300);
      for (const [letter, name] of SPECIAL_ROWS) {
        const current = profile.special?.[letter];
        if (current !== undefined && current !== null) {
          result[name] = String(current).slice(0, 40);
          result[name + '_modifier'] = modifier(current);
        }
      }
    }
    return result;
  }
  function currentSheet() {
    if (typeof player === 'undefined') return normalizeSheet(null, null);
    if (!validSheet(player.sheet)) player.sheet = normalizeSheet(player.sheet, player.profile);
    return player.sheet;
  }
  function currentRoom() {
    try {
      const next = typeof window.playerSessionSnapshot === 'function' ? window.playerSessionSnapshot() : rememberedRoom;
      return next?.self ? next : null;
    } catch { return rememberedRoom?.self ? rememberedRoom : null; }
  }
  function updateLegacyProfile(sheet) {
    if (typeof player === 'undefined' || !player.profile) return;
    player.profile.name = sheet.name;
    player.profile.hp = sheet.health;
    player.profile.defence = sheet.armor_class;
    for (const [letter, name] of SPECIAL_ROWS) {
      const value = Number(sheet[name]);
      if (/^\d+$/.test(sheet[name].trim()) && Number.isInteger(value) && value >= 1 && value <= 10) player.profile.special[letter] = value;
    }
  }
  function persist(showNotice = false) {
    clearTimeout(saveTimer);
    const sheet = currentSheet();
    updateLegacyProfile(sheet);
    const success = typeof save === 'function' ? save() : false;
    const status = document.getElementById('falloutSheetSaveStatus');
    if (status) status.textContent = success ? 'Анкета сохранена в этом браузере.' : 'Не удалось сохранить. Скачай резервную копию.';
    if (showNotice && typeof toast === 'function') toast(success ? 'Анкета сохранена.' : 'Браузер не сохранил анкету. Скачай копию данных.');
    return success;
  }
  function field(name, label, sheet, options = {}) {
    const attributes = `name="${name}" id="sheet-${name}" data-sheet-field="${name}" maxlength="${limitFor(name)}"`;
    const control = options.multiline
      ? `<textarea class="textarea ${options.className || ''}" ${attributes} rows="${options.rows || 4}" ${options.placeholder ? `placeholder="${escapeText(options.placeholder)}"` : ''}>${escapeText(sheet[name])}</textarea>`
      : `<input class="input ${options.className || ''}" ${attributes} value="${escapeText(sheet[name])}" ${options.numeric ? 'inputmode="decimal"' : ''} autocomplete="${name === 'name' ? 'nickname' : 'off'}" ${options.placeholder ? `placeholder="${escapeText(options.placeholder)}"` : ''}>`;
    return `<label class="sheet-field ${options.wrapClass || ''}" for="sheet-${name}"><span>${label}</span>${control}${options.after || ''}</label>`;
  }
  function xpBreakdown(sheet) {
    const room = currentRoom();
    if (!room) return '<small>Опыт до вступления в сессию.</small>';
    const earned = Number.isSafeInteger(room.self.xp) && room.self.xp >= 0 ? room.self.xp : 0;
    const manual = /^\d{1,12}$/.test(sheet.experience.trim()) ? Number(sheet.experience) : sheet.experience.trim() === '' ? 0 : null;
    return `<small>Из сессии: <strong>+${earned} XP</strong>${manual !== null ? ` · всего <b>${manual + earned}</b>` : ''}<br>В поле — опыт до сессии.</small>`;
  }
  function sectionTitle(title, extra = '') { return `<div class="sheet-section-title"><h2>${title}</h2>${extra}</div>`; }
  function specialMarkup(sheet) {
    return `<section class="sheet-special-column" aria-label="S.P.E.C.I.A.L.">${SPECIAL_ROWS.map(([letter, name, label]) => `<div class="sheet-special"><span class="sheet-special-letter" aria-hidden="true">${letter}</span><label for="sheet-${name}"><span>${label}</span><input class="input sheet-special-input" type="text" inputmode="decimal" id="sheet-${name}" name="${name}" data-sheet-field="${name}" maxlength="40" value="${escapeText(sheet[name])}"></label><input class="input sheet-special-mod" type="text" inputmode="decimal" id="sheet-${name}_modifier" name="${name}_modifier" data-sheet-field="${name}_modifier" maxlength="40" aria-label="${label}: модификатор" value="${escapeText(sheet[name + '_modifier'])}"></div>`).join('')}<p class="sheet-special-hint">Малый круг — модификатор. Исходная подсказка: значение − 5; поле можно изменить вручную.</p></section>`;
  }
  function skillsMarkup(sheet) {
    return `<section class="sheet-skills-column" aria-labelledby="sheetSkillsTitle"><div class="sheet-section-title"><h2 id="sheetSkillsTitle">Навыки</h2><span>ОТМЕТКА / ЗНАЧЕНИЕ</span></div><div class="sheet-skill-list">${SKILLS.map(([id, label]) => `<div class="sheet-skill-row"><input type="checkbox" id="sheet-tag_${id}" name="tag_${id}" data-sheet-field="tag_${id}" aria-label="Отметить навык: ${label}" ${sheet['tag_' + id] ? 'checked' : ''}><label for="sheet-tag_${id}">${label}</label><input class="input" type="text" inputmode="decimal" id="sheet-skill_${id}" name="skill_${id}" data-sheet-field="skill_${id}" maxlength="40" aria-label="Значение навыка: ${label}" value="${escapeText(sheet['skill_' + id])}"></div>`).join('')}</div></section>`;
  }
  function statValue(value) { return value === undefined || value === null || value === '' ? '—' : String(value); }
  function equippedItems(room) {
    const items = Array.isArray(room?.self?.inventory) ? room.self.inventory : [];
    const equipment = room?.self?.equipment || room?.self?.equipped || {};
    const seen = new Set();
    const result = [];
    for (const [slot, reference] of Object.entries(equipment)) {
      const id = typeof reference === 'string' ? reference : reference?.id || reference?.itemId;
      const item = items.find(candidate => (candidate.id === id || candidate.itemId === id || candidate.lotId === id) && candidate.quantity > 0);
      if (item && !seen.has(item.id)) { result.push({...item, equippedSlot: slot}); seen.add(item.id); }
    }
    for (const item of items) {
      if ((item.equippedSlot || item.equipped === true) && item.quantity > 0 && !seen.has(item.id)) { result.push(item); seen.add(item.id); }
    }
    return result;
  }
  function weaponCells(item) {
    const stats = item.stats || {};
    const ammo = [stats.ammo, stats.magazine == null ? null : 'магазин ' + stats.magazine].filter(Boolean).join(' · ');
    return [item.name, stats.damage, stats.range, stats.apCost, ammo];
  }
  function armorCells(item) {
    const stats = item.stats || {};
    const resistance = stats.resistances || {};
    return [item.name, stats.armorClass, resistance.normal, resistance.laser, resistance.plasma, resistance.electric ?? resistance.electro, resistance.explosive ?? resistance.explosion];
  }
  function equipmentTable(sheet, kind, room) {
    const columns = kind === 'weapon' ? WEAPON_FIELDS : ARMOR_FIELDS;
    const title = kind === 'weapon' ? 'Оружие' : 'Броня';
    let body;
    if (room) {
      const items = equippedItems(room).filter(item => kind === 'weapon'
        ? item.equippedSlot === 'weapon' || ['melee', 'unarmed', 'light', 'light_weapon', 'small_guns', 'heavy', 'big_guns', 'energy', 'energy_weapons', 'throwing', 'weapon'].includes(item.category)
        : item.equippedSlot === 'armor' || item.category === 'armor');
      body = items.length ? items.map(item => `<tr>${(kind === 'weapon' ? weaponCells(item) : armorCells(item)).map(cell => `<td>${escapeText(statValue(cell))}</td>`).join('')}</tr>`).join('')
        : `<tr class="sheet-equipment-empty"><td colspan="${columns.length}">${kind === 'weapon' ? 'Оружие пока не экипировано.' : 'Броня пока не экипирована.'} <a href="#inventory">Открыть инвентарь ↗</a></td></tr>`;
      return `<section class="sheet-equipment-section">${sectionTitle(title, '<span>ЭКИПИРОВАНО В СЕССИИ</span>')}<div class="sheet-table-scroll" tabindex="0" role="region" aria-label="${title}: характеристики экипировки"><table class="sheet-equipment-table"><thead><tr>${columns.map(([, label]) => `<th scope="col">${label}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div><p class="sheet-storage-note">Данные принадлежащих тебе предметов. Смена экипировки — в отдельном инвентаре.</p></section>`;
    }
    body = `<tr>${columns.map(([name, label]) => `<td><label class="sr-only" for="sheet-${name}">${title}: ${label}</label><textarea class="textarea sheet-reference-input" id="sheet-${name}" name="${name}" data-sheet-field="${name}" maxlength="${limitFor(name)}" rows="3" aria-label="${title}: ${label}">${escapeText(sheet[name])}</textarea></td>`).join('')}</tr>`;
    return `<section class="sheet-equipment-section">${sectionTitle(title, '<span>ЛИЧНАЯ СПРАВКА</span>')}<div class="sheet-table-scroll" tabindex="0" role="region" aria-label="${title}: личная справка"><table class="sheet-equipment-table"><thead><tr>${columns.map(([, label]) => `<th scope="col">${label}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div><p class="sheet-storage-note">Можно заполнить как в бумажной анкете. Эти записи не добавляют предметы в сессию.</p></section>`;
  }
  function equipmentMarkup(sheet) {
    const room = currentRoom();
    return equipmentTable(sheet, 'weapon', room) + equipmentTable(sheet, 'armor', room);
  }
  function legacyNotes() {
    if (typeof player === 'undefined') return '';
    const concept = String(player.profile?.concept || '').trim();
    const description = String(player.profile?.description || '').trim();
    if (!concept && !description) return '';
    return `<details class="sheet-legacy-details"><summary>Личные детали из прежнего листа</summary>${concept ? `<p><strong>Роль / концепция:</strong> ${escapeText(concept)}</p>` : ''}${description ? `<p class="prewrap">${escapeText(description)}</p>` : ''}</details>`;
  }
  function page() {
    const sheet = currentSheet();
    const heading = typeof head === 'function' ? head('ЛИЧНЫЙ ЛИСТ · ПО ТВОЕЙ АНКЕТЕ', 'Мой персонаж.', 'Характеристики, навыки и состояние. Инвентарь вынесен в отдельный раздел.') : '<h1>Мой персонаж.</h1>';
    return heading + `<form class="panel fallout-sheet" id="falloutSheetForm"><div class="sheet-masthead"><div class="sheet-brand"><h2>Fallout</h2><small>ПЕРСОНАЛЬНОЕ ДЕЛО ВЫЖИВШЕГО</small></div><span class="sheet-document-id">S.P.E.C.I.A.L. // 2207</span></div><div class="sheet-top"><div class="sheet-identity">${field('name', 'Имя', sheet)}${field('gender', 'Пол', sheet)}${field('age', 'Возраст', sheet, {numeric:true})}</div><div class="sheet-combat-summary">${field('initiative', 'Инициатива', sheet, {numeric:true})}${field('action_points', 'Очки действия', sheet, {numeric:true})}${field('armor_class', 'Класс брони', sheet, {numeric:true})}${field('experience', 'Опыт', sheet, {numeric:true, wrapClass:'sheet-xp-field', after:`<span class="sheet-xp-breakdown" data-sheet-xp>${xpBreakdown(sheet)}</span>`})}${field('level', 'Уровень', sheet, {numeric:true})}${field('health', 'Здоровье', sheet, {placeholder:'текущее / максимум'})}</div></div><div class="sheet-body">${specialMarkup(sheet)}<div class="sheet-notes-column"><section class="sheet-notebox sheet-traits">${sectionTitle('Особенности')}${field('traits_1', '<span class="sr-only">Особенность: первая строка</span>', sheet)}${field('traits_2', '<span class="sr-only">Особенность: вторая строка</span>', sheet)}</section><section class="sheet-notebox sheet-perks">${sectionTitle('Перки')}${field('perks', '<span class="sr-only">Перки</span>', sheet, {multiline:true, rows:10})}</section><section class="sheet-notebox sheet-wounds">${sectionTitle('Ранения')}${field('wounds', '<span class="sr-only">Ранения</span>', sheet, {multiline:true, rows:6})}</section>${legacyNotes()}</div>${skillsMarkup(sheet)}</div><div id="falloutSheetEquipment">${equipmentMarkup(sheet)}</div><div class="sheet-footer"><button class="button primary" type="submit">Сохранить анкету ↗</button><span class="sheet-save-status" id="falloutSheetSaveStatus" role="status">Изменения сохраняются автоматически в этом браузере.</span></div><p class="sheet-storage-note">Все поля взяты из твоего PDF. Формулы здоровья, уровня и очков действия в файле не заданы — значения заполняются по правилам вашей группы. Серверный опыт и предметы остаются в игровой сессии.</p></form>`;
  }
  function acceptField(target) {
    const name = target.dataset.sheetField;
    if (!FIELD_SET.has(name)) return;
    const sheet = currentSheet();
    const old = sheet[name];
    sheet[name] = TAG_FIELDS.has(name) ? target.checked : String(target.value).slice(0, limitFor(name));
    const special = SPECIAL_ROWS.find(([, value]) => value === name);
    if (special && (!sheet[name + '_modifier'] || sheet[name + '_modifier'] === modifier(old))) {
      const suggestion = modifier(sheet[name]);
      if (suggestion) {
        sheet[name + '_modifier'] = suggestion;
        const input = document.getElementById('sheet-' + name + '_modifier');
        if (input) input.value = suggestion;
      }
    }
    updateLegacyProfile(sheet);
    const status = document.getElementById('falloutSheetSaveStatus');
    if (status) status.textContent = 'Сохраняю изменения…';
    if (name === 'experience') updateSessionParts();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => persist(), 400);
  }
  function updateSessionParts() {
    const form = document.getElementById('falloutSheetForm');
    if (!form) return;
    const xp = form.querySelector('[data-sheet-xp]');
    if (xp) xp.innerHTML = xpBreakdown(currentSheet());
    const equipment = document.getElementById('falloutSheetEquipment');
    if (equipment && (currentRoom() || !equipment.contains(document.activeElement))) {
      const markup = equipmentMarkup(currentSheet());
      if (equipment.innerHTML !== markup) equipment.innerHTML = markup;
    }
  }
  document.addEventListener('input', event => { if (event.target.closest('#falloutSheetForm') && event.target.matches('[data-sheet-field]') && event.target.type !== 'checkbox') acceptField(event.target); });
  document.addEventListener('change', event => { if (event.target.closest('#falloutSheetForm') && event.target.matches('[data-sheet-field]') && event.target.type === 'checkbox') acceptField(event.target); });
  document.addEventListener('submit', event => {
    if (event.target.id !== 'falloutSheetForm') return;
    event.preventDefault();
    for (const control of event.target.querySelectorAll('[data-sheet-field]')) acceptField(control);
    persist(true);
  });
  window.addEventListener('niti:session-update', event => { rememberedRoom = event.detail?.room?.self ? event.detail.room : null; updateSessionParts(); });
  window.addEventListener('pagehide', () => { if (saveTimer) persist(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && saveTimer) persist(); });
  window.playerSheetPage = page;
  window.playerSheetValid = validSheet;
  window.playerSheetNormalize = normalizeSheet;
  window.playerSheetRefresh = updateSessionParts;
})();
