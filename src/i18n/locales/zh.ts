export default {
  'gameName': '3d-world',
  'cancel': '取消',
  'close': '关闭',
  'ok': '确定',
  'continue': '继续',
  'tapToContinue': '点击继续',
  'clickToContinue': '单击继续',
  'rewards': '奖励',
  'tip': '提示',
  'crazyGamesOnly': '本游戏仅在以下平台提供：',

  'hud': {
    'wave': '波次', 'enemies': '敌人', 'callWave': '召唤波次', 'callBoss': '召唤首领',
    'speed': '速度 {n}×',
    'speedOffer': '看广告获得双倍速度',
    'speedFor': '{n} 分钟', 'recenter': '视角复位'
  },

  'hints': {
    'selectBlock': { 'touch': '点击下方的方块来选择', 'desktop': '单击下方的方块来选择' },
    'placeBlock': { 'touch': '现在点击发光的格子进行建造', 'desktop': '现在单击发光的格子进行建造' },
    'camera': { 'touch': '拖动平移 · 双指缩放', 'desktop': '拖动平移 · 滚轮缩放' },
    'callWave': { 'touch': '塔准备好后点击“召唤波次”', 'desktop': '按空格键提前召唤波次' },
    'inspect': { 'touch': '长按方块查看详情', 'desktop': '单击方块查看详情' }
  },

  'blocks': {
    'sell': '出售',
    'roofNote': '带屋顶——生命值翻倍，来自上方的防御提升三倍。上方需留空。',
    'enhancedNote': '强化 — 生命值与伤害更高。',
    'enhancedHand': '强化积木',
    'reroll': '更换此方块',
    'kinds': { 'core': '核心', 'structure': '结构', 'weapon': '武器', 'economy': '经济', 'utility': '功能' },
    'stats': {
      'hp': '生命', 'armor': '护甲', 'dmg': '伤害', 'cooldown': '冷却', 'range': '射程',
      'splash': '溅射', 'yieldWood': '木材 / 波', 'yieldStone': '石材 / 波', 'yieldCoins': '金币 / 波',
      'repair': '修复 / 波', 'blast': '爆炸',
      'thorns': '尖刺'
    },
    'names': {
      'gate': '城门', 'wood': '木箱', 'brace': '加固木箱', 'stone': '石块',
      'archer': '弓箭塔', 'cannon': '加农炮', 'mortar': '迫击炮', 'tesla': '闪电线圈',
      'frost': '寒霜尖塔', 'repair': '维修站',
      'sawmill': '锯木厂', 'quarry': '采石场', 'mint': '金矿',
      'spikes': '尖刺墙',
      'bombard': '臼炮'
    },
    'descriptions': {
      'gate': '高塔的核心。它一旦倒下，围攻就结束了。',
      'wood': '廉价填充物，每座早期高塔的骨干。',
      'brace': '两倍木材，超过两倍的坚固度。',
      'stone': '沉重且带护甲，最适合放在底部。',
      'archer': '快速单体箭矢，可攻击飞行单位。',
      'cannon': '射速慢但范围伤害高，能融化密集敌群。',
      'mortar': '远程抛射炮弹，但无法命中飞行单位。',
      'tesla': '在附近敌人之间跳跃的闪电。',
      'frost': '冻结整群敌人并大幅减速。',
      'repair': '在波次之间修复相邻方块。',
      'sawmill': '每守住一波结束时产出木材。',
      'quarry': '每守住一波结束时产出石材。',
      'mint': '每守住一波结束时产出金币。',
      'spikes': '近战攻击它的敌人每次都会被反伤。',
      'bombard': '垂直抛射炮弹。爆炸范围很小，只能打地面目标。'
    }
  },

  'enemies': {
    'names': {
      'grunt': '步兵', 'runner': '疾行者', 'slinger': '投石手', 'brute': '蛮兵',
      'bomber': '爆破兵', 'bat': '蝙蝠', 'bulwark': '盾卫', 'golem': '攻城魔像',
      'wyvern': '双足飞龙',
      'eel': '海蛇',
      'shark': '礁鲨',
      'kraken': '海妖',
      'seadrake': '海龙',
      'ram': '攻城槌',
      'ballista': '弩炮',
      'catapult': '投石机',
      'siegeTower': '攻城塔',
      'trebuchet': '配重投石机',
      'ironRam': '铁甲攻城槌',
      'bombardier': '投弹手',
      'firebug': '燃烧瓶手'
    }
  },

  // ─── First-stage tutorial ─────────────────────────────────────────────────
  'tutorial': {
    'gate': '守住城门，城门倒下即结束。',
    'pick': '选择一个方块。',
    'place': '把它放在城门旁边。',
    'call': '准备好就召唤敌潮。',
    'next': '下一步',
    'offer': '需要新手教学吗？',
    'start': '开始',
    'skip': '跳过'
  },

  // ─── Allies ───────────────────────────────────────────────────────────────
  'allies': {
    'cavalry': '骑兵'
  },

  'result': {
    'towerFell': '高塔倒塌了！',
    'reachedWave': '你坚持到了第 {n} 波',
    'newRecord': '新纪录！',
    'upgrade': '升级！',
    'defendAgain': '再次防守',
    'continueRun': '重建并继续',
    'double': '金币翻倍',
    'firstRunDouble': '2× — 今日首次围攻！',
    'tripleWave': '3× 金币 — {n}',
    'waveCleared': '第 {n} 波已守住！',
    'scoreLabel': '分数',
    'bestLabel': '最高分',
    'scoreCurrent': '(本局 {n})',
    'rankLabel': '排名',
    'rankOf': '共 {n} 名'
  },

  'tech': {
    'title': '科技树',
    'rank': '等级 {current}/{total}',
    'maxed': '已满级',
    'rankOpen': '等级 {n}',
    'atRank': '等级 {r}：共 {n}',
    'owned': '已解锁',
    'requires': '需要 {n}',
    'spotlight': '快花掉！',
    'names': {
      'foundations': '地基', 'sharpBolts': '锐利箭矢', 'unlockBrace': '加固木箱',
      'lumberStock': '木材储备', 'longSight': '远视', 'rapidFire': '速射',
      'reinforced': '加固梁柱', 'unlockSawmill': '锯木厂', 'quarryStock': '石材储备',
      'unlockMortar': '迫击炮', 'heavyOrdnance': '重型火炮', 'unlockTesla': '闪电线圈',
      'gateArmor': '城门护甲', 'unlockQuarry': '采石场', 'richHauls': '丰厚战利品',
      'wideFoundation': '宽阔地基', 'siegeShells': '攻城炮弹', 'unlockFrost': '寒霜尖塔',
      'forkedBolts': '分叉闪电', 'ironPlating': '铁质装甲', 'unlockRepair': '维修站',
      'unlockMint': '金矿', 'looting': '掠夺', 'overcharge': '过载',
      'masterwork': '大师之作', 'fieldRepairs': '战地维修', 'greatFoundation': '宏伟地基',
      'warChest': '军费金库',
      'unlockSpikes': '尖刺墙',
      'unlockBombard': '臼炮',
      'sharpSpikes': '磨利尖刺',
      'cavalryDrill': '骑兵操练',
      'artilleryDoctrine': '炮兵学说'
    },
    'descriptions': {
      'foundations': '每个方块初始生命值 +{n}%。',
      'sharpBolts': '所有武器每级伤害 +{n}%。',
      'unlockBrace': '解锁加固木箱——生命值是木材的两倍。',
      'lumberStock': '每级围攻开局多 {n} 木材。',
      'longSight': '所有武器每级射程 +{n}%。',
      'rapidFire': '所有武器每级射速 +{n}%。',
      'reinforced': '每个方块每级生命值 +{n}%。',
      'unlockSawmill': '解锁锯木厂——每波产出木材。',
      'quarryStock': '每级围攻开局多 {n} 石材。',
      'unlockMortar': '解锁迫击炮——远程范围伤害。',
      'heavyOrdnance': '溅射半径每级 +{n}%。',
      'unlockTesla': '解锁闪电线圈——闪电会在敌人之间跳跃。',
      'gateArmor': '城门每级生命值 +{n}%。',
      'unlockQuarry': '解锁采石场——每波产出石材。',
      'richHauls': '波次奖励每级 +{n}%。',
      'wideFoundation': '每级可多建造 {n} 列宽度。',
      'siegeShells': '所有武器每级伤害 +{n}%。',
      'unlockFrost': '解锁寒霜尖塔——减速整群敌人。',
      'forkedBolts': '闪电每级多跳跃 {n} 个敌人。',
      'ironPlating': '每个方块每级护甲 +{n}。',
      'unlockRepair': '解锁维修站——每波治疗相邻方块。',
      'unlockMint': '解锁金矿——每波产出金币。',
      'looting': '敌人每级多掉落 {n}% 金币。',
      'overcharge': '所有武器每级射速 +{n}%。',
      'masterwork': '所有武器每级伤害 +{n}%。',
      'fieldRepairs': '每守住一波，每个方块按每级恢复 {n}% 最大生命值。',
      'greatFoundation': '每级再多建造 {n} 列宽度。',
      'warChest': '波次奖励每级 +{n}%。',
      'unlockSpikes': '解锁尖刺墙 — 攻击它的敌人会被反伤。',
      'unlockBombard': '解锁臼炮 — 对地面部队的近距离迫击火力。',
      'sharpSpikes': '尖刺墙每级反弹伤害 +{n}%。',
      'cavalryDrill': '骑兵每级生命值与伤害 +{n}%。',
      'artilleryDoctrine': '所有武器每级射程 +{n}%。'
    }
  },

  'resources': {
    'wood': '木材',
    'stone': '石材',
    'coins': '金币'
  },

  'ads': {
    'watch': '观看', 'revive': '复活', 'secondChance': '第二次机会',
    'doubleCoins': '2× 金币', 'plusCoins': '+{n} 金币'
  },

  'achievements': {
    'title': '成就', 'subtitle': '达成长期里程碑赚取金币。',
    'claim': '领取', 'claimed': '已领取', 'progress': '{c} / {t}',
    'items': {
      'wave5': { 'name': '首次坚守', 'desc': '坚持到第 5 波。' },
      'wave10': { 'name': '要塞', 'desc': '坚持到第 10 波。' },
      'wave20': { 'name': '壁垒', 'desc': '坚持到第 20 波。' },
      'wave30': { 'name': '坚不可摧', 'desc': '坚持到第 30 波。' },
      'waves50': { 'name': '破浪者', 'desc': '累计守住 50 波。' },
      'waves250': { 'name': '围攻老兵', 'desc': '累计守住 250 波。' },
      'kills500': { 'name': '守卫者', 'desc': '累计击败 500 名敌人。' },
      'kills5k': { 'name': '屠戮者', 'desc': '累计击败 5,000 名敌人。' },
      'kills50k': { 'name': '传奇', 'desc': '累计击败 50,000 名敌人。' },
      'height10': { 'name': '直上云霄', 'desc': '建造 10 格高的高塔。' },
      'height20': { 'name': '穿云者', 'desc': '建造 20 格高的高塔。' },
      'blocks250': { 'name': '建造者', 'desc': '累计放置 250 个方块。' },
      'blocks2k': { 'name': '建筑师', 'desc': '累计放置 2,000 个方块。' },
      'coins5k': { 'name': '金币收藏家', 'desc': '累计赚取 5,000 金币。' },
      'coins50k': { 'name': '司库', 'desc': '累计赚取 50,000 金币。' },
      'runs25': { 'name': '坚持不懈', 'desc': '开始 25 次围攻。' }
    }
  },

  'missions': {
    'title': '每日任务', 'subtitle': '每天完成目标赚取金币。',
    'claim': '领取', 'done': '已领取',
    'types': {
      'coins': '今天赚取 {n} 金币',
      'waves': '单次围攻坚持到第 {n} 波',
      'kills': '今天击败 {n} 名敌人',
      'blocks': '今天放置 {n} 个方块'
    }
  },

  'battlePass': {
    'title': '战斗通行证', 'progress': '{current} / {total}', 'daysLeft': '剩余 {n} 天',
    'maxed': '战斗通行证已完成', 'xpProgress': '{current} / {total} XP',
    'howToEarn': '如何获得经验', 'perRun': '每次围攻', 'perWave': '每守住一波',
    'unlockHint': '达到 {n} XP 解锁下一个奖励——未领取的奖励会一直保留。'
  },

  'dailyRewards': {
    'title': '每日奖励', 'subtitle': '每天登录以保持连续记录。',
    'day': '第 {n} 天', 'dayShort': 'D{n}'
  },

  'options': {
    'title': '选项', 'general': '通用', 'audio': '音频', 'language': '语言',
    'difficulty': '难度', 'soundEffects': '音效', 'music': '音乐', 'musicTrack': '音乐曲目',
    'musicTracks': { 'cozy': '惬意和声', 'trance': '迷幻隧道' },
    'close': '保存并关闭',
    'difficulties': { 'easy': '简单', 'medium': '普通', 'hard': '困难' },
    'difficultyHints': {
      'easy': '波次更小，敌人更弱。',
      'medium': '标准且平衡的围攻。',
      'hard': '波次更密集，敌人更强韧。'
    }
  },

  'adsBlocked': {
    'title': '无法显示广告',
    'body': '我们本想为你播放视频以便领取奖励，但你的浏览器中有内容拦截了广告。',
    'allowPrefix': '请在以下网站允许广告：',
    'allowSuffix': '（或为本游戏暂停广告拦截器）然后重试。',
    'gotIt': '知道了'
  },
  'saveStatus': {
    'restoredTitle': '云存档已恢复', 'restoredBody': '恢复奖励 +{n} 金币',
    'tap': '点击', 'pausedTitle': '云同步已暂停',
    'pausedBody': '正在离线游戏。你的进度会保存在本地。',
    'retry': '重试', 'dismiss': '忽略'
  },
  'loading': { 'tooLong': '加载太久？请关闭广告拦截器并刷新页面。' },
  'license': { 'denied': '访问被拒绝：请购买许可证。' },
  'world': {
    'controlsHint': '拖动环顾四周 · WASD 移动 · 滚轮或双指缩放',
    'modeOrbit': '环绕视角',
    'modeFirstPerson': '行走',
    'settings': {
      'title': '画面',
      'open': '画面设置',
      'grass': '草地细节',
      'grassHint': '草更密集、可见距离更远。若游戏卡顿请调低。',
      'grassAutoHint': '草地会根据你的设备性能自动调整。',
      'drawnPatches': '屏幕内 {n} 丛 · {tris}k 三角形',
      'detail': {
        'auto': '自动',
        'ultra': '极高',
        'high': '高',
        'medium': '中',
        'low': '低',
        'minimum': '最低',
        'off': '关闭'
      }
    }
  },

  'characters': {
    'title': '创建你的角色',
    'hint': '拖动旋转 · 滚动或双指缩放',
    'body': '体型',
    'bodies': {
      'male': '男性',
      'female': '女性'
    },
    'head': '头型',
    'heads': {
      'round': '圆形',
      'oval': '鹅蛋形',
      'square': '方形',
      'heart': '心形'
    },
    'hair': '发型',
    'hairStyles': {
      'bowl': '锅盖头',
      'short': '短发',
      'ponytail': '马尾',
      'braids': '辫子',
      'long': '长发',
      'bald': '光头',
      'topknot': '头顶发髻',
      'buns': '双耳发髻',
      'bun': '低发髻',
      'plaits': '外翘辫子',
      'flowing': '及腰长发',
      'queue': '长辫',
      'bob': '齐耳短发',
      'tresses': '前垂发绺',
      'wild': '蓬乱',
      'swept': '侧分偏发',
      'fringe': '厚刘海',
      'bearded': '络腮胡',
      'mane': '蓬松鬃发',
      'coif': '亚麻头巾',
      'receding': '发际线后移'
    },
    'eyes': '眼睛',
    'eyeStyles': {
      'bright': '明亮',
      'wide': '眼距宽',
      'close': '眼距窄',
      'tall': '细长',
      'small': '小巧',
      'almond': '杏眼',
      'sleepy': '睡眼',
      'sharp': '锐利',
      'soft': '温柔',
      'weary': '疲惫'
    },
    'mouth': '嘴巴',
    'mouthStyles': {
      'smile': '微笑',
      'neutral': '平静',
      'frown': '撇嘴',
      'grin': '咧嘴笑',
      'open': '张嘴'
    },
    'beard': '胡须',
    'beardStyles': {
      'none': '无',
      'moustache': '八字胡',
      'goatee': '山羊胡',
      'cropped': '短须',
      'muttonChops': '连鬓胡',
      'full': '满脸胡',
      'forked': '分叉长须',
      'braided': '编辫长须',
      'patriarch': '及胸长须'
    },
    'nose': '鼻子',
    'noseStyles': {
      'none': '无',
      'button': '小圆鼻',
      'round': '圆鼻',
      'hooked': '鹰钩鼻',
      'broad': '宽鼻'
    },
    'brows': '眉毛',
    'browStyles': {
      'fine': '细眉',
      'bushy': '浓眉'
    },
    'skinTone': '肤色',
    'skinToneOption': '肤色 {n}',
    'hairColour': '发色',
    'hairColourOption': '发色 {n}',
    'tunicColour': '服装颜色',
    'tunicColourOption': '服装颜色 {n}',
    'outfit': '服装',
    'outfitHint': '服装由哪几种颜色裁成。每件长袍、短衣和帽子都有自己的一组。',
    'equipment': '装备',
    'items': {
      'hat': '帽子',
      'torsoArmour': '护甲',
      'sword': '剑',
      'shield': '盾牌'
    },
    'drawWeapon': '拔出武器',
    'spin': '自动旋转',
    'randomise': '随机一个',
    'reset': '重新开始',
    'save': '保存角色',
    'saved': '已保存',
    'back': '返回世界',
    'roster': '角色',
    'newCharacter': '新角色',
    'unnamed': '未命名',
    'search': '按名称或 ID 搜索',
    'noMatches': '没有匹配的角色。',
    'empty': '还没有保存的角色。设计一个，取个名字，然后点击保存。',
    'name': '名字',
    'namePlaceholder': '给角色取个名字',
    'copyName': '{name} 副本',
    'id': 'ID',
    'idPending': '保存时自动生成。',
    'idFixed': '创建时确定。存档和任务都以它为准，因此改名不会改变它。',
    'duplicate': '复制',
    'delete': '删除',
    'deleteConfirm': '删除 {name}？此操作无法撤销。',
    'unsavedChanges': '有未保存的修改。',
    'saveAndContinue': '保存并继续',
    'discard': '放弃'
  }
}
