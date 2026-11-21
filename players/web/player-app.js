'use strict';
const PLAYER_KEY='niti-player-v1';
const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=()=>crypto.randomUUID?.()||Date.now().toString(36)+'-'+Math.random().toString(16).slice(2);
const SPECIAL=[['S','Сила'],['P','Восприятие'],['E','Выносливость'],['C','Харизма'],['I','Интеллект'],['A','Ловкость'],['L','Удача']];
const initial=()=>({kind:'niti-player',version:1,profile:{name:'',concept:'',hp:'',defence:'',inventory:'',description:'',special:Object.fromEntries(SPECIAL.map(([k])=>[k,5]))},notes:[]});
function validPlayer(s){return !!s&&s.kind==='niti-player'&&s.version===1&&(s.sheet===undefined||playerSheetValid(s.sheet))&&s.profile&&['name','concept','hp','defence','inventory','description'].every(k=>typeof s.profile[k]==='string'&&s.profile[k].length<=30000)&&s.profile.special&&SPECIAL.every(([k])=>Number.isInteger(s.profile.special[k])&&s.profile.special[k]>=0&&s.profile.special[k]<=10)&&Array.isArray(s.notes)&&s.notes.length<=1000&&s.notes.every(n=>n&&['id','title','text','date'].every(k=>typeof n[k]==='string')&&n.id.length>0&&n.id.length<120&&n.title.length<=200&&n.text.length<=30000&&Number.isFinite(Date.parse(n.date)))&&new Set(s.notes.map(n=>n.id)).size===s.notes.length;}
let player=initial(),storageOK=true;try{const raw=localStorage.getItem(PLAYER_KEY);if(raw){const data=JSON.parse(raw);if(validPlayer(data))player=data;}}catch{storageOK=false;}
const copyPlayerValue=value=>JSON.parse(JSON.stringify(value));
function characterSnapshot(value){return {profile:copyPlayerValue(value.profile),...(value.sheet?{sheet:copyPlayerValue(value.sheet)}:{})};}
let persistedCharacter=characterSnapshot(player),resetCharacterStorage=false;
window.playerAcceptedCharacter=()=>copyPlayerValue(persistedCharacter);
function publicIdentity(data=persistedCharacter){return window.playerSheetPublicPersona?.(playerSheetNormalize(data.sheet,data.profile)) || {name:'',age:'',gender:'',portrait:''};}
let acceptedIdentitySignature=JSON.stringify(publicIdentity()),identityAuthored=Object.values(publicIdentity()).some(Boolean);
function publishAcceptedIdentity(){const identity=publicIdentity();if(!identityAuthored && !Object.values(identity).some(Boolean))return;window.playerSessionSyncPersona?.(identity);}
let view=location.hash.slice(1)||'home',lastFocus=null;
const pages=[['home','На связи'],['session','Игровая сессия'],['character','Мой персонаж'],['squad','Мой отряд'],['inventory','Инвентарь'],['notes','Мои заметки'],['dice','Кубики'],['help','Справка']];
function icon(key){const shapes={home:'<path d="m3 11 9-8 9 8v10h-6v-7H9v7H3Z"/>',character:'<circle cx="12" cy="7" r="4"/><path d="M4 22v-3a8 8 0 0 1 16 0v3"/>',notes:'<path d="M5 3h14v18H5zM9 7h6m-6 5h6m-6 5h3"/>',dice:'<path d="m12 2 9 5v10l-9 5-9-5V7Zm0 0L7 15h10L12 2ZM3 7l14 8-5 7-5-7 14-8"/>',help:'<circle cx="12" cy="12" r="10"/><path d="M9 8a3 3 0 0 1 6 0c0 3-3 2-3 5m0 3v1"/>'};return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes[key]||shapes.home}</svg>`;}
function head(eyebrow,title,subtitle,actions=''){return `<div class="heading-row"><div><div class="eyebrow">${eyebrow}</div><h1 class="page-title">${title}</h1><p class="subtitle">${subtitle}</p></div><div class="header-actions">${actions}</div></div>`;}
function btn(label,action,cls='',extra=''){return `<button type="button" class="button ${cls}" data-player-action="${action}" ${extra}>${label}</button>`;}
function toast(text){$('#toast').textContent=text;$('#toast').classList.add('visible');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').classList.remove('visible'),3500);}
function characterSaveError(candidate=player){
  const candidateSheet=candidate.sheet || (typeof playerSheetNormalize==='function' ? playerSheetNormalize(null,candidate.profile) : null);
  if(candidateSheet && typeof window.playerSheetAllocationState==='function'){
    const allocation=window.playerSheetAllocationState(candidateSheet);
    if(!allocation.valid)return allocation.error || 'Проверь распределение очков S.P.E.C.I.A.L.';
  }
  const selected=candidateSheet?.rules?.perks || [];
  if((persistedCharacter.sheet?.rules?.perks || []).some(entry=>!selected.some(next=>next.id===entry.id && next.rank>=entry.rank)))return 'Выбранные перки закреплены: их нельзя убрать или заменить. Для нового персонажа сначала удали текущего.';
  return '';
}
function playerArchiveState(){
  if(!resetCharacterStorage)syncStoredItemEffects();
  const error=characterSaveError();
  if(!error)return {data:player,error:''};
  // Keep an invalid edit on screen while notes and received XP can still be saved.
  const previous=copyPlayerValue(persistedCharacter);
  const data={...player,profile:previous.profile};
  const sheet=previous.sheet || (typeof playerSheetNormalize==='function' ? playerSheetNormalize(null,previous.profile) : null);
  if(sheet){
    const progress=sheet.rules?.progress,room=window.playerSessionSnapshot?.();
    if(progress && room?.self && Number.isSafeInteger(room.self.xp) && room.self.xp>=0){progress.sessionXP=room.self.xp;progress.characterKey=room.id+':'+room.self.id;}
    data.sheet=sheet;
  }else delete data.sheet;
  return {data,error};
}
function save(){
  const prepared=playerArchiveState();
  try{localStorage.setItem(PLAYER_KEY,JSON.stringify(prepared.data));persistedCharacter=characterSnapshot(prepared.data);storageOK=true;const signature=JSON.stringify(publicIdentity());if(signature!==acceptedIdentitySignature)identityAuthored=true;acceptedIdentitySignature=signature;if(!resetCharacterStorage)publishAcceptedIdentity();}catch{storageOK=false;}
  $('#saveStatus').textContent=!storageOK?'! Не сохранено · скачай копию':prepared.error?'! Анкета не сохранена · проверь S.P.E.C.I.A.L. / перки':'● Личные записи сохранены';
  return storageOK && !prepared.error;
}
// An item receipt and its HP change are committed in one browser-storage write.
function itemEffectKey(outcome,room=window.playerSessionSnapshot?.()) {
  return room?.self && outcome?.playerId===room.self.id && typeof outcome.operationId==='string' ? room.id+':'+room.self.id+':'+outcome.operationId : '';
}
function equipmentCharacterContext(data=playerArchiveState().data) {
  const room=window.playerSessionSnapshot?.(),sheet=playerSheetNormalize(data.sheet,data.profile);
  const armorId=room?.self?.equipment?.armor,armor=room?.self?.inventory?.find(item=>item.id===armorId) || null;
  return {sheet,result:PlayerCharacterRules.calculate(sheet,{sessionXP:room?.self ? room.self.xp || 0 : sheet.rules?.progress?.sessionXP || 0,armor}),room};
}
window.playerRulesDamageContext=item=>{
  const {result}=equipmentCharacterContext();
  return {strength:result.special.S,bonus:result.damageBonus+(['melee','unarmed'].includes(item?.category)?result.meleeDamageBonus:0),healthKnown:result.currentHP!==null,healingMultiplier:result.healingMultiplier};
};
function storedItemReceipts(){try{const data=JSON.parse(localStorage.getItem(PLAYER_KEY));return validPlayer(data)?data.sheet?.rules?.itemEffects || []:[];}catch{return[];}}
function syncStoredItemEffects(){
  let stored;
  try{stored=JSON.parse(localStorage.getItem(PLAYER_KEY));if(!validPlayer(stored))return false;}catch{return false;}
  const incoming=stored.sheet?.rules?.itemEffects || [],known=persistedCharacter.sheet?.rules?.itemEffects || [];
  const fresh=incoming.some(id=>!known.includes(id));
  const floor=[...new Set([...incoming,...known,...(player.sheet?.rules?.itemEffects || [])])].slice(0,5000);
  if(!floor.length)return false;
  if(!persistedCharacter.sheet)persistedCharacter.sheet=playerSheetNormalize(null,persistedCharacter.profile);
  if(!player.sheet)player.sheet=playerSheetNormalize(null,player.profile);
  if(!player.sheet.rules)player.sheet.rules=PlayerCharacterRules.normalizeMeta(null,player.sheet);
  persistedCharacter.sheet.rules.itemEffects=[...floor];player.sheet.rules.itemEffects=[...floor];
  // A receipt unknown to this tab means another tab committed the corresponding HP.
  if(fresh && stored.sheet){
    persistedCharacter.sheet.health=stored.sheet.health;persistedCharacter.profile.hp=stored.profile.hp;
    player.sheet.health=stored.sheet.health;player.profile.hp=stored.profile.hp;
  }
  return fresh;
}
window.addEventListener('storage',event=>{if(event.key===PLAYER_KEY && !resetCharacterStorage && syncStoredItemEffects() && view==='character')render();});
window.playerItemEffectApplied=outcome=>{
  const key=itemEffectKey(outcome);
  return !!key && (persistedCharacter.sheet?.rules?.itemEffects?.includes(key) || storedItemReceipts().includes(key));
};
function applyConfirmedItemEffect(outcome){
  syncStoredItemEffects();
  const key=itemEffectKey(outcome),room=window.playerSessionSnapshot?.();
  if(!key || outcome?.kind!=='healing')return {applied:false,error:'Открой сессию владельца этого лечения.'};
  if(window.playerItemEffectApplied(outcome))return {applied:true,duplicate:true,message:'Это лечение уже учтено.'};
  const record=room.inventoryHistory?.find(entry=>entry.id===outcome.operationId && entry.outcome?.kind==='healing' && entry.outcome.playerId===room.self.id);
  if(!record)return {applied:false,error:'Подтверждение лечения отсутствует в журнале сессии. Обнови связь.'};
  const confirmed=record.outcome;
  if(!Number.isFinite(confirmed.total) || confirmed.total<0)return {applied:false,error:'Некорректный результат лечения.'};
  const prepared=copyPlayerValue(playerArchiveState().data),{sheet,result}=equipmentCharacterContext(prepared);
  if(result.currentHP===null)return {applied:false,error:'Сначала укажи текущее здоровье в анкете. Бросок лечения сохранён.'};
  const receipts=[...new Set([...storedItemReceipts(),...(persistedCharacter.sheet?.rules?.itemEffects || []),...(sheet.rules.itemEffects || [])])];
  if(receipts.length>=5000)return {applied:false,error:'Журнал лечения заполнен. Сохрани резервную копию и обратись к мастеру.'};
  const healed=EquipmentRules.applyHealing(result.currentHP,result.maxHP,confirmed.total*result.healingMultiplier);
  sheet.health=healed.after+' / '+healed.maxHP;sheet.rules.itemEffects=[...receipts,key];
  prepared.sheet=sheet;prepared.profile.hp=sheet.health;
  try{localStorage.setItem(PLAYER_KEY,JSON.stringify(prepared));}catch{storageOK=false;return {applied:false,error:'Здоровье не записано: хранилище браузера недоступно. Повтори применение этого же результата.'};}
  persistedCharacter=characterSnapshot(prepared);storageOK=true;
  if(!player.sheet)player.sheet=playerSheetNormalize(null,player.profile);
  player.sheet.health=sheet.health;player.sheet.rules=PlayerCharacterRules.normalizeMeta(player.sheet.rules,player.sheet);
  player.sheet.rules.itemEffects=[...sheet.rules.itemEffects];player.profile.hp=sheet.health;
  window.dispatchEvent(new CustomEvent('niti:item-effect-applied',{detail:{operationId:confirmed.operationId,...healed}}));
  if(view==='character')render();
  return {applied:true,...healed,message:'Здоровье: '+healed.before+' → '+healed.after+' / '+healed.maxHP+(result.healingMultiplier===0.5?' · «Жидкое тело»: половина лечения':'')};
};
window.playerApplyConfirmedItemEffect=outcome=>navigator.locks?.request ? navigator.locks.request('niti-item-effects',()=>applyConfirmedItemEffect(outcome)) : applyConfirmedItemEffect(outcome);
window.playerSetPortrait=async portrait=>{
  if(!window.playerSheetValidPortrait?.(portrait))return {saved:false,error:'Нужен портрет PNG, JPEG или WebP подходящего размера.'};
  const prepared=copyPlayerValue(playerArchiveState().data);
  prepared.sheet=playerSheetNormalize(prepared.sheet,prepared.profile);prepared.sheet.portrait=portrait;
  try{localStorage.setItem(PLAYER_KEY,JSON.stringify(prepared));}catch{return {saved:false,error:'Браузер не сохранил арт. Освободи место или скачай резервную копию.'};}
  persistedCharacter=characterSnapshot(prepared);storageOK=true;
  if(!player.sheet)player.sheet=playerSheetNormalize(null,player.profile);player.sheet.portrait=portrait;
  identityAuthored=true;acceptedIdentitySignature=JSON.stringify(publicIdentity());publishAcceptedIdentity();
  return {saved:true};
};
window.addEventListener('niti:session-update',()=>{
  const room=window.playerSessionSnapshot?.();if(!room?.self)return;
  const remote=room.squad?.find(member=>member.id===room.self.id);
  // A fresh device may recover the public identity; private character statistics stay local.
  if(!identityAuthored && remote && !Object.values(publicIdentity()).some(Boolean) && [remote.name,remote.age,remote.gender,remote.portrait].some(Boolean)){
    const prepared=copyPlayerValue(playerArchiveState().data);prepared.sheet=playerSheetNormalize(prepared.sheet,prepared.profile);
    Object.assign(prepared.sheet,{name:remote.name || '',age:remote.age || '',gender:remote.gender || '',portrait:remote.portrait || ''});prepared.profile.name=prepared.sheet.name;
    try{localStorage.setItem(PLAYER_KEY,JSON.stringify(prepared));persistedCharacter=characterSnapshot(prepared);Object.assign(player.sheet || (player.sheet=playerSheetNormalize(null,player.profile)),{name:prepared.sheet.name,age:prepared.sheet.age,gender:prepared.sheet.gender,portrait:prepared.sheet.portrait});player.profile.name=prepared.profile.name;identityAuthored=true;acceptedIdentitySignature=JSON.stringify(publicIdentity());window.playerSessionAdoptPersona?.(publicIdentity());if(view==='character')render();}catch{/* Keep server identity intact if the browser cannot save. */}
  }
  publishAcceptedIdentity();
});
function modifier(n){return n-5>=0?'+'+(n-5):String(n-5);}
function playerEditorialHero(){
  const profile=player.profile;
  const arrow='<svg class="editorial-link-arrow" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 19 19 5M5 5h14v14"/></svg>';
  const ticker='<span>OLYMPUS 2207</span><b>◆</b><span class="outline">ТВОЙ ПУТЬ · ТВОЙ ВЫБОР</span><b>◆</b><span>ЛИЧНЫЙ ТЕРМИНАЛ</span><b>◆</b><span class="outline">ИСТОРИЯ ПРОДОЛЖАЕТСЯ</span><b>◆</b>';
  return `<section class="crimson-hero player-editorial-hero" aria-labelledby="player-hero-title">
    <div class="crimson-hero-meta"><span>НИТИ / ТЕРМИНАЛ ИГРОКА</span><span>ПРОТОКОЛ 2207 · ЛИЧНЫЙ КАНАЛ</span></div>
    <div class="crimson-hero-title"><h1 id="player-hero-title">ТВОЙ ХОД.</h1><svg class="crimson-orbit" viewBox="0 0 120 120" fill="none" aria-hidden="true"><circle cx="60" cy="60" r="44" stroke="currentColor"/><ellipse cx="60" cy="60" rx="19" ry="51" stroke="currentColor" transform="rotate(45 60 60)"/><ellipse cx="60" cy="60" rx="19" ry="51" stroke="currentColor" transform="rotate(-45 60 60)"/><path d="M6 60h108M60 6v108" stroke="currentColor" opacity=".4"/><circle cx="60" cy="60" r="8" fill="currentColor"/></svg></div>
    <div class="crimson-hero-stage">
      <div class="crimson-slogan"><h2><span>ТВОЙ ПУТЬ.</span><span>ТВОЙ ВЫБОР.</span><span>ТВОЙ СЛЕД.</span></h2><small>РЕШЕНИЯ ОСТАЮТСЯ С ТОБОЙ.<br>ПУСТОШЬ ПОМНИТ КАЖДЫЙ ШАГ.</small></div>
      <div class="crimson-visual" aria-hidden="true"><img class="crimson-armor" src="assets/power-armor-crimson.webp" alt="" width="960" height="1200" fetchpriority="high"></div>
      <img class="crimson-sticker" src="assets/wasteland-seal.svg" alt="" width="80" height="80" aria-hidden="true">
      <div class="crimson-control">
        <div class="crimson-control-top"><span class="session-pill"><span class="live-dot"></span> ЛИЧНЫЙ АРХИВ</span><span>ИГРОК / 01</span></div>
        <div class="crimson-control-kicker">ТВОЙ ПЕРСОНАЖ</div>
        <h3 class="crimson-current-name">${esc(profile.name)||'Имя ещё не вписано'}</h3>
        <p class="crimson-current-place">${esc(profile.concept?.slice(0,180))||'Заполни анкету, собери снаряжение и оставь свой след в Пустоши.'}</p>
        <a class="button primary" href="#character">Открыть анкету ${arrow}</a>
        <div class="crimson-control-bottom"><a class="text-button" href="#session">К сессии отряда ${arrow}</a><span>ТВОЙ СЛЕД / 2207</span></div>
      </div>
    </div>
  </section>${window.playerTickerMarkup?.() || `<div class="crimson-ticker" aria-hidden="true"><div class="crimson-ticker-track">${ticker}${ticker}</div></div>`}`;
}
function home(){const p=player.profile;return playerEditorialHero()+playerSessionSummary()+`<div class="crimson-section-heading player-editorial-section"><span>01 / ПОЛЕВОЙ АРХИВ<br>ПЕРСОНАЖ. СНАРЯЖЕНИЕ. ЗАПИСИ.</span><h2>БУДЬ ГОТОВ.</h2></div><div class="player-home-grid"><section class="panel player-welcome"><div class="panel-header"><h2 class="panel-title">Полевой терминал</h2><span class="tag">OLYMPUS 2207</span></div><div class="player-vault"><img src="vault-art.svg" alt="Ретрофутуристический терминал рядом с гермодверью"></div><div class="player-welcome-body"><div class="player-kicker">ГОТОВ К СЛЕДУЮЩЕМУ ХОДУ</div><h2 class="player-title">Всё для выхода<br>в Пустошь.</h2><p>Проверь снаряжение, познакомься с отрядом и держи записи под рукой. Новая миссия и подтверждённые награды появятся в игровой сессии.</p><div class="player-home-actions"><a class="button primary" href="#inventory">Мой инвентарь ↗</a><a class="button ghost" href="#squad">Мой отряд ↗</a></div></div></section><section class="panel player-profile-summary"><div class="panel-header"><h2 class="panel-title">Мой персонаж</h2><a class="text-button" href="#character">Анкета ↗</a></div><div class="player-profile-summary-body"><div class="player-summary-label">ИМЯ В АРХИВЕ</div><h2 class="player-summary-name">${esc(p.name)||'Пока без имени'}</h2><p class="muted">${esc(p.concept)||'Перенеси имя и характеристики из своего игрового листа.'}</p><div class="player-summary-stats">${SPECIAL.map(([k,n])=>`<div class="player-summary-stat" title="${n}"><small>${k}</small><strong>${p.special[k]}</strong></div>`).join('')}</div><p class="player-local-notice">${player.notes.length} личных заметок. Записи видны только в твоём браузере.</p><div class="player-home-actions"><a class="button ghost small" href="#character">Открыть личное дело ↗</a></div></div></section></div><div class="player-tools"><a class="panel" href="#character">${icon('character')}<strong>Твой персонаж</strong><span>Характеристики, навыки и состояние.</span><b>↗</b></a><a class="panel" href="#notes">${icon('notes')}<strong>Твоя память</strong><span>Имена, обещания и собственные наблюдения.</span><b>↗</b></a><a class="panel" href="#dice">${icon('dice')}<strong>Твой шанс</strong><span>d4, d6, d8, d10, d12, d20 и d100.</span><b>↗</b></a></div><div class="banner"><strong>Личный архив.</strong> Для переноса анкеты и заметок на другое устройство скачай копию данных в разделе <a class="text-button" href="#help">«Справка»</a>.</div>`;}

function inputField(name,label,value='',type='input'){return `<div class="field"><label class="field-label" for="p-${name}">${label}</label>${type==='textarea'?`<textarea class="textarea" id="p-${name}" name="${name}" rows="4" maxlength="30000">${esc(value)}</textarea>`:`<input class="input" id="p-${name}" name="${name}" maxlength="300" value="${esc(value)}">`}</div>`;}
function character(){return playerSheetPage();}
window.playerClearCharacter=()=>{const notes=player.notes;window.playerSheetResetProgress?.();player=initial();player.notes=notes;persistedCharacter=characterSnapshot(player);resetCharacterStorage=true;identityAuthored=false;acceptedIdentitySignature=JSON.stringify(publicIdentity());save();resetCharacterStorage=false;closeModal();render();window.dispatchEvent(new CustomEvent('niti:character-cleared'));};
function notes(){return head('ТО, ЧТО ТЫ УЖЕ ЗНАЕШЬ','Мои заметки.','Записывай события, договорённости и вопросы, которые хочешь задать на следующей встрече.')+`<section class="panel player-notes-form"><form id="noteForm">${inputField('noteTitle','КОРОТКИЙ ЗАГОЛОВОК')}${inputField('noteText','ЗАПИСЬ','','textarea')}<button class="button primary" type="submit">Добавить заметку ↗</button></form></section><div class="player-note-list">${player.notes.map(n=>`<article class="panel player-note"><div class="card-top"><span class="muted">${esc(new Date(n.date).toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'}))}</span><div class="player-note-actions">${btn('Изменить','edit-note','ghost small',`data-id="${esc(n.id)}"`)}${btn('×','delete-note','ghost small',`data-id="${esc(n.id)}" aria-label="Удалить заметку"`)}</div></div><h2 class="card-title">${esc(n.title)||'Заметка'}</h2><p class="prewrap">${esc(n.text)}</p></article>`).join('')||'<div class="empty-state"><h3>Чистая страница.</h3><p>Первая запись появится здесь после сохранения.</p></div>'}</div>`;}
function help(){return head('ПАМЯТКА УЧАСТНИКА','Всегда под рукой.','Личные инструменты и сохранения для твоей игры.')+`<div class="player-help-grid"><section class="panel"><h2 class="card-title">Проверки</h2><p>Характеристика: <strong>1d20 + (SPECIAL − 5)</strong>.<br>Навык: <strong>1d20 + значение навыка</strong>.</p><p>Навык и характеристика одновременно не складываются. Итог сравнивается с порогом, который задаёт ведущий. Особенности и снаряжение учитывайте по правилам вашей группы.</p><p class="muted">Кубики показывают результат броска. Условия успеха определяются за столом.</p></section><section class="panel"><h2 class="card-title">Цвет и экран</h2><p>В верхней панели доступны 11 оттенков терминала. Оформление и декоративные иллюстрации подстраиваются под выбранный цвет. Кнопка «ЭЛТ» включает и отключает декоративные полосы экрана.</p><p>Настройки сохраняются для этого браузера.</p></section><section class="panel"><h2 class="card-title">Личные сохранения</h2><p>Анкета и заметки хранятся на этом устройстве. В «Моём отряде» участники видят арт, имя, возраст, пол персонажа и имя владельца. Мастеру также передаются исходный опыт и влияние особенности «Светоч» для повышения уровня. Миссия, полученный опыт и вещи хранятся на сервере. История кубиков ведётся отдельно.</p><p>Очистка данных браузера удаляет локальные записи. Скачай резервную копию перед переносом на другое устройство.</p><div class="player-data-actions">${btn('↓ Скачать мои данные','backup','primary')}${btn('↥ Восстановить копию','restore','ghost')}</div></section><section class="panel"><h2 class="card-title">Без интернета</h2><p>Скачай терминал одним HTML-файлом. Для переноса персонажа и заметок также сохрани и восстанови резервную копию.</p><a href="niti-player-offline.html" download class="button ghost">↙ Скачать офлайн-версию</a></section></div>`;}
function render(){if(!pages.some(([id])=>id===view))view='home';$('#nav').innerHTML=pages.map(([id,name])=>`<a class="nav-item ${id===view?'active':''}" href="#${id}" ${id===view?'aria-current="page"':''}>${icon(id)}<span>${name}</span></a>`).join('');const name=pages.find(([id])=>id===view)[1];$('#crumb').textContent=name;document.title=name+' · Нити — игрок';$('#workspace').innerHTML=({home,session:playerSessionPage,character,squad:playerSquadPage,inventory:playerInventoryPage,notes,dice:dicePage,help}[view])();$('#saveStatus').textContent=storageOK?'● Личные записи в браузере':'! Не сохранено · скачай копию';window.nitiAnimateNavigation?.(view);window.NitiDesign?.render(view);}
function navigate(id){if(location.hash.slice(1)===id){view=id;render();}else location.hash=id;}
window.addEventListener('hashchange',()=>{view=location.hash.slice(1);render();window.scrollTo(0,0);});
function download(name,text){const url=URL.createObjectURL(new Blob([text],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function backup(){const prepared=playerArchiveState();download('niti-player-'+new Date().toISOString().slice(0,10)+'.json',JSON.stringify(prepared.data,null,2));if(prepared.error)toast('Копия содержит последнюю сохранённую анкету. '+prepared.error);}
function modal(title,body,submit){lastFocus=document.activeElement;$('#modalRoot').innerHTML=`<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="dialogTitle"><div class="modal-header"><h2 id="dialogTitle">${title}</h2>${btn('×','close-modal','ghost','aria-label="Закрыть"')}</div><form id="dialogForm"><div class="modal-body">${body}</div><div class="modal-footer">${btn('Отмена','close-modal','ghost')}<button class="button primary" type="submit">Сохранить</button></div></form></section></div>`;document.body.style.overflow='hidden';$('#dialogForm').onsubmit=e=>{e.preventDefault();submit(new FormData(e.currentTarget));};$('#modalRoot button').focus();}
function closeModal(){$('#modalRoot').innerHTML='';document.body.style.overflow='';lastFocus?.focus();}
document.addEventListener('click',event=>{const b=event.target.closest('[data-player-action]');if(!b)return;const action=b.dataset.playerAction,id=b.dataset.id;if(action==='backup')backup();if(action==='restore')$('#playerBackupFile').click();if(action==='close-modal')closeModal();if(action==='edit-note'){const n=player.notes.find(n=>n.id===id);if(!n)return;modal('Изменить заметку',inputField('editTitle','ЗАГОЛОВОК',n.title)+inputField('editText','ЗАПИСЬ',n.text,'textarea'),f=>{const text=String(f.get('editText')||'').trim();if(!text){toast('Добавь текст заметки.');return;}n.title=String(f.get('editTitle')||'').trim().slice(0,200);n.text=text;save();closeModal();render();});}if(action==='delete-note')modal('Удалить заметку?','<p>Эта запись будет удалена из личного архива.</p>',()=>{player.notes=player.notes.filter(n=>n.id!==id);save();closeModal();render();});});
document.addEventListener('submit',event=>{if(event.target.id==='profileForm'){event.preventDefault();const f=new FormData(event.target),profile={...player.profile,special:{}};for(const name of ['name','concept','hp','defence','inventory','description'])profile[name]=String(f.get(name)||'').trim();for(const[k]of SPECIAL){const n=Number(f.get('special-'+k));if(!Number.isInteger(n)||n<1||n>10){toast('Характеристики должны быть целыми числами от 1 до 10.');return;}profile.special[k]=n;}player.profile=profile;const success=save();$('#profileStatus').textContent=success?'Персонаж сохранён.':'Не удалось сохранить. Скачай копию данных.';}if(event.target.id==='noteForm'){event.preventDefault();const f=new FormData(event.target),text=String(f.get('noteText')||'').trim();if(!text){toast('Добавь текст заметки.');return;}if(player.notes.length>=1000){toast('Архив заполнен. Скачай копию и удали ненужные записи.');return;}player.notes.unshift({id:uid(),title:String(f.get('noteTitle')||'').trim().slice(0,200),text,date:new Date().toISOString()});save();render();toast('Заметка добавлена.');}});
document.addEventListener('input',event=>{if(!event.target.id.startsWith('special-'))return;const key=event.target.id.slice(8),n=Number(event.target.value),label=document.querySelector('[data-special-mod="'+key+'"]');if(label)label.textContent=Number.isInteger(n)&&n>=1&&n<=10?'Модификатор '+modifier(n):'От 1 до 10';});
$('#playerBackupFile').addEventListener('change',async event=>{const file=event.target.files[0];if(!file)return;try{if(file.size>1000000)throw Error();const data=JSON.parse(await file.text());if(!validPlayer(data))throw Error();modal('Восстановить личный архив?','<p>Персонаж и заметки будут заменены данными из выбранной копии. Текущий архив можно скачать перед восстановлением.</p>',()=>{const restored={kind:'niti-player',version:1,profile:{...data.profile,special:{...data.profile.special}},notes:data.notes.map(n=>({id:n.id,title:n.title,text:n.text,date:n.date})),sheet:playerSheetNormalize(data.sheet,data.profile)};restored.sheet.rules.itemEffects=[...new Set([...storedItemReceipts(),...(persistedCharacter.sheet?.rules?.itemEffects || []),...(restored.sheet.rules.itemEffects || [])])].slice(0,5000);const error=characterSaveError(restored);if(error){toast('Копия не восстановлена. '+error);return;}backup();const previous=player;player=restored;if(!save()){player=previous;toast('Не удалось сохранить восстановленную анкету. Текущие данные оставлены.');return;}closeModal();render();toast('Личный архив восстановлен.');});}catch{toast('Нужна резервная копия терминала игрока в формате JSON.');}event.target.value='';});
document.addEventListener('keydown',event=>{if(!$('#modalRoot').children.length)return;if(event.key==='Escape')closeModal();if(event.key==='Tab'){const buttons=[...$('#modalRoot').querySelectorAll('button,input,textarea,select,a[href]')].filter(node=>!node.disabled&&node.tabIndex>=0&&node.getClientRects().length),first=buttons[0],last=buttons.at(-1);if(!first)return;if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}});
render();
