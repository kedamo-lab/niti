'use strict';
/* GM-only implications of explicitly confirmed outcomes from the Tartar module.
 * Public labels describe what the group has already done. They never include
 * checks, XP, future rewards, secret text, source notes or later story events.
 *
 * Existing public approach cards are not final results: returning a key cannot
 * tell us whether the group searched, asked or stole. The sync layer creates an
 * exact result action row instead of guessing that approach.
 *
 * Only warranted module flags change. In particular: treatment does not prove
 * a medical debt or radiation diagnosis; repairing a device does not prove help
 * from Carol; delivery does not prove workers helped; equivalent medical aid
 * does not prove Pat witnessed it. These ancillary facts stay under GM control.
 *
 * Thread closure resolves an incoming plot question when its target is done.
 * The applier must guard opening a thread whose target has already completed.
 * nextScenes are guaranteed unlocks only, never automatic completions/rewards.
 * Relations identify existing confirmed ties; they never fabricate NPC links.
 * Every returned object is a fresh copy, so GM edits cannot mutate defaults.
 */
(function () {
  const defaults = {
  "q1:returned": {
    "playerLabel": "Мы вернули ключ отцу",
    "effects": {
      "flags": [
        {
          "id": "father-key-returned",
          "value": "yes"
        }
      ],
      "secrets": [
        {
          "id": "secret-key",
          "revealed": true
        }
      ],
      "threads": [],
      "relations": [
        {
          "id": "r1"
        },
        {
          "id": "r5"
        }
      ],
      "nextScenes": []
    }
  },
  "q1:remembered": {
    "playerLabel": "Отец вспомнил, кому отдал ключ",
    "effects": {
      "flags": [
        {
          "id": "father-key-returned",
          "value": "no"
        }
      ],
      "secrets": [
        {
          "id": "secret-key",
          "revealed": true
        }
      ],
      "threads": [],
      "relations": [
        {
          "id": "r1"
        }
      ],
      "nextScenes": []
    }
  },
  "q1:key-found": {
    "playerLabel": "Мы получили ключ и пока не вернули его",
    "effects": {
      "flags": [],
      "secrets": [
        {
          "id": "secret-key",
          "revealed": true
        }
      ],
      "threads": [
        {
          "id": "t-dep-1",
          "status": "open"
        },
        {
          "id": "t-dep-2",
          "status": "open"
        },
        {
          "id": "t-dep-3",
          "status": "open"
        }
      ],
      "relations": [
        {
          "id": "r1"
        },
        {
          "id": "r5"
        }
      ],
      "nextScenes": []
    }
  },
  "q1:key-returned": {
    "playerLabel": "Мы передали найденный ключ отцу",
    "effects": {
      "flags": [
        {
          "id": "father-key-returned",
          "value": "yes"
        }
      ],
      "secrets": [
        {
          "id": "secret-key",
          "revealed": true
        }
      ],
      "threads": [],
      "relations": [],
      "nextScenes": []
    }
  },
  "q2:peaceful": {
    "playerLabel": "Мы прекратили травлю без драки и сообщили Кирку",
    "effects": {
      "flags": [],
      "secrets": [],
      "threads": [],
      "relations": [
        {
          "id": "r6"
        }
      ],
      "nextScenes": []
    }
  },
  "q2:fight": {
    "playerLabel": "Булли сдался в драке; мы сообщили Кирку",
    "effects": {
      "flags": [],
      "secrets": [],
      "threads": [],
      "relations": [
        {
          "id": "r6"
        }
      ],
      "nextScenes": []
    }
  },
  "q2:adults": {
    "playerLabel": "Взрослые прекратили травлю; мы сообщили Кирку",
    "effects": {
      "flags": [],
      "secrets": [],
      "threads": [],
      "relations": [
        {
          "id": "r6"
        },
        {
          "id": "r7"
        }
      ],
      "nextScenes": []
    }
  },
  "q3:medicine-delivered": {
    "playerLabel": "Мы передали лекарство, и Стелла получила лечение",
    "effects": {
      "flags": [],
      "secrets": [],
      "threads": [],
      "relations": [
        {
          "id": "r8"
        }
      ],
      "nextScenes": []
    }
  },
  "q3:doctor-treated": {
    "playerLabel": "Мы привели Стеллу к Пату, и он её вылечил",
    "effects": {
      "flags": [],
      "secrets": [],
      "threads": [],
      "relations": [
        {
          "id": "r8"
        },
        {
          "id": "r9"
        }
      ],
      "nextScenes": []
    }
  },
  "q3:radout-obtained": {
    "playerLabel": "Мы получили дозу Рад-Аута для Стеллы",
    "effects": {
      "flags": [],
      "secrets": [],
      "threads": [],
      "relations": [],
      "nextScenes": []
    }
  },
  "q3:radout-delivered": {
    "playerLabel": "Мы передали дозу, и её применили для лечения Стеллы",
    "effects": {
      "flags": [],
      "secrets": [],
      "threads": [],
      "relations": [
        {
          "id": "r8"
        },
        {
          "id": "r9"
        }
      ],
      "nextScenes": []
    }
  },
  "q4:drink-delivered": {
    "playerLabel": "Мы передали напиток охраннику",
    "effects": {
      "flags": [],
      "secrets": [],
      "threads": [],
      "relations": [],
      "nextScenes": []
    }
  },
  "q4:levy-cancelled": {
    "playerLabel": "Мы добились отмены побора и вернули оставшиеся конфеты",
    "effects": {
      "flags": [],
      "secrets": [],
      "threads": [],
      "relations": [],
      "nextScenes": []
    }
  },
  "q4:candies-received": {
    "playerLabel": "Мы получили конфеты на поручение",
    "effects": {
      "flags": [],
      "secrets": [],
      "threads": [],
      "relations": [],
      "nextScenes": []
    }
  },
  "q4:parking-bottle": {
    "playerLabel": "Мы забрали пустую бутылку из автомобиля",
    "effects": {
      "flags": [],
      "secrets": [],
      "threads": [],
      "relations": [],
      "nextScenes": []
    }
  },
  "q4:smitty-bottle": {
    "playerLabel": "Мы улучшили аппарат и получили бутылку у Смитти",
    "effects": {
      "flags": [
        {
          "id": "drink-machine-upgraded",
          "value": "yes"
        }
      ],
      "secrets": [],
      "threads": [],
      "relations": [
        {
          "id": "r13"
        }
      ],
      "nextScenes": []
    }
  },
  "q4:spare-drink": {
    "playerLabel": "Мы изготовили напиток, выполнили поручение и сохранили вторую бутылку",
    "effects": {
      "flags": [],
      "secrets": [],
      "threads": [
        {
          "id": "t-dep-4",
          "status": "open"
        },
        {
          "id": "t-dep-5",
          "status": "open"
        }
      ],
      "relations": [],
      "nextScenes": []
    }
  },
  "q5:repaired": {
    "playerLabel": "Мы починили трансформатор, получили отметку и доложили",
    "effects": {
      "flags": [
        {
          "id": "transformer-repaired",
          "value": "yes"
        }
      ],
      "secrets": [],
      "threads": [
        {
          "id": "t-dep-6",
          "status": "open"
        },
        {
          "id": "t-dep-1",
          "status": "closed"
        },
        {
          "id": "t-dep-4",
          "status": "closed"
        }
      ],
      "relations": [],
      "nextScenes": []
    }
  },
  "q6:diagnosed": {
    "playerLabel": "Мы выяснили причину болезни лавашей и доложили",
    "effects": {
      "flags": [
        {
          "id": "water-cause-known",
          "value": "yes"
        }
      ],
      "secrets": [
        {
          "id": "secret-water",
          "revealed": true
        }
      ],
      "threads": [
        {
          "id": "t-dep-7",
          "status": "open"
        }
      ],
      "relations": [
        {
          "id": "r22"
        }
      ],
      "nextScenes": [
        "q7"
      ]
    }
  },
  "q7:repaired": {
    "playerLabel": "Мы починили очиститель, проверили воду и доложили",
    "effects": {
      "flags": [
        {
          "id": "purifier-repaired",
          "value": "yes"
        }
      ],
      "secrets": [
        {
          "id": "secret-water",
          "revealed": true
        }
      ],
      "threads": [
        {
          "id": "t-dep-8",
          "status": "open"
        },
        {
          "id": "t-dep-2",
          "status": "closed"
        },
        {
          "id": "t-dep-7",
          "status": "closed"
        }
      ],
      "relations": [],
      "nextScenes": []
    }
  },
  "q7:filter": {
    "playerLabel": "Мы получили фильтр для очистителя",
    "effects": {
      "flags": [],
      "secrets": [],
      "threads": [],
      "relations": [],
      "nextScenes": []
    }
  },
  "q7:bracket": {
    "playerLabel": "Мы получили кронштейн для очистителя",
    "effects": {
      "flags": [],
      "secrets": [],
      "threads": [],
      "relations": [],
      "nextScenes": []
    }
  },
  "q7:valve": {
    "playerLabel": "Мы получили клапан для очистителя",
    "effects": {
      "flags": [],
      "secrets": [],
      "threads": [],
      "relations": [],
      "nextScenes": []
    }
  },
  "q7:parts-installed": {
    "playerLabel": "Мы установили детали в очиститель",
    "effects": {
      "flags": [],
      "secrets": [],
      "threads": [],
      "relations": [],
      "nextScenes": []
    }
  },
  "q8:delivered": {
    "playerLabel": "Мы доставили все двенадцать канистр чистой воды",
    "effects": {
      "flags": [],
      "secrets": [],
      "threads": [
        {
          "id": "t-dep-8",
          "status": "closed"
        }
      ],
      "relations": [
        {
          "id": "r22"
        }
      ],
      "nextScenes": []
    }
  },
  "q9:catty": {
    "playerLabel": "Мы передали Кэтти двадцать четыре спелых початка",
    "effects": {
      "flags": [],
      "secrets": [],
      "threads": [
        {
          "id": "t-dep-11",
          "status": "open"
        },
        {
          "id": "t-dep-9",
          "status": "closed"
        }
      ],
      "relations": [
        {
          "id": "r8"
        }
      ],
      "nextScenes": []
    }
  },
  "q9:foreman": {
    "playerLabel": "Мы сдали норму смотрителю в помощь Стелле",
    "effects": {
      "flags": [],
      "secrets": [],
      "threads": [
        {
          "id": "t-dep-11",
          "status": "open"
        },
        {
          "id": "t-dep-9",
          "status": "closed"
        }
      ],
      "relations": [
        {
          "id": "r26"
        }
      ],
      "nextScenes": []
    }
  },
  "q10:reported": {
    "playerLabel": "Мы установили, что произошло, и передали сведения Грегориусу",
    "effects": {
      "flags": [
        {
          "id": "bardok-truth-known",
          "value": "yes"
        },
        {
          "id": "bardok-spared-secret-kept",
          "value": "no"
        },
        {
          "id": "bardok-arrested",
          "value": "yes"
        }
      ],
      "secrets": [
        {
          "id": "secret-bardok",
          "revealed": true
        }
      ],
      "threads": [
        {
          "id": "t-dep-12",
          "status": "closed"
        },
        {
          "id": "t-dep-3",
          "status": "closed"
        },
        {
          "id": "t-dep-5",
          "status": "closed"
        }
      ],
      "relations": [
        {
          "id": "r29"
        },
        {
          "id": "r30"
        }
      ],
      "nextScenes": []
    }
  },
  "q10:concealed": {
    "playerLabel": "Мы установили, что произошло, и решили скрыть находку; Бардок жив",
    "effects": {
      "flags": [
        {
          "id": "bardok-truth-known",
          "value": "yes"
        },
        {
          "id": "bardok-spared-secret-kept",
          "value": "yes"
        },
        {
          "id": "bardok-arrested",
          "value": "no"
        }
      ],
      "secrets": [
        {
          "id": "secret-bardok",
          "revealed": true
        }
      ],
      "threads": [
        {
          "id": "t-dep-12",
          "status": "open"
        },
        {
          "id": "t-dep-3",
          "status": "closed"
        },
        {
          "id": "t-dep-5",
          "status": "closed"
        }
      ],
      "relations": [
        {
          "id": "r29"
        },
        {
          "id": "r39"
        }
      ],
      "nextScenes": []
    }
  },
  "q10:bardok-killed": {
    "playerLabel": "Мы установили, что произошло; Бардок погиб",
    "effects": {
      "flags": [
        {
          "id": "bardok-truth-known",
          "value": "yes"
        },
        {
          "id": "bardok-spared-secret-kept",
          "value": "no"
        },
        {
          "id": "bardok-arrested",
          "value": "no"
        }
      ],
      "secrets": [
        {
          "id": "secret-bardok",
          "revealed": true
        }
      ],
      "threads": [
        {
          "id": "t-dep-12",
          "status": "closed"
        },
        {
          "id": "t-dep-3",
          "status": "closed"
        },
        {
          "id": "t-dep-5",
          "status": "closed"
        }
      ],
      "relations": [
        {
          "id": "r29"
        }
      ],
      "nextScenes": []
    }
  },
  "q10:service-badge": {
    "playerLabel": "Мы обыскали останки и нашли служебный знак",
    "effects": {
      "flags": [],
      "secrets": [
        {
          "id": "secret-bardok",
          "revealed": true
        }
      ],
      "threads": [],
      "relations": [
        {
          "id": "r29"
        }
      ],
      "nextScenes": []
    }
  },
  "q10:ammo-preserved": {
    "playerLabel": "Мы осмотрели останки и нашли пригодные патроны",
    "effects": {
      "flags": [],
      "secrets": [
        {
          "id": "secret-ammo",
          "revealed": true
        }
      ],
      "threads": [],
      "relations": [],
      "nextScenes": []
    }
  },
  "q11:medicine-applied": {
    "playerLabel": "Мы применили лекарство и стабилизировали раненого",
    "effects": {
      "flags": [
        {
          "id": "guard-stabilized",
          "value": "yes"
        },
        {
          "id": "guard-survived",
          "value": "yes"
        }
      ],
      "secrets": [],
      "threads": [
        {
          "id": "t-dep-13",
          "status": "open"
        }
      ],
      "relations": [],
      "nextScenes": []
    }
  },
  "q11:equivalent-help": {
    "playerLabel": "Мы оказали раненому равноценную помощь",
    "effects": {
      "flags": [
        {
          "id": "guard-stabilized",
          "value": "yes"
        },
        {
          "id": "guard-survived",
          "value": "yes"
        }
      ],
      "secrets": [],
      "threads": [
        {
          "id": "t-dep-13",
          "status": "open"
        }
      ],
      "relations": [],
      "nextScenes": []
    }
  },
  "q11:hillup": {
    "playerLabel": "Мы получили у Пата лекарство для раненого",
    "effects": {
      "flags": [],
      "secrets": [],
      "threads": [],
      "relations": [],
      "nextScenes": []
    }
  },
  "q11:hillup-applied": {
    "playerLabel": "Мы применили полученную дозу к раненому",
    "effects": {
      "flags": [
        {
          "id": "guard-stabilized",
          "value": "yes"
        }
      ],
      "secrets": [],
      "threads": [
        {
          "id": "t-dep-13",
          "status": "open"
        }
      ],
      "relations": [],
      "nextScenes": []
    }
  },
  "q12:exit-opportunity": {
    "playerLabel": "Мы справились с обвинением и можем продолжить выход",
    "effects": {
      "flags": [],
      "secrets": [
        {
          "id": "secret-frame",
          "revealed": true
        }
      ],
      "threads": [
        {
          "id": "t-dep-14",
          "status": "open"
        },
        {
          "id": "t-dep-13",
          "status": "closed"
        }
      ],
      "relations": [],
      "nextScenes": [
        "q13"
      ]
    }
  },
  "q13:escaped": {
    "playerLabel": "Все уходящие выбрались наружу и оторвались от погони",
    "effects": {
      "flags": [],
      "secrets": [
        {
          "id": "secret-exit",
          "revealed": true
        }
      ],
      "threads": [
        {
          "id": "t-dep-6",
          "status": "closed"
        },
        {
          "id": "t-dep-10",
          "status": "closed"
        },
        {
          "id": "t-dep-11",
          "status": "closed"
        },
        {
          "id": "t-dep-12",
          "status": "closed"
        },
        {
          "id": "t-dep-14",
          "status": "closed"
        },
        {
          "id": "t-dep-15",
          "status": "closed"
        },
        {
          "id": "t-dep-17",
          "status": "closed"
        }
      ],
      "relations": [],
      "nextScenes": []
    }
  },
  "q14:disk-read": {
    "playerLabel": "Мы сохранили и прочитали найденный диск",
    "effects": {
      "flags": [
        {
          "id": "diary-saved",
          "value": "yes"
        },
        {
          "id": "diary-read",
          "value": "yes"
        }
      ],
      "secrets": [
        {
          "id": "secret-diary",
          "revealed": true
        }
      ],
      "threads": [
        {
          "id": "t-dep-16",
          "status": "closed"
        }
      ],
      "relations": [
        {
          "id": "r43"
        },
        {
          "id": "r44"
        }
      ],
      "nextScenes": []
    }
  },
  "q14:disk-taken": {
    "playerLabel": "Мы забрали найденный диск",
    "effects": {
      "flags": [
        {
          "id": "diary-saved",
          "value": "yes"
        }
      ],
      "secrets": [],
      "threads": [],
      "relations": [],
      "nextScenes": []
    }
  },
  "q14:box-1": {
    "playerLabel": "Мы открыли первый ящик",
    "effects": {
      "flags": [],
      "secrets": [],
      "threads": [],
      "relations": [],
      "nextScenes": []
    }
  },
  "q14:box-2": {
    "playerLabel": "Мы открыли второй ящик",
    "effects": {
      "flags": [],
      "secrets": [],
      "threads": [],
      "relations": [],
      "nextScenes": []
    }
  },
  "q14:box-3": {
    "playerLabel": "Мы открыли третий ящик",
    "effects": {
      "flags": [],
      "secrets": [],
      "threads": [],
      "relations": [],
      "nextScenes": []
    }
  }
};
  function copyEffects(effects) {
    return {
      flags: effects.flags.map(value => ({id:value.id,value:value.value})),
      secrets: effects.secrets.map(value => ({id:value.id,revealed:value.revealed})),
      threads: effects.threads.map(value => ({id:value.id,status:value.status})),
      relations: effects.relations.map(value => ({id:value.id})),
      nextScenes: effects.nextScenes.slice()
    };
  }
  window.gmOutcomeDefaults = function (missionId, resultId) {
    const id = String(missionId || '') + ':' + String(resultId || '');
    const row = Object.hasOwn(defaults,id) ? defaults[id] : null;
    return row ? {playerLabel:row.playerLabel,effects:copyEffects(row.effects)} : {
      playerLabel:'',effects:{flags:[],secrets:[],threads:[],relations:[],nextScenes:[]}
    };
  };
})();
