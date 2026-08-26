export default {
  'gameName': '3d-world',
  'cancel': 'Annulla',
  'close': 'Chiudi',
  'ok': 'Ok',
  'continue': 'Continua',
  'tapToContinue': 'Tocca per continuare',
  'clickToContinue': 'Clicca per continuare',
  'rewards': 'RICOMPENSE',
  'tip': 'Consiglio',
  'crazyGamesOnly': 'Questo gioco è disponibile solo su',

  'hud': {
    'wave': 'Ondata', 'enemies': 'Nemici', 'callWave': 'Chiama ondata', 'callBoss': 'Chiama boss',
    'speed': 'Velocità {n}×',
    'speedOffer': 'Velocità doppia per un annuncio',
    'speedFor': '{n} min', 'recenter': 'Ricentra la vista'
  },

  'hints': {
    'selectBlock': { 'touch': 'Tocca un blocco in basso per sceglierlo', 'desktop': 'Clicca un blocco in basso per sceglierlo' },
    'placeBlock': { 'touch': 'Ora tocca uno spazio illuminato per costruire', 'desktop': 'Ora clicca uno spazio illuminato per costruire' },
    'camera': { 'touch': 'Trascina per spostare · Pizzica per zoomare', 'desktop': 'Trascina per spostare · Rotella per zoomare' },
    'callWave': { 'touch': 'Tocca «Chiama ondata» quando la torre è pronta', 'desktop': 'Premi Spazio per anticipare l’ondata' },
    'inspect': { 'touch': 'Tieni premuto un blocco per esaminarlo', 'desktop': 'Clicca un blocco per esaminarlo' }
  },

  'blocks': {
    'sell': 'Vendi',
    'roofNote': 'Con tetto: PS doppi, difesa tripla da sopra. Richiede cielo libero.',
    'enhancedNote': 'Rinforzato: più PS e più danni.',
    'enhancedHand': 'Mano rinforzata',
    'reroll': 'Cambia questo pezzo',
    'kinds': { 'core': 'Nucleo', 'structure': 'Struttura', 'weapon': 'Arma', 'economy': 'Economia', 'utility': 'Utilità' },
    'stats': {
      'hp': 'PS', 'armor': 'Armatura', 'dmg': 'Danno', 'cooldown': 'Ricarica', 'range': 'Gittata',
      'splash': 'Area', 'yieldWood': 'Legno / ondata', 'yieldStone': 'Pietra / ondata', 'yieldCoins': 'Monete / ondata',
      'repair': 'Riparazione / ondata', 'blast': 'Esplosione',
      'thorns': 'Spine'
    },
    'names': {
      'gate': 'Portone', 'wood': 'Cassa di legno', 'brace': 'Cassa rinforzata', 'stone': 'Blocco di pietra',
      'archer': 'Torre arcieri', 'cannon': 'Cannone', 'mortar': 'Mortaio', 'tesla': 'Bobina elettrica',
      'frost': 'Guglia di gelo', 'repair': 'Officina',
      'sawmill': 'Segheria', 'quarry': 'Cava', 'mint': 'Miniera d’oro',
      'spikes': 'Muro di punte',
      'bombard': 'Bombarda'
    },
    'descriptions': {
      'gate': 'Il cuore della torre. Se cade, l’assedio è finito.',
      'wood': 'Riempimento economico. La spina dorsale di ogni torre iniziale.',
      'brace': 'Il doppio del legno e più del doppio della resistenza.',
      'stone': 'Pesante e corazzato. Perfetto alla base.',
      'archer': 'Frecce rapide su bersaglio singolo. Colpisce i volanti.',
      'cannon': 'Lento, forte danno ad area. Scioglie le folle compatte.',
      'mortar': 'Colpi ad arco a lunga gittata, ma non può colpire i volanti.',
      'tesla': 'Fulmini che rimbalzano tra i nemici vicini.',
      'frost': 'Congela interi gruppi e li rallenta moltissimo.',
      'repair': 'Ripara tutti i blocchi adiacenti tra un’ondata e l’altra.',
      'sawmill': 'Produce legno alla fine di ogni ondata superata.',
      'quarry': 'Produce pietra alla fine di ogni ondata superata.',
      'mint': 'Produce monete alla fine di ogni ondata superata.',
      'spikes': 'Gli assalitori si feriscono a ogni colpo.',
      'bombard': 'Lancia una granata quasi verticale. Piccola esplosione, solo bersagli a terra.'
    }
  },

  'enemies': {
    'names': {
      'grunt': 'Fante', 'runner': 'Corridore', 'slinger': 'Fromboliere', 'brute': 'Bruto',
      'bomber': 'Bombarolo', 'bat': 'Pipistrello', 'bulwark': 'Baluardo', 'golem': 'Golem d’assedio',
      'wyvern': 'Viverna',
      'eel': 'Serpente marino',
      'shark': 'Squalo di scogliera',
      'kraken': 'Kraken',
      'seadrake': 'Drago marino',
      'ram': 'Ariete',
      'ballista': 'Balista',
      'catapult': 'Catapulta',
      'siegeTower': 'Torre d’assedio',
      'trebuchet': 'Trabucco',
      'ironRam': 'Ariete corazzato',
      'bombardier': 'Bombardiere',
      'firebug': 'Incendiario'
    }
  },

  // ─── First-stage tutorial ─────────────────────────────────────────────────
  'tutorial': {
    'gate': 'Proteggi il Cancello. Se cade, la partita finisce.',
    'pick': 'Scegli un pezzo.',
    'place': 'Mettilo accanto al Cancello.',
    'call': 'Chiama l’ondata quando sei pronto.',
    'next': 'Avanti',
    'offer': 'Serve un tutorial?',
    'start': 'Inizia',
    'skip': 'Salta'
  },

  // ─── Allies ───────────────────────────────────────────────────────────────
  'allies': {
    'cavalry': 'Cavalleria'
  },

  'result': {
    'towerFell': 'La torre è caduta!',
    'reachedWave': 'Sei sopravvissuto fino all’ondata {n}',
    'newRecord': 'Nuovo record!',
    'upgrade': 'Potenzia!',
    'defendAgain': 'Difendi di nuovo',
    'continueRun': 'Ricostruisci e continua',
    'double': 'Raddoppia le monete',
    'firstRunDouble': '2× — primo assedio di oggi!',
    'tripleWave': '3× monete: {n}',
    'waveCleared': 'Ondata {n} respinta!',
    'scoreLabel': 'Punteggio',
    'bestLabel': 'Record',
    'scoreCurrent': '({n} in questa partita)',
    'rankLabel': 'Posizione',
    'rankOf': 'su {n}'
  },

  'tech': {
    'title': 'Albero tecnologico',
    'rank': 'Grado {current}/{total}',
    'maxed': 'Al massimo',
    'rankOpen': 'Grado {n}',
    'atRank': 'Al grado {r}: {n} in totale',
    'owned': 'Sbloccato',
    'requires': 'Richiede {n}',
    'spotlight': 'Spendi!',
    'names': {
      'foundations': 'Fondamenta', 'sharpBolts': 'Dardi affilati', 'unlockBrace': 'Casse rinforzate',
      'lumberStock': 'Scorta di legno', 'longSight': 'Lunga vista', 'rapidFire': 'Fuoco rapido',
      'reinforced': 'Travi rinforzate', 'unlockSawmill': 'Segheria', 'quarryStock': 'Scorta di pietra',
      'unlockMortar': 'Mortaio', 'heavyOrdnance': 'Artiglieria pesante', 'unlockTesla': 'Bobina elettrica',
      'gateArmor': 'Corazza del portone', 'unlockQuarry': 'Cava', 'richHauls': 'Bottino ricco',
      'wideFoundation': 'Fondamenta ampie', 'siegeShells': 'Proiettili d’assedio', 'unlockFrost': 'Guglia di gelo',
      'forkedBolts': 'Fulmini biforcuti', 'ironPlating': 'Piastre di ferro', 'unlockRepair': 'Officina',
      'unlockMint': 'Miniera d’oro', 'looting': 'Saccheggio', 'overcharge': 'Sovraccarico',
      'masterwork': 'Capolavoro', 'fieldRepairs': 'Riparazioni sul campo', 'greatFoundation': 'Grandi fondamenta',
      'warChest': 'Cassa di guerra',
      'unlockSpikes': 'Muro di punte',
      'unlockBombard': 'Bombarda',
      'sharpSpikes': 'Punte affilate',
      'cavalryDrill': 'Addestramento di cavalleria',
      'artilleryDoctrine': 'Dottrina d’artiglieria'
    },
    'descriptions': {
      'foundations': 'Ogni blocco parte con +{n} % di PS.',
      'sharpBolts': 'Tutte le armi infliggono +{n} % di danno per grado.',
      'unlockBrace': 'Sblocca la cassa rinforzata: il doppio dei PS del legno.',
      'lumberStock': 'Inizia ogni assedio con +{n} legno per grado.',
      'longSight': 'Tutte le armi arrivano +{n} % più lontano per grado.',
      'rapidFire': 'Tutte le armi sparano l’{n} % più veloce per grado.',
      'reinforced': 'Ogni blocco guadagna +{n} % di PS per grado.',
      'unlockSawmill': 'Sblocca la segheria: produce legno a ogni ondata.',
      'quarryStock': 'Inizia ogni assedio con +{n} pietra per grado.',
      'unlockMortar': 'Sblocca il mortaio: danno ad area a lunga gittata.',
      'heavyOrdnance': 'Raggio d’area +{n} % per grado.',
      'unlockTesla': 'Sblocca la bobina elettrica: i fulmini rimbalzano.',
      'gateArmor': 'Il portone guadagna +{n} % di PS per grado.',
      'unlockQuarry': 'Sblocca la cava: produce pietra a ogni ondata.',
      'richHauls': 'Ricompense d’ondata +{n} % per grado.',
      'wideFoundation': 'Costruisci {n} colonne più larghe per grado.',
      'siegeShells': 'Tutte le armi infliggono +{n} % di danno per grado.',
      'unlockFrost': 'Sblocca la guglia di gelo: rallenta interi gruppi.',
      'forkedBolts': 'Il fulmine rimbalza su {n} nemico in più per grado.',
      'ironPlating': 'Ogni blocco guadagna +{n} di armatura per grado.',
      'unlockRepair': 'Sblocca l’officina: cura i vicini a ogni ondata.',
      'unlockMint': 'Sblocca la miniera d’oro: produce monete a ogni ondata.',
      'looting': 'I nemici lasciano +{n} % di monete in più per grado.',
      'overcharge': 'Tutte le armi sparano il {n} % più veloce per grado.',
      'masterwork': 'Tutte le armi infliggono +{n} % di danno per grado.',
      'fieldRepairs': 'Ogni blocco recupera il {n} % dei PS max per ondata respinta e per grado.',
      'greatFoundation': 'Costruisci altre {n} colonne più larghe per grado.',
      'warChest': 'Ricompense d’ondata +{n} % per grado.',
      'unlockSpikes': 'Sblocca il Muro di punte: gli assalitori si feriscono da soli.',
      'unlockBombard': 'Sblocca la Bombarda: fuoco di mortaio a corto raggio sulle truppe a terra.',
      'sharpSpikes': 'I muri di punte riflettono +{n}% di danni in più per grado.',
      'cavalryDrill': 'La cavalleria esce con +{n}% di PS e danni per grado.',
      'artilleryDoctrine': 'Tutte le armi arrivano +{n}% più lontano per grado.'
    }
  },

  'resources': {
    'wood': 'legno',
    'stone': 'pietra',
    'coins': 'monete'
  },

  'ads': {
    'watch': 'Guarda', 'revive': 'Rianima', 'secondChance': 'Seconda occasione',
    'doubleCoins': '2× monete', 'plusCoins': '+{n} monete'
  },

  'achievements': {
    'title': 'Obiettivi', 'subtitle': 'Raggiungi traguardi permanenti per guadagnare monete.',
    'claim': 'Riscuoti', 'claimed': 'Riscosso', 'progress': '{c} / {t}',
    'items': {
      'wave5': { 'name': 'Prima resistenza', 'desc': 'Sopravvivi fino all’ondata 5.' },
      'wave10': { 'name': 'Roccaforte', 'desc': 'Sopravvivi fino all’ondata 10.' },
      'wave20': { 'name': 'Baluardo', 'desc': 'Sopravvivi fino all’ondata 20.' },
      'wave30': { 'name': 'Infrangibile', 'desc': 'Sopravvivi fino all’ondata 30.' },
      'waves50': { 'name': 'Frangiflutti', 'desc': 'Respingi 50 ondate in totale.' },
      'waves250': { 'name': 'Veterano d’assedio', 'desc': 'Respingi 250 ondate in totale.' },
      'kills500': { 'name': 'Difensore', 'desc': 'Sconfiggi 500 nemici in totale.' },
      'kills5k': { 'name': 'Sterminatore', 'desc': 'Sconfiggi 5.000 nemici in totale.' },
      'kills50k': { 'name': 'Leggenda', 'desc': 'Sconfiggi 50.000 nemici in totale.' },
      'height10': { 'name': 'Verso il cielo', 'desc': 'Costruisci una torre alta 10 blocchi.' },
      'height20': { 'name': 'Spaccanuvole', 'desc': 'Costruisci una torre alta 20 blocchi.' },
      'blocks250': { 'name': 'Costruttore', 'desc': 'Piazza 250 blocchi in totale.' },
      'blocks2k': { 'name': 'Architetto', 'desc': 'Piazza 2.000 blocchi in totale.' },
      'coins5k': { 'name': 'Collezionista', 'desc': 'Guadagna 5.000 monete in totale.' },
      'coins50k': { 'name': 'Tesoriere', 'desc': 'Guadagna 50.000 monete in totale.' },
      'runs25': { 'name': 'Tenace', 'desc': 'Inizia 25 assedi.' }
    }
  },

  'missions': {
    'title': 'Missioni giornaliere', 'subtitle': 'Completa obiettivi ogni giorno per ottenere monete.',
    'claim': 'Riscuoti', 'done': 'Riscosso',
    'types': {
      'coins': 'Guadagna {n} monete oggi',
      'waves': 'Sopravvivi fino all’ondata {n} in un assedio',
      'kills': 'Sconfiggi {n} nemici oggi',
      'blocks': 'Piazza {n} blocchi oggi'
    }
  },

  'battlePass': {
    'title': 'Pass battaglia', 'progress': '{current} / {total}', 'daysLeft': '{n} g rimasti',
    'maxed': 'PASS BATTAGLIA COMPLETATO', 'xpProgress': '{current} / {total} XP',
    'howToEarn': 'Come guadagnare XP', 'perRun': 'per assedio', 'perWave': 'per ondata respinta',
    'unlockHint': 'Raggiungi {n} XP per la prossima ricompensa: quelle non riscosse restano disponibili.'
  },

  'dailyRewards': {
    'title': 'Ricompense giornaliere', 'subtitle': 'Accedi ogni giorno per mantenere la serie.',
    'day': 'Giorno {n}', 'dayShort': 'G{n}'
  },

  'options': {
    'title': 'Opzioni', 'general': 'Generale', 'audio': 'Audio', 'language': 'Lingua',
    'difficulty': 'Difficoltà', 'soundEffects': 'Effetti sonori', 'music': 'Musica', 'musicTrack': 'Traccia musicale',
    'musicTracks': { 'cozy': 'Armonia accogliente', 'trance': 'Tunnel trance' },
    'close': 'Salva e chiudi',
    'difficulties': { 'easy': 'Facile', 'medium': 'Media', 'hard': 'Difficile' },
    'difficultyHints': {
      'easy': 'Ondate più piccole e nemici più deboli.',
      'medium': 'L’assedio standard ed equilibrato.',
      'hard': 'Ondate più fitte e nemici più resistenti.'
    }
  },

  'adsBlocked': {
    'title': 'Impossibile mostrare l’annuncio',
    'body': 'Abbiamo provato a mostrarti un video per farti ottenere la ricompensa, ma qualcosa nel tuo browser blocca gli annunci.',
    'allowPrefix': 'Consenti gli annunci su',
    'allowSuffix': '(o metti in pausa il blocco annunci per questo gioco) e riprova.',
    'gotIt': 'Capito'
  },
  'saveStatus': {
    'restoredTitle': 'Salvataggio cloud ripristinato', 'restoredBody': '+{n} monete bonus per il recupero',
    'tap': 'tocca', 'pausedTitle': 'Sincronizzazione in pausa',
    'pausedBody': 'Stai giocando offline. I progressi sono salvati qui.',
    'retry': 'Riprova', 'dismiss': 'ignora'
  },
  'loading': { 'tooLong': 'Il caricamento è troppo lento? Disattiva il blocco annunci e ricarica.' },
  'license': { 'denied': 'Accesso negato: acquista una licenza.' },
  'world': {
    'controlsHint': 'Trascina per guardarti intorno · WASD per muoverti · rotella o pizzico per lo zoom',
    'modeOrbit': 'Vista orbitale',
    'modeFirstPerson': 'Cammina',
    'settings': {
      'title': 'Grafica',
      'open': 'Impostazioni grafiche',
      'grass': 'Dettaglio erba',
      'grassHint': 'Erba più fitta e visibile più lontano. Abbassa questa voce se il gioco scatta.',
      'grassAutoHint': 'L’erba si adatta a ciò che il tuo dispositivo riesce a gestire.',
      'drawnPatches': '{n} ciuffi a schermo · {tris}k triangoli',
      'detail': {
        'auto': 'Automatico',
        'ultra': 'Ultra',
        'high': 'Alto',
        'medium': 'Medio',
        'low': 'Basso',
        'minimum': 'Minimo',
        'off': 'Disattivata'
      }
    }
  },

  'characters': {
    'title': 'Crea il tuo personaggio',
    'hint': 'Trascina per ruotare · scorri o pizzica per lo zoom',
    'body': 'Corporatura',
    'bodies': {
      'male': 'Maschile',
      'female': 'Femminile'
    },
    'head': 'Forma della testa',
    'heads': {
      'round': 'Tonda',
      'oval': 'Ovale',
      'square': 'Squadrata',
      'heart': 'A cuore'
    },
    'hair': 'Capelli',
    'hairStyles': {
      'bowl': 'Taglio a scodella',
      'short': 'Corti',
      'ponytail': 'Coda di cavallo',
      'braids': 'Trecce',
      'long': 'Lunghi',
      'bald': 'Calvo',
      'topknot': 'Nodo alto',
      'buns': 'Chiocciole laterali',
      'bun': 'Chignon basso',
      'plaits': 'Trecce sporgenti',
      'flowing': 'Chioma fluente',
      'queue': 'Treccia lunga',
      'bob': 'Taglio a caschetto',
      'tresses': 'Ciocche sul davanti',
      'wild': 'Arruffato',
      'swept': 'Ciuffo laterale',
      'fringe': 'Frangia folta',
      'bearded': 'Barbuto',
      'mane': 'Criniera',
      'coif': 'Cuffia',
      'receding': 'Stempiato'
    },
    'eyes': 'Occhi',
    'eyeStyles': {
      'bright': 'Luminosi',
      'wide': 'Distanziati',
      'close': 'Ravvicinati',
      'tall': 'Alti',
      'small': 'Piccoli',
      'almond': 'A mandorla',
      'sleepy': 'Assonnati',
      'sharp': 'Affilati',
      'soft': 'Dolci',
      'weary': 'Stanchi'
    },
    'mouth': 'Bocca',
    'mouthStyles': {
      'smile': 'Sorriso',
      'neutral': 'Neutra',
      'frown': 'Imbronciata',
      'grin': 'Sorrisone',
      'open': 'Aperta'
    },
    'beard': 'Barba',
    'beardStyles': {
      'none': 'Rasato',
      'moustache': 'Baffi',
      'goatee': 'Pizzetto',
      'cropped': 'Corta',
      'muttonChops': 'Basette',
      'full': 'Folta',
      'forked': 'Biforcuta',
      'braided': 'Intrecciata',
      'patriarch': 'Patriarca'
    },
    'nose': 'Naso',
    'noseStyles': {
      'none': 'Nessuno',
      'button': 'All\'insù',
      'round': 'Tondo',
      'hooked': 'Aquilino',
      'broad': 'Largo'
    },
    'brows': 'Sopracciglia',
    'browStyles': {
      'fine': 'Sottili',
      'bushy': 'Folte'
    },
    'skinTone': 'Tono della pelle',
    'skinToneOption': 'Tono della pelle {n}',
    'hairColour': 'Colore dei capelli',
    'hairColourOption': 'Colore dei capelli {n}',
    'tunicColour': 'Colore della tunica',
    'tunicColourOption': 'Colore della tunica {n}',
    'outfit': 'Abito',
    'outfitHint': 'Da quali colori è tagliato un capo. Ogni tunica, farsetto e berretto ha il suo insieme.',
    'equipment': 'Equipaggiamento',
    'items': {
      'hat': 'Cappello',
      'torsoArmour': 'Armatura',
      'sword': 'Spada',
      'shield': 'Scudo'
    },
    'drawWeapon': 'Sguaina arma',
    'spin': 'Rotazione automatica',
    'randomise': 'Sorprendimi',
    'reset': 'Ricomincia',
    'save': 'Salva personaggio',
    'saved': 'Salvato',
    'back': 'Torna al mondo',
    'roster': 'Personaggio',
    'newCharacter': 'Nuovo personaggio',
    'unnamed': 'Senza nome',
    'search': 'Cerca per nome o ID',
    'noMatches': 'Nessun personaggio corrisponde.',
    'empty': 'Nessun personaggio salvato. Creane uno, dagli un nome e premi Salva.',
    'name': 'Nome',
    'namePlaceholder': 'Dai un nome al personaggio',
    'copyName': 'Copia di {name}',
    'id': 'ID',
    'idPending': 'Assegnato al salvataggio.',
    'idFixed': 'Fissato alla creazione. Salvataggi e missioni vi fanno riferimento, quindi rinominare non lo cambia mai.',
    'duplicate': 'Duplica',
    'delete': 'Elimina',
    'deleteConfirm': 'Eliminare {name}? L’operazione è irreversibile.',
    'unsavedChanges': 'Hai modifiche non salvate.',
    'saveAndContinue': 'Salva e continua',
    'discard': 'Scarta'
  }
}
