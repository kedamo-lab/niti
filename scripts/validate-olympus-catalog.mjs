/* Validate actual source coverage, safe mechanics, and preservation of issued IDs. */
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const catalogText=read('worker/item-catalog.js');
const parse=text=>JSON.parse(text.split('export const ITEM_CATALOG = ')[1].split(';\nexport const REWARD_ALIASES = ')[0]);
const items=parse(catalogText),source=JSON.parse(read('olympus-catalog-source.json'));
const context={window:{}};vm.createContext(context);vm.runInContext(read('web/equipment-rules.js'),context);const R=context.window.EquipmentRules;
const weapons=new Set(['melee','unarmed','light','heavy','energy','throwing','explosive']);
const byID=new Map(items.map(i=>[i.id,i])),native=items.filter(i=>i.id.startsWith('olympus-'));
assert.equal(items.length,620);assert.equal(byID.size,620);assert.equal(native.length,385);
assert.equal(source.excluded.length,216);assert.equal(source.included.length,385);
const covered=[...source.included,...source.excluded].map(x=>x.pid).sort((a,b)=>a-b);
assert.deepEqual(covered,Array.from({length:601},(_,i)=>i+1),'Every original PID has exactly one disposition.');
for(const entry of source.included){const item=byID.get('olympus-'+entry.pid);assert(item,entry.name);assert.equal(item.source.nativeName,entry.name);assert.equal(item.olympusPid,entry.pid);}
for(const item of items){
  if(weapons.has(item.category))assert(R.parseFormula(item.stats.damageFormula),item.id+': safe, executable damage');
  if(item.stats.healingFormula)assert(R.parseFormula(item.stats.healingFormula,{allowStrength:false}),item.id+': safe, immediate healing');
  if(!item.id.startsWith('olympus-'))continue;
  assert(R.validateEquipmentStats(item.stats).valid,item.id+': stats schema');
  assert(/^data:image\/(png|webp);base64,/.test(item.image),item.id+': bundled art');
  assert.equal(item.source.art.match,'original','Use genuine Olympus inventory art.');
  assert.equal(item.source.art.game,'Olympus 2207');
  assert.equal(item.source.art.pid,item.olympusPid);
  assert.equal((item.source.art.inventoryFid >>> 24)&15,7);
  assert(item.source.art.frmPath.startsWith('art/inven/'));
  assert.equal(createHash('sha256').update(Buffer.from(item.image.split(',')[1],'base64')).digest('hex'),item.source.art.imageSha256);
  assert.equal(item.source.art.frame.transparentIndex,0);
  for(const key of item.adaptation.estimatedFields)assert(item.warnings.length>0,item.id+': estimated fields disclosed');
  const original=item.originalGameStats;
  if(original.damageMin!==undefined){
    assert.equal(original.damageMin,source.weaponFacts[item.olympusPid].damageMin);
    assert.equal(original.damageMax,source.weaponFacts[item.olympusPid].damageMax);
    if(item.olympusPid!==35){const fit=item.adaptation.adaptedRange,bounds=R.formulaBounds(item.stats.damageFormula);assert.equal(bounds.min,fit.min);assert.equal(bounds.max,fit.max);assert.equal(item.adaptation.approximate,original.damageMin!==fit.min || original.damageMax!==fit.max);}
  }
  if(original.armorClass!==undefined){assert.equal(item.stats.armorClass,5+Math.round(original.armorClass/5));assert.equal(item.stats.agilityDivisor,0);assert.deepEqual(item.stats.damageThresholds,original.damageThresholds);assert.deepEqual(item.stats.resistancePercent,original.resistancePercent);}
  if(weapons.has(item.category)&&item.stats.ammo)assert.equal(item.stats.reloadAp,2,item.id+': reload AP');
  if(weapons.has(item.category)&&!['melee','unarmed'].includes(item.category))assert.equal(item.stats.rangeFormula,'perception',item.id+': tabletop range');
}
assert.equal(byID.get('olympus-35').stats.damageFormula,'2d6');assert.equal(byID.get('olympus-35').stats.apCost,3);
const minigun=byID.get('olympus-193');assert.equal(minigun.stats.magazine,500);assert(R.formulaBounds(minigun.stats.damageFormula).max<=9,'Damage is per hit, not entire magazine.');
assert.equal(items.find(x=>x.name==='Стимулятор').stats.healingFormula,'25');assert.equal(items.find(x=>x.name==='Целебный порошок').stats.healingFormula,'10');
for(const name of ['Гиппо','Полевой суперстимулятор'])assert(!items.find(x=>x.name===name).stats.healingFormula,'Do not invent instantaneous healing for timed or temporary effects.');
const gm=fs.readFileSync(path.join(root,'../niti-storydesk/dist/item-catalog.js'),'utf8');assert.deepEqual(JSON.parse(gm.slice('window.NITI_ITEM_CATALOG = '.length).trim().slice(0,-1)),items,'Both terminals use identical definitions.');
// The old source is an independent regression fixture: all existing item IDs,
// human damage and armor values must survive catalog growth.
for(const item of source.retainedEquipmentBaseline){
  const current=byID.get(item.id);assert(current,item.id+': existing item retained');assert.equal(current.name,item.name);
  for(const [key,value]of Object.entries(item.stats))if(!['damageFormula','healingFormula'].includes(key))assert.deepEqual(current.stats[key],value,item.id+': preserved '+key);
}
assert.equal(createHash('sha256').update(catalogText.split(';\nexport const REWARD_ALIASES = ')[1]).digest('hex'),source.retainedRewardAliasesSha256,'Existing reward aliases are stable.');
const result={catalog:items.length,olympusPortable:native.length,nativePrototypesAccounted:covered.length,excludedMapContainers:source.excluded.filter(x=>x.reason==='world_container_or_furniture').length,excludedReserved:source.excluded.filter(x=>x.reason==='reserved_or_unused_placeholder').length,weaponsWithSafeDamage:items.filter(x=>weapons.has(x.category)).length,olympusWeaponsWithOriginalDamage:native.filter(x=>x.originalGameStats.damageMin!==undefined).length,olympusArmorWithOriginalDefense:native.filter(x=>x.originalGameStats.armorClass!==undefined).length,olympusWithEstimatedFields:native.filter(x=>x.adaptation.estimatedFields.length).length,passed:true};
console.log(JSON.stringify(result,null,2));
