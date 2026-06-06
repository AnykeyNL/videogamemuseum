/*
 * The 5 build questions. Each option merges `set` into the build config and
 * carries a fake BASIC snippet plus an estimate of how many hours it would have
 * taken to type by hand in the 1980s.
 *
 * Translatable text uses { nl, en, de, fr } maps. The BASIC code stays language
 * neutral (it is "code", after all).
 */
(function () {
  "use strict";

  const QUESTIONS = [
    /* -------- Q1: players / enemies -------- */
    {
      id: "mode",
      title: {
        nl: "HOEVEEL SPELERS?",
        en: "HOW MANY PLAYERS?",
        de: "WIE VIELE SPIELER?",
        fr: "COMBIEN DE JOUEURS?",
      },
      options: [
        {
          set: { players: 1, enemies: false },
          label: { nl: "1 SPELER", en: "1 PLAYER", de: "1 SPIELER", fr: "1 JOUEUR" },
          desc: {
            nl: "GEEN VIJANDEN - RUSTIG OEFENEN",
            en: "NO ENEMIES - RELAXED PRACTICE",
            de: "KEINE GEGNER - ENTSPANNT UEBEN",
            fr: "PAS D'ENNEMIS - ENTRAINEMENT CALME",
          },
          hours: 2.5,
          code: [
            "10 REM ** ONE PLAYER **",
            "20 PX=160 : PY=180 : SC=0",
            "30 GET J$ : REM READ JOYSTICK",
            "40 IF J$=\"L\" THEN PX=PX-2",
            "50 IF J$=\"R\" THEN PX=PX+2",
            "60 GOTO 30",
          ],
        },
        {
          set: { players: 1, enemies: true },
          label: { nl: "1 SPELER + VIJANDEN", en: "1 PLAYER + ENEMIES", de: "1 SPIELER + GEGNER", fr: "1 JOUEUR + ENNEMIS" },
          desc: {
            nl: "JIJ TEGEN DE COMPUTER",
            en: "YOU AGAINST THE COMPUTER",
            de: "DU GEGEN DEN COMPUTER",
            fr: "TOI CONTRE L'ORDINATEUR",
          },
          hours: 4.0,
          code: [
            "10 REM ** ONE PLAYER + ENEMIES **",
            "20 DIM EX(8),EY(8)",
            "30 FOR I=1 TO 8 : EX(I)=RND(1)*320 : NEXT",
            "40 GOSUB 900 : REM MOVE ENEMIES",
            "50 IF HIT THEN LV=LV-1",
            "60 IF LV=0 THEN PRINT \"GAME OVER\"",
            "70 GOTO 40",
          ],
        },
        {
          set: { players: 2, enemies: false },
          label: { nl: "2 SPELERS", en: "2 PLAYERS", de: "2 SPIELER", fr: "2 JOUEURS" },
          desc: {
            nl: "GEEN VIJANDEN - SPEEL SAMEN",
            en: "NO ENEMIES - PLAY TOGETHER",
            de: "KEINE GEGNER - SPIELT ZUSAMMEN",
            fr: "PAS D'ENNEMIS - JOUEZ ENSEMBLE",
          },
          hours: 3.5,
          code: [
            "10 REM ** TWO PLAYERS **",
            "20 P1X=80 : P2X=240",
            "30 GET A$ : REM PLAYER 1 KEYS",
            "40 GET B$ : REM PLAYER 2 KEYS",
            "50 GOSUB 500 : REM DRAW BOTH",
            "60 GOTO 30",
          ],
        },
        {
          set: { players: 2, enemies: true },
          label: { nl: "2 SPELERS + VIJANDEN", en: "2 PLAYERS + ENEMIES", de: "2 SPIELER + GEGNER", fr: "2 JOUEURS + ENNEMIS" },
          desc: {
            nl: "SAMEN TEGEN DE COMPUTER",
            en: "TEAM UP AGAINST THE COMPUTER",
            de: "GEMEINSAM GEGEN DEN COMPUTER",
            fr: "EN EQUIPE CONTRE L'ORDINATEUR",
          },
          hours: 5.0,
          code: [
            "10 REM ** TWO PLAYERS + ENEMIES **",
            "20 P1=3 : P2=3 : REM LIVES",
            "30 DIM EX(12),EY(12)",
            "40 GOSUB 700 : REM SPAWN WAVE",
            "50 GOSUB 800 : REM CHECK CRASHES",
            "60 IF P1+P2=0 THEN END",
            "70 GOTO 40",
          ],
        },
      ],
    },

    /* -------- Q2: genre / engine -------- */
    {
      id: "genre",
      title: {
        nl: "WAT VOOR SPEL?",
        en: "WHAT KIND OF GAME?",
        de: "WELCHE ART VON SPIEL?",
        fr: "QUEL TYPE DE JEU?",
      },
      options: [
        {
          set: { genre: "shooter" },
          label: { nl: "SHOOTER", en: "SHOOTER", de: "SHOOTER", fr: "SHOOT'EM UP" },
          desc: {
            nl: "SCHIET ALLES UIT DE LUCHT",
            en: "BLAST EVERYTHING IN THE SKY",
            de: "SCHIESS ALLES VOM HIMMEL",
            fr: "DEGOMME TOUT DANS LE CIEL",
          },
          hours: 6.0,
          code: [
            "100 REM ** SHOOTER ENGINE **",
            "110 IF FIRE THEN BY=BY-6",
            "120 IF BY<0 THEN BY=PY : FIRE=0",
            "130 IF ABS(BX-EX)<8 THEN SC=SC+10",
            "140 SYS 49152 : REM SPRITE SOUND",
            "150 RETURN",
          ],
        },
        {
          set: { genre: "maze" },
          label: { nl: "DOOLHOF", en: "MAZE", de: "LABYRINTH", fr: "LABYRINTHE" },
          desc: {
            nl: "VERZAMEL ALLE EDELSTENEN",
            en: "COLLECT ALL THE GEMS",
            de: "SAMMLE ALLE EDELSTEINE",
            fr: "RAMASSE TOUS LES JOYAUX",
          },
          hours: 5.5,
          code: [
            "200 REM ** MAZE ENGINE **",
            "210 IF MAP(PX,PY)=2 THEN SC=SC+5",
            "220 IF MAP(PX+DX,PY+DY)<>1 THEN PX=PX+DX",
            "230 IF GEMS=0 THEN GOTO 999",
            "240 GOSUB 800 : REM MOVE CHASERS",
            "250 RETURN",
          ],
        },
        {
          set: { genre: "dodge" },
          label: { nl: "ONTWIJKEN", en: "DODGE", de: "AUSWEICHEN", fr: "ESQUIVE" },
          desc: {
            nl: "ONTWIJK ALLE OBSTAKELS",
            en: "AVOID EVERY OBSTACLE",
            de: "WEICHE ALLEN HINDERNISSEN AUS",
            fr: "EVITE TOUS LES OBSTACLES",
          },
          hours: 4.5,
          code: [
            "300 REM ** DODGE ENGINE **",
            "310 FOR I=1 TO N : OY(I)=OY(I)+SP : NEXT",
            "320 IF OY(I)>200 THEN OY(I)=0 : OX(I)=RND(1)*320",
            "330 IF HIT(PX,PY) THEN LV=LV-1",
            "340 SC=SC+1 : REM SURVIVED A FRAME",
            "350 RETURN",
          ],
        },
        {
          set: { genre: "paddle" },
          label: { nl: "PEDDEL", en: "PADDLE", de: "PADDLE", fr: "RAQUETTE" },
          desc: {
            nl: "PONG & BREAKOUT KLASSIEKER",
            en: "PONG & BREAKOUT CLASSIC",
            de: "PONG & BREAKOUT KLASSIKER",
            fr: "CLASSIQUE PONG & CASSE-BRIQUES",
          },
          hours: 3.0,
          code: [
            "400 REM ** PADDLE ENGINE **",
            "410 BX=BX+VX : BY=BY+VY",
            "420 IF BY<0 OR BY>200 THEN VY=-VY",
            "430 IF BX<PADX AND ABS(BY-PADY)<20 THEN VX=-VX",
            "440 IF BX>320 THEN SC=SC+1 : GOSUB 600",
            "450 RETURN",
          ],
        },
      ],
    },

    /* -------- Q3: theme -------- */
    {
      id: "theme",
      title: {
        nl: "KIES EEN WERELD",
        en: "PICK A WORLD",
        de: "WAEHLE EINE WELT",
        fr: "CHOISIS UN MONDE",
      },
      options: [
        {
          set: { theme: "space" },
          label: { nl: "RUIMTE", en: "SPACE", de: "WELTRAUM", fr: "ESPACE" },
          desc: { nl: "STERREN & RAKETTEN", en: "STARS & ROCKETS", de: "STERNE & RAKETEN", fr: "ETOILES & FUSEES" },
          hours: 1.5,
          code: [
            "500 REM ** THEME: SPACE **",
            "510 BORDER 0 : BACK 0",
            "520 FOR S=1 TO 40 : PLOT RND(1)*320,RND(1)*200 : NEXT",
            "530 RETURN",
          ],
        },
        {
          set: { theme: "jungle" },
          label: { nl: "JUNGLE", en: "JUNGLE", de: "DSCHUNGEL", fr: "JUNGLE" },
          desc: { nl: "BLADEREN & DIEREN", en: "LEAVES & CRITTERS", de: "BLAETTER & TIERE", fr: "FEUILLES & BESTIOLES" },
          hours: 2.0,
          code: [
            "500 REM ** THEME: JUNGLE **",
            "510 BORDER 5 : BACK 5",
            "520 FOR T=1 TO 6 : GOSUB 950 : NEXT : REM DRAW TREES",
            "530 RETURN",
          ],
        },
        {
          set: { theme: "castle" },
          label: { nl: "KASTEEL", en: "CASTLE", de: "BURG", fr: "CHATEAU" },
          desc: { nl: "RIDDERS & STENEN", en: "KNIGHTS & STONE", de: "RITTER & STEIN", fr: "CHEVALIERS & PIERRE" },
          hours: 2.0,
          code: [
            "500 REM ** THEME: CASTLE **",
            "510 BORDER 9 : BACK 11",
            "520 FOR B=1 TO 10 : POKE 1024+B,160 : NEXT : REM BRICKS",
            "530 RETURN",
          ],
        },
        {
          set: { theme: "neon" },
          label: { nl: "NEON STAD", en: "NEON CITY", de: "NEON-STADT", fr: "VILLE NEON" },
          desc: { nl: "GLOEIENDE STRATEN", en: "GLOWING STREETS", de: "LEUCHTENDE STRASSEN", fr: "RUES LUMINEUSES" },
          hours: 2.5,
          code: [
            "500 REM ** THEME: NEON CITY **",
            "510 BORDER 6 : BACK 0",
            "520 FOR C=1 TO 12 : DRAW 'TOWER',RND(1)*320 : NEXT",
            "530 RETURN",
          ],
        },
      ],
    },

    /* -------- Q4: speed -------- */
    {
      id: "speed",
      title: {
        nl: "HOE SNEL?",
        en: "HOW FAST?",
        de: "WIE SCHNELL?",
        fr: "QUELLE VITESSE?",
      },
      options: [
        {
          set: { speed: "chill", speedFactor: 0.7 },
          label: { nl: "RUSTIG", en: "CHILL", de: "GEMUETLICH", fr: "TRANQUILLE" },
          desc: { nl: "LEKKER LANGZAAM", en: "NICE AND SLOW", de: "SCHOEN LANGSAM", fr: "BIEN LENT" },
          hours: 1.0,
          code: ["600 REM ** SPEED: CHILL **", "610 DL=30 : REM DELAY LOOP", "620 FOR W=1 TO DL : NEXT W", "630 RETURN"],
        },
        {
          set: { speed: "normal", speedFactor: 1.0 },
          label: { nl: "NORMAAL", en: "NORMAL", de: "NORMAL", fr: "NORMAL" },
          desc: { nl: "PRIMA TEMPO", en: "JUST RIGHT", de: "GENAU RICHTIG", fr: "PARFAIT" },
          hours: 1.0,
          code: ["600 REM ** SPEED: NORMAL **", "610 DL=15", "620 FOR W=1 TO DL : NEXT W", "630 RETURN"],
        },
        {
          set: { speed: "fast", speedFactor: 1.4 },
          label: { nl: "SNEL", en: "FAST", de: "SCHNELL", fr: "RAPIDE" },
          desc: { nl: "BLIJF ALERT", en: "STAY SHARP", de: "BLEIB WACH", fr: "RESTE VIF" },
          hours: 1.5,
          code: ["600 REM ** SPEED: FAST **", "610 DL=6", "620 FOR W=1 TO DL : NEXT W", "630 RETURN"],
        },
        {
          set: { speed: "turbo", speedFactor: 1.9 },
          label: { nl: "TURBO", en: "TURBO", de: "TURBO", fr: "TURBO" },
          desc: { nl: "ALLEEN VOOR HELDEN", en: "HEROES ONLY", de: "NUR FUER HELDEN", fr: "POUR LES HEROS" },
          hours: 2.0,
          code: ["600 REM ** SPEED: TURBO **", "610 DL=1 : POKE 53280,2", "620 REM NO MERCY", "630 RETURN"],
        },
      ],
    },

    /* -------- Q5: palette -------- */
    {
      id: "palette",
      title: {
        nl: "KIES JE SCHERMKLEUREN",
        en: "PICK YOUR SCREEN COLOURS",
        de: "WAEHLE DEINE BILDSCHIRMFARBEN",
        fr: "CHOISIS LES COULEURS DE L'ECRAN",
      },
      options: [
        {
          set: { palette: "blue" },
          label: { nl: "C64 BLAUW", en: "C64 BLUE", de: "C64 BLAU", fr: "BLEU C64" },
          desc: { nl: "DE ECHTE KLASSIEKER", en: "THE TRUE CLASSIC", de: "DER ECHTE KLASSIKER", fr: "LE VRAI CLASSIQUE" },
          hours: 0.5,
          code: ["700 REM ** PALETTE: C64 BLUE **", "710 POKE 53280,6 : POKE 53281,6", "720 RETURN"],
        },
        {
          set: { palette: "green" },
          label: { nl: "GROEN FOSFOR", en: "GREEN PHOSPHOR", de: "GRUENER PHOSPHOR", fr: "PHOSPHORE VERT" },
          desc: { nl: "OUDE MONITOR-LOOK", en: "OLD MONITOR LOOK", de: "ALTER MONITOR-LOOK", fr: "STYLE VIEIL ECRAN" },
          hours: 0.5,
          code: ["700 REM ** PALETTE: GREEN **", "710 POKE 53280,0 : POKE 53281,0", "720 COL=5 : RETURN"],
        },
        {
          set: { palette: "amber" },
          label: { nl: "AMBER", en: "AMBER", de: "BERNSTEIN", fr: "AMBRE" },
          desc: { nl: "WARME GLOED", en: "WARM GLOW", de: "WARMES LEUCHTEN", fr: "LUEUR CHAUDE" },
          hours: 0.5,
          code: ["700 REM ** PALETTE: AMBER **", "710 POKE 53280,0 : POKE 53281,0", "720 COL=8 : RETURN"],
        },
        {
          set: { palette: "mono" },
          label: { nl: "HOOG CONTRAST", en: "HI-CONTRAST", de: "HOHER KONTRAST", fr: "CONTRASTE ELEVE" },
          desc: { nl: "WIT OP ZWART", en: "WHITE ON BLACK", de: "WEISS AUF SCHWARZ", fr: "BLANC SUR NOIR" },
          hours: 0.5,
          code: ["700 REM ** PALETTE: HI-CONTRAST **", "710 POKE 53280,0 : POKE 53281,0", "720 COL=1 : RETURN"],
        },
      ],
    },
  ];

  /* Example game names (C64 style) shown on the naming screen, per genre. */
  const SAMPLE_NAMES = {
    shooter: ["MEGA BLASTER", "STAR RAIDER 64", "COSMIC FURY", "LASER STORM"],
    maze: ["GEM HUNTER", "MAZE MANIA", "DUNGEON DASH", "CRYPT CRAWLER"],
    dodge: ["TURBO DODGER", "HIGHWAY HERO", "PIXEL PANIC", "RUSH HOUR 64"],
    paddle: ["SUPER BOUNCE", "BRICK SMASH", "PADDLE WARS", "RALLY 64"],
    _default: ["GAME 64", "PIXEL QUEST", "ARCADE MANIA", "RETRO SMASH"],
  };

  window.QUESTIONS = QUESTIONS;
  window.SAMPLE_NAMES = SAMPLE_NAMES;
})();
