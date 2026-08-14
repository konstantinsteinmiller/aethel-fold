export default {
  'gameName': '3d-world',
  'cancel': 'İptal',
  'close': 'Kapat',
  'ok': 'Tamam',
  'continue': 'Devam',
  'tapToContinue': 'Devam etmek için dokun',
  'clickToContinue': 'Devam etmek için tıkla',
  'rewards': 'ÖDÜLLER',
  'tip': 'İpucu',
  'crazyGamesOnly': 'Bu oyun yalnızca şurada mevcut:',

  'hud': {
    'wave': 'Dalga', 'enemies': 'Düşmanlar', 'callWave': 'Dalgayı çağır', 'callBoss': 'Boss’u çağır',
    'speed': 'Hız {n}×',
    'speedOffer': 'Bir reklamla çift hız',
    'speedFor': '{n} dk', 'recenter': 'Görünümü ortala'
  },

  'hints': {
    'selectBlock': { 'touch': 'Seçmek için aşağıdaki bir bloğa dokun', 'desktop': 'Seçmek için aşağıdaki bir bloğa tıkla' },
    'placeBlock': { 'touch': 'Şimdi inşa etmek için parlayan bir yuvaya dokun', 'desktop': 'Şimdi inşa etmek için parlayan bir yuvaya tıkla' },
    'camera': { 'touch': 'Kaydırmak için sürükle · Yakınlaştırmak için sıkıştır', 'desktop': 'Kaydırmak için sürükle · Yakınlaştırmak için tekerlek' },
    'callWave': { 'touch': 'Kulen hazırken «Dalgayı çağır»a dokun', 'desktop': 'Dalgayı erken başlatmak için Boşluk’a bas' },
    'inspect': { 'touch': 'İncelemek için bir bloğu basılı tut', 'desktop': 'İncelemek için bir bloğa tıkla' }
  },

  'blocks': {
    'sell': 'Sat',
    'roofNote': 'Çatılı — iki kat CP, yukarıdan gelen hasara üç kat savunma. Üstü boş olmalı.',
    'enhancedNote': 'Takviyeli — daha fazla CP ve hasar.',
    'enhancedHand': 'Takviyeli el',
    'reroll': 'Bu parçayı değiştir',
    'kinds': { 'core': 'Çekirdek', 'structure': 'Yapı', 'weapon': 'Silah', 'economy': 'Ekonomi', 'utility': 'Yardımcı' },
    'stats': {
      'hp': 'CP', 'armor': 'Zırh', 'dmg': 'Hasar', 'cooldown': 'Bekleme', 'range': 'Menzil',
      'splash': 'Alan', 'yieldWood': 'Odun / dalga', 'yieldStone': 'Taş / dalga', 'yieldCoins': 'Altın / dalga',
      'repair': 'Onarım / dalga', 'blast': 'Patlama',
      'thorns': 'Dikenler'
    },
    'names': {
      'gate': 'Kapı', 'wood': 'Ahşap Sandık', 'brace': 'Takviyeli Sandık', 'stone': 'Taş Blok',
      'archer': 'Okçu Kulesi', 'cannon': 'Top', 'mortar': 'Havan', 'tesla': 'Yıldırım Bobini',
      'frost': 'Buz Kulesi', 'repair': 'Tamirhane',
      'sawmill': 'Kereste Fabrikası', 'quarry': 'Taş Ocağı', 'mint': 'Altın Madeni',
      'spikes': 'Dikenli Duvar',
      'bombard': 'Bombarda'
    },
    'descriptions': {
      'gate': 'Kulenin kalbi. Düşerse kuşatma biter.',
      'wood': 'Ucuz dolgu. Her erken kulenin bel kemiği.',
      'brace': 'İki katı odun, iki katından fazla dayanıklılık.',
      'stone': 'Ağır ve zırhlı. En iyisi temelde.',
      'archer': 'Tek hedefe hızlı oklar. Uçanları da vurur.',
      'cannon': 'Yavaş, ağır alan hasarı. Sıkışık kalabalıkları eritir.',
      'mortar': 'Uzun menzilli yay çizen mermiler — ama uçanları vuramaz.',
      'tesla': 'Yakındaki düşmanlar arasında sıçrayan yıldırımlar.',
      'frost': 'Tüm grubu dondurur ve ağır yavaşlatır.',
      'repair': 'Dalgalar arasında komşu blokları onarır.',
      'sawmill': 'Atlatılan her dalganın sonunda odun üretir.',
      'quarry': 'Atlatılan her dalganın sonunda taş üretir.',
      'mint': 'Atlatılan her dalganın sonunda altın üretir.',
      'spikes': 'Saldıranlar her vuruşta kendilerini yaralar.',
      'bombard': 'Mermiyi dik yukarı fırlatır. Küçük patlama, sadece kara hedefleri.'
    }
  },

  'enemies': {
    'names': {
      'grunt': 'Piyade', 'runner': 'Koşucu', 'slinger': 'Sapancı', 'brute': 'Kaba Kuvvet',
      'bomber': 'Bombacı', 'bat': 'Yarasa', 'bulwark': 'Siperci', 'golem': 'Kuşatma Golemi',
      'wyvern': 'Vivern',
      'eel': 'Deniz yılanı',
      'shark': 'Resif köpekbalığı',
      'kraken': 'Kraken',
      'seadrake': 'Deniz ejderi',
      'ram': 'Koçbaşı',
      'ballista': 'Balista',
      'catapult': 'Mancınık',
      'siegeTower': 'Kuşatma Kulesi',
      'trebuchet': 'Trebuşe',
      'ironRam': 'Zırhlı Koçbaşı',
      'bombardier': 'Bombardıman',
      'firebug': 'Ateşçi'
    }
  },

  // ─── First-stage tutorial ─────────────────────────────────────────────────
  'tutorial': {
    'gate': 'Kapıyı koru. Düşerse tur biter.',
    'pick': 'Bir parça seç.',
    'place': 'Kapının yanına yerleştir.',
    'call': 'Hazır olunca dalgayı çağır.',
    'next': 'İleri',
    'offer': 'Eğitim ister misin?',
    'start': 'Başla',
    'skip': 'Atla'
  },

  // ─── Allies ───────────────────────────────────────────────────────────────
  'allies': {
    'cavalry': 'Süvari'
  },

  'result': {
    'towerFell': 'Kule Yıkıldı!',
    'reachedWave': '{n}. dalgaya kadar dayandın',
    'newRecord': 'Yeni rekor!',
    'upgrade': 'Geliştir!',
    'defendAgain': 'Tekrar savun',
    'continueRun': 'Yeniden kur ve devam et',
    'double': 'Altınları ikiye katla',
    'firstRunDouble': '2× — bugünkü ilk kuşatma!',
    'tripleWave': '3× altın — {n}',
    'waveCleared': '{n}. dalga durduruldu!',
    'scoreLabel': 'Puan',
    'bestLabel': 'En iyi puan',
    'scoreCurrent': '(bu turda {n})',
    'rankLabel': 'Sıra',
    'rankOf': '/ {n}'
  },

  'tech': {
    'title': 'Teknoloji Ağacı',
    'rank': 'Kademe {current}/{total}',
    'maxed': 'Maksimum',
    'rankOpen': 'Rütbe {n}',
    'atRank': '{r}. rütbede: toplam {n}',
    'owned': 'Açıldı',
    'requires': 'Gerekli: {n}',
    'spotlight': 'Harca!',
    'names': {
      'foundations': 'Temeller', 'sharpBolts': 'Keskin Oklar', 'unlockBrace': 'Takviyeli Sandıklar',
      'lumberStock': 'Odun Stoku', 'longSight': 'Uzak Görüş', 'rapidFire': 'Hızlı Atış',
      'reinforced': 'Güçlendirilmiş Kirişler', 'unlockSawmill': 'Kereste Fabrikası', 'quarryStock': 'Taş Stoku',
      'unlockMortar': 'Havan', 'heavyOrdnance': 'Ağır Topçu', 'unlockTesla': 'Yıldırım Bobini',
      'gateArmor': 'Kapı Zırhı', 'unlockQuarry': 'Taş Ocağı', 'richHauls': 'Zengin Ganimet',
      'wideFoundation': 'Geniş Temel', 'siegeShells': 'Kuşatma Mermileri', 'unlockFrost': 'Buz Kulesi',
      'forkedBolts': 'Çatallı Yıldırımlar', 'ironPlating': 'Demir Plakalar', 'unlockRepair': 'Tamirhane',
      'unlockMint': 'Altın Madeni', 'looting': 'Yağma', 'overcharge': 'Aşırı Yükleme',
      'masterwork': 'Şaheser', 'fieldRepairs': 'Saha Onarımı', 'greatFoundation': 'Büyük Temel',
      'warChest': 'Savaş Sandığı',
      'unlockSpikes': 'Dikenli Duvar',
      'unlockBombard': 'Bombarda',
      'sharpSpikes': 'Bilenmiş Dikenler',
      'cavalryDrill': 'Süvari Talimi',
      'artilleryDoctrine': 'Topçu Doktrini'
    },
    'descriptions': {
      'foundations': 'Her blok +%{n} CP ile başlar.',
      'sharpBolts': 'Tüm silahlar kademe başına +%{n} hasar verir.',
      'unlockBrace': 'Takviyeli sandığı açar — ahşabın iki katı CP.',
      'lumberStock': 'Her kuşatmaya kademe başına +{n} odunla başla.',
      'longSight': 'Tüm silahlar kademe başına +%{n} daha uzağa erişir.',
      'rapidFire': 'Tüm silahlar kademe başına %{n} daha hızlı ateş eder.',
      'reinforced': 'Her blok kademe başına +%{n} CP kazanır.',
      'unlockSawmill': 'Kereste fabrikasını açar — her dalgada odun üretir.',
      'quarryStock': 'Her kuşatmaya kademe başına +{n} taşla başla.',
      'unlockMortar': 'Havanı açar — uzun menzilli alan hasarı.',
      'heavyOrdnance': 'Alan yarıçapı kademe başına +%{n}.',
      'unlockTesla': 'Yıldırım bobinini açar — yıldırımlar sıçrar.',
      'gateArmor': 'Kapı kademe başına +%{n} CP kazanır.',
      'unlockQuarry': 'Taş ocağını açar — her dalgada taş üretir.',
      'richHauls': 'Dalga ödülleri kademe başına +%{n}.',
      'wideFoundation': 'Kademe başına {n} sütun daha geniş inşa et.',
      'siegeShells': 'Tüm silahlar kademe başına +%{n} hasar verir.',
      'unlockFrost': 'Buz kulesini açar — tüm grupları yavaşlatır.',
      'forkedBolts': 'Yıldırım kademe başına {n} düşmana daha sıçrar.',
      'ironPlating': 'Her blok kademe başına +{n} zırh kazanır.',
      'unlockRepair': 'Tamirhaneyi açar — her dalgada komşuları iyileştirir.',
      'unlockMint': 'Altın madenini açar — her dalgada altın üretir.',
      'looting': 'Düşmanlar kademe başına +%{n} daha fazla altın düşürür.',
      'overcharge': 'Tüm silahlar kademe başına %{n} daha hızlı ateş eder.',
      'masterwork': 'Tüm silahlar kademe başına +%{n} hasar verir.',
      'fieldRepairs': 'Her blok, durdurulan dalga ve kademe başına maks. CP’sinin %{n}’sını yeniler.',
      'greatFoundation': 'Kademe başına {n} sütun daha geniş inşa et.',
      'warChest': 'Dalga ödülleri kademe başına +%{n}.',
      'unlockSpikes': 'Dikenli Duvarı açar — saldıranlar kendilerini yaralar.',
      'unlockBombard': 'Bombardayı açar — kara birliklerine kısa menzilli havan ateşi.',
      'sharpSpikes': 'Dikenli duvarlar rütbe başına %{n} daha fazla hasar yansıtır.',
      'cavalryDrill': 'Süvariler rütbe başına %{n} daha fazla CP ve hasarla çıkar.',
      'artilleryDoctrine': 'Tüm silahlar rütbe başına %{n} daha uzağa ulaşır.'
    }
  },

  'resources': {
    'wood': 'odun',
    'stone': 'taş',
    'coins': 'altın'
  },

  'ads': {
    'watch': 'İzle', 'revive': 'Dirilt', 'secondChance': 'İkinci Şans',
    'doubleCoins': '2× Altın', 'plusCoins': '+{n} altın'
  },

  'achievements': {
    'title': 'Başarımlar', 'subtitle': 'Kalıcı hedeflere ulaşarak altın kazan.',
    'claim': 'Al', 'claimed': 'Alındı', 'progress': '{c} / {t}',
    'items': {
      'wave5': { 'name': 'İlk Direniş', 'desc': '5. dalgaya kadar dayan.' },
      'wave10': { 'name': 'Kale', 'desc': '10. dalgaya kadar dayan.' },
      'wave20': { 'name': 'Siper', 'desc': '20. dalgaya kadar dayan.' },
      'wave30': { 'name': 'Kırılmaz', 'desc': '30. dalgaya kadar dayan.' },
      'waves50': { 'name': 'Dalgakıran', 'desc': 'Toplam 50 dalga durdur.' },
      'waves250': { 'name': 'Kuşatma Gazisi', 'desc': 'Toplam 250 dalga durdur.' },
      'kills500': { 'name': 'Savunucu', 'desc': 'Toplam 500 düşman yen.' },
      'kills5k': { 'name': 'Katil', 'desc': 'Toplam 5.000 düşman yen.' },
      'kills50k': { 'name': 'Efsane', 'desc': 'Toplam 50.000 düşman yen.' },
      'height10': { 'name': 'Göğe Doğru', 'desc': '10 blok yüksekliğinde bir kule inşa et.' },
      'height20': { 'name': 'Bulut Delen', 'desc': '20 blok yüksekliğinde bir kule inşa et.' },
      'blocks250': { 'name': 'İnşaatçı', 'desc': 'Toplam 250 blok yerleştir.' },
      'blocks2k': { 'name': 'Mimar', 'desc': 'Toplam 2.000 blok yerleştir.' },
      'coins5k': { 'name': 'Altın Toplayıcı', 'desc': 'Toplam 5.000 altın kazan.' },
      'coins50k': { 'name': 'Hazinedar', 'desc': 'Toplam 50.000 altın kazan.' },
      'runs25': { 'name': 'Azimli', 'desc': '25 kuşatma başlat.' }
    }
  },

  'missions': {
    'title': 'Günlük Görevler', 'subtitle': 'Her gün hedefleri tamamla, altın kazan.',
    'claim': 'Al', 'done': 'Alındı',
    'types': {
      'coins': 'Bugün {n} altın kazan',
      'waves': 'Tek kuşatmada {n}. dalgaya kadar dayan',
      'kills': 'Bugün {n} düşman yen',
      'blocks': 'Bugün {n} blok yerleştir'
    }
  },

  'battlePass': {
    'title': 'Savaş Bileti', 'progress': '{current} / {total}', 'daysLeft': '{n}g kaldı',
    'maxed': 'SAVAŞ BİLETİ TAMAMLANDI', 'xpProgress': '{current} / {total} XP',
    'howToEarn': 'XP nasıl kazanılır', 'perRun': 'kuşatma başına', 'perWave': 'durdurulan dalga başına',
    'unlockHint': 'Sonraki ödül için {n} XP’ye ulaş — alınmayan ödüller bekler.'
  },

  'dailyRewards': {
    'title': 'Günlük Ödüller', 'subtitle': 'Serini korumak için her gün giriş yap.',
    'day': '{n}. Gün', 'dayShort': 'G{n}'
  },

  'options': {
    'title': 'Seçenekler', 'general': 'Genel', 'audio': 'Ses', 'language': 'Dil',
    'difficulty': 'Zorluk', 'soundEffects': 'Ses Efektleri', 'music': 'Müzik', 'musicTrack': 'Müzik Parçası',
    'musicTracks': { 'cozy': 'Huzurlu Uyum', 'trance': 'Trance Tüneli' },
    'close': 'Kaydet ve Kapat',
    'difficulties': { 'easy': 'Kolay', 'medium': 'Orta', 'hard': 'Zor' },
    'difficultyHints': {
      'easy': 'Daha küçük dalgalar ve daha zayıf düşmanlar.',
      'medium': 'Standart, dengeli kuşatma.',
      'hard': 'Daha yoğun dalgalar ve daha dayanıklı düşmanlar.'
    }
  },

  'adsBlocked': {
    'title': 'Reklam gösterilemedi',
    'body': 'Ödülünü kazanabilmen için bir video göstermek istedik ama tarayıcındaki bir şey reklamları engelliyor.',
    'allowPrefix': 'Lütfen şu adreste reklamlara izin ver:',
    'allowSuffix': '(veya bu oyun için reklam engelleyiciyi duraklat) ve tekrar dene.',
    'gotIt': 'Anladım'
  },
  'saveStatus': {
    'restoredTitle': 'Bulut kaydı geri yüklendi', 'restoredBody': 'Kurtarma için +{n} bonus altın',
    'tap': 'dokun', 'pausedTitle': 'Bulut eşitlemesi duraklatıldı',
    'pausedBody': 'Çevrimdışı oynuyorsun. İlerlemen burada kaydediliyor.',
    'retry': 'Yeniden dene', 'dismiss': 'kapat'
  },
  'loading': { 'tooLong': 'Yükleme çok mu uzun sürüyor? Reklam engelleyiciyi kapatıp sayfayı yenile.' },
  'license': { 'denied': 'Erişim reddedildi: lütfen bir lisans satın al.' },
  'world': {
    'controlsHint': 'Etrafa bakmak için sürükle · Hareket için WASD · Yakınlaştırmak için kaydır veya sıkıştır'
  }
}
