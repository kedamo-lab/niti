import { InventoryError, inventoryStatsPatch, inventoryEnsure, inventoryItems, inventoryEquipment, inventoryHistory, inventoryApply, inventoryDeleteCharacter } from './inventory.js';
import { ITEM_CATALOG } from './item-catalog.js';
// Durable, capability-based session API. Only explicitly public mission fields
// announced rewards and public character dossiers enter this service; the GM module stays elsewhere.
const TABLE = 'niti_rooms';
const DEFAULT_ORIGINS = new Set([
  'https://niti-storydesk.vercel.app',
  'https://niti-storydesk.thegromvel.chatgpt.site',
  'https://niti-players.thegromvel.chatgpt.site',
]);
const encoder = new TextEncoder();
const MAX_BODY = 32768;
const MISSION_MAX_BODY = 262144;
const PERSONA_MAX_BODY = 49152;
const PERSONA_MAX_PORTRAIT = 32000;
const MAX_PLAYERS = 20;
const MAX_EVENTS = 400;
// The level thresholds printed in the supplied rulebook (level one is the floor).
const CHARACTER_XP_THRESHOLDS = [0, 200, 400, 800, 1400, 2200, 3200, 4400, 5800, 7400, 9100, 11000, 13100, 15400, 17900, 20600];
const CHARACTER_MAX_OPERATIONS = 1000;

class ApiError extends Error {
  constructor(status, message, code) { super(message); this.status = status; if (code) this.code = code; }
}

function text(value, max, required = true) {
  if (typeof value !== 'string') {
    if (!required && value == null) return '';
    throw new ApiError(400, 'Некорректный текст.');
  }
  const clean = value.trim();
  if ((required && !clean) || clean.length > max) throw new ApiError(400, 'Некорректная длина текста.');
  return clean;
}

function key(value, max = 128) {
  const clean = text(value, max);
  if (!/^[A-Za-z0-9._:-]+$/.test(clean) || ['__proto__', 'constructor', 'prototype'].includes(clean)) throw new ApiError(400, 'Некорректный идентификатор.');
  return clean;
}

function integer(value, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) throw new ApiError(400, 'Некорректное число.');
  return value;
}

function randomToken(bytes = 32) {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(data, n => n.toString(16).padStart(2, '0')).join('');
}

async function hash(value) {
  const data = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return Array.from(new Uint8Array(data), n => n.toString(16).padStart(2, '0')).join('');
}

function equalHash(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function body(request, limit = MAX_BODY) {
  if (!(request.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) {
    throw new ApiError(415, 'Нужен JSON.');
  }
  const declared = Number(request.headers.get('content-length'));
  if (declared > limit) throw new ApiError(413, 'Слишком большой запрос.');
  const reader = request.body?.getReader();
  const chunks = [];
  let length = 0;
  if (reader) {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new ApiError(413, 'Слишком большой запрос.');
      }
      chunks.push(part.value);
    }
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let result;
  try { result = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new ApiError(400, 'Некорректный JSON.'); }
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new ApiError(400, 'Нужен объект JSON.');
  return result;
}

function publicMission(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ApiError(400, 'Некорректная миссия.');
  if (!Array.isArray(input.actions) || input.actions.length > 20) throw new ApiError(400, 'Некорректные действия.');
  const seen = new Set();
  return {
    id: key(input.id), title: text(input.title, 180),
    description: text(input.description, 4000, false),
    actions: input.actions.map(action => {
      const id = key(action?.id);
      if (seen.has(id)) throw new ApiError(400, 'Действия должны иметь разные идентификаторы.');
      seen.add(id);
      return { id, label: text(action.label, 240) };
    }),
  };
}

function publicItems(input, state) {
  if (!Array.isArray(input) || input.length > 30) throw new ApiError(400, 'Некорректные предметы.');
  return input.map(item => {
    const recipientId = item?.recipientId == null ? null : key(item.recipientId);
    if (recipientId && !state.players.some(player => player.id === recipientId)) {
      throw new ApiError(400, 'Получатель предмета не найден.');
    }
    const catalogId = item?.catalogId == null || item.catalogId === '' ? null : key(item.catalogId);
    if (catalogId && !ITEM_CATALOG.some(entry => entry.id === catalogId)) throw new ApiError(400, 'Предмет не найден в каталоге.');
    return { id: key(item?.id), name: text(item.name, 180), quantity: integer(item.quantity, 1, 9999), recipientId, ...(catalogId ? { catalogId } : {}), ...(Object.hasOwn(item,'stats') ? {stats:inventoryStatsPatch(item.stats)} : {}) };
  });
}

// Resolution definitions are supplied only by the authenticated master. They are
// stored separately from the public mission and copied into immutable events.
function resolutionObject(input, allowed, message) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(field => !allowed.includes(field))) throw new ApiError(400, message);
  return input;
}

function resolutionList(input, limit, map, message) {
  if (!Array.isArray(input) || input.length > limit) throw new ApiError(400, message);
  const values = input.map(map);
  const ids = values.map(value => typeof value === 'string' ? value : value.id);
  if (new Set(ids).size !== ids.length) throw new ApiError(400, message);
  return values;
}

function resolutionEffects(input = {}) {
  resolutionObject(input, ['flags','secrets','threads','relations','nextScenes'], 'Некорректные связи результата.');
  const map = (field, limit, validate) => resolutionList(input[field] ?? [], limit, validate, 'Некорректные связи результата.');
  return {
    flags: map('flags', 100, value => {
      resolutionObject(value, ['id','value'], 'Некорректный факт результата.');
      if (!['yes','no','unknown'].includes(value.value)) throw new ApiError(400, 'Некорректное значение факта.');
      return {id:key(value.id),value:value.value};
    }),
    secrets: map('secrets', 100, value => {
      resolutionObject(value, ['id','revealed'], 'Некорректная тайна результата.');
      if (typeof value.revealed !== 'boolean') throw new ApiError(400, 'Укажите раскрытие тайны.');
      return {id:key(value.id),revealed:value.revealed};
    }),
    threads: map('threads', 100, value => {
      resolutionObject(value, ['id','status'], 'Некорректная сюжетная нить.');
      if (!['open','later','closed'].includes(value.status)) throw new ApiError(400, 'Некорректное состояние сюжетной нити.');
      return {id:key(value.id),status:value.status};
    }),
    relations: map('relations', 200, value => {
      resolutionObject(value, ['id'], 'Некорректная связь персонажей.');
      return {id:key(value.id)};
    }),
    nextScenes: map('nextScenes', 60, value => key(value)),
  };
}

function missionResolutions(input, mission, state) {
  if (!Object.hasOwn(input, 'resolutions')) return null;
  if (!mission) {
    if (!Array.isArray(input.resolutions) || input.resolutions.length) throw new ApiError(400, 'Для результатов нужна миссия.');
    return null;
  }
  const context = input.resolutionContext ?? {session:1,actions:mission.actions};
  resolutionObject(context, ['session','actions'], 'Некорректный контекст сцены.');
  const actions = resolutionList(context.actions, 60, action => {
    resolutionObject(action, ['id','label'], 'Некорректное действие сцены.');
    return {id:key(action.id,200),label:text(action.label,240)};
  }, 'Некорректные действия сцены.');
  const session = integer(context.session, 1, 1000000);
  const resolutions = resolutionList(input.resolutions, 40, result => {
    resolutionObject(result, ['id','label','summary','xp','items','complete','onceKey','xpScope','actionId','effects'], 'Некорректный результат сцены.');
    if (typeof result.complete !== 'boolean') throw new ApiError(400, 'Укажите завершение сцены.');
    const xpScope = result.xpScope ?? 'mission';
    if (!['mission','event'].includes(xpScope) || (xpScope === 'event' && result.complete)) throw new ApiError(400, 'Некорректный способ начисления опыта.');
    const actionId = key(result.actionId,200);
    if (!actions.some(action => action.id === actionId)) throw new ApiError(400, 'Действие результата отсутствует в сцене.');
    return {
      id:key(result.id),label:text(result.label,240),summary:text(result.summary,2000),
      xp:integer(result.xp,0,100000),items:publicItems(result.items ?? [],state),
      complete:result.complete,onceKey:key(result.onceKey),xpScope,actionId,
      effects:resolutionEffects(result.effects),
    };
  }, 'Некорректные результаты сцены.');
  return {missionId:mission.id,session,actions,resolutions};
}

function resolutionSnapshot(config, result, actorId) {
  return {
    version:1,session:config.session,actionId:result.actionId,
    actions:structuredClone(config.actions),effects:structuredClone(result.effects),
    label:result.label,actorId,
  };
}

function missionView(state) {
  if (!state.mission) return null;
  const config = state.resolutionConfig;
  const current = config?.missionId === state.mission.id ? config : null;
  return {
    id:state.mission.id,title:state.mission.title,description:state.mission.description,
    actions:state.mission.actions.map(action => ({id:action.id,label:action.label})),
    choices:(current?.resolutions || []).map(result => {
      const selected = state.events.some(event => event.missionId === state.mission.id && event.resultId === result.id);
      const claimedKey = state.events.some(event => event.eventId === result.onceKey);
      const completed = Object.hasOwn(state.completedMissions,state.mission.id);
      const completionBlocked = completed && (result.complete || result.xp !== 0 || result.items.length === 0);
      return {id:result.id,label:result.label,selected,available:!selected && !claimedKey && !completionBlocked};
    }),
    choiceVersion:current?.choiceVersion || '',
  };
}

function mergeItems(items) {
  const groups = new Map();
  for (const item of items) {
    const composite = `${item.id}\u0000${item.name}`;
    const old = groups.get(composite);
    if (old) old.quantity += item.quantity;
    else groups.set(composite, { id: item.id, name: item.name, quantity: item.quantity });
  }
  return [...groups.values()];
}

function characterLevel(totalXP) {
  let level = 1;
  for (let next = 2; next < CHARACTER_XP_THRESHOLDS.length; next += 1) {
    if (totalXP >= CHARACTER_XP_THRESHOLDS[next]) level = next;
  }
  return level;
}

function playerRawXP(state, player) {
  const own = state.events.filter(event => event.recipients.includes(player.id));
  return own.reduce((sum, event) => sum + event.xp, 0) + (player.characterXP || 0);
}

// This is the entire public dossier. Never spread a full character or inventory here.
function squadMember(player) {
  const persona = player.persona;
  return {
    id: player.id,
    name: persona ? persona.name : player.name,
    age: persona?.age || '', gender: persona?.gender || '',
    portrait: persona?.portrait || '', ownerName: player.ownerName || '',
  };
}
function personaPortrait(value) {
  if (typeof value !== 'string' || value.length > PERSONA_MAX_PORTRAIT) throw new ApiError(400, 'Арт должен быть подготовленным изображением до 32 000 символов.');
  if (value === '') return '';
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[2].length % 4 !== 0) throw new ApiError(400, 'Используй изображение PNG, JPEG или WebP.');
  let data;
  try { data = Uint8Array.from(atob(match[2]), character => character.charCodeAt(0)); }
  catch { throw new ApiError(400, 'Некорректное изображение.'); }
  const ascii = (offset, length) => String.fromCharCode(...data.slice(offset, offset + length));
  const view = new DataView(data.buffer);
  let width = 0, height = 0;
  if (match[1] === 'png' && data.length >= 45 && data[0] === 137 && ascii(1, 7) === 'PNG\r\n\x1a\n' && ascii(12, 4) === 'IHDR' && ascii(data.length - 8, 4) === 'IEND') {
    width = view.getUint32(16); height = view.getUint32(20);
  } else if (match[1] === 'jpeg' && data.length >= 12 && data[0] === 255 && data[1] === 216 && data[data.length - 2] === 255 && data[data.length - 1] === 217) {
    let offset = 2;
    while (offset + 4 <= data.length) {
      if (data[offset++] !== 255) break;
      while (data[offset] === 255) offset++;
      const marker = data[offset++];
      if (marker === 218 || marker === 217) break;
      if (marker === 1 || marker >= 208 && marker <= 215) continue;
      if (offset + 2 > data.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > data.length) break;
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker) && length >= 8) {
        height = view.getUint16(offset + 3); width = view.getUint16(offset + 5); break;
      }
      offset += length;
    }
  } else if (match[1] === 'webp' && data.length >= 25 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP' && view.getUint32(4, true) + 8 === data.length) {
    const chunk = ascii(12, 4);
    if (chunk === 'VP8X' && data.length >= 30) {
      width = 1 + data[24] + (data[25] << 8) + (data[26] << 16);
      height = 1 + data[27] + (data[28] << 8) + (data[29] << 16);
    } else if (chunk === 'VP8L' && data[20] === 47) {
      width = 1 + ((data[21] | data[22] << 8) & 16383);
      height = 1 + ((data[22] >> 6 | data[23] << 2 | data[24] << 10) & 16383);
    } else if (chunk === 'VP8 ' && data.length >= 30 && data[23] === 157 && data[24] === 1 && data[25] === 42) {
      width = view.getUint16(26, true) & 16383; height = view.getUint16(28, true) & 16383;
    }
  }
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 2000 || height > 3000 || width * height > 6000000) throw new ApiError(400, 'Не удалось прочитать изображение или его размер слишком велик.');
  return value;
}
function personaPatch(input) {
  const fields = {name:80,age:40,gender:80,ownerName:80};
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(field => field !== 'portrait' && !Object.hasOwn(fields, field))) throw new ApiError(400, 'В открытом досье допустимы только имя, возраст, пол, арт и имя игрока.');
  const result = {};
  for (const [field, value] of Object.entries(input)) {
    if (field === 'portrait') result.portrait = personaPortrait(value);
    else {
      if (typeof value !== 'string') throw new ApiError(400, 'Поля открытого досье должны быть текстом.');
      result[field] = text(value, fields[field], false);
      if (/[\u0000-\u001f\u007f]/.test(result[field])) throw new ApiError(400, 'В открытом досье нужен однострочный текст.');
    }
  }
  return result;
}

function characterView(state, player) {
  const rawXP = playerRawXP(state, player);
  const baseXP = player.character?.baseXP || 0;
  const beacon = player.character?.beacon === true;
  const earnedXP = rawXP * (beacon ? 0.5 : 1);
  const totalXP = baseXP + earnedXP;
  const level = characterLevel(totalXP);
  return {
    name: player.name, synced: !!player.character, baseXP, beacon,
    rawXP, earnedXP, totalXP, level,
    nextXP: CHARACTER_XP_THRESHOLDS[level + 1] ?? null,
    updatedAt: player.character?.updatedAt || null,
  };
}

function playerView(state, player) {
  return {
    id: player.id, name: player.name, ownerName: player.ownerName || '',
    xp: playerRawXP(state, player),
    character: characterView(state, player),
    inventory: inventoryItems(state, player.id),
    equipment: inventoryEquipment(state, player.id),
  };
}

function tickerText(value) {
  if (typeof value !== 'string' || value.length > 600) throw new ApiError(400, 'В бегущей строке может быть до 600 символов.');
  const normalized = value.replace(/\r\n?/g, '\n').split('\n').map(line => line.trim()).filter(Boolean).join('\n');
  if (!normalized) throw new ApiError(400, 'Добавьте хотя бы одну фразу в бегущую строку.');
  return normalized;
}

function tickerView(state) {
  const ticker = state.ticker;
  return ticker ? {text:ticker.text,version:ticker.version,updatedAt:ticker.updatedAt} : null;
}

function roomView(row, state, auth) {
  const master = auth.role === 'master';
  const currentPlayer = state.players.find(player => player.id === auth.playerId);
  const events = state.events.map(event => ({
    id: event.eventId, eventId: event.eventId, missionId: event.missionId,
    resultId: event.resultId, summary: event.summary, xp: event.xp, xpScope:event.xpScope || 'mission',
    items: event.items.filter(item => master || item.recipientId === null || item.recipientId === auth.playerId),
    complete: event.complete, createdAt: event.createdAt,
    ...(master ? { recipients: event.recipients } : { awardedToSelf: event.recipients.includes(auth.playerId) }),
    ...(master && event.resolution ? {resolution:structuredClone(event.resolution)} : {}),
    ...(event.actorName ? {actorName:event.actorName} : {}),
  }));
  return {
    id: row.id, name: state.name, revision: row.revision, ticker: tickerView(state),
    mission: missionView(state), result: state.result,
    players: state.players.map(player => master ? playerView(state, player) : { id: player.id, name: player.name }),
    squad: state.players.map(squadMember),
    sharedItems: inventoryItems(state, null),
    inventoryHistory: inventoryHistory(state, auth),
    completedMissions: state.completedMissions,
    awardedMissions: Object.keys(state.awardedMissions),
    events,
    ...(master ? {resolutionConfig:state.resolutionConfig ? structuredClone(state.resolutionConfig) : null} : {}),
    ...(master ? {} : { self: playerView(state, currentPlayer) }),
  };
}

async function load(env, id) {
  const row = await env.DB.prepare(`SELECT id, master_hash, state_json, revision FROM ${TABLE} WHERE id = ?`).bind(id).first();
  if (!row) throw new ApiError(404, 'Сессия не найдена.');
  return { row, state: JSON.parse(row.state_json) };
}

async function authenticate(request, row, state, allowDeleted = false) {
  const header = request.headers.get('authorization') || '';
  const token = /^Bearer ([A-Za-z0-9_-]{32,256})$/.exec(header)?.[1];
  if (!token) throw new ApiError(401, 'Нужен ключ сессии.');
  const digest = await hash(token);
  if (equalHash(digest, row.master_hash)) return { role: 'master' };
  const player = state.players.find(item => equalHash(digest, item.tokenHash));
  if (player) return { role: 'player', playerId: player.id };
  const deleted = (state.deletedPlayers || []).find(item => equalHash(digest, item.tokenHash));
  if (deleted) {
    if (allowDeleted) return { role: 'deleted-player', playerId: deleted.id };
    throw new ApiError(401, 'Этот персонаж удалён. Создайте нового персонажа для подключения.', 'CHARACTER_DELETED');
  }
  throw new ApiError(401, 'Ключ сессии не подходит.');
}

function masterOnly(auth) {
  if (auth.role !== 'master') throw new ApiError(403, 'Это действие доступно мастеру.');
}

async function mutate(env, id, callback) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { row, state } = await load(env, id);
    const outcome = await callback(row, state);
    if (!outcome.changed) return { ...outcome, row, state };
    const serialized = JSON.stringify(state);
    if (serialized.length > 1000000) throw new ApiError(409, 'Сессия заполнена. Начните новую сессию.');
    const updated = await env.DB.prepare(`UPDATE ${TABLE} SET state_json = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?`)
      .bind(serialized, Date.now(), id, row.revision).run();
    if (updated.meta?.changes === 1) return { ...outcome, row: { ...row, revision: row.revision + 1 }, state };
  }
  throw new ApiError(409, 'Сессия обновляется. Повторите действие.');
}

async function route(request, env, pathname) {
  if (pathname === '/api/health' && request.method === 'GET') {
    if (!env.DB) throw new ApiError(503, 'Общая сессия временно недоступна.');
    await env.DB.prepare(`SELECT id FROM ${TABLE} LIMIT 1`).first();
    return { ready: true };
  }
  if (!env.DB) throw new ApiError(503, 'Общая сессия временно недоступна.');
  if (pathname === '/api/rooms' && request.method === 'POST') {
    const input = await body(request);
    const name = text(input.name, 100);
    const roomId = randomToken(16), masterToken = randomToken();
    const masterHash = await hash(masterToken), now = Date.now();
    const state = { version: 1, name, players: [], mission: null, result: null, events: [], completedMissions: {}, awardedMissions: {} };
    await env.DB.prepare(`INSERT INTO ${TABLE} (id, master_hash, state_json, revision, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)`)
      .bind(roomId, masterHash, JSON.stringify(state), now, now).run();
    return { roomId, masterToken, room: roomView({ id: roomId, revision: 0 }, state, { role: 'master' }) };
  }
  const match = /^\/api\/rooms\/([a-f0-9]{32})(?:\/(join|mission|result|choice|inventory|characters|persona|ticker))?$/.exec(pathname);
  if (!match) throw new ApiError(404, 'Адрес не найден.');
  const [, roomId, action] = match;

  if (action === 'join' && request.method === 'POST') {
    const input = await body(request);
    const name = text(input.name, 80);
    const joinKey = input.joinKey == null ? randomToken() : key(input.joinKey);
    if (joinKey.length < 16) throw new ApiError(400, 'Нужен случайный ключ подключения.');
    const joinHash = await hash(joinKey);
    const playerToken = input.playerToken == null ? await hash(`niti-player-v1:${roomId}:${joinKey}`) : text(input.playerToken, 256);
    if (!/^[A-Za-z0-9_-]{32,256}$/.test(playerToken)) throw new ApiError(400, 'Нужен случайный ключ игрока.');
    const tokenHash = await hash(playerToken);
    const mutation = await mutate(env, roomId, (row, state) => {
      if ((state.deletedPlayers || []).some(player => equalHash(player.joinHash, joinHash) || equalHash(player.tokenHash, tokenHash))) {
        throw new ApiError(410, 'Этот персонаж удалён. Подключитесь заново с новым персонажем.', 'CHARACTER_DELETED');
      }
      const existing = state.players.find(player => equalHash(player.joinHash, joinHash));
      if (existing) {
        if (!equalHash(existing.tokenHash, tokenHash)) throw new ApiError(409, 'Ключ подключения уже использован.');
        return { changed: false, auth: { role: 'player', playerId: existing.id }, duplicate: true };
      }
      if (state.players.some(player => equalHash(player.tokenHash, tokenHash))) throw new ApiError(409, 'Ключ игрока уже использован.');
      if (state.players.length >= MAX_PLAYERS) throw new ApiError(409, 'В сессии уже 20 игроков.');
      const playerId = randomToken(12);
      state.players.push({ id: playerId, name, ownerName: name, persona:{name:'',age:'',gender:'',portrait:''}, tokenHash, joinHash, joinedAt: Date.now() });
      return { changed: true, auth: { role: 'player', playerId } };
    });
    return { roomId, playerId: mutation.auth.playerId, playerToken, duplicate: !!mutation.duplicate, room: roomView(mutation.row, mutation.state, mutation.auth) };
  }

  if (!action && request.method === 'GET') {
    const { row, state } = await load(env, roomId);
    const auth = await authenticate(request, row, state);
    return { room: roomView(row, state, auth) };
  }
  if (!action && request.method === 'DELETE') {
    const { row, state } = await load(env, roomId);
    const auth = await authenticate(request, row, state);
    masterOnly(auth);
    await env.DB.prepare(`DELETE FROM ${TABLE} WHERE id = ? AND master_hash = ?`).bind(roomId, row.master_hash).run();
    return { deleted: true };
  }
  if (action === 'ticker' && request.method === 'POST') {
    const input = await body(request);
    resolutionObject(input, ['text','expectedVersion'], 'Некорректное изменение бегущей строки.');
    const value = tickerText(input.text);
    const expectedVersion = integer(input.expectedVersion, 0, Number.MAX_SAFE_INTEGER);
    const mutation = await mutate(env, roomId, async (row, state) => {
      const auth = await authenticate(request, row, state);
      masterOnly(auth);
      const current = state.ticker;
      // A lost successful reply is safe to retry even after the version changed.
      if (current?.text === value) return {changed:false,auth,duplicate:true};
      const version = current?.version || 0;
      if (version !== expectedVersion) throw new ApiError(409, 'Бегущая строка уже изменилась. Обновите её перед сохранением.');
      if (version >= Number.MAX_SAFE_INTEGER) throw new ApiError(409, 'Достигнут предел обновлений бегущей строки.');
      state.ticker = {text:value,version:version+1,updatedAt:Date.now()};
      return {changed:true,auth};
    });
    return {duplicate:!!mutation.duplicate,room:roomView(mutation.row,mutation.state,mutation.auth)};
  }
  if (action === 'persona' && request.method === 'POST') {
    const input = await body(request, PERSONA_MAX_BODY);
    if (Object.keys(input).some(field => field !== 'persona')) throw new ApiError(400, 'Некорректное действие с открытым досье.');
    const patch = personaPatch(input.persona);
    const mutation = await mutate(env, roomId, async (row, state) => {
      const auth = await authenticate(request, row, state);
      if (auth.role !== 'player') throw new ApiError(403, 'Открытое досье меняет только его владелец.');
      const player = state.players.find(member => member.id === auth.playerId);
      const previous = player.persona || {name:player.name,age:'',gender:'',portrait:''};
      const persona = {...previous};
      for (const field of ['name','age','gender','portrait']) if (Object.hasOwn(patch, field)) persona[field] = patch[field];
      const ownerName = Object.hasOwn(patch, 'ownerName') ? patch.ownerName : player.ownerName || '';
      if (JSON.stringify(previous) === JSON.stringify(persona) && (player.ownerName || '') === ownerName && player.persona) return {changed:false,auth};
      player.persona = persona; player.ownerName = ownerName;
      // Preserve the GM's existing character labels without using them as owner names.
      if (persona.name) player.name = persona.name;
      return {changed:true,auth};
    });
    return {room:roomView(mutation.row, mutation.state, mutation.auth)};
  }
  if (action === 'characters' && request.method === 'POST') {
    const input = await body(request);
    const characterAction = text(input.action, 20);
    if (!['sync', 'level', 'delete'].includes(characterAction)) throw new ApiError(400, 'Неизвестное действие с персонажем.');
    const allowedFields = characterAction === 'sync' ? ['action', 'character'] : characterAction === 'level' ? ['action', 'playerId', 'targetLevel', 'operationId'] : ['action', 'playerId', 'operationId'];
    if (Object.keys(input).some(field => !allowedFields.includes(field))) throw new ApiError(400, 'Неизвестное поле действия с персонажем.');
    const operationId = characterAction === 'sync' ? null : key(input.operationId);
    if (operationId && operationId.length < 16) throw new ApiError(400, 'Нужен случайный идентификатор действия.');
    const mutation = await mutate(env, roomId, async (row, state) => {
      const auth = await authenticate(request, row, state, characterAction === 'delete');
      if (characterAction === 'sync') {
        if (auth.role !== 'player') throw new ApiError(403, 'Анкету синхронизирует её владелец.');
        const source = input.character;
        if (!source || typeof source !== 'object' || Array.isArray(source) || Object.keys(source).some(field => !['name', 'baseXP', 'beacon'].includes(field))) throw new ApiError(400, 'Некорректные данные анкеты.');
        const baseXP = integer(source.baseXP, 0, Number.MAX_SAFE_INTEGER - 1000000000);
        if (typeof source.beacon !== 'boolean') throw new ApiError(400, 'Укажите наличие особенности «Светоч».');
        const name = source.name === undefined ? '' : text(source.name, 80, false);
        const player = state.players.find(item => item.id === auth.playerId);
        if (player.character?.baseXP === baseXP && player.character?.beacon === source.beacon && (!name || player.name === name)) return { changed: false, auth };
        player.character = { version: 1, baseXP, beacon: source.beacon, updatedAt: Date.now() };
        if (name) player.name = name;
        return { changed: true, auth };
      }
      const playerId = input.playerId == null && characterAction === 'delete' ? auth.playerId : key(input.playerId);
      if (characterAction === 'level') masterOnly(auth);
      if (characterAction === 'delete' && auth.role !== 'master' && auth.playerId !== playerId) throw new ApiError(403, 'Удалить персонажа может его владелец или мастер.');
      const targetLevel = characterAction === 'level' ? integer(input.targetLevel, 2, CHARACTER_XP_THRESHOLDS.length - 1) : null;
      const fingerprint = await hash(JSON.stringify({ action: characterAction, playerId, targetLevel }));
      const operations = state.characterOperations || [];
      const actorId = auth.role === 'master' ? 'master' : auth.playerId;
      const prior = operations.find(operation => operation.id === operationId);
      if (prior) {
        if (prior.actorId !== actorId || prior.fingerprint !== fingerprint) throw new ApiError(409, 'Идентификатор действия уже использован.');
        return { changed: false, auth, duplicate: true, deleted: characterAction === 'delete', playerId, appliedXp: prior.appliedXp || 0, returnedItems: prior.returnedItems || 0 };
      }
      if (auth.role === 'deleted-player') throw new ApiError(401, 'Этот персонаж уже удалён.', 'CHARACTER_DELETED');
      if (operations.length >= CHARACTER_MAX_OPERATIONS) throw new ApiError(409, 'Журнал персонажей заполнен. Начните новую сессию.');
      const player = state.players.find(item => item.id === playerId);
      if (!player) throw new ApiError(404, 'Персонаж не найден.');
      const operation = { id: operationId, actorId, fingerprint, action: characterAction, playerId, createdAt: Date.now() };
      if (characterAction === 'level') {
        if (!player.character) throw new ApiError(409, 'Игроку нужно открыть обновлённую анкету онлайн, чтобы синхронизировать опыт и особенности.');
        const progress = characterView(state, player);
        if (targetLevel <= progress.level) throw new ApiError(409, 'Выберите уровень выше текущего.');
        const rate = progress.beacon ? 0.5 : 1;
        const appliedXp = Math.ceil((CHARACTER_XP_THRESHOLDS[targetLevel] - progress.totalXP) / rate);
        if (!Number.isSafeInteger(appliedXp) || appliedXp < 1) throw new ApiError(409, 'Не удалось рассчитать повышение уровня.');
        player.characterXP = (player.characterXP || 0) + appliedXp;
        player.character.updatedAt = operation.createdAt;
        operation.appliedXp = appliedXp;
      } else {
        const returned = inventoryDeleteCharacter(state, player, operationId, auth);
        operation.returnedItems = returned.quantity;
        state.deletedPlayers = [...(state.deletedPlayers || []), { id: player.id, name: player.name, tokenHash: player.tokenHash, joinHash: player.joinHash, deletedAt: operation.createdAt }];
        state.players = state.players.filter(item => item.id !== player.id);
      }
      state.characterOperations = [...operations, operation];
      return { changed: true, auth, deleted: characterAction === 'delete', playerId, appliedXp: operation.appliedXp || 0, returnedItems: operation.returnedItems || 0 };
    });
    return {
      duplicate: !!mutation.duplicate,
      ...(mutation.deleted ? { deleted: true, playerId: mutation.playerId, returnedItems: mutation.returnedItems } : {}),
      ...(characterAction === 'level' ? { appliedXp: mutation.appliedXp, playerId: mutation.playerId } : {}),
      ...(!mutation.deleted || mutation.auth.role === 'master' ? { room: roomView(mutation.row, mutation.state, mutation.auth) } : {}),
    };
  }
  if (action === 'inventory' && request.method === 'POST') {
    const input = await body(request);
    const mutation = await mutate(env, roomId, async (row, state) => {
      const auth = await authenticate(request, row, state);
      const outcome = await inventoryApply(state, auth, input);
      return { ...outcome, auth };
    });
    return { duplicate: !!mutation.duplicate, ...(mutation.outcome?{outcome:mutation.outcome}:{}), room: roomView(mutation.row, mutation.state, mutation.auth) };
  }
  if (action === 'mission' && request.method === 'POST') {
    const input = await body(request, MISSION_MAX_BODY);
    resolutionObject(input, ['mission','resolutions','resolutionContext'], 'Некорректная публикация сцены.');
    const mission = input.mission === null ? null : publicMission(input.mission);
    const mutation = await mutate(env, roomId, async (row, state) => {
      const auth = await authenticate(request, row, state);
      masterOnly(auth);
      const config = missionResolutions(input, mission, state);
      const previous = state.resolutionConfig ? {...state.resolutionConfig} : null;
      if (previous) delete previous.choiceVersion;
      if (JSON.stringify({mission:state.mission,config:previous}) === JSON.stringify({mission,config})) return { changed: false, auth };
      if (state.mission?.id !== mission?.id) {
        const completed = mission && Object.hasOwn(state.completedMissions, mission.id) ? state.completedMissions[mission.id] : null;
        const event = completed && state.events.find(item => item.eventId === completed.eventId);
        state.result = event ? { missionId: event.missionId, resultId: event.resultId, summary: event.summary, complete: event.complete, eventId: event.eventId, createdAt: event.createdAt } : null;
      }
      state.mission = mission;
      state.resolutionConfig = config ? {...config,choiceVersion:randomToken(16)} : null;
      return { changed: true, auth };
    });
    return { room: roomView(mutation.row, mutation.state, mutation.auth) };
  }
  if (action === 'choice' && request.method === 'POST') {
    const input = await body(request);
    resolutionObject(input, ['missionId','resultId','choiceVersion'], 'Игрок выбирает только опубликованный результат.');
    const missionId = key(input.missionId), resultId = key(input.resultId), choiceVersion = key(input.choiceVersion);
    const mutation = await mutate(env, roomId, async (row, state) => {
      const auth = await authenticate(request, row, state);
      if (auth.role !== 'player') throw new ApiError(403, 'Выбор результата доступен игрокам.');
      // A lost reply remains retryable after the GM changes the displayed scene.
      const prior = state.events.find(event => event.missionId === missionId && event.resultId === resultId);
      if (prior) return {changed:false,auth,duplicate:true,appliedXp:prior.xp};
      const config = state.resolutionConfig;
      if (state.mission?.id !== missionId || config?.missionId !== missionId || config.choiceVersion !== choiceVersion) throw new ApiError(409, 'Сцена обновилась. Обновите её и выберите результат заново.');
      const result = config.resolutions.find(value => value.id === resultId);
      if (!result) throw new ApiError(409, 'Этот результат не опубликован мастером.');
      const completed = Object.hasOwn(state.completedMissions, missionId);
      if (completed && (result.complete || result.xp !== 0 || result.items.length === 0)) throw new ApiError(409, 'Для этой сцены уже выбран другой результат.');
      const previousKey = state.events.find(event => event.eventId === result.onceKey);
      if (previousKey) {
        if (previousKey.missionId !== missionId || previousKey.resultId !== resultId) throw new ApiError(409, 'Для этого события уже выбран другой результат.');
        return {changed:false,auth,duplicate:true,appliedXp:previousKey.xp};
      }
      if (state.events.length >= MAX_EVENTS) throw new ApiError(409, 'Журнал сессии заполнен. Обратитесь к мастеру.');
      // Validate recipients against the current roster as well as at publication.
      const items = publicItems(result.items, state);
      const xp = result.xpScope === 'event' ? result.xp : Object.hasOwn(state.awardedMissions, missionId) ? 0 : result.xp;
      const actor = state.players.find(player => player.id === auth.playerId);
      const createdAt = Date.now();
      const event = {
        eventId:result.onceKey,missionId,resultId,summary:result.summary,xp,items,
        complete:result.complete,createdAt,recipients:state.players.map(player => player.id),xpScope:result.xpScope,
        resolution:resolutionSnapshot(config,result,auth.playerId),actorName:actor?.persona?.name || actor?.name || 'Игрок',
      };
      state.events.push(event);
      inventoryEnsure(state);
      if ((xp > 0 && result.xpScope === 'mission') || result.complete) state.awardedMissions[missionId] = {xp,eventId:event.eventId};
      if (result.complete) state.completedMissions[missionId] = {resultId,eventId:event.eventId};
      if (!completed) state.result = {missionId,resultId,summary:result.summary,complete:result.complete,eventId:event.eventId,createdAt};
      return {changed:true,auth,appliedXp:xp};
    });
    return {duplicate:!!mutation.duplicate,appliedXp:mutation.appliedXp,room:roomView(mutation.row,mutation.state,mutation.auth)};
  }
  if (action === 'result' && request.method === 'POST') {
    const input = await body(request);
    const eventId = key(input.eventId), missionId = key(input.missionId), resultId = key(input.resultId);
    const summary = text(input.summary, 2000);
    const requestedXp = integer(input.xp, 0, 100000);
    const xpScope = input.xpScope ?? 'mission';
    if (!['mission', 'event'].includes(xpScope) || (xpScope === 'event' && input.complete !== false)) throw new ApiError(400, 'Некорректный способ начисления опыта.');
    if (typeof input.complete !== 'boolean') throw new ApiError(400, 'Укажите завершение миссии.');
    const mutation = await mutate(env, roomId, async (row, state) => {
      const auth = await authenticate(request, row, state);
      masterOnly(auth);
      const prior = state.events.find(event => event.eventId === eventId || (event.missionId === missionId && event.resultId === resultId));
      if (prior?.eventId === eventId && (prior.missionId !== missionId || prior.resultId !== resultId)) throw new ApiError(409, 'Идентификатор результата уже использован.');
      if (prior) return { changed: false, auth, duplicate: true, appliedXp: prior.xp };
      const completed = Object.hasOwn(state.completedMissions, missionId);
      if (completed && (input.complete || requestedXp !== 0 || !Array.isArray(input.items) || input.items.length === 0)) throw new ApiError(409, 'Эта миссия уже завершена. Повторная награда заблокирована.');
      if (state.mission?.id !== missionId) throw new ApiError(409, 'Сначала покажите эту миссию игрокам.');
      if (state.events.length >= MAX_EVENTS) throw new ApiError(409, 'Журнал сессии заполнен. Начните новую сессию.');
      const items = publicItems(input.items ?? [], state);
      const xp = xpScope === 'event' ? requestedXp : Object.hasOwn(state.awardedMissions, missionId) ? 0 : requestedXp;
      const createdAt = Date.now();
      const event = { eventId, missionId, resultId, summary, xp, items, complete: input.complete, createdAt, recipients: state.players.map(player => player.id), xpScope };
      const configured = state.resolutionConfig?.missionId === missionId ? state.resolutionConfig.resolutions.find(result => result.id === resultId) : null;
      if (configured) event.resolution = resolutionSnapshot(state.resolutionConfig,configured,'master');
      state.events.push(event);
      inventoryEnsure(state);
      if ((xp > 0 && xpScope === 'mission') || input.complete) state.awardedMissions[missionId] = { xp, eventId };
      if (input.complete) state.completedMissions[missionId] = { resultId, eventId };
      if (!completed) state.result = { missionId, resultId, summary, complete: input.complete, eventId, createdAt };
      return { changed: true, auth, appliedXp: xp };
    });
    return { duplicate: !!mutation.duplicate, appliedXp: mutation.appliedXp, room: roomView(mutation.row, mutation.state, mutation.auth) };
  }
  throw new ApiError(405, 'Метод не поддерживается.');
}

export async function handleApi(request, env, options = {}) {
  const pathname = new URL(request.url).pathname;
  if (!pathname.startsWith('/api/')) return null;
  const origin = request.headers.get('origin');
  const origins = options.allowedOrigins ? new Set(options.allowedOrigins) : DEFAULT_ORIGINS;
  const allowed = !origin || origins.has(origin);
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer', 'vary': 'Origin',
    ...(origin && allowed ? { 'access-control-allow-origin': origin } : {}),
  };
  if (!allowed) return new Response(JSON.stringify({ error: 'Этот адрес не разрешён.' }), { status: 403, headers });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: {
    ...headers, 'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
    'access-control-allow-headers': 'Authorization, Content-Type', 'access-control-max-age': '600',
  } });
  try {
    const result = await route(request, env, pathname);
    return new Response(JSON.stringify(result), { status: 200, headers });
  } catch (error) {
    const status = (error instanceof ApiError || error instanceof InventoryError) ? error.status : 503;
    const message = (error instanceof ApiError || error instanceof InventoryError) ? error.message : 'Общая сессия временно недоступна. Повторите действие.';
    return new Response(JSON.stringify({ error: message, ...(error instanceof ApiError && error.code ? { code: error.code } : {}) }), { status, headers });
  }
}
