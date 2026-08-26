// English source bundle. Single source of truth for translation keys — every
// new player-facing string gets a key here first; the per-language files in
// this folder mirror the shape. Vite ships each non-English locale as its own
// lazy chunk (see `src/i18n/index.ts`).
export default {
  'gameName': '3d-world',
  'cancel': 'Cancel',
  'close': 'Close',
  'ok': 'Ok',
  'continue': 'Continue',
  'tapToContinue': 'Tap to continue',
  'clickToContinue': 'Click to continue',
  'rewards': 'REWARDS',
  'tip': 'Tip',
  'crazyGamesOnly': 'This game is only available on',

  // ─── HUD ──────────────────────────────────────────────────────────────────
  'hud': {
    'wave': 'Wave',
    'enemies': 'Enemies',
    'callWave': 'Call Wave',
    'callBoss': 'Call Boss',
    'speed': 'Speed {n}×',
    'speedOffer': 'Double speed for an ad',
    'speedFor': '{n} min',
    'recenter': 'Recentre the view'
  },

  // ─── Control hints ────────────────────────────────────────────────────────
  // Each has a touch and a pointer phrasing — a wrong verb reads as a bug.
  'hints': {
    'selectBlock': {
      'touch': 'Tap a block below to pick it',
      'desktop': 'Click a block below to pick it'
    },
    'placeBlock': {
      'touch': 'Now tap a glowing slot to build',
      'desktop': 'Now click a glowing slot to build'
    },
    'camera': {
      'touch': 'Drag to pan · Pinch to zoom',
      'desktop': 'Drag to pan · Scroll to zoom'
    },
    'callWave': {
      'touch': 'Tap Call Wave when your tower is ready',
      'desktop': 'Press Space to call the wave early'
    },
    'inspect': {
      'touch': 'Hold a block to inspect it',
      'desktop': 'Click a block to inspect it'
    }
  },

  // ─── Blocks ───────────────────────────────────────────────────────────────
  'blocks': {
    'sell': 'Sell',
    'roofNote': 'Roofed — double HP, triple defence from above. Needs clear sky.',
    'enhancedNote': 'Reinforced — extra HP and extra damage.',
    'enhancedHand': 'Reinforced hand',
    'reroll': 'Swap this piece',
    'kinds': {
      'core': 'Core',
      'structure': 'Structure',
      'weapon': 'Weapon',
      'economy': 'Economy',
      'utility': 'Utility'
    },
    'stats': {
      'hp': 'HP',
      'armor': 'Armour',
      'dmg': 'Damage',
      'cooldown': 'Cooldown',
      'range': 'Range',
      'splash': 'Splash',
      'yieldWood': 'Wood / wave',
      'yieldStone': 'Stone / wave',
      'yieldCoins': 'Coins / wave',
      'repair': 'Repair / wave',
      'blast': 'Death blast',
      'thorns': 'Thorns'
    },
    'names': {
      'gate': 'Gate',
      'wood': 'Wood Crate',
      'brace': 'Braced Crate',
      'stone': 'Stone Block',
      'archer': 'Archery',
      'cannon': 'Cannon',
      'mortar': 'Mortar',
      'tesla': 'Lightning Coil',
      'frost': 'Frost Spire',
      'repair': 'Repair Bay',
      'sawmill': 'Sawmill',
      'quarry': 'Quarry',
      'mint': 'Gold Mine',
      'spikes': 'Spiked Wall',
      'bombard': 'Bombard'
    },
    'descriptions': {
      'gate': 'The heart of your tower. Lose it and the siege is over.',
      'wood': 'Cheap filler. The backbone of every early tower.',
      'brace': 'Twice the wood, more than twice the staying power.',
      'stone': 'Heavy and armoured. Best spent on the base.',
      'archer': 'Fast single-target arrows. Hits fliers.',
      'cannon': 'Slow, heavy splash. Melts packed crowds.',
      'mortar': 'Long-range arcing shells — but it cannot hit fliers.',
      'tesla': 'Bolts that fork between nearby enemies.',
      'frost': 'Chills a whole cluster and slows it to a crawl.',
      'repair': 'Patches every neighbouring block between waves.',
      'sawmill': 'Produces wood at the end of every cleared wave.',
      'quarry': 'Produces stone at the end of every cleared wave.',
      'mint': 'Produces coins at the end of every cleared wave.',
      'spikes': 'Attackers wound themselves on it every time they strike.',
      'bombard': 'Lobs a shell straight up. Small blast, ground targets only.'
    }
  },

  // ─── Enemies ──────────────────────────────────────────────────────────────
  'enemies': {
    'names': {
      'grunt': 'Grunt',
      'runner': 'Runner',
      'slinger': 'Slinger',
      'brute': 'Brute',
      'bomber': 'Bomber',
      'bat': 'Bat',
      'bulwark': 'Bulwark',
      'golem': 'Siege Golem',
      'wyvern': 'Wyvern',
      'eel': 'Sea Serpent',
      'shark': 'Reefshark',
      'kraken': 'Kraken',
      'seadrake': 'Sea Drake',
      'ram': 'Battering Ram',
      'ballista': 'Ballista',
      'catapult': 'Catapult',
      'siegeTower': 'Siege Tower',
      'trebuchet': 'Trebuchet',
      'ironRam': 'Ironclad Ram',
      'bombardier': 'Bombardier',
      'firebug': 'Firebug'
    }
  },

  // ─── Result / run summary ─────────────────────────────────────────────────
  // ─── First-stage tutorial ─────────────────────────────────────────────────
  'tutorial': {
    'gate': 'Protect the Gate. If it falls, the run ends.',
    'pick': 'Pick a piece.',
    'place': 'Place it next to the Gate.',
    'call': 'Call the wave when you are ready.',
    'next': 'Next',
    'offer': 'Need a tutorial?',
    'start': 'Start',
    'skip': 'Skip'
  },

  // ─── Allies ───────────────────────────────────────────────────────────────
  'allies': {
    'cavalry': 'Cavalry'
  },

  'result': {
    'towerFell': 'The Tower Fell!',
    'reachedWave': 'You survived to wave {n}',
    'newRecord': 'New record!',
    'upgrade': 'Upgrade!',
    'defendAgain': 'Defend again',
    'continueRun': 'Rebuild & continue',
    'double': 'Double coins',
    'firstRunDouble': '2× — first siege today!',
    'tripleWave': '3× coins — {n}',
    'waveCleared': 'Wave {n} held!',
    'scoreLabel': 'Score',
    'bestLabel': 'Best score',
    'scoreCurrent': '({n} this run)',
    'rankLabel': 'Rank',
    'rankOf': 'of {n}'
  },

  // ─── Tech tree ────────────────────────────────────────────────────────────
  'tech': {
    'title': 'Tech Tree',
    'rank': 'Rank {current}/{total}',
    'maxed': 'Maxed',
    'rankOpen': 'Rank {n}',
    'atRank': 'At rank {r}: {n} total',
    'owned': 'Unlocked',
    'requires': 'Requires {n}',
    'spotlight': 'Spend!',
    'names': {
      'foundations': 'Foundations',
      'sharpBolts': 'Sharpened Bolts',
      'unlockBrace': 'Braced Crates',
      'lumberStock': 'Lumber Stockpile',
      'longSight': 'Long Sight',
      'rapidFire': 'Rapid Fire',
      'reinforced': 'Reinforced Beams',
      'unlockSawmill': 'Sawmill',
      'quarryStock': 'Stone Stockpile',
      'unlockMortar': 'Mortar',
      'heavyOrdnance': 'Heavy Ordnance',
      'unlockTesla': 'Lightning Coil',
      'gateArmor': 'Gate Armour',
      'unlockQuarry': 'Quarry',
      'richHauls': 'Rich Hauls',
      'wideFoundation': 'Wide Foundation',
      'siegeShells': 'Siege Shells',
      'unlockFrost': 'Frost Spire',
      'forkedBolts': 'Forked Bolts',
      'ironPlating': 'Iron Plating',
      'unlockRepair': 'Repair Bay',
      'unlockMint': 'Gold Mine',
      'looting': 'Looting',
      'overcharge': 'Overcharge',
      'masterwork': 'Masterwork',
      'fieldRepairs': 'Field Repairs',
      'greatFoundation': 'Great Foundation',
      'warChest': 'War Chest',
      'unlockSpikes': 'Spiked Wall',
      'unlockBombard': 'Bombard',
      'sharpSpikes': 'Honed Spikes',
      'cavalryDrill': 'Cavalry Drill',
      'artilleryDoctrine': 'Artillery Doctrine'
    },
    'descriptions': {
      'foundations': 'Every block starts with +{n}% HP.',
      'sharpBolts': 'All weapons deal +{n}% damage per rank.',
      'unlockBrace': 'Unlocks the Braced Crate — twice the HP of plain wood.',
      'lumberStock': 'Start each siege with +{n} wood per rank.',
      'longSight': 'All weapons reach +{n}% further per rank.',
      'rapidFire': 'All weapons fire {n}% faster per rank.',
      'reinforced': 'Every block gains +{n}% HP per rank.',
      'unlockSawmill': 'Unlocks the Sawmill — produces wood each wave.',
      'quarryStock': 'Start each siege with +{n} stone per rank.',
      'unlockMortar': 'Unlocks the Mortar — long-range arcing splash.',
      'heavyOrdnance': 'Splash radius +{n}% per rank.',
      'unlockTesla': 'Unlocks the Lightning Coil — bolts fork between enemies.',
      'gateArmor': 'The Gate gains +{n}% HP per rank.',
      'unlockQuarry': 'Unlocks the Quarry — produces stone each wave.',
      'richHauls': 'Wave rewards +{n}% per rank.',
      'wideFoundation': 'Build {n} columns wider per rank.',
      'siegeShells': 'All weapons deal +{n}% damage per rank.',
      'unlockFrost': 'Unlocks the Frost Spire — slows whole clusters.',
      'forkedBolts': 'Lightning forks to {n} extra enemy per rank.',
      'ironPlating': 'Every block gains +{n} armour per rank.',
      'unlockRepair': 'Unlocks the Repair Bay — heals neighbours each wave.',
      'unlockMint': 'Unlocks the Gold Mine — produces coins each wave.',
      'looting': 'Enemies drop +{n}% more coins per rank.',
      'overcharge': 'All weapons fire {n}% faster per rank.',
      'masterwork': 'All weapons deal +{n}% damage per rank.',
      'fieldRepairs': 'Every block heals {n}% of its max HP per cleared wave, per rank.',
      'greatFoundation': 'Build {n} more columns wider per rank.',
      'warChest': 'Wave rewards +{n}% per rank.',
      'unlockSpikes': 'Unlocks the Spiked Wall — attackers wound themselves on it.',
      'unlockBombard': 'Unlocks the Bombard — short-range mortar fire against ground troops.',
      'sharpSpikes': 'Spiked walls reflect +{n}% more damage per rank.',
      'cavalryDrill': 'Cavalry ride out with +{n}% HP and damage per rank.',
      'artilleryDoctrine': 'All weapons reach +{n}% further per rank.'
    }
  },

  // ─── Resources ────────────────────────────────────────────────────────────
  'resources': {
    'wood': 'wood',
    'stone': 'stone',
    'coins': 'coins'
  },

  // ─── Ads ──────────────────────────────────────────────────────────────────
  'ads': {
    'watch': 'Watch',
    'revive': 'Revive',
    'secondChance': 'Second Chance',
    'doubleCoins': '2× Coins',
    'plusCoins': '+{n} coins'
  },

  // ─── Achievements ─────────────────────────────────────────────────────────
  'achievements': {
    'title': 'Achievements',
    'subtitle': 'Hit lifetime milestones to earn coins.',
    'claim': 'Claim',
    'claimed': 'Claimed',
    'progress': '{c} / {t}',
    'items': {
      'wave5': { 'name': 'First Stand', 'desc': 'Survive to wave 5.' },
      'wave10': { 'name': 'Stronghold', 'desc': 'Survive to wave 10.' },
      'wave20': { 'name': 'Bulwark', 'desc': 'Survive to wave 20.' },
      'wave30': { 'name': 'Unbreakable', 'desc': 'Survive to wave 30.' },
      'waves50': { 'name': 'Wave Breaker', 'desc': 'Clear 50 waves in total.' },
      'waves250': { 'name': 'Siege Veteran', 'desc': 'Clear 250 waves in total.' },
      'kills500': { 'name': 'Defender', 'desc': 'Defeat 500 enemies in total.' },
      'kills5k': { 'name': 'Slayer', 'desc': 'Defeat 5,000 enemies in total.' },
      'kills50k': { 'name': 'Legend', 'desc': 'Defeat 50,000 enemies in total.' },
      'height10': { 'name': 'Skyward', 'desc': 'Build a tower 10 blocks tall.' },
      'height20': { 'name': 'Cloudpiercer', 'desc': 'Build a tower 20 blocks tall.' },
      'blocks250': { 'name': 'Builder', 'desc': 'Place 250 blocks in total.' },
      'blocks2k': { 'name': 'Architect', 'desc': 'Place 2,000 blocks in total.' },
      'coins5k': { 'name': 'Coin Collector', 'desc': 'Earn 5,000 coins in total.' },
      'coins50k': { 'name': 'Treasurer', 'desc': 'Earn 50,000 coins in total.' },
      'runs25': { 'name': 'Persistent', 'desc': 'Start 25 sieges.' }
    }
  },

  // ─── Daily missions ───────────────────────────────────────────────────────
  'missions': {
    'title': 'Daily Missions',
    'subtitle': 'Complete goals each day for coins.',
    'claim': 'Claim',
    'done': 'Claimed',
    'types': {
      'coins': 'Earn {n} coins today',
      'waves': 'Survive to wave {n} in one siege',
      'kills': 'Defeat {n} enemies today',
      'blocks': 'Place {n} blocks today'
    }
  },

  // ─── Battle pass ──────────────────────────────────────────────────────────
  'battlePass': {
    'title': 'Battle Pass',
    'progress': '{current} / {total}',
    'daysLeft': '{n}d left',
    'maxed': 'BATTLE PASS COMPLETE',
    'xpProgress': '{current} / {total} XP',
    'howToEarn': 'How to earn XP',
    'perRun': 'per siege',
    'perWave': 'per wave held',
    'unlockHint': 'Reach {n} XP to unlock the next reward — unclaimed rewards stay until you tap them.'
  },

  // ─── Daily rewards ────────────────────────────────────────────────────────
  'dailyRewards': {
    'title': 'Daily Rewards',
    'subtitle': 'Sign in every day to keep your streak.',
    'day': 'Day {n}',
    'dayShort': 'D{n}'
  },

  // ─── Options ──────────────────────────────────────────────────────────────
  'options': {
    'title': 'Options',
    'general': 'General',
    'audio': 'Audio',
    'language': 'Language',
    'difficulty': 'Difficulty',
    'soundEffects': 'Sound Effects',
    'music': 'Music',
    'musicTrack': 'Music Track',
    'musicTracks': {
      'cozy': 'Cozy Harmony',
      'trance': 'Trance Tunnel'
    },
    'close': 'Save & Close',
    'difficulties': {
      'easy': 'Easy',
      'medium': 'Medium',
      'hard': 'Hard'
    },
    'difficultyHints': {
      'easy': 'Smaller waves and softer enemies.',
      'medium': 'The standard, balanced siege.',
      'hard': 'Denser waves and tougher enemies.'
    }
  },

  // ─── System ───────────────────────────────────────────────────────────────
  'adsBlocked': {
    'title': "Couldn't show ad",
    'body': 'We tried to show you a video so you could earn your reward, but something on your browser is blocking ads.',
    'allowPrefix': 'Please allow ads on',
    'allowSuffix': '(or pause your ad-blocker for this game) and try again.',
    'gotIt': 'Got it'
  },
  'saveStatus': {
    'restoredTitle': 'Cloud save restored',
    'restoredBody': '+{n} bonus coins for the recovery',
    'tap': 'tap',
    'pausedTitle': 'Cloud sync paused',
    'pausedBody': 'Playing offline. Your progress is saved here.',
    'retry': 'Retry',
    'dismiss': 'dismiss'
  },
  'loading': {
    'tooLong': 'Loading taking too long? Try disabling your ad blocker and refresh.'
  },
  'license': {
    'denied': 'Access Denied: Please purchase a license.'
  }
,
  'world': {
    'controlsHint': 'Drag to look around · WASD to move · scroll or pinch to zoom',
    'modeOrbit': 'Orbit view',
    'modeFirstPerson': 'Walk',
    'settings': {
      'title': 'Graphics',
      'open': 'Graphics settings',
      'grass': 'Grass detail',
      'grassHint': 'Thicker grass, drawn further away. Lower this if the game stutters.',
      'grassAutoHint': 'Grass follows what your device can handle.',
      'drawnPatches': '{n} patches on screen · {tris}k triangles',
      'detail': {
        'auto': 'Auto',
        'ultra': 'Ultra',
        'high': 'High',
        'medium': 'Medium',
        'low': 'Low',
        'minimum': 'Minimum',
        'off': 'Off'
      }
    }
  },

  // ─── Character creation (/characters) ─────────────────────────────────────
  // Player-facing, unlike the editor overlays — so every string here is
  // translated into all 21 locales. A missing key ships as a raw key string.
  'characters': {
    'title': 'Create your character',
    'hint': 'Drag to turn · scroll or pinch to zoom',
    'body': 'Body type',
    'bodies': {
      'male': 'Masculine',
      'female': 'Feminine'
    },
    'head': 'Head shape',
    'heads': {
      'round': 'Round',
      'oval': 'Oval',
      'square': 'Square',
      'heart': 'Heart'
    },
    'hair': 'Hair',
    'hairStyles': {
      'bowl': 'Bowl cut',
      'short': 'Short',
      'ponytail': 'Ponytail',
      'braids': 'Braids',
      'long': 'Long',
      'bald': 'Bald',
      'topknot': 'Topknot',
      'buns': 'Coiled buns',
      'bun': 'Low bun',
      'plaits': 'Plaits',
      'flowing': 'Flowing',
      'queue': 'Long braid',
      'bob': 'Page cut',
      'tresses': 'Tresses',
      'wild': 'Unkempt',
      'swept': 'Swept aside',
      'fringe': 'Heavy fringe',
      'bearded': 'Bearded',
      'mane': 'Mane',
      'coif': 'Coif',
      'receding': 'Receding'
    },
    'eyes': 'Eyes',
    'eyeStyles': {
      'bright': 'Bright',
      'wide': 'Wide-set',
      'close': 'Close-set',
      'tall': 'Tall',
      'small': 'Small',
      'almond': 'Almond',
      'sleepy': 'Sleepy',
      'sharp': 'Sharp',
      'soft': 'Soft',
      'weary': 'Weary'
    },
    'mouth': 'Mouth',
    'mouthStyles': {
      'smile': 'Smile',
      'neutral': 'Neutral',
      'frown': 'Frown',
      'grin': 'Grin',
      'open': 'Open'
    },
    'beard': 'Beard',
    'beardStyles': {
      'none': 'Clean-shaven',
      'moustache': 'Moustache',
      'goatee': 'Goatee',
      'cropped': 'Cropped',
      'muttonChops': 'Mutton chops',
      'full': 'Full beard',
      'forked': 'Forked',
      'braided': 'Braided',
      'patriarch': 'Patriarch'
    },
    'nose': 'Nose',
    'noseStyles': {
      'none': 'None',
      'button': 'Button',
      'round': 'Round',
      'hooked': 'Hooked',
      'broad': 'Broad'
    },
    'brows': 'Brows',
    'browStyles': {
      'fine': 'Fine',
      'bushy': 'Bushy'
    },
    'skinTone': 'Skin tone',
    'skinToneOption': 'Skin tone {n}',
    'hairColour': 'Hair colour',
    'hairColourOption': 'Hair colour {n}',
    'tunicColour': 'Tunic colour',
    'tunicColourOption': 'Tunic colour {n}',
    'outfit': 'Outfit',
    'outfitHint': 'Which colours a garment is cut from. Every robe, jerkin and cap has its own set.',
    'equipment': 'Equipment',
    'items': {
      'hat': 'Hat',
      'torsoArmour': 'Armour',
      'sword': 'Sword',
      'shield': 'Shield'
    },
    'drawWeapon': 'Draw weapon',
    'spin': 'Turntable',
    'randomise': 'Surprise me',
    'reset': 'Start over',
    'save': 'Save character',
    'saved': 'Saved',
    'back': 'Back to the world',
    // ── The roster: several saved characters, one open at a time ────────────
    // `id` is shown and never editable — a save file, a quest and a spawn table
    // all refer to a character by it, so an editable id is a rename that breaks
    // every one of those references silently. `idFixed` is where that is said.
    'roster': 'Character',
    'newCharacter': 'New character',
    'unnamed': 'Unnamed',
    // The roster list is searchable because it holds up to 64 characters and a
    // city wants a named one out of it fast. Name *and* id are matched — the id
    // is what a quest or spawn table calls a character, so it has to be findable.
    'search': 'Search by name or ID',
    'noMatches': 'No characters match.',
    'empty': 'No characters saved yet. Design one, give it a name and press Save.',
    'name': 'Name',
    'namePlaceholder': 'Name your character',
    'copyName': '{name} copy',
    'id': 'ID',
    'idPending': 'Assigned when you save.',
    'idFixed': 'Fixed at creation. Saves and quests refer to it, so renaming never changes it.',
    'duplicate': 'Duplicate',
    'delete': 'Delete',
    'deleteConfirm': 'Delete {name}? This cannot be undone.',
    'unsavedChanges': 'You have unsaved changes.',
    'saveAndContinue': 'Save and continue',
    'discard': 'Discard'
  }
}
