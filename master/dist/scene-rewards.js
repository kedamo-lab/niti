'use strict';
/* Scene preparation stays in the GM's archive. Only the selected public card
 * and one confirmed result enter the shared session service. */
(function () {
  const ID = /^[A-Za-z0-9._:-]{1,128}$/;
  const MAX_XP = 100000;
  let lootDrafts = {};
  let draft = null, editingScene = null, selectedResult = '', catalogSearch = '', selectedItem = '';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const clone = value => JSON.parse(JSON.stringify(value));
  const newId = prefix => prefix + '-' + (crypto.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2));
  const catalog = () => Array.isArray(window.NITI_ITEM_CATALOG) ? window.NITI_ITEM_CATALOG : [];
  const quests = () => window.NITI_SESSION_CATALOG?.quests || [];
  const baseQuest = scene => quests().find(q => q.id === scene.id) || null;
  const integer = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;
  const text = (s, max, required = true) => typeof s === 'string' && s.length <= max && (!required || !!s.trim());
  const id = s => typeof s === 'string' && ID.test(s) && !['__proto__','prototype','constructor'].includes(s);
  const actionId = s => typeof s === 'string' && /^[A-Za-z0-9._:-]{1,200}$/.test(s) && !['__proto__','prototype','constructor'].includes(s);
  const exact = (value, keys, optional = []) => value && typeof value === 'object' && !Array.isArray(value) && keys.every(k => Object.hasOwn(value, k)) && Object.keys(value).every(k => keys.includes(k) || optional.includes(k));

  function validEffects(effects) {
    if (!exact(effects, [], ['flags','secrets','threads','relations','nextScenes'])) return false;
    const rules = {
      flags: value => exact(value,['id','value']) && id(value.id) && ['yes','no','unknown'].includes(value.value),
      secrets: value => exact(value,['id','revealed']) && id(value.id) && typeof value.revealed === 'boolean',
      threads: value => exact(value,['id','status']) && id(value.id) && ['open','later','closed'].includes(value.status),
      relations: value => exact(value,['id']) && id(value.id),
      nextScenes: value => id(value)
    };
    return Object.entries(effects).every(([kind, values]) => Array.isArray(values) && values.length <= (kind==='nextScenes'?20:100)
      && values.every(rules[kind]) && new Set(values.map(value => kind==='nextScenes'?value:value.id)).size===values.length);
  }

  function choiceDefaults(scene, entry, index) {
    const defaults = window.gmOutcomeDefaults?.(scene.id,entry.id);
    if (!Object.hasOwn(entry,'playerLabel')) entry.playerLabel = defaults?.playerLabel || 'Подтвердить результат ' + (index+1);
    if (!Object.hasOwn(entry,'playerSelectable')) entry.playerSelectable = true;
    if (!Object.hasOwn(entry,'effects')) entry.effects = clone(defaults?.effects || {});
    return entry;
  }

  function valid(config) {
    if (!exact(config, ['version','xp','public','results']) || config.version !== 1 || !integer(config.xp, 0, MAX_XP)) return false;
    const card = config.public;
    if (!exact(card, ['title','description','actions']) || !text(card.title, 180) || !text(card.description, 4000, false) || !Array.isArray(card.actions) || card.actions.length > 20) return false;
    if (new Set(card.actions.map(a => a?.id)).size !== card.actions.length || !card.actions.every(a => exact(a,['id','label']) && id(a.id) && text(a.label,240))) return false;
    if (!Array.isArray(config.results) || !config.results.length || config.results.length > 40 || new Set(config.results.map(r => r?.id)).size !== config.results.length) return false;
    return config.results.every(r => exact(r,['id','label','publicText','xp','completion','onceKey','items'],['playerLabel','playerSelectable','actionId','effects']) && id(r.id) && id(r.onceKey)
      && text(r.label,240) && text(r.publicText,2000) && integer(r.xp,0,MAX_XP) && typeof r.completion === 'boolean'
      && (!Object.hasOwn(r,'playerLabel') || text(r.playerLabel,240,r.playerSelectable!==false))
      && (!Object.hasOwn(r,'playerSelectable') || typeof r.playerSelectable==='boolean')
      && (!Object.hasOwn(r,'actionId') || actionId(r.actionId))
      && (!Object.hasOwn(r,'effects') || validEffects(r.effects))
      && Array.isArray(r.items) && r.items.length <= 30 && new Set(r.items.map(i => i?.id)).size === r.items.length
      && r.items.every(i => exact(i,['id','name','quantity'],['catalogId','stats']) && id(i.id) && text(i.name,180) && integer(i.quantity,1,9999) && (!Object.hasOwn(i,'catalogId') || id(i.catalogId)) && (!Object.hasOwn(i,'stats') || window.GMEquipmentEditor?.validateStatsPatch(i.stats))));
  }

  function completionKey(scene, q) {
    return q?.results?.find(r => r.completion)?.onceKey || ('completion-' + scene.id).slice(0,128);
  }
  function initialConfig(scene, card = null) {
    if (valid(scene.rewardConfig)) {
      const config=clone(scene.rewardConfig);
      config.results.forEach((entry,index)=>choiceDefaults(scene,entry,index));
      return config;
    }
    const q = baseQuest(scene);
    const source = card || q?.public || {title:scene.playerTitle || scene.title, description:scene.hook || '', actions:[]};
    const xp = integer(scene.xp,0,MAX_XP) ? scene.xp : integer(q?.completionXP,0,MAX_XP) ? q.completionXP : 0;
    const original = [...(q?.results || []), ...(q?.itemEvents || []).filter(r => ['q4:spare-drink','q10:service-badge','q10:ammo-preserved','q14:disk-taken','q14:box-1','q14:box-2','q14:box-3'].includes(scene.id+':'+r.id))];
    const results = original.length ? original.map(r => ({
      id:r.id, label:r.label, publicText:r.publicText, xp:r.xp || 0,
      completion:r.completion === true, onceKey:r.onceKey,
      items:(r.items || []).map((item,index) => ({id:'loot-'+index, name:item.name, quantity:item.quantity, ...(item.catalogId ? {catalogId:item.catalogId} : {})}))
    })) : [{id:newId('result'),label:'Задание выполнено',publicText:'Задание выполнено.',xp,completion:true,onceKey:completionKey(scene,q),items:[]}];
    results.forEach((entry,index)=>choiceDefaults(scene,entry,index));
    return {version:1,xp,public:{title:String(source.title || scene.title || 'Новая миссия').slice(0,180),description:String(source.description || '').slice(0,4000),actions:(source.actions || []).map((a,index)=>({id:String(a.id || 'action-'+index),label:String(a.label || '')})).slice(0,20)},results};
  }

  function quest(base, scene) {
    if (!scene) return base;
    if (!valid(scene.rewardConfig)) return base;
    const config = scene.rewardConfig;
    return {...(base || {}),id:scene.id,public:clone(config.public),completionXP:config.xp,results:clone(config.results),itemEvents:[],caveats:base?.caveats || []};
  }
  function publicCard(base, scene) {
    if (!valid(scene?.rewardConfig)) return base;
    return {id:scene.id,...clone(scene.rewardConfig.public)};
  }
  function settings(scene) {
    const config = valid(scene?.rewardConfig) ? scene.rewardConfig : null;
    const count = config?.results.length || baseQuest(scene)?.results?.length || 1;
    return `<section class="gm-reward-settings"><div><span class="eyebrow">НАСТРОЙКИ СЦЕНЫ</span><strong>${config ? config.xp : Number(scene.xp) || 0} XP за завершение · ${count} ${count===1?'вариант':'вариантов'}</strong><p>Опыт, способы выполнения и предметы награды.</p></div><button type="button" class="button ghost small" data-reward-open="${escape(scene.id)}">Настроить сцену ↗</button></section>`;
  }
  function result() { return draft?.results.find(r => r.id === selectedResult) || draft?.results[0]; }
  function alreadyIssued(entry) {
    const room = window.gmSessionSnapshot?.();
    return !!room?.events?.some(e => e.missionId === editingScene?.id && (e.resultId === entry.id || e.eventId === entry.onceKey));
  }
  function label(name, title, value, type = 'text', max = 240) {
    return `<label class="reward-field"><span>${title}</span>${type==='textarea' ? `<textarea class="textarea" data-reward-field="${name}" rows="3" maxlength="${max}">${escape(value)}</textarea>` : `<input class="input" data-reward-field="${name}" type="${type}" ${type==='number'?`min="0" max="${MAX_XP}" step="1"`: `maxlength="${max}"`} value="${escape(value)}">`}</label>`;
  }
  function catalogOptions() {
    const needle = catalogSearch.toLocaleLowerCase('ru');
    return '<option value="">Выбрать предмет…</option>' + catalog().filter(item => !needle || (item.name+' '+(item.categoryLabel || '')).toLocaleLowerCase('ru').includes(needle)).map(item => `<option value="${escape(item.id)}" ${item.id===selectedItem?'selected':''}>${escape(item.name)}${item.categoryLabel?' · '+escape(item.categoryLabel):''}</option>`).join('');
  }
  function lootStats(loot) {
    if (!lootDrafts[loot.id]) {
      const original=catalog().find(item=>item.id===loot.catalogId)?.stats || {};
      const stats={...clone(original),...clone(loot.stats || {})};
      for(const key of ['resistances','damageThresholds','resistancePercent'])if(loot.stats?.[key] && typeof loot.stats[key]==='object')stats[key]={...original[key],...loot.stats[key]};
      lootDrafts[loot.id]={original:clone(original),stats};
    }
    return lootDrafts[loot.id];
  }
  function lootStatsEditor(loot) {
    if(!window.GMEquipmentEditor)return '';
    const values=lootStats(loot);
    return `<details class="reward-loot-stats"><summary>Характеристики награды${Object.keys(loot.stats || {}).length?' · изменены':''}</summary><div data-reward-loot-stats="${escape(loot.id)}"><p class="reward-help">Настрой только этот предмет награды. Изображение и связь с каталогом сохранятся.</p>${window.GMEquipmentEditor.fields(values.stats,'reward-'+loot.id)}<button type="button" class="text-button" data-reward-action="reset-item-stats" data-id="${escape(loot.id)}">Вернуть параметры каталога</button></div></details>`;
  }
  function normalizeLootDrafts() {
    for(const entry of draft.results)for(const loot of entry.items) {
      const values=lootDrafts[loot.id];if(!values)continue;
      const stats=window.GMEquipmentEditor.readStatsValues(values.stats,values.original);
      const patch=window.GMEquipmentEditor.statsPatch(stats,values.original);
      if(Object.keys(patch).length)loot.stats=patch;else delete loot.stats;
    }
  }
  function effectCount(entry) {
    return Object.values(entry.effects || {}).reduce((sum,values)=>sum+(Array.isArray(values)?values.length:0),0);
  }
  function bindingSelect(kind, item, current, choices) {
    return `<label class="reward-binding-row"><span>${escape(item.title || item.name || item.id)}</span><select class="input" data-reward-effect="${kind}" data-effect-id="${escape(item.id)}" aria-label="${escape(item.title || item.name || item.id)}">${[['','Не менять'],...choices].map(([value,title])=>`<option value="${value}" ${String(current)===value?'selected':''}>${title}</option>`).join('')}</select></label>`;
  }
  function effectEditor(entry) {
    const story=typeof state!=='undefined'?state:{}, effects=entry.effects || {};
    const value=(kind,id,field)=>(effects[kind] || []).find(item=>item.id===id)?.[field];
    const section=(title,items,body)=>`<details class="reward-binding-group"><summary>${title}<small>${items.length}</small></summary><div class="reward-binding-list">${items.length?body:'<p class="reward-help">В истории пока нет таких записей.</p>'}</div></details>`;
    const flags=Array.isArray(story.flags)?story.flags:[], secrets=Array.isArray(story.secrets)?story.secrets:[], threads=Array.isArray(story.threads)?story.threads:[], relations=Array.isArray(story.relations)?story.relations:[];
    const scenes=(Array.isArray(story.scenes)?story.scenes:[]).filter(scene=>scene.id!==editingScene?.id);
    const characters=Array.isArray(story.characters)?story.characters:[];
    const characterName=id=>characters.find(character=>character.id===id)?.name || id;
    return `<details class="reward-automatic-bindings"><summary><span>Автоматические отметки</span><small><b data-reward-effect-count>${effectCount(entry)}</b> привязок</small></summary><div class="reward-bindings-body"><p class="reward-help">После подтверждения игроками эти отметки появятся у мастера вместе с наградой. Сам выбранный результат дополнительно запишется как факт. Проверки и неудачи остаются под контролем мастера.</p>${section('Факты и последствия',flags,flags.map(item=>bindingSelect('flags',item,value('flags',item.id,'value') ?? '',[['yes','Да'],['no','Нет'],['unknown','Не определено']])).join(''))}${section('Тайны',secrets,secrets.map(item=>bindingSelect('secrets',item,Object.hasOwn((effects.secrets || []).find(value=>value.id===item.id) || {},'revealed')?String(value('secrets',item.id,'revealed')):'',[['true','Раскрыть'],['false','Вернуть за ширму']])).join(''))}${section('Сюжетные нити',threads,threads.map(item=>bindingSelect('threads',item,value('threads',item.id,'status') ?? '',[['open','В игре'],['later','На потом'],['closed','Закрыта']])).join(''))}${section('Связи персонажей',relations,relations.map(item=>`<label class="reward-binding-check"><input type="checkbox" data-reward-effect="relations" data-effect-id="${escape(item.id)}" ${(effects.relations || []).some(value=>value.id===item.id)?'checked':''}><span><strong>${escape(characterName(item.from))} → ${escape(characterName(item.to))}</strong><small>${escape(item.label)}</small></span></label>`).join(''))}${section('Продолжение цепочки сцен',scenes,scenes.map(item=>`<label class="reward-binding-check"><input type="checkbox" data-reward-effect="nextScenes" data-effect-id="${escape(item.id)}" ${(effects.nextScenes || []).includes(item.id)?'checked':''}><span>${escape(item.title)}</span></label>`).join(''))}<p class="reward-help">Открытие следующей сцены не завершает её и не начисляет за неё опыт. Показ следующей миссии игрокам остаётся у мастера.</p></div></details>`;
  }
  function playerChoiceEditor(entry) {
    const selected=entry.actionId || '', mapped=draft.public.actions.some(action=>action.id===selected);
    return `<section class="reward-player-choice"><label class="reward-checkbox"><input type="checkbox" data-reward-player-selectable ${entry.playerSelectable!==false?'checked':''}><span>Игроки могут подтвердить результат<small>Любой участник подтверждает общий результат для отряда. Награда выдаётся один раз; «Неудачу» отмечает мастер.</small></span></label>${label('player-label','Название кнопки для игроков',entry.playerLabel || '')}<p class="reward-choice-preview" data-reward-choice-preview>${escape(entry.playerLabel || 'Укажи название кнопки')}</p><label class="reward-field"><span>Что отметить в «Действиях игроков»</span><select class="input" data-reward-action-binding><option value="" ${!selected || selected==='result:'+entry.id?'selected':''}>Отдельный результат этой сцены</option>${selected && !mapped && selected!=='result:'+entry.id?`<option value="${escape(selected)}" selected>Сохранённая привязка: ${escape(selected)}</option>`:''}${draft.public.actions.map(action=>`<option value="${escape(action.id)}" ${selected===action.id?'selected':''}>${escape(action.label || 'Действие без названия')}</option>`).join('')}</select></label><p class="reward-help">Выбранное действие будет отмечено «Разыграно», остальные — «Не разыграно». Уже отмеченные мастером неудачи сохранятся.</p>${effectEditor(entry)}</section>`;
  }
  function outcomeBody() {
    const entry = result();
    if (!entry) return '';
    const issued = alreadyIssued(entry), item = catalog().find(i => i.id === selectedItem);
    return `<div class="reward-outcome-editor" data-reward-outcome="${escape(entry.id)}">${issued ? '<p class="reward-issued-note">Этот результат уже выдан. Его настройки закреплены: полученный опыт и предметы останутся в истории без изменений.</p>' : ''}<fieldset class="reward-result-fields" ${issued?'disabled':''} aria-label="Параметры результата">${label('result-label','Название варианта · только мастеру',entry.label)}${playerChoiceEditor(entry)}${label('result-text','Сообщение игрокам после подтверждения',entry.publicText,'textarea',2000)}<div class="reward-outcome-settings">${label('result-xp','Опыт каждому участнику',entry.xp,'number')}<label class="reward-checkbox"><input type="checkbox" data-reward-completion ${entry.completion?'checked':''}><span>Завершает задание<small>Финальная награда — один раз за задание. Если снять галочку, это отдельное событие с дополнительной наградой.</small></span></label></div><div class="reward-items-heading"><h4>Предметы награды <span class="badge">${entry.items.length}</span></h4><span>Один комплект на группу</span></div><div class="reward-items">${entry.items.map(loot=>`<div class="reward-loot-row" data-reward-loot="${escape(loot.id)}"><label class="reward-field"><span>Предмет${loot.catalogId?' · из каталога':''}</span><input class="input" data-reward-loot-name maxlength="180" value="${escape(loot.name)}"></label><label class="reward-field reward-quantity"><span>Количество</span><input class="input" data-reward-loot-quantity type="number" min="1" max="9999" step="1" value="${loot.quantity}"></label><button type="button" class="button ghost small reward-remove" data-reward-action="remove-item" data-id="${escape(loot.id)}" aria-label="Убрать ${escape(loot.name)} из награды">×</button>${lootStatsEditor(loot)}</div>`).join('') || '<p class="muted">Предметы пока не добавлены.</p>'}</div><div class="reward-catalog-add"><label class="reward-field"><span>Найти в каталоге снаряжения</span><input class="input" type="search" data-reward-search maxlength="100" value="${escape(catalogSearch)}" placeholder="Патроны, лекарства, оружие…"></label><label class="reward-field"><span>Снаряжение с характеристиками</span><select class="input" data-reward-catalog>${catalogOptions()}</select></label><div class="reward-item-preview" data-reward-item-preview>${item?.image?`<img src="${escape(item.image)}" alt="${escape(item.name)}">`:''}<span>${item?escape(item.name):'У выбранного предмета сохранятся изображение и характеристики.'}</span></div><div class="reward-item-buttons"><button type="button" class="button ghost small" data-reward-action="add-item" ${selectedItem?'':'disabled'}>＋ Добавить из каталога</button><button type="button" class="text-button" data-reward-action="add-custom-item">＋ Свой предмет</button></div></div></fieldset></div>`;
  }
  function editorBody() {
    return `<div class="reward-editor" data-reward-editor><p class="reward-editor-intro">Подготовь карточку, доступные игрокам результаты и награды. Игроки увидят только названия кнопок; проверки и привязки останутся у мастера. Сохранение настроек само по себе ничего не начисляет.</p>${label('default-xp','Опыт за завершение · каждому',draft.xp,'number')}<p class="reward-help">Изменение этой суммы обновит опыт всех финальных вариантов. Для отдельного исхода можно указать свою сумму ниже.</p><details class="reward-public-settings" open><summary>Что увидят игроки</summary>${label('public-title','Название миссии',draft.public.title,'text',180)}${label('public-description','Ситуация и цель',draft.public.description,'textarea',4000)}<div class="reward-items-heading"><h4>Варианты действий</h4><span>Без проверок и скрытых исходов</span></div><div class="reward-actions">${draft.public.actions.map((action,index)=>`<div class="reward-action-row" data-reward-public-action="${escape(action.id)}"><span>${String(index+1).padStart(2,'0')}</span><input class="input" data-reward-action-label maxlength="240" aria-label="Действие ${index+1}" value="${escape(action.label)}"><button type="button" class="button ghost small reward-remove" data-reward-action="remove-action" data-id="${escape(action.id)}" aria-label="Убрать действие ${index+1}">×</button></div>`).join('')}</div><button type="button" class="text-button" data-reward-action="add-action" ${draft.public.actions.length>=20?'disabled':''}>＋ Добавить действие</button></details><section class="reward-outcomes"><div class="reward-items-heading"><h3>Результаты и награды</h3><span>Награды и привязки видит только мастер</span></div><div class="reward-result-tabs" role="group" aria-label="Редактируемый результат">${draft.results.map((entry,index)=>`<button type="button" class="button ghost small ${entry.id===result()?.id?'selected':''}" data-reward-action="select-result" data-id="${escape(entry.id)}" aria-pressed="${entry.id===result()?.id}">${index+1}. ${escape(entry.label || 'Новый вариант')}</button>`).join('')}<button type="button" class="button ghost small" data-reward-action="add-result" ${draft.results.length>=40?'disabled':''}>＋ Свой вариант</button></div><div data-reward-outcome-body>${outcomeBody()}</div><button type="button" class="text-button reward-delete-result" data-reward-action="remove-result" ${draft.results.length<=1 || alreadyIssued(result())?'disabled':''}>Удалить этот вариант из настроек</button></section><p class="reward-editor-error" data-reward-error role="alert"></p></div>`;
  }
  function repaint() {
    const root = document.querySelector('[data-reward-editor]');
    if (!root) return;
    const scroller = root.closest('.modal-body'), scroll = scroller?.scrollTop || 0;
    root.outerHTML = editorBody();
    if (scroller) scroller.scrollTop = scroll;
  }
  function showError(message) {
    const node = document.querySelector('[data-reward-error]');
    if (node) { node.textContent = message; node.scrollIntoView({block:'nearest'}); }
  }
  function open(scene, card = null) {
    if (!scene || typeof modal !== 'function') return;
    editingScene = scene; draft = initialConfig(scene,card); lootDrafts={}; selectedResult = draft.results[0]?.id || ''; catalogSearch = ''; selectedItem = '';
    modal('Сцена · варианты и награды',editorBody(),() => {
      try {normalizeLootDrafts();} catch(error) {showError(error.message || 'Проверь характеристики наград.');return;}
      if (!valid(draft)) {showError('Проверь название, сообщения и количества. Опыт — целое число от 0 до 100 000, количество предметов — от 1 до 9 999. Пустые действия нужно заполнить или удалить.');return;}
      // The current state may have been restored while the dialog was open.
      const target = typeof state!=='undefined' ? state.scenes.find(s=>s.id===editingScene.id) : null;
      if (!target) {showError('Сцена больше не найдена. Закрой окно и открой настройки ещё раз.');return;}
      target.rewardConfig = clone(draft); target.xp = draft.xp;
      if (typeof save === 'function') save();
      closeModal();
      window.dispatchEvent(new CustomEvent('niti:scene-rewards-saved',{detail:{sceneId:target.id}}));
      if (typeof render === 'function') render();
      if (typeof toast === 'function') toast('Варианты, награды и автоматические отметки сохранены.');
    },'<button class="button ghost" type="button" data-action="close-modal">Отмена</button><button class="button primary" type="submit">Сохранить настройки ↗</button>',true);
  }
  document.addEventListener('click',event => {
    const opener = event.target.closest('[data-reward-open]');
    if (opener) {const scene=typeof state!=='undefined' ? state.scenes.find(s=>s.id===opener.dataset.rewardOpen) : null;open(scene,window.gmScenePublicCard?.(scene?.id));return;}
    const button=event.target.closest('[data-reward-action]');
    if (!button || !button.closest('[data-reward-editor]') || !draft) return;
    const entry=result(), action=button.dataset.rewardAction;
    if (alreadyIssued(entry) && ['remove-result','remove-item','add-item','add-custom-item','reset-item-stats'].includes(action)) return;
    if (action==='select-result') {selectedResult=button.dataset.id;selectedItem='';catalogSearch='';}
    if (action==='add-result' && draft.results.length<40) {const next={id:newId('result'),label:'Новый вариант',publicText:'Задание выполнено.',xp:draft.xp,completion:true,onceKey:completionKey(editingScene,baseQuest(editingScene)),items:[],playerLabel:'Задание выполнено',playerSelectable:true,effects:{}};draft.results.push(next);selectedResult=next.id;}
    if (action==='remove-result' && draft.results.length>1) {draft.results=draft.results.filter(r=>r.id!==entry.id);selectedResult=draft.results[0].id;}
    if (action==='add-action' && draft.public.actions.length<20) draft.public.actions.push({id:newId('action'),label:''});
    if (action==='remove-action') {draft.public.actions=draft.public.actions.filter(a=>a.id!==button.dataset.id);for(const item of draft.results)if(item.actionId===button.dataset.id)delete item.actionId;}
    if (action==='remove-item') {entry.items=entry.items.filter(i=>i.id!==button.dataset.id);delete lootDrafts[button.dataset.id];}
    if (action==='reset-item-stats') {const loot=entry.items.find(i=>i.id===button.dataset.id);if(loot){delete loot.stats;delete lootDrafts[loot.id];}}
    if (action==='add-item') {const item=catalog().find(i=>i.id===selectedItem);if(item && entry.items.length<30){const old=entry.items.find(i=>i.catalogId===item.id && i.name===item.name && !i.stats && (!lootDrafts[i.id] || JSON.stringify(lootDrafts[i.id].stats)===JSON.stringify(lootDrafts[i.id].original)));if(old && old.quantity<9999)old.quantity++;else entry.items.push({id:newId('loot'),catalogId:item.id,name:item.name,quantity:1});}}
    if (action==='add-custom-item' && entry.items.length<30) entry.items.push({id:newId('loot'),name:'Новый предмет',quantity:1});
    repaint();
  });
  document.addEventListener('input',event => {
    const target=event.target;
    if (!target.closest('[data-reward-editor]') || !draft) return;
    const entry=result(), field=target.dataset.rewardField;
    if (field==='default-xp') {draft.xp=target.value===''?null:Number(target.value);for(const r of draft.results)if(r.completion && !alreadyIssued(r))r.xp=draft.xp;const input=document.querySelector('[data-reward-field="result-xp"]');if(entry.completion && !alreadyIssued(entry) && input)input.value=target.value;}
    if (field==='public-title') draft.public.title=target.value;
    if (field==='public-description') draft.public.description=target.value;
    if (!alreadyIssued(entry) && field==='result-label') {entry.label=target.value;const button=document.querySelector(`[data-reward-action="select-result"][data-id="${entry.id}"]`);if(button)button.textContent=(draft.results.indexOf(entry)+1)+'. '+(entry.label || 'Новый вариант');}
    if (!alreadyIssued(entry) && field==='player-label') {entry.playerLabel=target.value;const preview=document.querySelector('[data-reward-choice-preview]');if(preview)preview.textContent=target.value || 'Укажи название кнопки';}
    if (!alreadyIssued(entry) && field==='result-text') entry.publicText=target.value;
    if (!alreadyIssued(entry) && field==='result-xp') entry.xp=target.value===''?null:Number(target.value);
    const action=target.closest('[data-reward-public-action]');
    if (action && target.hasAttribute('data-reward-action-label')) {const a=draft.public.actions.find(a=>a.id===action.dataset.rewardPublicAction);if(a)a.label=target.value;}
    const row=target.closest('[data-reward-loot]');
    if (row && !alreadyIssued(entry)) {const item=entry.items.find(i=>i.id===row.dataset.rewardLoot);if(item && target.hasAttribute('data-reward-loot-name'))item.name=target.value;if(item && target.hasAttribute('data-reward-loot-quantity'))item.quantity=target.value===''?null:Number(target.value);}
    const statBox=target.closest('[data-reward-loot-stats]');
    if(statBox && !alreadyIssued(entry)) {
      const loot=entry.items.find(i=>i.id===statBox.dataset.rewardLootStats);
      if(loot){const values=lootStats(loot);if(target.dataset.gmiStat)values.stats[target.dataset.gmiStat]=target.value;if(target.dataset.gmiVector){values.stats[target.dataset.gmiVector]??={};values.stats[target.dataset.gmiVector][target.dataset.gmiVectorType]=target.value;}}
    }
    if (target.hasAttribute('data-reward-search')) {catalogSearch=target.value;const select=document.querySelector('[data-reward-catalog]');if(select)select.innerHTML=catalogOptions();}
  });
  document.addEventListener('change',event => {
    const target=event.target;
    if (!target.closest('[data-reward-editor]') || !draft) return;
    const entry=result();
    if (!alreadyIssued(entry)) {
      if (target.hasAttribute('data-reward-player-selectable')) entry.playerSelectable=target.checked;
      if (target.hasAttribute('data-reward-action-binding')) {
        if (target.value) entry.actionId=target.value;
        else delete entry.actionId;
      }
      const kind=target.dataset.rewardEffect, effectId=target.dataset.effectId;
      if (['flags','secrets','threads','relations','nextScenes'].includes(kind) && id(effectId)) {
        entry.effects ??={};
        const values=(entry.effects[kind] || []).filter(value=>(kind==='nextScenes'?value:value.id)!==effectId);
        if (kind==='nextScenes' && target.checked) values.push(effectId);
        if (kind==='relations' && target.checked) values.push({id:effectId});
        if (kind==='flags' && target.value) values.push({id:effectId,value:target.value});
        if (kind==='secrets' && target.value) values.push({id:effectId,revealed:target.value==='true'});
        if (kind==='threads' && target.value) values.push({id:effectId,status:target.value});
        entry.effects[kind]=values;
        const count=document.querySelector('[data-reward-effect-count]');
        if (count) count.textContent=String(effectCount(entry));
      }
    }
    if (target.hasAttribute('data-reward-completion') && !alreadyIssued(result())) {const entry=result();entry.completion=target.checked;entry.onceKey=entry.completion?completionKey(editingScene,baseQuest(editingScene)):('event-'+entry.id).slice(0,128);}
    if (target.hasAttribute('data-reward-catalog')) {selectedItem=target.value;const node=document.querySelector('[data-reward-outcome-body]');if(node)node.innerHTML=outcomeBody();}
  });
  window.gmSceneRewardValid=valid;
  window.gmSceneRewardQuest=quest;
  window.gmSceneRewardPublic=publicCard;
  window.gmSceneRewardSettings=settings;
  window.gmSceneRewardOpen=open;
})();
