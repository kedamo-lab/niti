'use strict';

// Session recaps belong to the master's local story and its backup only.
// Reading the room snapshot here never publishes a card, result, or recap.
const GM_RECAP = (() => {
  const list = value => Array.isArray(value) ? value : [];
  const text = value => typeof value === 'string' ? value.trim() : '';
  const title = value => text(value?.title) || text(value?.name) || text(value?.id);
  const clone = value => JSON.parse(JSON.stringify(value));
  const catalog = () => list(window.NITI_SESSION_CATALOG?.quests);
  const missionTitle = (id, story) => title(list(story.scenes).find(item => item.id === id)) || catalog().find(item => item.id === id)?.public?.title || id || 'Миссия';
  const resultKey = result => result.eventId || [result.missionId, result.resultId, result.summary].join(':');

  function recordedOutcome(record, definition) {
    // Only explicit outcomes establish success/failure. A scene's status, an
    // absent award, or a flag marked "no" does not establish a failed mission.
    for (const source of [record, definition]) {
      if (!source) continue;
      if (source.success === false || source.failed === true) return 'negative';
      if (source.success === true) return 'positive';
      const value = text(source.outcome || source.status).toLowerCase();
      if (['failure', 'failed', 'negative', 'defeat', 'провал', 'неудача'].includes(value)) return 'negative';
      if (['success', 'succeeded', 'positive', 'victory', 'успех'].includes(value)) return 'positive';
    }
    const id = text(record.resultId).toLowerCase();
    if (/(^|[-_:])(failed|failure|defeat|lost|death|killed)([-_:]|$)/.test(id)) return 'negative';
    if (record.complete === true || definition?.completion === true) return 'positive';
    return 'recorded';
  }

  function roomResults(room, story) {
    if (!room) return [];
    const records = [];
    const append = record => {
      if (!record || typeof record !== 'object' || !text(record.missionId)) return;
      const q = catalog().find(item => item.id === record.missionId);
      const definition = [...list(q?.results), ...list(q?.itemEvents)].find(item => item.id === record.resultId);
      const item = {
        missionId: text(record.missionId), resultId: text(record.resultId), eventId: text(record.eventId || record.id),
        missionTitle: missionTitle(record.missionId, story),
        summary: text(record.summary) || text(record.publicText) || text(record.label) || text(definition?.publicText) || text(definition?.label),
        label: text(definition?.label) || text(record.label),
        complete: record.complete === true || definition?.completion === true,
        xp: Number(record.xp) || 0, createdAt: record.createdAt || record.date || null,
        outcome: recordedOutcome(record, definition)
      };
      // A completion marker without a recorded result proves completion only.
      if (!item.summary) item.summary = item.complete ? 'Завершение подтверждено; подробный исход не записан.' : 'Событие записано; подробности отсутствуют.';
      const prior = records.findIndex(value => (item.eventId && value.eventId === item.eventId) || (value.missionId === item.missionId && value.resultId === item.resultId));
      if (prior === -1) records.push(item);
    };
    list(room.events).forEach(append);
    if (Array.isArray(room.results)) room.results.forEach(append);
    else if (room.results && typeof room.results === 'object') Object.entries(room.results).forEach(([missionId, record]) => append({...record, missionId: record?.missionId || missionId}));
    append(room.result);
    if (room.completedMissions && typeof room.completedMissions === 'object') {
      Object.entries(room.completedMissions).forEach(([missionId, record]) => append({...record, missionId, complete: true}));
    }
    return records;
  }

  function snapshot(story, room) {
    const journal = list(story.journal).filter(item => (item.session || 1) === story.session && item.kind !== 'Итоги сессии');
    const actionOutcomes = list(story.scenes).flatMap(scene => list(scene.actionOutcomes)
      .filter(item => item && ['success', 'failure', 'unplayed'].includes(item.outcome))
      .map(item => ({missionId: scene.id, missionTitle: title(scene), actionId: text(item.actionId), actionLabel: text(item.actionLabel), outcome: item.outcome, session: item.session, date: text(item.date), detail: text(item.detail)})));
    const results = roomResults(room, story);
    const previous = list(story.journal).find(item => item.kind === 'Итоги сессии' && (item.session || 1) < story.session);
    const sameRoom = previous?.recap?.room?.id === room?.id;
    const previousKeys = new Set(sameRoom ? list(previous?.recap?.room?.resultKeys) : []);
    const previousDate = previous ? Date.parse(previous.date) : NaN;
    const sessionResults = results.filter(item => {
      if (sameRoom) return !previousKeys.has(resultKey(item));
      const at = typeof item.createdAt === 'number' ? item.createdAt : Date.parse(item.createdAt);
      return !Number.isFinite(previousDate) || !Number.isFinite(at) || at > previousDate;
    });
    return {
      version: 1, generatedAt: new Date().toISOString(), session: story.session, current: story.current,
      flags: list(story.flags).map(item => ({id: item.id, title: item.title, value: item.value})),
      secrets: list(story.secrets).map(item => ({id: item.id, title: item.title, revealed: item.revealed})),
      threads: list(story.threads).map(item => ({id: item.id, title: item.title, status: item.status})),
      scenes: list(story.scenes).map(item => ({id: item.id, title: item.title, status: item.status, issuedXP: Number(item.issuedXP) || 0})),
      actionOutcomes,
      currentSessionActionOutcomes: actionOutcomes.filter(item => item.session === story.session),
      journal: journal.map(item => ({id: item.id, date: item.date, kind: item.kind, text: item.text})),
      room: room ? {id: room.id, revision: room.revision, missionId: room.mission?.id || null, completedMissions: clone(room.completedMissions || {}), resultKeys: results.map(resultKey), results, sessionResults} : null
    };
  }

  function drafts(recap, nextStart) {
    const changed = [], open = [], next = [];
    const section = (target, heading, values) => { if (values.length) target.push(heading + '\n' + values.map(value => '• ' + value).join('\n')); };
    section(changed, 'Факты — подтверждено «да»:', recap.flags.filter(item => item.value === 'yes').map(item => item.title + ' — да.'));
    section(changed, 'Факты — зафиксировано «нет»:', recap.flags.filter(item => item.value === 'no').map(item => item.title + ' — нет.'));
    section(open, 'Факты — исход не определён:', recap.flags.filter(item => !['yes', 'no'].includes(item.value)).map(item => item.title));
    section(changed, 'Раскрытые тайны:', recap.secrets.filter(item => item.revealed).map(item => item.title));
    section(open, 'Тайны за ширмой:', recap.secrets.filter(item => !item.revealed).map(item => item.title));
    section(changed, 'Закрытые сюжетные нити:', recap.threads.filter(item => item.status === 'closed').map(item => item.title));
    section(open, 'Открытые сюжетные нити:', recap.threads.filter(item => item.status === 'open').map(item => item.title));
    section(open, 'Сюжетные нити на потом:', recap.threads.filter(item => item.status === 'later').map(item => item.title));
    section(changed, 'Завершённые сцены (отметка ведущего; сама по себе не задаёт успех или провал):', recap.scenes.filter(item => item.status === 'done').map(item => item.title));
    const activeScenes = recap.scenes.filter(item => item.id === recap.current || item.status === 'active');
    section(open, 'Текущая сцена:', activeScenes.map(item => item.title));
    section(open, 'Не пройдено / нет отметки завершения (это не провал):', recap.scenes.filter(item => item.status !== 'done' && item.id !== recap.current && item.status !== 'active').map(item => item.title));
    const actionLine = item => `${item.missionTitle}: ${item.actionLabel || item.actionId}${item.detail ? ' — ' + item.detail : ''}`;
    const actions = list(recap.currentSessionActionOutcomes);
    section(changed, 'Успешные действия этой сессии (исход ветки):', actions.filter(item => item.outcome === 'success').map(actionLine));
    section(changed, 'Проваленные действия этой сессии (провал ветки не означает провал задания):', actions.filter(item => item.outcome === 'failure').map(actionLine));
    section(open, 'Действия, отмеченные «не проходили» в этой сессии:', actions.filter(item => item.outcome === 'unplayed').map(actionLine));
    const resultLine = item => `${item.missionTitle}: ${item.summary}${item.label && item.label !== item.summary ? ' (' + item.label + ')' : ''}${item.xp ? ' +' + item.xp + ' XP каждому.' : ''}`;
    const results = recap.room?.sessionResults || [];
    section(changed, 'Подтверждённые положительные результаты / выполненные цели комнаты:', results.filter(item => item.outcome === 'positive').map(resultLine));
    section(changed, 'Подтверждённые отрицательные исходы комнаты:', results.filter(item => item.outcome === 'negative').map(resultLine));
    section(changed, 'Прочие записанные события комнаты:', results.filter(item => item.outcome === 'recorded').map(resultLine));
    if (recap.room) {
      const completed = Object.keys(recap.room.completedMissions).map(id => recap.scenes.find(item => item.id === id)?.title || recap.room.results.find(item => item.missionId === id)?.missionTitle || id);
      section(changed, 'Выполненные миссии комнаты к этому моменту:', completed);
      if (!results.length) changed.push('Новых подтверждённых результатов комнаты за эту сессию нет.');
    }
    section(changed, 'Журнал этой сессии:', recap.journal.slice().reverse().map(item => `[${item.kind}] ${item.text}`));
    if (!changed.length) changed.push('Изменения и результаты пока не записаны. Допиши состоявшиеся события.');
    if (!open.length) open.push('Открытых вопросов в записях нет.');
    if (text(nextStart)) next.push('Ранее намечено:\n' + text(nextStart));
    section(next, 'Продолжить текущую сцену:', activeScenes.map(item => item.title));
    section(next, 'Вернуться к открытым нитям:', recap.threads.filter(item => item.status === 'open').map(item => item.title));
    if (!next.length) {
      const ready = recap.scenes.find(item => item.status !== 'done');
      next.push(ready ? 'Следующая подготовленная сцена (уточни перед игрой): ' + ready.title : 'Определить следующий шаг вместе с героями.');
    }
    return {changed: changed.join('\n\n'), open: open.join('\n\n'), next: next.join('\n\n')};
  }

  function open() {
    const story = state;
    const session = story.session;
    const room = typeof window.gmSessionSnapshot === 'function' ? window.gmSessionSnapshot() : null;
    const recap = snapshot(story, room);
    const draft = drafts(recap, story.nextStart);
    let submitted = false;
    modal('Итоги сессии · ' + session,
      '<p class="muted">Черновик собран из отметок ведущего и записанных событий. Уточни формулировки перед сохранением. Итог и снимок остаются в журнале мастера.</p>' +
      field('changed', 'Что изменилось', draft.changed, 'textarea', true) +
      field('open', 'Что осталось открытым', draft.open, 'textarea') +
      field('next', 'С чего начнём в следующий раз', draft.next, 'textarea', true), form => {
        if (submitted || state !== story || state.session !== session) return;
        const changed = text(form.get('changed')), next = text(form.get('next')), unresolved = text(form.get('open'));
        if (!changed || !next) { toast('Запиши итог и начало следующей сессии.'); return; }
        submitted = true;
        record('Что изменилось:\n' + changed + '\n\nОсталось открытым:\n' + unresolved + '\n\nВ следующий раз:\n' + next, 'Итоги сессии');
        // Extra metadata is optional: old v1 backups and the existing reader
        // continue to use the journal entry's text/kind/date/session fields.
        state.journal[0].recap = {...recap, confirmedAt: new Date().toISOString(), edited: {changed, open: unresolved, next}};
        state.nextStart = next;
        state.session = session + 1;
        save(); closeModal(); render();
        toast('Сессия завершена. Итог сохранён в журнале мастера.');
      }, btn('Отмена', 'close-modal', 'ghost') + '<button class="button primary" type="submit">Завершить и сохранить итог</button>', true);
  }
  return {open, snapshot, drafts};
})();

function gmEndSession() { GM_RECAP.open(); }
