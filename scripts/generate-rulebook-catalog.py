from pathlib import Path
from zipfile import ZipFile
from lxml import etree as E
import json,base64,re,hashlib,copy
from fallout2_catalog import extend_catalog
root=Path(__file__).resolve().parent.parent;gm=Path('/workspace/sites/niti-storydesk/dist')
current=(root/'worker/item-catalog.js').read_text();prefix='export const ITEM_CATALOG = ';sep=';\nexport const REWARD_ALIASES = '
raw,aliases=current[len(prefix):].split(sep,1)
basepath=root/'rulebook-catalog-base.json'
if not basepath.exists():basepath.write_text(json.dumps(json.loads(raw),ensure_ascii=False,indent=2))
items=json.loads(basepath.read_text());byname=lambda n:re.sub('[^а-яa-z0-9]','',n.casefold().replace('ё','е'))
index={byname(i['name']):i for i in items};source_items=[];recipes=[]
book=Path('/tmp/codex-remote-attachments/01a174ee-78cf-72a3-ab5e-aa4a93e0b040/659E2D87-0A68-47D1-8E74-BDE36EC20CC3/1-Правила-игры.docx')
ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main','a':'http://schemas.openxmlformats.org/drawingml/2006/main','r':'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}
weaponcats={'melee','unarmed','light','heavy','energy','throwing','explosive'}
def weapon_rules(i):
 if i['category'] not in weaponcats:return
 n=i['name'].casefold();s=i['stats']
 if 'импульсная граната' in n:s['damageType']='ЭМИ'
 elif 'плазм' in n:s['damageType']='Плазма'
 elif 'огнем' in n or 'огнём' in n or 'молотов' in n or 'фонарик' in n:s['damageType']='Огонь'
 elif 'лазер' in n:s['damageType']='Лазер'
 elif 'импульс' in n or 'бластер пришельцев' in n or 'электрокнут' in n:s['damageType']='Электро'
 elif 'горчичн' in n:s['damageType']='Яд'
 elif 'дымов' in n or 'светозвуков' in n:s['damageType']='Без прямого урона'
 elif i['category']=='explosive' or 'осколоч' in n or 'гранатом' in n:s['damageType']='Взрыв'
 else:s['damageType']='Норма'
 if s.get('ammo'):
  s['reloadAp']=2
  if s.get('modifiers'):s['modifiers']=re.sub(r'Особенность\s*перезарядка\s*1\s*од','Перезарядка: 2 ОД',s['modifiers'],flags=re.I)
 if i['category'] not in {'melee','unarmed'}:
  bonus=re.search(r'дальность\s*\+\s*(\d+)',str(s.get('modifiers')or''),re.I)
  s['rangeBonus']=int(bonus.group(1))if bonus else 0
  s['rangeFormula']='perception';s['range']='Восприятие персонажа'+(' + '+str(s['rangeBonus'])if s['rangeBonus']else'')
 i['rulesVersion']=2
for i in items:weapon_rules(i)
with ZipFile(book)as z:
 tree=E.fromstring(z.read('word/document.xml'));rels=E.fromstring(z.read('word/_rels/document.xml.rels'));relmap={x.attrib['Id']:x.attrib['Target']for x in rels}
 tables=tree.findall('.//w:body/w:tbl',ns)
 def txt(c):return ''.join(c.xpath('.//w:t/text()',namespaces=ns)).replace('\xa0',' ').strip()
 def cells(row):return row.findall('./w:tc',ns)
 def image(row):
  ids=row.xpath('.//a:blip/@r:embed',namespaces=ns)
  if not ids:return None
  target=relmap.get(ids[0],'');name='word/'+target
  if name not in z.namelist():return None
  mime='image/png' if name.lower().endswith('.png')else'image/jpeg'
  return 'data:'+mime+';base64,'+base64.b64encode(z.read(name)).decode()
 def add(name,description,effect,category,consumable,craftable,table,row,img=None):
  name=' '.join(name.split());key=byname(name);found=index.get(key)
  if found is None:
   found={'id':'book-'+hashlib.sha1(name.encode()).hexdigest()[:12],'name':name,'category':category,'categoryLabel':{'medicine':'Медикаменты','tool':'Снаряжение','craft':'Крафтовый лут','food':'Провизия','throwing':'Метательное оружие'}.get(category,'Предмет'),'stats':{'damage':None,'apCost':2 if category=='medicine'and consumable else None,'ammo':None,'magazine':None,'minStrength':None,'range':None,'damageType':None,'modifiers':None,'armorClass':None,'resistances':None,'weight':None,'price':None,'reloadAp':None,'slots':None,'damageFormula':None},'image':img,'source':{'label':'Правила игры','table':table+1,'row':row},'warnings':[],'consumable':consumable}
   items.append(found);index[key]=found
  elif img and not found.get('image'):found['image']=img
  found['description']=description;found['craftable']=craftable;found['rulesVersion']=2
  if effect:found['stats']['effect']=effect
  if craftable is not None:found['stats']['effect']='\n'.join(filter(None,[found['stats'].get('effect'),'Крафт: '+('доступен по книге правил.'if craftable else'в таблице не предусмотрен.')]))
  if '3%'in effect and re.search(r'1[-–]3',effect):found['warnings'].append('В книге одновременно указаны «3%» и «1к20: 1–3». Вероятность поломки применяет мастер; автоматически она не выбирается.')
  source_items.append({'id':found['id'],'name':name,'description':description,'effect':effect,'category':found['category'],'consumable':consumable,'craftable':craftable,'table':table+1,'row':row})
  weapon_rules(found)
  return found
 names=['Суперстимулятор','Баффаут','Комплект инъекций (пустой)','Ментат','Психо','Противоядие','Инъектор','Гиппо','Адреналин','Полевой суперстимулятор','Винт','Антирадин','Рад-X','Стимулятор','Целебный порошок','Постамент']
 for rownum,row in enumerate(tables[0].findall('./w:tr',ns)):
  cs=cells(row);body=txt(cs[1]);name=names[rownum];assert byname(body).startswith(byname(name)),(name,body[:80]);description=body[len(name):].strip() if body.startswith(name)else body
  add(name,description,txt(cs[2]),'tool'if rownum==2 else'medicine',rownum!=2,None,0,rownum,image(row))
 for ti in [1,2]:
  rows=tables[ti].findall('./w:tr',ns)
  for ri in range(0,len(rows),4):
   cs=cells(rows[ri]);name=txt(cs[-1]);description=txt(cells(rows[ri+1])[-1]);effect=txt(cells(rows[ri+2])[-1]);craftable='✔'in txt(cells(rows[ri+3])[-1])
   category='throwing'if'граната'in name.casefold()or'молотов' in name.casefold()else'tool'
   consume=bool(re.search(r'гранат|молотов|сигарет',name,re.I))
   add(name,description,effect,category,consume,craftable,ti,ri,image(rows[ri]))
 for ri,row in enumerate(tables[3].findall('./w:tr',ns)[1:],1):
  cs=cells(row);ts=[txt(c)for c in cs]
  if len(ts)!=5 or ts[1]!='+'or ts[3]!='='or not ts[0]or not ts[2]or not ts[4]:continue
  recipe={'ingredients':[ts[0],ts[2]],'result':ts[4],'source':{'label':'Правила игры','table':4,'row':ri}};recipes.append(recipe)
  for name in [ts[0],ts[2],ts[4]]:
   if byname(name)not in index:add(name,'Материал или результат из раздела «Микро рецепты».','Эффекты вне рецептов в книге не указаны.','craft',False,None,3,ri)
 for i in items:
  related=[r for r in recipes if byname(r['result'])==byname(i['name'])]
  if related:
   i['craftRecipes']=[{'ingredients':r['ingredients'],'result':r['result']}for r in related]
   i['craftable']=True
   i['stats']['effect']='\n'.join(filter(None,[i['stats'].get('effect'),'\n'.join(' + '.join(r['ingredients'])+' → '+r['result']for r in related)]))
from equipment_art import apply_equipment_art
items=apply_equipment_art(extend_catalog(items,root),root)
for i in items:
 if i['category'] in weaponcats:assert i['stats'].get('damageType')
 if i['category'] in weaponcats and i['stats'].get('ammo'):assert i['stats']['reloadAp']==2
source={'document':'Правила игры.docx','sha256':hashlib.sha256(book.read_bytes()).hexdigest(),'medicineCount':16,'equipmentCount':34,'items':source_items,'recipes':recipes,'weaponOverrides':{'reloadAp':2,'rangedDistance':'perception + explicit range bonus','damageTypes':'Fallout / weapon function; physical, fire, laser, plasma, electricity, explosion, EMP'},'aliasesConfirmed':{'Алюминиевый кастет':'Кастет: 2д6 / 3 ОД'}}
(root/'rulebook-items-source.json').write_text(json.dumps(source,ensure_ascii=False,indent=2))
(root/'worker/item-catalog.js').write_text(prefix+json.dumps(items,ensure_ascii=False,separators=(',',':'))+sep+aliases)
(gm/'item-catalog.js').write_text('window.NITI_ITEM_CATALOG = '+json.dumps(items,ensure_ascii=False,separators=(',',':'))+';\n')
print(json.dumps({'catalog':len(items),'medicine':16,'equipment':34,'recipes':len(recipes),'newCatalogItems':len(items)-94,'maxEffectLength':max(len(i['stats'].get('effect')or'')for i in items)},ensure_ascii=False))
