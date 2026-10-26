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
  const RULES = window.PlayerCharacterRules;
  let saveTimer = 0;
  let selectedTrait = '';
  let selectedPerk = '';
  let perkSearch = '';

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
      && [FIELD_NAMES.length + 1, FIELD_NAMES.length + 2].includes(Object.keys(value).length)
      && Object.keys(value).every(name => name === 'version' || name === 'rules' || FIELD_SET.has(name))
      && FIELD_NAMES.every(name => TAG_FIELDS.has(name) ? typeof value[name] === 'boolean' : typeof value[name] === 'string' && value[name].length <= limitFor(name))
      && (!Object.hasOwn(value, 'rules') || RULES.validMeta(value.rules));
  }
  function normalizeSheet(value, profile) {
    const result = {version: 1};
    for (const name of FIELD_NAMES) {
      result[name] = TAG_FIELDS.has(name) ? typeof value?.[name] === 'boolean' ? value[name] : false
        : typeof value?.[name] === 'string' ? value[name].slice(0, limitFor(name)) : '';
    }
    if (value?.version !== 1 && profile && typeof profile === 'object') {
      result.name = String(profile.name || '').slice(0, 300);
      result.health = String(profile.hp || '').slice(0, 300);
      result.armor_class = String(profile.defence || '').slice(0, 300);
      for (const [letter, name] of SPECIAL_ROWS) {
        const current = profile.special?.[letter];
        if (current !== undefined && current !== null) result[name] = String(current).slice(0, 40);
      }
    }
    result.rules = RULES.normalizeMeta(value?.rules, result);
    return result;
  }
  function currentSheet() {
    if (typeof player === 'undefined') return normalizeSheet(null, null);
    if (!validSheet(player.sheet) || !player.sheet.rules) player.sheet = normalizeSheet(player.sheet, player.profile);
    return player.sheet;
  }
  function currentRoom() {
    try {
      const next = typeof window.playerSessionSnapshot === 'function' ? window.playerSessionSnapshot() : rememberedRoom;
      return next?.self ? next : null;
    } catch { return rememberedRoom?.self ? rememberedRoom : null; }
  }
  function calculation(sheet = currentSheet()) {
    const room = currentRoom();
    const armor = room ? equippedItems(room).find(item => item.equippedSlot === 'armor' || item.category === 'armor') || null
      : sheet.armor_name.trim() ? {name:sheet.armor_name,stats:{armorClass:RULES.integer(sheet.armor_ac) || 0}} : null;
    return RULES.calculate(sheet, {sessionXP: room?.self?.xp || 0, armor});
  }
  function applyCalculated(sheet, result = calculation(sheet)) {
    sheet.level = String(result.level);
    sheet.action_points = String(result.ap);
    sheet.armor_class = String(result.ac);
    sheet.initiative = String(result.initiative) + ' + d20';
    if (result.currentHP !== null || !sheet.health.trim() || /^\s*\/\s*\d+\s*$/.test(sheet.health)) sheet.health = result.health;
    for (const [letter, name] of SPECIAL_ROWS) sheet[name + '_modifier'] = signed(result.modifiers[letter]);
    for (const [id] of SKILLS) sheet['skill_' + id] = String(result.skills[id]);
    return result;
  }
  function signed(value) { return value >= 0 ? '+' + value : String(value); }
  function updateLegacyProfile(sheet, result = calculation(sheet)) {
    if (typeof player === 'undefined' || !player.profile) return;
    player.profile.name = sheet.name;
    player.profile.hp = sheet.health;
    player.profile.defence = sheet.armor_class;
    if (!player.profile.special) player.profile.special = {};
    for (const [letter] of SPECIAL_ROWS) player.profile.special[letter] = result.special[letter];
  }
  function persist(showNotice = false) {
    clearTimeout(saveTimer);
    saveTimer = 0;
    const sheet = currentSheet();
    const result = applyCalculated(sheet);
    updateLegacyProfile(sheet, result);
    const previousLock = sheet.rules.traitsLocked;
    if (showNotice) sheet.rules.traitsLocked = true;
    const success = typeof save === 'function' ? save() : false;
    if (!success) sheet.rules.traitsLocked = previousLock;
    const status = document.getElementById('falloutSheetSaveStatus');
    if (status) status.textContent = success ? (showNotice ? 'Анкета сохранена. Особенности закреплены на всю игру.' : 'Анкета сохранена в этом браузере.') : 'Не удалось сохранить. Скачай резервную копию.';
    if (showNotice && typeof toast === 'function') toast(success ? 'Анкета сохранена. Особенности закреплены.' : 'Браузер не сохранил анкету. Скачай копию данных.');
    if (showNotice && success) refreshSelectors();
    return success;
  }
  function field(name, label, sheet, options = {}) {
    const attributes = `name="${name}" id="sheet-${name}" data-sheet-field="${name}" maxlength="${limitFor(name)}"`;
    const control = options.multiline
      ? `<textarea class="textarea ${options.className || ''}" ${attributes} rows="${options.rows || 4}" ${options.placeholder ? `placeholder="${escapeText(options.placeholder)}"` : ''}>${escapeText(sheet[name])}</textarea>`
      : `<input class="input ${options.className || ''}" ${attributes} value="${escapeText(sheet[name])}" ${options.numeric ? 'inputmode="numeric"' : ''} ${options.readonly ? 'readonly aria-readonly="true"' : ''} autocomplete="${name === 'name' ? 'nickname' : 'off'}" ${options.placeholder ? `placeholder="${escapeText(options.placeholder)}"` : ''}>`;
    return `<label class="sheet-field ${options.wrapClass || ''}" for="sheet-${name}"><span>${label}</span>${control}${options.after || ''}</label>`;
  }
  function xpBreakdown(sheet) {
    const result = calculation(sheet);
    return `<small>Стартовый опыт: ${result.manualXP} · из сессии: +${result.serverXP}${result.earnedXP !== result.serverXP ? ` → +${result.earnedXP} («Светоч»)` : ''}<br>Всего: <b>${result.totalXP} XP</b>${result.nextXP ? ` · следующий уровень: ${result.nextXP} XP` : ' · достигнут конец таблицы (15-й уровень)'}<br>В поле — уже полученный опыт до сессии.</small>`;
  }
  function sectionTitle(title, extra = '') { return `<div class="sheet-section-title"><h2>${title}</h2>${extra}</div>`; }
  function specialMarkup(sheet) {
    const result = calculation(sheet);
    return `<section class="sheet-special-column" aria-label="S.P.E.C.I.A.L.">${SPECIAL_ROWS.map(([letter, name, label]) => `<div class="sheet-special"><span class="sheet-special-letter" aria-hidden="true">${letter}</span><label for="sheet-${name}"><span>${label} · база</span><input class="input sheet-special-input" type="text" inputmode="numeric" maxlength="40" id="sheet-${name}" name="${name}" data-sheet-field="${name}" value="${escapeText(sheet[name])}"></label><output class="sheet-special-effective" data-special-effective="${letter}">${result.special[letter]} итог</output><input class="input sheet-special-mod" readonly aria-readonly="true" id="sheet-${name}_modifier" aria-label="${label}: автоматический модификатор" data-special-mod="${letter}" value="${signed(result.modifiers[letter])}"></div>`).join('')}<p class="sheet-special-hint" data-special-budget>${specialBudget(result)}</p></section>`;
  }
  function specialBudget(result) { return `База: ${result.points} / ${result.specialBudget} очков. 40 при создании, +1 за каждый 4-й уровень. Модификатор = итог − 5. Особенности и перки учтены в итоге; каждое значение от 0 до 10.`; }
  function skillBudget(result) { return `Обучение: ${result.trained} / ${result.skillBudget} очков. На 1-м уровне — 4 (до 2 в один навык), затем по 2 за уровень (по 1 в разные). Метка — личная пометка, без автоматического бонуса.`; }
  function skillsMarkup(sheet) {
    const result = calculation(sheet);
    return `<section class="sheet-skills-column" aria-labelledby="sheetSkillsTitle"><div class="sheet-section-title"><h2 id="sheetSkillsTitle">Навыки</h2><span>ОБУЧЕНИЕ / ИТОГ</span></div><p class="sheet-rules-help" data-skill-budget>${skillBudget(result)}</p><div class="sheet-skill-list">${SKILLS.map(([id, label]) => `<div class="sheet-skill-row"><input type="checkbox" id="sheet-tag_${id}" name="tag_${id}" data-sheet-field="tag_${id}" aria-label="Отметить навык: ${label}" ${sheet['tag_' + id] ? 'checked' : ''}><label for="sheet-training_${id}">${label}<small data-skill-bonus="${id}">${result.bonus[id] ? signed(result.bonus[id]) + ' от особенностей / перков' : 'Без постоянного бонуса'}</small></label><input class="input" type="text" inputmode="numeric" maxlength="40" id="sheet-training_${id}" data-training="${id}" aria-label="Обучение навыку: ${label}" value="${escapeText(sheet.rules.training[id])}"><output class="sheet-skill-total" data-skill-total="${id}" aria-label="Итог навыка: ${label}">${signed(result.skills[id])}</output></div>`).join('')}</div><p class="sheet-rules-help">Навыки — бонусы к броску d20. Правила не задают формулу навыков от S.P.E.C.I.A.L.; итог = обучение + постоянные бонусы.</p></section>`;
  }
  function traitMarkup(sheet) {
    const meta = sheet.rules, selected = meta.traits.map(id => RULES.TRAITS.find(trait => trait.id === id));
    const preview = RULES.TRAITS.find(trait => trait.id === selectedTrait);
    const legacy = ['traits_1','traits_2'].map(key=>sheet[key]).filter(text=>text.trim() && !RULES.TRAITS.some(trait=>trait.name===text.trim()));
    const thief = meta.traits.includes('thief');
    return `${sectionTitle('Особенности', `<span>${selected.length} / 2 · ${meta.traitsLocked ? 'ЗАКРЕПЛЕНЫ' : 'ВЫБОР ПРИ СОЗДАНИИ'}</span>`)}<p class="sheet-rules-help">${meta.traitsLocked ? 'Выбранные особенности закреплены на всю игру.' : 'Выбери до двух. Кнопка «Сохранить анкету» закрепит выбор на всю игру. Автосохранение оставляет выбор открытым.'}</p><div class="sheet-selected-list">${selected.map(trait=>`<article class="sheet-rule-card"><div><strong>${escapeText(trait.name)}</strong>${!meta.traitsLocked ? `<button type="button" class="sheet-rule-remove" data-remove-trait="${trait.id}" aria-label="Убрать особенность ${escapeText(trait.name)}">×</button>` : ''}</div><p>${escapeText(trait.description)}</p></article>`).join('') || '<p class="sheet-rules-help">Особенности не выбраны.</p>'}</div>${thief ? `<fieldset class="sheet-thief-config" ${meta.traitsLocked ? 'disabled' : ''}><legend>«Вор»: подтип и два навыка</legend><label>Подтип<select class="input" data-thief-subtype><option value="">Выбери подтип</option>${['Взломщик','Скрытник','Карманник','Минёр'].map(name=>`<option ${meta.thiefSubtype===name?'selected':''}>${name}</option>`).join('')}</select></label>${SKILLS.map(([id,name])=>`<label class="sheet-thief-skill"><input type="checkbox" data-thief-skill="${id}" ${meta.thiefSkills.includes(id)?'checked':''}>${name} +1</label>`).join('')}</fieldset>` : ''}${!meta.traitsLocked && meta.traits.length<2 ? `<details class="sheet-catalog" open><summary>Выбрать особенность</summary><label class="sheet-field" for="sheet-trait-choice"><span>Особенность из правил</span><select class="input" id="sheet-trait-choice" data-trait-choice><option value="">Выбери особенность</option>${RULES.TRAITS.filter(trait=>!meta.traits.includes(trait.id)).map(trait=>`<option value="${trait.id}" ${trait.id===selectedTrait?'selected':''}>${escapeText(trait.name)}</option>`).join('')}</select></label><div class="sheet-rule-preview" aria-live="polite">${preview ? `<p>${escapeText(preview.description)}</p><button class="button" type="button" data-add-trait="${preview.id}">Добавить особенность +</button>` : '<p>Описание появится после выбора.</p>'}</div></details>` : ''}${legacy.length ? `<details class="sheet-legacy-details"><summary>Прежние записи об особенностях</summary><p>${legacy.map(escapeText).join('<br>')}</p></details>` : ''}`;
  }
  function perkMarkup(sheet) {
    const result=calculation(sheet),meta=sheet.rules,used=meta.perks.reduce((sum,p)=>sum+p.rank,0),preview=RULES.PERKS.find(perk=>perk.id===selectedPerk);
    const available=RULES.PERKS.filter(perk=>!meta.perks.some(entry=>entry.id===perk.id) && (!perkSearch || (perk.name+' '+perk.description).toLocaleLowerCase('ru').includes(perkSearch.toLocaleLowerCase('ru'))));
    const previewReasons=preview ? RULES.eligibility(preview,result) : [];
    return `${sectionTitle('Перки',`<span>${used} / ${result.perkBudget} РАНГОВ</span>`)}<p class="sheet-rules-help">По 1 перку каждые 3 уровня. Требования, число рангов и эффекты — из приложенного списка перков.</p><div class="sheet-selected-list">${meta.perks.map(entry=>{const perk=RULES.PERKS.find(p=>p.id===entry.id);return `<article class="sheet-rule-card"><div><strong>${escapeText(perk.name)} · ${entry.rank}/${perk.ranks.max}</strong><button type="button" class="sheet-rule-remove" data-remove-perk="${entry.id}" aria-label="Убрать ранг перка ${escapeText(perk.name)}">−</button></div><p>${escapeText(perk.description)}</p><small>${escapeText(perk.requirements.text || '')}</small>${entry.rank<perk.ranks.max && used<result.perkBudget && !RULES.eligibility(perk,result,entry.rank+1).length ? `<button type="button" class="sheet-rule-rank" data-add-rank="${entry.id}">Добавить ранг +</button>` : ''}</article>`;}).join('') || '<p class="sheet-rules-help">Перки пока не выбраны.</p>'}</div><details class="sheet-catalog"><summary>Каталог перков · ${RULES.PERKS.length}</summary><label class="sheet-field" for="sheet-perk-search"><span>Поиск по названию и эффекту</span><input class="input" id="sheet-perk-search" data-perk-search value="${escapeText(perkSearch)}" placeholder="Например, ловкость"></label><label class="sheet-field" for="sheet-perk-choice"><span>Перк из правил</span><select class="input" id="sheet-perk-choice" data-perk-choice><option value="">Выбери перк</option>${available.map(perk=>`<option value="${perk.id}" ${perk.id===selectedPerk?'selected':''}>${escapeText(perk.name)} · ур. ${perk.level}</option>`).join('')}</select></label><div class="sheet-rule-preview" aria-live="polite">${preview ? `<p>${escapeText(preview.description)}</p><p><strong>Требования:</strong> ${escapeText(preview.requirements.text || 'Без дополнительных требований')}<br>Уровень ${preview.level}; рангов: ${preview.ranks.max}${preview.ranks.note ? ' · '+escapeText(preview.ranks.note) : ''}</p>${previewReasons.length ? `<p class="sheet-warning">Недоступен: ${previewReasons.map(escapeText).join(', ')}.</p>` : ''}${used>=result.perkBudget ? '<p>Свободных рангов нет. Следующий — на уровне '+(3*(result.perkBudget+1))+'.</p>' : ''}<button class="button" type="button" data-add-perk="${preview.id}" ${previewReasons.length || used>=result.perkBudget ? 'disabled' : ''}>Выбрать перк +</button>` : '<p>Выбери перк, чтобы увидеть эффект и требования.</p>'}</div></details>${field('perks','Личные записи о перках',sheet,{multiline:true,rows:3})}<p class="sheet-rules-help">Постоянные числовые бонусы учтены автоматически. Условные эффекты, преимущество, урон и боевые действия применяются по описанию.</p>`;
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
    const result=applyCalculated(sheet);
    const heading = typeof head === 'function' ? head('ЛИЧНЫЙ ЛИСТ · ПРАВИЛА ПУСТОШИ', 'Мой персонаж.', 'Характеристики считаются по правилам. Обучение навыкам и текущее здоровье — под твоим контролем.') : '<h1>Мой персонаж.</h1>';
    return heading + `<form class="panel fallout-sheet" id="falloutSheetForm"><div class="sheet-masthead"><div class="sheet-brand"><h2>Fallout</h2><small>ПЕРСОНАЛЬНОЕ ДЕЛО ВЫЖИВШЕГО</small></div><span class="sheet-document-id">S.P.E.C.I.A.L. // 2207<br>АВТОМАТИЧЕСКИЙ РАСЧЁТ ПО ПРАВИЛАМ</span></div><div class="sheet-top"><div class="sheet-identity">${field('name', 'Имя', sheet)}${field('gender', 'Пол', sheet)}${field('age', 'Возраст', sheet, {numeric:true})}</div><div class="sheet-combat-summary">${field('initiative', 'Инициатива · авто', sheet, {readonly:true})}${field('action_points', 'Очки действия · авто', sheet, {readonly:true,after:`<small data-movement-ap>${result.movementAP ? '+'+result.movementAP+' ОД только на передвижение' : 'Общие ОД на ход'}</small>`})}${field('armor_class', 'Класс брони · авто', sheet, {readonly:true})}${field('experience', 'Опыт до сессии', sheet, {numeric:true, wrapClass:'sheet-xp-field', after:`<span class="sheet-xp-breakdown" data-sheet-xp>${xpBreakdown(sheet)}</span>`})}${field('level', 'Уровень · авто', sheet, {readonly:true})}<label class="sheet-field" for="sheet-health-current"><span>Здоровье · текущее / максимум</span><span class="sheet-health-control"><input class="input" type="number" step="1" inputmode="numeric" id="sheet-health-current" data-health-current aria-label="Текущее здоровье" value="${result.currentHP===null?'':result.currentHP}"><output data-health-max>/ ${result.maxHP}</output></span><small>Максимум считается; текущее не лечится при повышении уровня.</small></label></div></div><div class="sheet-rule-notices" data-rules-warnings aria-live="polite">${warningsMarkup(result)}</div><div class="sheet-body">${specialMarkup(sheet)}<div class="sheet-notes-column"><section class="sheet-notebox sheet-traits" id="sheetTraits">${traitMarkup(sheet)}</section><section class="sheet-notebox sheet-perks" id="sheetPerks">${perkMarkup(sheet)}</section><section class="sheet-notebox sheet-wounds">${sectionTitle('Ранения')}${field('wounds', '<span class="sr-only">Ранения</span>', sheet, {multiline:true, rows:6})}</section>${legacyNotes()}</div>${skillsMarkup(sheet)}</div><div id="falloutSheetEquipment">${equipmentMarkup(sheet)}</div><details class="sheet-formulas"><summary>Как считается анкета</summary><p>Модификатор S.P.E.C.I.A.L. = итог − 5. Максимум здоровья = 15 + 3 × В + (уровень − 1) × В + бонусы. ОД = 5 + ⌊Л / 2⌋ + бонусы. Инициатива = Восприятие + d20; кубик бросается в игре.</p><p>КБ = КБ экипированной брони + бонус ловкости + постоянные бонусы. Без брони бонус равен ловкости; кожаная куртка — ⌊Л/2⌋, кожаная боевая куртка — ⌊Л/3⌋, кожаная броня — ⌊Л/4⌋, кожаная броня МК2 — ⌊Л/6⌋. «Камикадзе» исключает бонус ловкости к КБ и прибавляет ловкость к инициативе.</p><p>В таблице опыта: 1 — 200; 2 — 400; 3 — 800; 4 — 1400; 5 — 2200; 6 — 3200; 7 — 4400; 8 — 5800; 9 — 7400; 10 — 9100; 11 — 11000; 12 — 13100; 13 — 15400; 14 — 17900; 15 — 20600. Создание начинается с 1-го уровня: при 0–399 XP показан 1-й уровень. Выше 15-го формулы опыта в файле нет.</p><p>Стартовый опыт — уже полученная сумма. «Светоч» делит новый опыт сессии на два; округление в правилах не указано, поэтому сохраняется точная половина. Серверная запись опыта остаётся исходной.</p></details><div class="sheet-footer"><button class="button primary" type="submit">Сохранить анкету ↗</button><span class="sheet-save-status" id="falloutSheetSaveStatus" role="status">Изменения сохраняются автоматически в этом браузере.</span></div><p class="sheet-storage-note">Расчёты — по твоим «Правилам игры» и «Перкам». Лист сохраняется в браузере и входит в резервную копию. Предметы и опыт сессии хранятся отдельно.</p></form>`;
  }
  function warningsMarkup(result) { return result.warnings.length ? result.warnings.map(text=>`<p class="sheet-warning">${escapeText(text)}</p>`).join('') : '<p class="sheet-rules-help">Постоянные бонусы особенностей и перков учтены в итогах.</p>'; }
  function scheduleSave() {
    const status=document.getElementById('falloutSheetSaveStatus');
    if(status) status.textContent='Сохраняю изменения…';
    clearTimeout(saveTimer);
    saveTimer=setTimeout(()=>persist(),400);
  }
  function acceptField(target) {
    const sheet=currentSheet(),name=target.dataset.sheetField;
    if (target.dataset.training) {
      if(!RULES.SKILLS.includes(target.dataset.training)) return;
      sheet.rules.training[target.dataset.training]=String(target.value).slice(0,40);
    } else if(target.hasAttribute('data-health-current')) {
      sheet.health=target.value.trim()==='' ? '' : target.value+' / '+calculation(sheet).maxHP;
    } else {
      if(!FIELD_SET.has(name) || target.readOnly) return;
      sheet[name]=TAG_FIELDS.has(name) ? target.checked : String(target.value).slice(0,limitFor(name));
    }
    updateSessionParts();
    scheduleSave();
  }
  function refreshSelectors() {
    const sheet=currentSheet();
    const traits=document.getElementById('sheetTraits');
    if(traits) traits.innerHTML=traitMarkup(sheet);
    const perks=document.getElementById('sheetPerks');
    if(perks) { const wasOpen=!!perks.querySelector('.sheet-catalog[open]');perks.innerHTML=perkMarkup(sheet);if(wasOpen)perks.querySelector('.sheet-catalog')?.setAttribute('open',''); }
  }
  function updateSessionParts() {
    const form=document.getElementById('falloutSheetForm');
    if(!form) return;
    const sheet=currentSheet(),result=applyCalculated(sheet);
    updateLegacyProfile(sheet,result);
    for(const name of ['initiative','action_points','armor_class','level']) {const input=document.getElementById('sheet-'+name);if(input)input.value=sheet[name];}
    const xp=form.querySelector('[data-sheet-xp]');if(xp)xp.innerHTML=xpBreakdown(sheet);
    const health=form.querySelector('[data-health-max]');if(health)health.textContent='/ '+result.maxHP;
    const movement=form.querySelector('[data-movement-ap]');if(movement)movement.textContent=result.movementAP ? '+'+result.movementAP+' ОД только на передвижение' : 'Общие ОД на ход';
    for(const [letter] of SPECIAL_ROWS) {const effective=form.querySelector(`[data-special-effective="${letter}"]`),mod=form.querySelector(`[data-special-mod="${letter}"]`);if(effective)effective.textContent=result.special[letter]+' итог';if(mod)mod.value=signed(result.modifiers[letter]);}
    for(const [id] of SKILLS) {const total=form.querySelector(`[data-skill-total="${id}"]`),bonus=form.querySelector(`[data-skill-bonus="${id}"]`);if(total)total.textContent=signed(result.skills[id]);if(bonus)bonus.textContent=result.bonus[id] ? signed(result.bonus[id])+' от особенностей / перков' : 'Без постоянного бонуса';}
    const special=form.querySelector('[data-special-budget]');if(special)special.textContent=specialBudget(result);
    const skills=form.querySelector('[data-skill-budget]');if(skills)skills.textContent=skillBudget(result);
    const warnings=form.querySelector('[data-rules-warnings]');if(warnings)warnings.innerHTML=warningsMarkup(result);
    const equipment=document.getElementById('falloutSheetEquipment');
    if(equipment && (currentRoom() || !equipment.contains(document.activeElement))) {const markup=equipmentMarkup(sheet);if(equipment.innerHTML!==markup)equipment.innerHTML=markup;}
    const perkSection=document.getElementById('sheetPerks');
    if(perkSection && !perkSection.contains(document.activeElement)) {const open=!!perkSection.querySelector('.sheet-catalog[open]');perkSection.innerHTML=perkMarkup(sheet);if(open)perkSection.querySelector('.sheet-catalog')?.setAttribute('open','');}
  }
  document.addEventListener('input',event=>{
    const target=event.target;
    if(!target.closest('#falloutSheetForm'))return;
    if(target.matches('[data-sheet-field],[data-training],[data-health-current]') && target.type!=='checkbox')acceptField(target);
    if(target.hasAttribute('data-perk-search')) {perkSearch=target.value.slice(0,100);selectedPerk='';const preview=target.closest('.sheet-catalog')?.querySelector('.sheet-rule-preview');if(preview)preview.innerHTML='<p>Выбери перк, чтобы увидеть эффект и требования.</p>';const select=document.getElementById('sheet-perk-choice');if(select){select.innerHTML='<option value="">Выбери перк</option>'+RULES.PERKS.filter(perk=>!currentSheet().rules.perks.some(entry=>entry.id===perk.id) && (perk.name+' '+perk.description).toLocaleLowerCase('ru').includes(perkSearch.toLocaleLowerCase('ru'))).map(perk=>`<option value="${perk.id}">${escapeText(perk.name)} · ур. ${perk.level}</option>`).join('');}}
  });
  document.addEventListener('change',event=>{
    const target=event.target;
    if(!target.closest('#falloutSheetForm'))return;
    if(target.matches('[data-sheet-field]') && target.type==='checkbox')acceptField(target);
    if(target.hasAttribute('data-trait-choice')) {selectedTrait=target.value;refreshSelectors();document.getElementById('sheet-trait-choice')?.focus();}
    if(target.hasAttribute('data-perk-choice')) {selectedPerk=target.value;refreshSelectors();document.getElementById('sheetPerks')?.querySelector('.sheet-catalog')?.setAttribute('open','');document.getElementById('sheet-perk-choice')?.focus();}
    const meta=currentSheet().rules;
    if(!meta.traitsLocked && target.hasAttribute('data-thief-subtype')) {meta.thiefSubtype=target.value;updateSessionParts();scheduleSave();}
    if(!meta.traitsLocked && target.dataset.thiefSkill) {const id=target.dataset.thiefSkill;if(target.checked && !meta.thiefSkills.includes(id)){if(meta.thiefSkills.length>=2){target.checked=false;return;}meta.thiefSkills.push(id);}else if(!target.checked)meta.thiefSkills=meta.thiefSkills.filter(key=>key!==id);updateSessionParts();scheduleSave();}
  });
  document.addEventListener('click',event=>{
    const target=event.target.closest('[data-add-trait],[data-remove-trait],[data-add-perk],[data-remove-perk],[data-add-rank]');
    if(!target || !target.closest('#falloutSheetForm'))return;
    const sheet=currentSheet(),meta=sheet.rules,result=calculation(sheet);
    if(target.dataset.addTrait && !meta.traitsLocked && meta.traits.length<2 && RULES.TRAITS.some(trait=>trait.id===target.dataset.addTrait) && !meta.traits.includes(target.dataset.addTrait)){meta.traits.push(target.dataset.addTrait);selectedTrait='';}
    if(target.dataset.removeTrait && !meta.traitsLocked)meta.traits=meta.traits.filter(id=>id!==target.dataset.removeTrait);
    const used=meta.perks.reduce((sum,entry)=>sum+entry.rank,0),addId=target.dataset.addPerk || target.dataset.addRank;
    if(addId && used<result.perkBudget) {const perk=RULES.PERKS.find(entry=>entry.id===addId),existing=meta.perks.find(entry=>entry.id===addId);if(perk && !RULES.eligibility(perk,result,(existing?.rank || 0)+1).length){if(existing)existing.rank++;else meta.perks.push({id:addId,rank:1});selectedPerk='';}}
    if(target.dataset.removePerk){const existing=meta.perks.find(entry=>entry.id===target.dataset.removePerk);if(existing && existing.rank>1)existing.rank--;else meta.perks=meta.perks.filter(entry=>entry.id!==target.dataset.removePerk);}
    applyCalculated(sheet);refreshSelectors();updateSessionParts();scheduleSave();
  });
  document.addEventListener('submit',event=>{
    if(event.target.id!=='falloutSheetForm')return;
    event.preventDefault();
    const sheet=currentSheet();
    if(sheet.rules.traits.includes('thief') && (!sheet.rules.thiefSubtype || sheet.rules.thiefSkills.length!==2)) {if(typeof toast==='function')toast('Для «Вора» выбери подтип и два навыка.');return;}
    persist(true);
  });
  window.addEventListener('niti:session-update',event=>{rememberedRoom=event.detail?.room?.self ? event.detail.room : null;updateSessionParts();});
  window.addEventListener('pagehide',()=>{if(saveTimer)persist();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden && saveTimer)persist();});
  window.playerRulesEffectivePerception=()=>calculation().special.P;
  window.playerSheetPage = page;
  window.playerSheetValid = validSheet;
  window.playerSheetNormalize = normalizeSheet;
  window.playerSheetRefresh = updateSessionParts;
})();
