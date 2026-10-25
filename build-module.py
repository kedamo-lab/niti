"""Build the private Tartar campaign without altering its source text."""
import json,re,hashlib
from pathlib import Path
root=Path(__file__).resolve().parent
text=(root/'module-source.txt').read_text()
people=json.loads((root/'module-people.json').read_text())
logic=json.loads((root/'module-logic.json').read_text())
heads=list(re.finditer(r'(?m)^(\d{1,2}) (.+)$',text))
assert len(heads)==14
scenes=[]
public_places=['Семейная комната','Жилой сектор','Комната семьи Кэтти','Переход на фермы','Техуровень','Фермы','Водоочиститель','Склад техуровня и фермы','Грядки ферм','Западная стена старой парковки','Западный пост','Западный пост','Чистилище','Ответвление перед лестницей']
for i,m in enumerate(heads):
    n=int(m[1]);qid=f'q{n}';meta=logic['questMeta'][qid]
    body=text[m.end():heads[i+1].start() if i+1<len(heads) else text.index('\nБОЕВЫЕ ПРОФИЛИ')].strip()
    for title in ['ДЕТСТВО','РАБОЧИЕ ЗАДАНИЯ','ПОДСТАВА И ПОБЕГ']:
        body=re.sub(r'\n\n'+title+r'\s*$','',body).strip()
    paragraphs=body.split('\n\n');checks=[];extras=[]
    for para in paragraphs:
        lines=para.splitlines();top=lines[0]
        is_check=bool(re.match(r'^(Вариант(?: / этап)?|Этап(?: / вариант)?|Сборка / сдача|Предмет):',top)) and any(re.match(r'^(Бросок и порог|Получение / бросок):',x) for x in lines[1:])
        if not is_check:
            if not top.startswith(('Кто / где:','Где:','Завершение / опыт:','Опыт:')):extras.append(para)
            continue
        fields={k.strip():v.strip() for line in lines[1:] if ': ' in line for k,v in [line.split(': ',1)]}
        success=fields.get('Успех','')
        failure=fields.get('Провал',fields.get('Если не получилось',''))
        if qid=='q7' and 'Кронштейн через угрозу' in top:
            success='Отдаёт кронштейн.';failure='Зовёт взрослого. Дальше обмен либо замена у Кэрол.'
        if top.startswith('Предмет:') and not success:success='Деталь получена указанным способом.'
        checks.append({'id':f'{qid}-check-{len(checks)+1}','title':top.split(': ',1)[1],'check':fields.get('Бросок и порог',fields.get('Получение / бросок','')),'success':success,'failure':failure or '—','detail':fields.get('Где взять',''),'raw':para})
    completion=next((p for p in reversed(paragraphs) if p.startswith(('Завершение / опыт:','Опыт:'))),'')
    scenes.append({'id':qid,'number':n,'title':m[2],'place':meta['place'],'playerPlace':public_places[i],'playerTitle':meta['publicTitle'],'goal':meta['goal'],'hook':meta['hook']+'.' if meta['hook'][-1] not in '.!?…' else meta['hook'],'notes':body,'status':'active' if n==1 else 'ready','xp':meta['xp'],'issuedXP':0,'act':meta['act'],'checks':checks,'extras':extras,'completion':completion,'source':f'Задание {n}'})
threads=[]
for i,d in enumerate(logic['dependencies']):
    threads.append({'id':f't-dep-{i+1}','title':d['label'],'detail':f"Задание {d['from'][1:]} → {d['to'][1:]}\n{d['detail']}",'status':'later','sourceScenes':[d['from'],d['to']]})
# The outcomes are prepared but not asserted to have happened.
state={'version':1,'moduleId':'olympus2207-tartar','moduleRevision':1,'sourceHash':hashlib.sha256(text.encode()).hexdigest(),'title':'Olympus 2207 — Тартар','demo':False,'session':1,'current':'q1','scenes':scenes,**people,'clocks':logic['clocks'],'threads':threads,'dependencies':logic['dependencies'],'flags':logic['flags'],'rules':logic['rules'],'audit':logic['audit'],'journal':[],'manuscript':text,'nextStart':''}
assert sum(s['xp'] for s in scenes)==600
assert len(set(c['id'] for c in state['characters']))==len(state['characters'])
assert all(r['from'] in {c['id'] for c in state['characters']} and r['to'] in {c['id'] for c in state['characters']} for r in state['relations'])
for name in ['secrets','clocks','flags']:assert all(not x.get('revealed',False) and not x.get('active',False) for x in state[name])
(root/'dist/module-data.js').write_text('window.NITI_MODULE = '+json.dumps(state,ensure_ascii=False,indent=2)+';\n')
(root/'dist/tartar-ready.json').write_text(json.dumps(state,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:len(state[k]) for k in ['scenes','characters','relations','secrets','clocks','threads','flags','dependencies']},ensure_ascii=False))
print('Checks:',sum(len(s['checks']) for s in scenes),'XP:',sum(s['xp'] for s in scenes))
