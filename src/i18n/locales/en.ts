// English source bundle. Single source of truth for translation keys — every
// new player-facing string gets a key here first; the per-language files in
// this folder mirror the shape. Vite ships each non-English locale as its own
// lazy chunk (see `src/i18n/index.ts`).
export default {
  'gameName': 'Castle Fold',
  'cancel': 'Cancel',
  'close': 'Close',
  'ok': 'Ok',
  'continue': 'Continue',
  'tapToContinue': 'Tap to continue',
  'clickToContinue': 'Click to continue',
  'rewards': 'REWARDS',
  'tip': 'Tip',
  'crazyGamesOnly': 'This game is only available on',
  'adsBlocked': {
    'title': 'Couldn\'t show ad',
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
  },
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
    'roster': 'Character',
    'newCharacter': 'New character',
    'unnamed': 'Unnamed',
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
  },
  'menu': {
    'back': 'Back'
  },
  'settings': {
    'title': 'Settings',
    'audio': 'Audio',
    'graphics': 'Graphics',
    'keybindings': 'Controls',
    'master': 'Master volume',
    'music': 'Music',
    'effects': 'Effects',
    'voice': 'Voices',
    'mute': 'Mute everything',
    'grass': 'Grass detail',
    'grassHint': 'Thicker grass, drawn further away. Lower this if the game stutters.',
    'renderScale': 'Render scale',
    'renderScaleHint': 'Renders smaller and scales up. The cheapest way to buy frame rate.',
    'shadows': 'Shadows',
    'outlines': 'Outlines',
    'wind': 'Wind',
    'adaptive': 'Adaptive quality',
    'adaptiveHint': 'Let the game lower detail on its own when the frame rate drops.',
    'fpsMonitor': 'Show frame rate',
    'reset': 'Reset to defaults',
    'rebind': 'Click a key to change it',
    'pressKey': 'Press a key…',
    'mouseNotAllowed': 'That one needs a keyboard key',
    'resetBindings': 'Reset controls',
    'fps': '{n} fps',
    'percent': '{n}%'
  },
  'controls': {
    'title': 'Controls',
    'minimise': 'Minimise',
    'expand': 'Show controls',
    'unbound': '—',
    'mouseLeft': 'LMB',
    'mouseMiddle': 'MMB',
    'mouseRight': 'RMB',
    'group': {
      'move': 'Movement',
      'fight': 'Combat',
      'world': 'World',
      'system': 'Game'
    },
    'action': {
      'moveForward': 'Forward',
      'moveBack': 'Back',
      'moveLeft': 'Left',
      'moveRight': 'Right',
      'sprint': 'Sprint',
      'dodge': 'Dodge roll',
      'attackLight': 'Attack',
      'attackHeavy': 'Heavy attack',
      'guardOrAim': 'Guard / Aim',
      'guardMelee': 'Guard · parry on time',
      'guardBow': 'Aim the bow',
      'drawWeapon': 'Draw / sheathe',
      'interact': 'Interact',
      'pause': 'Pause',
      'quickSave': 'Quick save',
      'quickLoad': 'Quick load',
      'toggleControls': 'Hide these'
    },
    'look': 'Look around',
    'mouse': 'Mouse'
  },
  'story': {
    'sit': 'Sit',
    'seated': 'Press {key} or Esc to stand'
  },
  'fold': {
    'hud': {
      'page': 'Page {n}/{total}',
      'score': 'Score',
      'best': 'Best',
      'settings': 'Pause and settings',
      'hearts': '{n} of {max} hearts left',
      'dragon': 'Dragon',
      'boss': '{n} weak points left'
    },
    'page': {
      'border': 'The Border',
      'ravine': 'The Ravine',
      'siege': 'The Siege',
      'gates': 'The Castle Gates',
      'core': 'The Castle Core',
      'finale': 'The Last Fold'
    },
    'fx': {
      'snap': 'SNAP!',
      'fold': 'FOLD!',
      'fling': 'FLING!',
      'stamp': 'STAMP!',
      'rip': 'RIP!',
      'crease': 'CREASE!',
      'roar': 'GROUAAARGH!',
      'ribbit': 'RIBBIT!',
      'crash': 'CRASH!',
      'blocked': 'BLOCKED!',
      'perfect': 'PERFECT PAGE!',
      'combo': 'COMBO ×{n}'
    },
    'hint': {
      'swipe': 'Swipe along the dotted arrow to fold the page',
      'stamp': 'Fold the ravine shut, then tap it to stamp',
      'shield': 'Swipe to fold up a shield',
      'launch': 'Flip the flap to fling the catapult back',
      'ridge': 'Fold the hill up to close the road',
      'spreadTouch': 'Spread two fingers on the glowing crease',
      'spreadMouse': 'Drag across the glowing crease (or scroll on it)',
      'peel': 'Drag the corner to peel back the page',
      'crease': 'Swipe along the glowing crease',
      'frog': 'One last fold…'
    },
    'pause': {
      'title': 'Paused',
      'resume': 'Resume',
      'restartPage': 'Restart page',
      'newGame': 'New book',
      'confirmNew': 'Start a new book from page 1? This run will be lost.',
      'confirmYes': 'Yes, start over',
      'confirmNo': 'Keep playing',
      'settings': 'Settings',
      'back': 'Back'
    },
    'settings': {
      'music': 'Music',
      'sfx': 'Sound effects',
      'haptics': 'Vibration',
      'shake': 'Screen shake',
      'quality': 'Graphics',
      'qualityAuto': 'Auto',
      'qualityHigh': 'Sharp',
      'qualityLow': 'Fast',
      'language': 'Language'
    },
    'victory': {
      'title': 'VICTORY',
      'subtitle': 'The dragon is now a paper frog!',
      'flawless': 'Flawless! Not a single heart lost!',
      'score': 'Score',
      'best': 'Best',
      'time': 'Time',
      'hits': 'Hearts lost',
      'newBest': 'New record!',
      'playAgain': 'Play again'
    },
    'a11y': {
      'board': 'Castle Fold — a pop-up book on a desk'
    }
  }
}
