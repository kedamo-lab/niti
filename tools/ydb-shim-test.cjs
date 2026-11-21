'use strict';
// Exercises tools/ydb-db.cjs against local stand-ins for the two Yandex
// endpoints: an IAM token issuer and a DynamoDB-compatible table. The real
// compiled Worker runs on top, so the SQL it issues, the optimistic-update
// retries and the state round-trip are all checked end to end.
//
//   node tools/ydb-shim-test.cjs
const http = require('node:http');
const crypto = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createDatabase, encodeState, UnsupportedStatement } = require('./ydb-db.cjs');

const root = path.resolve(__dirname, '..');
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
}

// --- Keys -------------------------------------------------------------------
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const KEY_ID = 'test-key-id';
const SERVICE_ACCOUNT = 'test-service-account';

// --- In-memory DynamoDB -----------------------------------------------------
const tables = new Map();          // tableName -> Map(id -> item)
const calls = {};                  // op -> count
const itemBytes = new Map();       // id -> stored byte size

function resolve(expression, names, values, item) {
  return expression.replace(/#(\w+)|:(\w+)/g, (whole, name, value) => {
    if (name) {
      if (!(('#' + name) in names)) throw new Error('Unknown name ' + whole);
      return names['#' + name];
    }
    if (!((':' + value) in values)) throw new Error('Unknown value ' + whole);
    const attribute = values[':' + value];
    if ('N' in attribute) return Number(attribute.N);
    if ('S' in attribute) return attribute.S;
    if ('B' in attribute) return '<B ' + attribute.B.length + '>';
    return undefined;
  });
}

function sameAttribute(left, right) {
  if (left === undefined || right === undefined) return false;
  if ('N' in right) return Number(left && left.N) === Number(right.N);
  if ('S' in right) return left && left.S === right.S;
  if ('B' in right) return left && left.B === right.B;
  return false;
}

function conditionHolds(item, expression, names, values) {
  for (const part of expression.split(' AND ')) {
    const notExists = /^attribute_not_exists\(#(\w+)\)$/.exec(part.trim());
    if (notExists) {
      if (item && Object.prototype.hasOwnProperty.call(item, names['#' + notExists[1]])) return false;
      continue;
    }
    const equal = /^#(\w+) = :(\w+)$/.exec(part.trim());
    if (!equal) throw new Error('Unsupported condition: ' + part);
    const column = names['#' + equal[1]];
    if (!item || !sameAttribute(item[column], values[':' + equal[2]])) return false;
  }
  return true;
}

function sizeOfItem(item) {
  const json = JSON.stringify(item);
  return Buffer.byteLength(json, 'utf8');
}

function getTable(name) {
  const table = tables.get(name);
  if (!table) {
    const error = new Error('Requested resource not found');
    error.type = 'com.amazonaws.dynamodb.v20120810#ResourceNotFoundException';
    throw error;
  }
  return table;
}

const operations = {
  CreateTable(body) {
    if (tables.has(body.TableName)) {
      const error = new Error('Table already exists: ' + body.TableName);
      error.type = 'com.amazonaws.dynamodb.v20120810#ResourceInUseException';
      throw error;
    }
    tables.set(body.TableName, new Map());
    return { TableDescription: { TableName: body.TableName, TableStatus: 'ACTIVE' } };
  },

  GetItem(body) {
    const table = getTable(body.TableName);
    const id = body.Key.id.S;
    const item = table.get(id);
    return item ? { Item: structuredClone(item) } : {};
  },

  Scan(body) {
    const table = getTable(body.TableName);
    const items = [...table.values()].slice(0, body.Limit || 1000);
    return { Items: structuredClone(items), Count: items.length, ScannedCount: items.length };
  },

  PutItem(body) {
    const table = getTable(body.TableName);
    const id = body.Item.id.S;
    if (body.ConditionExpression && !conditionHolds(table.get(id), body.ConditionExpression, body.ExpressionAttributeNames || {}, body.ExpressionAttributeValues || {})) {
      const error = new Error('The conditional request failed');
      error.type = 'com.amazonaws.dynamodb.v20120810#ConditionalCheckFailedException';
      throw error;
    }
    table.set(id, structuredClone(body.Item));
    itemBytes.set(id, sizeOfItem(body.Item));
    return {};
  },

  UpdateItem(body) {
    const table = getTable(body.TableName);
    const id = body.Key.id.S;
    const current = table.get(id) || null;
    const names = body.ExpressionAttributeNames || {};
    const values = body.ExpressionAttributeValues || {};

    if (body.ConditionExpression && !conditionHolds(current, body.ConditionExpression, names, values)) {
      const error = new Error('The conditional request failed');
      error.type = 'com.amazonaws.dynamodb.v20120810#ConditionalCheckFailedException';
      throw error;
    }
    if (!current) {
      const error = new Error('The provided expression refers to an attribute that does not exist in the item');
      error.type = 'com.amazonaws.dynamodb.v20120810#ValidationException';
      throw error;
    }

    const assignment = body.UpdateExpression.replace(/^SET\s+/, '');
    const next = structuredClone(current);
    for (const part of assignment.split(/\s*,\s*/)) {
      const [target, expression] = part.split(' = ');
      const column = names[target] || target;
      const arithmetic = /^#(\w+) \+ :(\w+)$/.exec(expression);
      if (arithmetic) {
        next[column] = { N: String(Number(current[column]?.N || 0) + Number(values[':' + arithmetic[2]].N)) };
        continue;
      }
      const valueKey = expression;
      if (!(valueKey in values)) throw new Error('Unresolved value ' + valueKey);
      next[column] = structuredClone(values[valueKey]);
    }
    table.set(id, next);
    itemBytes.set(id, sizeOfItem(next));
    return body.ReturnValues === 'NONE' ? {} : { Attributes: next };
  },

  DeleteItem(body) {
    const table = getTable(body.TableName);
    const id = body.Key.id.S;
    const current = table.get(id);
    if (body.ConditionExpression && !conditionHolds(current, body.ConditionExpression, body.ExpressionAttributeNames || {}, body.ExpressionAttributeValues || {})) {
      const error = new Error('The conditional request failed');
      error.type = 'com.amazonaws.dynamodb.v20120810#ConditionalCheckFailedException';
      throw error;
    }
    table.delete(id);
    itemBytes.delete(id);
    return {};
  },
};

const dynamo = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  const target = String(req.headers['x-amz-target'] || '').split('.').pop();
  const op = operations[target];
  const send = (status, payload) => {
    res.writeHead(status, { 'content-type': 'application/x-amz-json-1.0' });
    res.end(JSON.stringify(payload));
  };
  if (!op) return send(400, { __type: 'com.amazonaws.dynamodb.v20120810#UnknownOperationException' });
  if (req.headers.authorization !== 'Bearer good-token') {
    return send(400, { __type: 'com.amazon.coral.service#UnrecognizedClientException', message: 'bad token' });
  }
  calls[target] = (calls[target] || 0) + 1;
  try {
    send(200, op(JSON.parse(raw || '{}')));
  } catch (error) {
    send(400, { __type: error.type || 'com.amazonaws.dynamodb.v20120810#InternalServerError', message: error.message });
  }
});

// --- IAM --------------------------------------------------------------------
let iamCalls = 0;
const iam = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  iamCalls += 1;
  const send = (status, payload) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(payload));
  };
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return send(400, { message: 'no json' });
  }
  const [head, payload, signature] = String(body.jwt || '').split('.');
  if (!head || !payload || !signature) return send(400, { message: 'malformed jwt' });
  const ok = crypto.verify('sha256', Buffer.from(head + '.' + payload), {
    key: publicKey,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
  }, Buffer.from(signature, 'base64url'));
  if (!ok) return send(401, { message: 'bad signature' });
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  const header = JSON.parse(Buffer.from(head, 'base64url').toString('utf8'));
  if (header.alg !== 'PS256' || header.kid !== KEY_ID) return send(401, { message: 'bad header' });
  if (claims.iss !== SERVICE_ACCOUNT) return send(401, { message: 'bad issuer' });
  if (claims.aud !== 'http://127.0.0.1:' + iam.address().port + '/iam/v1/tokens') return send(401, { message: 'bad audience' });
  if (claims.exp - claims.iat !== 3600) return send(401, { message: 'bad lifetime' });
  send(200, { iamToken: 'good-token', expiresAt: new Date(Date.now() + 3600 * 1000).toISOString() });
});

// --- Test run ---------------------------------------------------------------
(async () => {
  await new Promise(resolve => iam.listen(0, '127.0.0.1', resolve));
  await new Promise(resolve => dynamo.listen(0, '127.0.0.1', resolve));
  const iamEndpoint = 'http://127.0.0.1:' + iam.address().port + '/iam/v1/tokens';
  const docEndpoint = 'http://127.0.0.1:' + dynamo.address().port + '/ru-central1/cloud/db';

  const key = JSON.stringify({
    id: KEY_ID,
    service_account_id: SERVICE_ACCOUNT,
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  });
  // The real key file carries a leading comment line; make sure it survives.
  const withComment = JSON.stringify({
    id: KEY_ID,
    service_account_id: SERVICE_ACCOUNT,
    private_key: 'PLEASE DO NOT REMOVE THIS LINE! Yandex.Cloud SA Key ID <' + KEY_ID + '>\n' + privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  });

  const db = createDatabase({ endpoint: docEndpoint, key, iamEndpoint });
  const commented = createDatabase({ endpoint: docEndpoint, key: withComment, iamEndpoint });

  check('createDatabase builds a database', !!db && typeof db.prepare === 'function');

  const first = await db.ensureTable();
  const second = await db.ensureTable();
  check('creates the table once', first === 'created' && second === 'present', first + '/' + second);

  // The commented key must sign a valid JWT too.
  let signedWithComment = false;
  try { await commented.tokens.get(); signedWithComment = true; } catch (error) { signedWithComment = error.message; }
  check('signs with a key that has the Yandex comment line', signedWithComment === true, String(signedWithComment));

  // --- Real Worker on top of the shim ---------------------------------------
  const worker = await import(pathToFileURL(path.join(root, 'players', 'dist', 'server', 'index.js')).href);
  const env = { DB: db };
  const origin = 'http://127.0.0.1:8000';
  const call = async (method, pathname, { token, body } = {}) => {
    const request = new Request(origin + pathname, {
      method,
      headers: {
        origin,
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: 'Bearer ' + token } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const response = await worker.handleApi(request, env, { allowedOrigins: [origin] });
    return { status: response.status, body: await response.json() };
  };

  const created = await call('POST', '/api/rooms', { body: { name: 'YDB shim test' } });
  check('creates a room', created.status === 200 && !!created.body.roomId, created.status + ' ' + (created.body.roomId || created.body.error));
  const roomId = created.body.roomId;
  const masterToken = created.body.masterToken;
  const table = tables.get('niti_rooms');
  check('insert wrote one item', table.size === 1, 'items=' + table.size);

  const read = await call('GET', '/api/rooms/' + roomId, { token: masterToken });
  check('reads the room back', read.status === 200 && read.body.room.revision === 0, read.status + ' rev=' + read.body?.room?.revision);

  const stateLength = read.body?.room ? JSON.stringify(read.body.room).length : 0;
  check('state survives a round trip', stateLength > 100, 'bytes=' + stateLength);

  const denied = await call('GET', '/api/rooms/' + roomId, { token: 'z'.repeat(40) });
  check('rejects a foreign token', denied.status === 401, denied.status);

  const joined = await call('POST', '/api/rooms/' + roomId + '/join', { body: { name: 'Игрок', joinKey: 'k'.repeat(20) } });
  check('joins a player through mutate()', joined.status === 200 && !!joined.body.playerId, joined.status + ' ' + (joined.body.error || ''));
  const playerToken = joined.body.playerToken;

  const ticker = await call('POST', '/api/rooms/' + roomId + '/ticker', { token: masterToken, body: { text: 'ПРОВЕРКА YDB', expectedVersion: 0 } });
  check('ticker update bumps revision', ticker.status === 200 && ticker.body.room?.revision === 2, ticker.status + ' rev=' + ticker.body?.room?.revision);

  const playerView = await call('GET', '/api/rooms/' + roomId, { token: playerToken });
  check('player sees the ticker', playerView.body?.room?.ticker?.text === 'ПРОВЕРКА YDB', JSON.stringify(playerView.body?.room?.ticker));

  const stale = await call('POST', '/api/rooms/' + roomId + '/ticker', { token: masterToken, body: { text: 'УСТАРЕЛО', expectedVersion: 0 } });
  check('stale version is refused', stale.status === 409, stale.status);

  // --- Compare-and-set: exactly one of two writers may win -------------------
  const before = (await call('GET', '/api/rooms/' + roomId, { token: masterToken })).body.room.revision;
  const update = () => db.prepare('UPDATE niti_rooms SET state_json = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?')
    .bind(JSON.stringify({ marker: 'race' }), Date.now(), roomId, before).run();
  const [a, b] = await Promise.all([update(), update()]);
  const changed = [a.meta.changes, b.meta.changes].sort();
  check('concurrent update is exclusive', changed[0] === 0 && changed[1] === 1, 'changes=' + changed.join(','));

  const after = await db.prepare('SELECT revision FROM niti_rooms WHERE id = ?').bind(roomId).first();
  check('revision advanced exactly once', after.revision === before + 1, 'rev=' + after.revision);

  // --- Big states: the Worker allows 1 MB, an item holds 400 KB -------------
  const bigRoom = '1'.repeat(32);
  const big = JSON.stringify({ version: 1, name: 'big', players: [], note: 'x'.repeat(600000) });
  const inserted = await db.prepare('INSERT INTO niti_rooms (id, master_hash, state_json, revision, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)')
    .bind(bigRoom, 'hash', big, Date.now(), Date.now()).run();
  check('writes a 600 KB state', inserted.meta.changes === 1, 'changes=' + inserted.meta.changes);
  const readBig = await db.prepare('SELECT id, master_hash, state_json, revision FROM niti_rooms WHERE id = ?').bind(bigRoom).first();
  check('reads the 600 KB state back intact', readBig?.state_json === big, 'bytes=' + (readBig?.state_json?.length || 0));
  const stored = itemBytes.get(bigRoom) || 0;
  check('compresses the state under the item cap', stored < 400000, 'stored=' + stored + ' bytes');

  const mediumRoom = '2'.repeat(32);
  const medium = JSON.stringify({ note: 'y'.repeat(150000) });
  await db.prepare('INSERT INTO niti_rooms (id, master_hash, state_json, revision, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)')
    .bind(mediumRoom, 'hash', medium, 1, 1).run();
  const readMedium = await db.prepare('SELECT state_json FROM niti_rooms WHERE id = ?').bind(mediumRoom).first();
  check('keeps a 150 KB state raw and identical', readMedium.state_json === medium, 'bytes=' + readMedium.state_json.length);

  // --- Health, delete, unknown statements -----------------------------------
  const health = await call('GET', '/api/health');
  check('health check answers', health.status === 200 && health.body.ready === true, health.status);

  const deleted = await call('DELETE', '/api/rooms/' + roomId, { token: masterToken });
  const gone = await call('GET', '/api/rooms/' + roomId, { token: masterToken });
  check('deletes the room', deleted.status === 200 && gone.status === 404, 'delete=' + deleted.status + ' after=' + gone.status);

  const wrongHash = await db.prepare('DELETE FROM niti_rooms WHERE id = ? AND master_hash = ?').bind(bigRoom, 'not-the-hash').run();
  check('delete respects its condition', wrongHash.meta.changes === 0, 'changes=' + wrongHash.meta.changes);

  const missing = await db.prepare('SELECT id FROM niti_rooms WHERE id = ?').bind('3'.repeat(32)).first();
  check('missing row reads as null', missing === null, String(missing));

  let threw = null;
  try { await db.prepare('SELECT * FROM niti_rooms WHERE name = ?').bind('x').first(); } catch (error) { threw = error; }
  check('unknown statement throws', threw instanceof UnsupportedStatement, threw ? threw.constructor.name : 'no error');

  // --- Tokens: one IAM call for many requests -------------------------------
  const before2 = iamCalls;
  await Promise.all([0, 1, 2, 3, 4].map(() => db.prepare('SELECT id FROM niti_rooms LIMIT 1').first()));
  check('reuses one IAM token under parallel calls', iamCalls === before2, 'extra=' + (iamCalls - before2));
  await db.tokens.get(true);
  check('can force a token refresh', iamCalls === before2 + 1, 'iamCalls=' + iamCalls);

  // A rejected token must be refreshed once and the call retried.
  db.tokens.token = 'stale-token';
  db.tokens.expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const retried = await db.prepare('SELECT id FROM niti_rooms LIMIT 1').first();
  check('refreshes a rejected token and retries', retried !== undefined, 'ok');

  // --- Report ---------------------------------------------------------------
  for (const result of results) {
    console.log((result.ok ? 'PASS ' : 'FAIL ') + result.name + (result.detail ? '  —  ' + result.detail : ''));
  }
  console.log('\ntable operations: ' + JSON.stringify(calls));
  const failed = results.filter(result => !result.ok).length;
  console.log(failed ? failed + ' FAILED' : 'ALL PASSED');
  iam.close();
  dynamo.close();
  process.exit(failed ? 1 : 0);
})().catch(error => {
  console.error(error);
  iam.close();
  dynamo.close();
  process.exit(1);
});
