'use strict';
/* Stock belongs to the room. This form only sends deliberate GM operations. */
(function () {
  const categories = [['melee','Холодное оружие'],['unarmed','Рукопашное оружие'],['light','Лёгкое оружие'],['heavy','Тяжёлое оружие'],['throwing','Метательное оружие'],['energy','Энергетическое оружие'],['explosive','Взрывчатка'],['armor','Броня'],['consumable','Расходник'],['medicine','Лекарство'],['food','Еда'],['ammo','Боеприпасы'],['currency','Крышки и деньги'],['tool','Инструмент'],['craft','Материал для крафта'],['misc','Предмет'],['other','Другой предмет']];
  const numericStats = [['apCost','Стоимость, ОД'],['magazine','Магазин'],['minStrength','Минимальная сила'],['armorClass','Класс брони'],['weight','Вес'],['price','Цена'],['reloadAp','Перезарядка, ОД'],['slots','Размер, клеток'],['radiationReduction','Снятие радиации'],['agilityDivisor','Делитель ловкости для КБ']];
  const textStats = [['damageFormula','Формула урона'],['healingFormula','Формула лечения'],['damage','Описание урона'],['range','Дальность'],['ammo','Боеприпасы'],['damageType','Тип урона'],['modifiers','Особенности'],['effect','Эффект применения']];
  const resistances = [['normal','Норма'],['laser','Лазер'],['fire','Огонь'],['plasma','Плазма'],['electric','Электро'],['explosive','Взрыв']];
  const vectorStats = [['resistances','Защита по правилам группы','res',-1000000,1000000],['damageThresholds','Порог урона · поглощение','threshold',0,1000],['resistancePercent','Сопротивление урону, %','percent',0,100]];
  const vectorTypes = key => key==='resistances' ? resistances : [...resistances,['emp','ЭМИ']];
  const form = {open:false,mode:'catalog',search:'',categoryFilter:'',sourceFilter:'',visible:24,catalogId:'',catalogDraft:null,catalogEditorOpen:false,quantity:'1',recipientId:'',name:'',category:'other',consumable:false,stats:{}};
  let busy = false, feedback = '', feedbackError = false, pendingAdd = null, pendingEdit = null, pendingRemove = null;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
  const catalog = () => Array.isArray(window.NITI_ITEM_CATALOG) ? window.NITI_ITEM_CATALOG : [];
  const snapshot = () => typeof window.gmSessionSnapshot === 'function' ? window.gmSessionSnapshot() : null;
  const itemValue = value => value === null || value === undefined || value === '' ? 'Не указано' : String(value);
  const operationId = () => crypto.randomUUID();
  const clone = value => JSON.parse(JSON.stringify(value));
  const sourceId = item => /olympus|олимп|2207/i.test(item.id+' '+(item.source?.game || '')+' '+(item.source?.label || '')) ? 'olympus' : item.id.startsWith('fo2-') ? 'fallout2' : 'book';
  const sourceName = item => ({olympus:'Olympus 2207',fallout2:'Fallout 2',book:'Правила группы'})[sourceId(item)];
  const safeImage = item => !item?.source?.art?.nativeBlank && typeof item?.image === 'string' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(item.image) ? item.image : '';
  function sameValue(a,b) {if(a == null && b == null)return true;if(a && b && typeof a==='object' && typeof b==='object')return JSON.stringify(Object.fromEntries(Object.entries(a).sort()))===JSON.stringify(Object.fromEntries(Object.entries(b).sort()));return a===b;}
  function statsPatch(stats, original={}) {return Object.fromEntries(Object.entries(stats).filter(([key,value])=>!sameValue(value,original[key])));}
  function ensureCatalogDraft(item) {
    if(!item)return null;
    if(form.catalogDraft?.id!==item.id)form.catalogDraft={id:item.id,name:item.name,consumable:typeof item.consumable==='boolean' ? item.consumable : ['consumable','medicine','food','ammo','explosive'].includes(item.category),stats:clone(item.stats || {})};
    return form.catalogDraft;
  }

  function fields(stats = {}, prefix = 'gmi-custom') {
    const input = (name,label,value,numeric) => `<label class="gmi-field" for="${prefix}-${name}"><span>${label}</span><input class="input" id="${prefix}-${name}" name="stat-${name}" data-gmi-stat="${name}" ${numeric && !(typeof value==='string' && !Number.isFinite(Number(value))) ? 'type="number" step="any" min="0" max="1000000"' : 'type="text" maxlength="1000"'} value="${escape(value ?? '')}" placeholder="${name==='damageFormula' ? 'Например, 2d6 + S' : name==='healingFormula' ? 'Например, 2d10 + 10' : 'Не указано'}"></label>`;
    return `<p class="gmi-formula-help">Формула используется для броска. Например: <strong>2d6 + 3</strong> или <strong>1d10 + S</strong>, где S — сила персонажа. Описания и условные эффекты сохраняются отдельно.</p><div class="gmi-stat-form">${textStats.map(([name,label]) => input(name,label,stats[name],false)).join('')}${numericStats.map(([name,label]) => input(name,label,stats[name],true)).join('')}</div><details class="gmi-protection" ${vectorStats.some(([key])=>Object.values(stats[key] || {}).some(value=>value!==null && value!==''))?'open':''}><summary>Защита и поглощение урона</summary>${vectorStats.map(([key,label,field,min,max])=>`<fieldset class="gmi-resistances"><legend>${label}</legend><p>${key==='resistances'?'Прежние значения вашей группы со знаком сохраняются.':key==='resistancePercent'?'Процент применяется после порога урона. От 0 до 100.':'Плоское поглощение урона выбранного типа. От 0 до 1 000.'}</p><div>${vectorTypes(key).map(([name,title])=>`<label class="gmi-field" for="${prefix}-${field}-${name}"><span>${title}</span><input class="input" id="${prefix}-${field}-${name}" name="${field}-${name}" data-gmi-vector="${key}" data-gmi-vector-type="${name}" type="number" step="1" min="${min}" max="${max}" value="${escape(stats[key]?.[name] ?? '')}" placeholder="—"></label>`).join('')}</div></fieldset>`).join('')}</details>`;
  }

  function readStats(data, original = {}) {
    const stats = {...original};
    for (const [key] of textStats) {
      const value = String(data.get('stat-'+key) || '').trim() || null;
      stats[key] = original[key] != null && String(original[key]) === value ? original[key] : value;
    }
    for (const [key] of numericStats) {
      const raw = String(data.get('stat-'+key) ?? '').trim();
      if(['price','weight'].includes(key) && typeof original[key]==='string' && raw===original[key]){stats[key]=original[key];continue;}
      if(['price','weight'].includes(key) && raw && !Number.isFinite(Number(raw))){if(raw.length>1000)throw new Error('Вес и цена должны быть не длиннее 1000 символов.');stats[key]=raw;continue;}
      stats[key] = raw === '' ? null : Number(raw);
      if (stats[key] !== null && (!Number.isFinite(stats[key]) || stats[key] < 0 || stats[key] > 1000000)) throw new Error('Числовые характеристики должны быть от 0 до 1 000 000.');
    }
    for(const [key,,field,min,max] of vectorStats) {
      const protection={};
      for(const [type] of vectorTypes(key)){
        const raw=String(data.get(field+'-'+type) ?? '').trim();if(raw===''){if(Object.hasOwn(original[key] || {},type))protection[type]=null;continue;}
        const value=Number(raw);
        if(!Number.isInteger(value)||value<min||value>max)throw new Error(key==='resistancePercent'?'Сопротивление — целый процент от 0 до 100.':key==='damageThresholds'?'Порог урона — целое число от 0 до 1 000.':'Защита задаётся целыми числами со знаком.');
        protection[type]=value;
      }
      stats[key]=Object.keys(protection).length?protection:null;
    }
    for(const key of ['damageFormula','healingFormula'])if(stats[key]){
      if(!window.EquipmentRules?.parseFormula(stats[key],{allowStrength:key!=='healingFormula'}))throw new Error('Некорректная формула: используй d4, d6, d8, d10, d12, d20, d100, числа и +S.');
      stats[key]=window.EquipmentRules.formatFormula(stats[key]);
    }
    if(!sameValue(stats.damage,original.damage) && sameValue(window.EquipmentRules?.formatFormula(stats.damageFormula) || stats.damageFormula,window.EquipmentRules?.formatFormula(original.damageFormula) || original.damageFormula)) {
      const before=window.EquipmentRules?.weaponFormula({damage:original.damage}) || '';
      const after=window.EquipmentRules?.weaponFormula({damage:stats.damage}) || '';
      if(before!==after)stats.damageFormula=after || null;
    }
    if (!sameValue(stats.range,original.range)) { stats.rangeFormula = null; stats.rangeBonus = null; }
    const validation=window.EquipmentRules?.validateEquipmentStats?.(statsPatch(stats,original));
    if(validation && !validation.valid)throw new Error(validation.errors?.[0] || 'Проверь характеристики предмета.');
    return stats;
  }

  function readStatsFromNode(node, original={}) {return readStats({get:name=>node.querySelector(`[name="${name}"]`)?.value ?? null},original);}
  function readStatsValues(stats, original={}) {return readStats({get:name=>{if(name.startsWith('stat-'))return stats[name.slice(5)] ?? '';for(const [key,,prefix] of vectorStats)if(name.startsWith(prefix+'-'))return stats[key]?.[name.slice(prefix.length+1)] ?? '';return '';}},original);}
  function validateStatsPatch(stats) {
    if(!stats || typeof stats!=='object' || Array.isArray(stats))return false;
    if(window.EquipmentRules?.validateEquipmentStats)return window.EquipmentRules.validateEquipmentStats(stats).valid;
    const keys=[...textStats,...numericStats].map(([key])=>key).concat(['rangeFormula','rangeBonus'],vectorStats.map(([key])=>key));
    return Object.entries(stats).every(([key,value])=>{
      if(!keys.includes(key))return false;if(value===null)return true;
      if(vectorStats.some(([name])=>name===key)){const [,,,min,max]=vectorStats.find(([name])=>name===key);return value && typeof value==='object' && !Array.isArray(value) && Object.entries(value).every(([name,n])=>vectorTypes(key).some(([type])=>type===name) && (n===null || Number.isInteger(n) && n>=min && n<=max));}
      if(key==='damageFormula'||key==='healingFormula')return typeof value==='string' && !!window.EquipmentRules?.parseFormula(value,{allowStrength:key!=='healingFormula'});
      if(key==='rangeFormula')return value==='perception';
      if(key==='rangeBonus')return Number.isFinite(value) && Math.abs(value)<=1000000;
      if(numericStats.some(([name])=>name===key))return Number.isFinite(value) && value>=0 && value<=1000000;
      return (typeof value==='string' || typeof value==='number') && String(value).length<=1000;
    });
  }

  function statPreview(item) {
    if (!item) return '<div class="gmi-preview-empty"><span aria-hidden="true">◇</span><strong>Найди снаряжение для следующей сцены.</strong><p>Выбери предмет ниже: его характеристики можно изменить до выдачи.</p></div>';
    const stats = item.stats || {};
    const range = stats.rangeFormula === 'perception' ? `Восприятие персонажа${Number(stats.rangeBonus) ? ' ' + (stats.rangeBonus > 0 ? '+' : '−') + Math.abs(stats.rangeBonus) : ''}` : stats.range;
    const statsList = [['Бросок урона',stats.damageFormula || stats.damage],['Бросок лечения',stats.healingFormula],['Стоимость, ОД',stats.apCost],['Дальность',range],['Боеприпасы',stats.ammo],['Магазин',stats.magazine],['Мин. СИЛ',stats.minStrength],['Класс брони',stats.armorClass],['Перезарядка, ОД',stats.reloadAp],['Тип урона',stats.damageType]];
    return `<div class="gmi-preview">${safeImage(item) ? `<div class="gmi-preview-art"><img src="${escape(item.image)}" alt=""></div>` : ''}<div><span class="eyebrow">${escape(item.categoryLabel || categories.find(([id]) => id===item.category)?.[1] || 'ПРЕДМЕТ')} · ${sourceName(item)}</span><h3>${escape(item.name)}</h3><dl>${statsList.filter(([,value])=>value!==null && value!==undefined && value!=='').map(([label,value])=>`<div><dt>${label}</dt><dd>${escape(itemValue(value))}</dd></div>`).join('')}</dl>${stats.modifiers ? `<p>${escape(stats.modifiers)}</p>` : ''}${stats.effect ? `<p>${escape(stats.effect)}</p>` : ''}${item.source?.art?.nativeBlank ? '<p class="gmi-source-note">В оригинальных ресурсах игры у этого предмета нет отдельного изображения (blank.frm).</p>' : ''}${item.adaptation?.note ? `<p class="gmi-source-note">${escape(item.adaptation.note)}</p>` : ''}${item.warnings?.length ? `<p class="gmi-source-note">${item.warnings.map(escape).join(' ')}</p>` : ''}</div></div>`;
  }
  function filteredCatalog() {
    const search=form.search.trim().toLocaleLowerCase('ru');
    return catalog().filter(item=>(!form.categoryFilter || item.category===form.categoryFilter) && (!form.sourceFilter || sourceId(item)===form.sourceFilter) && (!search || `${item.name} ${item.categoryLabel || ''} ${item.description || ''} ${sourceName(item)}`.toLocaleLowerCase('ru').includes(search)));
  }
  function selectOptions() {
    const list=filteredCatalog(),selected=catalog().find(item=>item.id===form.catalogId);
    if(selected && !list.some(item=>item.id===selected.id))list.unshift(selected);
    return '<option value="">Выбрать предмет…</option>'+list.map(item=>`<option value="${escape(item.id)}" ${form.catalogId===item.id?'selected':''}>${escape(item.name)} · ${escape(item.categoryLabel || item.category)}</option>`).join('');
  }
  function catalogCards() {
    const items=filteredCatalog(),shown=items.slice(0,form.visible);
    return `<div class="gmi-catalog-result-top"><span role="status">Найдено <strong>${items.length}</strong> из ${catalog().length}</span>${form.search || form.categoryFilter || form.sourceFilter ? '<button type="button" class="text-button" data-gmi-action="clear-filters">Сбросить фильтры</button>' : ''}</div><div class="gmi-catalog-grid">${shown.map(item=>`<button type="button" id="gmi-card-${escape(item.id)}" class="gmi-catalog-card ${form.catalogId===item.id?'is-selected':''}" data-gmi-action="select-catalog" data-gmi-catalog-id="${escape(item.id)}" aria-pressed="${form.catalogId===item.id}" title="${escape(item.name)}"><span class="gmi-catalog-art">${safeImage(item)?`<img src="${escape(item.image)}" alt="" loading="lazy">`:`<span aria-hidden="true">◇</span>${item.source?.art?.nativeBlank ? '<small>В игре нет спрайта</small>' : ''}`}</span><span class="gmi-card-source">${sourceName(item)}</span><strong>${escape(item.name)}</strong><small>${escape(item.categoryLabel || categories.find(([id])=>id===item.category)?.[1] || 'Снаряжение')}</small><span class="gmi-card-stat">${escape(item.stats?.damageFormula || item.stats?.healingFormula || (item.stats?.armorClass!=null?'КБ '+item.stats.armorClass:item.stats?.damage || 'Осмотреть'))}</span></button>`).join('') || '<div class="gmi-catalog-empty"><strong>Ничего не найдено.</strong><p>Попробуй другое название или убери один из фильтров.</p></div>'}</div>${items.length>shown.length?`<button type="button" class="button ghost gmi-catalog-more" data-gmi-action="more">Показать ещё ${Math.min(24,items.length-shown.length)} · осталось ${items.length-shown.length}</button>`:''}`;
  }
  function refreshCatalogResults() {
    const select=document.getElementById('gmi-catalog');if(select)select.innerHTML=selectOptions();
    const grid=document.querySelector('[data-gmi-catalog-results]');if(grid)grid.innerHTML=catalogCards();
  }
  function selectedPreview() {
    const selected=catalog().find(item=>item.id===form.catalogId),draft=ensureCatalogDraft(selected);
    if(!selected)return statPreview(null);
    return statPreview({...selected,name:draft.name,stats:draft.stats})+`<details class="gmi-catalog-editor" id="gmi-catalog-stats" data-gmi-catalog-editor ${form.catalogEditorOpen?'open':''}><summary><span>Характеристики перед выдачей</span><small>Можно изменить только этот экземпляр</small></summary><div class="gmi-catalog-editor-body"><div class="gmi-draft-heading"><p>Каталог останется прежним. Изменённые значения получит только эта выдача.</p><button type="button" class="button ghost small" data-gmi-action="reset-catalog">Вернуть параметры каталога</button></div><label class="gmi-field" for="gmi-catalog-name"><span>Название при выдаче</span><input class="input" id="gmi-catalog-name" name="catalog-name" data-gmi-catalog-meta="name" maxlength="180" value="${escape(draft.name)}"></label><label class="gmi-checkbox"><input type="checkbox" name="catalog-consumable" data-gmi-catalog-meta="consumable" ${draft.consumable?'checked':''}> Расходуется при использовании</label>${fields(draft.stats,'gmi-catalog')}</div></details>`;
  }
  function stocks(room) {
    const entries = (room?.sharedItems || []).map(item => ({item,owner:'Общий тайник',shared:true}));
    for (const member of room?.players || []) for (const item of member.inventory || []) entries.push({item,owner:member.name,shared:false});
    return entries;
  }

  function controls() {
    const room=snapshot();if(!room)return '';
    const rows=stocks(room),selected=catalog().find(item=>item.id===form.catalogId);
    const groups=[...new Map(catalog().map(item=>[item.category,item.categoryLabel || categories.find(([id])=>id===item.category)?.[1] || item.category])).entries()];
    return `<section class="panel gmi-panel" id="gmInventoryRoot"><details data-gmi-details ${form.open?'open':''}><summary><span><span class="eyebrow">АРСЕНАЛ И ОБЩАЯ ДОБЫЧА</span><strong>Снаряжение группы</strong></span><span class="gmi-summary-count">${rows.length} поз. в комнате</span></summary><div class="gmi-body"><p class="gmi-intro">Выбери снаряжение, настрой характеристики и передай вещи в тайник или конкретному герою.</p><div class="gmi-mode" role="group" aria-label="Источник предмета"><button type="button" class="button ${form.mode==='catalog'?'primary':'ghost'} small" data-gmi-action="catalog">Каталог снаряжения</button><button type="button" class="button ${form.mode==='custom'?'primary':'ghost'} small" data-gmi-action="custom">Свой предмет</button></div><form id="gmInventoryAddForm"><fieldset class="gmi-mode-fields" ${form.mode==='catalog'?'':'disabled hidden'}><div class="gmi-catalog-filters"><label class="gmi-field gmi-search-field" for="gmi-search"><span>Найти снаряжение</span><input class="input" id="gmi-search" name="search" data-gmi-input="search" value="${escape(form.search)}" type="search" maxlength="180" placeholder="Название, эффект или тип предмета…"></label><label class="gmi-field" for="gmi-category-filter"><span>Категория</span><select class="input" id="gmi-category-filter" data-gmi-input="categoryFilter"><option value="">Все категории</option>${groups.map(([id,name])=>`<option value="${escape(id)}" ${form.categoryFilter===id?'selected':''}>${escape(name)}</option>`).join('')}</select></label><label class="gmi-field" for="gmi-source-filter"><span>Источник</span><select class="input" id="gmi-source-filter" data-gmi-input="sourceFilter"><option value="">Все источники</option><option value="olympus" ${form.sourceFilter==='olympus'?'selected':''}>Olympus 2207</option><option value="book" ${form.sourceFilter==='book'?'selected':''}>Правила группы</option><option value="fallout2" ${form.sourceFilter==='fallout2'?'selected':''}>Fallout 2</option></select></label></div><div class="gmi-catalog-results" data-gmi-catalog-results>${catalogCards()}</div><label class="gmi-field gmi-select-fallback" for="gmi-catalog"><span>Быстрый выбор из списка</span><select class="input" id="gmi-catalog" name="catalogId" data-gmi-input="catalogId">${selectOptions()}</select></label><fieldset class="gmi-selected-fields" ${selected?'':'disabled'}><div data-gmi-preview>${selectedPreview()}</div></fieldset></fieldset><fieldset class="gmi-mode-fields" ${form.mode==='custom'?'':'disabled hidden'}><div class="gmi-add-meta"><label class="gmi-field" for="gmi-name"><span>Название</span><input class="input" id="gmi-name" name="name" data-gmi-input="name" maxlength="180" value="${escape(form.name)}" placeholder="Название предмета"></label><label class="gmi-field" for="gmi-category"><span>Вид предмета</span><select class="input" id="gmi-category" name="category" data-gmi-input="category">${categories.map(([id,label])=>`<option value="${id}" ${form.category===id?'selected':''}>${label}</option>`).join('')}</select></label></div><label class="gmi-checkbox"><input type="checkbox" name="consumable" data-gmi-input="consumable" ${form.consumable?'checked':''}> Расходуется при использовании</label>${fields(form.stats)}</fieldset><div class="gmi-issue-section"><div class="gmi-add-meta"><label class="gmi-field" for="gmi-quantity"><span>Количество</span><input class="input" id="gmi-quantity" name="quantity" data-gmi-input="quantity" type="number" min="1" max="9999" step="1" required value="${escape(form.quantity)}"></label><label class="gmi-field" for="gmi-recipient"><span>Кому передать</span><select class="input" id="gmi-recipient" name="recipientId" data-gmi-input="recipientId"><option value="">Общий тайник группы</option>${(room.players || []).map(member=>`<option value="${escape(member.id)}" ${form.recipientId===member.id?'selected':''}>${escape(member.name)}</option>`).join('')}</select></label></div><div class="gmi-submit-row"><button class="button primary" type="submit" ${busy?'disabled':''}>${busy?'Передаю…':'Выдать снаряжение'}</button><span class="gmi-feedback ${feedbackError?'is-error':''}" data-gmi-feedback role="status">${escape(feedback)}</span></div></div></form><div class="gmi-owned-heading"><h3>Вещи группы <span class="badge">${rows.length}</span></h3><p>Количество и владелец сохраняются при изменении характеристик.</p></div><div class="gmi-stock-list">${rows.length?rows.map(({item,owner,shared})=>`<div class="gmi-stock-row">${safeImage(item)?`<img class="gmi-stock-art" src="${escape(item.image)}" alt="" loading="lazy">`:''}<div class="gmi-stock-copy"><strong>${escape(item.name)} <b>× ${escape(item.quantity)}</b></strong><span>${escape(owner)}</span></div><div class="gmi-stock-actions"><button type="button" class="button ghost small" data-gmi-action="edit" data-gmi-item="${escape(item.id)}" ${busy?'disabled':''}>Характеристики</button>${shared?`<button type="button" class="button ghost small gmi-remove-button" data-gmi-action="remove" data-gmi-item="${escape(item.id)}" ${busy?'disabled':''}>Удалить</button>`:''}</div></div>`).join(''):'<p class="gmi-muted">Вещей пока нет. Выдай предмет из каталога или добавь собственный.</p>'}</div></div></details></section>`;
  }

  function redraw() {
    const root = document.getElementById('gmInventoryRoot');
    if (!root) return;
    const focused = root.contains(document.activeElement) ? document.activeElement?.id : null;
    root.outerHTML = controls();
    if (focused) document.getElementById(focused)?.focus({preventScroll:true});
  }

  function setFeedback(message, error=false) {
    feedback=message; feedbackError=error;
    const node=document.querySelector('[data-gmi-feedback]');
    if(node){node.textContent=message;node.classList.toggle('is-error',error);}
  }

  async function add(data) {
    if(busy)return;
    const quantity=Number(data.get('quantity'));
    if(!Number.isInteger(quantity)||quantity<1||quantity>9999){setFeedback('Количество — целое число от 1 до 9999.',true);return;}
    let operation={action:'add',quantity,recipientId:String(data.get('recipientId')||'')||null};
    try {
      if(form.mode==='catalog'){
        const catalogId=String(data.get('catalogId')||'');
        const selected=catalog().find(item=>item.id===catalogId);
        if(!selected)throw new Error('Выбери предмет из каталога.');
        operation.catalogId=catalogId;
        const draft=ensureCatalogDraft(selected),name=String(data.get('catalog-name') || '').trim();
        if(!name || name.length>180)throw new Error('Введи название предмета, до 180 символов.');
        const patch=statsPatch(readStats(data,selected.stats || {}),selected.stats || {});
        if(Object.keys(patch).length)operation.stats=patch;
        if(name!==selected.name)operation.name=name;
        if(data.has('catalog-consumable')!==(typeof selected.consumable==='boolean'?selected.consumable:['consumable','medicine','food','ammo','explosive'].includes(selected.category)))operation.consumable=data.has('catalog-consumable');
      }else{
        const name=String(data.get('name')||'').trim();
        if(!name||name.length>180)throw new Error('Введи название предмета, до 180 символов.');
        operation={...operation,name,category:String(data.get('category')||'other'),consumable:data.has('consumable'),stats:readStats(data,form.stats)};
      }
      const fingerprint=JSON.stringify({room:snapshot()?.id,...operation});
      if(!pendingAdd||pendingAdd.fingerprint!==fingerprint)pendingAdd={fingerprint,id:operationId()};
      busy=true;feedback='Передаю в комнату…';feedbackError=false;redraw();
      await window.gmSessionInventoryAction({...operation,operationId:pendingAdd.id});
      pendingAdd=null;feedback=`Добавлено: ${quantity}. Вещи доступны в комнате.`;feedbackError=false;
    }catch(error){feedback=error.message||'Не удалось добавить вещи. Повтори действие.';feedbackError=true;}
    finally{busy=false;redraw();}
  }

  function edit(id) {
    const item=stocks(snapshot()).find(row=>row.item.id===id)?.item;
    if(!item||typeof modal!=='function')return;
    const itemCategories=categories.some(([id])=>id===item.category)?categories:[[item.category || 'other',item.categoryLabel || 'Текущий вид предмета'],...categories];
    const content=`<p class="gmi-intro">Изменяются характеристики существующего предмета. Количество и владелец сохраняются.</p><label class="gmi-field" for="gmi-edit-name"><span>Название</span><input class="input" id="gmi-edit-name" name="item-name" maxlength="180" required value="${escape(item.name)}"></label><label class="gmi-field" for="gmi-edit-category"><span>Вид предмета</span><select class="input" id="gmi-edit-category" name="item-category">${itemCategories.map(([id,label])=>`<option value="${escape(id)}" ${item.category===id?'selected':''}>${escape(label)}</option>`).join('')}</select></label><label class="gmi-checkbox" for="gmi-edit-consumable"><input type="checkbox" id="gmi-edit-consumable" name="item-consumable" ${item.consumable?'checked':''}> Расходуется при использовании</label>${fields(item.stats,'gmi-edit')}<div class="gmi-feedback" id="gmiEditFeedback" role="status"></div>`;
    modal('Характеристики предмета',content,async data=>{
      if(busy)return;
      let operation;
      try{
        const name=String(data.get('item-name')||'').trim();
        if(!name||name.length>180)throw new Error('Введи название предмета.');
        operation={action:'edit',itemId:item.id,stats:statsPatch(readStats(data,item.stats || {}),item.stats || {})};
        if(name!==item.name)operation.name=name;
        const category=String(data.get('item-category') || item.category || 'other');if(category!==item.category)operation.category=category;
        if(data.has('item-consumable')!==item.consumable)operation.consumable=data.has('item-consumable');
        const fingerprint=JSON.stringify({room:snapshot()?.id,...operation});
        if(!pendingEdit||pendingEdit.fingerprint!==fingerprint)pendingEdit={fingerprint,id:operationId()};
        busy=true;
        const button=document.querySelector('#dialogForm [type="submit"]');if(button){button.disabled=true;button.textContent='Сохраняю…';}
        await window.gmSessionInventoryAction({...operation,operationId:pendingEdit.id});
        pendingEdit=null;
        closeModal();setFeedback('Характеристики предмета обновлены.');
      }catch(error){const node=document.getElementById('gmiEditFeedback');if(node){node.textContent=error.message||'Не удалось сохранить. Повтори действие.';node.classList.add('is-error');}}
      finally{busy=false;const button=document.querySelector('#dialogForm [type="submit"]');if(button){button.disabled=false;button.textContent='Сохранить';}redraw();}
    },'',true);
  }

  function remove(id) {
    if (busy || typeof modal !== 'function') return;
    const item = snapshot()?.sharedItems?.find(entry => entry.id === id);
    if (!item) { setFeedback('Этого предмета уже нет в общем тайнике.',true); return; }
    const roomId = snapshot()?.id;
    const retry = pendingRemove?.roomId === roomId && pendingRemove.operation.itemId === id ? pendingRemove : null;
    const locked = retry?.uncertain === true;
    const all = retry?.operation.all === true;
    const content = `<p class="gmi-delete-warning"><strong>Удалить «${escape(item.name)}» навсегда?</strong> Экземпляры будут уничтожены из общего тайника. Вернуть их этим действием нельзя. Вещи, которые уже забрали персонажи, остаются у владельцев.</p><p class="gmi-intro">Сейчас в тайнике: <strong>× ${escape(item.quantity)}</strong>.</p><label class="gmi-field" for="gmi-remove-mode"><span>Что удалить</span><select class="input" id="gmi-remove-mode" name="remove-mode" ${locked?'disabled':''}><option value="quantity" ${all?'':'selected'}>Указанное количество</option><option value="all" ${all?'selected':''}>Все оставшиеся экземпляры</option></select></label><label class="gmi-field" for="gmi-remove-quantity"><span>Количество</span><input class="input" id="gmi-remove-quantity" name="remove-quantity" type="number" min="1" max="${Math.min(9999,Number(item.quantity))}" step="1" value="${escape(retry?.operation.quantity || 1)}" ${locked||all?'disabled':''}></label><p class="gmi-source-note">При выборе «Все» удаляется доступный остаток в момент подтверждения сервером.</p><div class="gmi-feedback ${locked?'is-error':''}" id="gmiRemoveFeedback" role="status">${locked?'Подтверждение не получено. Повтори тот же запрос; повторное удаление не произойдёт.':''}</div>`;
    const footer = '<button type="button" class="button ghost" data-action="close-modal">Отмена</button><button class="button primary gmi-remove-button" type="submit">'+(locked?'Повторить удаление':'Удалить навсегда')+'</button>';
    modal('Удаление из общего тайника',content,async data=>{
      if (busy) return;
      let submitted = false;
      try {
        let operation;
        if (pendingRemove?.uncertain && pendingRemove.roomId === roomId && pendingRemove.operation.itemId === id) operation = pendingRemove.operation;
        else {
          const all = data.get('remove-mode') === 'all';
          const quantity = Number(data.get('remove-quantity'));
          if (!all && (!Number.isInteger(quantity) || quantity < 1 || quantity > Math.min(9999,Number(item.quantity)))) throw new Error('Укажи доступное целое количество от 1 до '+Math.min(9999,Number(item.quantity))+'.');
          const payload = {action:'remove',itemId:id,...(all?{all:true}:{quantity})};
          const fingerprint = JSON.stringify({room:roomId,...payload});
          if (!pendingRemove || pendingRemove.fingerprint !== fingerprint) pendingRemove = {roomId,fingerprint,operation:{...payload,operationId:operationId()},uncertain:false};
          operation = pendingRemove.operation;
        }
        busy = true;
        const button = document.querySelector('#dialogForm [type="submit"]'); if (button) { button.disabled = true; button.textContent = 'Удаляю…'; }
        submitted = true;
        await window.gmSessionInventoryAction(operation);
        pendingRemove = null;
        closeModal(); setFeedback('Предметы навсегда удалены из общего тайника.');
      } catch (error) {
        const uncertain = submitted && (!Number(error.status) || Number(error.status) >= 500);
        if (pendingRemove && uncertain) {
          pendingRemove.uncertain = true;
          for (const input of document.querySelectorAll('#dialogForm select,#dialogForm input')) input.disabled = true;
        } else if (!uncertain) pendingRemove = null;
        const node = document.getElementById('gmiRemoveFeedback');
        if (node) { node.textContent = uncertain && pendingRemove ? 'Подтверждение не получено. Повтори тот же запрос; повторное удаление не произойдёт.' : error.message || 'Не удалось удалить предметы.'; node.classList.add('is-error'); }
      } finally {
        busy = false;
        const button = document.querySelector('#dialogForm [type="submit"]'); if (button) { button.disabled = false; button.textContent = pendingRemove?.uncertain ? 'Повторить удаление' : 'Удалить навсегда'; }
        redraw();
      }
    },footer);
  }

  document.addEventListener('toggle',event=>{
    if(event.target.matches?.('[data-gmi-details]'))form.open=event.target.open;
    if(event.target.matches?.('[data-gmi-catalog-editor]'))form.catalogEditorOpen=event.target.open;
  },true);
  document.addEventListener('input',event=>{
    const input=event.target;if(!input.closest('#gmInventoryAddForm'))return;
    if(input.dataset.gmiInput)form[input.dataset.gmiInput]=input.type==='checkbox'?input.checked:input.value;
    const selected=catalog().find(item=>item.id===form.catalogId),draft=form.mode==='catalog'?ensureCatalogDraft(selected):null;
    const stats=draft?.stats || form.stats;
    if(input.dataset.gmiStat)stats[input.dataset.gmiStat]=input.value;
    if(input.dataset.gmiVector){stats[input.dataset.gmiVector]??={};stats[input.dataset.gmiVector][input.dataset.gmiVectorType]=input.value;}
    if(input.dataset.gmiCatalogMeta && draft)draft[input.dataset.gmiCatalogMeta]=input.type==='checkbox'?input.checked:input.value;
    if(input.dataset.gmiInput==='search'){form.visible=24;refreshCatalogResults();}
  });
  document.addEventListener('change',event=>{
    if(event.target.id==='gmi-remove-mode'){const quantity=document.getElementById('gmi-remove-quantity');if(quantity)quantity.disabled=event.target.value==='all';return;}
    const input=event.target;if(!input.closest('#gmInventoryAddForm'))return;
    if(input.dataset.gmiInput)form[input.dataset.gmiInput]=input.type==='checkbox'?input.checked:input.value;
    if(input.dataset.gmiInput==='catalogId'){
      ensureCatalogDraft(catalog().find(item=>item.id===form.catalogId));redraw();
    }
    if(['categoryFilter','sourceFilter'].includes(input.dataset.gmiInput)){form.visible=24;refreshCatalogResults();}
    if(input.dataset.gmiInput==='category' && ['consumable','ammo','explosive','medicine','food'].includes(form.category)){form.consumable=true;const checkbox=document.querySelector('[data-gmi-input="consumable"]');if(checkbox)checkbox.checked=true;}
  });
  document.addEventListener('submit',event=>{if(event.target.id==='gmInventoryAddForm'){event.preventDefault();void add(new FormData(event.target));}});
  document.addEventListener('click',event=>{
    const button=event.target.closest('[data-gmi-action]');if(!button || button.disabled)return;
    const action=button.dataset.gmiAction;
    if(action==='catalog'||action==='custom'){form.mode=action;form.open=true;redraw();}
    if(action==='select-catalog'){form.catalogId=button.dataset.gmiCatalogId;ensureCatalogDraft(catalog().find(item=>item.id===form.catalogId));form.open=true;redraw();document.querySelector('[data-gmi-preview]')?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'nearest'});}
    if(action==='more'){form.visible+=24;refreshCatalogResults();}
    if(action==='clear-filters'){form.search='';form.categoryFilter='';form.sourceFilter='';form.visible=24;redraw();document.getElementById('gmi-search')?.focus();}
    if(action==='reset-catalog'){form.catalogDraft=null;ensureCatalogDraft(catalog().find(item=>item.id===form.catalogId));form.catalogEditorOpen=true;redraw();setFeedback('Вернул исходные параметры. Изменения в каталоге не сохранялись.');}
    if(action==='edit')edit(button.dataset.gmiItem);
    if(action==='remove')remove(button.dataset.gmiItem);
  });
  window.addEventListener('niti:gm-room',()=>{
    const root=document.getElementById('gmInventoryRoot');
    if(root&&!busy&&!root.contains(document.activeElement))redraw();
  });
  window.GMEquipmentEditor={fields,readStats,readStatsFromNode,readStatsValues,statsPatch,validateStatsPatch,sourceId,sourceName};
  window.gmInventoryControls=controls;
})();
