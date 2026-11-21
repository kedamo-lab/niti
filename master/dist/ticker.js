'use strict';
/* The campaign keeps a local copy; a linked room shares the master's text. */
(function () {
  const MAX_TEXT = 600;
  const DEFAULT_TEXT = ['OLYMPUS 2207','ВОЙНА НИКОГДА НЕ МЕНЯЕТСЯ','ТАРТАР','ТВОЯ ИСТОРИЯ ПРОДОЛЖАЕТСЯ'].join('\n');
  const escape = value => String(value).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
  const campaign = () => typeof state !== 'undefined' && state && typeof state === 'object' ? state : null;
  const normalize = value => String(value).replace(/\r\n?/g,'\n').split('\n').map(line => line.trim()).filter(Boolean).join('\n');
  function currentText() {
    const text = campaign()?.tickerText;
    return typeof text === 'string' && text.length <= MAX_TEXT && normalize(text) ? normalize(text) : DEFAULT_TEXT;
  }
  const pencil = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 4 5 5M4 20l5-1L21 7a2.1 2.1 0 0 0-5-3L4 16v4Z"/></svg>';

  function markup() {
    const phrases = currentText().split('\n');
    const context = document.createElement('canvas').getContext('2d');
    if (context) context.font = '600 29px Oswald';
    const widths = phrases.map(phrase => context ? context.measureText(phrase).width : [...phrase].length*6);
    // A single short phrase must fill even the widest terminal. Underestimate
    // glyph widths slightly while fonts load, and keep both copies identical.
    const repeats = Math.max(1,Math.ceil(2200 / widths.reduce((sum,width) => sum+width*.7+68,0)));
    const duration = Math.max(38,Math.ceil(widths.reduce((sum,width) => sum+width+68,0)*repeats/42));
    const content = phrases.map((phrase,index) => '<span'+(index%2 ? ' class="outline"' : '')+'>'+escape(phrase)+'</span><b aria-hidden="true">◆</b>').join('').repeat(repeats);
    const sync=window.gmSessionTickerStatus?.() || {state:'local',message:''};
    return '<section class="gm-ticker-bar" aria-label="Бегущая строка мастера">'+
      '<span class="sr-only">'+escape(phrases.join(' · '))+'</span>'+
      '<div class="crimson-ticker gm-ticker" aria-hidden="true"><div class="crimson-ticker-track" style="--gm-ticker-duration:'+duration+'s"><span class="gm-ticker-copy">'+content+'</span><span class="gm-ticker-copy">'+content+'</span></div></div>'+
      '<button type="button" class="button ghost small gm-ticker-edit" data-gm-ticker-action="edit" aria-label="Изменить бегущую строку">'+pencil+'<span class="gm-ticker-edit-wide">Изменить строку</span><span class="gm-ticker-edit-small">Изменить</span></button><p class="gm-ticker-status" data-gm-ticker-status role="status">'+escape(sync.message || '')+'</p></section>';
  }

  function refresh() {
    const bar=document.querySelector('.gm-ticker-bar');
    if (!bar) return;
    const text=currentText().split('\n').join(' · '),status=window.gmSessionTickerStatus?.()?.message || '';
    if (bar.querySelector('.sr-only')?.textContent===text && bar.querySelector('[data-gm-ticker-status]')?.textContent===status) return;
    const focused=bar.contains(document.activeElement) && document.activeElement?.matches('[data-gm-ticker-action="edit"]');
    bar.outerHTML=markup();
    if (focused) document.querySelector('[data-gm-ticker-action="edit"]')?.focus({preventScroll:true});
  }

  function feedback(message) {
    const node = document.querySelector('[data-gm-ticker-error]');
    if (node) node.textContent = message;
  }
  function updateCount() {
    const input = document.getElementById('gmTickerText');
    const count = document.querySelector('[data-gm-ticker-count]');
    if (input && count) count.textContent = input.value.length+' / '+MAX_TEXT;
  }
  function open() {
    const target = campaign();
    const openedRoom=window.gmSessionRoomId?.() || '',openedVersion=window.gmSessionTickerVersion?.() || 0;
    if (!target || typeof modal !== 'function') return;
    const body = '<p class="gm-ticker-intro">Твои слова в эфире. Каждая новая строка — отдельная фраза.</p>'+
      '<label class="field-label" for="gmTickerText">ТЕКСТ БЕГУЩЕЙ СТРОКИ</label>'+
      '<textarea class="textarea gm-ticker-input" id="gmTickerText" name="tickerText" rows="5" maxlength="600" required spellcheck="true">'+escape(currentText())+'</textarea>'+
      '<div class="gm-ticker-editor-tools"><button type="button" class="text-button" data-gm-ticker-action="reset">Вернуть стандартный текст</button><span data-gm-ticker-count>'+currentText().length+' / '+MAX_TEXT+'</span></div>'+
      '<p class="gm-ticker-help">После сохранения текст появится у мастера и у всех игроков общей комнаты. Копия также сохраняется с историей и в резервной копии.</p><p class="gm-ticker-error" data-gm-ticker-error role="alert"></p>';
    modal('Бегущая строка',body, form => {
      if (campaign() !== target) { feedback('История изменилась. Закрой окно и открой настройки строки снова.'); return; }
      if (openedRoom && openedRoom!==window.gmSessionRoomId?.()) {feedback('Игровая комната изменилась. Закрой окно и открой настройки строки снова.');return;}
      if (openedRoom && openedVersion!==(window.gmSessionTickerVersion?.() || 0)) {feedback('Общая строка изменилась, пока редактор был открыт. Закрой окно и открой его снова перед сохранением.');return;}
      const raw = String(form.get('tickerText') || '');
      const value = normalize(raw);
      if (!value) { feedback('Добавь хотя бы одну фразу или верни стандартный текст.'); return; }
      if (raw.length > MAX_TEXT) { feedback('В бегущей строке может быть до 600 символов.'); return; }
      target.tickerText = value;
      if (typeof save === 'function') save();
      const result=window.gmSessionSetTicker?.(value,openedVersion);
      closeModal();
      refresh();
      if (typeof toast === 'function') toast(typeof storageOK !== 'undefined' && !storageOK ? 'Строка изменена. Чтобы сохранить её, скачай резервную копию истории.' : result?.queued ? 'Текст сохранён. Передаём общую строку игрокам.' : 'Бегущая строка обновлена.');
    },'<button class="button ghost" type="button" data-action="close-modal">Отмена</button><button class="button primary" type="submit">Сохранить строку</button>');
  }
  document.addEventListener('click',event => {
    const control = event.target.closest('[data-gm-ticker-action]');
    if (!control || control.disabled) return;
    if (control.dataset.gmTickerAction === 'edit') open();
    if (control.dataset.gmTickerAction === 'reset') {
      const input = document.getElementById('gmTickerText');
      if (input) { input.value = DEFAULT_TEXT; feedback(''); updateCount(); input.focus(); }
    }
  });
  document.addEventListener('input',event => {
    if (event.target.id === 'gmTickerText') { feedback(''); updateCount(); }
  });
  window.gmTickerMarkup = markup;
  window.gmTickerCurrentText = currentText;
  window.gmTickerRefresh = refresh;
})();
