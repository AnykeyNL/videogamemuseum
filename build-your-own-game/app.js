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
    const dataBlock = (title, count, perLine) => {
      lines.push("");
      lines.push(ln + " REM ===== " + title + " =====");
      ln += 10;
      lines.push(ln + " FOR I=0 TO " + (count * perLine - 1) + " : READ B : POKE 832+I,B : NEXT");
      ln += 10;
      for (let r = 0; r < count; r++) {
        const vals = [];
        for (let c = 0; c < perLine; c++) vals.push(byte());
        push(ln + " DATA " + vals.join(","));
      }
    };

    // size scales with the typing-hours estimate -> bigger choices, more code
    const spriteRows = Math.round(opt.hours * 1.5) + 2;
    const soundRows = Math.round(opt.hours * 0.75) + 1;
    const levelRows = Math.round(opt.hours * 1) + 2;

    dataBlock("SPRITE SHAPES", spriteRows, 8);
    dataBlock("SOUND TABLE (SID)", soundRows, 7);
    dataBlock("SCREEN / LEVEL MAP", levelRows, 10);

    lines.push("");
    lines.push(ln + " REM ===== MAIN LOOP =====");
    ln += 10;
    const loopLines = [
      "GET K$ : IF K$=\"\" THEN " + (ln + 10),
      "IF K$=\"Z\" THEN X=X-1",
      "IF K$=\"X\" THEN X=X+1",
      "POKE 53248,X : POKE 53249,Y",
      "S=S+1 : IF S>255 THEN S=0",
      "POKE 1024+P,32 : P=X/8+Y/8*40 : POKE 1024+P,81",
      "IF C=1 THEN GOSUB 5000 : REM CHECK HIT",
      "IF SC>HI THEN HI=SC",
      "PRINT \"{HOME}SCORE \";SC;\"  HI \";HI",
    ];
    loopLines.forEach((s) => push(ln + " " + s));
    push(ln + " GOTO " + (ln - loopLines.length * 10));
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

  /* ---------- game ---------- */
  function launchGame() {
    showScreen("game");
    applyPalette(config.palette);
    Games.start(config, L, onGameEnd);
  }

  function onGameEnd(res) {
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
    resultsTitle.textContent = title;

    let scoreLine;
    if (res.players === 2) {
      scoreLine = "P1: " + res.p1 + "   P2: " + res.p2;
    } else {
      scoreLine = fmt(L.resultScore, { s: res.score });
    }
    const namePart = config.gameName ? '"' + config.gameName + '"  ·  ' : "";
    resultsBody.textContent = namePart + scoreLine + "  ·  " + L.resultsThanks;

    let n = 7;
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
        reset();
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
    } else if (state === "results") {
      if (e.code === "Space" || e.code === "Enter") {
        e.preventDefault();
        reset();
      }
    }
  });

  document.addEventListener("click", markActivity);
  document.addEventListener("mousemove", markActivity);
  document.addEventListener("touchstart", markActivity, { passive: true });

  setInterval(() => {
    if (Date.now() - lastActivity < IDLE_MS) return;
    if (state === "step" || state === "name" || state === "compile" || state === "results") {
      reset();
      lastActivity = Date.now();
    }
  }, 5000);

  /* ---------- chrome buttons ---------- */
  btnNext.addEventListener("click", nextStep);
  btnSave.addEventListener("click", confirmName);
  btnRun.addEventListener("click", launchGame);

  document.addEventListener("fullscreenchange", () => Games.fit());
  document.addEventListener("webkitfullscreenchange", () => Games.fit());

  /* ---------- start ---------- */
  buildLanguageGrid();
  runBoot();
})();
