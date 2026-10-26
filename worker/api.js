// Durable, capability-based session API. Only explicitly public mission fields
// and announced rewards ever enter this service; the GM module stays elsewhere.
const TABLE = 'niti_rooms';
const DEFAULT_ORIGINS = new Set([
  'https://niti-storydesk.vercel.app',
  'https://niti-storydesk.thegromvel.chatgpt.site',
  'https://niti-players.thegromvel.chatgpt.site',
]);
const encoder = new TextEncoder();
const MAX_BODY = 32768;
const MAX_PLAYERS = 20;
const MAX_EVENTS = 400;

class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
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

async function body(request) {
  if (!(request.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) {
    throw new ApiError(415, 'Нужен JSON.');
  }
  const declared = Number(request.headers.get('content-length'));
  if (declared > MAX_BODY) throw new ApiError(413, 'Слишком большой запрос.');
  const reader = request.body?.getReader();
  const chunks = [];
  let length = 0;
  if (reader) {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > MAX_BODY) {
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
    return { id: key(item?.id), name: text(item.name, 180), quantity: integer(item.quantity, 1, 9999), recipientId };
  });
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

function playerView(state, player) {
  const own = state.events.filter(event => event.recipients.includes(player.id));
  return {
    id: player.id, name: player.name,
    xp: own.reduce((sum, event) => sum + event.xp, 0),
    inventory: mergeItems(state.events.flatMap(event => event.items.filter(item => item.recipientId === player.id))),
  };
}

function roomView(row, state, auth) {
  const master = auth.role === 'master';
  const currentPlayer = state.players.find(player => player.id === auth.playerId);
  const events = state.events.map(event => ({
    id: event.eventId, eventId: event.eventId, missionId: event.missionId,
    resultId: event.resultId, summary: event.summary, xp: event.xp,
    items: event.items.filter(item => master || item.recipientId === null || item.recipientId === auth.playerId),
    complete: event.complete, createdAt: event.createdAt,
    ...(master ? { recipients: event.recipients } : { awardedToSelf: event.recipients.includes(auth.playerId) }),
  }));
  return {
    id: row.id, name: state.name, revision: row.revision,
    mission: state.mission, result: state.result,
    players: state.players.map(player => master ? playerView(state, player) : { id: player.id, name: player.name }),
    sharedItems: mergeItems(state.events.flatMap(event => event.items.filter(item => item.recipientId === null))),
    completedMissions: state.completedMissions,
    awardedMissions: Object.keys(state.awardedMissions),
    events,
    ...(master ? {} : { self: playerView(state, currentPlayer) }),
  };
}

async function load(env, id) {
  const row = await env.DB.prepare(`SELECT id, master_hash, state_json, revision FROM ${TABLE} WHERE id = ?`).bind(id).first();
  if (!row) throw new ApiError(404, 'Сессия не найдена.');
  return { row, state: JSON.parse(row.state_json) };
}

async function authenticate(request, row, state) {
  const header = request.headers.get('authorization') || '';
  const token = /^Bearer ([A-Za-z0-9_-]{32,256})$/.exec(header)?.[1];
  if (!token) throw new ApiError(401, 'Нужен ключ сессии.');
  const digest = await hash(token);
  if (equalHash(digest, row.master_hash)) return { role: 'master' };
  const player = state.players.find(item => equalHash(digest, item.tokenHash));
  if (player) return { role: 'player', playerId: player.id };
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
  const match = /^\/api\/rooms\/([a-f0-9]{32})(?:\/(join|mission|result))?$/.exec(pathname);
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
      const existing = state.players.find(player => equalHash(player.joinHash, joinHash));
      if (existing) {
        if (!equalHash(existing.tokenHash, tokenHash)) throw new ApiError(409, 'Ключ подключения уже использован.');
        return { changed: false, auth: { role: 'player', playerId: existing.id }, duplicate: true };
      }
      if (state.players.length >= MAX_PLAYERS) throw new ApiError(409, 'В сессии уже 20 игроков.');
      const playerId = randomToken(12);
      state.players.push({ id: playerId, name, tokenHash, joinHash, joinedAt: Date.now() });
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
  if (action === 'mission' && request.method === 'POST') {
    const input = await body(request);
    const mission = input.mission === null ? null : publicMission(input.mission);
    const mutation = await mutate(env, roomId, async (row, state) => {
      const auth = await authenticate(request, row, state);
      masterOnly(auth);
      if (JSON.stringify(state.mission) === JSON.stringify(mission)) return { changed: false, auth };
      if (state.mission?.id !== mission?.id) {
        const completed = mission && Object.hasOwn(state.completedMissions, mission.id) ? state.completedMissions[mission.id] : null;
        const event = completed && state.events.find(item => item.eventId === completed.eventId);
        state.result = event ? { missionId: event.missionId, resultId: event.resultId, summary: event.summary, complete: event.complete, eventId: event.eventId, createdAt: event.createdAt } : null;
      }
      state.mission = mission;
      return { changed: true, auth };
    });
    return { room: roomView(mutation.row, mutation.state, mutation.auth) };
  }
  if (action === 'result' && request.method === 'POST') {
    const input = await body(request);
    const eventId = key(input.eventId), missionId = key(input.missionId), resultId = key(input.resultId);
    const summary = text(input.summary, 2000);
    const requestedXp = integer(input.xp, 0, 100000);
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
      const xp = Object.hasOwn(state.awardedMissions, missionId) ? 0 : requestedXp;
      const createdAt = Date.now();
      const event = { eventId, missionId, resultId, summary, xp, items, complete: input.complete, createdAt, recipients: state.players.map(player => player.id) };
      state.events.push(event);
      if (xp > 0 || input.complete) state.awardedMissions[missionId] = { xp, eventId };
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
    const status = error instanceof ApiError ? error.status : 503;
    const message = error instanceof ApiError ? error.message : 'Общая сессия временно недоступна. Повторите действие.';
    return new Response(JSON.stringify({ error: message }), { status, headers });
  }
}
