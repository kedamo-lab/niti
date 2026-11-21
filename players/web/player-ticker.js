'use strict';
/* The shared signal is public to the room; only the GM can change its text. */
(function () {
  const SHARED_DEFAULT = ['OLYMPUS 2207','ВОЙНА НИКОГДА НЕ МЕНЯЕТСЯ','ТАРТАР','ТВОЯ ИСТОРИЯ ПРОДОЛЖАЕТСЯ'].join('\n');
  const LOCAL_DEFAULT = ['OLYMPUS 2207','ТВОЙ ПУТЬ · ТВОЙ ВЫБОР','ЛИЧНЫЙ ТЕРМИНАЛ','ИСТОРИЯ ПРОДОЛЖАЕТСЯ'].join('\n');
  const CACHE = 'niti-player-ticker-v1:';
  const escape = value => String(value).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
  function normalize(value) {
    if (typeof value !== 'string' || value.length > 600) return '';
    return value.replace(/\r\n?/g,'\n').split('\n').map(line=>line.trim()).filter(Boolean).join('\n');
  }
  function valid(value) {
    return value && normalize(value.text) && Number.isSafeInteger(value.version) && value.version >= 1;
  }
  function cached(roomId) {
    try {
      const value=JSON.parse(localStorage.getItem(CACHE+roomId));
      return valid(value) ? value : null;
    } catch { return null; }
  }
  function current() {
    const roomId=window.playerSessionRoomId?.() || '';
    if (!roomId) return {roomId:'',text:LOCAL_DEFAULT};
    const room=window.playerSessionSnapshot?.();
    let saved=cached(roomId);
    if (room?.id === roomId) {
      if (valid(room.ticker)) {
        if (!saved || room.ticker.version >= saved.version) {
          saved={text:normalize(room.ticker.text),version:room.ticker.version,updatedAt:room.ticker.updatedAt};
          try { localStorage.setItem(CACHE+roomId,JSON.stringify(saved)); } catch { /* The received room still contains the signal. */ }
        }
        return {roomId,text:saved.text};
      }
      if (room.ticker === null) {
        try { localStorage.removeItem(CACHE+roomId); } catch {}
        return {roomId,text:SHARED_DEFAULT};
      }
    }
    return {roomId,text:saved?.text || SHARED_DEFAULT};
  }
  function markup() {
    const {roomId,text}=current(),phrases=text.split('\n');
    const context=document.createElement('canvas').getContext('2d');
    if (context) context.font='600 29px Oswald';
    const widths=phrases.map(phrase=>context ? context.measureText(phrase).width : [...phrase].length*6);
    const repeats=Math.max(1,Math.ceil(2200/widths.reduce((sum,width)=>sum+width*.7+68,0)));
    const duration=Math.max(38,Math.ceil(widths.reduce((sum,width)=>sum+width+68,0)*repeats/42));
    const content=phrases.map((phrase,index)=>'<span'+(index%2 ? ' class="outline"' : '')+'>'+escape(phrase)+'</span><b aria-hidden="true">◆</b>').join('').repeat(repeats);
    const signature=JSON.stringify([roomId,text]);
    return '<section class="crimson-ticker player-shared-ticker" data-player-ticker data-ticker-signature="'+escape(signature)+'" aria-label="Бегущая строка '+(roomId?'игровой комнаты':'терминала')+'">'+
      '<span class="sr-only">'+escape(phrases.join(' · '))+'</span><div class="crimson-ticker-track" aria-hidden="true" style="--player-ticker-duration:'+duration+'s"><span class="player-ticker-copy">'+content+'</span><span class="player-ticker-copy">'+content+'</span></div></section>';
  }
  function update() {
    const value=current();
    const root=document.querySelector('[data-player-ticker]');
    if (root && root.dataset.tickerSignature !== JSON.stringify([value.roomId,value.text])) root.outerHTML=markup();
  }
  window.playerTickerMarkup=markup;
  window.addEventListener('niti:session-update',update);
  window.addEventListener('storage',event=>{if(event.key?.startsWith(CACHE))update();});
})();
