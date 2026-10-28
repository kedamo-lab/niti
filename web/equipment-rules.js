'use strict';
/* Shared, bounded tabletop equipment rules. Source ranges remain separate from adapted dice. */
(function(root){
  const EquipmentRules=(()=>{
  const DICE_SIDES = Object.freeze([4,6,8,10,12,20,100]);
  const DAMAGE_TYPES = Object.freeze(['normal','laser','fire','plasma','electric','emp','explosive']);
  const STAT_KEYS = Object.freeze(['damage','damageFormula','apCost','range','rangeFormula','rangeBonus','ammo','magazine','minStrength','damageType','modifiers','armorClass','resistances','weight','price','reloadAp','slots','effect','healingFormula','radiationReduction','damageThresholds','resistancePercent','agilityDivisor']);
  const finite = (v,min,max) => typeof v==='number' && Number.isFinite(v) && v>=min && v<=max;
  const integer = (v,min,max) => Number.isSafeInteger(v) && v>=min && v<=max;
  function parseFormula(input, options={}) {
    if (typeof input!=='string' || !input.trim() || input.length>200) return null;
    const source=input.normalize('NFKC').replace(/[−–—]/g,'-').replace(/СИЛА|СИЛ|STR/gi,'S').replace(/[дкD]/gi,'d').replace(/s/g,'S').replace(/\s+/g,'');
    if (!source || source.length>160) return null;
    let at=0,modifier=0,strengthCoefficient=0,hasStrength=false,diceCount=0,tokenCount=0;
    const groups=new Map();
    while(at<source.length) {
      if(++tokenCount>48)return null;
      let sign=1;
      if(source[at]==='+' || source[at]==='-'){sign=source[at]==='-'?-1:1;at++;}
      else if(at!==0)return null;
      const tail=source.slice(at),dice=/^(\d*)d(\d+)/.exec(tail);
      if(dice) {
        const count=dice[1]?Number(dice[1]):1,sides=Number(dice[2]);
        if(sign<0 || !integer(count,1,40) || !DICE_SIDES.includes(sides) || diceCount+count>40)return null;
        groups.set(sides,(groups.get(sides)||0)+count);diceCount+=count;at+=dice[0].length;
      } else if(source[at]==='S') {
        if(options.allowStrength===false || hasStrength)return null;
        hasStrength=true;strengthCoefficient=sign;at++;
      } else {
        const constant=/^\d+/.exec(tail);
        if(!constant)return null;
        const value=Number(constant[0]);
        if(!integer(value,0,1000) || Math.abs(modifier+sign*value)>1000)return null;
        modifier+=sign*value;at+=constant[0].length;
      }
      if(at<source.length && source[at]!=='+' && source[at]!=='-')return null;
    }
    const terms=[...groups].sort((a,b)=>a[0]-b[0]).map(([sides,count])=>({count,sides}));
    const pieces=terms.map(term=>term.count+'d'+term.sides);
    let formula=pieces.join('+');
    if(modifier || (!formula && !hasStrength))formula+=(modifier>=0 && formula?'+':'')+modifier;
    if(hasStrength)formula+=(strengthCoefficient<0?'-':formula?'+':'')+'S';
    const min=terms.reduce((sum,term)=>sum+term.count,modifier),max=terms.reduce((sum,term)=>sum+term.count*term.sides,modifier);
    return {formula,terms,modifier,strengthCoefficient,diceCount,usesStrength:hasStrength,min,max,average:(min+max)/2};
  }
  function parsedFormula(input,options={}) {return parseFormula(typeof input==='string'?input:input?.formula,options);}
  function formatFormula(input) {return parsedFormula(input)?.formula || '';}
  function formulaBounds(input,options={}) {
    const parsed=parsedFormula(input);
    const strength=options.strength ?? 0;
    if(!parsed || !integer(strength,0,10))throw new RangeError('Нужна формула до 40 кубиков и Сила от 0 до 10.');
    const bonus=parsed.strengthCoefficient*strength,rawMin=parsed.min+bonus,rawMax=parsed.max+bonus;
    return {min:Math.max(0,rawMin),max:Math.max(0,rawMax),rawMin,rawMax,average:(rawMin+rawMax)/2};
  }
  function randomFace(sides) {
    if(!globalThis.crypto || typeof globalThis.crypto.getRandomValues!=='function')throw new Error('Генератор случайных чисел недоступен.');
    const buffer=new Uint32Array(1),limit=Math.floor(4294967296/sides)*sides;
    do{globalThis.crypto.getRandomValues(buffer);}while(buffer[0]>=limit);
    return buffer[0]%sides+1;
  }
  function rollFormula(input,options={}) {
    const parsed=parsedFormula(input),strength=options.strength ?? 0,rng=options.rng || randomFace;
    if(!parsed || !integer(strength,0,10) || typeof rng!=='function')throw new RangeError('Некорректная формула броска или Сила.');
    const rolls=[];
    for(const term of parsed.terms)for(let index=0;index<term.count;index++){
      const value=rng(term.sides);
      if(!integer(value,1,term.sides))throw new RangeError('Некорректный результат кубика.');
      rolls.push({sides:term.sides,value});
    }
    const strengthBonus=parsed.strengthCoefficient*strength,subtotal=rolls.reduce((sum,die)=>sum+die.value,0),rawTotal=subtotal+parsed.modifier+strengthBonus,bounds=formulaBounds(parsed,{strength});
    return {formula:parsed.formula,rolls,subtotal,modifier:parsed.modifier,strengthBonus,rawTotal,total:Math.max(0,rawTotal),min:bounds.min,max:bounds.max};
  }
  function fromRange(min,max,options={}) {
    if(!integer(min,0,1000) || !integer(max,min,1000))return null;
    const maxDice=integer(options.maxDice,1,20)?options.maxDice:8,targetAverage=(min+max)/2;
    let best=null;
    const candidates=[];
    if(min===max)candidates.push({terms:[],modifier:min,count:0});
    for(let first=0;first<DICE_SIDES.length;first++)for(let second=first;second<DICE_SIDES.length;second++){
      for(let firstCount=1;firstCount<=maxDice;firstCount++)for(let secondCount=0;secondCount<=maxDice-firstCount;secondCount++){
        if(first===second && secondCount)continue;
        const terms=[{count:firstCount,sides:DICE_SIDES[first]},...(secondCount?[{count:secondCount,sides:DICE_SIDES[second]}]:[])];
        const count=firstCount+secondCount,dieAverage=terms.reduce((sum,term)=>sum+term.count*(term.sides+1)/2,0);
        const raw=targetAverage-dieAverage;
        for(const modifier of new Set([Math.floor(raw),Math.ceil(raw)]))if(integer(modifier,-1000,1000))candidates.push({terms,modifier,count});
      }
    }
    for(const candidate of candidates){
      const rawMin=candidate.terms.reduce((sum,term)=>sum+term.count,candidate.modifier),rawMax=candidate.terms.reduce((sum,term)=>sum+term.count*term.sides,candidate.modifier),average=(rawMin+rawMax)/2;
      if(rawMin<0)continue;
      const score=Math.abs(rawMin-min)+Math.abs(rawMax-max)+2*Math.abs(average-targetAverage)+Math.max(0,candidate.count-1)*0.08;
      if(!best || score<best.score-1e-9 || (Math.abs(score-best.score)<1e-9 && candidate.count<best.count))best={...candidate,min:rawMin,max:rawMax,average,score};
    }
    if(!best)return null;
    let formula=best.terms.map(term=>term.count+'d'+term.sides).join('+');
    if(best.modifier || !formula)formula+=(best.modifier>=0 && formula?'+':'')+best.modifier;
    if(options.strengthBonus)formula+='+S';
    const parsed=parseFormula(formula);
    if(!parsed)return null;
    const approximate=best.min!==min || best.max!==max;
    return {formula:parsed.formula,originalMin:min,originalMax:max,min:best.min,max:best.max,average:best.average,sourceAverage:targetAverage,approximate,method:'olympus-range-fit-v1',note:approximate?`Диапазон игры ${min}–${max} адаптирован в ${parsed.formula}: ${best.min}–${best.max}, среднее ${best.average}.`:`Диапазон игры ${min}–${max} сохранён в ${parsed.formula}; среднее ${best.average}.`};
  }
  function healingFromRange(min,max=min) {return fromRange(min,max);}
  function numericMap(input,min,max) {
    if(input==null)return {};
    if(typeof input!=='object' || Array.isArray(input))return null;
    const result={};
    for(const [key,value]of Object.entries(input)){
      if(!DAMAGE_TYPES.includes(key) || (value!==null && !finite(value,min,max)))return null;
      result[key]=value;
    }
    return result;
  }
  function armorFromOriginal(ac,options={}) {
    if(!finite(ac,0,100))return null;
    const damageThresholds=numericMap(options.thresholds ?? options.damageThresholds,0,1000),resistancePercent=numericMap(options.resistances ?? options.resistancePercent,0,100);
    if(!damageThresholds || !resistancePercent)return null;
    const armorClass=5+Math.round(ac/5);
    return {armorClass,agilityDivisor:0,damageThresholds,resistancePercent,originalArmorClass:ac,method:'olympus-d20-armor-v1',note:`КБ игры ${ac}% → настольный КБ ${armorClass} = 5 + округление(${ac}/5). ПУ и СУ сохранены отдельно; дополнительного бонуса ловкости у этой адаптации нет.`};
  }
  function damageType(input) {
    const key=String(input||'normal').trim().toLocaleLowerCase('ru').replace(/ё/g,'е');
    return ({'норма':'normal','обычный':'normal','normal':'normal','лазер':'laser','laser':'laser','огонь':'fire','fire':'fire','плазма':'plasma','plasma':'plasma','электро':'electric','электричество':'electric','электрический':'electric','electric':'electric','electrical':'electric','эми':'emp','emp':'emp','взрыв':'explosive','взрывчатка':'explosive','explosion':'explosive','explosive':'explosive'})[key] || null;
  }
  function protectDamage(amount,stats={},type='normal') {
    if(!finite(amount,0,1000000))throw new RangeError('Некорректный входящий урон.');
    const key=damageType(type);
    if(!key)throw new RangeError('Неизвестный тип урона.');
    const threshold=finite(stats.damageThresholds?.[key],0,1000)?stats.damageThresholds[key]:0;
    const resistance=finite(stats.resistancePercent?.[key],0,100)?stats.resistancePercent[key]:0;
    const afterThreshold=Math.max(0,amount-threshold),preventedByPercent=Math.round(afterThreshold*resistance/100),total=Math.max(0,afterThreshold-preventedByPercent);
    return {type:key,incoming:amount,threshold,resistancePercent:resistance,afterThreshold,preventedByPercent,total,method:'subtract-threshold-then-round-percent-reduction'};
  }
  function applyHealing(currentHP,maxHP,amount) {
    if(!finite(currentHP,-1000000,1000000) || !finite(maxHP,0,1000000) || !finite(amount,0,1000000))throw new RangeError('Нужны числовые значения здоровья и лечения.');
    const before=currentHP,after=before>=maxHP ? before : Math.min(maxHP,before+amount);
    return {before,after,maxHP,rolled:amount,applied:after-before,wasted:Math.max(0,amount-(after-before))};
  }
  function weaponFormula(stats={}) {
    const explicit=parseFormula(stats.damageFormula);
    if(explicit)return explicit.formula;
    const text=typeof stats.damage==='string'?stats.damage.trim():typeof stats.damage==='number'?String(stats.damage):'';
    const complete=parseFormula(text);if(complete)return complete.formula;
    const leading=/^((?:\d*\s*[dдкD]\s*(?:100|20|12|10|8|6|4)|\d+)(?:\s*[+-]\s*(?:\d*\s*[dдкD]\s*(?:100|20|12|10|8|6|4)|\d+|S|СИЛА|СИЛ|STR))*)(?=\s|[,;:(]|$)/i.exec(text);
    return leading?parseFormula(leading[1])?.formula || '':'';
  }
  function validateEquipmentStats(input) {
    const errors=[];
    if(!input || typeof input!=='object' || Array.isArray(input))return {valid:false,errors:['Характеристики должны быть объектом.']};
    for(const [key,value]of Object.entries(input)){
      if(!STAT_KEYS.includes(key)){errors.push('Неизвестная характеристика: '+key+'.');continue;}
      if(value===null)continue;
      if(key==='damageFormula' || key==='healingFormula'){
        if(!parseFormula(value,{allowStrength:key!=='healingFormula'}))errors.push('Некорректная формула: '+key+'.');
      }else if(key==='damageThresholds' || key==='resistancePercent'){
        if(!numericMap(value,0,key==='damageThresholds'?1000:100))errors.push('Некорректная таблица: '+key+'.');
      }else if(key==='resistances'){
        if(typeof value!=='object' || Array.isArray(value) || Object.entries(value).some(([type,number])=>!DAMAGE_TYPES.includes(type) || !(number===null || finite(number,-1000000000,1000000000) || (typeof number==='string' && number.length<=1000))))errors.push('Некорректная защита брони.');
      }else if(key==='rangeFormula'){
        if(value!=='perception')errors.push('Неизвестная формула дальности.');
      }else if(key==='rangeBonus'){
        if(!finite(value,-1000,1000))errors.push('Поправка дальности должна быть от −1000 до 1000.');
      }else if(key==='agilityDivisor'){
        if(!integer(value,0,100))errors.push('Делитель ловкости должен быть целым числом от 0 до 100.');
      }else if(key==='radiationReduction'){
        if(!finite(value,0,10000))errors.push('Снижение радиации должно быть числом от 0 до 10000.');
      }else if(!(finite(value,0,1000000000) || (typeof value==='string' && value.length<=1000)))errors.push('Некорректная характеристика: '+key+'.');
    }
    return {valid:errors.length===0,errors};
  }
  return Object.freeze({DICE_SIDES,DAMAGE_TYPES,STAT_KEYS,parseFormula,formatFormula,formulaBounds,rollFormula,fromRange,healingFromRange,armorFromOriginal,damageType,protectDamage,applyHealing,weaponFormula,validateEquipmentStats});

  })();
  root.EquipmentRules=EquipmentRules;
  if(typeof module!=='undefined' && module.exports)module.exports=EquipmentRules;
})(typeof window!=='undefined'?window:globalThis);
