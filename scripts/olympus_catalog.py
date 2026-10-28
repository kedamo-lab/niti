"""Reproducibly extend equipment with every named portable Olympus 2207 prototype.

Original numerical facts and campaign adaptations are deliberately separate.
Run independently against the retained catalog, or call extend_catalog at the
end of another catalog generator. Existing IDs and statistics remain stable.
"""
from pathlib import Path
import copy,json,re,subprocess

WEAPONS={'melee','unarmed','light','heavy','energy','throwing','explosive'}
LABELS={'ammo':'Боеприпасы','armor':'Броня','currency':'Валюта','unarmed':'Рукопашное оружие','melee':'Холодное оружие','light':'Стрелковое оружие','heavy':'Тяжёлое оружие','energy':'Энергетическое оружие','throwing':'Метательное оружие','explosive':'Взрывчатка','medicine':'Медикаменты','food':'Провизия','tool':'Инструменты и снаряжение','craft':'Материалы и мусор','quest':'Уникальные и сюжетные предметы','book':'Книги и записи'}
TYPE_LABELS={'normal':'Норма','laser':'Лазер','fire':'Огонь','plasma':'Плазма','electric':'Электро','emp':'ЭМИ','explosive':'Взрыв'}
AMMO_PIDS={23:'БигБат',28:'МиниБат',29:'Напалм'}

def category(pid,name):
    if pid<=33:return 'ammo'
    if 34<=pid<=40:return 'unarmed'
    if pid==41:return 'currency'
    if pid in {42,43,44,48,49,51,85,206,209}:return 'explosive'
    if pid in {62,63} or 211<=pid<=219:return 'throwing'
    if pid in {60,61,64,65,66,67,68,69,70,71,87,88,89,103,104,106,107,108,109,110,111,112,148,338} or 514<=pid<=524:return 'melee'
    if 113<=pid<=129 or pid in {391,394}:return 'armor'
    if pid in {92,93,94,95,99,100,101,182,183,184,190,191,192,193,195,196,197,199}:return 'heavy'
    if pid in {96,97,98,145,157,158,300,390,513}:return 'energy'
    if 130<=pid<=188:return 'light'
    if 220<=pid<=233 or pid in {302,335,343,347,444}:return 'medicine'
    if 234<=pid<=239 or pid in {246,291,292,297,315,323,328,344,434,441,442,443}:return 'food'
    if pid in {73,76,80,86,102,309,318,325,329,339,340,345,380,381,382,383,384,385,386,387,388,389,393,402,403,404,412,413,416,417,418,445,446,448,483}:return 'book'
    if pid in {74,75,77,78,81,305,307,321,336,337,392,405,406,407,410,411,414,419,420,421,422,423,424,425,426,427,428,429,430,431,433,435,436,437,438,439,440,485,487,488,489,490,491}:return 'craft'
    if 290<=pid<=348 or 395<=pid<=401 or pid in {447,484,486}:return 'quest'
    return 'tool'

def dtype(pid,name,cat):
    n=name.casefold()
    if pid in {182,195,211} or 'эми' in n:return 'emp'
    if 'плазм' in n:return 'plasma'
    if 'лазер' in n or pid==390:return 'laser'
    if 'электро' in n and cat in WEAPONS:return 'electric'
    if 'огнем' in n or 'огнём' in n or 'зажигател' in n or 'молотов' in n or pid==185:return 'fire'
    if cat=='explosive' or 'гранат' in n or 'ракет' in n:return 'explosive'
    return 'normal'

def default_formula(pid,name,cat):
    if pid==35:return '2d6' # Explicitly confirmed by the campaign's GM.
    if cat=='unarmed':return '2d6' if pid<38 else '2d8'
    if cat=='melee':
        if any(x in name.casefold() for x in ['лазер','электро','пила']):return '3d8'
        if pid in {338}:return '1d4'
        if 514<=pid<=524:return '2d6'
        return '2d6'
    if cat=='energy':return '5d6' if any(x in name.casefold() for x in ['пушк','винтов','богов']) else '3d8'
    if cat=='heavy':return '6d6' if any(x in name.casefold() for x in ['гранат','ракет','пушк','огнем']) else '3d8'
    if cat=='explosive':return '6d6'
    if cat=='throwing':return '3d6'
    return '2d8' if any(x in name.casefold() for x in ['автомат','винтов','дробов','револьвер']) else '2d6'

def default_ammo(pid,name,cat):
    if cat in {'light','heavy','energy'}:
        if pid==390:return None
        n=name.casefold()
        if 'огнем' in n or 'огнём' in n:return 'Напалм'
        if 'ракет' in n:return 'Ракета (ЭМИ)' if 'эми' in n else 'Ракета'
        if 'гранат' in n:return '25 мм (ЭМИ)' if 'эми' in n else '40 мм'
        if 'плазм' in n or 'лазер' in n:return 'БигБат' if any(x in n for x in ['винтов','пушк']) else 'МиниБат'
        if 'дробов' in n or 'двуствол' in n or 'обрез' in n:return '12 калибр'
        if 'пневм' in n:return 'Шарики'
        if 'магнум' in n:return 'Патроны Магнум'
        if 'револьвер' in n:return '.38 калибр'
        if 'винтов' in n or 'автомат' in n or 'пулем' in n:return '.223 калибр'
        return '9 мм'
    if pid==34:return '12 калибр'
    if pid in {40,61,69,87,103,148}:return 'МиниБат'
    return None

def art_id(pid,name,cat,old):
    n=name.casefold(); names={re.sub(r'[^а-яa-z0-9]','',x['name'].casefold().replace('ё','е')):x['id'] for x in old.values()}
    key=re.sub(r'[^а-яa-z0-9]','',n.replace('ё','е'))
    if key in names:return names[key]
    if cat=='ammo':
        if pid in {1,2,3}:return 'fo2-ammo-223-fmj'
        if pid in {4,5,10}:return 'fo2-ammo-762mm'
        if pid in {6,7,27}:return 'fo2-ammo-44-fmj'
        if pid in {8,9}:return 'fo2-ammo-45'
        if pid in {11,12,13,14,26}:return 'fo2-ammo-12ga'
        if pid in {19,20,21,22,24}:return 'fo2-ammo-9mm'
        if pid in {23}:return 'fo2-ammo-micro-fusion'
        if pid in {28}:return 'fo2-ammo-small-energy'
        if pid in {29}:return 'fo2-ammo-flamer-fuel'
        if pid in {25}:return 'fo2-ammo-needler-hn'
        if pid in {33}:return 'fo2-ammo-bb'
        return 'fo2-ammo-rocket-ap' if pid==32 else 'fo2-ammo-rocket-explosive'
    if cat=='currency':return 'fo2-ammo-small-energy'
    if cat=='armor':return 'docx-t09-r%02d' % (0 if pid in {113,114} else 1 if pid<=117 else 3 if pid<=119 else 5 if pid<=124 or pid==394 else 8 if pid<=126 else 10)
    if cat=='unarmed':return 'docx-t01-r17' if pid==40 else 'docx-t02-r02' if pid in {36,37} else 'docx-t02-r01'
    if cat=='melee':
        if 'лазер' in n:return 'docx-t07-r01'
        if 'электро' in n:return 'docx-t01-r18'
        if 'пил' in n:return 'docx-t01-r17'
        if 'молот' in n or 'кувалд' in n:return 'docx-t01-r14'
        if 'копье' in n or 'копьё' in n:return 'docx-t01-r12'
        if 'ключ' in n:return 'docx-t01-r08'
        if 'фомка' in n:return 'docx-t01-r09'
        if any(x in n for x in ['палк','труб','кий','кия','дубин','вантуз']):return 'docx-t01-r16'
        if pid>=514:return 'docx-t06-r05'
        return 'docx-t01-r05'
    if cat=='heavy':
        if 'огнем' in n:return 'docx-t05-r06'
        if 'ракет' in n or 'гранат' in n:return 'docx-t05-r08'
        if pid in {190,191,193}:return 'docx-t05-r04'
        return 'docx-t05-r01'
    if cat=='energy':return 'docx-t07-r09' if 'плазм' in n else 'docx-t07-r07' if 'винтов' in n else 'docx-t07-r01'
    if cat=='light':
        if 'дробов' in n or 'двуствол' in n:return 'docx-t04-r30'
        if 'обрез' in n:return 'docx-t04-r28'
        if 'снайпер' in n or 'винтов' in n:return 'docx-t04-r22'
        if 'автомат' in n:return 'docx-t04-r24'
        if n.startswith('пп') or 'пулемет' in n:return 'docx-t04-r11'
        if 'револьвер' in n or 'питон' in n:return 'docx-t04-r05'
        return 'docx-t04-r02'
    if cat in {'throwing','explosive'}:return 'docx-t06-r01' if pid==214 else 'docx-t06-r04' if pid==211 else 'docx-t01-r10' if pid==213 else 'docx-t01-r04' if pid in {62,63} else 'docx-t06-r02'
    if cat=='medicine':return 'book-ac7cac72072b' if pid in {222,223,230,302,343} else 'book-27140ece2559' if pid in {224,225} else 'book-f61f860eb2cc' if pid in {226,227,335} else 'book-e82fdda67ae6' if pid in {221,228,229,231,232,233,444} else 'book-84ee96228316'
    if cat=='food':return 'book-1242a76c45d1' if pid in {237,246,292,323} else 'book-6289c3deade8' if pid in {234,235,236,297} else 'book-43a548f2834c' if pid in {315,328,442} else 'book-066c1a6a8bab'
    if pid in {47,91,408,409}:return 'book-59816ce83b34' if pid==409 else 'book-84ee96228316'
    if 'отмыч' in n:return 'book-177093adb5dd'
    if 'верев' in n:return 'book-78425f6da181'
    if 'дров' in n:return 'book-f3f99ee10136'
    if 'клык' in n or 'хвост' in n:return 'book-2a8e6345fb1c'
    if 'батар' in n or 'ячейк' in n:return 'fo2-ammo-micro-fusion'
    if 'части' in n or 'модуль' in n or 'двигател' in n or 'запчаст' in n:return 'book-4a5a3a2ffe59'
    if 'бутыл' in n:return 'book-5f1a8ee60cfa'
    if 'тряп' in n:return 'book-1c138514c152'
    if 'лист' in n or 'зол' in n:return 'book-27417081b467'
    if 'шкур' in n:return 'book-daefa00ce309'
    if cat=='craft':return 'book-3ef9496f1da0'
    if cat=='book':return 'book-de12993bad9b'
    if cat=='quest':return 'book-e875a9d7911e'
    return 'book-c0eca9e22988'

def mechanical_fit(root,ranges):
    program="const fs=require('fs'),vm=require('vm');const ctx={window:{}};vm.createContext(ctx);vm.runInContext(fs.readFileSync('web/equipment-rules.js','utf8'),ctx);const input=JSON.parse(fs.readFileSync(0,'utf8'));process.stdout.write(JSON.stringify(input.map(x=>ctx.window.EquipmentRules.fromRange(x[0],x[1]))));"
    result=subprocess.run(['node','-e',program],input=json.dumps(ranges),text=True,capture_output=True,cwd=root,check=True)
    return json.loads(result.stdout)

def extend_catalog(items,root):
    source=json.loads((root/'olympus-catalog-source.json').read_text())
    result=copy.deepcopy([i for i in items if not str(i['id']).startswith('olympus-')]);old={i['id']:i for i in result}
    # Add executable formulas without changing the retained book's displayed damage.
    old_estimates={'docx-t05-r01':'4d6','docx-t05-r02':'4d6','docx-t05-r03':'5d6','docx-t05-r04':'5d6','docx-t05-r05':'6d6','docx-t05-r06':'6d6','docx-t05-r07':'8d6','docx-t05-r08':'6d8'}
    for item in result:
        stats=item['stats']
        if item['category'] in WEAPONS and not stats.get('damageFormula'):
            damage=str(stats.get('damage') or '').replace('д','d')
            m=re.match(r'((?:\d+d(?:100|20|12|10|8|6|4))(?:\s*[+]\s*(?:\d+d(?:100|20|12|10|8|6|4)|\d+))*)',damage,re.I)
            formula=m.group(1).replace(' ','') if m else old_estimates.get(item['id'])
            if not formula and ('дымов' in item['name'].casefold() or 'светозвуков' in item['name'].casefold()):formula='0'
            if not formula and 'горчич' in item['name'].casefold():formula='1d6'
            if formula:
                stats['damageFormula']=formula
                if not m and formula!='0':
                    warning='Урон назначен для настольной кампании; исходная таблица не содержит формулы. Мастер может изменить его перед выдачей.'
                    if warning not in item.setdefault('warnings',[]):item['warnings'].append(warning)
                    item['adaptation']={'method':'campaign-default-v1','estimatedFields':['damageFormula'],'note':'Настольная адаптация: в предоставленной таблице нет формулы прямого урона. Стартовое значение '+formula+' назначено для кампании; мастер может изменить его перед выдачей.'}
        if item.get('adaptation',{}).get('method')=='campaign-default-v1':
            warning='Урон назначен для настольной кампании; исходная таблица не содержит формулы. Мастер может изменить его перед выдачей.'
            if warning not in item.setdefault('warnings',[]):item['warnings'].append(warning)
        if item['name']=='Стимулятор':stats['healingFormula']='25'
        if item['name']=='Целебный порошок':stats['healingFormula']='10'
    facts=source['weaponFacts']; fitlist=list(facts); fits=mechanical_fit(root,[(facts[k]['damageMin'],facts[k]['damageMax'])for k in fitlist]);fitmap=dict(zip(fitlist,fits))
    for entry in source['included']:
        pid=entry['pid']; native_name=entry['name'];name=native_name.strip().strip('*').strip();cat=category(pid,name);s={'damage':None,'damageFormula':None,'apCost':None,'range':None,'rangeFormula':None,'rangeBonus':None,'ammo':None,'magazine':None,'minStrength':None,'damageType':None,'armorClass':None,'resistances':None,'weight':None,'price':None,'reloadAp':None,'slots':None,'effect':None,'modifiers':None}
        original={};adapt={'method':'olympus-tabletop-v1','estimatedFields':[],'note':''};notes=[]
        if str(pid) in source['nativeMinStrength']:
            original['minStrength']=source['nativeMinStrength'][str(pid)];s['minStrength']=original['minStrength']
        if cat in WEAPONS:
            original.update(copy.deepcopy(facts.get(str(pid),{})));fit=fitmap.get(str(pid))
            if fit:
                s['damageFormula']=fit['formula'];adapt.update({'method':fit['method'],'sourceRange':{'min':fit['originalMin'],'max':fit['originalMax']},'adaptedRange':{'min':fit['min'],'max':fit['max']},'approximate':fit['approximate']});notes.append(fit['note'])
            else:
                s['damageFormula']=default_formula(pid,name,cat);adapt['estimatedFields'].append('damageFormula');notes.append('Урон назначен для настольной кампании; числовой урон оригинала не подтверждён.')
            if pid==35:
                s['damageFormula']='2d6';adapt['method']='gm-confirmed-campaign';adapt['approximate']=True;notes=['Параметры кастета подтверждены мастером для кампании: 2d6 и 3 ОД. В оригинале отдельный диапазон 2–6.']
            s['damage']=s['damageFormula'];s['damageType']=TYPE_LABELS[dtype(pid,name,cat)]
            for key in ['apCost','ammo','magazine','weight']:
                if key in original:s[key]=original[key]
            if s['apCost'] is None:s['apCost']=3 if cat in {'unarmed','melee'} else 4 if cat=='throwing' else 5 if cat=='light' else 6;adapt['estimatedFields'].append('apCost')
            if pid==35:
                s['apCost']=3
                adapt['estimatedFields']=[k for k in adapt['estimatedFields'] if k!='apCost']
            if s['ammo'] is None:
                s['ammo']=default_ammo(pid,name,cat)
                if s['ammo'] is not None:adapt['estimatedFields'].append('ammo')
            if s['ammo'] is not None:s['reloadAp']=2
            if cat in {'unarmed','melee'}:s['range']=2 if pid in {69,70,71} else 1
            else:s.update({'range':'Восприятие персонажа','rangeFormula':'perception','rangeBonus':0})
            if pid in {92,93,94,95,137,150,151,152,153,154,155,156,159,160,161,162,164,165,168,169,171,190,191,192,193}:notes.append('Бросок — за одно попадание. Число попаданий очереди определяет мастер; размер магазина не умножает урон.')
            if pid==141:s['effect']='Дротики содержат яд. Состояние отравления и его длительность определяет мастер отдельно от прямого урона.'
            if pid in {182,195,211}:s['effect']='ЭМИ: предназначено против электроники и роботизированных целей. Воздействие на органические цели определяет мастер.'
        elif cat=='armor':
            original=copy.deepcopy(source['armorFacts'].get(str(pid),{}));nativeAC=original.get('armorClass')
            if nativeAC is None:
                s['armorClass']=12;s['agilityDivisor']=0;adapt['estimatedFields']=['armorClass'];notes.append('Настольный КБ 12 — стартовая настройка; КБ оригинального прототипа не подтверждён.')
            else:
                s['armorClass']=5+int(nativeAC/5+0.5);s['agilityDivisor']=0;s['damageThresholds']=copy.deepcopy(original['damageThresholds']);s['resistancePercent']=copy.deepcopy(original['resistancePercent']);s['weight']=original.get('weight');adapt['method']='olympus-d20-armor-v1';notes.append(f'КБ оригинала {nativeAC}% → настольный КБ {s["armorClass"]}: 5 + округление({nativeAC}/5). ПУ и СУ сохранены отдельно. Бонус ловкости у этой адаптации не добавляется.')
            if pid in {124,129,128}:s['effect']={124:'Оригинал: полная защита от радиации. В кампании радиационные эффекты учитывает мастер.',129:'Оригинал: 95% защиты от радиации и усиление силы. Усиление и радиацию учитывает мастер отдельно.',128:'Оригинал: 50% защиты от радиации. Радиационные эффекты учитывает мастер.'}[pid]
            if pid==391:notes.append('Прототип оригинала предназначен для разработчиков. Доступность в кампании решает мастер.')
        elif cat=='medicine':
            heal={220:'1d4',221:'1d6',222:'3d6',223:'6d6',230:'4d6'}
            if pid in heal:s['healingFormula']=heal[pid];adapt['estimatedFields'].append('healingFormula');notes.append('Лечение '+heal[pid]+' — настольная адаптация, не подтверждённое число оригинальной игры. Применяется к текущим ОЗ, не выше максимума.')
            s['apCost']=2;adapt['estimatedFields'].append('apCost')
            if pid in {226,227,335}:s['radiationReduction']=50 if pid==227 else 25;adapt['estimatedFields'].append('radiationReduction')
            effects={220:'Перевязочный материал для обработки лёгких повреждений.',221:'Обезболивающее для лёгких повреждений.',222:'Инъекционное лечебное средство.',223:'Лечение; временные эффекты силы и сопротивления урону назначает мастер.',224:'Средство против отравления. Снятие отравления подтверждает мастер.',225:'Средство против отравления. Снятие отравления подтверждает мастер.',226:'Выведение радиации: уменьшение на 25 — стартовая настольная настройка. Счётчик радиации ведёт мастер.',227:'Выведение радиации: уменьшение на 50 — стартовая настольная настройка. Счётчик радиации ведёт мастер.',228:'Временная защита от радиации. Величину и длительность назначает мастер.',229:'Временное сопротивление урону. Величину, срок и побочные эффекты назначает мастер.',230:'Лечение; боевые усиления и зависимость учитывает мастер.',231:'Средство для временного повышения умственных способностей. Эффект назначает мастер.',232:'Средство для временного усиления силы. Эффект назначает мастер.',233:'Сильнодействующий препарат. Эффект и последствия назначает мастер.',302:'Уникальный лекарственный препарат. Применение в сюжете подтверждает мастер.',335:'Препарат для выведения радиации; уменьшение на 25 — настольная настройка. Счётчик радиации ведёт мастер.',343:'Сюжетный препарат. Доступность и влияние на цель подтверждает мастер.',347:'Сюжетный биологический материал. Использование определяет мастер.',444:'Эффект препарата определяет мастер.'}
            s['effect']=effects.get(pid,'Применение препарата и побочные эффекты подтверждает мастер.')
        elif cat=='ammo':
            s['effect']='Количество в инвентаре — отдельные патроны или заряды, не заводские упаковки. Совместимость определяется боеприпасом оружия.'
            if pid in {3,22,32}:s['modifiers']='Бронебойный боеприпас. Изменение защиты цели назначает мастер; автоматического обхода брони нет.'
            elif pid in {16,30}:s['modifiers']='ЭМИ-боеприпас для подходящего оружия; воздействие на цель подтверждает мастер.'
        elif cat=='currency':s['effect']='Батарейки — платёжное средство Радиуса. Номинал и цены обмена определяет мастер.'
        elif cat=='food':s['effect']='Провизия или напиток. Сытость, опьянение, радиационные и лечебные эффекты подтверждает мастер.'
        elif cat=='book':s['effect']='Информационный предмет. Чтение не меняет навыки автоматически; сюжетный эффект подтверждает мастер.'
        elif cat=='quest':s['effect']='Сюжетный или уникальный предмет. Назначение открывается в игре; использование подтверждает мастер.'
        elif cat=='craft':s['effect']='Материал, трофей или запчасть. Рецепт и затраты подтверждает мастер; автоматического превращения в другой предмет нет.'
        else:
            s['effect']='Инструмент для подходящих действий. Бонусы проверки и ограничения определяет мастер.'
            if pid in {47,91,408,409}:s['effect']='Медицинский набор для оказания помощи. Сам по себе не расходуется и не восстанавливает ОЗ без действия и решения мастера.'
        label=LABELS[cat];description=f'{label}: {name}. Предмет Olympus 2207, прототип №{pid}.'
        adapt['note']=' '.join(notes)
        if adapt['estimatedFields'] and not adapt['note']:adapt['note']='Отмеченные параметры назначены для настольной кампании; мастер может изменить их перед выдачей.'
        imageID=art_id(pid,name,cat,old)
        if imageID not in old or not old[imageID].get('image'):raise ValueError('Missing representative art '+imageID)
        provenance={'game':'Olympus 2207','label':'Olympus 2207','url':source['textSource']['url'],'prototype':pid,'nativeName':native_name,'numericSource':source['numericSources']['armor' if cat=='armor' else 'weapons'] if str(pid) in source['armorFacts'] or str(pid) in facts else source['textSource']['url'] if original else None,'statsStatus':'adapted-with-confirmed-source-values' if original else 'campaign-adaptation','art':{'game':'Fallout 2','match':'representative','catalogId':imageID,'note':'Прозрачная иллюстрация-аналоги из Fallout 2; это не извлечённый спрайт Olympus.'}}
        consumable=cat in {'ammo','medicine','food','explosive'} or (cat=='throwing' and pid not in {62,63,213,217,218})
        item={'id':f'olympus-{pid}','olympusPid':pid,'name':name,'category':cat,'categoryLabel':label,'stats':s,'image':old[imageID]['image'],'source':provenance,'description':description,'originalGameStats':original,'adaptation':adapt,'consumable':consumable,'rulesVersion':4,'warnings':[]}
        if adapt['estimatedFields']:
            fieldnames={'damageFormula':'урон','armorClass':'класс брони','apCost':'стоимость ОД','ammo':'боеприпас','healingFormula':'лечение','radiationReduction':'снижение радиации'}
            item['warnings'].append('Настольная адаптация: '+', '.join(fieldnames.get(k,k) for k in adapt['estimatedFields'])+'. Мастер может изменить параметры перед выдачей.')
        result.append(item)
    assert len(result)==len(items)-sum(str(i['id']).startswith('olympus-') for i in items)+385
    assert len({i['id']for i in result})==len(result)
    return result

if __name__=='__main__':
    root=Path(__file__).resolve().parent.parent;target=root/'worker/item-catalog.js';prefix='export const ITEM_CATALOG = ';sep=';\nexport const REWARD_ALIASES = '
    raw,aliases=target.read_text()[len(prefix):].split(sep,1);items=extend_catalog(json.loads(raw),root)
    encoded=json.dumps(items,ensure_ascii=False,separators=(',',':'));target.write_text(prefix+encoded+sep+aliases)
    (root.parent/'niti-storydesk/dist/item-catalog.js').write_text('window.NITI_ITEM_CATALOG = '+encoded+';\n')
    print(json.dumps({'total':len(items),'olympus':sum(i['id'].startswith('olympus-') for i in items),'weapons':sum(i['category']in WEAPONS for i in items),'medicine':sum(i['category']=='medicine'for i in items),'armor':sum(i['category']=='armor' for i in items)},ensure_ascii=False))
