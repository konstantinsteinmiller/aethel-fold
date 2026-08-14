export default {
  'gameName': '3d-world',
  'cancel': '취소',
  'close': '닫기',
  'ok': '확인',
  'continue': '계속',
  'tapToContinue': '탭하여 계속',
  'clickToContinue': '클릭하여 계속',
  'rewards': '보상',
  'tip': '팁',
  'crazyGamesOnly': '이 게임은 다음에서만 이용할 수 있습니다:',

  'hud': {
    'wave': '웨이브', 'enemies': '적', 'callWave': '웨이브 호출', 'callBoss': '보스 호출',
    'speed': '속도 {n}×',
    'speedOffer': '광고 보고 2배속',
    'speedFor': '{n}분', 'recenter': '화면 중앙 정렬'
  },

  'hints': {
    'selectBlock': { 'touch': '아래 블록을 탭해 선택하세요', 'desktop': '아래 블록을 클릭해 선택하세요' },
    'placeBlock': { 'touch': '이제 빛나는 칸을 탭해 건설하세요', 'desktop': '이제 빛나는 칸을 클릭해 건설하세요' },
    'camera': { 'touch': '드래그로 이동 · 핀치로 확대', 'desktop': '드래그로 이동 · 스크롤로 확대' },
    'callWave': { 'touch': '타워가 준비되면 «웨이브 호출»을 탭하세요', 'desktop': '스페이스바로 웨이브를 일찍 호출' },
    'inspect': { 'touch': '블록을 길게 눌러 확인하세요', 'desktop': '블록을 클릭해 확인하세요' }
  },

  'blocks': {
    'sell': '판매',
    'roofNote': '지붕 있음 — 체력 2배, 위쪽 공격 방어 3배. 위가 비어 있어야 합니다.',
    'enhancedNote': '강화됨 — 체력과 피해량이 더 높습니다.',
    'enhancedHand': '강화 블록',
    'reroll': '이 조각 교체',
    'kinds': { 'core': '핵심', 'structure': '구조', 'weapon': '무기', 'economy': '경제', 'utility': '보조' },
    'stats': {
      'hp': '체력', 'armor': '방어', 'dmg': '피해', 'cooldown': '재사용', 'range': '사거리',
      'splash': '범위', 'yieldWood': '목재 / 웨이브', 'yieldStone': '석재 / 웨이브', 'yieldCoins': '코인 / 웨이브',
      'repair': '수리 / 웨이브', 'blast': '폭발',
      'thorns': '가시'
    },
    'names': {
      'gate': '성문', 'wood': '나무 상자', 'brace': '보강 상자', 'stone': '석재 블록',
      'archer': '궁수탑', 'cannon': '대포', 'mortar': '박격포', 'tesla': '번개 코일',
      'frost': '서리 첨탑', 'repair': '수리소',
      'sawmill': '제재소', 'quarry': '채석장', 'mint': '금광',
      'spikes': '가시벽',
      'bombard': '박격포탑'
    },
    'descriptions': {
      'gate': '타워의 심장. 무너지면 공성전은 끝납니다.',
      'wood': '저렴한 채움재. 초반 타워의 척추.',
      'brace': '목재는 두 배, 내구는 두 배 이상.',
      'stone': '무겁고 방어력이 높습니다. 바닥에 가장 적합.',
      'archer': '단일 대상 빠른 화살. 비행 적도 맞힙니다.',
      'cannon': '느리지만 강력한 범위 피해. 밀집한 무리를 녹입니다.',
      'mortar': '장거리 곡사 포격 — 다만 비행 적은 맞히지 못합니다.',
      'tesla': '근처 적들 사이로 튀는 번개.',
      'frost': '무리 전체를 얼려 크게 둔화시킵니다.',
      'repair': '웨이브 사이에 인접 블록을 수리합니다.',
      'sawmill': '웨이브를 막을 때마다 목재를 생산합니다.',
      'quarry': '웨이브를 막을 때마다 석재를 생산합니다.',
      'mint': '웨이브를 막을 때마다 코인을 생산합니다.',
      'spikes': '때리는 적은 매번 그 피해를 그대로 되돌려 받습니다.',
      'bombard': '포탄을 수직으로 쏘아 올립니다. 폭발은 작고 지상 목표만 타격.'
    }
  },

  'enemies': {
    'names': {
      'grunt': '병졸', 'runner': '주자', 'slinger': '투석병', 'brute': '거한',
      'bomber': '폭탄병', 'bat': '박쥐', 'bulwark': '방패병', 'golem': '공성 골렘',
      'wyvern': '와이번',
      'eel': '바다뱀',
      'shark': '암초 상어',
      'kraken': '크라켄',
      'seadrake': '바다 드래곤',
      'ram': '충차',
      'ballista': '발리스타',
      'catapult': '투석기',
      'siegeTower': '공성탑',
      'trebuchet': '트레뷰셋',
      'ironRam': '철갑 충차',
      'bombardier': '폭격병',
      'firebug': '화염병 투척병'
    }
  },

  // ─── First-stage tutorial ─────────────────────────────────────────────────
  'tutorial': {
    'gate': '성문을 지켜라. 무너지면 끝이다.',
    'pick': '조각을 하나 골라라.',
    'place': '성문 옆에 놓아라.',
    'call': '준비되면 웨이브를 불러라.',
    'next': '다음',
    'offer': '튜토리얼이 필요한가요?',
    'start': '시작',
    'skip': '건너뛰기'
  },

  // ─── Allies ───────────────────────────────────────────────────────────────
  'allies': {
    'cavalry': '기병'
  },

  'result': {
    'towerFell': '타워가 무너졌다!',
    'reachedWave': '웨이브 {n}까지 버텼습니다',
    'newRecord': '신기록!',
    'upgrade': '업그레이드!',
    'defendAgain': '다시 방어',
    'continueRun': '재건하고 계속',
    'double': '코인 2배',
    'firstRunDouble': '2× — 오늘의 첫 공성전!',
    'tripleWave': '코인 3배 — {n}',
    'waveCleared': '웨이브 {n} 방어 성공!',
    'scoreLabel': '점수',
    'bestLabel': '최고 점수',
    'scoreCurrent': '(이번 판 {n})',
    'rankLabel': '순위',
    'rankOf': '{n}명 중'
  },

  'tech': {
    'title': '테크 트리',
    'rank': '등급 {current}/{total}',
    'maxed': '최대',
    'rankOpen': '{n}랭크',
    'atRank': '랭크 {r}: 총 {n}',
    'owned': '해금됨',
    'requires': '필요: {n}',
    'spotlight': '사용하세요!',
    'names': {
      'foundations': '기초', 'sharpBolts': '날카로운 화살', 'unlockBrace': '보강 상자',
      'lumberStock': '목재 비축', 'longSight': '원시', 'rapidFire': '속사',
      'reinforced': '보강 들보', 'unlockSawmill': '제재소', 'quarryStock': '석재 비축',
      'unlockMortar': '박격포', 'heavyOrdnance': '중포', 'unlockTesla': '번개 코일',
      'gateArmor': '성문 장갑', 'unlockQuarry': '채석장', 'richHauls': '풍성한 전리품',
      'wideFoundation': '넓은 기초', 'siegeShells': '공성 포탄', 'unlockFrost': '서리 첨탑',
      'forkedBolts': '갈라지는 번개', 'ironPlating': '철갑', 'unlockRepair': '수리소',
      'unlockMint': '금광', 'looting': '약탈', 'overcharge': '과충전',
      'masterwork': '명작', 'fieldRepairs': '야전 수리', 'greatFoundation': '대기초',
      'warChest': '군자금',
      'unlockSpikes': '가시벽',
      'unlockBombard': '박격포탑',
      'sharpSpikes': '날 선 가시',
      'cavalryDrill': '기병 훈련',
      'artilleryDoctrine': '포병 교리'
    },
    'descriptions': {
      'foundations': '모든 블록이 체력 +{n}%로 시작합니다.',
      'sharpBolts': '모든 무기의 피해가 등급당 +{n}%.',
      'unlockBrace': '보강 상자 해금 — 목재의 두 배 체력.',
      'lumberStock': '공성전 시작 목재가 등급당 +{n}.',
      'longSight': '모든 무기의 사거리가 등급당 +{n}%.',
      'rapidFire': '모든 무기의 공격 속도가 등급당 +{n}%.',
      'reinforced': '모든 블록의 체력이 등급당 +{n}%.',
      'unlockSawmill': '제재소 해금 — 매 웨이브 목재 생산.',
      'quarryStock': '공성전 시작 석재가 등급당 +{n}.',
      'unlockMortar': '박격포 해금 — 장거리 범위 피해.',
      'heavyOrdnance': '범위 반경이 등급당 +{n}%.',
      'unlockTesla': '번개 코일 해금 — 번개가 적 사이로 튑니다.',
      'gateArmor': '성문 체력이 등급당 +{n}%.',
      'unlockQuarry': '채석장 해금 — 매 웨이브 석재 생산.',
      'richHauls': '웨이브 보상이 등급당 +{n}%.',
      'wideFoundation': '건설 가능 폭이 등급당 {n}칸 확장.',
      'siegeShells': '모든 무기의 피해가 등급당 +{n}%.',
      'unlockFrost': '서리 첨탑 해금 — 무리 전체를 둔화.',
      'forkedBolts': '번개가 등급당 적 {n}명에게 더 튑니다.',
      'ironPlating': '모든 블록의 방어가 등급당 +{n}.',
      'unlockRepair': '수리소 해금 — 매 웨이브 인접 블록 회복.',
      'unlockMint': '금광 해금 — 매 웨이브 코인 생산.',
      'looting': '적의 코인 드롭이 등급당 +{n}%.',
      'overcharge': '모든 무기의 공격 속도가 등급당 +{n}%.',
      'masterwork': '모든 무기의 피해가 등급당 +{n}%.',
      'fieldRepairs': '방어한 웨이브마다 각 블록이 최대 체력의 {n}%를 등급당 회복.',
      'greatFoundation': '건설 가능 폭이 등급당 {n}칸 더 확장.',
      'warChest': '웨이브 보상이 등급당 +{n}%.',
      'unlockSpikes': '가시벽 해금 — 공격한 적이 스스로 다칩니다.',
      'unlockBombard': '박격포탑 해금 — 지상군을 향한 근거리 박격 사격.',
      'sharpSpikes': '가시벽의 반사 피해가 랭크당 +{n}%.',
      'cavalryDrill': '기병의 체력과 피해량이 랭크당 +{n}%.',
      'artilleryDoctrine': '모든 무기의 사거리가 랭크당 +{n}%.'
    }
  },

  'resources': {
    'wood': '목재',
    'stone': '석재',
    'coins': '코인'
  },

  'ads': {
    'watch': '시청', 'revive': '부활', 'secondChance': '두 번째 기회',
    'doubleCoins': '2× 코인', 'plusCoins': '+{n} 코인'
  },

  'achievements': {
    'title': '업적', 'subtitle': '누적 목표를 달성해 코인을 얻으세요.',
    'claim': '수령', 'claimed': '수령함', 'progress': '{c} / {t}',
    'items': {
      'wave5': { 'name': '첫 저항', 'desc': '웨이브 5까지 버티세요.' },
      'wave10': { 'name': '요새', 'desc': '웨이브 10까지 버티세요.' },
      'wave20': { 'name': '방벽', 'desc': '웨이브 20까지 버티세요.' },
      'wave30': { 'name': '불굴', 'desc': '웨이브 30까지 버티세요.' },
      'waves50': { 'name': '방파제', 'desc': '누적 50 웨이브를 막으세요.' },
      'waves250': { 'name': '공성 베테랑', 'desc': '누적 250 웨이브를 막으세요.' },
      'kills500': { 'name': '수호자', 'desc': '누적 500명의 적을 처치하세요.' },
      'kills5k': { 'name': '학살자', 'desc': '누적 5,000명의 적을 처치하세요.' },
      'kills50k': { 'name': '전설', 'desc': '누적 50,000명의 적을 처치하세요.' },
      'height10': { 'name': '하늘로', 'desc': '높이 10블록의 타워를 지으세요.' },
      'height20': { 'name': '구름 뚫기', 'desc': '높이 20블록의 타워를 지으세요.' },
      'blocks250': { 'name': '건축가', 'desc': '누적 250개의 블록을 설치하세요.' },
      'blocks2k': { 'name': '설계자', 'desc': '누적 2,000개의 블록을 설치하세요.' },
      'coins5k': { 'name': '코인 수집가', 'desc': '누적 5,000 코인을 벌으세요.' },
      'coins50k': { 'name': '재무관', 'desc': '누적 50,000 코인을 벌으세요.' },
      'runs25': { 'name': '끈기', 'desc': '25번의 공성전을 시작하세요.' }
    }
  },

  'missions': {
    'title': '일일 미션', 'subtitle': '매일 목표를 완료하고 코인을 받으세요.',
    'claim': '수령', 'done': '수령함',
    'types': {
      'coins': '오늘 {n} 코인 획득',
      'waves': '한 번의 공성전에서 웨이브 {n}까지 버티기',
      'kills': '오늘 적 {n}명 처치',
      'blocks': '오늘 블록 {n}개 설치'
    }
  },

  'battlePass': {
    'title': '배틀패스', 'progress': '{current} / {total}', 'daysLeft': '{n}일 남음',
    'maxed': '배틀패스 완료', 'xpProgress': '{current} / {total} XP',
    'howToEarn': 'XP 획득 방법', 'perRun': '공성전당', 'perWave': '방어한 웨이브당',
    'unlockHint': '{n} XP를 모으면 다음 보상이 해금됩니다 — 수령하지 않은 보상은 그대로 남습니다.'
  },

  'dailyRewards': {
    'title': '일일 보상', 'subtitle': '매일 접속해 연속 기록을 이어가세요.',
    'day': '{n}일차', 'dayShort': 'D{n}'
  },

  'options': {
    'title': '설정', 'general': '일반', 'audio': '오디오', 'language': '언어',
    'difficulty': '난이도', 'soundEffects': '효과음', 'music': '음악', 'musicTrack': '음악 트랙',
    'musicTracks': { 'cozy': '아늑한 하모니', 'trance': '트랜스 터널' },
    'close': '저장 후 닫기',
    'difficulties': { 'easy': '쉬움', 'medium': '보통', 'hard': '어려움' },
    'difficultyHints': {
      'easy': '웨이브가 작고 적이 약합니다.',
      'medium': '표준적이고 균형 잡힌 공성전.',
      'hard': '웨이브가 빽빽하고 적이 단단합니다.'
    }
  },

  'adsBlocked': {
    'title': '광고를 표시할 수 없습니다',
    'body': '보상을 드리려고 영상을 재생하려 했지만, 브라우저의 무언가가 광고를 차단하고 있습니다.',
    'allowPrefix': '다음 사이트에서 광고를 허용해 주세요:',
    'allowSuffix': '(또는 이 게임에 한해 광고 차단기를 일시 중지) 후 다시 시도하세요.',
    'gotIt': '알겠습니다'
  },
  'saveStatus': {
    'restoredTitle': '클라우드 저장이 복원되었습니다', 'restoredBody': '복구 보너스 +{n} 코인',
    'tap': '탭', 'pausedTitle': '클라우드 동기화 일시 중지',
    'pausedBody': '오프라인으로 플레이 중입니다. 진행 상황은 여기에 저장됩니다.',
    'retry': '다시 시도', 'dismiss': '닫기'
  },
  'loading': { 'tooLong': '로딩이 너무 오래 걸리나요? 광고 차단기를 끄고 새로고침하세요.' },
  'license': { 'denied': '접근이 거부되었습니다: 라이선스를 구매해 주세요.' },
  'world': {
    'controlsHint': '드래그로 둘러보기 · WASD로 이동 · 스크롤 또는 핀치로 확대·축소'
  }
}
