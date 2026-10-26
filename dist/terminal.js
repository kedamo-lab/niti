'use strict';
(()=>{
const root=document.documentElement;
const palette=[
{id:'green',name:'Зелёный',dot:'#a6d876',ink:'#b8d6a4',muted:'#8fa47f',line:'#354d2d',bright:'#d5f5ac',accent:'#d6bc66',tint:'#182b15',card:'#0d1910',paper:'#09110c',dark:'#0a140a'},
{id:'amber',name:'Янтарный',dot:'#e5b85d',ink:'#e3cd99',muted:'#b7a476',line:'#594a2b',bright:'#ffe2a0',accent:'#d1d4a5',tint:'#2c2412',card:'#19170e',paper:'#11110b',dark:'#171309'},
{id:'cyan',name:'Бирюзовый',dot:'#6ed9d1',ink:'#b1ddd7',muted:'#86aaa8',line:'#2f5551',bright:'#d0fff2',accent:'#dfcc83',tint:'#112d2b',card:'#0d1d1b',paper:'#081312',dark:'#071714'},
{id:'blue',name:'Голубой',dot:'#84bdff',ink:'#bdcfe8',muted:'#8da5c0',line:'#324d6b',bright:'#d8eaff',accent:'#d5c98e',tint:'#13263d',card:'#101b2a',paper:'#0a121d',dark:'#081524'},
{id:'violet',name:'Фиолетовый',dot:'#bb9aff',ink:'#d4c9e6',muted:'#ab99c1',line:'#4c3c67',bright:'#ede0ff',accent:'#d4c38b',tint:'#281d3c',card:'#1b1427',paper:'#120d1b',dark:'#170d24'},
{id:'rose',name:'Розовый',dot:'#ec9cc4',ink:'#e3c5d3',muted:'#bd97aa',line:'#643d53',bright:'#ffdeef',accent:'#d8c68c',tint:'#351c2a',card:'#24131c',paper:'#190c13',dark:'#220d19'},
{id:'red',name:'Красный',dot:'#ed9388',ink:'#e2c2ba',muted:'#bd9a91',line:'#674039',bright:'#ffddd4',accent:'#dfca89',tint:'#361f1b',card:'#251512',paper:'#190e0c',dark:'#240d09'},
{id:'orange',name:'Оранжевый',dot:'#f1ad70',ink:'#e5c8ac',muted:'#bca088',line:'#634a32',bright:'#ffe2be',accent:'#d3cf91',tint:'#352615',card:'#251b11',paper:'#19120b',dark:'#231406'},
{id:'mint',name:'Мятный',dot:'#98e8bb',ink:'#c2dfcf',muted:'#95b5a2',line:'#355b46',bright:'#dcffe7',accent:'#e0ce91',tint:'#173025',card:'#101f18',paper:'#0a1510',dark:'#081c10'},
{id:'white',name:'Белый',dot:'#dfdfcd',ink:'#d5d6cb',muted:'#a8ad9e',line:'#4b5447',bright:'#f6f7e9',accent:'#d4c48a',tint:'#242c23',card:'#181e18',paper:'#101510',dark:'#111b11'}
];
const variableKeys={'--paper':'paper','--card':'card','--ink':'ink','--muted':'muted','--line':'line','--green':'dot','--light-green':'tint','--terminal-bright':'bright','--terminal-accent':'accent','--terminal-dark':'dark','--terminal-tint':'tint'};
let phosphor='green',crt=true;try{const stored=localStorage.getItem('niti-display-phosphor');if(palette.some(c=>c.id===stored))phosphor=stored;crt=localStorage.getItem('niti-display-crt')!=='off';}catch{}
const color=document.getElementById('phosphorSwitch'),scan=document.getElementById('crtSwitch');
color.removeAttribute('aria-pressed');color.setAttribute('aria-label','Выбрать цвет экрана');color.setAttribute('aria-haspopup','dialog');color.setAttribute('aria-expanded','false');color.setAttribute('aria-controls','colorPanel');
const panel=document.createElement('div');panel.id='colorPanel';panel.className='palette-popover';panel.hidden=true;panel.setAttribute('role','dialog');panel.setAttribute('aria-label','Цвет экрана');panel.innerHTML='<div class="palette-heading"><span>ЛЮМИНОФОР / 10 ЦВЕТОВ</span><button type="button" class="palette-close" aria-label="Закрыть палитру">×</button></div><p class="palette-caption">Выбери оттенок терминала.</p><div class="palette-grid">'+palette.map(c=>'<button type="button" class="palette-option" data-color="'+c.id+'" aria-pressed="false"><span class="palette-swatch" style="--swatch:'+c.dot+'" aria-hidden="true"></span><span>'+c.name+'</span><span class="palette-selected" aria-hidden="true">✓</span></button>').join('')+'</div><div class="palette-foot">Выбор сохранится в этом браузере.</div>';
color.parentElement.append(panel);
function closePanel(restoreFocus=false){panel.hidden=true;color.setAttribute('aria-expanded','false');if(restoreFocus)color.focus();}
function paint(){const c=palette.find(p=>p.id===phosphor);root.dataset.phosphor=phosphor;root.dataset.crt=crt?'on':'off';for(const[k,v]of Object.entries(variableKeys))root.style.setProperty(k,c[v]);root.style.setProperty('--terminal-glow',c.dot+'27');color.innerHTML='<span class="palette-current-swatch" aria-hidden="true"></span><span>Цвет: '+c.name.toLocaleLowerCase('ru')+'</span><svg class="palette-caret" viewBox="0 0 10 6" fill="none" aria-hidden="true"><path d="m1 1 4 4 4-4" stroke="currentColor"/></svg>';scan.textContent=crt?'ЭЛТ: вкл':'ЭЛТ: выкл';scan.setAttribute('aria-pressed',String(crt));panel.querySelectorAll('[data-color]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.color===phosphor)));document.querySelector('meta[name="theme-color"]').content=c.paper;}
color.addEventListener('click',()=>{if(!panel.hidden){closePanel();return;}panel.hidden=false;color.setAttribute('aria-expanded','true');panel.querySelector('[aria-pressed="true"]').focus();});
panel.addEventListener('click',event=>{if(event.target.closest('.palette-close')){closePanel(true);return;}const option=event.target.closest('[data-color]');if(!option)return;phosphor=option.dataset.color;paint();try{localStorage.setItem('niti-display-phosphor',phosphor);}catch{}closePanel(true);});
scan.addEventListener('click',()=>{crt=!crt;paint();try{localStorage.setItem('niti-display-crt',crt?'on':'off');}catch{}});
document.addEventListener('pointerdown',event=>{if(!panel.hidden&&!panel.contains(event.target)&&!color.contains(event.target))closePanel();});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!panel.hidden){event.preventDefault();event.stopImmediatePropagation();closePanel(true);}if(event.key==='Tab'&&!panel.hidden){const items=[color,...panel.querySelectorAll('button')];if((event.shiftKey&&document.activeElement===color)||(!event.shiftKey&&document.activeElement===items[items.length-1]))closePanel();}},true);
paint();
})();
