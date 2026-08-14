export default {
  'gameName': '3d-world',
  'cancel': 'キャンセル',
  'close': '閉じる',
  'ok': 'OK',
  'continue': '続ける',
  'tapToContinue': 'タップして続ける',
  'clickToContinue': 'クリックして続ける',
  'rewards': '報酬',
  'tip': 'ヒント',
  'crazyGamesOnly': 'このゲームは以下でのみプレイできます：',

  'hud': {
    'wave': 'ウェーブ', 'enemies': '敵', 'callWave': 'ウェーブを呼ぶ', 'callBoss': 'ボスを呼ぶ',
    'speed': '速度 {n}×',
    'speedOffer': '広告で2倍速',
    'speedFor': '{n}分', 'recenter': '視点を戻す'
  },

  'hints': {
    'selectBlock': { 'touch': '下のブロックをタップして選択', 'desktop': '下のブロックをクリックして選択' },
    'placeBlock': { 'touch': '光っているマスをタップして建設', 'desktop': '光っているマスをクリックして建設' },
    'camera': { 'touch': 'ドラッグで移動 · ピンチでズーム', 'desktop': 'ドラッグで移動 · スクロールでズーム' },
    'callWave': { 'touch': 'タワーの準備ができたら「ウェーブを呼ぶ」をタップ', 'desktop': 'スペースキーで早めにウェーブを呼ぶ' },
    'inspect': { 'touch': 'ブロックを長押しで詳細を表示', 'desktop': 'ブロックをクリックで詳細を表示' }
  },

  'blocks': {
    'sell': '売却',
    'roofNote': '屋根付き — HP2倍、上からの攻撃に防御3倍。上に空きが必要。',
    'enhancedNote': '強化済み — HPもダメージも上乗せ。',
    'enhancedHand': '強化ブロック',
    'reroll': 'このピースを交換',
    'kinds': { 'core': 'コア', 'structure': '構造', 'weapon': '兵器', 'economy': '経済', 'utility': '特殊' },
    'stats': {
      'hp': 'HP', 'armor': '装甲', 'dmg': 'ダメージ', 'cooldown': 'クールダウン', 'range': '射程',
      'splash': '範囲', 'yieldWood': '木材 / ウェーブ', 'yieldStone': '石材 / ウェーブ', 'yieldCoins': 'コイン / ウェーブ',
      'repair': '修理 / ウェーブ', 'blast': '爆発',
      'thorns': '棘'
    },
    'names': {
      'gate': 'ゲート', 'wood': '木箱', 'brace': '補強木箱', 'stone': '石ブロック',
      'archer': '弓塔', 'cannon': 'キャノン', 'mortar': '迫撃砲', 'tesla': '雷コイル',
      'frost': '氷塔', 'repair': '修理場',
      'sawmill': '製材所', 'quarry': '採石場', 'mint': '金鉱',
      'spikes': 'とげ壁',
      'bombard': '臼砲'
    },
    'descriptions': {
      'gate': 'タワーの心臓部。失えば包囲戦は終了です。',
      'wood': '安価な埋め草。序盤のタワーの背骨。',
      'brace': '木材2倍、耐久はそれ以上。',
      'stone': '重くて装甲付き。土台に最適。',
      'archer': '単体への高速な矢。飛行敵にも当たります。',
      'cannon': '低速だが強力な範囲ダメージ。密集した敵を溶かします。',
      'mortar': '長射程の放物線弾。ただし飛行敵には当たりません。',
      'tesla': '近くの敵へ跳ねる稲妻。',
      'frost': '集団ごと凍らせて大幅に減速。',
      'repair': 'ウェーブの合間に隣接ブロックを修理。',
      'sawmill': 'ウェーブを守り切るたびに木材を産出。',
      'quarry': 'ウェーブを守り切るたびに石材を産出。',
      'mint': 'ウェーブを守り切るたびにコインを産出。',
      'spikes': '殴った敵は毎回そのダメージを自分で受けます。',
      'bombard': '砲弾を真上に打ち上げます。爆発は小さく、地上の敵のみ。'
    }
  },

  'enemies': {
    'names': {
      'grunt': '雑兵', 'runner': 'ランナー', 'slinger': '投石兵', 'brute': 'ブルート',
      'bomber': '爆弾兵', 'bat': 'コウモリ', 'bulwark': '盾兵', 'golem': '攻城ゴーレム',
      'wyvern': 'ワイバーン',
      'eel': '海竜',
      'shark': 'リーフシャーク',
      'kraken': 'クラーケン',
      'seadrake': '海竜王',
      'ram': '破城槌',
      'ballista': 'バリスタ',
      'catapult': 'カタパルト',
      'siegeTower': '攻城塔',
      'trebuchet': 'トレビュシェット',
      'ironRam': '鉄甲破城槌',
      'bombardier': '爆撃兵',
      'firebug': '火炎兵'
    }
  },

  // ─── First-stage tutorial ─────────────────────────────────────────────────
  'tutorial': {
    'gate': 'ゲートを守れ。落ちたら終わりだ。',
    'pick': 'ブロックを選ぼう。',
    'place': 'ゲートの隣に置こう。',
    'call': '準備できたらウェーブを呼ぼう。',
    'next': '次へ',
    'offer': 'チュートリアルを見る？',
    'start': 'はじめる',
    'skip': 'スキップ'
  },

  // ─── Allies ───────────────────────────────────────────────────────────────
  'allies': {
    'cavalry': '騎兵'
  },

  'result': {
    'towerFell': 'タワーが崩れた！',
    'reachedWave': 'ウェーブ {n} まで耐えました',
    'newRecord': '新記録！',
    'upgrade': '強化！',
    'defendAgain': 'もう一度防衛',
    'continueRun': '再建して続行',
    'double': 'コイン2倍',
    'firstRunDouble': '2× — 本日最初の包囲戦！',
    'tripleWave': 'コイン3倍 — {n}',
    'waveCleared': 'ウェーブ {n} を防衛！',
    'scoreLabel': 'スコア',
    'bestLabel': '最高スコア',
    'scoreCurrent': '(今回 {n})',
    'rankLabel': '順位',
    'rankOf': '{n} 人中'
  },

  'tech': {
    'title': 'テックツリー',
    'rank': 'ランク {current}/{total}',
    'maxed': '最大',
    'rankOpen': 'ランク {n}',
    'atRank': 'ランク {r}：合計 {n}',
    'owned': '解放済み',
    'requires': '必要：{n}',
    'spotlight': '使おう！',
    'names': {
      'foundations': '基礎', 'sharpBolts': '鋭利な矢', 'unlockBrace': '補強木箱',
      'lumberStock': '木材備蓄', 'longSight': '遠見', 'rapidFire': '速射',
      'reinforced': '補強梁', 'unlockSawmill': '製材所', 'quarryStock': '石材備蓄',
      'unlockMortar': '迫撃砲', 'heavyOrdnance': '重砲', 'unlockTesla': '雷コイル',
      'gateArmor': 'ゲート装甲', 'unlockQuarry': '採石場', 'richHauls': '豊かな戦利品',
      'wideFoundation': '広い基礎', 'siegeShells': '攻城弾', 'unlockFrost': '氷塔',
      'forkedBolts': '分岐する雷', 'ironPlating': '鉄板装甲', 'unlockRepair': '修理場',
      'unlockMint': '金鉱', 'looting': '略奪', 'overcharge': 'オーバーチャージ',
      'masterwork': '傑作', 'fieldRepairs': '野戦修理', 'greatFoundation': '大基礎',
      'warChest': '軍資金',
      'unlockSpikes': 'とげ壁',
      'unlockBombard': '臼砲',
      'sharpSpikes': '研ぎ澄ました棘',
      'cavalryDrill': '騎兵訓練',
      'artilleryDoctrine': '砲兵ドクトリン'
    },
    'descriptions': {
      'foundations': 'すべてのブロックのHPが +{n}% で始まります。',
      'sharpBolts': '全兵器のダメージがランクごとに +{n}%。',
      'unlockBrace': '補強木箱を解放——木材の2倍のHP。',
      'lumberStock': '包囲戦開始時の木材がランクごとに +{n}。',
      'longSight': '全兵器の射程がランクごとに +{n}%。',
      'rapidFire': '全兵器の攻撃速度がランクごとに +{n}%。',
      'reinforced': '全ブロックのHPがランクごとに +{n}%。',
      'unlockSawmill': '製材所を解放——毎ウェーブ木材を産出。',
      'quarryStock': '包囲戦開始時の石材がランクごとに +{n}。',
      'unlockMortar': '迫撃砲を解放——長射程の範囲ダメージ。',
      'heavyOrdnance': '範囲半径がランクごとに +{n}%。',
      'unlockTesla': '雷コイルを解放——稲妻が敵の間を跳ねます。',
      'gateArmor': 'ゲートのHPがランクごとに +{n}%。',
      'unlockQuarry': '採石場を解放——毎ウェーブ石材を産出。',
      'richHauls': 'ウェーブ報酬がランクごとに +{n}%。',
      'wideFoundation': '建設可能幅がランクごとに {n} 列拡大。',
      'siegeShells': '全兵器のダメージがランクごとに +{n}%。',
      'unlockFrost': '氷塔を解放——集団をまとめて減速。',
      'forkedBolts': '稲妻の跳ね先がランクごとに {n} 体増加。',
      'ironPlating': '全ブロックの装甲がランクごとに +{n}。',
      'unlockRepair': '修理場を解放——毎ウェーブ隣接ブロックを回復。',
      'unlockMint': '金鉱を解放——毎ウェーブコインを産出。',
      'looting': '敵のコイン落とし量がランクごとに +{n}%。',
      'overcharge': '全兵器の攻撃速度がランクごとに +{n}%。',
      'masterwork': '全兵器のダメージがランクごとに +{n}%。',
      'fieldRepairs': '防衛したウェーブごとに、各ブロックが最大HPの{n}%をランクごとに回復。',
      'greatFoundation': '建設可能幅がさらにランクごとに {n} 列拡大。',
      'warChest': 'ウェーブ報酬がランクごとに +{n}%。',
      'unlockSpikes': 'とげ壁を解放 — 殴った敵が自ら傷つきます。',
      'unlockBombard': '臼砲を解放 — 地上部隊への近距離迫撃。',
      'sharpSpikes': 'とげ壁の反射ダメージがランクごとに +{n}%。',
      'cavalryDrill': '騎兵のHPとダメージがランクごとに +{n}%。',
      'artilleryDoctrine': '全兵器の射程がランクごとに +{n}%。'
    }
  },

  'resources': {
    'wood': '木材',
    'stone': '石材',
    'coins': 'コイン'
  },

  'ads': {
    'watch': '視聴', 'revive': '復活', 'secondChance': 'セカンドチャンス',
    'doubleCoins': '2× コイン', 'plusCoins': '+{n} コイン'
  },

  'achievements': {
    'title': '実績', 'subtitle': '累計マイルストーンを達成してコインを獲得。',
    'claim': '受け取る', 'claimed': '受取済', 'progress': '{c} / {t}',
    'items': {
      'wave5': { 'name': '最初の抵抗', 'desc': 'ウェーブ 5 まで耐える。' },
      'wave10': { 'name': '要塞', 'desc': 'ウェーブ 10 まで耐える。' },
      'wave20': { 'name': '防壁', 'desc': 'ウェーブ 20 まで耐える。' },
      'wave30': { 'name': '不屈', 'desc': 'ウェーブ 30 まで耐える。' },
      'waves50': { 'name': '波止め', 'desc': '累計 50 ウェーブを防衛。' },
      'waves250': { 'name': '包囲戦の古兵', 'desc': '累計 250 ウェーブを防衛。' },
      'kills500': { 'name': '守護者', 'desc': '累計 500 体の敵を撃破。' },
      'kills5k': { 'name': 'スレイヤー', 'desc': '累計 5,000 体の敵を撃破。' },
      'kills50k': { 'name': '伝説', 'desc': '累計 50,000 体の敵を撃破。' },
      'height10': { 'name': '天へ', 'desc': '高さ 10 ブロックのタワーを建設。' },
      'height20': { 'name': '雲を突く者', 'desc': '高さ 20 ブロックのタワーを建設。' },
      'blocks250': { 'name': 'ビルダー', 'desc': '累計 250 ブロックを設置。' },
      'blocks2k': { 'name': '建築家', 'desc': '累計 2,000 ブロックを設置。' },
      'coins5k': { 'name': 'コイン収集家', 'desc': '累計 5,000 コインを獲得。' },
      'coins50k': { 'name': '財務官', 'desc': '累計 50,000 コインを獲得。' },
      'runs25': { 'name': '粘り強い', 'desc': '25 回の包囲戦を開始。' }
    }
  },

  'missions': {
    'title': 'デイリーミッション', 'subtitle': '毎日目標を達成してコインを獲得。',
    'claim': '受け取る', 'done': '受取済',
    'types': {
      'coins': '今日 {n} コインを獲得',
      'waves': '1回の包囲戦でウェーブ {n} まで耐える',
      'kills': '今日 {n} 体の敵を撃破',
      'blocks': '今日 {n} ブロックを設置'
    }
  },

  'battlePass': {
    'title': 'バトルパス', 'progress': '{current} / {total}', 'daysLeft': '残り {n} 日',
    'maxed': 'バトルパス完了', 'xpProgress': '{current} / {total} XP',
    'howToEarn': 'XP の稼ぎ方', 'perRun': '包囲戦ごと', 'perWave': '防衛ウェーブごと',
    'unlockHint': '{n} XP で次の報酬が解放されます。未受取の報酬は消えません。'
  },

  'dailyRewards': {
    'title': 'デイリーボーナス', 'subtitle': '毎日ログインして連続記録を維持しよう。',
    'day': '{n} 日目', 'dayShort': 'D{n}'
  },

  'options': {
    'title': '設定', 'general': '一般', 'audio': 'オーディオ', 'language': '言語',
    'difficulty': '難易度', 'soundEffects': '効果音', 'music': '音楽', 'musicTrack': '楽曲',
    'musicTracks': { 'cozy': 'コージーハーモニー', 'trance': 'トランストンネル' },
    'close': '保存して閉じる',
    'difficulties': { 'easy': 'イージー', 'medium': 'ノーマル', 'hard': 'ハード' },
    'difficultyHints': {
      'easy': 'ウェーブが小さく、敵も弱め。',
      'medium': '標準でバランスの取れた包囲戦。',
      'hard': 'ウェーブが濃密で、敵も頑丈。'
    }
  },

  'adsBlocked': {
    'title': '広告を表示できませんでした',
    'body': '報酬獲得のために動画を表示しようとしましたが、ブラウザの何かが広告をブロックしています。',
    'allowPrefix': '次のサイトで広告を許可してください：',
    'allowSuffix': '（またはこのゲームのみ広告ブロッカーを一時停止）してから再試行してください。',
    'gotIt': 'わかりました'
  },
  'saveStatus': {
    'restoredTitle': 'クラウドセーブを復元しました', 'restoredBody': '復元ボーナス +{n} コイン',
    'tap': 'タップ', 'pausedTitle': 'クラウド同期を一時停止中',
    'pausedBody': 'オフラインでプレイ中です。進行状況はここに保存されます。',
    'retry': '再試行', 'dismiss': '閉じる'
  },
  'loading': { 'tooLong': '読み込みが長すぎますか？ 広告ブロッカーを無効にして再読み込みしてください。' },
  'license': { 'denied': 'アクセスが拒否されました：ライセンスをご購入ください。' },
  'world': {
    'controlsHint': 'ドラッグで見回す · WASDで移動 · スクロールまたはピンチでズーム'
  }
}
