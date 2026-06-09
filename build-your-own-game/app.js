/*
 * Flow / state machine for the C64 "Build Your Own Game" kiosk.
 * boot -> language -> 5 build steps (with fake typing) -> compile -> game -> results -> reset.
 */
(function () {
  "use strict";

  const I18N = window.I18N;
  const LANG_ORDER = window.LANG_ORDER;
  const FLAGS = window.FLAGS;
  const QUESTIONS = window.QUESTIONS;
  const fmt = window.fmtStr;

  const $ = (id) => document.getElementById(id);

  const screens = {
    boot: $("screen-boot"),
    language: $("screen-language"),
    step: $("screen-step"),
    name: $("screen-name"),
    compile: $("screen-compile"),
    title: $("screen-title"),
    game: $("screen-game"),
    results: $("screen-results"),
  };

  const crtScreen = document.querySelector(".crt-screen");
  const bootText = $("boot-text");
  const bootCursor = $("boot-cursor");
  const langGrid = $("lang-grid");
  const stepCounter = $("step-counter");
  const stepHours = $("step-hours");
  const stepQuestion = $("step-question");
  const stepTitle = $("step-title");
  const stepOptions = $("step-options");
  const stepTyping = $("step-typing");
  const typingTitle = $("typing-title");
  const typingScroll = $("typing-scroll");
  const typingCode = $("typing-code");
  const typingCursor = $("typing-cursor");
  const typingHours = $("typing-hours");
  const btnNext = $("btn-next");
  const nameTitleEl = $("name-title");
  const nameInput = $("name-input");
  const nameExamplesLabel = $("name-examples-label");
  const nameExamples = $("name-examples");
  const nameHint = $("name-hint");
  const btnSave = $("btn-save");
  const compileTitle = $("compile-title");
  const compileLog = $("compile-log");
  const compileTotal = $("compile-total");
  const btnRun = $("btn-run");
  const resultsTitle = $("results-title");
  const resultsBody = $("results-body");
  const resultsCountdown = $("results-countdown");
  const qrCanvas = $("qr-canvas");
  const qrLabel = $("qr-label");
  const titleName = $("title-name");
  const titleSub = $("title-sub");
  const titlePlay = $("title-play");
  const touchControls = $("touch-controls");
  const touchButtons = touchControls ? Array.from(touchControls.querySelectorAll(".touch-btn")) : [];
  const IS_TOUCH =
    (typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches) ||
    "ontouchstart" in window ||
    (navigator.maxTouchPoints || 0) > 0;

  const SHARE_BASE_URL = "https://museum.makerdad.nl/";
  const GENRES = ["shooter", "maze", "dodge", "paddle"];
  const THEMES = ["space", "jungle", "castle", "neon"];
  const SPEEDS = ["chill", "normal", "fast", "turbo"];
  const PALETTES = ["blue", "green", "amber", "mono"];
  // High-contrast two-tone colours per palette so the QR stays scannable but on-theme.
  const QR_COLORS = {
    blue: { light: "#cfd0ff", dark: "#101034" },
    green: { light: "#bdffc8", dark: "#04160b" },
    amber: { light: "#ffe1a6", dark: "#241300" },
    mono: { light: "#f0f0ff", dark: "#050510" },
  };

  const IDLE_MS = 90000;

  let state = "boot";
  let lang = "en";
  let L = I18N.en;
  let stepIndex = 0;
  let totalHours = 0;
  let config = { players: 1, enemies: false, genre: "paddle", theme: "space", speed: "normal", speedFactor: 1, palette: "blue", gameName: "" };

  let flowToken = 0; // bumped on every reset to cancel async typing
  let skipFlag = false;
  let typingDone = false;
  let selectedOption = 0;
  let selectedLang = 0;
  const OPTION_COLS = 2;
  let resultTimer = null;
  let lastActivity = Date.now();
  let isDeepLink = false; // launched via a direct QR/share link (skip the build flow + QR results)

  Games.init({
    canvas: $("game-canvas"),
    stage: document.querySelector(".game-stage"),
    statusLeft: $("status-left"),
    statusMid: $("status-mid"),
    statusRight: $("status-right"),
    gameMsg: $("game-msg"),
    gameHint: $("game-hint"),
  });

  /* ---------- screen switching ---------- */
  function showScreen(name) {
    state = name;
    Object.keys(screens).forEach((k) => {
      const on = k === name;
      screens[k].classList.toggle("active", on);
      screens[k].setAttribute("aria-hidden", on ? "false" : "true");
    });
    if (name === "game") setTimeout(() => Games.fit(), 0);
    if (touchControls) {
      const showCtl = IS_TOUCH && name === "game";
      if (showCtl) applyTouchScheme();
      touchControls.classList.toggle("active", showCtl);
      touchControls.setAttribute("aria-hidden", showCtl ? "false" : "true");
      if (!showCtl) releaseTouchKeys();
    }
  }

  /* ---------- on-screen touch controls (mobile) ---------- */
  // Only the buttons a given game actually uses are shown. Codes match the
  // single-player keyboard scheme each engine reads.
  function touchSchemeFor(c) {
    if (c.genre === "shooter") return { ArrowLeft: 1, ArrowRight: 1, Space: 1 };
    if (c.genre === "maze") return { ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1 };
    if (c.genre === "dodge") return { ArrowLeft: 1, ArrowRight: 1 };
    // paddle: breakout moves left/right, pong / pong-vs-cpu move up/down
    const breakout = c.players === 1 && !c.enemies;
    return breakout ? { ArrowLeft: 1, ArrowRight: 1 } : { ArrowUp: 1, ArrowDown: 1 };
  }

  function applyTouchScheme() {
    const sc = touchSchemeFor(config);
    touchButtons.forEach((b) => {
      b.classList.toggle("hidden", !sc[b.getAttribute("data-code")]);
    });
  }

  function releaseTouchKeys() {
    touchButtons.forEach((b) => {
      Games.setKey(b.getAttribute("data-code"), false);
      b.classList.remove("pressed");
    });
  }

  function applyPalette(p) {
    crtScreen.setAttribute("data-palette", p || "blue");
  }

  /* ---------- keyboard typing sound ---------- */
  const KeyAudio = (function () {
    let ac = null;
    let last = 0;
    function ctxt() {
      if (!ac) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        try {
          ac = new AC();
        } catch (_) {
          return null;
        }
      }
      return ac;
    }
    return {
      resume() {
        const c = ctxt();
        if (c && c.state === "suspended") c.resume();
      },
      click() {
        const c = ctxt();
        if (!c) return;
        const now = performance.now();
        if (now - last < 42 + Math.random() * 45) return; // throttle to a human typing rate
        last = now;
        const t = c.currentTime;
        const o = c.createOscillator();
        const g = c.createGain();
        o.type = "square";
        o.frequency.setValueAtTime(1300 + Math.random() * 700, t);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.03, t + 0.002);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.028);
        o.connect(g);
        g.connect(c.destination);
        o.start(t);
        o.stop(t + 0.04);
      },
    };
  })();

  /* ---------- typing helpers ---------- */
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  async function typeInto(el, text, perChar, token) {
    el.textContent = "";
    skipFlag = false;
    const scroller = el === typingCode ? typingScroll : null;
    // type in small bursts so long, multi-page listings stay snappy
    const burst = 3;
    for (let i = 0; i < text.length; i += burst) {
      if (token !== flowToken) return false;
      if (skipFlag) {
        el.textContent = text;
        if (scroller) scroller.scrollTop = scroller.scrollHeight;
        return true;
      }
      el.textContent += text.slice(i, i + burst);
      if (scroller) {
        scroller.scrollTop = scroller.scrollHeight;
        KeyAudio.click();
      }
      await delay(perChar);
    }
    return token === flowToken;
  }

  /* ---------- fake code generator (long, multi-page listings) ---------- */
  function makeRng(seedStr) {
    let h = 1779033703 ^ seedStr.length;
    for (let i = 0; i < seedStr.length; i++) {
      h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return function () {
      h = Math.imul(h ^ (h >>> 16), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      h ^= h >>> 16;
      return (h >>> 0) / 4294967296;
    };
  }

  // Builds a believable, multi-page BASIC listing for an option so the visitor
  // sees just how much code had to be typed by hand.
  function expandCode(opt, idx) {
    const rng = makeRng(opt.label.en + "|" + idx);
    const byte = () => Math.floor(rng() * 256);
    const lines = opt.code.slice();
    let ln = 1000;
    const push = (s) => {
      lines.push(s);
      ln += 10;
    };
    const dataBlock = (title, count, perLine, base) => {
      lines.push("");
      lines.push(ln + " REM ===== " + title + " =====");
      ln += 10;
      lines.push(ln + " FOR I=0 TO " + (count * perLine - 1) + " : READ B : POKE " + base + "+I,B : NEXT");
      ln += 10;
      for (let r = 0; r < count; r++) {
        const vals = [];
        for (let c = 0; c < perLine; c++) vals.push(byte());
        push(ln + " DATA " + vals.join(","));
      }
    };
    const rem = (t) => {
      lines.push("");
      lines.push(ln + " REM ===== " + t + " =====");
      ln += 10;
    };

    const id = (QUESTIONS[idx] && QUESTIONS[idx].id) || "mode";

    if (id === "mode") {
      // step 1: full-length sprite/sound/level listing + main loop (unchanged)
      const spriteRows = Math.round(opt.hours * 1.5) + 2;
      const soundRows = Math.round(opt.hours * 0.75) + 1;
      const levelRows = Math.round(opt.hours * 1) + 2;
      dataBlock("SPRITE SHAPES", spriteRows, 8, 832);
      dataBlock("SOUND TABLE (SID)", soundRows, 7, 832);
      dataBlock("SCREEN / LEVEL MAP", levelRows, 10, 832);
      lines.push("");
      lines.push(ln + " REM ===== MAIN LOOP =====");
      ln += 10;
      const loopLines = [
        'GET K$ : IF K$="" THEN ' + (ln + 10),
        'IF K$="Z" THEN X=X-1',
        'IF K$="X" THEN X=X+1',
        "POKE 53248,X : POKE 53249,Y",
        "S=S+1 : IF S>255 THEN S=0",
        "POKE 1024+P,32 : P=X/8+Y/8*40 : POKE 1024+P,81",
        "IF C=1 THEN GOSUB 5000 : REM CHECK HIT",
        "IF SC>HI THEN HI=SC",
        'PRINT "{HOME}SCORE ";SC;"  HI ";HI',
      ];
      loopLines.forEach((s) => push(ln + " " + s));
      push(ln + " GOTO " + (ln - loopLines.length * 10));
    } else if (id === "genre") {
      // step 2: game-rules + enemy logic
      rem("GAME RULES");
      push(ln + " IF FIRE AND AMMO>0 THEN GOSUB 8000");
      push(ln + " IF COL=1 THEN LV=LV-1 : GOSUB 8200");
      push(ln + " IF SC>NEXTUP THEN XL=XL+1 : NEXTUP=NEXTUP+500");
      push(ln + ' IF LV<1 THEN PRINT "GAME OVER" : END');
      dataBlock("ENEMY WAVE TABLE", Math.round(opt.hours * 0.8) + 2, 8, 2048);
      rem("ENEMY MOVE PATTERN");
      push(ln + " FOR E=0 TO NE : EX(E)=EX(E)+MV(E) : NEXT");
      push(ln + " RETURN");
    } else if (id === "theme") {
      // step 3: custom characters / tiles + colours
      rem("CHARSET / TILES");
      push(ln + " POKE 53272,(PEEK(53272)AND240)OR12");
      dataBlock("TILE BITMAPS", Math.round(opt.hours * 1.5) + 2, 8, 12288);
      rem("PAINT BACKGROUND");
      push(ln + " FOR P=0 TO 999 : POKE 55296+P,CB : NEXT");
      push(ln + " RETURN");
    } else if (id === "speed") {
      // step 4: raster-interrupt timing
      rem("TIMING / RASTER IRQ");
      push(ln + " POKE 56334,PEEK(56334)AND254");
      push(ln + " POKE 53265,PEEK(53265)AND127");
      push(ln + " POKE 53274,RS : REM RASTER LINE");
      dataBlock("FRAME DELAY TABLE", Math.round(opt.hours * 1.5) + 2, 6, 49152);
      push(ln + " POKE 56334,PEEK(56334)OR1");
      push(ln + " RETURN");
    } else {
      // step 5: colour registers / palette
      rem("COLOUR REGISTERS");
      push(ln + " POKE 53280,BC : POKE 53281,SC");
      dataBlock("SPRITE COLOURS", Math.round(opt.hours * 4) + 2, 8, 53287);
      push(ln + " FOR C=0 TO 7 : POKE 53287+C,PC(C) : NEXT");
      push(ln + " RETURN");
    }

    lines.push("");
    lines.push(ln + " REM END OF LISTING - PHEW!");

    return lines.join("\n");
  }

  /* ---------- boot ---------- */
  const BOOT_LINES = [
    "",
    "    **** COMMODORE 64 BASIC V2 ****",
    "",
    " 64K RAM SYSTEM  38911 BASIC BYTES FREE",
    "",
    "READY.",
    "",
    'LOAD"BUILD-A-GAME",8,1',
    "",
    "SEARCHING FOR BUILD-A-GAME",
    "LOADING",
    "READY.",
    "RUN",
    "",
  ];

  async function runBoot() {
    const token = flowToken;
    showScreen("boot");
    bootCursor.style.display = "";
    let acc = "";
    for (let i = 0; i < BOOT_LINES.length; i++) {
      if (token !== flowToken) return;
      const line = BOOT_LINES[i];
      if (line === "LOADING") {
        for (let d = 0; d <= 12; d += 2) {
          if (token !== flowToken) return;
          bootText.textContent = acc + "LOADING" + ".".repeat(d);
          await delay(140);
        }
        acc += "LOADING............\n";
        bootText.textContent = acc;
        continue;
      }
      for (let c = 0; c < line.length; c++) {
        if (token !== flowToken) return;
        bootText.textContent = acc + line.slice(0, c + 1);
        await delay(16);
      }
      acc += line + "\n";
      bootText.textContent = acc;
      await delay(line === "" ? 90 : 180);
    }
    await delay(300);
    if (token !== flowToken) return;
    bootCursor.style.display = "none";
    goLanguage();
  }

  /* ---------- language ---------- */
  function buildLanguageGrid() {
    langGrid.innerHTML = "";
    LANG_ORDER.forEach((code, i) => {
      const meta = I18N[code];
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "flag-btn";
      btn.innerHTML = FLAGS[meta.flag] + "<span>" + meta.name + "</span>";
      btn.addEventListener("click", () => chooseLanguage(code));
      btn.addEventListener("mouseenter", () => setSelectedLang(i));
      langGrid.appendChild(btn);
    });
  }

  function applyLangHighlight() {
    const btns = langGrid.querySelectorAll(".flag-btn");
    btns.forEach((b, i) => b.classList.toggle("selected", i === selectedLang));
  }

  function setSelectedLang(i) {
    selectedLang = Math.max(0, Math.min(LANG_ORDER.length - 1, i));
    applyLangHighlight();
  }

  function moveLangSelection(dx, dy) {
    let row = Math.floor(selectedLang / OPTION_COLS);
    let col = selectedLang % OPTION_COLS;
    if (dx) col = Math.max(0, Math.min(OPTION_COLS - 1, col + dx));
    if (dy) row = Math.max(0, row + dy);
    let next = row * OPTION_COLS + col;
    if (next >= LANG_ORDER.length) next = LANG_ORDER.length - 1;
    setSelectedLang(next);
  }

  function goLanguage() {
    showScreen("language");
    selectedLang = 0;
    applyLangHighlight();
  }

  function chooseLanguage(code) {
    lang = code;
    L = I18N[code];
    stepIndex = 0;
    totalHours = 0;
    config = { players: 1, enemies: false, genre: "paddle", theme: "space", speed: "normal", speedFactor: 1, palette: "blue", gameName: "" };
    applyPalette("blue");
    showStep();
  }

  /* ---------- players-question sprites ---------- */
  function spriteRects(rects, ox) {
    return rects
      .map((r) => '<rect x="' + (ox + r[0]) + '" y="' + r[1] + '" width="' + r[2] + '" height="' + r[3] + '"/>')
      .join("");
  }
  function spritePerson(ox) {
    return spriteRects(
      [[6, 2, 4, 4], [5, 6, 6, 5], [3, 7, 2, 4], [11, 7, 2, 4], [5, 11, 2, 4], [9, 11, 2, 4]],
      ox,
    );
  }
  function spriteInvader(ox) {
    return spriteRects(
      [[4, 2, 2, 2], [10, 2, 2, 2], [3, 4, 10, 2], [2, 6, 12, 2], [4, 8, 2, 2], [7, 8, 2, 2], [10, 8, 2, 2]],
      ox,
    );
  }
  function modeIconSVG(players, enemies) {
    let x = 0;
    let people = "";
    for (let i = 0; i < players; i++) {
      people += spritePerson(x);
      x += 14;
    }
    let invader = "";
    if (enemies) {
      invader = spriteInvader(x);
      x += 16;
    }
    return (
      '<svg class="sprite" viewBox="0 0 ' + x + ' 16" preserveAspectRatio="xMidYMid meet" aria-hidden="true">' +
      '<g fill="var(--scr-hi, #ffff80)">' + people + "</g>" +
      (enemies ? '<g fill="var(--scr-accent, #80ffff)">' + invader + "</g>" : "") +
      "</svg>"
    );
  }

  /* ---------- build steps ---------- */
  function showStep() {
    showScreen("step");
    stepQuestion.classList.remove("hidden");
    stepTyping.classList.add("hidden");
    btnNext.classList.add("hidden");
    const q = QUESTIONS[stepIndex];
    stepCounter.textContent = fmt(L.stepCounter, { n: stepIndex + 1, total: QUESTIONS.length });
    stepHours.textContent = totalHours.toFixed(1) + " " + L.hoursSuffix;
    stepTitle.textContent = q.title[lang];
    stepOptions.innerHTML = "";
    q.options.forEach((opt, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "option-btn";
      const key = document.createElement("span");
      key.className = "option-key";
      key.textContent = "[" + (i + 1) + "]";
      const label = document.createElement("span");
      label.className = "option-label";
      label.textContent = opt.label[lang];
      const desc = document.createElement("span");
      desc.className = "option-desc";
      desc.textContent = opt.desc[lang];
      btn.appendChild(key);
      btn.appendChild(label);
      btn.appendChild(desc);
      if (q.id === "mode") {
        const icon = document.createElement("span");
        icon.className = "option-icon";
        icon.innerHTML = modeIconSVG(opt.set.players, opt.set.enemies);
        btn.appendChild(icon);
        btn.classList.add("has-icon");
      }
      btn.addEventListener("click", () => chooseOption(i));
      btn.addEventListener("mouseenter", () => setSelectedOption(i));
      stepOptions.appendChild(btn);
    });
    selectedOption = 0;
    applyOptionHighlight();
  }

  function applyOptionHighlight() {
    const btns = stepOptions.querySelectorAll(".option-btn");
    btns.forEach((b, i) => b.classList.toggle("selected", i === selectedOption));
  }

  function setSelectedOption(i) {
    const count = QUESTIONS[stepIndex].options.length;
    selectedOption = Math.max(0, Math.min(count - 1, i));
    applyOptionHighlight();
  }

  function moveSelection(dx, dy) {
    const count = QUESTIONS[stepIndex].options.length;
    let row = Math.floor(selectedOption / OPTION_COLS);
    let col = selectedOption % OPTION_COLS;
    if (dx) col = Math.max(0, Math.min(OPTION_COLS - 1, col + dx));
    if (dy) row = Math.max(0, row + dy);
    let next = row * OPTION_COLS + col;
    if (next >= count) next = count - 1;
    setSelectedOption(next);
  }

  async function chooseOption(i) {
    const q = QUESTIONS[stepIndex];
    const opt = q.options[i];
    Object.assign(config, opt.set);
    totalHours += opt.hours;
    stepHours.textContent = totalHours.toFixed(1) + " " + L.hoursSuffix;

    // Q5 palette gives a live recolour of the whole screen.
    if (q.id === "palette") applyPalette(config.palette);

    stepQuestion.classList.add("hidden");
    stepTyping.classList.remove("hidden");
    typingTitle.textContent = L.typingTitle;
    typingHours.textContent = "";
    typingHours.classList.remove("flash");
    btnNext.classList.add("hidden");
    typingCursor.style.display = "";
    typingDone = false;
    typingScroll.scrollTop = 0;

    KeyAudio.resume();
    const token = flowToken;
    const codeText = expandCode(opt, stepIndex);
    const ok = await typeInto(typingCode, codeText, 12, token);
    if (!ok || token !== flowToken) return;
    typingCursor.style.display = "none";
    typingHours.textContent = fmt(L.typingHours, { h: opt.hours.toFixed(1) });
    typingHours.classList.add("flash");
    btnNext.textContent = L.next;
    btnNext.classList.remove("hidden");
    typingDone = true;
  }

  function nextStep() {
    if (!typingDone) {
      skipFlag = true;
      return;
    }
    stepIndex += 1;
    if (stepIndex >= QUESTIONS.length) {
      showName();
    } else {
      showStep();
    }
  }

  /* ---------- name your game ---------- */
  function sampleNames() {
    return (window.SAMPLE_NAMES && (window.SAMPLE_NAMES[config.genre] || window.SAMPLE_NAMES._default)) || ["GAME 64"];
  }

  function showName() {
    showScreen("name");
    nameTitleEl.textContent = L.nameTitle;
    nameExamplesLabel.textContent = L.nameExamples;
    nameHint.textContent = L.nameHint;
    btnSave.textContent = L.nameSaveRun;
    nameInput.value = "";
    nameInput.placeholder = sampleNames()[0];
    nameExamples.innerHTML = "";
    sampleNames().forEach((nm) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "name-example-btn";
      b.textContent = nm;
      b.addEventListener("click", () => {
        nameInput.value = nm;
        nameInput.focus();
      });
      nameExamples.appendChild(b);
    });
    setTimeout(() => nameInput.focus(), 30);
  }

  function confirmName() {
    let nm = (nameInput.value || "").trim().toUpperCase().slice(0, 16);
    if (!nm) {
      const samples = sampleNames();
      nm = samples[Math.floor(Math.random() * samples.length)];
    }
    config.gameName = nm;
    runCompile();
  }

  /* ---------- compile ---------- */
  async function runCompile() {
    showScreen("compile");
    const token = flowToken;
    compileTitle.textContent = L.compileTitle;
    compileTotal.textContent = "";
    btnRun.classList.add("hidden");
    compileLog.textContent = "";
    let acc = 'SAVE"' + (config.gameName || "GAME") + '",1\n';
    compileLog.textContent = acc;
    await delay(500);
    for (const line of L.compileLog) {
      if (token !== flowToken) return;
      acc += "> " + line + "\n";
      compileLog.textContent = acc;
      await delay(420);
    }
    if (token !== flowToken) return;
    compileTotal.innerHTML = "";
    const sentence = document.createElement("p");
    sentence.className = "compile-sentence";
    const parts = L.compileTotal.split("{big}");
    sentence.appendChild(document.createTextNode(parts[0] || ""));
    const big = document.createElement("span");
    big.className = "hours-big";
    big.textContent = totalHours.toFixed(1) + " " + (L.hoursWord || L.hoursSuffix);
    sentence.appendChild(big);
    sentence.appendChild(document.createTextNode(parts[1] || ""));
    const sub = document.createElement("p");
    sub.className = "compile-sub-line";
    sub.textContent = L.compileSub;
    compileTotal.appendChild(sentence);
    compileTotal.appendChild(sub);
    btnRun.textContent = L.run;
    btnRun.classList.remove("hidden");
  }

  /* ---------- share link + QR ---------- */
  function getSpeedFactor(speedId) {
    const q = QUESTIONS.find((qq) => qq.id === "speed");
    const o = q && q.options.find((oo) => oo.set.speed === speedId);
    return o ? o.set.speedFactor : 1;
  }

  function labelFor(questionId, key, value) {
    const q = QUESTIONS.find((qq) => qq.id === questionId);
    if (!q) return "";
    const o = q.options.find((oo) => oo.set[key] === value);
    return o ? o.label[lang] || o.label.en : "";
  }

  function buildGameUrl(cfg, lg) {
    const q = new URLSearchParams();
    q.set("l", lg);
    q.set("p", String(cfg.players));
    q.set("e", cfg.enemies ? "1" : "0");
    q.set("g", cfg.genre);
    q.set("t", cfg.theme);
    q.set("s", cfg.speed);
    q.set("c", cfg.palette);
    if (cfg.gameName) q.set("n", cfg.gameName);
    return SHARE_BASE_URL + "?" + q.toString();
  }

  function drawQR(canvas, text, paletteId) {
    if (!window.QRCode) return;
    let m;
    try {
      m = window.QRCode.encode(text);
    } catch (_) {
      return;
    }
    const colors = QR_COLORS[paletteId] || QR_COLORS.blue;
    const quiet = 4;
    const dim = m.size + quiet * 2;
    const scale = Math.max(3, Math.floor(560 / dim));
    canvas.width = dim * scale;
    canvas.height = dim * scale;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = colors.light;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = colors.dark;
    for (let y = 0; y < m.size; y++) {
      for (let x = 0; x < m.size; x++) {
        if (m.modules[y][x]) ctx.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale);
      }
    }
  }

  /* ---------- deep-link title screen (opened from a QR code) ---------- */
  function tryDeepLink() {
    const params = new URLSearchParams(window.location.search);
    const g = params.get("g");
    if (!g || GENRES.indexOf(g) === -1) return false;

    const lg = params.get("l");
    if (lg && I18N[lg]) {
      lang = lg;
      L = I18N[lg];
    }
    const theme = params.get("t");
    const speed = params.get("s");
    const palette = params.get("c");
    const rawName = (params.get("n") || "").toUpperCase().slice(0, 16);
    config = {
      players: params.get("p") === "2" ? 2 : 1,
      enemies: params.get("e") === "1",
      genre: g,
      theme: THEMES.indexOf(theme) !== -1 ? theme : "space",
      speed: SPEEDS.indexOf(speed) !== -1 ? speed : "normal",
      speedFactor: getSpeedFactor(SPEEDS.indexOf(speed) !== -1 ? speed : "normal"),
      palette: PALETTES.indexOf(palette) !== -1 ? palette : "blue",
      gameName: rawName,
    };
    isDeepLink = true;
    showTitle();
    return true;
  }

  function showTitle() {
    showScreen("title");
    applyPalette(config.palette);
    titleName.textContent = config.gameName || "MY C64 GAME";
    titleSub.textContent = labelFor("genre", "genre", config.genre);
    titlePlay.textContent = L.titlePlay;
  }

  /* ---------- game ---------- */
  function launchGame() {
    showScreen("game");
    applyPalette(config.palette);
    Games.start(config, L, onGameEnd);
  }

  function onGameEnd(res) {
    // Direct-link sessions loop back to this game's own title screen instead of
    // showing the QR results page and restarting the whole build-your-own flow.
    if (isDeepLink) {
      showTitle();
      return;
    }
    showResults(res);
  }

  /* ---------- results ---------- */
  function showResults(res) {
    showScreen("results");
    let title = L.resultTimeUp;
    if (res.outcome === "win") title = L.resultWin;
    else if (res.outcome === "lose") title = L.resultLose;
    else if (res.outcome === "p1") title = L.resultP1Win;
    else if (res.outcome === "p2") title = L.resultP2Win;
    else if (res.outcome === "quit") title = L.resultEnded || L.resultTimeUp;
    resultsTitle.textContent = title;

    let scoreLine;
    if (res.players === 2) {
      scoreLine = "P1: " + res.p1 + "   P2: " + res.p2;
    } else {
      scoreLine = fmt(L.resultScore, { s: res.score });
    }
    const namePart = config.gameName ? '"' + config.gameName + '"  ·  ' : "";
    resultsBody.textContent = namePart + scoreLine + "  ·  " + L.resultsThanks;

    drawQR(qrCanvas, buildGameUrl(config, lang), config.palette);
    qrLabel.textContent = L.scanToPlay;

    let n = 120;
    resultsCountdown.textContent = fmt(L.returning, { n });
    if (resultTimer) clearInterval(resultTimer);
    resultTimer = setInterval(() => {
      n -= 1;
      if (n <= 0) {
        clearInterval(resultTimer);
        resultTimer = null;
        reset();
        return;
      }
      resultsCountdown.textContent = fmt(L.returning, { n });
    }, 1000);
  }

  /* ---------- reset ---------- */
  function reset() {
    flowToken += 1;
    skipFlag = false;
    if (resultTimer) {
      clearInterval(resultTimer);
      resultTimer = null;
    }
    Games.stop();
    applyPalette("blue");
    goLanguage();
  }

  /* ---------- input ---------- */
  function markActivity() {
    lastActivity = Date.now();
  }

  document.addEventListener("keydown", (e) => {
    markActivity();
    // global quit (not during boot/language; KeyQ disabled on the name screen so it can be typed)
    const isQuitKey = e.code === "Escape" || (e.code === "KeyQ" && state !== "name");
    if (isQuitKey && state !== "boot" && state !== "language") {
      if (!(e.metaKey || e.ctrlKey || e.altKey)) {
        e.preventDefault();
        // Quitting a running game should still show the results + QR page.
        if (state === "game") Games.quit();
        else reset();
        return;
      }
    }
    if (state === "name") {
      if (e.code === "Enter") {
        e.preventDefault();
        confirmName();
      }
      return; // let all other keys type into the input
    }
    if (state === "language") {
      const lidx = parseInt(e.key, 10);
      if (lidx >= 1 && lidx <= LANG_ORDER.length) {
        e.preventDefault();
        chooseLanguage(LANG_ORDER[lidx - 1]);
        return;
      }
      switch (e.code) {
        case "ArrowLeft":
        case "KeyA":
          e.preventDefault();
          moveLangSelection(-1, 0);
          break;
        case "ArrowRight":
        case "KeyD":
          e.preventDefault();
          moveLangSelection(1, 0);
          break;
        case "ArrowUp":
        case "KeyW":
          e.preventDefault();
          moveLangSelection(0, -1);
          break;
        case "ArrowDown":
        case "KeyS":
          e.preventDefault();
          moveLangSelection(0, 1);
          break;
        case "Enter":
        case "Space":
          e.preventDefault();
          chooseLanguage(LANG_ORDER[selectedLang]);
          break;
      }
      return;
    }
    if (state === "step") {
      if (!stepTyping.classList.contains("hidden")) {
        if (e.code === "Space" || e.code === "Enter") {
          e.preventDefault();
          nextStep();
        }
        return;
      }
      const idx = parseInt(e.key, 10);
      if (idx >= 1 && idx <= QUESTIONS[stepIndex].options.length) {
        e.preventDefault();
        chooseOption(idx - 1);
        return;
      }
      switch (e.code) {
        case "ArrowLeft":
        case "KeyA":
          e.preventDefault();
          moveSelection(-1, 0);
          break;
        case "ArrowRight":
        case "KeyD":
          e.preventDefault();
          moveSelection(1, 0);
          break;
        case "ArrowUp":
        case "KeyW":
          e.preventDefault();
          moveSelection(0, -1);
          break;
        case "ArrowDown":
        case "KeyS":
          e.preventDefault();
          moveSelection(0, 1);
          break;
        case "Enter":
        case "Space":
          e.preventDefault();
          chooseOption(selectedOption);
          break;
      }
    } else if (state === "compile") {
      if ((e.code === "Space" || e.code === "Enter") && !btnRun.classList.contains("hidden")) {
        e.preventDefault();
        launchGame();
      }
    } else if (state === "title") {
      if (e.code === "Space" || e.code === "Enter") {
        e.preventDefault();
        launchGame();
      }
    } else if (state === "results") {
      if (e.code === "Space" || e.code === "Enter") {
        e.preventDefault();
        reset();
      }
    }
  });

  screens.title.addEventListener("click", () => {
    if (state === "title") launchGame();
  });

  document.addEventListener("click", markActivity);
  document.addEventListener("mousemove", markActivity);
  document.addEventListener("touchstart", markActivity, { passive: true });

  setInterval(() => {
    if (Date.now() - lastActivity < IDLE_MS) return;
    if (state === "game") {
      Games.quit();
      lastActivity = Date.now();
    } else if (state === "step" || state === "name" || state === "compile") {
      // Note: "results" is excluded (its own 2-minute countdown governs it) and
      // "title" is excluded (deep-link sessions should stay on their own title).
      reset();
      lastActivity = Date.now();
    }
  }, 5000);

  /* ---------- chrome buttons ---------- */
  btnNext.addEventListener("click", nextStep);
  btnSave.addEventListener("click", confirmName);
  btnRun.addEventListener("click", launchGame);

  /* ---------- touch control wiring ---------- */
  touchButtons.forEach((b) => {
    const code = b.getAttribute("data-code");
    const press = (e) => {
      e.preventDefault();
      markActivity();
      Games.setKey(code, true);
      b.classList.add("pressed");
    };
    const release = (e) => {
      if (e && e.cancelable) e.preventDefault();
      Games.setKey(code, false);
      b.classList.remove("pressed");
    };
    b.addEventListener("pointerdown", press);
    b.addEventListener("pointerup", release);
    b.addEventListener("pointercancel", release);
    b.addEventListener("pointerleave", release);
    b.addEventListener("contextmenu", (e) => e.preventDefault());
  });

  document.addEventListener("fullscreenchange", () => Games.fit());
  document.addEventListener("webkitfullscreenchange", () => Games.fit());

  /* ---------- start ---------- */
  buildLanguageGrid();
  if (!tryDeepLink()) runBoot();
})();
