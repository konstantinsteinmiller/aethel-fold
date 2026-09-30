// English source bundle. Single source of truth for translation keys — every
// new player-facing string gets a key here first; the per-language files in
// this folder mirror the shape. Vite ships each non-English locale as its own
// lazy chunk (see `src/i18n/index.ts`).
export default {
  'gameName': 'Aethel Fold',
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
    'tooLong': 'Loading taking too long? Try disabling your ad blocker and refresh.',
    'tip1': 'Swipe along a dotted arrow to fold a wall up.',
    'tip2': 'Tap a raised wall to slam it down on the knights bashing it.',
    'tip3': 'Fold the ravine shut, then tap it to crush everyone inside.',
    'tip4': 'Flip a flap under a catapult to fling it back at its own archers.',
    'tip5': 'Swipe a castle tower up to open its ballista, then tap to shoot.',
    'tip6': 'Leapers jump over walls. The sling brings them down.'
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
      'book': 'Book {b}',
      'bookPage': 'Book {b} · Page {n}/{total}',
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
      'finale': 'The Last Fold',
      'home': 'The Home Keep',
      'orchard': 'The Orchard',
      'mill': 'Windmill Hill',
      'camp': 'The Siege Camp',
      'return': 'The Dragon Returns',
      'homecoming': 'Peace at Last'
    },
    'story': {
      'b1p1': 'The Paper King’s knights are marching on the border…',
      'b1p2': 'Beyond the ravine: heavier knights, and a catapult!',
      'b1p3': 'Archers on the walls. Shields up, and fling them back!',
      'b1p4': 'The castle gates. Tear them open!',
      'b1p5': 'Deep inside the castle, something is unfolding…',
      'b1p6': 'The dragon is only paper now. One last fold.',
      'b2p1': 'The frog hopped home… now the King marches on YOUR keep!',
      'b2p2': 'Leapers on paper springs jump any wall. Use the sling!',
      'b2p3': 'Catapults on Windmill Hill. Fling them back, again and again!',
      'b2p4': 'The whole siege camp is coming for the gate.',
      'b2p5': 'The dragon returns!',
      'b2p6': 'Fold it into a crane, and let it fly away in peace.'
    },
    'books': {
      'title': 'Books',
      'hint': 'Pick a book. It starts on page 1.',
      'name1': 'Book 1: The Paper Dragon',
      'name2': 'Book 2: The Homefront',
      'blurb1': 'March on the enemy castle.',
      'blurb2': 'Defend your own keep.',
      'locked': 'Win book 1 to unlock.'
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
      'combo': 'COMBO ×{n}',
      'thwack': 'THWACK!',
      'boing': 'BOING!',
      'twang': 'TWANG!',
      'flap': 'FLAP!'
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
      'frog': 'One last fold…',
      'ballista': 'Swipe up the tower to open the ballista, then tap to shoot',
      'crush': 'Tap the wall to slam it down on them',
      'sling': 'Pull the sling back, aim, and let go',
      'leaper': 'Leapers jump walls. Sling them!'
    },
    'pause': {
      'title': 'Paused',
      'resume': 'Resume',
      'restartPage': 'Restart page',
      'newGame': 'Start book over',
      'confirmNew': 'Start this book again from page 1? This run will be lost.',
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
      'playAgain': 'Play again',
      'subtitle2': 'The dragon is a paper crane now!',
      'story1': '…but the frog hopped away to warn the Paper King. He is coming for your keep!',
      'story2': 'Your keep stands. The crane flies home in peace.',
      'nextBook': 'Book 2: The Homefront',
      'backToBook1': 'Read book 1 again'
    },
    'a11y': {
      'board': 'Aethel Fold — a pop-up book on a desk'
    }
  }
}
