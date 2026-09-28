import type { CastId } from './cast'

/**
 * ─── The words of Chapter 1 ─────────────────────────────────────────────────
 *
 * *Die Trollschweinjagd*, as spoken. German first, because that is what the book
 * is: `Chroniken von Arlaan` is a German manuscript and the dialogue below is the
 * author's own, taken from it and shortened where a paragraph on a page has to
 * become a line in a bubble. The English is a translation, not a source.
 *
 * ── Why this is not in `src/i18n/locales/` ──────────────────────────────────
 *
 * Every other player-facing string in this project goes through vue-i18n and is
 * mirrored into all 21 shipped locales, and `tests/i18nParity.test.ts` enforces
 * that exactly. This does not, and the reason is that the two things are
 * different in kind.
 *
 * The locale bundles are **UI chrome** — "Continue", "Graphics", "{n} patches on
 * screen" — where a machine translation is not merely acceptable but correct: the
 * words are functional and the failure mode of a bad one is a slightly odd button.
 * This is **prose**, written by an author, in a voice, with jokes in it. Pushing
 * forty lines of literary German through twenty machine translations would
 * produce nineteen bad translations of somebody's novel and a parity test that
 * passes.
 *
 * So the chapter's text is **content, like a level is content**. It ships as data
 * beside the level it belongs to, in the two languages that were actually
 * written, and `storyLine()` falls back to English for every other locale — which
 * is the same fallback vue-i18n would perform, arrived at honestly. The HUD around
 * it (objective labels, the button that advances a line, the death message) *is*
 * chrome and *is* in all 21.
 *
 * ── Who speaks ──────────────────────────────────────────────────────────────
 *
 * `CastId` for anyone in the world, plus four frame-story voices who never
 * appear as figures: the storyteller himself, his grandson Arthus, his
 * granddaughter Lena, and their father the smith. The frame is told in text
 * cards over the world, which is what the book does — it cuts to a fireside
 * mid-chapter, five times, and expects you to keep both.
 */

/**
 * ── The frame's voices are now cast ids, and the four old aliases stay ──────
 *
 * `arthus`, `lena`, `smith` and `narrator` were text-card voices when the frame
 * was five cards over a black screen. It is now a played act in a room with
 * figures in it, so those four have bodies — `arthusBoy`, `lenaGirl`,
 * `smithFather`, `storyteller` — and lines spoken *in the room* use those.
 *
 * The aliases are kept rather than migrated because they still mean something
 * different: a line from `narrator` is the storyteller's voice-over **across a
 * cut**, laid over Arlaan sixty years earlier, and it is drawn as a fireside
 * card rather than as a bubble over anybody's head. `storyteller` is the same
 * man speaking in the room, to a boy who can answer him.
 */
export type Speaker = CastId | 'narrator' | 'arthus' | 'lena' | 'smith' | 'nidaneVoice' | 'brutos'

export interface Line {
  who: Speaker
  de: string
  en: string
  /**
   * Rendered as a frame-story card rather than as a speech bubble in the world.
   *
   * The fireside is a *different place*, decades later, and drawing it as a
   * bubble over Athalus's head would collapse the two timeframes the book keeps
   * carefully apart.
   */
  frame?: boolean
}

/** A named block of dialogue. Beats in `chapter1.ts` play these by id. */
export type ScriptId = keyof typeof SCRIPT

export const SCRIPT = {
  // ══════════════════════════════════════════════════════════════════════════
  // The frame act: one room, one afternoon, sixty years later
  //
  // Played rather than narrated. The player is Arthus, nine years old, and the
  // act is the household assembling around a table until there is nobody left
  // to wait for — which is the only condition under which the old man will
  // start. Every beat of it is in the manuscript; what is added is that you
  // walk it.
  // ══════════════════════════════════════════════════════════════════════════
  frameAsk: [
    {
      who: 'arthusBoy',
      de: '„Grandpa, Grandpa, du musst mir alles erzählen!"',
      en: '"Grandpa, Grandpa, you have to tell me everything!"'
    },
    {
      who: 'storyteller',
      de: '„Worüber soll ich dir denn alles erzählen, Junge?"',
      en: '"And what would you have me tell you about, boy?"'
    },
    {
      who: 'arthusBoy',
      de: '„Von damals! Als noch Krieg herrschte und der Held gegen den bösen König kämpfte. Papa sagt, du wärst dabei gewesen — und hättest den Greifen gesehen. Und den Drachen."',
      en: '"About back then! When there was still war, and the hero fought the wicked king. Papa says you were there — and that you saw the griffin. And the dragon."'
    },
    {
      who: 'storyteller',
      de: '„Ach. *Die* Geschichte meinst du." Er lächelte. „Aber sie ist sehr lang, mein Kleiner. An einem einzigen Nachmittag schaffe ich das nicht."',
      en: '"Ah. You mean *that* story." He smiled. "But it is a very long one, little man. I could not manage it in a single afternoon."'
    },
    {
      who: 'arthusBoy',
      de: '„Das ist doch egal! Der Sommer hat angefangen, und Papa muss die nächsten Tage nicht viel arbeiten — er hat den letzten Dolch gerade fertig, den mit den Gravierungen für den Grafen."',
      en: '"That doesn\'t matter! Summer has started, and Papa hasn\'t much work these next few days — he has just finished the last dagger, the engraved one for the count."'
    },
    {
      who: 'arthusBoy',
      de: '„Und Lena hab ich losgeschickt, damit sie Mama holt und herbringt. Sie wollen die Geschichte auch hören."',
      en: '"And I sent Lena to fetch Mama and bring her here. They want to hear it too."'
    },
    {
      who: 'storyteller',
      de: '„Du hast es ja sehr eilig. Doch das ist schon in Ordnung — ich fang an, sobald alle da sind." Er verlagerte sein Gewicht. „Hol mir doch bitte ein Kissen für meinen Rücken, während wir warten."',
      en: '"You are in a great hurry. But that is quite all right — I shall begin as soon as everyone is here." He shifted his weight. "Fetch me a cushion for my back, would you, while we wait."'
    }
  ],

  frameCushion: [
    {
      who: 'storyteller',
      de: '„Ah. Das ist besser. Danke, mein Junge."',
      en: '"Ah. That is better. Thank you, my boy."'
    },
    {
      who: 'storyteller',
      de: '„Ein alter Rücken und ein harter Stuhl vertragen sich nicht. Ein Geschichtenerzähler mit Schmerzen erzählt schlecht — fast so schlecht wie einer mit trockener Kehle."',
      en: '"An old back and a hard chair do not agree. A storyteller in pain tells badly — almost as badly as one with a dry throat."'
    }
  ],

  frameFather: [
    {
      who: 'smithFather',
      de: '„Hast du Großvater schon gefragt?"',
      en: '"Have you asked your grandfather yet?"'
    },
    {
      who: 'arthusBoy',
      de: '„Ja! Er erzählt sie uns, sobald Lena und Mama da sind. Ich kann es gar nicht mehr erwarten. Wo bleiben die denn?"',
      en: '"Yes! He is going to tell it as soon as Lena and Mama are here. I cannot wait any longer. Where have they got to?"'
    },
    {
      who: 'smithFather',
      de: '„Ich hab sie auf der Straße gesehen. Sie müssten gleich da sein." Er verstaute den Hammer in der Kiste. „Schau doch mal zur Tür hinaus."',
      en: '"I saw them on the road. They should be here any moment." He stowed the hammer in the chest. "Go and look out of the door."'
    }
  ],

  frameCall: [
    {
      who: 'arthusBoy',
      de: '„Mama! Lena! Kommt schnell und setzt euch — Großvater erzählt die Geschichte über den bösen König. Er war nämlich selbst dabei!"',
      en: '"Mama! Lena! Come quickly and sit down — Grandfather is going to tell the story about the wicked king. He was there himself!"'
    },
    {
      who: 'lenaGirl',
      de: '„Ich hab Mama geholt! Ich hab Mama geholt!"',
      en: '"I fetched Mama! I fetched Mama!"'
    },
    {
      who: 'motherMara',
      de: '„Ja, ja. Lass mich nur erst die Eimer abstellen, Kind."',
      en: '"Yes, yes. Only let me put the pails down first, child."'
    }
  ],

  frameBegin: [
    {
      who: 'smithFather',
      de: '„So. Der Wein steht auf dem Tisch. Setzt euch, alle."',
      en: '"There. The wine is on the table. Sit down, all of you."'
    },
    {
      who: 'storyteller',
      de: '„Ein Geschichtenerzähler mit trockener Kehle kann keine gute Geschichte erzählen." Er goss sich ein Glas ein und trank.',
      en: '"A storyteller with a dry throat cannot tell a good story." He poured himself a glass and drank.'
    },
    {
      who: 'storyteller',
      de: '„Also gut. Eines Tages, der Sommer war gerade angebrochen, da waren ich und meine Freunde wieder einmal auf Trollschweinjagd."',
      en: '"Very well. One day, just as summer had broken, my friends and I were out hunting Trollschwein again."'
    },
    {
      who: 'storyteller',
      de: '„Natürlich haben unsere Eltern uns das nicht erlaubt. Wir waren ja alle noch ziemlich grün hinter den Ohren …"',
      en: '"Our parents had not allowed it, of course. We were all still very green behind the ears …"'
    }
  ],

  // ══════════════════════════════════════════════════════════════════════════
  // The fireside, cutting across the story
  // ══════════════════════════════════════════════════════════════════════════
  /**
   * The cut itself.
   *
   * Everything the old prologue said is now *played*, in the room, in `frameAsk`
   * through `frameBegin` — so what is left here is one card: the sentence that
   * carries the player out of the island and into Arlaan sixty years earlier.
   * That is the whole job of a transition and it should be one line long.
   */
  prologue: [
    {
      who: 'narrator',
      frame: true,
      de: '… und so beginnt die Geschichte an einem Sommermorgen, tief in den Wäldern nördlich von Nimmerschein.',
      en: '… and so the story begins on a summer morning, deep in the woods north of Nimmerschein.'
    }
  ],

  // ══════════════════════════════════════════════════════════════════════════
  // The trap
  // ══════════════════════════════════════════════════════════════════════════
  trapBriefing: [
    {
      who: 'gearn',
      de: '„Also nochmal, damit auch der Schmiedssohn es versteht: Ich treibe das Vieh her, ihr kappt die Seile, das Netz geht hoch. Kinderspiel."',
      en: '"Once more, so even the smith\'s son follows it: I drive the thing in, you two cut the ropes, the net goes up. Child\'s play."'
    },
    {
      who: 'kareen',
      de: '„Erst wenn du zwischen uns durch bist, Gearn. Nicht vorher. Ich will dich nicht aus dem Netz schneiden müssen."',
      en: '"Not until you are through between us, Gearn. Not before. I would rather not have to cut you out of it."'
    },
    {
      who: 'jester',
      de: '„Und danach schießen wir. Sofort. Nicht jubeln, nicht klatschen — schießen."',
      en: '"And then we shoot. At once. No cheering, no back-slapping — we shoot."'
    },
    {
      who: 'athalus',
      de: '„Dann los. Auf eure Plätze, ehe es Mittag wird."',
      en: '"Then go. To your places, before it turns noon."'
    }
  ],

  trapSprung: [
    {
      who: 'gearn',
      de: '„HA! Habt ihr das gesehen?! Acht mal acht Schritt Netz, und es hängt darin wie eine Wurst!"',
      en: '"HA! Did you see that?! Eight paces by eight of net, and it is hanging in there like a sausage!"'
    },
    {
      who: 'jester',
      de: '„Wir hätten schießen sollen. Wir haben nicht geschossen."',
      en: '"We were meant to shoot. We did not shoot."'
    },
    {
      who: 'kareen',
      de: '„Athalus. Es beißt sich durch."',
      en: '"Athalus. It is chewing through."'
    }
  ],

  boarLoose: [
    {
      who: 'gearn',
      de: '„LAUFT!"',
      en: '"RUN!"'
    },
    {
      who: 'narrator',
      frame: true,
      de: 'Das Biest hatte sich in rasender Wut durch das Netz gebissen. Und von uns allen — von uns allen! — wählte es Athalus.',
      en: 'The beast had bitten its way through the net in a raging fury. And of all of us — of all of us — it chose Athalus.'
    }
  ],

  boarChase: [
    {
      who: 'athalus',
      de: '„Bei Athos, wie habe ich mir das nur wieder eingebrockt?"',
      en: '"By Athos — how do I keep getting myself into this?"'
    },
    {
      who: 'kareen',
      de: '„Zur Eiche! Athalus, zur Eiche!"',
      en: '"The oak! Athalus, get to the oak!"'
    }
  ],

  treed: [
    {
      who: 'athalus',
      de: '„Freunde, helft mir doch! Jester, ich bin hier!"',
      en: '"Friends — help me! Jester, I am here!"'
    },
    {
      who: 'jester',
      de: '„Halt dich fest, Bruder! Kareen hat es im Visier!"',
      en: '"Hold on, brother! Kareen has it!"'
    },
    {
      who: 'narrator',
      frame: true,
      de: 'Ein Zischen ging durch die Luft, und die Bestie quiekte auf.',
      en: 'A hiss went through the air, and the beast squealed.'
    }
  ],

  boarDown: [
    {
      who: 'gearn',
      de: '„War doch mal wieder ein Kinderspiel."',
      en: '"Child\'s play, like I said."'
    },
    {
      who: 'athalus',
      de: '„Ja, für dich vielleicht. Ich musste wie ein feiger Goblin wegrennen. Und ich hätte mir alle Knochen brechen können — da hat Athos seine schützende Hand über mich gehalten."',
      en: '"For you, perhaps. I had to run like a coward goblin. And I could have broken every bone in my body — Athos held his hand over me there."'
    },
    {
      who: 'kareen',
      de: '„Ich stand direkt daneben und bin als Letzte losgelaufen. Trotzdem hat es sich für unseren Freund hier entschieden."',
      en: '"I was standing right beside it and I ran last of all. It still chose our friend here."'
    },
    {
      who: 'gearn',
      de: '„Muss wohl an deiner hübschen Fresse liegen. Sie hat sich glatt in dich verliebt und ist dir liebestrunken hinterhergerannt."',
      en: '"Must be that handsome face of yours. It fell head over heels and came after you love-drunk."'
    },
    {
      who: 'athalus',
      de: '„Ich zeig dir gleich eine hübsche Fresse — das wird dann aber deine sein."',
      en: '"I will show you a handsome face in a moment. It will be yours."'
    },
    {
      who: 'jester',
      de: '„Deine Sachen. Bogen und Dolch, beides im Farn. Du hast sie im Laufen verloren."',
      en: '"Your things. Bow and knife, both in the fern. You dropped them while you ran."'
    }
  ],

  hauling: [
    {
      who: 'athalus',
      de: '„Kommt, packt mal mit an. Wir müssen das Schwein ins Dorf bringen, bevor es Mittag wird. Wir sind jetzt schon seit Stunden weg — und haben keinem Bescheid gesagt."',
      en: '"Come on, lend a hand. We have to get this pig back to the village before noon. We have been gone for hours already — and told nobody where."'
    }
  ],

  // ══════════════════════════════════════════════════════════════════════════
  // The walk home: the mad king
  // ══════════════════════════════════════════════════════════════════════════
  kingTalk: [
    {
      who: 'jester',
      de: '„Habt ihr gehört, dass der König vor drei Tagen mit Katapulten und Magiern versucht hat, die Barriere zu durchdringen? Stundenlang hat er sie beschießen lassen — und die Steinbrocken kamen zurückgeflogen und trafen die eigenen Truppen."',
      en: '"Have you heard the King spent three days ago trying to break the barrier with catapults and mages? Hours of it — and the stones came flying back and struck his own troops."'
    },
    {
      who: 'kareen',
      de: '„Woher weißt du das? Du warst doch nicht selbst dort. Wir haben an dem Tag alle zusammen Schwertkampf geübt."',
      en: '"And how would you know? You weren\'t there. We were all together that day, practising with swords."'
    },
    {
      who: 'jester',
      de: '„Jonas hat es im Gasthaus verkündet. Stolz und besoffen. Er hat die königlichen Truppen vom Waldrand aus beobachtet."',
      en: '"Jonas announced it at the inn. Proud and drunk. He watched the royal troops from the edge of the wood."'
    },
    {
      who: 'kareen',
      de: '„Jonas erzählt viel, wenn der Tag lang ist. Das weiß ich von den Holzlieferungen."',
      en: '"Jonas talks a great deal when the day is long. I know that from the timber deliveries."'
    },
    {
      who: 'gearn',
      de: '„Und meistens wird der Tag dadurch noch sehr viel länger."',
      en: '"And mostly the day gets a great deal longer for it."'
    },
    {
      who: 'jester',
      de: '„Diesmal glaubte ich ihm. Immerhin ist der König unberechenbar. Bedenkt nur, wie er an die Krone gekommen ist — aus dem Nichts aufgetaucht, die Hauptstadt mit dem Feuer seines Drachen überfallen, und Arthus II. gezwungen, ihm die Krone zu überlassen."',
      en: '"This time I believed him. The King is unpredictable, after all. Only consider how he came by the crown — appeared out of nowhere, fell on the capital with his dragon\'s fire, and forced Arthus the Second to hand it over."'
    },
    {
      who: 'kareen',
      de: '„Der alte König hatte keine Wahl. Sonst wäre alles innerhalb der Mauern niedergebrannt. Und fliehen konnte niemand — einem Drachen entkommt kaum jemand."',
      en: '"The old king had no choice. Everything inside the walls would have burned. And no one could flee — hardly anyone escapes a dragon."'
    },
    {
      who: 'athalus',
      de: '„Aber wie konnte es überhaupt so weit kommen? Die Hauptstadt hat Ballisten. Genau für solche Fälle, sagt mein Vater."',
      en: '"But how did it come to that at all? The capital has ballistae. For exactly this, my father says."'
    },
    {
      who: 'gearn',
      de: '„Er war schlau. Kurz vor Morgengrauen, als die Wachen müde waren. Der Drache kam im Sturzflug aus wahnwitziger Höhe und hüllte die erste Balliste in Feuer. Sieben weitere, der Reihe nach, ehe auch nur eine geladen war."',
      en: '"He was clever. Just before dawn, when the watch was tired. The dragon came out of a mad height in a dive and wrapped the first ballista in fire. Seven more, one after another, before a single one was loaded."'
    },
    {
      who: 'gearn',
      de: '„Hey Jester — hattest du nicht erzählt, der König sei auch ein Magier?"',
      en: '"Hey, Jester — didn\'t you say the King was a mage as well?"'
    },
    {
      who: 'jester',
      de: '„So erzählt man es. Gesehen hat ihn noch keiner zaubern. Man weiß nur, dass er ein Buch sucht — das Buch der Ahnen. Es heißt, er habe die Hauptstadt nur deswegen angegriffen."',
      en: '"So it is told. Nobody has seen him cast. All anyone knows is that he is looking for a book — the Book of Ancestors. They say he attacked the capital for that alone."'
    },
    {
      who: 'jester',
      de: '„Und das, obwohl er nicht einmal ein echter Mensch ist. Stellt euch das vor: ein Menschenkönig, der kein Mensch ist."',
      en: '"And this from someone who is not even truly a man. Imagine it — a king of men who is no man."'
    },
    {
      who: 'kareen',
      de: '„Ach ja? Was ist er denn dann?"',
      en: '"Oh? Then what is he?"'
    },
    {
      who: 'jester',
      de: '„Ein Halbelf, sagt man. Spitze Ohren. Aussehen wie ein Mensch, aber die Ohren eines Elfen — und silbernes Haar. Also weder Licht- noch Dunkelelf."',
      en: '"A half-elf, they say. Pointed ears. He looks like a man, but he has an elf\'s ears — and silver hair. So neither a light elf nor a dark one."'
    },
    {
      who: 'athalus',
      de: '„Ich würde zu gern wissen, was er mit dem Buch der Ahnen vorhat. Er hat sich große Mühe gemacht, es in seinen Besitz zu bringen."',
      en: '"I would dearly like to know what he wants the Book of Ancestors for. He has gone to a great deal of trouble to get hold of it."'
    },
    {
      who: 'gearn',
      de: '„Na, das ist doch klar: das Rezept für die besten Brötchen von ganz Arlaan. Mit Backanleitung und stilvollem Stillleben."',
      en: '"Obvious, isn\'t it — the recipe for the finest bread rolls in all Arlaan. With baking instructions and a tasteful still life."'
    },
    {
      who: 'kareen',
      de: '„Wozu braucht ein Magier wohl ein Buch, du Spatzenhirn? Um mächtiger zu werden. Einen Drachen hat er ja schon."',
      en: '"What would a mage want with a book, sparrow-brain? To become more powerful. He already has a dragon."'
    }
  ],

  bridge: [
    {
      who: 'narrator',
      frame: true,
      de: 'Sie überquerten eine kleine, sechs Fuß breite Holzbrücke über den Arla — den Fluss, der durch das ganze Königreich fließt und an dem weiter südlich die Hauptstadt Darlon liegt.',
      en: 'They crossed a small wooden bridge, six feet wide, over the Arla — the river that runs through the whole kingdom, and on which, far to the south, the capital Darlon stands.'
    },
    {
      who: 'narrator',
      frame: true,
      de: 'Wegen dieses Flusses kam Nimmerschein besonders leicht an Handelswaren. Ein Dorfhändler pendelte alle zwei Wochen nach Darlon — im ganzen Königreich einzigartig.',
      en: 'Because of that river, Nimmerschein came by traded goods more easily than most. A village trader made the run down to Darlon every fortnight — the only one of his kind in the kingdom.'
    },
    {
      who: 'gearn',
      de: '„Ich möchte den Wahnsinnigen nicht verteidigen, aber er hat auch Gutes getan. Er hat Räubernester niedergebrannt. Danach haben viele es mit der Angst bekommen und sind aus Arlaan geflohen."',
      en: '"I don\'t mean to defend the madman, but he has done good as well. He burned out the bandit nests. A great many of them took fright afterwards and fled Arlaan altogether."'
    },
    {
      who: 'kareen',
      de: '„Aber woher wissen wir, dass diese Gerüchte wahr sind? Man kann einem Wahnsinnigen nicht trauen."',
      en: '"And how do we know any of those rumours are true? You cannot trust a madman."'
    },
    {
      who: 'kareen',
      de: '„Lasst uns hier eine kleine Pause machen. Das Schwein wird richtig schwer. Ich sehe schon die Palisaden — aber eine halbe League ist es noch."',
      en: '"Let us stop here a moment. This pig is getting genuinely heavy. I can see the palisade already — but it is still half a league."'
    }
  ],

  // ══════════════════════════════════════════════════════════════════════════
  // The ambush
  // ══════════════════════════════════════════════════════════════════════════
  restStop: [
    {
      who: 'narrator',
      frame: true,
      de: 'Sie legten das Trollschwein ab und setzten sich im Kreis auf die Wiese. Der Wind umspielte die Baumwipfel. Vögel zwitscherten. Diese Ruhe währte jedoch nicht lange.',
      en: 'They set the Trollschwein down and sat in a ring on the meadow grass. Wind played through the treetops. Birds sang. That quiet did not last long.'
    },
    {
      who: 'jester',
      de: '„Ich hab mich mit dem Rücken zum Dorf gesetzt. Ich weiß auch nicht — ich hab das Gefühl, wir werden beobachtet."',
      en: '"I sat with my back to the village. I don\'t know why — I have the feeling we are being watched."'
    },
    {
      who: 'gearn',
      de: '„Du hast immer irgendein Gefühl, Jester."',
      en: '"You always have some feeling or other, Jester."'
    },
    {
      who: 'jester',
      de: '„RÄUBER!"',
      en: '"BANDITS!"'
    }
  ],

  banditsBroken: [
    {
      who: 'banditLeader',
      de: '„Wir haben euch unterschätzt."',
      en: '"We underestimated you."'
    },
    {
      who: 'narrator',
      frame: true,
      de: 'Daraufhin packte er den am Boden Liegenden und zog ihn mit sich Richtung Waldrand. Die Räuber sammelten die Verwundeten auf und verschwanden im Dickicht.',
      en: 'At that he took hold of the man on the ground and dragged him away toward the treeline. The bandits gathered up their wounded and vanished into the thicket.'
    },
    {
      who: 'athalus',
      de: '„Nehmt das Trollschwein und nichts wie weg hier! Wir müssen das Dorf erreichen, bevor noch mehr auftauchen und uns die Kehle aufschneiden!"',
      en: '"Take the Trollschwein and get moving! We have to reach the village before more of them turn up and cut our throats!"'
    },
    {
      who: 'gearn',
      de: '„Gute Reaktion, Kumpel. Wenn du dieses Pack nicht so schnell gesehen hättest, wären wir jetzt alle tot. Sagtest du nicht, die Räuber wären außer Landes geflohen?"',
      en: '"Good eyes, friend. If you hadn\'t spotted that lot so fast we would all be dead. Didn\'t you say the bandits had fled the country?"'
    },
    {
      who: 'jester',
      de: '„Der König hat ihnen Angst gemacht. Aber es gibt sehr viele Banditen in Arlaan, und nicht alle haben den Schrecken aus dem Himmel gesehen."',
      en: '"The King frightened them. But there are a great many bandits in Arlaan, and not all of them saw the terror out of the sky."'
    },
    {
      who: 'jester',
      de: '„Am besten, wir erwähnen das nicht mehr. Sonst dürfen wir das Dorf nie wieder verlassen."',
      en: '"Best we don\'t mention this again. Or we shall never be let out of the village."'
    },
    {
      who: 'gearn',
      de: '„Ich bin mir nicht ganz sicher, ob ich das jemals wieder will."',
      en: '"I am not entirely sure I ever want to be."'
    }
  ],

  // ══════════════════════════════════════════════════════════════════════════
  // The gate
  // ══════════════════════════════════════════════════════════════════════════
  theodor: [
    {
      who: 'theodor',
      de: '„Hey Leute, was habt ihr denn heute Schönes erlegt? Ist das ein Trollschwein? Sieht ja lecker aus — ich hoff, ich krieg ein Stück ab!"',
      en: '"Hey, you lot — what fine thing have you killed today? Is that a Trollschwein? Looks delicious. I hope I get a piece of it!"'
    },
    {
      who: 'gearn',
      de: '„Sicher, Theo. Komm nachher einfach zum Treff. Wir rösten das Vieh heute Abend und erzählen uns Geschichten. Du bist eingeladen — und bring deine süße Schwester Lara mit, sie darf nicht fehlen."',
      en: '"Of course, Theo. Just come by the Treff later. We are roasting the thing tonight and telling stories. You are invited — and bring that sweet sister of yours, Lara. She cannot be missing."'
    },
    {
      who: 'lena',
      frame: true,
      de: '„Und was war da zwischen dieser Lara und Gearn, Grandpa? Waren sie verliebt?"',
      en: '"And what was there between this Lara and Gearn, Grandpa? Were they in love?"'
    },
    {
      who: 'narrator',
      frame: true,
      de: '„Ihr seid beide so ungeduldig, meine Lieben. Aber ja — es schien etwas Ernstes zwischen den beiden zu laufen."',
      en: '"You are both so impatient, my dears. But yes — there did seem to be something serious between those two."'
    }
  ],

  treff: [
    {
      who: 'athalus',
      de: '„Wir haben es geschafft, und gefolgt ist uns keiner mehr. Legen wir das Schwein hier ab. Sagt euren Eltern Bescheid, dass wir zurück sind — und ein paar Freunden, dass es heute Abend was zu feiern gibt."',
      en: '"We made it, and nobody followed us. Let us lay the pig down here. Tell your parents we are back — and tell a few friends there is something to celebrate tonight."'
    },
    {
      who: 'athalus',
      de: '„Gearn, kannst du Bier und Met besorgen?"',
      en: '"Gearn, can you see to beer and mead?"'
    },
    {
      who: 'gearn',
      de: '„Selbstverständlich, Kumpel. Ich bring so viel mit, dass du morgen nicht mehr weißt, was du heut Abend gemacht hast."',
      en: '"Naturally, friend. I shall bring enough that tomorrow you won\'t remember what you did tonight."'
    },
    {
      who: 'athalus',
      de: '„Gearn, übertreib es nicht. Wir wollen doch nicht, dass das ganze Dorf wach wird."',
      en: '"Gearn, do not overdo it. We do not want the whole village awake."'
    },
    {
      who: 'gearn',
      de: '„Ja, ist schon gut, du Spielverderber. Dann hol ich halt nur ein paar Flaschen." … „Und für mich ein paar mehr."',
      en: '"All right, all right, spoilsport. A few bottles, then." … "And a few more for me."'
    }
  ],

  home: [
    {
      who: 'nidane',
      de: '„Wo seid ihr nur gewesen?! Wir haben uns Sorgen gemacht. Den ganzen Tag weg, und keinem Bescheid gesagt!"',
      en: '"Where on earth have you been?! We have been worried. Gone the whole day and not a word to anyone!"'
    },
    {
      who: 'nidane',
      de: '„Athalus, du solltest heute deinem Vater in der Schmiede helfen. Seine Arbeit stapelt sich. Und Jester — du hast keine einzige deiner Aufgaben gemacht."',
      en: '"Athalus, you were to help your father in the forge today. His work is piling up. And Jester — you have not done a single one of your tasks."'
    },
    {
      who: 'athalus',
      de: '„Tut uns leid, Mutter. Wir haben die Zeit vergessen. Aber dafür haben wir im Wald ein riesiges Schwein gefangen — und sind danach direkt heimgekommen, um Euch und Vater etwas von dem Fleisch abzugeben."',
      en: '"We are sorry, Mother. We lost track of the time. But we caught an enormous pig in the wood — and came straight home to give you and Father some of the meat."'
    },
    {
      who: 'jester',
      de: '„Wir wissen doch, wie dringend Vater gutes Fleisch braucht, damit er sein Handwerk erledigen kann. Und die Aufgaben können wir morgen erledigen."',
      en: '"We know how badly Father needs good meat to do his work. And the tasks can be done tomorrow."'
    },
    {
      who: 'nidane',
      de: '„Trotzdem haben wir uns Sorgen gemacht. Jester, du hast deine Lesestunde verpasst. Fernando sagt, du hast es noch immer nicht begriffen — von links nach rechts, von oben nach unten!"',
      en: '"We were worried all the same. Jester, you missed your reading lesson. Fernando says you still have not grasped it — left to right, top to bottom!"'
    },
    {
      who: 'nidane',
      de: '„Jetzt seid ihr wenigstens wieder da. Geht euch waschen. Ihr seid überall dreckig und stinkt, als hättet ihr im Klohäuschen gespielt."',
      en: '"At least you are back. Go and wash. You are filthy all over and you smell as though you had been playing in the privy."'
    },
    {
      who: 'athalus',
      de: '„Aber Ma, wir wollten gleich mit ein paar Freunden raus —"',
      en: '"But Ma, we were going straight back out with some friends —"'
    },
    {
      who: 'nidane',
      de: '„Waschen! Sofort!"',
      en: '"Wash! Now!"'
    }
  ],

  epilogue: [
    {
      who: 'arthus',
      frame: true,
      de: '„Grandpa, war das Ferkel genauso lecker, wie ich es mir vorstelle?"',
      en: '"Grandpa, was the piglet as delicious as I imagine?"'
    },
    {
      who: 'narrator',
      frame: true,
      de: '„Es war köstlich, mein Kind. Aber es war kein Ferkel, sondern ein ausgewachsenes Trollschwein. Vier Fuß hoch und bestimmt acht Fuß lang."',
      en: '"It was superb, child. But it was no piglet — it was a full-grown Trollschwein. Four feet tall and a good eight feet long."'
    },
    {
      who: 'arthus',
      frame: true,
      de: '„Papa, habt ihr mich nach dem damaligen König benannt? Er hat den gleichen Namen wie ich."',
      en: '"Papa, did you name me after the king back then? He has the same name as me."'
    },
    {
      who: 'smith',
      frame: true,
      de: '„Nun, ja — in gewisser Weise schon. Obwohl es ein anderer König war, den ich damals im Sinn hatte. Wir benannten dich nach König Arthus IV. Und das war eine sehr gute Entscheidung."',
      en: '"Well — in a manner of speaking, yes. Although it was a different king I had in mind. We named you after King Arthus the Fourth. And it was a very good decision."'
    },
    {
      who: 'narrator',
      frame: true,
      de: 'Während sich die Freunde auf den Abend vorbereiteten, heckten die Banditen unweit des Dorfes einen neuen Plan aus.',
      en: 'And while the friends made ready for the evening, not far from the village the bandits were laying a new plan.'
    }
  ],
  // ══════════════════════════════════════════════════════════════════════════
  // Chapter 2 — Brutos
  //
  // A camp in the wood, an argument round a fire, and the plan that becomes the
  // rest of the book. The manuscript's own chapter has no player in it at all:
  // it is four men talking, and the reader is a fly on the tent. Playing it as
  // **Brutos** is this adaptation's one liberty, and `Beat.player` already
  // carries it — the same field that makes you nine years old for the frame act.
  //
  // ── One line of the source is not here, and it is deliberate ──────────────
  //
  // Brutos and Dorgo both promise the men what they may do to Kareen once she is
  // taken. It is there to make them repellent and it works, on the page, for an
  // adult reader. This is a game that ships to portals with a young audience and
  // renders its dialogue over a scene the player is standing in.
  //
  // So the cruelty is kept — they mean to sell her, and Dorgo means to kill the
  // boy who lamed him — and the sexual threat is not written. Nothing else is
  // softened, and no fact of the plot is changed by leaving it out.
  // ══════════════════════════════════════════════════════════════════════════

  banditsCamp: [
    {
      who: 'narrator',
      de: 'Nicht weit von Nimmerschein beriet eine kleine Räuberbande, wie sie die Schmach der letzten Stunden lindern könnte.',
      en: 'Not far from Nimmerschein, a small band of robbers was deciding how to answer the humiliation of the last few hours.'
    },
    {
      who: 'brutos',
      de: '„Dorgo, du Schlappschwanz, hör auf zu heulen. Das ist eine Fleischwunde."',
      en: '"Dorgo, you milksop, stop snivelling. That is a flesh wound."'
    },
    {
      who: 'brutos',
      de: '„Ehrlich, ich hätte nicht gedacht, dass diese Knirpse überhaupt eine Waffe halten können. Und zwei von ihnen schießen auch noch mit dem Bogen."',
      en: '"Honestly, I would not have credited those brats with holding a weapon at all. And two of them shoot, on top of it."'
    },
    {
      who: 'dorgo',
      de: '„Du hast gut reden. Dich hat keiner verkrüppelt. Byrd wird nie wieder laufen — die Kleine hat ihm die Ferse durchtrennt."',
      en: '"Easy for you to say. Nobody crippled you. Byrd will never walk again — the girl went straight through his heel."'
    },
    {
      who: 'dorgo',
      de: '„Ich darf nur ein Bein belasten und stütze mich auf einen Stock. Warum mussten wir ausgerechnet diese Gruppe überfallen?"',
      en: '"I can put weight on one leg and I lean on a stick for the rest. Why did we have to rob that particular party?"'
    },
    {
      who: 'brutos',
      de: '„Es waren Kinder. Woher sollte ich wissen, dass sie bis an die Zähne bewaffnet sind und auch noch kämpfen können?"',
      en: '"They were children. How was I to know they were armed to the teeth and could fight as well?"'
    },
    {
      who: 'dorgo',
      de: '„Ein bisschen weniger gierig sein. Das würde schon helfen."',
      en: '"Be a little less greedy. That would help."'
    }
  ],

  banditsGold: [
    {
      who: 'brutos',
      de: '„Hör zu. Ich habe keine Lust, mich abzurackern. Ich will genauso fette Beute machen wie die Drachenschinder."',
      en: '"Listen. I have no appetite for grinding away. I want a haul as fat as the Dragonflayers get."'
    },
    {
      who: 'brutos',
      de: '„Die haben hier vor Nimmerschein eine Magierin gefangen und richtig Gold dafür kassiert. Fünfzig Goldstücke allein für das Weibsbild."',
      en: '"They took a magician right outside Nimmerschein and were paid properly for it. Fifty gold pieces for the woman alone."'
    },
    {
      who: 'dorgo',
      de: '„Wer zahlt denn so viel Gold für eine Frau?"',
      en: '"And who pays that much gold for a woman?"'
    },
    {
      who: 'brutos',
      de: '„Der verrückte neue König. Der wirft mit dem Gold der Krone nur so um sich. Und sie ist eine Magierin, du Vollidiot — für einen Machthungrigen sind die immer viel wert."',
      en: '"The mad new king. He throws the crown\'s gold about like chaff. And she is a magician, you halfwit — to a man hungry for power they are always worth a great deal."'
    },
    {
      who: 'brutos',
      de: '„Neben ein paar Schriftrollen haben sie bei ihr auch einen Kristall gefunden. Blau wie das Meer, feingeschliffen wie die Schätze von Arthus dem Zweiten, und einen ganzen Batzen Gold wert."',
      en: '"Along with a few scrolls they found a crystal on her. Blue as the sea, cut as finely as the treasures of Arthus the Second, and worth a heap of gold."'
    },
    {
      who: 'brutos',
      de: '„Und ich brauche dieses Gold. Die Schwarzzähne sind tot, jeder Einzelne — dieser vermaledeite Halbelf hat sie alle getötet. Ich will die Reihen wieder auffüllen."',
      en: '"And I need that gold. The Black Teeth are dead, every last one of them — that cursed half-elf killed them all. I mean to fill the ranks again."'
    }
  ],

  banditsJergo: [
    {
      who: 'jergo',
      de: '„Wer etwas so Wertvolles besitzt, kann schnell mit dem Tod dafür bezahlen. Wenn jemand diesen Kristall zurückhaben will, wird er danach suchen."',
      en: '"A man who owns something that valuable can pay for it with his life. If somebody wants that crystal back, they will come looking for it."'
    },
    {
      who: 'jergo',
      de: '„Ich bin kein magisch gelehrter Mann. Aber ich habe das eine oder andere Mal gehört, dass man mit Kristallen und Edelsteinen zaubern kann, selbst ohne eigene Kräfte. Man muss nur wissen, wie es geht."',
      en: '"I am no man of magical learning. But I have heard, once or twice, that you can work magic with crystals and gemstones without any power of your own. You only have to know how it is done."'
    },
    {
      who: 'brutos',
      de: '„Woher will ein dummer, kleiner Bandit denn so etwas wissen? Oder bist du jetzt ein Gelehrter der Magie? Das wäre mir neu."',
      en: '"And how would a stupid little bandit come to know that? Or are you a scholar of magic now? That would be news to me."'
    },
    {
      who: 'jergo',
      de: '„Ich bin in der Burgstadt Largon aufgewachsen, an der Grenze zu Solania. Sie ist bekannt für ihre Magiergilde. Ich habe nicht selten mit einem der Magier dort geredet."',
      en: '"I grew up in the fortress town of Largon, on the border with Solania. It is known for its mages\' guild. I talked with one of the magicians there more than once."'
    },
    {
      who: 'jergo',
      de: '„Ein Edelstein speichert magische Energie. Er entsteht durch Druck tief unter der Erdoberfläche, und man findet ihn nur selten. Wer sich auskennt, kann damit Magie wirken, ohne selbst begabt zu sein."',
      en: '"A gemstone stores magical energy. It is made by pressure deep beneath the surface, and it is rarely found. A man who knows the trick can work magic with one without any gift of his own."'
    },
    {
      who: 'jergo',
      de: '„Kristalle funktionieren völlig anders. Sie wachsen — manchmal in unterirdischen Höhlen, die meisten aber hoch in den Lüften der Berge — und ziehen ihre Energie aus Mineralien. Sie sind eine Quelle, keine Truhe."',
      en: '"Crystals work in an entirely different way. They grow — sometimes in caves underground, but most of them high in the air of the mountains — and draw their energy out of minerals. They are a source, not a chest."'
    },
    {
      who: 'jergo',
      de: '„Deshalb kann man einen Kristall nicht aufladen wie einen Edelstein. Der Magier sagte, ihre Struktur sei eine andere. Warum das so ist, habe ich nie verstanden. Viel mehr weiß ich auch nicht."',
      en: '"That is why a crystal cannot be charged the way a gemstone can. The magician said their structure is different. Why that should be so, I never understood. I do not know much more than that."'
    },
    {
      who: 'brutos',
      de: '„… Du hast noch nie so viel am Stück geredet, Jergo."',
      en: '"…You have never said that much at once, Jergo."'
    }
  ],

  banditsPlan: [
    {
      who: 'dorgo',
      de: '„Er hat nicht Unrecht. Aber wenn wir uns die Kinder mit ihren Waffen schnappen, holen wir vielleicht drei bis vier Goldmünzen heraus. Die Bögen sind wertvoll."',
      en: '"He is not wrong. But if we snatch the children with their weapons we might get three or four gold pieces out of it. Those bows are worth something."'
    },
    {
      who: 'dorgo',
      de: '„Und dem kleinen Bastard, der mir mein Bein genommen hat, reiße ich eigenhändig den Kopf ab."',
      en: '"And the little bastard who took my leg — I will pull his head off with my own hands."'
    },
    {
      who: 'brutos',
      de: '„Gut. Ich weiß jetzt, was wir tun, Männer."',
      en: '"Good. Now I know what we do, men."'
    }
  ],

  banditsOrders: [
    {
      who: 'brutos',
      de: '„Wir warten auf beiden Seiten des Dorfes, bis die Kinder wieder jagen gehen oder was auch immer sie tun. Wenn ihr sie seht, gebt ihr ein Zeichen."',
      en: '"We wait on both sides of the village until the children go hunting again, or whatever it is they do. When you see them, you give a signal."'
    },
    {
      who: 'brutos',
      de: '„Dorgo. Du nimmst eines der Pferde und reitest zum Fort der Drachenschinder. Dort heuerst du sieben Männer für eine Woche an. Mit mir und meinen vier reicht das für vier kleine Wichte."',
      en: '"Dorgo. You take one of the horses and ride to the Dragonflayers\' fort. There you hire seven men for a week. With me and my four that is enough for four little wretches."'
    },
    {
      who: 'brutos',
      de: '„Sprich mit ihrem Anführer Klopper. Sag ihm, dass ich dich schicke, und richte ihm aus: ‚Brutos stützt deinen Arm.\' Er schuldet mir noch einen Gefallen."',
      en: '"Speak to their leader, Klopper. Tell him I sent you, and give him these words: \'Brutos holds up your arm.\' He still owes me a favour."'
    },
    {
      who: 'dorgo',
      de: '„Wird gemacht, Brutos. Ich reite sofort los, dann komme ich noch vor Mitternacht dort an."',
      en: '"It will be done, Brutos. I ride at once — I will be there before midnight."'
    }
  ],

  banditsPositions: [
    {
      who: 'brutos',
      de: '„Und wir gehen auf unsere Positionen. Teilt das Essen auf und dann lauft auf die andere Seite des Waldes, um das andere Tor im Auge zu behalten!"',
      en: '"And the rest of us go to our posts. Split the food between you, then get across to the far side of the wood and keep an eye on the other gate!"'
    },
    {
      who: 'narrator',
      de: 'So warteten sie. Und in Nimmerschein wusste an diesem Abend niemand, dass der Wald zwei Augenpaare mehr hatte als am Morgen.',
      en: 'So they waited. And that evening in Nimmerschein nobody knew that the wood held two more pairs of eyes than it had that morning.'
    }
  ],
} as const satisfies Record<string, readonly Line[]>

/**
 * Picks the language for one line.
 *
 * German for a German locale, English for everything else — see the header on
 * why there is no third case. `de-AT` and `de-CH` both start with `de`, so the
 * prefix test rather than an equality one.
 */
export const storyLine = (line: Line, locale: string): string =>
  locale.toLowerCase().startsWith('de') ? line.de : line.en

/**
 * Display names for the four voices that are not in the cast.
 *
 * The cast's own names are proper nouns and identical in both languages, so they
 * live in `cast.ts` as ids and are capitalised for display. These four are
 * *roles* — "the storyteller", "his father the smith" — and a role is a word.
 */
export const SPEAKER_NAMES: Record<Speaker, { de: string; en: string }> = {
  narrator: { de: 'Der Geschichtenerzähler', en: 'The Storyteller' },
  // The frame's figures. `storyteller` and `narrator` are the same man and share
  // a name on purpose — the player should not be told that the voice over
  // Arlaan and the man in the chair are two different people, because they are
  // not, and the reveal that he is Gearn is a later book's.
  storyteller: { de: 'Großvater', en: 'Grandfather' },
  arthusBoy: { de: 'Arthus', en: 'Arthus' },
  lenaGirl: { de: 'Lena', en: 'Lena' },
  smithFather: { de: 'Vater', en: 'Father' },
  motherMara: { de: 'Mutter', en: 'Mother' },
  arthus: { de: 'Arthus', en: 'Arthus' },
  lena: { de: 'Lena', en: 'Lena' },
  smith: { de: 'Der Schmied', en: 'The Smith' },
  nidaneVoice: { de: 'Nidane', en: 'Nidane' },
  athalus: { de: 'Athalus', en: 'Athalus' },
  jester: { de: 'Jester', en: 'Jester' },
  gearn: { de: 'Gearn', en: 'Gearn' },
  kareen: { de: 'Kareen', en: 'Kareen' },
  theodor: { de: 'Theodor', en: 'Theodor' },
  nidane: { de: 'Nidane', en: 'Nidane' },
  roland: { de: 'Roland', en: 'Roland' },
  lothar: { de: 'Lothar', en: 'Lothar' },
  gart: { de: 'Gart', en: 'Gart' },
  lara: { de: 'Lara', en: 'Lara' },
  galiana: { de: 'Galiana', en: 'Galiana' },
  jonas: { de: 'Jonas', en: 'Jonas' },
  banditLeader: { de: 'Der Anführer', en: 'The Leader' },
  // The same man, once the player has heard his men use it. See `SPEAKER_BODY`.
  brutos: { de: 'Brutos', en: 'Brutos' },
  dorgo: { de: 'Dorgo', en: 'Dorgo' },
  jergo: { de: 'Jergo', en: 'Jergo' },
  bandit: { de: 'Ein Räuber', en: 'A Bandit' }
}

export const speakerName = (who: Speaker, locale: string): string => {
  const entry = SPEAKER_NAMES[who]
  return locale.toLowerCase().startsWith('de') ? entry.de : entry.en
}

/**
 * ─── What people say when you walk up and talk to them ──────────────────────
 *
 * The chapter is a beat list, and a beat list has no room in it for a player who
 * wants to stand still and ask Kareen how she is. This is that room: two lines
 * each for everyone the interact prompt can reach, played through the same
 * bubble, the same dialogue camera and the same lip sync as a scripted scene.
 *
 * ── Why two lines and not one, and why they are ordered ─────────────────────
 *
 * One line makes a character a vending machine — the second press proves there
 * is nothing behind them. Two, delivered in order and then held on the last,
 * reads as someone who said the thing on their mind and then had nothing to add,
 * which is what people are actually like. Held rather than cycled: a character
 * who loops back to their first line on the third press is a machine again, and
 * more obviously so.
 *
 * They are written to be true at **any** point in the chapter, because the
 * player can talk to anybody at any time and there is no state here to check
 * against. So nothing refers to the boar being dead or alive, or the ambush
 * having happened. That is a real limit and it is the price of the feature
 * existing at all.
 */
export const BANTER: Partial<Record<CastId, readonly Line[]>> = {
  jester: [
    { who: 'jester', de: 'Halt dich hinter mir, wenn es losgeht. Die Kette braucht Platz, und du stehst gern im Weg.', en: 'Stay behind me when it starts. The chain needs room, and you have a gift for standing in it.' },
    { who: 'jester', de: 'Vater sagt, Schleifen sei keine Arbeit für einen Mann. Vater hat auch noch nie eine Klinge von mir stumpf gesehen.', en: "Father says grinding is not a man's work. Father has also never seen a blade of mine go blunt." }
  ],
  gearn: [
    { who: 'gearn', de: 'Ich bin schneller als ihr alle. Das ist kein Prahlen, das ist der Grund, warum ich vorne laufe.', en: 'I am faster than any of you. That is not a boast, it is why I go in front.' },
    { who: 'gearn', de: 'Eines Tages erzähle ich das hier jemandem. Und keiner wird mir glauben.', en: 'One day I will tell somebody about all this. And nobody will believe a word of it.' }
  ],
  kareen: [
    { who: 'kareen', de: 'Zwei Stunden am Tag, seit ich elf bin. Deshalb treffe ich, und deshalb kann ich keinen Sack Korn heben.', en: 'Two hours a day since I was eleven. That is why I hit, and why I cannot lift a sack of grain.' },
    { who: 'kareen', de: 'Geh mir nicht in die Schusslinie. Ich ziehe nicht ab, wenn du davor stehst — aber ich bin dann auch keine Hilfe.', en: 'Keep out of my line. I will not loose with you in front of it — but then I am no help to you either.' }
  ],
  theodor: [
    { who: 'theodor', de: 'Die Miliz hat mir beigebracht, den Schild zu halten. Nicht, wie lange.', en: 'The militia taught me to hold the shield. Not for how long.' },
    { who: 'theodor', de: 'Ich habe den einzigen runden Schild im Dorf. Manchmal denke ich, deshalb nehmen sie mich mit.', en: 'I have the only round board in the village. Some days I think that is the whole reason they bring me.' }
  ],
  nidane: [
    { who: 'nidane', de: 'Vier Jungen und ein Eber. Ich weiß schon, wer heute Abend genäht werden muss.', en: 'Four boys and a boar. I already know who is getting stitched up tonight.' },
    { who: 'nidane', de: 'Geh. Ich stehe hier, wenn ihr zurückkommt. Ihr kommt zurück.', en: 'Go. I will be standing here when you come back. You will come back.' }
  ],
  athalus: [
    { who: 'athalus', de: 'Meine Hände sind zu grob für feine Arbeit. Für alles andere reichen sie.', en: 'My hands are too rough for fine work. For everything else they do.' },
    { who: 'athalus', de: 'Bei Athos. Reden wir, oder jagen wir?', en: 'By Athos. Are we talking, or are we hunting?' }
  ],
  storyteller: [
    { who: 'storyteller', de: 'Setz dich, Junge. Im Stehen hört sich keine Geschichte richtig an.', en: 'Sit down, boy. No story sounds right standing up.' },
    { who: 'storyteller', de: 'Sechzig Jahre. Und ich sehe den Wald noch, als wäre ich gestern hindurchgelaufen.', en: 'Sixty years. And I still see that forest as if I walked through it yesterday.' }
  ],
  arthusBoy: [
    { who: 'arthusBoy', de: 'Großvater sagt, er war der Schnellste. Lena sagt, er war der Kleinste.', en: 'Grandfather says he was the fastest. Lena says he was the smallest.' },
    { who: 'arthusBoy', de: 'Ich will die Stelle mit dem Eber. Die anderen darfst du überspringen.', en: 'I want the part with the boar. You can skip the rest.' }
  ],
  lenaGirl: [
    { who: 'lenaGirl', de: 'Er erzählt sie jedes Mal ein bisschen anders. Ich zähle mit.', en: 'He tells it a little differently every time. I keep count.' },
    { who: 'lenaGirl', de: 'Wenn Großvater beim Netz die Stimme senkt, kommt gleich der Teil, bei dem Arthus die Augen zumacht.', en: 'When Grandfather drops his voice at the net, the next part is the one Arthus closes his eyes for.' }
  ],
  smithFather: [
    { who: 'smithFather', de: 'Er erzählt es den Kindern lieber, als dass er es mir erzählt hätte. So sind Väter, und so sind Söhne.', en: 'He would rather tell it to the children than he ever told it to me. That is fathers, and that is sons.' },
    { who: 'smithFather', de: 'Das Feuer ist heruntergebrannt. Hol Holz, dann hört er nicht auf.', en: 'The fire is down. Fetch wood and he will not stop.' }
  ],
  motherMara: [
    { who: 'motherMara', de: 'Erst essen, dann Geschichten. In dieser Reihenfolge, jeden Abend.', en: 'Food first, stories after. In that order, every evening.' },
    { who: 'motherMara', de: 'Halt ihn nicht zu lange wach. Er ist nicht mehr der Junge aus seiner eigenen Geschichte.', en: 'Do not keep him up too long. He is not the boy in his own story any more.' }
  ]
}

/**
 * The `turn`-th thing this character has to say, holding on the last.
 *
 * Clamped rather than wrapped — see the note above on why a character who loops
 * is worse than one who runs out.
 */
export const banterFor = (who: CastId, turn: number): Line | null => {
  const lines = BANTER[who]
  if (!lines || lines.length === 0) {
    return null
  }
  return lines[Math.min(turn, lines.length - 1)] ?? null
}

/**
 * Voices that speak through somebody else's body.
 *
 * ── Why `brutos` is not a cast member ───────────────────────────────────────
 *
 * He is the same man as `banditLeader`, and the difference between the two ids
 * is what the *player* knows. In Chapter 1 he is one of five dark shapes with a
 * dagger and he gets a single line — "Wir haben euch unterschätzt" — over which
 * the bubble says **Der Anführer**, because four teenagers being robbed on a
 * forest road do not learn anybody's name. In Chapter 2 the same body sits by a
 * fire and is called Brutos by the men around him.
 *
 * Building him twice would give the chapter two figures where the story has one,
 * and would make the reveal a continuity error rather than a reveal. So the id
 * stays one body and gains a second name, which is exactly what the four frame
 * voices above already do — the only new thing here is that this one *has* a
 * body, so the mapping has to be written down for `StoryDirector.bodyOf`.
 */
export const SPEAKER_BODY: Partial<Record<Speaker, CastId>> = {
  brutos: 'banditLeader'
}

/**
 * The cast member a voice belongs to, or null for a voice with no body.
 *
 * `narrator` and the three frame aliases stay bodiless on purpose: they are
 * voice-over across a cut, drawn as a fireside card, and they must not move a
 * camera or a jaw.
 */
export const speakerBody = (who: Speaker, exists: (id: string) => boolean): CastId | null => {
  const aliased = SPEAKER_BODY[who]
  if (aliased) {
    return exists(aliased) ? aliased : null
  }
  return exists(who) ? (who as CastId) : null
}
