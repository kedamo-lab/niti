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
    ['barter', 'Торговля'], ['gambling', 'Азартные игры'], ['outdoorsman', 'Скиталец'], ['scavenging', 'Скважинг']
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
  const PORTRAIT_LIMIT = 32000;
  let portraitBusy = false, portraitMessage = '', portraitError = false, portraitEpoch = 0;
  let saveTimer = 0;
  let selectedTrait = '';
  let selectedPerk = '';
  let perkSearch = '';
  let perkDialogSearch = '';
  let perkDialogAvailableOnly = true;
  let perkDialogSelection = '';
  let promptTimer = 0;
  let progressSignature = '';
  let specialChoice = '';
  const SPECIAL_PROMPT_PREFIX = 'niti-player-special-prompt-v1:';
  const SPECIAL_DESCRIPTIONS = {S:'Физическая сила и требования снаряжения.',P:'Наблюдательность, инициатива и дальность стрельбы.',E:'Выносливость и максимальное здоровье.',C:'Обаяние и общение с окружающими.',I:'Сообразительность, знания и рассуждения.',A:'Ловкость, очки действия и защита.',L:'Удача и случайные события.'};

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
  function validPortrait(value) {
    return typeof value==='string' && (value==='' || (value.length<=PORTRAIT_LIMIT && /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)));
  }
  function validSheet(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value) && value.version === 1
      && Object.keys(value).every(name => name === 'version' || name === 'rules' || name === 'portrait' || FIELD_SET.has(name))
      && FIELD_NAMES.every(name => ['tag_scavenging','skill_scavenging'].includes(name) && !Object.hasOwn(value,name) ? true : TAG_FIELDS.has(name) ? typeof value[name] === 'boolean' : typeof value[name] === 'string' && value[name].length <= limitFor(name))
      && (!Object.hasOwn(value, 'portrait') || validPortrait(value.portrait))
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
    result.portrait = validPortrait(value?.portrait) ? value.portrait : '';
    result.rules = RULES.normalizeMeta(value?.rules, result);
    return result;
  }
  function currentSheet() {
    if (typeof player === 'undefined') return normalizeSheet(null, null);
    if (!validSheet(player.sheet) || !player.sheet.rules || !Object.hasOwn(player.sheet,'tag_scavenging') || !Object.hasOwn(player.sheet,'skill_scavenging') || !Object.hasOwn(player.sheet.rules.training || {},'scavenging')) player.sheet = normalizeSheet(player.sheet, player.profile);
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
    const sessionXP=room?.self ? room.self.xp || 0 : sheet.rules?.progress?.sessionXP || 0;
    return RULES.calculate(sheet, {sessionXP, armor});
  }
  function allocationState(sheet=currentSheet(), result=calculation(sheet)) {
    const invalidFields=SPECIAL_ROWS.filter(([letter])=>!Number.isInteger(result.base[letter]) || result.base[letter]<0 || result.base[letter]>10).map(([,name])=>name);
    const points=result.points,budget=result.specialBudget,available=Math.max(0,budget-points),growth=Math.max(0,budget-40);
    const error=invalidFields.length ? 'Каждая базовая характеристика S.P.E.C.I.A.L. должна быть целым числом от 0 до 10.' : points>budget ? `Распределено ${points} из ${budget} доступных очков S.P.E.C.I.A.L. Уменьши базовые характеристики на ${points-budget}.` : '';
    return {valid:!error,invalidFields,points,budget,available,error,growthAvailable:Math.max(0,growth-Math.max(0,points-40)),creationAvailable:Math.max(0,40-points)};
  }
  function showAllocationValidation(sheet=currentSheet(), result=calculation(sheet), focus=false) {
    const allocation=allocationState(sheet,result),form=document.getElementById('falloutSheetForm');
    if(!form)return allocation;
    form.classList.toggle('has-invalid-special',!allocation.valid);
    for(const [,name] of SPECIAL_ROWS) {
      const input=document.getElementById('sheet-'+name),invalid=allocation.invalidFields.includes(name);
      if(input) {input.setAttribute('aria-invalid',String(invalid));input.setAttribute('aria-describedby','sheetSpecialAllocationError');input.closest('.sheet-special')?.classList.toggle('is-invalid',invalid);}
    }
    const panel=form.querySelector('[data-special-allocation]');
    if(panel) {const signature=JSON.stringify([allocation.points,allocation.budget,allocation.invalidFields]);if(panel.dataset.allocationSignature!==signature){panel.outerHTML=allocationMarkup(sheet,result);form.querySelector('[data-special-allocation]').dataset.allocationSignature=signature;}}
    const submit=form.querySelector('button[type="submit"]');
    if(submit) {submit.disabled=!allocation.valid;submit.title=allocation.error;}
    const status=document.getElementById('falloutSheetSaveStatus');
    if(status && !allocation.valid)status.textContent='Анкета не сохранена. '+allocation.error;
    if(focus && !allocation.valid)document.getElementById('sheet-'+(allocation.invalidFields[0] || SPECIAL_ROWS[0][1]))?.focus();
    return allocation;
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
    const result = calculation(sheet);
    const allocation=showAllocationValidation(sheet,result,showNotice);
    if(!allocation.valid) {if(showNotice && typeof toast==='function')toast(allocation.error);return false;}
    applyCalculated(sheet,result);
    updateLegacyProfile(sheet, result);
    const previousLock = sheet.rules.traitsLocked;
    if (showNotice) sheet.rules.traitsLocked = true;
    const success = typeof save === 'function' ? save() : false;
    if (!success) sheet.rules.traitsLocked = previousLock;
    const status = document.getElementById('falloutSheetSaveStatus');
    if (status) status.textContent = success ? (showNotice ? 'Анкета сохранена. Особенности закреплены на всю игру.' : 'Анкета сохранена в этом браузере.') : 'Не удалось сохранить. Скачай резервную копию.';
    if (showNotice && typeof toast === 'function') toast(success ? 'Анкета сохранена. Особенности закреплены.' : 'Браузер не сохранил анкету. Скачай копию данных.');
    if (showNotice && success) refreshSelectors();
    if (success) syncCharacter(sheet, result);
    return success;
  }
  function syncCharacter(sheet=currentSheet(), result=calculation(sheet)) {
    if (!allocationState(sheet,result).valid || typeof window.playerSessionSyncCharacter!=='function') return;
    Promise.resolve(window.playerSessionSyncCharacter({name:sheet.name,baseXP:result.manualXP,beacon:sheet.rules.traits.includes('beacon')})).catch(()=>{});
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
    return `<small>До сессии: ${result.manualXP} · получено: +${result.serverXP}${result.earnedXP !== result.serverXP ? ` → +${result.earnedXP} («Светоч»)` : ''}<br>${result.nextXP ? `До следующего уровня: <b>${Math.max(0,result.nextXP-result.totalXP)} XP</b>` : 'Достигнут конец таблицы (15-й уровень)'}${!currentRoom() && sheet.rules.progress?.sessionXP ? '<br>Последний полученный опыт сохранён для работы без связи.' : ''}</small>`;
  }
  function experienceMarkup(sheet,result=calculation(sheet)) {
    return `<div class="sheet-field sheet-xp-field"><label for="sheet-experience-total">Опыт · всего</label><input class="input sheet-xp-total" id="sheet-experience-total" value="${result.totalXP}" readonly aria-readonly="true" aria-describedby="sheet-xp-help"><span class="sheet-xp-breakdown" id="sheet-xp-help" data-sheet-xp>${xpBreakdown(sheet)}</span><details class="sheet-xp-baseline"><summary>Опыт до сессии</summary>${field('experience','Уже заработано до подключения',sheet,{numeric:true})}<small>Награды ведущего добавляются автоматически. Повторно вписывать их сюда не нужно.</small></details></div>`;
  }
  function sectionTitle(title, extra = '') { return `<div class="sheet-section-title"><h2>${title}</h2>${extra}</div>`; }
  function specialMarkup(sheet) {
    const result = calculation(sheet);
    return `<section class="sheet-special-column" aria-label="S.P.E.C.I.A.L.">${SPECIAL_ROWS.map(([letter, name, label]) => `<div class="sheet-special"><span class="sheet-special-letter" aria-hidden="true">${letter}</span><label for="sheet-${name}"><span>${label} · база</span><input class="input sheet-special-input" type="text" inputmode="numeric" maxlength="40" id="sheet-${name}" name="${name}" data-sheet-field="${name}" value="${escapeText(sheet[name])}"></label><output class="sheet-special-effective" data-special-effective="${letter}" aria-label="${label}: значение с бонусами">${result.special[letter]}</output><input class="input sheet-special-mod" readonly aria-readonly="true" id="sheet-${name}_modifier" aria-label="${label}: автоматический модификатор" data-special-mod="${letter}" value="${signed(result.modifiers[letter])}"></div>`).join('')}${allocationMarkup(sheet,result)}<p class="sheet-special-hint" data-special-budget>${specialBudget(result)}</p></section>`;
  }
  function allocationMarkup(sheet=currentSheet(),result=calculation(sheet)) {
    const allocation=allocationState(sheet,result);
    return `<section class="sheet-special-allocation ${allocation.valid ? '' : 'is-invalid'}" data-special-allocation aria-label="Бюджет S.P.E.C.I.A.L."><span>РАСПРЕДЕЛЕНО</span><strong>${allocation.points} <small>/ ${allocation.budget}</small></strong><p>${allocation.valid ? `Свободно: <b>${allocation.available}</b>${allocation.growthAvailable ? ` · за уровни: <b>${allocation.growthAvailable}</b>` : ''}.` : 'Превышение бюджета или неверное значение.'}</p><p id="sheetSpecialAllocationError" class="sheet-special-allocation-error" data-special-allocation-error role="status">${escapeText(allocation.error)}</p>${allocation.valid && allocation.available ? '<button type="button" class="button primary small" data-sheet-special-action="choose">Распределить +1 ↗</button>' : ''}<small>40 начальных очков. На уровнях 4, 8 и 12 добавляется по одному. Бонусы особенностей и перков в этот бюджет не входят.</small></section>`;
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
    return `${sectionTitle('Перки',`<span>${used} / ${result.perkBudget} РАНГОВ</span>`)}<p class="sheet-rules-help">По 1 перку каждые 3 уровня. Требования, число рангов и эффекты — из приложенного списка перков.</p><div class="sheet-selected-list">${meta.perks.map(entry=>{const perk=RULES.PERKS.find(p=>p.id===entry.id);return `<article class="sheet-rule-card"><div><strong>${escapeText(perk.name)} · ${entry.rank}/${perk.ranks.max}</strong><small class="sheet-perk-locked">Ранг закреплён</small></div><p>${escapeText(perk.description)}</p><small>${escapeText(perk.requirements.text || '')}</small>${entry.rank<perk.ranks.max && used<result.perkBudget && !RULES.eligibility(perk,result,entry.rank+1).length ? `<button type="button" class="sheet-rule-rank" data-add-rank="${entry.id}">Добавить ранг +</button>` : ''}</article>`;}).join('') || '<p class="sheet-rules-help">Перки пока не выбраны.</p>'}</div><details class="sheet-catalog"><summary>Каталог перков · ${RULES.PERKS.length}</summary><label class="sheet-field" for="sheet-perk-search"><span>Поиск по названию и эффекту</span><input class="input" id="sheet-perk-search" data-perk-search value="${escapeText(perkSearch)}" placeholder="Например, ловкость"></label><label class="sheet-field" for="sheet-perk-choice"><span>Перк из правил</span><select class="input" id="sheet-perk-choice" data-perk-choice><option value="">Выбери перк</option>${available.map(perk=>`<option value="${perk.id}" ${perk.id===selectedPerk?'selected':''}>${escapeText(perk.name)} · ур. ${perk.level}</option>`).join('')}</select></label><div class="sheet-rule-preview" aria-live="polite">${preview ? `<p>${escapeText(preview.description)}</p><p><strong>Требования:</strong> ${escapeText(preview.requirements.text || 'Без дополнительных требований')}<br>Уровень ${preview.level}; рангов: ${preview.ranks.max}${preview.ranks.note ? ' · '+escapeText(preview.ranks.note) : ''}</p>${previewReasons.length ? `<p class="sheet-warning">Недоступен: ${previewReasons.map(escapeText).join(', ')}.</p>` : ''}${used>=result.perkBudget ? '<p>Свободных рангов нет. Следующий — на уровне '+(3*(result.perkBudget+1))+'.</p>' : ''}<button class="button" type="button" data-add-perk="${preview.id}" ${previewReasons.length || used>=result.perkBudget ? 'disabled' : ''}>Выбрать перк +</button>` : '<p>Выбери перк, чтобы увидеть эффект и требования.</p>'}</div></details>${field('perks','Личные записи о перках',sheet,{multiline:true,rows:3})}<p class="sheet-rules-help">Постоянные числовые бонусы учтены автоматически. Условные эффекты, преимущество, урон и боевые действия применяются по описанию.</p>`;
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
  function progression(sheet=currentSheet()) {
    if (!sheet.rules.progress) sheet.rules.progress=RULES.normalizeMeta(sheet.rules,sheet).progress;
    return sheet.rules.progress;
  }
  const specialPrompts = new Map();
  function specialPromptKey(sheet=currentSheet()) {return SPECIAL_PROMPT_PREFIX+encodeURIComponent(progression(sheet).characterKey || 'local');}
  function promptedSpecialBudget(sheet=currentSheet()) {
    const key=specialPromptKey(sheet);
    try {const value=Number(localStorage.getItem(key));if(Number.isInteger(value) && value>=0)return Math.max(specialPrompts.get(key) || 0,value);}catch {}
    return specialPrompts.get(key) || 0;
  }
  function rememberSpecialPrompt(sheet,result=calculation(sheet)) {
    const key=specialPromptKey(sheet),budget=Math.floor(result.level/4);
    specialPrompts.set(key,Math.max(promptedSpecialBudget(sheet),budget));
    try {localStorage.setItem(key,String(specialPrompts.get(key)));}catch {}
  }
  function specialOptions(result=calculation()) {
    return SPECIAL_ROWS.map(([letter,name,label])=>({letter,name,label,base:result.base[letter],effective:result.special[letter],reason:result.base[letter]>=10 ? 'Базовое значение уже 10.' : result.special[letter]>=10 ? 'Итог уже 10: бонусы особенностей и перков заполняют предел.' : ''}));
  }
  function refreshSpecialDialog() {
    const dialog=document.querySelector('[data-sheet-special-dialog]');
    if(!dialog)return;
    const sheet=currentSheet(),result=calculation(sheet),allocation=allocationState(sheet,result),options=specialOptions(result);
    dialog.querySelector('[data-special-dialog-count]').textContent=String(allocation.available);
    dialog.querySelector('[data-special-dialog-help]').textContent=(allocation.creationAvailable ? `Осталось начальных очков: ${allocation.creationAvailable}. ` : '')+`Очков за уровни: ${allocation.growthAvailable}. Нераспределённые очки сохраняются.`;
    const signature=JSON.stringify([specialChoice,result.base,result.special,allocation.budget,allocation.valid]);
    if(dialog.dataset.specialChoicesSignature!==signature) {
      const focused=document.activeElement?.dataset.specialChoice;
      dialog.querySelector('[data-special-dialog-choices]').innerHTML=options.map(option=>`<button type="button" class="sheet-special-choice ${specialChoice===option.letter ? 'is-selected' : ''}" data-special-choice="${option.letter}" aria-pressed="${specialChoice===option.letter}" ${option.reason || !allocation.valid || !allocation.available ? 'disabled' : ''}><span class="sheet-special-choice-letter">${option.letter}</span><span><strong>${option.label}</strong><small>База ${option.base} → ${Math.min(10,(option.base || 0)+1)} · итог ${option.effective}${option.reason ? '' : ' → '+calculation({...sheet,[option.name]:String(option.base+1)}).special[option.letter]}</small><span>${escapeText(option.reason || SPECIAL_DESCRIPTIONS[option.letter])}</span></span></button>`).join('');
      dialog.dataset.specialChoicesSignature=signature;
      if(focused)dialog.querySelector(`[data-special-choice="${focused}"]:not(:disabled)`)?.focus();
    }
    const selected=options.find(option=>option.letter===specialChoice),error=dialog.querySelector('[data-special-dialog-error]');
    error.textContent=allocation.error || (!allocation.available ? 'Все доступные очки уже распределены.' : '');
    const submit=document.querySelector('#dialogForm button[type="submit"]');
    if(submit) {submit.disabled=!allocation.valid || !allocation.available || !selected || !!selected.reason;submit.textContent=selected ? '+1 · '+selected.label : 'Выбери характеристику';}
  }
  function confirmSpecialChoice() {
    const sheet=currentSheet(),result=calculation(sheet),allocation=allocationState(sheet,result),option=specialOptions(result).find(entry=>entry.letter===specialChoice);
    if(!allocation.valid || !allocation.available || !option || option.reason) {refreshSpecialDialog();return;}
    const previous=sheet[option.name];
    sheet[option.name]=String(option.base+1);
    if(!persist()) {sheet[option.name]=previous;applyCalculated(sheet);updateLegacyProfile(sheet);const feedback=document.querySelector('[data-special-dialog-error]');if(feedback)feedback.textContent='Не удалось сохранить повышение. Очко не потрачено; попробуй ещё раз.';return;}
    const input=document.getElementById('sheet-'+option.name);if(input)input.value=sheet[option.name];
    specialChoice='';refreshSelectors();updateSessionParts();
    if(!allocationState().available) {if(typeof closeModal==='function')closeModal();if(typeof toast==='function')toast(option.label+' увеличена на 1. Анкета пересчитана.');clearTimeout(promptTimer);promptTimer=setTimeout(()=>maybePromptPerk(),120);}
    else refreshSpecialDialog();
  }
  function openSpecialDialog() {
    const sheet=currentSheet(),result=calculation(sheet),allocation=allocationState(sheet,result);
    if(!allocation.valid || !allocation.available || !document.getElementById('falloutSheetForm') || typeof modal!=='function' || document.getElementById('modalRoot')?.children.length)return false;
    rememberSpecialPrompt(sheet,result);specialChoice='';
    modal('Распредели S.P.E.C.I.A.L.',`<div class="sheet-special-dialog" data-sheet-special-dialog><p>Доступно очков: <strong data-special-dialog-count>${allocation.available}</strong>. Выбери, какую базовую характеристику увеличить на 1. Итог и связанные показатели пересчитаются автоматически.</p><p class="sheet-rules-help" data-special-dialog-help></p><div class="sheet-special-choices" data-special-dialog-choices></div><p class="sheet-special-dialog-error" data-special-dialog-error role="status"></p></div>`,confirmSpecialChoice);
    document.querySelector('#modalRoot .modal')?.classList.add('sheet-special-modal');
    const later=document.querySelector('#modalRoot .modal-footer [data-player-action="close-modal"]');if(later)later.textContent='Распределить позже';
    refreshSpecialDialog();
    document.querySelector('[data-special-choice]:not(:disabled)')?.focus();
    return true;
  }
  function maybePromptSpecial() {
    const sheet=currentSheet(),result=calculation(sheet),allocation=allocationState(sheet,result);
    if(allocation.valid && allocation.growthAvailable>0 && Math.floor(result.level/4)>promptedSpecialBudget(sheet))return openSpecialDialog();
    return false;
  }
  function freePerks(result=calculation()) {
    return Math.max(0,result.perkBudget-result.meta.perks.reduce((sum,entry)=>sum+entry.rank,0));
  }
  function progressMarkup(sheet=currentSheet(),result=calculation(sheet)) {
    const progress=progression(sheet),available=freePerks(result);
    return `<div class="sheet-advancement ${available ? 'has-perks' : ''}" data-sheet-advancement><div><span class="eyebrow">РАЗВИТИЕ ПЕРСОНАЖА</span><strong>Уровень ${result.level}${available ? ` · свободных перков: ${available}` : ''}</strong><p>${available ? 'Выбери перк с описанием и проверкой требований. Выбор можно отложить.' : 'Следующий выбор перка — на уровне '+(3*(result.perkBudget+1))+'. Новые очки навыков и S.P.E.C.I.A.L. доступны в анкете.'}</p></div>${available ? '<button type="button" class="button primary" data-sheet-progress-action="choose-perk">Выбрать перк ↗</button>' : ''}${progress.observedLevel>progress.acknowledgedLevel ? '<button type="button" class="button ghost small" data-sheet-progress-action="acknowledge">Повышение прочитано ✓</button>' : ''}</div>`;
  }
  function mountLevelNotice(sheet=currentSheet()) {
    const progress=progression(sheet),unread=progress.observedLevel>progress.acknowledgedLevel;
    let notice=document.getElementById('sheetProgressNotice');
    if(!unread) {notice?.remove();return;}
    if(!notice) {notice=document.createElement('aside');notice.id='sheetProgressNotice';notice.className='sheet-progress-notice';notice.setAttribute('role','status');notice.setAttribute('aria-label','Повышение уровня');document.body.append(notice);}
    const markup=`<div><span>УРОВЕНЬ ПОВЫШЕН</span><strong>Теперь уровень ${progress.observedLevel}</strong><p>Анкета и доступные очки пересчитаны.</p></div><div><button type="button" class="button primary small" data-sheet-progress-action="open-sheet">Открыть анкету ↗</button><button type="button" class="button ghost small" data-sheet-progress-action="acknowledge" aria-label="Закрыть уведомление о повышении уровня">Понятно ✓</button></div>`;
    if(notice.innerHTML!==markup)notice.innerHTML=markup;
  }
  function processProgress() {
    if(typeof player==='undefined') return;
    const sheet=currentSheet(),before=JSON.stringify(sheet),room=currentRoom(),progress=progression(sheet);
    const key=room?.self ? room.id+':'+room.self.id : progress.characterKey || 'local';
    if(progress.characterKey!==key) {
      const initialLevel=RULES.levelForXP(Math.max(0,RULES.integer(sheet.experience) || 0));
      Object.assign(progress,{characterKey:key,sessionXP:0,observedLevel:initialLevel,acknowledgedLevel:initialLevel,perkPromptBudget:0});
    }
    if(room?.self && Number.isSafeInteger(room.self.xp) && room.self.xp>=0)progress.sessionXP=room.self.xp;
    const result=applyCalculated(sheet);
    updateLegacyProfile(sheet,result);
    if(result.level>progress.observedLevel) {
      window.dispatchEvent(new CustomEvent('niti:level-up',{detail:{characterKey:key,level:result.level,previousLevel:progress.observedLevel}}));
      progress.observedLevel=result.level;
      if(typeof toast==='function')toast(`Новый уровень: ${result.level}!${freePerks(result) ? ' Доступен выбор перка.' : ' Анкета пересчитана.'}`);
    } else if(result.level<progress.observedLevel) {
      // Correcting starting XP or an unlocked trait must not leave a stale notice.
      progress.observedLevel=result.level;
      progress.acknowledgedLevel=Math.min(progress.acknowledgedLevel,result.level);
      progress.perkPromptBudget=Math.min(progress.perkPromptBudget,result.perkBudget);
    }
    if(before!==JSON.stringify(sheet) && typeof save==='function')save();
    mountLevelNotice(sheet);
    if(room?.self)syncCharacter(sheet,result);
    const signature=key+':'+result.level+':'+freePerks(result)+':'+progress.perkPromptBudget;
    if(signature!==progressSignature) {progressSignature=signature;clearTimeout(promptTimer);promptTimer=setTimeout(()=>maybePromptPerk(),120);}
    return result;
  }
  function perkOptions(result=calculation()) {
    return RULES.PERKS.map(perk=>{
      const selected=result.meta.perks.find(entry=>entry.id===perk.id),rank=(selected?.rank || 0)+1;
      return {perk,rank,reasons:RULES.eligibility(perk,result,rank)};
    }).filter(option=>option.rank<=option.perk.ranks.max).sort((a,b)=>Number(a.reasons.length>0)-Number(b.reasons.length>0) || a.perk.level-b.perk.level || a.perk.name.localeCompare(b.perk.name,'ru'));
  }
  function refreshPerkDialog() {
    const dialog=document.querySelector('[data-sheet-perk-dialog]');if(!dialog)return;
    const result=calculation(),query=perkDialogSearch.toLocaleLowerCase('ru'),all=perkOptions(result);
    const options=all.filter(option=>(!perkDialogAvailableOnly || !option.reasons.length) && (!query || (option.perk.name+' '+option.perk.description).toLocaleLowerCase('ru').includes(query)));
    const list=dialog.querySelector('[data-perk-dialog-list]');
    list.innerHTML=options.map(({perk,rank,reasons})=>`<button type="button" class="sheet-perk-option ${perkDialogSelection===perk.id ? 'is-selected' : ''}" data-perk-dialog-select="${perk.id}" aria-pressed="${perkDialogSelection===perk.id}"><strong>${escapeText(perk.name)}${rank>1 ? ' · ранг '+rank : ''}</strong><small>Уровень ${perk.level} · ${reasons.length ? 'Требования не выполнены' : 'Доступен'}</small></button>`).join('') || '<p class="sheet-rules-help">По этим условиям перков нет. Измени поиск или покажи все перки, чтобы посмотреть требования.</p>';
    const selected=all.find(option=>option.perk.id===perkDialogSelection),preview=dialog.querySelector('[data-perk-dialog-preview]');
    preview.innerHTML=selected ? `<span class="eyebrow">ПЕРК · РАНГ ${selected.rank} ИЗ ${selected.perk.ranks.max}</span><h3>${escapeText(selected.perk.name)}</h3><p>${escapeText(selected.perk.description)}</p><div class="sheet-perk-requirements"><strong>Требования</strong><p>Уровень ${selected.perk.level}${selected.perk.requirements.text ? '\n'+escapeText(selected.perk.requirements.text) : '\nБез дополнительных требований'}</p>${selected.reasons.length ? `<p class="sheet-warning">Пока недоступен: ${selected.reasons.map(escapeText).join(', ')}.</p>` : '<p class="sheet-perk-eligible">Все требования выполнены ✓</p>'}</div>` : '<div class="sheet-perk-preview-empty"><span aria-hidden="true">✦</span><h3>Твоя новая возможность</h3><p>Выбери перк в списке. Здесь появятся полное описание, требования и доступный ранг.</p></div>';
    const count=dialog.querySelector('[data-perk-dialog-count]');if(count)count.textContent=freePerks(result);
    const submit=document.querySelector('#dialogForm button[type="submit"]');if(submit){submit.textContent=selected ? 'Выбрать «'+selected.perk.name+'»' : 'Выбрать перк';submit.disabled=!selected || !!selected.reasons.length || !freePerks(result);}
  }
  function confirmDialogPerk() {
    const sheet=currentSheet(),result=calculation(sheet),option=perkOptions(result).find(entry=>entry.perk.id===perkDialogSelection);
    const allocation=allocationState(sheet,result);
    if(!allocation.valid) {showAllocationValidation(sheet,result);if(typeof toast==='function')toast(allocation.error);return;}
    if(!option || option.reasons.length || !freePerks(result))return;
    const previous=sheet.rules.perks.map(entry=>({...entry}));
    const selected=sheet.rules.perks.find(entry=>entry.id===option.perk.id);
    if(selected)selected.rank++;else sheet.rules.perks.push({id:option.perk.id,rank:1});
    applyCalculated(sheet);
    if(!persist()) {sheet.rules.perks=previous;applyCalculated(sheet);updateLegacyProfile(sheet);const feedback=document.querySelector('[data-perk-dialog-error]');if(feedback)feedback.textContent='Не удалось сохранить выбор. Перк не закреплён; попробуй ещё раз.';refreshPerkDialog();return;}
    refreshSelectors();updateSessionParts();
    if(!freePerks()) {if(typeof closeModal==='function')closeModal();if(typeof toast==='function')toast('Перк выбран. Постоянные бонусы внесены в анкету.');}
    else {perkDialogSelection='';refreshPerkDialog();}
  }
  function openPerkDialog() {
    const sheet=currentSheet(),result=calculation(sheet);
    if(!freePerks(result) || !document.getElementById('falloutSheetForm') || typeof modal!=='function' || document.getElementById('modalRoot')?.children.length)return;
    progression(sheet).perkPromptBudget=Math.max(progression(sheet).perkPromptBudget,result.perkBudget);
    if(typeof save==='function')save();
    perkDialogSearch='';perkDialogAvailableOnly=true;perkDialogSelection='';
    modal('Выбери новый перк',`<div class="sheet-perk-dialog" data-sheet-perk-dialog><p class="sheet-perk-dialog-intro">Уровень ${result.level}. Доступно выборов: <strong data-perk-dialog-count>${freePerks(result)}</strong>. Каждый выбор даёт один ранг перка. Можно выбрать позже — очки сохранятся.</p><div class="sheet-perk-dialog-filters"><label for="perk-dialog-search">Поиск по названию и описанию<input class="input" id="perk-dialog-search" data-perk-dialog-search placeholder="Например, лечение" maxlength="100"></label><label><input type="checkbox" data-perk-dialog-available checked>Только доступные</label></div><div class="sheet-perk-dialog-grid"><div class="sheet-perk-option-list" data-perk-dialog-list aria-label="Список перков"></div><article class="sheet-perk-dialog-preview" data-perk-dialog-preview aria-live="polite"></article></div><p class="sheet-special-dialog-error" data-perk-dialog-error role="status"></p></div>`,confirmDialogPerk);
    document.querySelector('#modalRoot .modal')?.classList.add('sheet-advancement-modal');
    const later=document.querySelector('#modalRoot .modal-footer [data-player-action="close-modal"]');if(later)later.textContent='Выбрать позже';
    refreshPerkDialog();
    document.getElementById('perk-dialog-search')?.focus();
  }
  function maybePromptPerk() {
    if(!document.getElementById('falloutSheetForm'))return;
    if(document.getElementById('modalRoot')?.children.length) {
      const allocation=allocationState(),growth=Math.floor(calculation().level/4);
      if(!document.querySelector('[data-sheet-perk-dialog]') || (allocation.valid && allocation.growthAvailable>0 && growth>promptedSpecialBudget()))promptTimer=setTimeout(()=>maybePromptPerk(),400);
      return;
    }
    if(maybePromptSpecial())return;
    const result=calculation(),progress=progression();
    if(freePerks(result) && result.perkBudget>progress.perkPromptBudget)openPerkDialog();
  }
  function confirmDeleteCharacter() {
    if(typeof modal!=='function' || typeof window.playerDeleteCharacter!=='function')return;
    const room=currentRoom();
    modal('Удалить персонажа?',`<p>Анкета <strong>${escapeText(currentSheet().name || room?.self?.name || 'этого персонажа')}</strong> будет удалена.${room ? ' Персонаж также исчезнет из списка участников, а его вещи вернутся в общий тайник.' : ''}</p><p>Личные заметки останутся. Чтобы сохранить анкету, сначала скачай резервную копию.</p><p class="sheet-delete-feedback" data-sheet-delete-feedback role="status"></p>`,async()=>{
      const submit=document.querySelector('#dialogForm button[type="submit"]');if(submit)submit.disabled=true;
      const feedback=document.querySelector('[data-sheet-delete-feedback]');
      try {await window.playerDeleteCharacter();if(typeof closeModal==='function')closeModal();}
      catch(error) {if(feedback)feedback.textContent=error.message || 'Не удалось удалить персонажа. Попробуй ещё раз.';if(submit)submit.disabled=false;}
    });
    const submit=document.querySelector('#dialogForm button[type="submit"]');if(submit){submit.textContent='Удалить персонажа';submit.classList.add('danger');submit.classList.remove('primary');}
  }
  function portraitMarkup(sheet=currentSheet()) {
    const image=validPortrait(sheet.portrait) ? sheet.portrait : '';
    return `<div class="sheet-portrait-frame ${image ? 'has-portrait' : ''}" aria-label="Арт персонажа, пропорции 10 на 15">${image ? `<img src="${escapeText(image)}" alt="Арт персонажа${sheet.name ? ': '+escapeText(sheet.name) : ''}" draggable="false">` : '<svg viewBox="0 0 80 100" fill="none" stroke="currentColor" aria-hidden="true"><path d="M7 7h66v86H7zM7 22h66M7 79h66M17 14h20m20 0h6"/><circle cx="40" cy="43" r="12"/><path d="M20 76v-4a20 20 0 0 1 40 0v4"/></svg><span>ЛИЧНОЕ ДЕЛО</span>'}<span class="sheet-portrait-format" aria-hidden="true">10 × 15</span></div><div class="sheet-portrait-copy"><span class="eyebrow">ФОТОАРХИВ · 2207</span><h2>Лицо твоей истории</h2><p>Добавь фото, арт или рисунок персонажа. Изображение целиком впишется в рамку 10×15.</p><div class="sheet-portrait-actions"><button type="button" class="button primary small" data-sheet-portrait-action="choose" ${portraitBusy ? 'disabled' : ''}>${portraitBusy ? 'Подготовка арта…' : image ? 'Заменить арт' : 'Добавить арт'}</button><button type="button" class="button ghost small" data-sheet-portrait-action="remove" ${!image || portraitBusy ? 'disabled' : ''}>Удалить арт</button></div><input class="sheet-portrait-file" id="sheetPortraitFile" type="file" accept="image/jpeg,image/png,image/webp" aria-label="Выбрать фото или арт персонажа"><small>JPG, PNG или WebP · до 12 МБ. Портрет увидит твой отряд.</small><p class="sheet-portrait-status ${portraitError ? 'is-error' : ''}" role="status" aria-live="polite">${escapeText(portraitMessage || 'Рамка сохраняет размер: поля анкеты остаются на своих местах.')}</p></div>`;
  }
  function refreshPortrait() {
    const panel=document.querySelector('[data-sheet-portrait]');
    if(panel)panel.innerHTML=portraitMarkup();
  }
  function publicPersona(sheet) {
    if(!sheet) {
      const accepted=window.playerAcceptedCharacter?.();
      sheet=accepted?.sheet || normalizeSheet(null,accepted?.profile || {});
    }
    return {name:String(sheet.name || '').trim().slice(0,80),age:String(sheet.age || '').trim().slice(0,40),gender:String(sheet.gender || '').trim().slice(0,80),portrait:validPortrait(sheet.portrait) ? sheet.portrait : ''};
  }
  function portraitContext() {
    const room=currentRoom();
    return room?.self ? room.id+':'+room.self.id : 'local';
  }
  async function preparePortrait(file) {
    if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('Выбери изображение JPG, PNG или WebP.');
    if(!file.size || file.size>12*1024*1024)throw new Error('Изображение должно быть не больше 12 МБ.');
    const bytes=new Uint8Array(await file.slice(0,16).arrayBuffer());
    const png=[137,80,78,71,13,10,26,10].every((value,index)=>bytes[index]===value),jpeg=bytes[0]===255 && bytes[1]===216 && bytes[2]===255,webp=String.fromCharCode(...bytes.slice(0,4))==='RIFF' && String.fromCharCode(...bytes.slice(8,12))==='WEBP';
    if(!png && !jpeg && !webp)throw new Error('Файл не похож на изображение JPG, PNG или WebP.');
    let image,url='';
    try {
      if(typeof createImageBitmap==='function')image=await createImageBitmap(file,{imageOrientation:'from-image'});
      else {url=URL.createObjectURL(file);image=new Image();image.src=url;await image.decode();}
      const width=image.width || image.naturalWidth,height=image.height || image.naturalHeight;
      if(!width || !height || width>16000 || height>16000 || width*height>48000000)throw new Error('Выбери изображение размером до 48 мегапикселей.');
      const canvas=document.createElement('canvas'),context=canvas.getContext('2d');
      if(!context)throw new Error('Браузер не может подготовить изображение.');
      for(const size of [[480,720],[400,600],[320,480],[240,360],[180,270]]) {
        const scale=Math.min(1,size[0]/width,size[1]/height);
        canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));
        context.clearRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);
        for(const quality of [.82,.72,.62,.52]) {
          const data=canvas.toDataURL('image/webp',quality);
          if(validPortrait(data))return data;
        }
      }
      throw new Error('Не удалось уменьшить изображение. Выбери другой файл или уменьши его размер.');
    } finally {image?.close?.();if(url)URL.revokeObjectURL(url);}
  }
  async function setPortraitFile(file) {
    const epoch=++portraitEpoch,identity=portraitContext();
    portraitBusy=true;portraitMessage='Подготавливаю изображение…';portraitError=false;refreshPortrait();
    try {
      const data=await preparePortrait(file);
      if(epoch!==portraitEpoch || identity!==portraitContext())return;
      if(typeof window.playerSetPortrait!=='function')throw new Error('Сохранение арта пока недоступно. Обнови терминал.');
      const result=await window.playerSetPortrait(data);
      if(result?.saved!==true)throw new Error(result?.error || 'Не удалось сохранить арт в браузере. Попробуй ещё раз.');
      portraitMessage='Арт сохранён. Он появится в карточке отряда.';
    } catch(error) {if(epoch===portraitEpoch){portraitMessage=error?.message || 'Не удалось открыть изображение.';portraitError=true;}}
    finally {if(epoch===portraitEpoch){portraitBusy=false;refreshPortrait();}}
  }
  document.addEventListener('click',async event=>{
    const action=event.target.closest('[data-sheet-portrait-action]')?.dataset.sheetPortraitAction;
    if(!action || portraitBusy)return;
    if(action==='choose')document.getElementById('sheetPortraitFile')?.click();
    if(action==='remove') {
      const epoch=++portraitEpoch;portraitBusy=true;portraitError=false;refreshPortrait();
      try {const result=await window.playerSetPortrait?.('');if(result?.saved!==true)throw new Error(result?.error || 'Не удалось удалить арт. Попробуй ещё раз.');portraitMessage='Арт удалён.';}
      catch(error){portraitMessage=error?.message || 'Не удалось удалить арт.';portraitError=true;}
      finally{if(epoch===portraitEpoch){portraitBusy=false;refreshPortrait();}}
    }
  });
  document.addEventListener('change',event=>{
    if(event.target.id!=='sheetPortraitFile')return;
    const file=event.target.files?.[0];event.target.value='';if(file)setPortraitFile(file);
  });
  window.addEventListener('niti:character-cleared',()=>{portraitEpoch++;portraitBusy=false;portraitMessage='';portraitError=false;refreshPortrait();});
  function page() {
    const sheet = currentSheet();
    const result=applyCalculated(sheet);
    queueMicrotask(()=>{updateSessionParts();maybePromptPerk();});
    const heading = typeof head === 'function' ? head('ЛИЧНЫЙ ЛИСТ · ПРАВИЛА ПУСТОШИ', 'Мой персонаж.', 'Характеристики считаются по правилам. Обучение навыкам и текущее здоровье — под твоим контролем.') : '<h1>Мой персонаж.</h1>';
    return heading + `<form class="panel fallout-sheet" id="falloutSheetForm"><div class="sheet-masthead"><div class="sheet-brand"><h2>Fallout</h2><small>ПЕРСОНАЛЬНОЕ ДЕЛО ВЫЖИВШЕГО</small></div><span class="sheet-document-id">S.P.E.C.I.A.L. // 2207<br>АВТОМАТИЧЕСКИЙ РАСЧЁТ ПО ПРАВИЛАМ</span></div><section class="sheet-portrait-panel" data-sheet-portrait aria-label="Арт персонажа">${portraitMarkup(sheet)}</section><div class="sheet-top"><div class="sheet-identity">${field('name', 'Имя', sheet)}${field('gender', 'Пол', sheet)}${field('age', 'Возраст', sheet, {numeric:true})}</div><div class="sheet-combat-summary">${field('initiative', 'Инициатива · авто', sheet, {readonly:true})}${field('action_points', 'Очки действия · авто', sheet, {readonly:true,after:`<small data-movement-ap>${result.movementAP ? '+'+result.movementAP+' ОД только на передвижение' : 'Общие ОД на ход'}</small>`})}${field('armor_class', 'Класс брони · авто', sheet, {readonly:true})}${experienceMarkup(sheet,result)}${field('level', 'Уровень · авто', sheet, {readonly:true})}<label class="sheet-field" for="sheet-health-current"><span>Здоровье · текущее / максимум</span><span class="sheet-health-control"><input class="input" type="number" step="any" inputmode="decimal" id="sheet-health-current" data-health-current aria-label="Текущее здоровье" value="${result.currentHP===null?'':result.currentHP}"><output data-health-max>/ ${result.maxHP}</output></span><small>Максимум считается; текущее не лечится при повышении уровня.</small></label></div></div><div id="sheetAdvancement">${progressMarkup(sheet,result)}</div><div class="sheet-rule-notices" data-rules-warnings aria-live="polite">${warningsMarkup(result)}</div><div class="sheet-body">${specialMarkup(sheet)}<div class="sheet-notes-column"><section class="sheet-notebox sheet-traits" id="sheetTraits">${traitMarkup(sheet)}</section><section class="sheet-notebox sheet-perks" id="sheetPerks">${perkMarkup(sheet)}</section><section class="sheet-notebox sheet-wounds">${sectionTitle('Ранения')}${field('wounds', '<span class="sr-only">Ранения</span>', sheet, {multiline:true, rows:6})}</section>${legacyNotes()}</div>${skillsMarkup(sheet)}</div><div id="falloutSheetEquipment">${equipmentMarkup(sheet)}</div><details class="sheet-formulas"><summary>Как считается анкета</summary><p>Модификатор S.P.E.C.I.A.L. = итог − 5. Максимум здоровья = 15 + 3 × В + (уровень − 1) × В + бонусы. ОД = 5 + ⌊Л / 2⌋ + бонусы. Инициатива = Восприятие + d20; кубик бросается в игре.</p><p>КБ = КБ экипированной брони + бонус ловкости + постоянные бонусы. Без брони бонус равен ловкости; кожаная куртка — ⌊Л/2⌋, кожаная боевая куртка — ⌊Л/3⌋, кожаная броня — ⌊Л/4⌋, кожаная броня МК2 — ⌊Л/6⌋. «Камикадзе» исключает бонус ловкости к КБ и прибавляет ловкость к инициативе.</p><p>В таблице опыта: 1 — 200; 2 — 400; 3 — 800; 4 — 1400; 5 — 2200; 6 — 3200; 7 — 4400; 8 — 5800; 9 — 7400; 10 — 9100; 11 — 11000; 12 — 13100; 13 — 15400; 14 — 17900; 15 — 20600. Создание начинается с 1-го уровня: при 0–399 XP показан 1-й уровень. Выше 15-го формулы опыта в файле нет.</p><p>Стартовый опыт — уже полученная сумма. «Светоч» делит новый опыт сессии на два; округление в правилах не указано, поэтому сохраняется точная половина. Серверная запись опыта остаётся исходной.</p></details><div class="sheet-footer"><button class="button primary" type="submit">Сохранить анкету ↗</button><button type="button" class="button ghost small sheet-delete-character" data-sheet-progress-action="delete-character">Удалить персонажа</button><span class="sheet-save-status" id="falloutSheetSaveStatus" role="status">Изменения сохраняются автоматически в этом браузере.</span></div><p class="sheet-storage-note">Расчёты — по твоим «Правилам игры» и «Перкам». Лист и последний полученный опыт сохраняются в браузере и входят в резервную копию. Награды приходят с сервера автоматически.</p></form>`;
  }
  function warningsMarkup(result) { return result.warnings.length ? result.warnings.map(text=>`<p class="sheet-warning">${escapeText(text)}</p>`).join('') : '<p class="sheet-rules-help">Постоянные бонусы особенностей и перков учтены в итогах.</p>'; }
  function scheduleSave() {
    const status=document.getElementById('falloutSheetSaveStatus');
    const allocation=showAllocationValidation();
    if(status) status.textContent=allocation.valid ? 'Сохраняю изменения…' : 'Анкета не сохранена. '+allocation.error;
    clearTimeout(saveTimer);
    if(!allocation.valid) {saveTimer=0;return;}
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
    processProgress();
    if(document.querySelector('[data-sheet-perk-dialog]'))refreshPerkDialog();
    if(document.querySelector('[data-sheet-special-dialog]'))refreshSpecialDialog();
    const form=document.getElementById('falloutSheetForm');
    if(!form) return;
    const sheet=currentSheet(),result=applyCalculated(sheet);
    updateLegacyProfile(sheet,result);
    for(const name of ['initiative','action_points','armor_class','level']) {const input=document.getElementById('sheet-'+name);if(input)input.value=sheet[name];}
    const total=document.getElementById('sheet-experience-total');if(total)total.value=String(result.totalXP);
    const xp=form.querySelector('[data-sheet-xp]');if(xp)xp.innerHTML=xpBreakdown(sheet);
    const advancement=document.getElementById('sheetAdvancement');if(advancement){const markup=progressMarkup(sheet,result);if(advancement.innerHTML!==markup)advancement.innerHTML=markup;}
    const health=form.querySelector('[data-health-max]');if(health)health.textContent='/ '+result.maxHP;
    const movement=form.querySelector('[data-movement-ap]');if(movement)movement.textContent=result.movementAP ? '+'+result.movementAP+' ОД только на передвижение' : 'Общие ОД на ход';
    for(const [letter] of SPECIAL_ROWS) {const effective=form.querySelector(`[data-special-effective="${letter}"]`),mod=form.querySelector(`[data-special-mod="${letter}"]`);if(effective)effective.textContent=String(result.special[letter]);if(mod)mod.value=signed(result.modifiers[letter]);}
    for(const [id] of SKILLS) {const total=form.querySelector(`[data-skill-total="${id}"]`),bonus=form.querySelector(`[data-skill-bonus="${id}"]`);if(total)total.textContent=signed(result.skills[id]);if(bonus)bonus.textContent=result.bonus[id] ? signed(result.bonus[id])+' от особенностей / перков' : 'Без постоянного бонуса';}
    const special=form.querySelector('[data-special-budget]');if(special)special.textContent=specialBudget(result);
    const skills=form.querySelector('[data-skill-budget]');if(skills)skills.textContent=skillBudget(result);
    const warnings=form.querySelector('[data-rules-warnings]');if(warnings)warnings.innerHTML=warningsMarkup(result);
    showAllocationValidation(sheet,result);
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
    const target=event.target.closest('[data-add-trait],[data-remove-trait],[data-add-perk],[data-add-rank]');
    if(!target || !target.closest('#falloutSheetForm'))return;
    const sheet=currentSheet(),meta=sheet.rules,result=calculation(sheet);
    if(target.dataset.addTrait && !meta.traitsLocked && meta.traits.length<2 && RULES.TRAITS.some(trait=>trait.id===target.dataset.addTrait) && !meta.traits.includes(target.dataset.addTrait)){meta.traits.push(target.dataset.addTrait);selectedTrait='';}
    if(target.dataset.removeTrait && !meta.traitsLocked)meta.traits=meta.traits.filter(id=>id!==target.dataset.removeTrait);
    const used=meta.perks.reduce((sum,entry)=>sum+entry.rank,0),addId=target.dataset.addPerk || target.dataset.addRank;
    if(addId && !allocationState(sheet,result).valid) {showAllocationValidation(sheet,result);if(typeof toast==='function')toast(allocationState(sheet,result).error);return;}
    if(addId && used<result.perkBudget) {const perk=RULES.PERKS.find(entry=>entry.id===addId),existing=meta.perks.find(entry=>entry.id===addId);if(perk && !RULES.eligibility(perk,result,(existing?.rank || 0)+1).length){const previous=meta.perks.map(entry=>({...entry}));if(existing)existing.rank++;else meta.perks.push({id:addId,rank:1});applyCalculated(sheet);if(!persist()){meta.perks=previous;applyCalculated(sheet);updateLegacyProfile(sheet);if(typeof toast==='function')toast('Не удалось сохранить выбор перка. Попробуй ещё раз.');}else selectedPerk='';refreshSelectors();updateSessionParts();return;}}
    applyCalculated(sheet);refreshSelectors();updateSessionParts();scheduleSave();
  });
  document.addEventListener('submit',event=>{
    if(event.target.id!=='falloutSheetForm')return;
    event.preventDefault();
    const sheet=currentSheet();
    if(sheet.rules.traits.includes('thief') && (!sheet.rules.thiefSubtype || sheet.rules.thiefSkills.length!==2)) {if(typeof toast==='function')toast('Для «Вора» выбери подтип и два навыка.');return;}
    persist(true);
  });
  document.addEventListener('click',event=>{
    if(event.target.closest('[data-sheet-special-action="choose"]'))openSpecialDialog();
    const specialOption=event.target.closest('[data-special-choice]');
    if(specialOption && !specialOption.disabled) {specialChoice=specialOption.dataset.specialChoice;refreshSpecialDialog();}
    const action=event.target.closest('[data-sheet-progress-action]')?.dataset.sheetProgressAction;
    if(action==='choose-perk')openPerkDialog();
    if(action==='open-sheet') {if(location.hash!=='#character')location.hash='character';else document.getElementById('falloutSheetForm')?.scrollIntoView({behavior:'smooth',block:'start'});}
    if(action==='acknowledge') {const progress=progression();progress.acknowledgedLevel=progress.observedLevel;if(typeof save==='function')save();mountLevelNotice();updateSessionParts();}
    if(action==='delete-character')confirmDeleteCharacter();
    const choice=event.target.closest('[data-perk-dialog-select]');
    if(choice) {perkDialogSelection=choice.dataset.perkDialogSelect;refreshPerkDialog();}
  });
  document.addEventListener('input',event=>{if(event.target.hasAttribute('data-perk-dialog-search')){perkDialogSearch=event.target.value.slice(0,100);refreshPerkDialog();}});
  document.addEventListener('change',event=>{if(event.target.hasAttribute('data-perk-dialog-available')){perkDialogAvailableOnly=event.target.checked;refreshPerkDialog();}});
  window.addEventListener('niti:session-update',event=>{rememberedRoom=event.detail?.room?.self ? event.detail.room : null;updateSessionParts();});
  window.addEventListener('pagehide',()=>{if(saveTimer)persist();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden && saveTimer)persist();});
  window.playerRulesEffectivePerception=()=>calculation().special.P;
  window.playerSheetValidPortrait = validPortrait;
  window.playerSheetPublicPersona = publicPersona;
  window.playerSheetPage = page;
  window.playerSheetValid = validSheet;
  window.playerSheetNormalize = normalizeSheet;
  window.playerSheetAllocationState = allocationState;
  window.playerSheetRefresh = updateSessionParts;
  window.playerSheetResetProgress=()=>{const key=specialPromptKey();specialPrompts.delete(key);try{localStorage.removeItem(key);}catch{}clearTimeout(saveTimer);clearTimeout(promptTimer);saveTimer=0;promptTimer=0;progressSignature='';specialChoice='';rememberedRoom=null;document.getElementById('sheetProgressNotice')?.remove();};
})();
