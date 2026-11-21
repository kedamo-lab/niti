'use strict';

// Public cards and safe choice labels are projected explicitly by the shared API.
// Private reward/effect plans are available only to the master capability.
const GM_SESSION = (() => {
  const KEY = 'niti-gm-session-v1';
  const CARDS_KEY = 'niti-gm-public-cards-v1';
  const PLAYER_URL = String(window.NITI_SESSION_PLAYER_URL || 'https://niti-players.thegromvel.chatgpt.site/');
  // A combined site mounts the player at /player/, so its API is the site's /api.
  const BASE = String(window.NITI_SESSION_API_BASE || PLAYER_URL.replace(/player\/?$/, '') + 'api').replace(/\/$/, '');
  const offlineFile = location.protocol === 'file:' || document.documentElement.dataset.offline === 'true';
  const allowedItemEvents = new Set(['q4:spare-drink', 'q10:service-badge', 'q10:ammo-preserved', 'q14:disk-taken', 'q14:box-1', 'q14:box-2', 'q14:box-3']);
  let access = null;
  let room = null;
  let publicCards = {};
  let connection = 'idle';
  let message = '';
  let creating = false;
  let refreshing = false;
  let requestedMission = null;
  let publishing = false;
  let lastPublished = '';
  let adoptedRoom = '';
  let pendingWorldRender = false, worldRenderScheduled = false;
  const pendingResults = new Set();
  const recipients = new Map();
  const expandedDetails = new Map();
  const pendingCharacters = new Set();
  const TICKER_PENDING_PREFIX = 'niti-gm-ticker-pending-v1:';
  const TICKER_CONFIRMED_PREFIX = 'niti-gm-ticker-confirmed-v1:';
  const TICKER_DEFAULT = ['OLYMPUS 2207','ВОЙНА НИКОГДА НЕ МЕНЯЕТСЯ','ТАРТАР','ТВОЯ ИСТОРИЯ ПРОДОЛЖАЕТСЯ'].join('\n');
  const tickerPending = new Map(), tickerConfirmed = new Map();
  let tickerWrite = null;

  function validAccess(value) {
    return value && typeof value.roomId === 'string' && /^[a-zA-Z0-9_-]{16,128}$/.test(value.roomId) && typeof value.masterToken === 'string' && /^[a-zA-Z0-9_-]{32,256}$/.test(value.masterToken);
  }
  try {
    const value = JSON.parse(localStorage.getItem(KEY));
    if (validAccess(value)) access = {roomId: value.roomId, masterToken: value.masterToken};
    const cards = JSON.parse(localStorage.getItem(CARDS_KEY));
    if (cards && typeof cards === 'object' && !Array.isArray(cards)) publicCards = cards;
  } catch { /* The interface offers a recovery file when local storage is unavailable. */ }

  const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const button = (label, action, extra = '', primary = false) => `<button type="button" class="button ${primary ? 'primary' : 'ghost'} small" data-gm-action="${action}" ${extra}>${label}</button>`;
  const catalog = () => window.NITI_SESSION_CATALOG?.quests || [];
  const quest = id => {
    const base = catalog().find(q => q.id === id);
    return typeof window.gmSceneRewardQuest === 'function' ? window.gmSceneRewardQuest(base, scene(id)) : base;
  };
  const active = () => !!access && !offlineFile;
  const scene = id => typeof state !== 'undefined' ? state.scenes.find(s => s.id === id) : null;
  const preparedQuests = () => typeof state !== 'undefined' ? state.scenes.map(s => quest(s.id)).filter(Boolean) : catalog();

  const normalizeTicker = value => typeof value==='string' ? value.replace(/\r\n?/g,'\n').split('\n').map(line=>line.trim()).filter(Boolean).join('\n') : '';
  function validTicker(value) {
    return value && typeof value.text==='string' && value.text.length<=600 && normalizeTicker(value.text)
      && Number.isSafeInteger(value.version) && value.version>=1;
  }
  function tickerLocalText() {
    return window.gmTickerCurrentText?.() || (typeof state!=='undefined' && normalizeTicker(state.tickerText)) || TICKER_DEFAULT;
  }
  function tickerPendingFor(id) {
    if (tickerPending.has(id)) return tickerPending.get(id);
    let pending=null;
    try {
      const value=JSON.parse(localStorage.getItem(TICKER_PENDING_PREFIX+id));
      if (value && typeof value.id==='string' && typeof value.text==='string' && value.text.length<=600 && normalizeTicker(value.text)
          && Number.isSafeInteger(value.expectedVersion) && value.expectedVersion>=0) pending={...value,text:normalizeTicker(value.text)};
    } catch { /* An unavailable local cache does not prevent an online update. */ }
    tickerPending.set(id,pending);return pending;
  }
  function rememberTickerPending(id,pending) {
    tickerPending.set(id,pending);
    try {
      if (pending) localStorage.setItem(TICKER_PENDING_PREFIX+id,JSON.stringify(pending));
      else localStorage.removeItem(TICKER_PENDING_PREFIX+id);
    } catch { /* The campaign backup still carries the edited text. */ }
  }
  function confirmedTickerFor(id) {
    if (tickerConfirmed.has(id)) return tickerConfirmed.get(id);
    let value=null;
    try {const stored=JSON.parse(localStorage.getItem(TICKER_CONFIRMED_PREFIX+id));if(validTicker(stored))value=stored;} catch {}
    tickerConfirmed.set(id,value);return value;
  }
  function rememberTickerConfirmed(id,value) {
    const ticker=validTicker(value) ? {text:normalizeTicker(value.text),version:value.version,updatedAt:value.updatedAt} : null;
    tickerConfirmed.set(id,ticker);
    try {localStorage.setItem(TICKER_CONFIRMED_PREFIX+id,JSON.stringify(ticker));} catch {}
    return ticker;
  }
  function tickerVersion() {return access ? confirmedTickerFor(access.roomId)?.version || 0 : 0;}
  function applyTickerText(value) {
    if (typeof state!=='undefined' && state.tickerText!==value) {state.tickerText=value;if(typeof save==='function')save();}
    window.gmTickerRefresh?.();
  }
  function tickerStatus() {
    if (!active()) return {state:'local',message:'Локальная строка · появится у игроков после подключения общей сессии.'};
    const pending=tickerPendingFor(access.roomId);
    if (pending?.conflict) return {state:'conflict',message:'Строка комнаты изменилась на другом терминале. Открой редактор и сохрани свой текст ещё раз.'};
    if (tickerWrite?.roomId===access.roomId) return {state:'sending',message:'Передаём текст игрокам…'};
    if (pending) return {state:'queued',message:'Изменение сохранено. Передадим игрокам, когда восстановится связь.'};
    if (confirmedTickerFor(access.roomId)) return {state:'shared',message:'Общая строка мастера и игроков · текст передан в комнату.'};
    return {state:'loading',message:'Подключаем общую бегущую строку…'};
  }
  function acceptTicker(next) {
    const remote=rememberTickerConfirmed(next.id,next.ticker);
    let pending=tickerPendingFor(next.id);
    if (pending && remote?.text===pending.text) {rememberTickerPending(next.id,null);pending=null;}
    if (pending) {
      // A later local edit can build on our own in-flight accepted write.
      if (remote && pending.afterText===remote.text && remote.version===(pending.afterVersion || 0)+1) {
        pending={...pending,expectedVersion:remote.version,afterIntent:null,afterText:null,afterVersion:null,conflict:false};rememberTickerPending(next.id,pending);
      }
      const remoteVersion=remote?.version || 0;
      if (pending.expectedVersion!==remoteVersion) {
        if (pending.origin==='initial') {rememberTickerPending(next.id,null);pending=null;}
        else {pending={...pending,conflict:true};rememberTickerPending(next.id,pending);}
      }
      if (pending) applyTickerText(pending.text);
    }
    if (!pending && remote) applyTickerText(remote.text);
    if (!pending && !remote) {
      pending={id:crypto.randomUUID?.() || String(Date.now()),text:tickerLocalText(),expectedVersion:0,origin:'initial'};
      rememberTickerPending(next.id,pending);
    }
    window.gmTickerRefresh?.();
    if (pending && !pending.conflict) queueMicrotask(drainTicker);
  }
  function setTicker(value,expectedVersion) {
    const normalized=normalizeTicker(value);
    if (typeof value!=='string' || value.length>600 || !normalized) throw new Error('Добавь от 1 до 600 символов в бегущую строку.');
    if (!active()) {applyTickerText(normalized);return {queued:false,shared:false,local:true};}
    const roomId=access.roomId,known=confirmedTickerFor(roomId);
    if (known?.text===normalized && !tickerWrite) {rememberTickerPending(roomId,null);applyTickerText(normalized);return {queued:false,shared:true};}
    const base=Number.isSafeInteger(expectedVersion) ? expectedVersion : known?.version || 0;
    const pending={id:crypto.randomUUID?.() || Date.now().toString(36)+Math.random().toString(36).slice(2),text:normalized,expectedVersion:base,origin:'edit',
      ...(tickerWrite?.roomId===roomId ? {afterIntent:tickerWrite.id,afterText:tickerWrite.text,afterVersion:tickerWrite.expectedVersion} : {}),
      ...(known && base!==known.version ? {conflict:true} : {})};
    rememberTickerPending(roomId,pending);applyTickerText(normalized);
    if (!pending.conflict) queueMicrotask(drainTicker);
    return {queued:true,shared:false,conflict:!!pending.conflict};
  }
  async function drainTicker() {
    if (!active() || tickerWrite) return;
    const credential=access,roomId=credential.roomId,pending=tickerPendingFor(roomId);
    if (!pending || pending.conflict) return;
    tickerWrite={...pending,roomId};window.gmTickerRefresh?.();
    try {
      const data=await api('/rooms/'+encodeURIComponent(roomId)+'/ticker',{method:'POST',body:{text:pending.text,expectedVersion:pending.expectedVersion}});
      if (access!==credential || !data.room || data.room.id!==roomId) return;
      const latest=tickerPendingFor(roomId);
      if (latest?.id===pending.id) rememberTickerPending(roomId,null);
      else if (latest?.afterIntent===pending.id && validTicker(data.room.ticker) && data.room.ticker.text===pending.text) {
        rememberTickerPending(roomId,{...latest,expectedVersion:data.room.ticker.version,afterIntent:null,afterText:null,afterVersion:null,conflict:false});
      }
      acceptRoom(data.room);
    } catch (error) {
      if (access!==credential) return;
      if (error.status===409) {
        const current=tickerPendingFor(roomId);
        if (current) rememberTickerPending(roomId,{...current,conflict:true});
        // Read the winning server version; it never discards an explicit draft.
        if (!refreshing) void refresh();
      }
    } finally {
      tickerWrite=null;window.gmTickerRefresh?.();
      const latest=active() ? tickerPendingFor(access.roomId) : null;
      // Continue only for a newly queued edit, never spin on a failed request.
      if (latest && !latest.conflict && (access!==credential || latest.id!==pending.id)) queueMicrotask(drainTicker);
    }
  }

  function missionCard(id) {
    const q = quest(id);
    const stored = publicCards[id];
    const source = stored && typeof stored.title === 'string' && typeof stored.description === 'string' && Array.isArray(stored.actions) ? stored : q?.public;
    if (!source) return null;
    let description = String(source.description || '');
    // The accusation must not assert a dead guard until the master has established it.
    if (!publicCards[id] && id === 'q12' && typeof modulePublicHook === 'function') {
      const s = scene(id);
      if (s) description = modulePublicHook(s);
    }
    const card = {
      id,
      title: String(source.title || 'Текущая миссия').slice(0, 180),
      description: ((source.place ? source.place + '\n\n' : '') + description).slice(0, 4000),
      actions: (source.actions || []).slice(0, 20).map((a, index) => ({id: String(a.id || `${id}-action-${index + 1}`), label: String(a.label || '').slice(0, 240)})).filter(a => a.label.trim())
    };
    return typeof window.gmSceneRewardPublic === 'function' ? window.gmSceneRewardPublic(card, scene(id)) : card;
  }

  function resolutionActions(id) {
    const s=scene(id),q=quest(id),card=missionCard(id);
    const rows=window.gmSceneResolutionActions?.(s,q,card) || card?.actions || [];
    // An authored result can be hidden later without erasing its played record.
    for (const previous of s?.actionOutcomes || []) if (previous.actionId.startsWith('result:') && !rows.some(action=>action.id===previous.actionId)) rows.push({id:previous.actionId,label:previous.actionLabel});
    return rows;
  }

  function missionPublication(id) {
    const s=scene(id),q=quest(id),card=missionCard(id);
    if (!s || !card) return null;
    const resolutions=(window.gmSceneResolutionPlans?.(s,q,card) || []).map(plan=>{
      const selected=recipients.get(id+':'+plan.id);
      if (!selected) return plan;
      const recipientId=room?.players?.some(player=>player.id===selected) ? selected : null;
      return {...plan,items:plan.items.map(item=>({...item,recipientId}))};
    });
    return {mission:card,resolutions,resolutionContext:{session:state.session,actions:window.gmSceneResolutionActions?.(s,q,card,resolutions) || card.actions}};
  }

  function adoptRemoteConfiguration(next) {
    const remote=next.resolutionConfig,card=next.mission,s=scene(remote?.missionId);
    if (!s || card?.id!==s.id || s.rewardConfig || publicCards[s.id] || !Array.isArray(remote.resolutions)) return;
    const base=quest(s.id),original=outcomes(base);
    const remoteById=new Map(remote.resolutions.map(plan=>[plan.id,plan]));
    const rows=original.map(result=>({
      id:result.id,label:result.label,publicText:result.publicText,xp:result.xp || 0,
      completion:result.completion===true,onceKey:result.onceKey,
      items:(result.items || []).map((item,index)=>({id:item.id || 'loot-'+index,name:item.name,quantity:item.quantity,
        ...(item.catalogId ? {catalogId:item.catalogId} : {}),...(item.stats ? {stats:item.stats} : {})})),
      playerLabel:window.gmOutcomeDefaults?.(s.id,result.id)?.playerLabel || 'Подтвердить результат',
      playerSelectable:remoteById.has(result.id)
    }));
    for (const plan of remote.resolutions) {
      const previous=rows.find(result=>result.id===plan.id);
      const result={id:plan.id,label:previous?.label || plan.label,publicText:plan.summary,xp:plan.xp,
        completion:plan.complete,onceKey:plan.onceKey,
        items:(plan.items || []).map((item,index)=>({id:item.id || 'loot-'+index,name:item.name,quantity:item.quantity,
          ...(item.catalogId ? {catalogId:item.catalogId} : {}),...(Object.hasOwn(item,'stats') ? {stats:item.stats} : {})})),
        playerLabel:plan.label,playerSelectable:true,actionId:plan.actionId,effects:plan.effects};
      if (previous) Object.assign(previous,result);else rows.push(result);
      const recipientId=plan.items?.[0]?.recipientId;
      if (recipientId && plan.items.every(item=>item.recipientId===recipientId)) recipients.set(s.id+':'+plan.id,recipientId);
    }
    const config={version:1,xp:Number(s.xp) || Number(base?.completionXP) || 0,
      public:{title:card.title,description:card.description,actions:card.actions.map(action=>({id:action.id,label:action.label}))},results:rows};
    if (!window.gmSceneRewardValid?.(config)) return;
    s.rewardConfig=config;
    publicCards[s.id]={...config.public};
    try { localStorage.setItem(CARDS_KEY,JSON.stringify(publicCards)); } catch { /* The campaign save below reports storage failures. */ }
    if (typeof save==='function') save();
  }

  function worldIsEditable() {
    if (document.querySelector('#modalRoot')?.children.length || document.querySelector('#focusRoot')?.children.length) return true;
    const focused=document.activeElement;
    return !!focused && !!document.querySelector('#workspace')?.contains(focused) && focused.matches('input:not([readonly]),textarea,select,[contenteditable="true"]');
  }

  function queueWorldRender(changed = true) {
    if (changed) pendingWorldRender=true;
    if (!pendingWorldRender || worldRenderScheduled) return;
    worldRenderScheduled=true;
    setTimeout(()=>{
      worldRenderScheduled=false;
      if (!pendingWorldRender || worldIsEditable()) return;
      pendingWorldRender=false;
      const scroll=window.scrollY;
      if (typeof render==='function') render();
      window.scrollTo({top:scroll,behavior:'instant'});
    },0);
  }

  function ensureCurrentPublication() {
    if (!active() || connection!=='online' || publishing || pendingResults.size || requestedMission || worldIsEditable() || !room?.mission?.id) return;
    const publication=missionPublication(room.mission.id);
    if (!publication || JSON.stringify(publication)===lastPublished) return;
    requestedMission=room.mission.id;
    void drainMissionQueue();
  }

  function actionList(s) {
    const actions = resolutionActions(s.id);
    if (!actions.length) return '';
    return `<section class="gm-mission-actions" data-gm-mission-actions="${e(s.id)}"><div class="gm-outcomes-title"><h3>Действия игроков <span class="badge">${actions.length}</span></h3><span>Проверки и исходы ниже видит только мастер</span></div><ol>${actions.map((action, index) => {
      const check = (s.actionChecks || []).find(value => value.id === action.id);
      const result = (s.actionOutcomes || []).filter(value => value.actionId === action.id).slice(-1)[0];
      const labels = {success:'Разыграно', failure:'Неудача', unplayed:'Не разыграно'};
      return `<li data-gm-branch-id="${e(action.id)}"><div class="gm-action-heading"><span class="module-check-number">${String(index + 1).padStart(2, '0')}</span><strong>${e(action.label)}</strong>${button(check ? 'Изменить проверку' : 'Добавить проверку', 'edit-action-check', `data-mission-id="${e(s.id)}" data-branch-id="${e(action.id)}"`)}</div>${check ? `<div class="gm-action-private">${check.check ? `<div class="module-roll">${e(check.check)}</div>` : '<p class="muted">Проверка не задана.</p>'}${check.success ? `<div class="module-result"><span>УСПЕХ</span><p>${e(check.success)}</p></div>` : ''}${check.failure ? `<div class="module-result failure"><span>ПРОВАЛ / ДРУГОЙ ПУТЬ</span><p>${e(check.failure)}</p></div>` : ''}${check.notes ? `<p class="muted prewrap">${e(check.notes)}</p>` : ''}</div>` : '<p class="gm-action-no-check">Проверка не задана. Условия из модуля доступны ниже.</p>'}<div class="gm-action-outcomes" role="group" aria-label="Результат действия: ${e(action.label)}"><span>Результат действия · только мастер</span><div>${Object.entries(labels).map(([outcome, label]) => button(label, 'action-outcome', `data-mission-id="${e(s.id)}" data-branch-id="${e(action.id)}" data-outcome="${outcome}" aria-pressed="${result?.session === state.session && result.outcome === outcome}"`, result?.session === state.session && result.outcome === outcome)).join('')}</div>${result ? `<small data-gm-action-result>${e(labels[result.outcome])} · сессия ${result.session}</small>` : '<small>Исход пока не отмечен.</small>'}</div></li>`;
    }).join('')}</ol></section>`;
  }

  function markActionOutcome(missionId, actionId, outcome) {
    if (!['success', 'failure', 'unplayed'].includes(outcome) || typeof state === 'undefined') return;
    const s = scene(missionId);
    const action = resolutionActions(missionId).find(value => value.id === actionId);
    if (!s || !action) return;
    const existing = (s.actionOutcomes || []).find(value => value.actionId === actionId && value.session === state.session);
    if (existing?.outcome === outcome) return;
    const check = (s.actionChecks || []).find(value => value.id === actionId);
    const detail = outcome === 'success' ? check?.success || '' : outcome === 'failure' ? check?.failure || '' : '';
    const result = {actionId, actionLabel: action.label, outcome, session: state.session, date: new Date().toISOString(), detail, source:'master'};
    s.actionOutcomes = (s.actionOutcomes || []).filter(value => value.actionId !== actionId || value.session !== state.session);
    s.actionOutcomes.push(result);
    const label = {success:'успех', failure:'неудача', unplayed:'не разыграно'}[outcome];
    if (typeof record === 'function') record(`Сцена «${s.title}» · действие «${action.label}»: ${label}.${detail ? '\n' + detail : ''}`, 'Результат действия');
    if (typeof save === 'function') save();
    // This is a local GM record. It neither publishes nor completes the mission.
    paint();
    if (typeof toast === 'function') toast('Результат действия записан в журнал мастера.');
  }

  function inviteURL() {
    if (!access) return '';
    const url = new URL(PLAYER_URL);
    url.searchParams.set('room', access.roomId);
    url.hash = 'session';
    return url.href;
  }

  function rememberAccess() {
    try { localStorage.setItem(KEY, JSON.stringify(access)); return true; }
    catch { message = 'Браузер не сохраняет доступ. Скачай ключ мастера, чтобы вернуться в эту комнату.'; return false; }
  }

  async function api(path, {method = 'GET', body, useAccess = true} = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const headers = {'Accept': 'application/json'};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (useAccess && access) headers.Authorization = 'Bearer ' + access.masterToken;
    try {
      const response = await fetch(BASE + path, {method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'omit', cache: 'no-store', signal: controller.signal});
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(data.error || `Сервис ответил ${response.status}.`);
        error.status = response.status;
        throw error;
      }
      return data;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('Сервис не ответил вовремя. Повтори действие: награда не начислится дважды.');
      if (error instanceof TypeError) throw new Error('Нет связи с игровой комнатой. Проверь интернет и повтори действие.');
      throw error;
    } finally { clearTimeout(timeout); }
  }

  function syncLocalAwards() {
    if (!room || typeof state === 'undefined') return;
    let changed = false;
    for (const id of room.awardedMissions || []) {
      const s = scene(id);
      if (s && !(Number(s.issuedXP) > 0)) {
        const issued = (room.events || []).find(event => event.missionId === id && event.xp > 0 && event.xpScope !== 'event');
        if (issued) { s.issuedXP = issued.xp; changed = true; }
      }
    }
    return changed;
  }

  function acceptRoom(next) {
    if (!next || next.id !== access?.roomId || (room && next.revision < room.revision)) return;
    room = next;
    if (adoptedRoom !== next.id) {
      adoptRemoteConfiguration(next);
      adoptedRoom = next.id;
      // A previously configured room is already published. Opening another
      // master browser must not rewrite its plans just because the app reloaded.
      if (next.resolutionConfig?.session === (typeof state!=='undefined' ? state.session : 1)) {
        const publication=missionPublication(next.mission?.id);
        if (publication) lastPublished=JSON.stringify(publication);
      }
    }
    connection = 'online';
    message = '';
    acceptTicker(next);
    const applied=typeof state!=='undefined' ? window.gmApplyResolutionEvents?.(state,room) : null;
    const awardsChanged=syncLocalAwards();
    if ((applied?.changed || awardsChanged) && typeof save==='function') save();
    if (applied?.changed || awardsChanged) queueWorldRender();
  }

  function statusHTML() {
    const text = connection === 'online' ? 'Связь установлена' : connection === 'loading' ? 'Подключение…' : connection === 'error' ? 'Связь прервана' : access ? 'Ожидание связи' : 'Комната не создана';
    return `<span class="gm-link-status ${connection}" role="status"><span aria-hidden="true"></span>${text}</span>`;
  }

  function errorHTML() {
    return message ? `<div class="gm-session-message" role="status">${e(message)}${access ? button('Повторить', 'refresh') : ''}</div>` : '';
  }

  function publicPreview(card) {
    if (!card) return '<p class="muted">Для этой сцены ещё нет карточки для игроков. Подготовь её перед показом.</p>';
    const choices=Array.isArray(card.choices) ? card.choices : window.gmSceneResolutionPlans?.(scene(card.id),quest(card.id),card) || [];
    return `<div class="gm-public-preview"><span class="gm-public-kicker">ЭТО ВИДЯТ ИГРОКИ</span><h3>${e(card.title)}</h3><p class="prewrap">${e(card.description)}</p><ol>${card.actions.map(a => `<li>${e(a.label)}</li>`).join('')}</ol>${choices.length ? `<div class="gm-public-kicker">РЕЗУЛЬТАТЫ ДЛЯ ПОДТВЕРЖДЕНИЯ</div><ol>${choices.map(choice=>`<li>${e(choice.label)}</li>`).join('')}</ol>` : ''}</div>`;
  }

  function itemText(items) {
    return items.map(item => `${e(item.name)} × ${Number(item.quantity) || 1}`).join(', ');
  }

  function issued(q, result) {
    if (!room) return false;
    if (result.completion && room.completedMissions?.[q.id]) return true;
    return (room.events || []).some(event => event.eventId === result.onceKey || (event.missionId === q.id && event.resultId === result.id));
  }

  function outcomes(q) {
    return [...(q?.results || []), ...(q?.itemEvents || []).filter(result => allowedItemEvents.has(q.id + ':' + result.id))];
  }

  function resultCard(q, result) {
    const key = q.id + ':' + result.id;
    const done = issued(q, result);
    const actual = room?.events?.find(event => event.missionId === q.id && (event.resultId === result.id || event.eventId === result.onceKey));
    if (actual) result = {...result, xp:actual.xp, publicText:actual.summary, items:actual.items};
    const pending = pendingResults.has(key);
    const completeOther = result.completion && room?.completedMissions?.[q.id] && room.completedMissions[q.id].resultId !== result.id;
    const missionPending = [...pendingResults].some(value => value.startsWith(q.id + ':'));
    const disabled = done || pending || missionPending || publishing || room?.mission?.id !== q.id || !room?.players?.length;
    const selected = recipients.get(key) || '';
    const label = pending ? 'Выдаю…' : completeOther ? 'Задание уже завершено' : done ? 'Выдано ✓' : result.completion || result.xp ? `Подтвердить результат · +${result.xp} XP` : 'Выдать предметы';
    return `<article class="gm-result-card ${done ? 'issued' : ''}"><div class="gm-result-top"><h4>${e(result.label)}</h4><span class="tag">${result.xp ? `+${result.xp} XP КАЖДОМУ` : 'БЕЗ ОПЫТА'}</span></div><p>${e(result.publicText)}</p>${result.items?.length ? `<div class="gm-result-loot">${itemText(result.items)} <small>один комплект на группу</small></div><label class="gm-recipient-label">Кому передать предметы<select class="input" data-gm-recipient="${e(key)}" ${done || pending ? 'disabled' : ''}><option value="">Общий тайник группы</option>${(room?.players || []).map(p => `<option value="${e(p.id)}" ${selected === p.id ? 'selected' : ''}>${e(p.name)}</option>`).join('')}</select></label>` : ''}${button(label, 'result', `data-mission-id="${e(q.id)}" data-result-id="${e(result.id)}" ${disabled ? 'disabled' : ''}`, !done)}</article>`;
  }

  function sceneInner(s) {
    const card = missionCard(s.id);
    const q = quest(s.id);
    const selected = room?.mission?.id === s.id;
    const settings = typeof window.gmSceneRewardSettings === 'function' ? window.gmSceneRewardSettings(s) : '';
    if (!active()) return settings + `<div class="gm-scene-link-intro"><div><span class="eyebrow">ОБЩАЯ СЕССИЯ</span><p>Показывай миссию игрокам и выдавай награды прямо отсюда.</p></div><a class="button ghost small" href="#session">Связать терминалы</a></div>`;
    return settings + `<div class="gm-scene-link-top"><div><span class="eyebrow">КАНАЛ ИГРОКОВ</span><strong>${selected ? 'Эта миссия на экранах игроков' : publishing && requestedMission === s.id ? 'Передаю миссию…' : 'Карточка для показа'}</strong></div>${statusHTML()}</div>${errorHTML()}<details class="gm-preview-details" ${!selected ? 'open' : ''}><summary>Карточка без проверок и скрытых исходов</summary>${publicPreview(card)}<div class="gm-session-actions">${button('Редактировать карточку', 'edit-public', `data-mission-id="${e(s.id)}"`)}${button(selected ? 'Обновить показ' : 'Показать игрокам', 'publish-mission', `data-mission-id="${e(s.id)}" ${!card || publishing ? 'disabled' : ''}`, true)}</div></details>${q ? `<div class="gm-outcomes"><div class="gm-outcomes-title"><h3>Результат и награда</h3><span>Подробности и награды — мастеру; игрокам доступны подготовленные варианты</span></div>${!room?.players?.length ? '<p class="gm-session-hint">Сначала попроси игроков войти по ссылке. Награду получат все зарегистрированные участники, включая тех, кто сейчас не в сети.</p>' : ''}${room?.mission?.id !== s.id ? '<p class="gm-session-hint">Сначала покажи эту миссию игрокам.</p>' : ''}<div class="gm-results-grid">${outcomes(q).map(result => resultCard(q, result)).join('')}</div><details class="gm-reward-notes"><summary>Условия награды из модуля</summary>${(q.caveats || []).map(text => `<p>${e(text)}</p>`).join('')}<p>Игроки могут подтвердить подготовленный результат. Награда выдаётся один раз; отметку «Неудача» ставит мастер. Промежуточная проверка сама по себе не завершает задание.</p></details></div>` : ''}`;
  }

  const equipmentSlots = [['weapon', 'Оружие'], ['armor', 'Броня'], ['extra1', 'Доп. слот 1'], ['extra2', 'Доп. слот 2']];
  const inventoryStatLabels = {damage:'Урон', damageFormula:'Формула урона', apCost:'Стоимость, ОД', range:'Дальность', ammo:'Боеприпасы', magazine:'Магазин', minStrength:'Минимальная СИЛ', damageType:'Тип урона', modifiers:'Особенности', armorClass:'Класс брони', resistances:'Защита', weight:'Вес', price:'Цена', reloadAp:'Перезарядка, ОД', slots:'Размер, клеток', effect:'Эффект'};
  const resistanceLabels = {normal:'Норма', laser:'Лазер', fire:'Огонь', plasma:'Плазма', electric:'Электро', explosive:'Взрыв'};

  function inventoryStatValue(key, value) {
    if (key === 'resistances' && value && typeof value === 'object') return Object.entries(value).map(([name, number]) => `${resistanceLabels[name] || name}: ${number}`).join('; ');
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  }

  function playerInventory(p) {
    const inventory = Array.isArray(p.inventory) ? p.inventory : [];
    const equipment = p.equipment || {};
    return `<div class="gm-player-inventory"><h3>Экипировка</h3><dl class="gm-player-equipment">${equipmentSlots.map(([slot, label]) => {
      const item = inventory.find(value => value.id === equipment[slot]);
      return `<div><dt>${label}</dt><dd>${item ? e(item.name) : equipment[slot] ? 'Предмет недоступен в снимке' : 'Пусто'}</dd></div>`;
    }).join('')}</dl><h3>Инвентарь <span class="badge">${inventory.length}</span></h3>${inventory.length ? `<div class="gm-player-items">${inventory.map(item => {
      const key = `item:${p.id}:${item.id}`;
      const worn = equipmentSlots.filter(([slot]) => equipment[slot] === item.id).map(([, label]) => label);
      const stats = Object.entries(item.stats || {}).filter(([name, value]) => value !== null && value !== undefined && value !== '' && !(name === 'damageFormula' && item.stats.damage));
      return `<details class="gm-player-item" data-gm-keep-open="${e(key)}" ${expandedDetails.get(key) ? 'open' : ''}><summary><span>${e(item.name)}${worn.length ? `<small>В экипировке: ${worn.map(e).join(', ')}</small>` : ''}</span><b>× ${Number(item.quantity) || 0}</b></summary><div class="gm-player-item-body">${item.categoryLabel ? `<span class="tag">${e(item.categoryLabel)}</span>` : ''}${stats.length ? `<dl class="gm-item-stats">${stats.map(([name, value]) => `<div><dt>${e(inventoryStatLabels[name] || name)}</dt><dd>${e(inventoryStatValue(name, value))}</dd></div>`).join('')}</dl>` : '<p class="muted">Характеристики не указаны.</p>'}</div></details>`;
    }).join('')}</div>` : '<p class="muted">Предметов пока нет.</p>'}</div>`;
  }

  function rosterHTML() {
    return `<section class="panel gm-roster"><div class="panel-header"><h2 class="panel-title">Участники <span class="badge">${room?.players?.length || 0} / 20</span></h2></div>${room?.players?.length ? `<div class="gm-roster-list">${room.players.map(p => {
      const key = `player:${p.id}`;
      return `<details class="gm-player-details" data-gm-player-id="${e(p.id)}" data-gm-keep-open="${e(key)}" ${expandedDetails.get(key) ? 'open' : ''}><summary class="gm-roster-row"><span class="gm-player-mark" aria-hidden="true">${e(p.name.slice(0, 1).toUpperCase())}</span><span class="gm-roster-name"><strong>${e(p.name)}</strong><span>${p.character?.synced ? 'Уровень '+e(p.character.level)+' · ' : ''}${p.inventory?.length || 0} поз. · осмотреть снаряжение</span></span><b>${Number(p.character?.synced ? p.character.totalXP : p.xp) || 0}<small> XP</small></b><span class="gm-roster-expand" aria-hidden="true">+</span></summary>${characterControls(p)}${playerInventory(p)}</details>`;
    }).join('')}</div>` : '<div class="gm-session-empty"><strong>Ждём героев.</strong><p>Отправь ссылку игрокам. Каждый войдёт под именем своего персонажа.</p></div>'}</section>`;
  }

  function characterControls(p) {
    const busy = pendingCharacters.has(p.id);
    return `<div class="gm-character-controls"><div><strong>${p.character?.synced ? 'Уровень '+e(p.character.level)+' · '+e(p.character.totalXP)+' XP всего' : 'Анкета ещё не связана'}</strong><p>${p.character?.synced ? 'Повышение добавит недостающий опыт только этому персонажу.' : 'Попроси игрока открыть обновлённый терминал: анкета свяжется автоматически.'}</p></div><div>${button('Повысить уровень', 'character-level', `data-player-id="${e(p.id)}" ${busy || !p.character?.synced || p.character.level>=15 ? 'disabled' : ''}`, true)}${button('Удалить персонажа', 'character-delete', `data-player-id="${e(p.id)}" ${busy ? 'disabled' : ''}`)}</div></div>`;
  }
  async function characterAction(playerId, operation) {
    if (!active() || pendingCharacters.has(playerId)) return false;
    const roomId = access.roomId;
    pendingCharacters.add(playerId);
    try {
      const data = await api('/rooms/' + encodeURIComponent(roomId) + '/characters', {method:'POST',body:{...operation,playerId}});
      if (access?.roomId !== roomId) return false;
      if (data.room) acceptRoom(data.room);
      window.dispatchEvent(new CustomEvent('niti:gm-room', {detail:{room}}));
      return true;
    } finally { pendingCharacters.delete(playerId); paint(); }
  }
  function editCharacter(playerId, remove = false) {
    const p = room?.players?.find(value => value.id === playerId);
    if (!p || typeof modal !== 'function') return;
    const operationId = globalThis.crypto.randomUUID();
    const body = remove ? `<p>Удалить персонажа <strong>${e(p.name)}</strong> и его анкету? Его вещи вернутся в общий тайник, доступ к этому персонажу перестанет работать.</p><p>Действие нельзя отменить. Остальные участники и их награды сохранятся.</p>` : `<p><strong>${e(p.name)}</strong>: сейчас уровень ${e(p.character?.level)} и ${e(p.character?.totalXP)} XP.</p><label class="field-label" for="gmCharacterLevel">НОВЫЙ УРОВЕНЬ</label><select class="input" id="gmCharacterLevel" name="targetLevel" required>${Array.from({length:15},(_,i)=>i+1).filter(level=>level>p.character.level).map(level=>`<option value="${level}">${level}</option>`).join('')}</select><p>Недостающий опыт начислится только этому персонажу. Особенность «Светоч» учитывается. Игрок получит уведомление и доступные выборы перков.</p><p class="muted">В приложенных правилах таблица опыта заканчивается на 15-м уровне.</p>`;
    modal(remove ? 'Удалить персонажа?' : 'Повысить уровень', body+'<p data-gm-character-feedback role="status"></p>', async form => {
      const submit = document.querySelector('#dialogForm button[type="submit"]');
      if (submit) submit.disabled = true;
      try {
        const done = await characterAction(playerId, remove ? {action:'delete',operationId} : {action:'level',targetLevel:Number(form.get('targetLevel')),operationId});
        if (!done) return;
        if (typeof record === 'function') record(remove ? `Персонаж «${p.name}» удалён из комнаты. Вещи возвращены в общий тайник.` : `Мастер повысил «${p.name}» до уровня ${form.get('targetLevel')}.`, 'Персонаж игрока');
        if (typeof save === 'function') save();
        closeModal(); paint();
        toast(remove ? 'Персонаж удалён, вещи возвращены в тайник.' : 'Уровень повышен. Опыт уже в анкете игрока.');
      } catch (error) { const feedback=document.querySelector('[data-gm-character-feedback]'); if(feedback)feedback.textContent=error.message; }
      finally { if(submit?.isConnected)submit.disabled=false; }
    }, `<button class="button ghost" type="button" data-action="close-modal">Отмена</button><button class="button ${remove ? 'danger' : 'primary'}" type="submit">${remove ? 'Удалить персонажа' : 'Повысить уровень'}</button>`);
  }

  function innerPage() {
    if (offlineFile) return '<section class="panel gm-session-empty"><h2>Общей сессии нужен интернет.</h2><p>В скачанном пульте можно вести историю локально. Открой опубликованный терминал, чтобы связаться с игроками.</p></section>';
    if (!access) return `<div class="gm-session-intro-grid"><section class="panel gm-session-create"><span class="gm-radio-mark" aria-hidden="true">◈</span><span class="eyebrow">ЕДИНЫЙ КАНАЛ · ДВА ТЕРМИНАЛА</span><h2>Одна история.<br>У каждого свой экран.</h2><p>Выбирай миссию у себя — игроки увидят её цель и варианты действий. Игрок подтверждает состоявшийся результат, и награды с записями ведущего обновляются автоматически.</p><form id="gmSessionCreate"><label class="field-label" for="gmRoomName">НАЗВАНИЕ ИГРОВОЙ КОМНАТЫ</label><input class="input" id="gmRoomName" name="name" required maxlength="120" value="${e(typeof state !== 'undefined' ? state.title : 'Тартар')}" ${creating ? 'disabled' : ''}><button class="button primary" type="submit" ${creating ? 'disabled' : ''}>${creating ? 'Создаю комнату…' : 'Создать общую сессию'}</button></form>${errorHTML()}</section><section class="panel gm-session-explainer"><h3>За ширмой остаются</h3><p>Проверки, пороги, скрытые последствия и будущие исходы. Игрокам передаётся только подготовленная карточка выбранной миссии.</p><h3>Награды из сюжета</h3><p>Опыт — каждому участнику комнаты. Один предмет — один экземпляр: в общий тайник или выбранному герою.</p><h3>Уже есть комната?</h3><p>Восстанови личный файл доступа мастера.</p>${button('Восстановить доступ', 'restore-access')}<input type="file" id="gmSessionAccessFile" accept=".json,application/json" hidden></section></div>`;
    const current = room?.mission;
    return `${errorHTML()}<section class="panel gm-session-channel"><div class="gm-channel-title"><div><span class="eyebrow">ИГРОВАЯ КОМНАТА</span><h2>${e(room?.name || 'Подключаюсь к комнате…')}</h2></div>${statusHTML()}</div><label class="field-label" for="gmPlayerInvite">ССЫЛКА ДЛЯ ИГРОКОВ</label><div class="gm-invite-row"><input class="input" id="gmPlayerInvite" readonly value="${e(inviteURL())}" aria-label="Ссылка для входа игроков">${button('Скопировать', 'copy-link', '', true)}</div><div class="gm-channel-bottom"><p>При выборе миссии в «Сценах» карточка обновляется у всей группы. Проверки остаются за ширмой.</p>${button('Обновить связь', 'refresh', refreshing ? 'disabled' : '')}</div></section><div class="gm-session-dashboard">${rosterHTML()}<section class="panel gm-broadcast"><div class="panel-header"><h2 class="panel-title">Сейчас у игроков</h2><span class="tag">${current ? 'В ЭФИРЕ' : 'ОЖИДАНИЕ'}</span></div>${current ? publicPreview(current) : '<div class="gm-session-empty"><p>Выбери подготовленную миссию ниже или открой её в разделе «Сцены».</p></div>'}<label class="field-label" for="gmMissionSelect">ПОКАЗАТЬ МИССИЮ</label><select id="gmMissionSelect" class="input" data-gm-mission-select><option value="">Выбрать миссию…</option>${preparedQuests().map(q => `<option value="${e(q.id)}" ${current?.id === q.id ? 'selected' : ''}>${e(q.public.title)}</option>`).join('')}</select>${current ? `<a class="text-button" href="#scenes" data-gm-action="open-current">К результатам миссии</a>` : ''}</section></div><section class="panel gm-shared-stash"><div class="panel-header"><h2 class="panel-title">Общий тайник</h2><span class="tag">ОДИН НА ГРУППУ</span></div><div class="gm-stash-items">${room?.sharedItems?.length ? room.sharedItems.map(item => `<span>${e(item.name)}<b>× ${item.quantity}</b></span>`).join('') : '<p class="muted">Общая добыча появится после подтверждения результата.</p>'}</div></section>${gmInventoryControls()}<section class="panel gm-session-access"><div><h3>Ключ мастера</h3><p>Сохрани файл для переноса управления на другое устройство. Храни его лично; игрокам отправляй только ссылку выше.</p></div><div class="gm-session-actions">${button(' Сохранить доступ', 'backup-access')}${button('Восстановить', 'restore-access')}${button('Отключить этот терминал', 'disconnect')}</div><input type="file" id="gmSessionAccessFile" accept=".json,application/json" hidden></section>`;
  }

  function page() {
    const heading = typeof head === 'function' ? head('СВЯЗЬ С ГРУППОЙ', 'История в прямом эфире.', 'Игроки подтверждают состоявшийся результат. Опыт, награды и записи мастера обновляются автоматически.') : '';
    return heading + `<div data-gm-session-page>${innerPage()}</div>`;
  }

  function paint(force = false) {
    const focusId = force && document.activeElement?.id;
    const pageRoot = document.querySelector('[data-gm-session-page]');
    for (const detail of document.querySelectorAll('[data-gm-keep-open]')) expandedDetails.set(detail.dataset.gmKeepOpen, detail.open);
    const editing = root => root.contains(document.activeElement) && document.activeElement.matches('input:not([readonly]),textarea,select');
    if (pageRoot && (force || !editing(pageRoot) || (access && pageRoot.querySelector('#gmSessionCreate')) || creating)) pageRoot.innerHTML = innerPage();
    for (const root of document.querySelectorAll('[data-gm-scene-session]')) {
      if (!force && editing(root)) continue;
      const s = scene(root.dataset.gmSceneSession);
      if (s) root.innerHTML = sceneInner(s);
    }
    for (const root of document.querySelectorAll('[data-gm-mission-actions]')) {
      const s = scene(root.dataset.gmMissionActions);
      if (s) root.outerHTML = actionList(s);
    }
    if (focusId) document.getElementById(focusId)?.focus({preventScroll: true});
  }

  async function refresh() {
    if (!active() || refreshing) return;
    const roomId = access.roomId;
    refreshing = true;
    if (!room) connection = 'loading';
    paint();
    try {
      const data = await api('/rooms/' + encodeURIComponent(roomId));
      if (access?.roomId !== roomId) return;
      acceptRoom(data.room);
    } catch (error) {
      if (access?.roomId !== roomId) return;
      connection = 'error';
      message = error.status === 401 || error.status === 403 ? 'Ключ этой комнаты не принят. Восстанови файл доступа мастера.' : error.status === 404 ? 'Игровая комната не найдена. Можно восстановить другой ключ или отключить этот терминал.' : error.message;
    } finally { refreshing = false; paint(); ensureCurrentPublication(); if(connection==='online')void drainTicker(); }
  }

  async function drainMissionQueue() {
    if (publishing || pendingResults.size || !active() || !requestedMission) return;
    publishing = true;
    while (requestedMission && active()) {
      const id = requestedMission;
      requestedMission = null;
      const publication=missionPublication(id);
      if (!publication) { message = 'У сцены нет подготовленной карточки для игроков.'; continue; }
      const fingerprint = JSON.stringify(publication);
      if (lastPublished === fingerprint && room?.mission?.id === id) continue;
      const roomId = access.roomId;
      paint();
      try {
        const data = await api('/rooms/' + encodeURIComponent(roomId) + '/mission', {method: 'POST', body: publication});
        if (access?.roomId !== roomId) break;
        acceptRoom(data.room);
        lastPublished = fingerprint;
      } catch (error) {
        connection = 'error'; message = error.message;
        // Leave the latest choice available for an explicit, safe retry.
        if (!requestedMission) requestedMission = id;
        break;
      }
    }
    publishing = false;
    paint();
    queueWorldRender(false);
  }

  function missionSelected(id) {
    if (!active() || !id || !missionCard(id)) return;
    requestedMission = id;
    void drainMissionQueue();
  }

  async function create(name) {
    if (creating || offlineFile) return;
    creating = true; message = ''; paint();
    try {
      const data = await api('/rooms', {method: 'POST', body: {name}, useAccess: false});
      const candidate = {roomId: data.roomId, masterToken: data.masterToken};
      if (!validAccess(candidate)) throw new Error('Сервис не вернул корректный ключ комнаты.');
      access = candidate;
      rememberAccess();
      acceptRoom(data.room);
      const selected = typeof selectedScene !== 'undefined' ? selectedScene : typeof state !== 'undefined' ? state.current : null;
      if (selected) missionSelected(selected);
      if (typeof toast === 'function') toast('Комната создана. Отправь ссылку игрокам.');
    } catch (error) { connection = 'error'; message = error.message; }
    finally { creating = false; paint(); }
  }

  async function deliverResult(missionId, resultId) {
    if (!active() || publishing) return;
    const q = quest(missionId);
    const result = outcomes(q).find(r => r.id === resultId);
    if (!q || !result || issued(q, result) || room?.mission?.id !== missionId || !room?.players?.length) return;
    const key = missionId + ':' + resultId;
    if (pendingResults.has(key)) return;
    const roomId = access.roomId;
    pendingResults.add(key); message = ''; paint();
    try {
      const recipientId = recipients.get(key) || null;
      const data = await api('/rooms/' + encodeURIComponent(roomId) + '/result', {method: 'POST', body: {
        eventId: result.onceKey,
        missionId,
        resultId: result.id,
        summary: result.publicText,
        xp: Number(result.xp) || 0,
        ...(scene(missionId)?.rewardConfig && !result.completion ? {xpScope:'event'} : {}),
        items: (result.items || []).map((item, index) => ({id: `${missionId}-${result.id}-${index}`, name: item.name, quantity: item.quantity, recipientId, ...(item.catalogId ? {catalogId:item.catalogId} : {}), ...(item.stats ? {stats:item.stats} : {})})),
        complete: result.completion === true
      }});
      if (access?.roomId !== roomId) return;
      acceptRoom(data.room);
      if (!data.duplicate && typeof record === 'function') {
        record(`Общая сессия · ${q.public.title}: ${result.label}. ${result.xp ? `${result.xp} XP каждому зарегистрированному участнику. ` : ''}${result.items?.length ? 'Предметы: ' + result.items.map(i => i.name + ' × ' + i.quantity).join(', ') + '.' : ''}`, 'Награда группы');
        if (typeof save === 'function') save();
      }
      if (typeof toast === 'function') toast(data.duplicate ? 'Этот результат уже учтён.' : result.xp ? 'Опыт и награды доставлены игрокам.' : 'Предметы доставлены.');
    } catch (error) { connection = 'error'; message = error.message; }
    finally { pendingResults.delete(key); paint(); if (requestedMission) void drainMissionQueue(); }
  }

  function editPublic(id) {
    if (typeof modal !== 'function') return;
    const current = missionCard(id) || {title: scene(id)?.playerTitle || 'Текущая миссия', description: '', actions: []};
    const body = `<p>Эти поля увидят игроки. Запиши только уже известную ситуацию и действия; условия проверок держи в основной карточке мастера.</p><label class="field-label" for="gmPublicTitle">НАЗВАНИЕ ДЛЯ ИГРОКОВ</label><input class="input" id="gmPublicTitle" name="title" maxlength="180" required value="${e(current.title)}"><label class="field-label" for="gmPublicDescription">СИТУАЦИЯ И ЦЕЛЬ</label><textarea class="textarea" id="gmPublicDescription" name="description" maxlength="4000" rows="5">${e(current.description)}</textarea><label class="field-label" for="gmPublicActions">ВАРИАНТЫ ДЕЙСТВИЙ · ОДИН НА СТРОКУ</label><textarea class="textarea" id="gmPublicActions" name="actions" maxlength="4800" rows="6" required>${e(current.actions.map(a => a.label).join('\n'))}</textarea>`;
    modal('Карточка для игроков', body, form => {
      const title = String(form.get('title') || '').trim();
      const actions = String(form.get('actions') || '').split('\n').map(a => a.trim()).filter(Boolean);
      if (!title || !actions.length || actions.length > 20 || actions.some(a => a.length > 240)) { toast('Добавь название и от 1 до 20 действий, каждое до 240 символов.'); return; }
      // Labels and positions can change independently. Keep existing identities first
      // so a custom branch retains its private check when renamed or reordered.
      const used = new Set();
      const nextActions = actions.map(label => {
        const index = current.actions.findIndex((action, index) => !used.has(index) && action.label === label);
        if (index < 0) return {label};
        used.add(index);
        return {id: current.actions[index].id, label};
      });
      const remaining = current.actions.filter((action, index) => !used.has(index));
      const renamed = nextActions.filter(action => !action.id);
      if (renamed.length === remaining.length) renamed.forEach((action, index) => { action.id = remaining[index].id; });
      for (const action of nextActions) if (!action.id) action.id = `${id}-custom-${globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2)}`;
      publicCards[id] = {title, description: String(form.get('description') || '').trim(), actions: nextActions};
      const s = scene(id);
      if (s?.rewardConfig && window.gmSceneRewardValid?.(s.rewardConfig)) { s.rewardConfig.public = {...publicCards[id]}; if (typeof save === 'function') save(); }
      try { localStorage.setItem(CARDS_KEY, JSON.stringify(publicCards)); } catch { toast('Карточка обновлена на этот сеанс. Браузер не сохранил изменения.'); }
      closeModal();
      missionSelected(id);
      paint();
    }, '<button class="button ghost" type="button" data-action="close-modal">Отмена</button><button class="button primary" type="submit">Сохранить и показать</button>', true);
  }

  function editActionCheck(missionId, actionId) {
    const s = scene(missionId);
    const action = resolutionActions(missionId).find(value => value.id === actionId);
    if (!s || !action || typeof modal !== 'function') return;
    const check = (s.actionChecks || []).find(value => value.id === actionId) || {};
    const input = (name, label, rows) => `<label class="field-label" for="gmAction-${name}">${label}</label><textarea class="textarea" id="gmAction-${name}" name="${name}" rows="${rows}" maxlength="12000">${e(check[name] || '')}</textarea>`;
    modal('Проверка действия · только мастер', `<p><strong>${e(action.label)}</strong></p><p class="muted">Эти условия сохраняются в истории ведущего. Игроки увидят только название действия.</p>${s.checks?.length ? `<label class="field-label" for="gmActionSource">ВЗЯТЬ УСЛОВИЯ ИЗ МОДУЛЯ</label><select id="gmActionSource" class="input" data-gm-source-check="${e(missionId)}"><option value="">Своя проверка…</option>${s.checks.map((source, index) => `<option value="${index}">${e(source.title || `Вариант ${index + 1}`)}</option>`).join('')}</select>` : ''}${input('check', 'БРОСОК, ПОРОГ И УСЛОВИЯ', 2)}${input('success', 'ПРИ УСПЕХЕ', 3)}${input('failure', 'ПРИ НЕУДАЧЕ / ДРУГОЙ ПУТЬ', 3)}${input('notes', 'ЗАМЕТКИ ВЕДУЩЕГО', 3)}`, form => {
      const entry = {id: actionId};
      for (const name of ['check', 'success', 'failure', 'notes']) entry[name] = String(form.get(name) || '').trim();
      s.actionChecks = (s.actionChecks || []).filter(value => value.id !== actionId);
      if (Object.values(entry).some((value, index) => index > 0 && value)) s.actionChecks.push(entry);
      if (typeof save === 'function') save();
      closeModal(); paint();
      if (typeof toast === 'function') toast('Условия действия сохранены за ширмой.');
    }, '<button class="button ghost" type="button" data-action="close-modal">Отмена</button><button class="button primary" type="submit">Сохранить проверку</button>', true);
  }

  function backupAccess() {
    if (!access || typeof download !== 'function') return;
    download('niti-master-access.json', JSON.stringify({kind: 'niti-master-access', version: 1, roomId: access.roomId, masterToken: access.masterToken}, null, 2));
    toast('Ключ мастера скачан. Храни файл лично.');
  }

  async function restoreAccess(file) {
    if (!file) return;
    try {
      if (file.size > 10000) throw new Error();
      const value = JSON.parse(await file.text());
      if (value.kind !== 'niti-master-access' || value.version !== 1 || !validAccess(value)) throw new Error();
      access = {roomId: value.roomId, masterToken: value.masterToken};
      room = null; requestedMission = null; lastPublished = ''; adoptedRoom = ''; recipients.clear();
      rememberAccess();
      await refresh();
      if (connection === 'online') toast('Управление комнатой восстановлено.');
    } catch { toast('Нужен личный JSON-файл «Ключ мастера», скачанный из общей сессии.'); }
    paint();
  }

  document.addEventListener('submit', event => {
    if (event.target.id !== 'gmSessionCreate') return;
    event.preventDefault();
    const name = String(new FormData(event.target).get('name') || '').trim();
    if (name) void create(name);
  });

  window.addEventListener('niti:scene-rewards-saved', event => {
    const id = event.detail?.sceneId;
    if (active() && room?.mission?.id === id) missionSelected(id);
    paint();
  });
  window.gmScenePublicCard = id => missionCard(id);

  document.addEventListener('change', event => {
    if (event.target.matches('[data-gm-recipient]')) {
      recipients.set(event.target.dataset.gmRecipient,event.target.value);
      if (room?.mission?.id) missionSelected(room.mission.id);
    }
    if (event.target.matches('[data-gm-mission-select]') && event.target.value) {
      const id = event.target.value;
      if (typeof selectedScene !== 'undefined') selectedScene = id;
      missionSelected(id);
    }
    if (event.target.id === 'gmSessionAccessFile') { void restoreAccess(event.target.files[0]); event.target.value = ''; }
    if (event.target.matches('[data-gm-source-check]') && event.target.value !== '') {
      const source = scene(event.target.dataset.gmSourceCheck)?.checks?.[Number(event.target.value)];
      if (source) for (const name of ['check', 'success', 'failure', 'notes']) {
        const input = document.getElementById(`gmAction-${name}`);
        if (input) input.value = name === 'notes' ? [source.detail, source.notes].filter(Boolean).join('\n') : source[name] || '';
      }
    }
  });

  document.addEventListener('toggle', event => {
    if (event.target.dataset?.gmKeepOpen) expandedDetails.set(event.target.dataset.gmKeepOpen, event.target.open);
  }, true);

  // New room events update data immediately. Repaint a world page only after
  // the master has finished a draft or closed a modal/focus presentation.
  document.addEventListener('focusout',()=>{ queueWorldRender(false); setTimeout(ensureCurrentPublication,0); });
  const modalRoot=document.getElementById('modalRoot'),focusRoot=document.getElementById('focusRoot');
  const draftObserver=new MutationObserver(()=>{ queueWorldRender(false); ensureCurrentPublication(); });
  if (modalRoot) draftObserver.observe(modalRoot,{childList:true});
  if (focusRoot) draftObserver.observe(focusRoot,{childList:true});

  document.addEventListener('click', event => {
    const control = event.target.closest('[data-gm-action]');
    if (!control || control.disabled) return;
    const action = control.dataset.gmAction;
    if (action === 'refresh') { if (requestedMission) void drainMissionQueue(); else void refresh(); }
    if (action === 'publish-mission') missionSelected(control.dataset.missionId);
    if (action === 'result') void deliverResult(control.dataset.missionId, control.dataset.resultId);
    if (action === 'edit-public') editPublic(control.dataset.missionId);
    if (action === 'edit-action-check') editActionCheck(control.dataset.missionId, control.dataset.branchId);
    if (action === 'action-outcome') markActionOutcome(control.dataset.missionId, control.dataset.branchId, control.dataset.outcome);
    if (action === 'character-level') editCharacter(control.dataset.playerId);
    if (action === 'character-delete') editCharacter(control.dataset.playerId, true);
    if (action === 'backup-access') backupAccess();
    if (action === 'restore-access') document.querySelector('#gmSessionAccessFile')?.click();
    if (action === 'copy-link') {
      void navigator.clipboard?.writeText(inviteURL()).then(() => toast('Ссылка для игроков скопирована.')).catch(() => {
        document.querySelector('#gmPlayerInvite')?.select();
        toast('Выделил ссылку. Скопируй её вручную.');
      });
      if (!navigator.clipboard) { document.querySelector('#gmPlayerInvite')?.select(); toast('Выделил ссылку. Скопируй её вручную.'); }
    }
    if (action === 'open-current' && room?.mission?.id) { if (typeof selectedScene !== 'undefined') selectedScene = room.mission.id; if (typeof navigate === 'function') navigate('scenes'); }
    if (action === 'disconnect' && typeof modal === 'function') modal('Отключить этот терминал?', '<p>Комната, игроки и награды сохранятся. Для возврата понадобится скачанный ключ мастера.</p>', () => {
      access = null; room = null; requestedMission = null; lastPublished = ''; adoptedRoom = ''; message = ''; connection = 'idle'; recipients.clear();
      try { localStorage.removeItem(KEY); } catch { /* Disconnect current runtime even when storage is blocked. */ }
      closeModal(); paint();window.gmTickerRefresh?.();
    }, '<button class="button ghost" type="button" data-action="close-modal">Отмена</button><button class="button primary" type="submit">Отключить</button>');
  });

  async function inventoryAction(operation) {
    if (!active()) throw new Error('Сначала создай общую сессию или восстанови ключ мастера.');
    const roomId = access.roomId;
    const data = await api('/rooms/' + encodeURIComponent(roomId) + '/inventory', {method:'POST',body:operation});
    if (access?.roomId !== roomId) throw new Error('Игровая комната изменилась.');
    acceptRoom(data.room); paint();
    window.dispatchEvent(new CustomEvent('niti:gm-room', {detail:{room}}));
    return room;
  }
  function onReady() { if (access && !offlineFile) void refresh(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onReady, {once: true}); else setTimeout(onReady, 0);
  setInterval(() => { if (!document.hidden && access && !publishing && !pendingResults.size) void refresh(); }, 5000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && access) void refresh(); });
  window.addEventListener('online', () => { if (access) { if (requestedMission) void drainMissionQueue(); else void refresh(); } });

  return {page, active, missionSelected, actionList, snapshot:()=>room, inventoryAction, setTicker, tickerStatus, tickerVersion, roomId:()=>access?.roomId || '', controls: s => `<section class="gm-scene-session" data-gm-scene-session="${e(s.id)}">${sceneInner(s)}</section>`, awardClick: id => {
    if (!active()) return false;
    if (typeof selectedScene !== 'undefined') selectedScene = id;
    if (typeof navigate === 'function') navigate('scenes');
    document.querySelector('.gm-outcomes')?.scrollIntoView({behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center'});
    return true;
  }};
})();

function gmSessionPage() { return GM_SESSION.page(); }
function gmSceneSessionControls(scene) { return GM_SESSION.controls(scene); }
function gmSessionMissionSelected(id) { GM_SESSION.missionSelected(id); }
function gmSessionActive() { return GM_SESSION.active(); }
function gmSessionHandleAwardClick(id) { return GM_SESSION.awardClick(id); }
function gmSessionShowResults(id) { return GM_SESSION.awardClick(id); }
function gmMissionActionList(scene) { return GM_SESSION.actionList(scene); }

window.gmSessionSnapshot = () => GM_SESSION.snapshot();
window.gmSessionInventoryAction = operation => GM_SESSION.inventoryAction(operation);

window.gmSessionSetTicker = (text,expectedVersion) => GM_SESSION.setTicker(text,expectedVersion);
window.gmSessionTickerStatus = () => GM_SESSION.tickerStatus();
window.gmSessionTickerVersion = () => GM_SESSION.tickerVersion();
window.gmSessionRoomId = () => GM_SESSION.roomId();
