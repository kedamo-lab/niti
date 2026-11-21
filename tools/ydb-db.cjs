'use strict';
// A D1-compatible database over YDB's Document API.
//
// The player Worker talks to SQLite through Cloudflare D1: `env.DB.prepare(sql)
// .bind(...).first()/.all()/.run()`. Yandex Managed Service for YDB publishes
// document tables through an Amazon DynamoDB-compatible HTTP API, so the six
// statements the Worker issues can be answered there. The Worker itself stays
// untouched: on Cloudflare it still runs on real D1.
//
// Why YDB: the Serverless tier does not bill the first million request units
// per month (nor 720 GB·h of storage), and a room table this small never leaves
// that free tier. A read of one room is 1 RU per 4 KB block, a write 2 RU per
// KB, a delete 2 RU, schema changes are free.
//
// Authentication is an IAM token minted from a service account key (RS256), so
// the whole adapter needs nothing but node:crypto and fetch.
const crypto = require('node:crypto');
const zlib = require('node:zlib');

const TABLE = 'niti_rooms';
const STATE_COLUMN = 'state_json';
const DEFAULT_IAM_ENDPOINT = 'https://iam.api.cloud.yandex.net/iam/v1/tokens';
// A DynamoDB item is capped at 400 KB, while the Worker allows a megabyte of
// state. Room state compresses well, so anything big travels gzipped.
const BLOB_MARKER = 'gz:';
const RAW_LIMIT = 300000;

class UnsupportedStatement extends Error {}

function collapse(sql) {
  return String(sql).replace(/\s+/g, ' ').trim();
}

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

// Yandex exports a service account key as `id`, `service_account_id` and an RSA
// `private_key` in PEM. Operators sometimes paste it base64-encoded, or with
// literal \n so it survives a single-line environment variable.
function parseServiceAccountKey(raw) {
  let text = String(raw || '').trim();
  if (text.startsWith('base64:')) text = Buffer.from(text.slice(7), 'base64').toString('utf8');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Some shells and panels hand over a document whose newlines were escaped
    // twice, which makes it invalid JSON; unescaping them repairs it exactly.
    try {
      parsed = JSON.parse(text.replace(/\\n/g, '\n'));
    } catch {
      throw new Error('YDB_SERVICE_ACCOUNT_KEY is not valid JSON');
    }
  }
  const key = {
    id: parsed.id,
    serviceAccountId: parsed.service_account_id,
    privateKey: parsed.private_key,
  };
  if (!key.id || !key.serviceAccountId || !key.privateKey) {
    throw new Error('Service account key needs id, service_account_id and private_key');
  }
  return key;
}

// IAM tokens live an hour. One refresh at a time: the terminals poll in
// parallel, and a token stampede would only add latency.
class IamTokens {
  constructor(serviceAccount, endpoint = DEFAULT_IAM_ENDPOINT) {
    this.serviceAccount = serviceAccount;
    this.endpoint = endpoint;
    this.token = null;
    this.expiresAt = 0;
    this.pending = null;
    this.fetches = 0;
  }

  jwt(nowSeconds) {
    // Yandex IAM accepts PS256 only (RSASSA-PSS with SHA-256), not plain RS256.
    const header = { typ: 'JWT', alg: 'PS256', kid: this.serviceAccount.id };
    const payload = {
      aud: this.endpoint,
      iss: this.serviceAccount.serviceAccountId,
      iat: nowSeconds,
      exp: nowSeconds + 3600,
    };
    const input = base64url(JSON.stringify(header)) + '.' + base64url(JSON.stringify(payload));
    const signature = crypto.sign('sha256', Buffer.from(input), {
      key: this.serviceAccount.privateKey,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
    });
    return input + '.' + signature.toString('base64url');
  }

  async get(force = false) {
    const now = Math.floor(Date.now() / 1000);
    if (!force && this.token && now < this.expiresAt - 60) return this.token;
    if (!this.pending) {
      this.fetches += 1;
      this.pending = this.request(now).finally(() => { this.pending = null; });
    }
    return this.pending;
  }

  async request(now) {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jwt: this.jwt(now) }),
      signal: AbortSignal.timeout(10000),
    });
    const text = await response.text();
    if (!response.ok) throw new Error('IAM token request failed: ' + response.status + ' ' + text.slice(0, 200));
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('IAM token request returned no JSON');
    }
    if (!data.iamToken) throw new Error('IAM token request returned no token');
    this.token = data.iamToken;
    const issued = data.expiresAt ? Date.parse(data.expiresAt) : NaN;
    this.expiresAt = Number.isFinite(issued) ? Math.floor(issued / 1000) : now + 3600;
    return this.token;
  }
}

// DynamoDB typed attributes: { S: 'text' }, { N: '42' }, { B: '<base64>' }.
function attributeOf(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Cannot store a non-finite number');
    return { N: String(value) };
  }
  if (Buffer.isBuffer(value)) return { B: value.toString('base64') };
  return { S: String(value) };
}

function valueOf(attribute) {
  if (!attribute || typeof attribute !== 'object') return undefined;
  if ('N' in attribute) return Number(attribute.N);
  if ('S' in attribute) return attribute.S;
  if ('B' in attribute) return Buffer.from(attribute.B, 'base64');
  if ('NULL' in attribute) return null;
  if ('BOOL' in attribute) return Boolean(attribute.BOOL);
  throw new UnsupportedStatement('Unsupported attribute: ' + Object.keys(attribute).join(','));
}

function encodeState(json) {
  const raw = Buffer.from(json, 'utf8');
  if (raw.length <= RAW_LIMIT) return raw;
  return Buffer.concat([Buffer.from(BLOB_MARKER, 'utf8'), zlib.gzipSync(raw, { level: 6 })]);
}

function decodeState(value) {
  if (Buffer.isBuffer(value)) {
    if (value.length >= BLOB_MARKER.length && value.subarray(0, BLOB_MARKER.length).toString('utf8') === BLOB_MARKER) {
      return zlib.gunzipSync(value.subarray(BLOB_MARKER.length)).toString('utf8');
    }
    return value.toString('utf8');
  }
  if (value === undefined || value === null) return undefined;
  return String(value);
}

function stateAttribute(json) {
  return { B: encodeState(json).toString('base64') };
}

class DynamoTable {
  constructor({ endpoint, tokens, table }) {
    this.endpoint = endpoint;
    this.tokens = tokens;
    this.table = table;
  }

  async call(target, body) {
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const token = await this.tokens.get(attempt > 0);
      let response;
      try {
        response = await fetch(this.endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/x-amz-json-1.0',
            'x-amz-target': 'DynamoDB_20120810.' + target,
            authorization: 'Bearer ' + token,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(15000),
        });
      } catch (error) {
        lastError = error;
        if (attempt < 2) continue;
        throw error;
      }
      const text = await response.text();
      let payload = {};
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = {};
        }
      }
      if (response.ok) return payload;

      // A stale token is worth one refresh; a throttled or broken call, one repeat.
      lastError = new Error('YDB ' + target + ' ' + response.status + ': ' + text.slice(0, 300));
      lastError.type = String(payload.__type || '');
      lastError.status = response.status;
      // A stale or rejected IAM token is worth one refresh. YDB reports it as
      // 400 UnrecognizedClientException rather than DynamoDB's 400/401 mix, so
      // the error type matters more than the status here.
      const authFailure = response.status === 401 || response.status === 403
        || /UnrecognizedClient|InvalidSignature|ExpiredToken|InvalidClientTokenId|IncompleteSignature/.test(lastError.type);
      if (authFailure) continue;
      if (response.status >= 500 && attempt < 2) continue;
      if (/Throttl/i.test(lastError.type) && attempt < 2) continue;
      throw lastError;
    }
    throw lastError || new Error('YDB ' + target + ': no answer');
  }

  // Schema changes cost nothing, so the table is (re)created on every boot.
  async ensureTable() {
    try {
      await this.call('CreateTable', {
        TableName: this.table,
        AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }],
        KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
      });
      return 'created';
    } catch (error) {
      if (/ResourceInUseException/.test(error.type || '') || /already exists/i.test(error.message || '')) return 'present';
      throw error;
    }
  }
}

class Statement {
  constructor(db, sql, values = []) {
    this.db = db;
    this.sql = collapse(sql);
    this.values = values;
    this.keyId = undefined;
  }

  bind(...values) {
    return new Statement(this.db, this.sql, values);
  }

  take(state) {
    if (state.next >= this.values.length) throw new UnsupportedStatement('Missing bound value: ' + this.sql);
    return this.values[state.next++];
  }

  attribute(state) {
    return attributeOf(this.take(state));
  }

  table() {
    return this.db.table;
  }

  async first(column) {
    const rows = await this.select(true);
    const row = rows[0];
    if (!row) return null;
    return column ? row[column] : row;
  }

  async all() {
    return { success: true, results: await this.select(false) };
  }

  async run() {
    if (/^INSERT INTO /i.test(this.sql)) return this.insert();
    if (/^UPDATE /i.test(this.sql)) return this.update();
    if (/^DELETE FROM /i.test(this.sql)) return this.remove();
    throw new UnsupportedStatement(this.sql);
  }

  project(item, columns) {
    const out = {};
    for (const name of columns.split(',').map(part => part.trim()).filter(Boolean)) {
      if (name === '*') return { ...Object.fromEntries(Object.entries(item).map(([key, value]) => [key, valueOf(value)])) };
      const value = valueOf(item[name]);
      if (value === undefined) continue;
      out[name] = name === STATE_COLUMN ? decodeState(value) : value;
    }
    return out;
  }

  // `SELECT id, master_hash, state_json, revision FROM niti_rooms WHERE id = ?`
  // `SELECT id FROM niti_rooms LIMIT 1`
  async select(one) {
    const single = /^SELECT ([\w, *]+) FROM (\w+) WHERE id = \?$/i.exec(this.sql);
    const any = /^SELECT ([\w, *]+) FROM (\w+) LIMIT (\d+)$/i.exec(this.sql);

    if (single) {
      const [, columns, table] = single;
      if (table !== this.table()) throw new UnsupportedStatement(this.sql);
      const state = { next: 0 };
      const id = this.take(state);
      const payload = await this.db.dynamo.call('GetItem', {
        TableName: table,
        Key: { id: attributeOf(id) },
        ConsistentRead: true,
      });
      if (!payload.Item) return [];
      return [this.project(payload.Item, columns)];
    }

    if (any) {
      const [, columns, table, limit] = any;
      if (table !== this.table()) throw new UnsupportedStatement(this.sql);
      const payload = await this.db.dynamo.call('Scan', { TableName: table, Limit: Number(limit) });
      return (payload.Items || []).slice(0, one ? 1 : Number(limit)).map(item => this.project(item, columns));
    }

    throw new UnsupportedStatement(this.sql);
  }

  // `UPDATE niti_rooms SET state_json = ?, revision = revision + 1, updated_at = ?
  //  WHERE id = ? AND revision = ?`
  async update() {
    const match = /^UPDATE (\w+) SET (.+?) WHERE (.+)$/i.exec(this.sql);
    if (!match) throw new UnsupportedStatement(this.sql);
    const [, table, assignments, where] = match;
    if (table !== this.table()) throw new UnsupportedStatement(this.sql);

    const state = { next: 0 };
    const names = {};
    const values = {};
    const set = [];

    // SET comes before WHERE, so its placeholders are consumed first.
    for (const part of assignments.split(',').map(text => text.trim())) {
      const column = /^(\w+) = /.exec(part)?.[1];
      if (!column) throw new UnsupportedStatement(this.sql);
      const nameKey = '#c' + Object.keys(names).length;
      names[nameKey] = column;
      const expression = part.slice(part.indexOf('=') + 1).trim();

      if (expression === '?') {
        const valueKey = ':v' + Object.keys(values).length;
        values[valueKey] = column === STATE_COLUMN ? stateAttribute(this.take(state)) : this.attribute(state);
        set.push(nameKey + ' = ' + valueKey);
        continue;
      }

      // `revision = revision + 1` travels as-is; the database computes it, so
      // two writers cannot both land on the same number.
      const arithmetic = new RegExp('^(\\w+) \\+ (\\d+)$').exec(expression);
      if (!arithmetic || arithmetic[1] !== column) throw new UnsupportedStatement(this.sql);
      const stepKey = ':step' + set.length;
      values[stepKey] = { N: arithmetic[2] };
      set.push(nameKey + ' = ' + nameKey + ' + ' + stepKey);
    }

    const filters = this.conditions(where, state, names, values, false);
    const body = {
      TableName: table,
      Key: { id: attributeOf(this.keyId) },
      UpdateExpression: 'SET ' + set.join(', '),
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ReturnValues: 'NONE',
    };
    if (filters.length) body.ConditionExpression = filters.join(' AND ');

    const payload = await this.db.dynamo.call('UpdateItem', body).catch(error => {
      if (isConditionFailure(error)) return null;
      throw error;
    });
    // changes === 1 means this writer owned the revision; 0 makes the Worker
    // re-read and retry, which is exactly D1's contract.
    return { success: true, meta: { changes: payload ? 1 : 0 } };
  }

  // `INSERT INTO niti_rooms (id, master_hash, state_json, revision, created_at,
  //  updated_at) VALUES (?, ?, ?, 0, ?, ?)`
  async insert() {
    const match = /^INSERT INTO (\w+) \((.+?)\) VALUES \((.+)\)$/i.exec(this.sql);
    if (!match) throw new UnsupportedStatement(this.sql);
    const [, table, columnList, valueList] = match;
    if (table !== this.table()) throw new UnsupportedStatement(this.sql);

    const columns = columnList.split(',').map(name => name.trim());
    const tokens = valueList.split(',').map(token => token.trim());
    if (columns.length !== tokens.length) throw new UnsupportedStatement(this.sql);

    const state = { next: 0 };
    const item = {};
    columns.forEach((column, index) => {
      const token = tokens[index];
      if (token === '?') {
        item[column] = column === STATE_COLUMN ? stateAttribute(this.take(state)) : this.attribute(state);
      } else if (/^-?\d+$/.test(token)) {
        item[column] = { N: token };
      } else if (/^'.*'$/.test(token)) {
        item[column] = { S: token.slice(1, -1) };
      } else {
        throw new UnsupportedStatement(this.sql);
      }
    });

    const payload = await this.db.dynamo.call('PutItem', {
      TableName: table,
      Item: item,
      // A repeated room id must never overwrite a live session.
      ConditionExpression: 'attribute_not_exists(#id)',
      ExpressionAttributeNames: { '#id': 'id' },
    }).catch(error => {
      if (isConditionFailure(error)) return null;
      throw error;
    });
    return { success: true, meta: { changes: payload ? 1 : 0, last_row_id: null } };
  }

  // `DELETE FROM niti_rooms WHERE id = ? AND master_hash = ?`
  async remove() {
    const match = /^DELETE FROM (\w+) WHERE (.+)$/i.exec(this.sql);
    if (!match) throw new UnsupportedStatement(this.sql);
    const [, table, where] = match;
    if (table !== this.table()) throw new UnsupportedStatement(this.sql);

    const state = { next: 0 };
    const names = {};
    const values = {};
    const filters = this.conditions(where, state, names, values, true);
    if (!filters.length) throw new UnsupportedStatement(this.sql);

    const payload = await this.db.dynamo.call('DeleteItem', {
      TableName: table,
      Key: { id: attributeOf(this.keyId) },
      ConditionExpression: filters.join(' AND '),
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }).catch(error => {
      if (isConditionFailure(error)) return null;
      throw error;
    });
    return { success: true, meta: { changes: payload ? 1 : 0 } };
  }

  // `id = ?`, `revision = ?`, `master_hash = ?`, joined by AND. The id becomes
  // the item key; the rest become a condition, and that condition is what makes
  // the Worker's optimistic update exclusive.
  conditions(where, state, names, values, keepId) {
    const filters = [];
    for (const part of where.split(/\s+AND\s+/i)) {
      const match = /^(\w+) = \?$/.exec(part.trim());
      if (!match) throw new UnsupportedStatement(where);
      const column = match[1];
      const attribute = this.attribute(state);
      if (column === 'id') {
        this.keyId = valueOf(attribute);
        if (!keepId) continue;
      }
      const nameKey = '#k' + filters.length;
      const valueKey = ':c' + filters.length;
      names[nameKey] = column;
      values[valueKey] = attribute;
      filters.push(nameKey + ' = ' + valueKey);
    }
    if (this.keyId === undefined) throw new UnsupportedStatement('No id in: ' + this.sql);
    return filters;
  }
}

function isConditionFailure(error) {
  return /ConditionalCheckFailedException/.test(error?.type || '');
}

class YdbDatabase {
  constructor({ endpoint, key, table, iamEndpoint }) {
    const url = String(endpoint || '').replace(/\/+$/, '');
    if (!/^https?:\/\/[^/]+/.test(url)) throw new Error('YDB_DOCUMENT_ENDPOINT must be an URL');
    this.endpoint = url;
    this.table = table || TABLE;
    const serviceAccount = parseServiceAccountKey(key);
    const tokens = new IamTokens(serviceAccount, iamEndpoint || DEFAULT_IAM_ENDPOINT);
    this.dynamo = new DynamoTable({ endpoint: url, tokens, table: this.table });
    this.tokens = tokens;
  }

  prepare(sql) {
    return new Statement(this, sql);
  }

  ensureTable() {
    return this.dynamo.ensureTable();
  }
}

// Returns null when YDB is not configured, so the caller can fall back to the
// local SQLite file.
function createDatabase(options = {}) {
  const endpoint = options.endpoint || process.env.YDB_DOCUMENT_ENDPOINT;
  const key = options.key || process.env.YDB_SERVICE_ACCOUNT_KEY;
  if (!endpoint || !key) return null;
  return new YdbDatabase({ endpoint, key, table: options.table, iamEndpoint: options.iamEndpoint });
}

module.exports = {
  createDatabase,
  YdbDatabase,
  IamTokens,
  Statement,
  parseServiceAccountKey,
  encodeState,
  decodeState,
  TABLE,
  UnsupportedStatement,
};
