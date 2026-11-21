'use strict';
/* Private planning and receipt-driven world updates. This file belongs to the
 * GM terminal; the player API projects labels and identifiers explicitly. */
(function () {
  const allowedStages = new Set(['q4:spare-drink','q10:service-badge','q10:ammo-preserved','q14:disk-taken','q14:box-1','q14:box-2','q14:box-3']);
  const copy = value => JSON.parse(JSON.stringify(value));
  const list = value => Array.isArray(value) ? value : [];
  const clean = (value, max = 240) => typeof value === 'string' ? value.trim().slice(0,max) : '';
  const effects = source => ({
    flags:list(source?.flags).map(value=>({id:value.id,value:value.value})),
    secrets:list(source?.secrets).map(value=>({id:value.id,revealed:value.revealed})),
    threads:list(source?.threads).map(value=>({id:value.id,status:value.status})),
    relations:list(source?.relations).map(value=>({id:value.id})),
    nextScenes:list(source?.nextScenes).slice()
  });

  function plans(scene, quest, card) {
    if (!scene || !quest || !card) return [];
    const results=[...list(quest.results),...list(quest.itemEvents).filter(result=>allowedStages.has(scene.id+':'+result.id))];
    return results.flatMap(result=>{
      const defaults=window.gmOutcomeDefaults?.(scene.id,result.id) || {playerLabel:'',effects:{}};
      const label=clean(Object.hasOwn(result,'playerLabel') ? result.playerLabel : defaults.playerLabel);
      if (result.playerSelectable === false || !label) return [];
      const knownAction=list(card.actions).find(action=>action.id===result.actionId);
      const actionId=knownAction ? knownAction.id : 'result:'+result.id;
      const source=Object.hasOwn(result,'effects') ? result.effects : defaults.effects;
      return [{
        id:result.id,label,summary:clean(result.publicText,2000) || label,
        xp:Number(result.xp) || 0,complete:result.completion === true,
        onceKey:result.onceKey,xpScope:scene.rewardConfig && !result.completion ? 'event' : 'mission',
        actionId,effects:effects(source),
        items:list(result.items).map((item,index)=>({
          id:(scene.id+'-'+result.id).slice(0,110)+'-'+index,
          name:item.name,quantity:item.quantity,recipientId:item.recipientId || null,
          ...(item.catalogId ? {catalogId:item.catalogId} : {}),
          ...(Object.hasOwn(item,'stats') ? {stats:copy(item.stats)} : {})
        }))
      }];
    });
  }

  function actions(scene, quest, card, prepared = null) {
    const rows=new Map(list(card?.actions).map(action=>[action.id,{id:action.id,label:action.label}]));
    for (const result of prepared || plans(scene,quest,card)) if (!rows.has(result.actionId)) rows.set(result.actionId,{id:result.actionId,label:result.label});
    return [...rows.values()];
  }

  function apply(story, room) {
    const outcome={changed:false,applied:0,missions:[]};
    if (!story || !room?.id) return outcome;
    const receipts=list(story.outcomeReceipts).filter(receipt=>receipt && typeof receipt.roomId==='string' && typeof receipt.eventId==='string');
    const seen=new Set(receipts.map(receipt=>receipt.roomId+'\u0000'+receipt.eventId));
    const sceneById=id=>list(story.scenes).find(scene=>scene.id===id);
    for (const event of list(room.events)) {
      const resolution=event.resolution;
      const eventId=event.eventId || event.id;
      const scene=sceneById(event.missionId);
      if (!scene || !resolution || resolution.version!==1 || typeof eventId!=='string' || !eventId || seen.has(room.id+'\u0000'+eventId)) continue;
      const session=Number.isInteger(resolution.session) && resolution.session>=1 ? resolution.session : story.session;
      const date=Number.isFinite(event.createdAt) ? new Date(event.createdAt).toISOString() : new Date().toISOString();
      const actor=room.players?.find(player=>player.id===resolution.actorId);
      const source={roomId:room.id,eventId,missionId:event.missionId,createdAt:event.createdAt};
      const record={roomId:room.id,eventId,missionId:event.missionId,session,appliedAt:date};
      const privateEffects=effects(resolution.effects);

      for (const change of privateEffects.flags) {
        const flag=list(story.flags).find(flag=>flag.id===change.id);
        if (flag && ['yes','no','unknown'].includes(change.value)) {flag.value=change.value;flag.resolutionSource=source;}
      }
      for (const change of privateEffects.secrets) {
        const secret=list(story.secrets).find(secret=>secret.id===change.id);
        if (secret && typeof change.revealed==='boolean') {secret.revealed=change.revealed;secret.resolutionSource=source;}
      }
      for (const change of privateEffects.threads) {
        const thread=list(story.threads).find(thread=>thread.id===change.id);
        if (!thread || !['open','later','closed'].includes(change.status)) continue;
        // A newly satisfied condition never reopens an already resolved later
        // scene. Explicit closures still remove a branch that became unavailable.
        const laterScenes=list(thread.sourceScenes).filter(id=>id!==scene.id);
        if (change.status==='open' && laterScenes.length && laterScenes.every(id=>sceneById(id)?.status==='done')) continue;
        thread.status=change.status;thread.resolutionSource=source;
      }
      for (const change of privateEffects.relations) {
        const relation=list(story.relations).find(relation=>relation.id===change.id);
        if (relation) {relation.confirmed=true;relation.resolutionSource=source;}
      }

      // Record the exact declared result, rather than guessing which earlier
      // approach led to it. Unknown surrounding facts remain unknown.
      if (!Array.isArray(story.flags)) story.flags=[];
      const factId='outcome:'+event.missionId+':'+event.resultId;
      const fact={id:factId,title:clean(resolution.label) || clean(event.summary) || scene.title,
        detail:clean(event.summary,2000),source:'Подтверждённый результат сцены «'+scene.title+'»',value:'yes',resolutionSource:source};
      const factIndex=story.flags.findIndex(flag=>flag.id===factId);
      if (factIndex<0) story.flags.push(fact); else Object.assign(story.flags[factIndex],fact);

      if (!Array.isArray(scene.actionOutcomes)) scene.actionOutcomes=[];
      for (const action of list(resolution.actions)) {
        if (typeof action?.id!=='string' || typeof action.label!=='string') continue;
        const previous=scene.actionOutcomes.find(item=>item.actionId===action.id && item.session===session);
        // Keep a master's explicit decision and an already played earlier stage.
        if (previous && (previous.source!=='player-resolution' || previous.outcome==='success' && action.id!==resolution.actionId)) continue;
        const selected=action.id===resolution.actionId;
        const value={actionId:action.id,actionLabel:action.label,outcome:selected?'success':'unplayed',session,date,
          detail:selected?clean(event.summary,12000):'',source:'player-resolution',eventId,roomId:room.id};
        scene.actionOutcomes=scene.actionOutcomes.filter(item=>item.actionId!==action.id || item.session!==session);
        scene.actionOutcomes.push(value);
      }

      for (const id of privateEffects.nextScenes) {
        const next=sceneById(id);
        if (next && next.id!==scene.id && next.status!=='done') next.unlockedBy=source;
      }
      if (event.complete===true) {
        scene.status='done';scene.resolutionSource=source;
        const current=sceneById(story.current);
        // A late response must not drag the GM away from a different active scene.
        if (!current || current.id===scene.id || current.status==='done') {
          const candidates=[...privateEffects.nextScenes,...list(story.dependencies).filter(link=>link.from===scene.id && link.type==='unlock').map(link=>link.to)];
          const next=candidates.map(sceneById).find(value=>value && value.id!==scene.id && value.status!=='done') || list(story.scenes).find(value=>value.id!==scene.id && value.status!=='done');
          story.current=next?.id || null;
          if (next) next.status='active';
        }
      }

      if (!Array.isArray(story.journal)) story.journal=[];
      story.journal.unshift({id:globalThis.crypto?.randomUUID?.() || 'resolution-'+Date.now()+'-'+Math.random().toString(36).slice(2),
        date,session,kind:'Результат игроков',text:'Сцена «'+scene.title+'»: '+(resolution.label || event.summary)+'.'+
          (actor ? '\nПодтвердил: '+actor.name+'.' : '')+(event.summary?'\n'+event.summary:'')+
          (event.xp?'\nВыдано '+event.xp+' XP каждому участнику.':'')+
          (list(event.items).length?'\nПредметы: '+event.items.map(item=>item.name+' × '+item.quantity).join(', ')+'.':'')});
      receipts.push(record);seen.add(room.id+'\u0000'+eventId);
      outcome.changed=true;outcome.applied++;outcome.missions.push(scene.id);
    }
    if (outcome.changed) story.outcomeReceipts=receipts;
    return outcome;
  }

  window.gmSceneResolutionPlans=plans;
  window.gmSceneResolutionActions=actions;
  window.gmApplyResolutionEvents=apply;
})();
