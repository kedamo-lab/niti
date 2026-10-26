import { ITEM_CATALOG, REWARD_ALIASES } from './item-catalog.js';

const INVENTORY_VERSION = 1;
const INVENTORY_SLOTS = ['weapon', 'armor', 'extra1', 'extra2'];
const INVENTORY_WEAPONS = new Set(['melee', 'unarmed', 'light', 'heavy', 'energy', 'throwing', 'thrown', 'explosive', 'weapon']);
const INVENTORY_STAT_KEYS = ['damage', 'damageFormula', 'apCost', 'range', 'ammo', 'magazine', 'minStrength', 'damageType', 'modifiers', 'armorClass', 'resistances', 'weight', 'price', 'reloadAp', 'slots', 'effect'];
const INVENTORY_RESISTANCE_KEYS = ['normal', 'laser', 'fire', 'plasma', 'electric', 'explosive'];
const INVENTORY_CATEGORY_LABELS = { melee: 'Холодное оружие', unarmed: 'Рукопашное оружие', light: 'Лёгкое оружие', heavy: 'Тяжёлое оружие', energy: 'Энергетическое оружие', throwing: 'Метательное оружие', thrown: 'Метательное оружие', explosive: 'Взрывчатка', armor: 'Броня', consumable: 'Расходуемый предмет', ammo: 'Боеприпасы', tool: 'Инструмент', misc: 'Предмет', other: 'Предмет', food: 'Еда', medicine: 'Лекарство', weapon: 'Оружие' };
const INVENTORY_MAX_OPERATIONS = 3000;
const INVENTORY_MAX_LOTS = 1000;
const INVENTORY_CATALOG = new Map(ITEM_CATALOG.map(item => [item.id, item]));

export class InventoryError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function invText(value, max = 180) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new InventoryError(400, 'Некорректное значение предмета.');
  return value.trim();
}
function invKey(value, max = 128) {
  const result = invText(value, max);
  if (!/^[A-Za-z0-9._:-]+$/.test(result) || ['__proto__', 'constructor', 'prototype'].includes(result)) throw new InventoryError(400, 'Некорректный идентификатор предмета.');
  return result;
}
function invQuantity(value = 1) {
  if (!Number.isInteger(value) || value < 1 || value > 9999) throw new InventoryError(400, 'Количество должно быть целым числом от 1 до 9999.');
  return value;
}
function invNameKey(value) { return String(value).toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/[^a-zа-я0-9]/g, ''); }
const INVENTORY_BY_NAME = new Map(ITEM_CATALOG.map(item => [invNameKey(item.name), item]));
const INVENTORY_ALIAS_MAP = new Map(Object.entries(REWARD_ALIASES).map(([name, id]) => [invNameKey(name), id]));
function invCatalogForName(name) {
  const normalized = invNameKey(name);
  return INVENTORY_CATALOG.get(INVENTORY_ALIAS_MAP.get(normalized)) || INVENTORY_BY_NAME.get(normalized) || null;
}
function invConsumes(category, name) {
  const normalized = invNameKey(name);
  return ['consumable', 'ammo', 'food', 'medicine', 'explosive'].includes(category) || normalized.includes('граната') || normalized.includes('молотова');
}
function invCategoryForName(name) {
  const normalized = invNameKey(name);
  if (['бинт', 'паек', 'хиллап', 'ядерныйнапиток', 'лепешка', 'радaут', 'радаут'].includes(normalized)) return 'consumable';
  if (normalized.startsWith('патрон')) return 'ammo';
  return 'misc';
}
function invEmptyStats() { return Object.fromEntries(INVENTORY_STAT_KEYS.map(key => [key, null])); }
function invStatsScalar(value, signed = false) {
  if (value === null) return null;
  if (typeof value === 'string' && value.length <= 1000) return value.trim() || null;
  if (typeof value === 'number' && Number.isFinite(value) && value >= (signed ? -1e9 : 0) && value <= 1e9) return value;
  throw new InventoryError(400, 'Некорректная характеристика предмета.');
}
function invStatsPatch(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new InventoryError(400, 'Характеристики должны быть объектом.');
  const result = {};
  for (const field of Object.keys(input)) {
    if (!INVENTORY_STAT_KEYS.includes(field)) throw new InventoryError(400, 'Неизвестная характеристика предмета.');
    if (field === 'resistances') {
      if (input[field] === null) { result[field] = null; continue; }
      if (!input[field] || typeof input[field] !== 'object' || Array.isArray(input[field])) throw new InventoryError(400, 'Некорректное сопротивление брони.');
      const resistances = {};
      for (const type of Object.keys(input[field])) {
        if (!INVENTORY_RESISTANCE_KEYS.includes(type)) throw new InventoryError(400, 'Неизвестный тип сопротивления.');
        resistances[type] = invStatsScalar(input[field][type], true);
      }
      result[field] = resistances;
    } else result[field] = invStatsScalar(input[field]);
  }
  return result;
}
function invApplyStats(current, patch) {
  const result = { ...invEmptyStats(), ...current, ...patch };
  if (patch.resistances && current?.resistances) result.resistances = { ...current.resistances, ...patch.resistances };
  return result;
}
function invDefinition(name, catalogId = null) {
  const catalog = catalogId ? INVENTORY_CATALOG.get(catalogId) : invCatalogForName(name);
  const category = catalog?.category || invCategoryForName(name);
  return {
    catalogId: catalog?.id || null,
    category,
    categoryLabel: catalog?.categoryLabel || INVENTORY_CATEGORY_LABELS[category] || 'Предмет',
    consumable: typeof catalog?.consumable === 'boolean' ? catalog.consumable : invConsumes(category, name),
    stats: invApplyStats(catalog?.stats || {}, {}),
  };
}
function invBalance(lot, ownerId) { return Number(lot.balances[ownerId === null ? 'shared' : ownerId] || 0); }
function invSetBalance(lot, ownerId, quantity) {
  const key = ownerId === null ? 'shared' : ownerId;
  if (quantity > 0) lot.balances[key] = quantity;
  else delete lot.balances[key];
}
function invStableSuffix(value) {
  let result = 2166136261;
  for (const character of value) { result ^= character.codePointAt(0); result = Math.imul(result, 16777619); }
  return (result >>> 0).toString(16);
}
function invLegacyLot(stock, item) {
  const legacyKey = item.id + '\u0000' + item.name;
  let lot = stock.lots.find(entry => entry.legacyKey === legacyKey);
  if (lot) return lot;
  let id = item.id;
  if (stock.lots.some(entry => entry.id === id)) id = id.slice(0, 110) + '-' + invStableSuffix(legacyKey);
  while (stock.lots.some(entry => entry.id === id)) id += 'x';
  lot = { id, legacyKey, name: item.name, ...invDefinition(item.name), balances: {} };
  stock.lots.push(lot);
  return lot;
}
export function inventoryEnsure(state) {
  if (state.inventoryV1 && state.inventoryV1.version !== INVENTORY_VERSION) throw new InventoryError(409, 'Для этого инвентаря нужна новая версия терминала.');
  if (!state.inventoryV1) {
    state.inventoryV1 = { version: INVENTORY_VERSION, lots: [], importedEvents: [], equipment: {}, operations: [] };
  }
  const stock = state.inventoryV1;
  const imported = new Set(stock.importedEvents);
  for (const event of state.events || []) {
    if (imported.has(event.eventId)) continue;
    for (const item of event.items || []) {
      const lot = invLegacyLot(stock, item);
      const ownerId = item.recipientId ?? null;
      invSetBalance(lot, ownerId, invBalance(lot, ownerId) + item.quantity);
    }
    stock.importedEvents.push(event.eventId);
    imported.add(event.eventId);
  }
  return stock;
}
function invPublicLot(lot, quantity) {
  const catalog = INVENTORY_CATALOG.get(lot.catalogId);
  return {
    id: lot.id, name: lot.name, quantity,
    catalogId: lot.catalogId, category: lot.category, categoryLabel: lot.categoryLabel,
    consumable: !!lot.consumable, stats: lot.stats,
    image: catalog?.image || null,
    source: catalog?.source || null,
    warnings: catalog?.warnings || [],
  };
}
export function inventoryItems(state, ownerId) {
  return inventoryEnsure(state).lots.filter(lot => invBalance(lot, ownerId) > 0).map(lot => invPublicLot(lot, invBalance(lot, ownerId)));
}
export function inventoryEquipment(state, playerId) {
  const stock = inventoryEnsure(state);
  const equipment = stock.equipment[playerId] || {};
  return Object.fromEntries(INVENTORY_SLOTS.map(slot => [slot, equipment[slot] || null]));
}
export function inventoryHistory(state, auth) {
  const master = auth.role === 'master';
  return inventoryEnsure(state).operations.slice(-80).filter(operation => master || operation.action === 'take' || operation.action === 'return' || operation.actorId === auth.playerId || operation.recipientId === null).map(operation => ({
    id: operation.id, action: operation.action, itemId: operation.itemId,
    itemName: operation.itemName, quantity: operation.quantity,
    actorId: operation.actorId, actorName: operation.actorName,
    slot: operation.slot || null, createdAt: operation.createdAt,
    ...(master ? { recipientId: operation.recipientId ?? null } : {}),
  }));
}
function invCleanEquipment(stock, playerId) {
  const equipment = stock.equipment[playerId];
  if (!equipment) return;
  const used = new Map();
  for (const slot of INVENTORY_SLOTS) {
    const itemId = equipment[slot];
    if (!itemId) continue;
    const lot = stock.lots.find(item => item.id === itemId);
    const count = used.get(itemId) || 0;
    if (!lot || invBalance(lot, playerId) <= count) equipment[slot] = null;
    else used.set(itemId, count + 1);
  }
}
function invAssertFields(input, fields) {
  for (const field of Object.keys(input)) if (!fields.includes(field)) throw new InventoryError(400, 'Неизвестное поле действия с предметом.');
}
function invCanonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(invCanonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + invCanonical(value[key])).join(',') + '}';
}
async function invFingerprint(input) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(invCanonical(input)));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
function invAddMetadata(input, base, patch = false) {
  const definition = { ...base };
  if (Object.hasOwn(input, 'name')) definition.name = invText(input.name);
  if (Object.hasOwn(input, 'category')) {
    definition.category = invKey(input.category, 50);
    definition.categoryLabel = INVENTORY_CATEGORY_LABELS[definition.category] || definition.category;
  }
  if (Object.hasOwn(input, 'consumable')) {
    if (typeof input.consumable !== 'boolean') throw new InventoryError(400, 'Укажите, расходуется ли предмет.');
    definition.consumable = input.consumable;
  } else if (!patch && Object.hasOwn(input, 'category')) definition.consumable = invConsumes(definition.category, definition.name);
  if (Object.hasOwn(input, 'stats')) {
    const stats = invStatsPatch(input.stats);
    if (Object.hasOwn(stats, 'damage') && !Object.hasOwn(stats, 'damageFormula')) {
      const formula = typeof stats.damage === 'string' ? stats.damage.replace(/[дД]/g, 'd').replace(/\s/g, '').toLowerCase() : '';
      stats.damageFormula = /^\d{1,2}d(?:4|6|8|10|12|20|100)(?:[+-]\d{1,4})?$/.test(formula) ? formula : null;
    }
    definition.stats = invApplyStats(base.stats, stats);
  }
  return definition;
}

export async function inventoryApply(state, auth, input) {
  const action = invText(input.action, 20);
  const masterAction = ['add', 'edit'].includes(action);
  if (masterAction && auth.role !== 'master') throw new InventoryError(403, 'Создавать и менять предметы может только мастер.');
  if (!masterAction && auth.role !== 'player') throw new InventoryError(403, 'Это действие выполняется из терминала владельца предмета.');
  if (!['add', 'edit', 'take', 'return', 'use', 'equip', 'unequip'].includes(action)) throw new InventoryError(400, 'Неизвестное действие с предметом.');
  const operationId = invKey(input.operationId);
  if (operationId.length < 16) throw new InventoryError(400, 'Нужен случайный идентификатор действия.');
  const allowed = ['operationId', 'action'];
  if (action === 'add') allowed.push('catalogId', 'name', 'category', 'consumable', 'stats', 'quantity', 'recipientId');
  if (action === 'edit') allowed.push('itemId', 'name', 'category', 'consumable', 'stats');
  if (['take', 'return', 'use'].includes(action)) allowed.push('itemId', 'quantity');
  if (action === 'equip') allowed.push('itemId', 'slot');
  if (action === 'unequip') allowed.push('slot', 'itemId');
  invAssertFields(input, allowed);
  const stock = inventoryEnsure(state);
  const actorId = auth.role === 'master' ? 'master' : auth.playerId;
  const fingerprint = await invFingerprint(input);
  const previous = stock.operations.find(operation => operation.id === operationId);
  if (previous) {
    if (previous.actorId !== actorId || previous.fingerprint !== fingerprint) throw new InventoryError(409, 'Идентификатор действия уже использован.');
    return { changed: false, duplicate: true };
  }
  if (stock.operations.length >= INVENTORY_MAX_OPERATIONS) throw new InventoryError(409, 'Журнал инвентаря заполнен. Обратитесь к мастеру.');
  const actor = state.players.find(player => player.id === auth.playerId);
  let lot = null, quantity = 0, slot = null, recipientId;
  if (action === 'add') {
    if (stock.lots.length >= INVENTORY_MAX_LOTS) throw new InventoryError(409, 'В хранилище слишком много разных предметов.');
    const catalogId = input.catalogId == null || input.catalogId === '' ? null : invKey(input.catalogId);
    const catalog = catalogId ? INVENTORY_CATALOG.get(catalogId) : null;
    if (catalogId && !catalog) throw new InventoryError(400, 'Предмет не найден в каталоге.');
    const name = input.name == null ? catalog?.name : invText(input.name);
    if (!name) throw new InventoryError(400, 'Укажите название предмета.');
    recipientId = input.recipientId == null ? null : invKey(input.recipientId);
    if (recipientId && !state.players.some(player => player.id === recipientId)) throw new InventoryError(400, 'Получатель предмета не найден.');
    quantity = invQuantity(input.quantity);
    const base = { name, ...invDefinition(name, catalogId) };
    const metadata = invAddMetadata(input, base);
    lot = { id: 'stock-' + operationId.slice(0, 115), ...metadata, balances: {} };
    if (stock.lots.some(entry => entry.id === lot.id)) throw new InventoryError(409, 'Идентификатор предмета уже существует.');
    invSetBalance(lot, recipientId, quantity);
    stock.lots.push(lot);
  } else {
    if (action === 'unequip') {
      slot = invKey(input.slot, 20);
      if (!INVENTORY_SLOTS.includes(slot)) throw new InventoryError(400, 'Неизвестный слот экипировки.');
      const equipment = stock.equipment[auth.playerId] || {};
      const itemId = equipment[slot];
      if (input.itemId != null && invKey(input.itemId) !== itemId) throw new InventoryError(409, 'В этом слоте уже другой предмет.');
      lot = stock.lots.find(entry => entry.id === itemId) || null;
      if (lot && invBalance(lot, auth.playerId) < 1) throw new InventoryError(403, 'Предмет не принадлежит этому персонажу.');
      stock.equipment[auth.playerId] = { ...equipment, [slot]: null };
    } else {
      const itemId = invKey(input.itemId);
      lot = stock.lots.find(entry => entry.id === itemId);
      if (!lot) throw new InventoryError(404, 'Предмет не найден.');
      if (action === 'edit') {
        const updated = invAddMetadata(input, lot, true);
        Object.assign(lot, updated);
        for (const player of state.players) {
          const equipment = stock.equipment[player.id];
          if (!equipment) continue;
          if (equipment.weapon === lot.id && !INVENTORY_WEAPONS.has(lot.category)) equipment.weapon = null;
          if (equipment.armor === lot.id && lot.category !== 'armor') equipment.armor = null;
          invCleanEquipment(stock, player.id);
        }
      } else if (action === 'take') {
        quantity = invQuantity(input.quantity);
        if (invBalance(lot, null) < quantity) throw new InventoryError(409, 'В общем тайнике уже нет такого количества предметов.');
        invSetBalance(lot, null, invBalance(lot, null) - quantity);
        invSetBalance(lot, auth.playerId, invBalance(lot, auth.playerId) + quantity);
      } else {
        quantity = ['equip'].includes(action) ? 1 : invQuantity(input.quantity);
        if (invBalance(lot, auth.playerId) < quantity) throw new InventoryError(403, 'Предмет не принадлежит этому персонажу или его недостаточно.');
        if (action === 'return') {
          invSetBalance(lot, auth.playerId, invBalance(lot, auth.playerId) - quantity);
          invSetBalance(lot, null, invBalance(lot, null) + quantity);
          invCleanEquipment(stock, auth.playerId);
        } else if (action === 'use') {
          if (lot.consumable) {
            invSetBalance(lot, auth.playerId, invBalance(lot, auth.playerId) - quantity);
            invCleanEquipment(stock, auth.playerId);
          }
        } else if (action === 'equip') {
          slot = invKey(input.slot, 20);
          if (!INVENTORY_SLOTS.includes(slot)) throw new InventoryError(400, 'Неизвестный слот экипировки.');
          if (slot === 'weapon' && !INVENTORY_WEAPONS.has(lot.category)) throw new InventoryError(400, 'В этот слот можно поместить только оружие.');
          if (slot === 'armor' && lot.category !== 'armor') throw new InventoryError(400, 'В этот слот можно поместить только броню.');
          const equipment = stock.equipment[auth.playerId] || {};
          const elsewhere = INVENTORY_SLOTS.filter(other => other !== slot && equipment[other] === lot.id).length;
          if (invBalance(lot, auth.playerId) <= elsewhere) throw new InventoryError(409, 'Все экземпляры этого предмета уже в других слотах.');
          stock.equipment[auth.playerId] = { ...equipment, [slot]: lot.id };
        }
      }
    }
  }
  stock.operations.push({ id: operationId, fingerprint, actorId, actorName: actor?.name || 'Мастер', action, itemId: lot?.id || null, itemName: lot?.name || '', quantity, slot, ...(recipientId !== undefined ? { recipientId } : {}), createdAt: Date.now() });
  return { changed: true, duplicate: false };
}
