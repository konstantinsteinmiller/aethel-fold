export default {
  'gameName': '3d-world',
  'cancel': 'Cancelar',
  'close': 'Cerrar',
  'ok': 'Ok',
  'continue': 'Continuar',
  'tapToContinue': 'Toca para continuar',
  'clickToContinue': 'Haz clic para continuar',
  'rewards': 'RECOMPENSAS',
  'tip': 'Consejo',
  'crazyGamesOnly': 'Este juego solo está disponible en',

  'hud': {
    'wave': 'Oleada', 'enemies': 'Enemigos', 'callWave': 'Llamar oleada', 'callBoss': 'Llamar jefe',
    'speed': 'Velocidad {n}×',
    'speedOffer': 'Doble velocidad por un anuncio',
    'speedFor': '{n} min', 'recenter': 'Centrar la vista'
  },

  'hints': {
    'selectBlock': { 'touch': 'Toca un bloque de abajo para elegirlo', 'desktop': 'Haz clic en un bloque de abajo para elegirlo' },
    'placeBlock': { 'touch': 'Ahora toca una casilla iluminada para construir', 'desktop': 'Ahora haz clic en una casilla iluminada para construir' },
    'camera': { 'touch': 'Arrastra para mover · Pellizca para acercar', 'desktop': 'Arrastra para mover · Rueda para acercar' },
    'callWave': { 'touch': 'Toca «Llamar oleada» cuando tu torre esté lista', 'desktop': 'Pulsa Espacio para adelantar la oleada' },
    'inspect': { 'touch': 'Mantén pulsado un bloque para inspeccionarlo', 'desktop': 'Haz clic en un bloque para inspeccionarlo' }
  },

  'blocks': {
    'sell': 'Vender',
    'roofNote': 'Con tejado: el doble de PV y triple defensa desde arriba. Necesita cielo libre.',
    'enhancedNote': 'Reforzado: más PV y más daño.',
    'enhancedHand': 'Mano reforzada',
    'reroll': 'Cambiar esta pieza',
    'kinds': { 'core': 'Núcleo', 'structure': 'Estructura', 'weapon': 'Arma', 'economy': 'Economía', 'utility': 'Utilidad' },
    'stats': {
      'hp': 'PV', 'armor': 'Armadura', 'dmg': 'Daño', 'cooldown': 'Recarga', 'range': 'Alcance',
      'splash': 'Área', 'yieldWood': 'Madera / oleada', 'yieldStone': 'Piedra / oleada', 'yieldCoins': 'Monedas / oleada',
      'repair': 'Reparación / oleada', 'blast': 'Explosión',
      'thorns': 'Púas'
    },
    'names': {
      'gate': 'Portón', 'wood': 'Caja de madera', 'brace': 'Caja reforzada', 'stone': 'Bloque de piedra',
      'archer': 'Arquería', 'cannon': 'Cañón', 'mortar': 'Mortero', 'tesla': 'Bobina eléctrica',
      'frost': 'Aguja de escarcha', 'repair': 'Taller',
      'sawmill': 'Aserradero', 'quarry': 'Cantera', 'mint': 'Mina de oro',
      'spikes': 'Muro de púas',
      'bombard': 'Bombarda'
    },
    'descriptions': {
      'gate': 'El corazón de tu torre. Si cae, el asedio termina.',
      'wood': 'Relleno barato. La columna vertebral de toda torre inicial.',
      'brace': 'El doble de madera y más del doble de resistencia.',
      'stone': 'Pesado y blindado. Mejor en la base.',
      'archer': 'Flechas rápidas a un objetivo. Alcanza a los voladores.',
      'cannon': 'Lento, con daño en área. Derrite multitudes.',
      'mortar': 'Proyectiles curvos de largo alcance, pero no alcanza a los voladores.',
      'tesla': 'Rayos que saltan entre enemigos cercanos.',
      'frost': 'Congela grupos enteros y los deja al ralentí.',
      'repair': 'Repara los bloques vecinos entre oleadas.',
      'sawmill': 'Produce madera al final de cada oleada superada.',
      'quarry': 'Produce piedra al final de cada oleada superada.',
      'mint': 'Produce monedas al final de cada oleada superada.',
      'spikes': 'Los atacantes se hieren con él en cada golpe.',
      'bombard': 'Lanza un proyectil casi vertical. Explosión pequeña, solo objetivos terrestres.'
    }
  },

  'enemies': {
    'names': {
      'grunt': 'Recluta', 'runner': 'Corredor', 'slinger': 'Hondero', 'brute': 'Bruto',
      'bomber': 'Bombardero', 'bat': 'Murciélago', 'bulwark': 'Baluarte', 'golem': 'Gólem de asedio',
      'wyvern': 'Guiverno',
      'eel': 'Serpiente marina',
      'shark': 'Tiburón de arrecife',
      'kraken': 'Kraken',
      'seadrake': 'Dragón marino',
      'ram': 'Ariete',
      'ballista': 'Balista',
      'catapult': 'Catapulta',
      'siegeTower': 'Torre de asedio',
      'trebuchet': 'Trabuquete',
      'ironRam': 'Ariete acorazado',
      'bombardier': 'Bombardero',
      'firebug': 'Incendiario'
    }
  },

  // ─── First-stage tutorial ─────────────────────────────────────────────────
  'tutorial': {
    'gate': 'Protege la Puerta. Si cae, la partida termina.',
    'pick': 'Elige una pieza.',
    'place': 'Colócala junto a la Puerta.',
    'call': 'Llama a la oleada cuando estés listo.',
    'next': 'Siguiente',
    'offer': '¿Necesitas un tutorial?',
    'start': 'Empezar',
    'skip': 'Saltar'
  },

  // ─── Allies ───────────────────────────────────────────────────────────────
  'allies': {
    'cavalry': 'Caballería'
  },

  'result': {
    'towerFell': '¡La torre ha caído!',
    'reachedWave': 'Sobreviviste hasta la oleada {n}',
    'newRecord': '¡Nuevo récord!',
    'upgrade': '¡Mejorar!',
    'defendAgain': 'Defender otra vez',
    'continueRun': 'Reconstruir y seguir',
    'double': 'Duplicar monedas',
    'firstRunDouble': '2× — ¡primer asedio de hoy!',
    'tripleWave': '3× monedas: {n}',
    'waveCleared': '¡Oleada {n} resistida!',
    'scoreLabel': 'Puntos',
    'bestLabel': 'Récord',
    'scoreCurrent': '({n} esta partida)',
    'rankLabel': 'Puesto',
    'rankOf': 'de {n}'
  },

  'tech': {
    'title': 'Árbol tecnológico',
    'rank': 'Rango {current}/{total}',
    'maxed': 'Al máximo',
    'rankOpen': 'Rango {n}',
    'atRank': 'En rango {r}: {n} en total',
    'owned': 'Desbloqueado',
    'requires': 'Requiere {n}',
    'spotlight': '¡Gasta!',
    'names': {
      'foundations': 'Cimientos', 'sharpBolts': 'Virotes afilados', 'unlockBrace': 'Cajas reforzadas',
      'lumberStock': 'Reserva de madera', 'longSight': 'Vista larga', 'rapidFire': 'Fuego rápido',
      'reinforced': 'Vigas reforzadas', 'unlockSawmill': 'Aserradero', 'quarryStock': 'Reserva de piedra',
      'unlockMortar': 'Mortero', 'heavyOrdnance': 'Artillería pesada', 'unlockTesla': 'Bobina eléctrica',
      'gateArmor': 'Blindaje del portón', 'unlockQuarry': 'Cantera', 'richHauls': 'Botín abundante',
      'wideFoundation': 'Cimiento amplio', 'siegeShells': 'Proyectiles de asedio', 'unlockFrost': 'Aguja de escarcha',
      'forkedBolts': 'Rayos bifurcados', 'ironPlating': 'Placas de hierro', 'unlockRepair': 'Taller',
      'unlockMint': 'Mina de oro', 'looting': 'Saqueo', 'overcharge': 'Sobrecarga',
      'masterwork': 'Obra maestra', 'fieldRepairs': 'Reparaciones de campo', 'greatFoundation': 'Gran cimiento',
      'warChest': 'Cofre de guerra',
      'unlockSpikes': 'Muro de púas',
      'unlockBombard': 'Bombarda',
      'sharpSpikes': 'Púas afiladas',
      'cavalryDrill': 'Instrucción de caballería',
      'artilleryDoctrine': 'Doctrina de artillería'
    },
    'descriptions': {
      'foundations': 'Cada bloque empieza con +{n} % de PV.',
      'sharpBolts': 'Todas las armas hacen +{n} % de daño por rango.',
      'unlockBrace': 'Desbloquea la caja reforzada: el doble de PV que la madera.',
      'lumberStock': 'Empieza cada asedio con +{n} de madera por rango.',
      'longSight': 'Todas las armas alcanzan un +{n} % más por rango.',
      'rapidFire': 'Todas las armas disparan un {n} % más rápido por rango.',
      'reinforced': 'Cada bloque gana +{n} % de PV por rango.',
      'unlockSawmill': 'Desbloquea el aserradero: produce madera cada oleada.',
      'quarryStock': 'Empieza cada asedio con +{n} de piedra por rango.',
      'unlockMortar': 'Desbloquea el mortero: daño en área a larga distancia.',
      'heavyOrdnance': 'Radio de área +{n} % por rango.',
      'unlockTesla': 'Desbloquea la bobina eléctrica: los rayos saltan entre enemigos.',
      'gateArmor': 'El portón gana +{n} % de PV por rango.',
      'unlockQuarry': 'Desbloquea la cantera: produce piedra cada oleada.',
      'richHauls': 'Recompensas de oleada +{n} % por rango.',
      'wideFoundation': 'Construye {n} columnas más anchas por rango.',
      'siegeShells': 'Todas las armas hacen +{n} % de daño por rango.',
      'unlockFrost': 'Desbloquea la aguja de escarcha: ralentiza grupos enteros.',
      'forkedBolts': 'El rayo salta a {n} enemigo más por rango.',
      'ironPlating': 'Cada bloque gana +{n} de armadura por rango.',
      'unlockRepair': 'Desbloquea el taller: cura a los vecinos cada oleada.',
      'unlockMint': 'Desbloquea la mina de oro: produce monedas cada oleada.',
      'looting': 'Los enemigos sueltan un +{n} % más de monedas por rango.',
      'overcharge': 'Todas las armas disparan un {n} % más rápido por rango.',
      'masterwork': 'Todas las armas hacen +{n} % de daño por rango.',
      'fieldRepairs': 'Cada bloque cura un {n} % de sus PV máximos por oleada resistida y rango.',
      'greatFoundation': 'Construye {n} columnas más anchas por rango.',
      'warChest': 'Recompensas de oleada +{n} % por rango.',
      'unlockSpikes': 'Desbloquea el Muro de púas: los atacantes se hieren con él.',
      'unlockBombard': 'Desbloquea la Bombarda: fuego de mortero a corta distancia contra tropas terrestres.',
      'sharpSpikes': 'Los muros de púas reflejan un +{n} % más de daño por rango.',
      'cavalryDrill': 'La caballería sale con +{n} % de PV y daño por rango.',
      'artilleryDoctrine': 'Todas las armas alcanzan un +{n} % más lejos por rango.'
    }
  },

  'resources': {
    'wood': 'madera',
    'stone': 'piedra',
    'coins': 'monedas'
  },

  'ads': {
    'watch': 'Ver', 'revive': 'Revivir', 'secondChance': 'Segunda oportunidad',
    'doubleCoins': '2× monedas', 'plusCoins': '+{n} monedas'
  },

  'achievements': {
    'title': 'Logros', 'subtitle': 'Alcanza hitos históricos para ganar monedas.',
    'claim': 'Reclamar', 'claimed': 'Reclamado', 'progress': '{c} / {t}',
    'items': {
      'wave5': { 'name': 'Primera defensa', 'desc': 'Sobrevive hasta la oleada 5.' },
      'wave10': { 'name': 'Fortaleza', 'desc': 'Sobrevive hasta la oleada 10.' },
      'wave20': { 'name': 'Baluarte', 'desc': 'Sobrevive hasta la oleada 20.' },
      'wave30': { 'name': 'Inquebrantable', 'desc': 'Sobrevive hasta la oleada 30.' },
      'waves50': { 'name': 'Rompeolas', 'desc': 'Resiste 50 oleadas en total.' },
      'waves250': { 'name': 'Veterano de asedios', 'desc': 'Resiste 250 oleadas en total.' },
      'kills500': { 'name': 'Defensor', 'desc': 'Derrota a 500 enemigos en total.' },
      'kills5k': { 'name': 'Exterminador', 'desc': 'Derrota a 5.000 enemigos en total.' },
      'kills50k': { 'name': 'Leyenda', 'desc': 'Derrota a 50.000 enemigos en total.' },
      'height10': { 'name': 'Hacia el cielo', 'desc': 'Construye una torre de 10 bloques de alto.' },
      'height20': { 'name': 'Rompenubes', 'desc': 'Construye una torre de 20 bloques de alto.' },
      'blocks250': { 'name': 'Constructor', 'desc': 'Coloca 250 bloques en total.' },
      'blocks2k': { 'name': 'Arquitecto', 'desc': 'Coloca 2.000 bloques en total.' },
      'coins5k': { 'name': 'Coleccionista', 'desc': 'Gana 5.000 monedas en total.' },
      'coins50k': { 'name': 'Tesorero', 'desc': 'Gana 50.000 monedas en total.' },
      'runs25': { 'name': 'Persistente', 'desc': 'Comienza 25 asedios.' }
    }
  },

  'missions': {
    'title': 'Misiones diarias', 'subtitle': 'Cumple objetivos cada día para ganar monedas.',
    'claim': 'Reclamar', 'done': 'Reclamado',
    'types': {
      'coins': 'Gana {n} monedas hoy',
      'waves': 'Sobrevive hasta la oleada {n} en un asedio',
      'kills': 'Derrota a {n} enemigos hoy',
      'blocks': 'Coloca {n} bloques hoy'
    }
  },

  'battlePass': {
    'title': 'Pase de batalla', 'progress': '{current} / {total}', 'daysLeft': 'Quedan {n} d',
    'maxed': 'PASE DE BATALLA COMPLETADO', 'xpProgress': '{current} / {total} XP',
    'howToEarn': 'Cómo ganar XP', 'perRun': 'por asedio', 'perWave': 'por oleada resistida',
    'unlockHint': 'Alcanza {n} XP para desbloquear la siguiente recompensa; las no reclamadas se conservan.'
  },

  'dailyRewards': {
    'title': 'Recompensas diarias', 'subtitle': 'Entra cada día para mantener tu racha.',
    'day': 'Día {n}', 'dayShort': 'D{n}'
  },

  'options': {
    'title': 'Opciones', 'general': 'General', 'audio': 'Audio', 'language': 'Idioma',
    'difficulty': 'Dificultad', 'soundEffects': 'Efectos de sonido', 'music': 'Música', 'musicTrack': 'Pista de música',
    'musicTracks': { 'cozy': 'Armonía acogedora', 'trance': 'Túnel trance' },
    'close': 'Guardar y cerrar',
    'difficulties': { 'easy': 'Fácil', 'medium': 'Media', 'hard': 'Difícil' },
    'difficultyHints': {
      'easy': 'Oleadas más pequeñas y enemigos más débiles.',
      'medium': 'El asedio estándar y equilibrado.',
      'hard': 'Oleadas más densas y enemigos más duros.'
    }
  },

  'adsBlocked': {
    'title': 'No se pudo mostrar el anuncio',
    'body': 'Intentamos mostrarte un vídeo para que ganaras tu recompensa, pero algo en tu navegador bloquea los anuncios.',
    'allowPrefix': 'Permite los anuncios en',
    'allowSuffix': '(o pausa tu bloqueador para este juego) e inténtalo de nuevo.',
    'gotIt': 'Entendido'
  },
  'saveStatus': {
    'restoredTitle': 'Guardado en la nube restaurado', 'restoredBody': '+{n} monedas de bonificación por la recuperación',
    'tap': 'toca', 'pausedTitle': 'Sincronización pausada',
    'pausedBody': 'Jugando sin conexión. Tu progreso se guarda aquí.',
    'retry': 'Reintentar', 'dismiss': 'descartar'
  },
  'loading': { 'tooLong': '¿La carga tarda demasiado? Desactiva tu bloqueador de anuncios y recarga.' },
  'license': { 'denied': 'Acceso denegado: adquiere una licencia.' },
  'world': {
    'controlsHint': 'Arrastra para mirar · WASD para moverte · rueda o pellizca para acercar',
    'modeOrbit': 'Vista orbital',
    'modeFirstPerson': 'Caminar',
    'settings': {
      'title': 'Gráficos',
      'open': 'Ajustes gráficos',
      'grass': 'Detalle de hierba',
      'grassHint': 'Hierba más densa y visible desde más lejos. Baja esto si el juego se entrecorta.',
      'grassAutoHint': 'La hierba se ajusta a lo que tu dispositivo puede mover.',
      'drawnPatches': '{n} matas en pantalla · {tris}k triángulos',
      'detail': {
        'auto': 'Automático',
        'ultra': 'Ultra',
        'high': 'Alto',
        'medium': 'Medio',
        'low': 'Bajo',
        'minimum': 'Mínimo',
        'off': 'Desactivada'
      }
    }
  },

  'characters': {
    'title': 'Crea tu personaje',
    'hint': 'Arrastra para girar · desplaza o pellizca para acercar',
    'body': 'Tipo de cuerpo',
    'bodies': {
      'male': 'Masculino',
      'female': 'Femenino'
    },
    'head': 'Forma de la cabeza',
    'heads': {
      'round': 'Redonda',
      'oval': 'Ovalada',
      'square': 'Cuadrada',
      'heart': 'Corazón'
    },
    'hair': 'Pelo',
    'hairStyles': {
      'bowl': 'Corte tazón',
      'short': 'Corto',
      'ponytail': 'Coleta',
      'braids': 'Trenzas',
      'long': 'Largo',
      'bald': 'Calvo',
      'topknot': 'Moño alto',
      'buns': 'Rodetes laterales',
      'bun': 'Moño bajo',
      'plaits': 'Trenzas salientes',
      'flowing': 'Melena larga',
      'queue': 'Trenza larga',
      'bob': 'Corte paje',
      'tresses': 'Mechones al frente',
      'wild': 'Despeinado',
      'swept': 'Peinado de lado',
      'fringe': 'Flequillo grueso',
      'bearded': 'Con barba',
      'mane': 'Melena abundante',
      'coif': 'Cofia',
      'receding': 'Entradas'
    },
    'eyes': 'Ojos',
    'eyeStyles': {
      'bright': 'Brillantes',
      'wide': 'Separados',
      'close': 'Juntos',
      'tall': 'Altos',
      'small': 'Pequeños',
      'almond': 'Almendrados',
      'sleepy': 'Soñolientos',
      'sharp': 'Afilados',
      'soft': 'Suaves',
      'weary': 'Cansados'
    },
    'mouth': 'Boca',
    'mouthStyles': {
      'smile': 'Sonrisa',
      'neutral': 'Neutral',
      'frown': 'Triste',
      'grin': 'Sonrisa amplia',
      'open': 'Abierta'
    },
    'beard': 'Barba',
    'beardStyles': {
      'none': 'Bien afeitado',
      'moustache': 'Bigote',
      'goatee': 'Perilla',
      'cropped': 'Recortada',
      'muttonChops': 'Patillas',
      'full': 'Poblada',
      'forked': 'Bífida',
      'braided': 'Trenzada',
      'patriarch': 'Patriarca'
    },
    'nose': 'Nariz',
    'noseStyles': {
      'none': 'Ninguna',
      'button': 'Respingona',
      'round': 'Redonda',
      'hooked': 'Aguileña',
      'broad': 'Ancha'
    },
    'brows': 'Cejas',
    'browStyles': {
      'fine': 'Finas',
      'bushy': 'Pobladas'
    },
    'skinTone': 'Tono de piel',
    'skinToneOption': 'Tono de piel {n}',
    'hairColour': 'Color de pelo',
    'hairColourOption': 'Color de pelo {n}',
    'tunicColour': 'Color de túnica',
    'tunicColourOption': 'Color de túnica {n}',
    'outfit': 'Atuendo',
    'outfitHint': 'De qué colores está cortada una prenda. Cada túnica, jubón y gorra tiene su propio juego.',
    'equipment': 'Equipo',
    'items': {
      'hat': 'Sombrero',
      'torsoArmour': 'Armadura',
      'sword': 'Espada',
      'shield': 'Escudo'
    },
    'drawWeapon': 'Desenvainar',
    'spin': 'Giro automático',
    'randomise': 'Sorpréndeme',
    'reset': 'Empezar de nuevo',
    'save': 'Guardar personaje',
    'saved': 'Guardado',
    'back': 'Volver al mundo',
    'roster': 'Personaje',
    'newCharacter': 'Nuevo personaje',
    'unnamed': 'Sin nombre',
    'search': 'Buscar por nombre o ID',
    'noMatches': 'Ningún personaje coincide.',
    'empty': 'Aún no hay personajes guardados. Diseña uno, ponle nombre y pulsa Guardar.',
    'name': 'Nombre',
    'namePlaceholder': 'Nombra a tu personaje',
    'copyName': 'Copia de {name}',
    'id': 'ID',
    'idPending': 'Se asigna al guardar.',
    'idFixed': 'Se fija al crearlo. Las partidas y las misiones lo usan, así que cambiar el nombre nunca lo altera.',
    'duplicate': 'Duplicar',
    'delete': 'Eliminar',
    'deleteConfirm': '¿Eliminar {name}? Esto no se puede deshacer.',
    'unsavedChanges': 'Tienes cambios sin guardar.',
    'saveAndContinue': 'Guardar y continuar',
    'discard': 'Descartar'
  }
}
