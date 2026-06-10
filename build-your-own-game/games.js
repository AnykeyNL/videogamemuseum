/*
 * Game engines for the C64 "Build Your Own Game" kiosk.
 *
 * Four parameterized engines (shooter, maze, dodge, paddle). The build config
 * { players, enemies, genre, theme, speed, speedFactor, palette } selects the
 * engine and tunes it, so every answer combination produces a working game.
 *
 * A ~150s round timer guarantees each game lasts ~2-3 minutes, then calls the
 * onEnd callback with a result object.
 */
window.Games = (function () {
  "use strict";

  const W = 640;
  const H = 400;
  const ROUND_MS = 150000; // ~2.5 minutes
  const END_HOLD = 110; // frames to hold the end message before returning

  const PALETTES = {
    blue: { bg: "#4040c0", fg: "#a0a0ff", accent: "#80ffff", hi: "#ffff80", dim: "#5a5ad0" },
    green: { bg: "#0a1f0a", fg: "#4dff6a", accent: "#b6ffc2", hi: "#eaff7a", dim: "#1d4d22" },
    amber: { bg: "#251400", fg: "#ffb000", accent: "#ffd479", hi: "#fff0c0", dim: "#5a3500" },
    mono: { bg: "#050510", fg: "#e8e8ff", accent: "#80ffff", hi: "#ffff80", dim: "#33334d" },
  };

  /*
   * Worlds (Q3 theme). Each world paints a full, animated background scene and
   * supplies a `tint` colour used for that world's hazards/enemies, so every
   * game looks unmistakably different per world. Backgrounds stay dark so the
   * palette-coloured player sprites keep good contrast on top.
   */
  const THEMES = {
    space: { top: "#05030f", bottom: "#0c0a26", tint: "#79d0ff", draw: drawSpace },
    jungle: { top: "#08160b", bottom: "#0e2614", tint: "#7dff8a", draw: drawJungle },
    castle: { top: "#15141c", bottom: "#241f2c", tint: "#ffc15a", draw: drawCastle },
    neon: { top: "#0b0422", bottom: "#1b0a38", tint: "#ff4cd2", draw: drawNeon },
  };

  let canvas, ctx, els, stage;
  let raf = 0;
  let running = false;
  let last = 0;
  const keys = {};

  let cfg = null;
  let lang = null;
  let C = PALETTES.blue; // active colors
  let TH = THEMES.space; // active world
  let onEnd = null;

  let roundEndAt = 0;
  let score = 0;
  let p1 = 0;
  let p2 = 0;
  let lives = -1;
  let ended = false;
  let endHold = 0;
  let outcome = null;
  let E = {}; // per-engine state
  let engine = null;

  /* ---------- audio (simple SID-ish bleeps) ---------- */
  const Audio = (function () {
    let ac = null;
    function context() {
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
    function resume() {
      const c = context();
      if (c && c.state === "suspended") c.resume();
    }
    function tone(f0, f1, dur, peak, type) {
      const c = context();
      if (!c) return;
      const t = c.currentTime;
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = type || "square";
      osc.frequency.setValueAtTime(f0, t);
      if (f1 != null && Math.abs(f1 - f0) > 0.5) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(22, f1), t + dur * 0.9);
      }
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(peak, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g);
      g.connect(c.destination);
      osc.start(t);
      osc.stop(t + dur + 0.03);
    }
    return {
      resume,
      shoot() {
        tone(880, 420, 0.07, 0.08, "square");
      },
      hit() {
        tone(180, 90, 0.12, 0.1, "triangle");
      },
      pickup() {
        tone(660, 990, 0.05, 0.08, "square");
      },
      bounce() {
        tone(420, 300, 0.05, 0.07, "triangle");
      },
      point() {
        tone(523, 784, 0.08, 0.09, "square");
      },
      start() {
        tone(392, 784, 0.1, 0.09, "square");
      },
      win() {
        const c = context();
        if (!c) return;
        [523, 659, 784, 1046].forEach((f, i) => {
          setTimeout(() => tone(f, f, 0.1, 0.1, "square"), i * 90);
        });
      },
      lose() {
        const c = context();
        if (!c) return;
        [392, 311, 233].forEach((f, i) => {
          setTimeout(() => tone(f, f * 0.7, 0.16, 0.1, "triangle"), i * 130);
        });
      },
    };
  })();

  /* ---------- helpers ---------- */
  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  function down(code) {
    return !!keys[code];
  }
  function aabb(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }
  function sf() {
    return cfg && cfg.speedFactor ? cfg.speedFactor : 1;
  }
  function timeLeftMs() {
    return Math.max(0, roundEndAt - performance.now());
  }

  function fit() {
    if (!stage || !canvas) return;
    const r = stage.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return;
    const scale = Math.min(r.width / W, r.height / H);
    canvas.style.width = Math.max(2, Math.floor(W * scale)) + "px";
    canvas.style.height = Math.max(2, Math.floor(H * scale)) + "px";
  }

  /* ---------- shared drawing ---------- */
  /* Paint the active world: vertical gradient sky + the world's own scene. */
  function drawWorld() {
    const t = performance.now() / 1000;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, TH.top);
    g.addColorStop(1, TH.bottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    TH.draw(t);
    ctx.restore();
  }

  /* ===== world: SPACE ===== twinkling starfield + ringed planet ===== */
  function drawSpace(t) {
    for (let i = 0; i < 80; i++) {
      const x = (i * 97) % W;
      const y = (i * 61) % H;
      const tw = 0.35 + 0.65 * Math.abs(Math.sin(t * 1.8 + i));
      ctx.globalAlpha = tw;
      ctx.fillStyle = i % 9 === 0 ? TH.tint : "#ffffff";
      const s = i % 13 === 0 ? 2 : 1;
      ctx.fillRect(x, y, s, s);
    }
    ctx.globalAlpha = 1;
    // ringed planet, top-right
    const px = W - 92, py = 78;
    ctx.fillStyle = "#3a2a6a";
    ctx.beginPath();
    ctx.arc(px, py, 44, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#5847a0";
    ctx.beginPath();
    ctx.arc(px + 12, py - 10, 44, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(150,180,255,0.55)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(px, py, 70, 18, -0.5, 0, Math.PI * 2);
    ctx.stroke();
    // slow shooting star
    const sx = (t * 220) % (W + 200) - 100;
    const sy = 40 + ((t * 60) % 120);
    ctx.strokeStyle = "rgba(180,220,255,0.8)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx - 26, sy - 10);
    ctx.stroke();
  }

  /* ===== world: JUNGLE ===== trunks, canopy, swaying vines, ferns ===== */
  function drawJungle(t) {
    // far trunks
    ctx.fillStyle = "#23341c";
    for (let i = 0; i < 5; i++) ctx.fillRect(40 + i * 142, 0, 20, H);
    // top canopy of overlapping leaves
    ctx.fillStyle = "#14401d";
    for (let x = -10; x < W + 40; x += 42) {
      const r = 28 + ((x * 7) % 18);
      ctx.beginPath();
      ctx.arc(x, 6, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // swaying vines with leaf tips
    for (let i = 0; i < 8; i++) {
      const x = 28 + i * 80;
      const sway = Math.sin(t * 1.3 + i) * 12;
      ctx.strokeStyle = "#2f7a35";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.quadraticCurveTo(x + sway, 80, x + sway * 0.6, 150);
      ctx.stroke();
      ctx.fillStyle = "#3ea045";
      ctx.beginPath();
      ctx.arc(x + sway * 0.6, 150, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    // ground ferns
    ctx.fillStyle = "#10301a";
    for (let x = 0; x < W; x += 28) {
      ctx.beginPath();
      ctx.moveTo(x, H);
      ctx.lineTo(x + 14, H - 26);
      ctx.lineTo(x + 28, H);
      ctx.closePath();
      ctx.fill();
    }
  }

  /* ===== world: CASTLE ===== brick wall, battlements, flickering torches ===== */
  function drawCastle(t) {
    // mortar grid
    const bw = 48, bh = 24;
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 2;
    for (let r = 0; r * bh < H; r++) {
      const off = (r % 2) * (bw / 2);
      for (let c = -1; c * bw < W; c++) ctx.strokeRect(c * bw + off, r * bh, bw, bh);
    }
    // battlements along the top
    ctx.fillStyle = "#2b2733";
    ctx.fillRect(0, 0, W, 24);
    for (let x = 0; x < W; x += 48) ctx.fillRect(x, 0, 24, 40);
    // wall-mounted torches
    for (let i = 0; i < 3; i++) {
      const x = 120 + i * 200;
      ctx.fillStyle = "#3a2a18";
      ctx.fillRect(x - 2, 58, 4, 26);
      const fl = 0.55 + 0.45 * Math.abs(Math.sin(t * 9 + i * 2));
      ctx.globalAlpha = fl;
      const grd = ctx.createRadialGradient(x, 54, 2, x, 54, 24);
      grd.addColorStop(0, "#ffd36a");
      grd.addColorStop(1, "rgba(255,120,0,0)");
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(x, 54, 24, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#ff8c1a";
      ctx.beginPath();
      ctx.ellipse(x, 52, 5, 10, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffe07a";
      ctx.beginPath();
      ctx.ellipse(x, 54, 2.5, 6, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /* ===== world: NEON CITY ===== synthwave sun, skyline, perspective grid ===== */
  function drawNeon(t) {
    const horizon = H * 0.52;
    // synthwave sun with horizontal bars
    ctx.save();
    ctx.beginPath();
    ctx.arc(W / 2, horizon, 62, 0, Math.PI * 2);
    ctx.clip();
    const sg = ctx.createLinearGradient(0, horizon - 62, 0, horizon + 62);
    sg.addColorStop(0, "#ffe24a");
    sg.addColorStop(0.5, "#ff5bd0");
    sg.addColorStop(1, "#a01a8f");
    ctx.fillStyle = sg;
    ctx.fillRect(W / 2 - 62, horizon - 62, 124, 124);
    ctx.fillStyle = "rgba(11,4,34,0.9)";
    for (let i = 0; i < 6; i++) ctx.fillRect(W / 2 - 62, horizon + 4 + i * 9, 124, 3 + i);
    ctx.restore();
    // skyline silhouette with glowing windows
    const cols = 14, cw = W / cols;
    for (let i = 0; i < cols; i++) {
      const x = i * cw;
      const h = 40 + ((i * 53) % 70);
      ctx.fillStyle = "#160a2e";
      ctx.fillRect(x, horizon - h, cw - 4, h);
      ctx.fillStyle = i % 2 ? "#21e0ff" : "#ff4cd2";
      for (let wy = horizon - h + 6; wy < horizon - 6; wy += 12) {
        for (let wx = x + 4; wx < x + cw - 8; wx += 10) {
          if ((wx + wy + ((t * 2) | 0)) % 3 === 0) ctx.fillRect(wx, wy, 4, 5);
        }
      }
    }
    // perspective floor grid
    ctx.strokeStyle = "rgba(255,76,210,0.45)";
    ctx.lineWidth = 2;
    for (let i = -10; i <= 10; i++) {
      ctx.beginPath();
      ctx.moveTo(W / 2, horizon);
      ctx.lineTo(W / 2 + i * 64, H);
      ctx.stroke();
    }
    let yy = horizon, step = 4;
    const scroll = (t * 18) % 6;
    while (yy < H) {
      const y = yy + scroll;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
      step *= 1.28;
      yy += step;
    }
  }
  function text(str, x, y, size, color, align) {
    ctx.fillStyle = color || C.hi;
    ctx.font = (size || 16) + 'px "Press Start 2P", monospace';
    ctx.textAlign = align || "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(str, x, y);
  }

  /* ---------- status / hint ---------- */
  function fmtTime(ms) {
    const s = Math.ceil(ms / 1000);
    const m = Math.floor(s / 60);
    const r = s % 60;
    return m + ":" + (r < 10 ? "0" + r : r);
  }
  function updateStatus() {
    els.statusMid.textContent = (lang.time || "TIME") + " " + fmtTime(timeLeftMs());
    if (cfg.players === 2) {
      els.statusLeft.textContent = "P1 " + p1;
      els.statusRight.textContent = p2 + " P2";
    } else {
      els.statusLeft.textContent = String(score);
      els.statusRight.textContent = lives >= 0 ? "x" + lives : "";
    }
  }
  function buildHint() {
    const L = lang;
    let parts = [];
    if (cfg.players === 2) parts.push(L.hintMove2P);
    else parts.push(L.hintMove1P);
    if (cfg.genre === "shooter") parts.push(cfg.players === 2 ? L.hintShoot2P : L.hintShoot);
    parts.push(L.quitHint);
    els.gameHint.textContent = parts.join("   ·   ");
  }

  /* ---------- engines ---------- */
  const ENGINES = {};

  /* ===== SHOOTER ===== */
  ENGINES.shooter = {
    init() {
      const baseY = H - 34;
      E.ships = [];
      if (cfg.players === 2) {
        E.ships.push({ x: W * 0.33, y: baseY, w: 28, cd: 0, fire: "Space", left: "KeyA", right: "KeyD", color: C.hi });
        E.ships.push({ x: W * 0.66, y: baseY, w: 28, cd: 0, fire: "Enter", left: "ArrowLeft", right: "ArrowRight", color: C.accent });
      } else {
        E.ships.push({ x: W / 2, y: baseY, w: 28, cd: 0, fire: "Space", left: "ArrowLeft", right: "ArrowRight", color: C.hi });
      }
      E.bullets = [];
      E.ebullets = [];
      E.enemies = [];
      E.dir = 1;
      E.spawnTimer = 0;
      E.hitInv = 0;
      lives = cfg.enemies ? 3 : -1;
      spawnWave();
    },
    update(dt) {
      const s = sf();
      if (E.hitInv > 0) E.hitInv -= dt;
      E.ships.forEach((sh) => {
        if (down(sh.left)) sh.x -= 3.2 * s * dt;
        if (down(sh.right)) sh.x += 3.2 * s * dt;
        sh.x = clamp(sh.x, sh.w / 2, W - sh.w / 2);
        sh.cd -= dt;
        if (down(sh.fire) && sh.cd <= 0) {
          E.bullets.push({ x: sh.x, y: sh.y - 16, owner: sh });
          sh.cd = 14;
          Audio.shoot();
        }
      });
      // player bullets
      E.bullets.forEach((b) => (b.y -= 7 * s * dt));
      E.bullets = E.bullets.filter((b) => b.y > -10);
      // enemies move
      let edge = false;
      E.enemies.forEach((e) => {
        if (!e.alive) return;
        e.x += E.dir * 0.9 * s * dt;
        if (e.x < 14 || e.x > W - 14) edge = true;
      });
      if (edge) {
        E.dir *= -1;
        E.enemies.forEach((e) => (e.y += 14));
      }
      // enemy fire / target drift
      if (cfg.enemies) {
        E.spawnTimer -= dt;
        if (E.spawnTimer <= 0) {
          const alive = E.enemies.filter((e) => e.alive);
          if (alive.length) {
            const e = alive[(Math.random() * alive.length) | 0];
            E.ebullets.push({ x: e.x, y: e.y + 10 });
          }
          E.spawnTimer = 40 / s;
        }
        E.ebullets.forEach((b) => (b.y += 4 * s * dt));
      } else {
        E.enemies.forEach((e) => {
          if (e.alive) e.y += 0.35 * s * dt;
        });
      }
      E.ebullets = E.ebullets.filter((b) => b.y < H + 10);
      // collisions: player bullets vs enemies
      E.bullets.forEach((b) => {
        E.enemies.forEach((e) => {
          if (e.alive && aabb(b.x - 2, b.y - 6, 4, 10, e.x - 12, e.y - 8, 24, 16)) {
            e.alive = false;
            b.y = -100;
            if (b.owner === E.ships[1]) p2 += 10;
            else p1 += 10;
            score = p1 + p2;
            Audio.hit();
          }
        });
      });
      // enemy bullets / enemies reaching ships
      E.ships.forEach((sh) => {
        if (cfg.enemies) {
          E.ebullets.forEach((b) => {
            if (aabb(b.x - 2, b.y - 2, 4, 8, sh.x - sh.w / 2, sh.y - 10, sh.w, 18)) {
              b.y = H + 100;
              loseLife();
            }
          });
        }
      });
      // enemies that reach bottom
      E.enemies.forEach((e) => {
        if (e.alive && e.y > H - 30) {
          e.alive = false;
          if (cfg.enemies) loseLife();
        }
      });
      // enemy ships crashing into a player ship -> lose a life (with brief invulnerability)
      if (cfg.enemies && E.hitInv <= 0) {
        E.ships.forEach((sh) => {
          E.enemies.forEach((e) => {
            if (e.alive && aabb(sh.x - sh.w / 2, sh.y - 12, sh.w, 24, e.x - 12, e.y - 8, 24, 16)) {
              e.alive = false;
              E.hitInv = 60;
              loseLife();
            }
          });
        });
      }
      // next wave
      if (E.enemies.every((e) => !e.alive)) spawnWave();
    },
    draw() {
      drawWorld();
      E.enemies.forEach((e) => {
        if (!e.alive) return;
        ctx.fillStyle = TH.tint;
        ctx.fillRect(e.x - 12, e.y - 8, 24, 16);
        ctx.fillStyle = "#0a0a14";
        ctx.fillRect(e.x - 6, e.y - 2, 4, 4);
        ctx.fillRect(e.x + 2, e.y - 2, 4, 4);
      });
      ctx.fillStyle = C.hi;
      E.bullets.forEach((b) => ctx.fillRect(b.x - 2, b.y - 6, 4, 10));
      ctx.fillStyle = C.accent;
      E.ebullets.forEach((b) => ctx.fillRect(b.x - 2, b.y - 2, 4, 8));
      E.ships.forEach((sh) => {
        if (E.hitInv > 0 && (((E.hitInv / 6) | 0) % 2 === 0)) return;
        ctx.fillStyle = sh.color;
        ctx.beginPath();
        ctx.moveTo(sh.x, sh.y - 12);
        ctx.lineTo(sh.x - sh.w / 2, sh.y + 8);
        ctx.lineTo(sh.x + sh.w / 2, sh.y + 8);
        ctx.closePath();
        ctx.fill();
      });
    },
  };
  function spawnWave() {
    const cols = 8;
    const rows = cfg.enemies ? 3 : 2;
    E.enemies = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        E.enemies.push({ x: 70 + c * 64, y: 50 + r * 34, alive: true });
      }
    }
    E.dir = 1;
  }

  /* ===== MAZE ===== */
  ENGINES.maze = {
    init() {
      // wall rectangles: border + interior bars
      E.walls = [];
      const t = 16;
      E.walls.push({ x: 0, y: 0, w: W, h: t });
      E.walls.push({ x: 0, y: H - t, w: W, h: t });
      E.walls.push({ x: 0, y: 0, w: t, h: H });
      E.walls.push({ x: W - t, y: 0, w: t, h: H });
      // interior pillars / bars (open layout = always solvable)
      const bars = [
        [90, 70, 120, 16], [330, 70, 120, 16], [510, 70, 16, 120],
        [90, 150, 16, 120], [180, 150, 120, 16], [330, 230, 120, 16],
        [200, 300, 120, 16], [430, 150, 16, 120], [90, 320, 120, 16],
        [510, 300, 16, 70],
      ];
      bars.forEach((b) => E.walls.push({ x: b[0], y: b[1], w: b[2], h: b[3] }));

      E.players = [];
      E.players.push({ x: 40, y: 40, score: 0, lives: cfg.enemies ? 3 : -1, inv: 0, sx: 40, sy: 40, left: "ArrowLeft", right: "ArrowRight", up: "ArrowUp", down: "ArrowDown", color: C.hi });
      if (cfg.players === 2) {
        E.players[0].left = "KeyA"; E.players[0].right = "KeyD"; E.players[0].up = "KeyW"; E.players[0].down = "KeyS";
        E.players.push({ x: W - 40, y: H - 40, score: 0, lives: cfg.enemies ? 3 : -1, inv: 0, sx: W - 40, sy: H - 40, left: "ArrowLeft", right: "ArrowRight", up: "ArrowUp", down: "ArrowDown", color: C.accent });
      }
      // gems on a grid, skipping walls and start cells
      E.gems = [];
      for (let gx = 40; gx < W - 20; gx += 40) {
        for (let gy = 40; gy < H - 20; gy += 40) {
          if (E.walls.some((wl) => aabb(gx - 8, gy - 8, 16, 16, wl.x, wl.y, wl.w, wl.h))) continue;
          E.gems.push({ x: gx, y: gy, got: false });
        }
      }
      E.chasers = [];
      if (cfg.enemies) {
        const n = cfg.players === 2 ? 3 : 2;
        const spots = [
          [W / 2, H / 2],
          [W / 2 - 48, H / 2 + 40],
          [W / 2 + 48, H / 2 - 40],
        ];
        for (let i = 0; i < n; i++) {
          // the first chaser is the slow one (and shown in the accent colour)
          const slow = i === 0;
          E.chasers.push({
            x: spots[i][0],
            y: spots[i][1],
            spd: slow ? 0.6 : 1,
            color: slow ? C.accent : TH.tint,
          });
        }
      }
      lives = E.players[0].lives;
    },
    update(dt) {
      const s = sf();
      const rad = 12;
      E.players.forEach((p) => {
        if (p.lives === 0) return;
        if (p.inv > 0) p.inv -= dt;
        let dx = 0, dy = 0;
        if (down(p.left)) dx -= 1;
        if (down(p.right)) dx += 1;
        if (down(p.up)) dy -= 1;
        if (down(p.down)) dy += 1;
        moveBlocked(p, dx * 2.4 * s * dt, 0, rad);
        moveBlocked(p, 0, dy * 2.4 * s * dt, rad);
        E.gems.forEach((g) => {
          if (!g.got && Math.abs(g.x - p.x) < 16 && Math.abs(g.y - p.y) < 16) {
            g.got = true;
            p.score += 5;
            Audio.pickup();
          }
        });
      });
      p1 = E.players[0].score;
      p2 = E.players[1] ? E.players[1].score : 0;
      score = p1;
      lives = E.players[0].lives;
      // chasers
      E.chasers.forEach((ch) => {
        const target = nearestPlayer(ch);
        if (target) {
          const sp = 1.5 * (ch.spd || 1) * s * dt;
          moveBlocked(ch, Math.sign(target.x - ch.x) * sp, 0, 12);
          moveBlocked(ch, 0, Math.sign(target.y - ch.y) * sp, 12);
        }
        // separation: keep chasers from stacking on the same spot
        E.chasers.forEach((other) => {
          if (other === ch) return;
          const dx = ch.x - other.x;
          const dy = ch.y - other.y;
          const d = Math.hypot(dx, dy);
          if (d > 0.001 && d < 26) {
            const push = (26 - d) * 0.4 * s * dt;
            moveBlocked(ch, (dx / d) * push, 0, 12);
            moveBlocked(ch, 0, (dy / d) * push, 12);
          }
        });
        E.players.forEach((p) => {
          if (p.lives !== 0 && p.inv <= 0 && Math.abs(p.x - ch.x) < 20 && Math.abs(p.y - ch.y) < 20) {
            if (p.lives > 0) {
              p.lives -= 1;
              p.inv = 90;
              p.x = p.sx; p.y = p.sy;
              Audio.hit();
              if (E.players.every((pp) => pp.lives === 0)) endGame("lose");
            }
          }
        });
      });
      // win when all gems collected
      if (E.gems.every((g) => g.got)) {
        if (cfg.players === 2) endGame(p1 === p2 ? "timeup" : p1 > p2 ? "p1" : "p2");
        else endGame("win");
      }
    },
    draw() {
      drawWorld();
      ctx.fillStyle = C.dim;
      E.walls.forEach((wl) => ctx.fillRect(wl.x, wl.y, wl.w, wl.h));
      ctx.fillStyle = C.accent;
      E.gems.forEach((g) => {
        if (!g.got) ctx.fillRect(g.x - 3, g.y - 3, 6, 6);
      });
      E.chasers.forEach((ch) => {
        ctx.fillStyle = ch.color || C.fg;
        ctx.beginPath();
        ctx.arc(ch.x, ch.y, 11, 0, Math.PI * 2);
        ctx.fill();
      });
      E.players.forEach((p) => {
        if (p.lives === 0) return;
        if (p.inv > 0 && (((p.inv / 6) | 0) % 2 === 0)) return;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 12, 0, Math.PI * 2);
        ctx.fill();
      });
    },
  };
  function moveBlocked(o, dx, dy, rad) {
    const nx = o.x + dx;
    const ny = o.y + dy;
    const box = { x: nx - rad, y: ny - rad, w: rad * 2, h: rad * 2 };
    const hit = E.walls.some((wl) => aabb(box.x, box.y, box.w, box.h, wl.x, wl.y, wl.w, wl.h));
    if (!hit) {
      o.x = nx;
      o.y = ny;
      return false;
    }
    return true;
  }
  function nearestPlayer(ch) {
    let best = null, bd = Infinity;
    E.players.forEach((p) => {
      if (p.lives === 0) return;
      const d = (p.x - ch.x) ** 2 + (p.y - ch.y) ** 2;
      if (d < bd) {
        bd = d;
        best = p;
      }
    });
    return best;
  }

  /* ===== DODGE ===== */
  ENGINES.dodge = {
    init() {
      E.players = [];
      E.players.push({ x: W / 2, lives: 3, inv: 0, left: "ArrowLeft", right: "ArrowRight", color: C.hi });
      if (cfg.players === 2) {
        E.players[0].left = "KeyA"; E.players[0].right = "KeyD";
        E.players[0].x = W * 0.35;
        E.players.push({ x: W * 0.65, lives: 3, inv: 0, left: "ArrowLeft", right: "ArrowRight", color: C.accent });
      }
      E.obs = [];
      E.spawn = 0;
      E.tick = 0;
      lives = E.players[0].lives;
    },
    update(dt) {
      const s = sf();
      const py = H - 30;
      E.players.forEach((p) => {
        if (p.lives === 0) return;
        if (p.inv > 0) p.inv -= dt;
        if (down(p.left)) p.x -= 4 * s * dt;
        if (down(p.right)) p.x += 4 * s * dt;
        p.x = clamp(p.x, 14, W - 14);
      });
      E.spawn -= dt;
      if (E.spawn <= 0) {
        const homing = cfg.enemies && Math.random() < 0.5;
        E.obs.push({ x: rnd(20, W - 20), y: -20, w: rnd(18, 40), vx: 0, homing });
        E.spawn = clamp(34 - E.tick * 0.02, 12, 40) / s;
      }
      E.tick += dt;
      E.obs.forEach((o) => {
        o.y += 3 * s * dt;
        if (o.homing) {
          const tgt = E.players.find((p) => p.lives !== 0);
          if (tgt) o.x += clamp(tgt.x - o.x, -1.2, 1.2) * s * dt;
        }
        E.players.forEach((p) => {
          if (p.lives !== 0 && p.inv <= 0 && aabb(o.x - o.w / 2, o.y - 8, o.w, 16, p.x - 12, py - 12, 24, 24)) {
            if (p.lives > 0) {
              p.lives -= 1;
              p.inv = 70;
              o.y = H + 100;
              Audio.hit();
              if (E.players.every((pp) => pp.lives === 0)) endGame("lose");
            }
          }
        });
      });
      E.obs = E.obs.filter((o) => o.y < H + 20);
      score += dt; // survival score
      const sc = Math.floor(score / 6);
      p1 = sc;
      p2 = sc;
      lives = E.players[0].lives;
      if (cfg.players === 2) {
        p1 = E.players[0].lives > 0 ? sc : Math.floor(score / 12);
        p2 = E.players[1].lives > 0 ? sc : Math.floor(score / 12);
      }
    },
    draw() {
      drawWorld();
      const py = H - 30;
      ctx.fillStyle = TH.tint;
      E.obs.forEach((o) => ctx.fillRect(o.x - o.w / 2, o.y - 8, o.w, 16));
      E.players.forEach((p) => {
        if (p.lives === 0) return;
        if (p.inv > 0 && (((p.inv / 6) | 0) % 2 === 0)) return;
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - 12, py - 12, 24, 24);
      });
    },
  };

  /* ===== PADDLE ===== */
  ENGINES.paddle = {
    init() {
      E.mode = cfg.players === 2 ? "pong" : cfg.enemies ? "pongcpu" : "breakout";
      if (E.mode === "breakout") {
        E.padX = W / 2;
        E.padW = 80;
        E.balls = 3;
        E.bx = W / 2;
        E.by = H - 60;
        E.vx = 3 * sf();
        E.vy = -3 * sf();
        E.bricks = [];
        for (let r = 0; r < 4; r++) {
          for (let c = 0; c < 10; c++) {
            E.bricks.push({ x: 24 + c * 60, y: 50 + r * 24, w: 52, h: 16, on: true });
          }
        }
        lives = E.balls;
      } else {
        E.padH = 72;
        E.lY = H / 2 - 36;
        E.rY = H / 2 - 36;
        E.bx = W / 2;
        E.by = H / 2;
        E.vx = (Math.random() < 0.5 ? -1 : 1) * 4 * sf();
        E.vy = rnd(-2, 2) * sf();
        lives = -1;
      }
    },
    update(dt) {
      const s = sf();
      if (E.mode === "breakout") {
        if (down("ArrowLeft") || down("KeyA")) E.padX -= 6 * s * dt;
        if (down("ArrowRight") || down("KeyD")) E.padX += 6 * s * dt;
        E.padX = clamp(E.padX, E.padW / 2, W - E.padW / 2);
        E.bx += E.vx * dt;
        E.by += E.vy * dt;
        if (E.bx < 8 || E.bx > W - 8) {
          E.vx *= -1;
          Audio.bounce();
        }
        if (E.by < 8) {
          E.vy *= -1;
          Audio.bounce();
        }
        if (E.by > H - 26 && E.by < H - 14 && Math.abs(E.bx - E.padX) < E.padW / 2 && E.vy > 0) {
          E.vy *= -1;
          E.vx += (E.bx - E.padX) * 0.05;
          Audio.bounce();
        }
        if (E.by > H) {
          E.balls -= 1;
          lives = E.balls;
          if (E.balls <= 0) {
            endGame("lose");
          } else {
            E.bx = W / 2;
            E.by = H - 60;
            E.vx = 3 * s;
            E.vy = -3 * s;
          }
        }
        E.bricks.forEach((b) => {
          if (b.on && aabb(E.bx - 5, E.by - 5, 10, 10, b.x, b.y, b.w, b.h)) {
            b.on = false;
            E.vy *= -1;
            score += 10;
            Audio.point();
          }
        });
        p1 = score;
        if (E.bricks.every((b) => !b.on)) endGame("win");
      } else {
        // pong / pong vs cpu
        if (down("KeyW")) E.lY -= 6 * s * dt;
        if (down("KeyS")) E.lY += 6 * s * dt;
        if (E.mode === "pongcpu") {
          if (down("ArrowUp")) E.lY -= 6 * s * dt;
          if (down("ArrowDown")) E.lY += 6 * s * dt;
          // CPU follows ball
          const target = E.by - E.padH / 2;
          E.rY += clamp(target - E.rY, -4.4 * s, 4.4 * s) * dt;
        } else {
          if (down("ArrowUp")) E.rY -= 6 * s * dt;
          if (down("ArrowDown")) E.rY += 6 * s * dt;
        }
        E.lY = clamp(E.lY, 8, H - E.padH - 8);
        E.rY = clamp(E.rY, 8, H - E.padH - 8);
        E.bx += E.vx * dt;
        E.by += E.vy * dt;
        if (E.by < 8 || E.by > H - 8) {
          E.vy *= -1;
          Audio.bounce();
        }
        if (E.vx < 0 && E.bx < 36 && E.by > E.lY && E.by < E.lY + E.padH) {
          E.vx = Math.abs(E.vx) * 1.04;
          E.vy += ((E.by - (E.lY + E.padH / 2)) / (E.padH / 2)) * 2;
          Audio.bounce();
        }
        if (E.vx > 0 && E.bx > W - 36 && E.by > E.rY && E.by < E.rY + E.padH) {
          E.vx = -Math.abs(E.vx) * 1.04;
          E.vy += ((E.by - (E.rY + E.padH / 2)) / (E.padH / 2)) * 2;
          Audio.bounce();
        }
        E.vx = clamp(E.vx, -9, 9);
        E.vy = clamp(E.vy, -7, 7);
        if (E.bx < 0) {
          p2 += 1;
          Audio.point();
          resetPong(1);
        } else if (E.bx > W) {
          p1 += 1;
          Audio.point();
          resetPong(-1);
        }
        score = p1;
        if (p1 >= 7) endGame(cfg.players === 2 ? "p1" : "win");
        else if (p2 >= 7) endGame(cfg.players === 2 ? "p2" : "lose");
      }
    },
    draw() {
      drawWorld();
      if (E.mode === "breakout") {
        E.bricks.forEach((b) => {
          if (!b.on) return;
          ctx.fillStyle = TH.tint;
          ctx.fillRect(b.x, b.y, b.w, b.h);
          ctx.strokeStyle = "rgba(0,0,0,0.45)";
          ctx.strokeRect(b.x, b.y, b.w, b.h);
        });
        ctx.fillStyle = C.hi;
        ctx.fillRect(E.padX - E.padW / 2, H - 18, E.padW, 10);
        ctx.fillStyle = C.accent;
        ctx.fillRect(E.bx - 5, E.by - 5, 10, 10);
      } else {
        ctx.strokeStyle = C.dim;
        ctx.setLineDash([12, 12]);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(W / 2, 0);
        ctx.lineTo(W / 2, H);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = C.fg;
        ctx.fillRect(24, E.lY, 12, E.padH);
        ctx.fillStyle = E.mode === "pongcpu" ? C.accent : C.hi;
        ctx.fillRect(W - 36, E.rY, 12, E.padH);
        ctx.fillStyle = C.hi;
        ctx.fillRect(E.bx - 5, E.by - 5, 10, 10);
      }
    },
  };
  function resetPong(dir) {
    E.bx = W / 2;
    E.by = H / 2;
    E.vx = dir * 4 * sf();
    E.vy = rnd(-2, 2) * sf();
  }

  /* ---------- lifecycle ---------- */
  function loseLife() {
    if (lives < 0) return;
    lives -= 1;
    Audio.hit();
    if (lives <= 0) endGame("lose");
  }

  function endGame(result) {
    if (ended) return;
    ended = true;
    outcome = result;
    endHold = END_HOLD;
    if (result === "win" || result === "p1" || result === "p2") Audio.win();
    else if (result === "lose") Audio.lose();
    else Audio.point();
    const L = lang;
    let msg = L.resultTimeUp;
    if (result === "win") msg = L.resultWin;
    else if (result === "lose") msg = L.resultLose;
    else if (result === "p1") msg = L.resultP1Win;
    else if (result === "p2") msg = L.resultP2Win;
    els.gameMsg.textContent = msg;
    els.gameMsg.classList.remove("hidden");
  }

  function finish() {
    running = false;
    cancelAnimationFrame(raf);
    const res = { outcome, score: Math.floor(score), p1: Math.floor(p1), p2: Math.floor(p2), players: cfg.players };
    if (onEnd) onEnd(res);
  }

  function loop(ts) {
    if (!running) return;
    let dt = (ts - last) / 16.6667;
    last = ts;
    if (dt > 3) dt = 3;
    if (!ended) {
      engine.update(dt);
      if (!ended && timeLeftMs() <= 0) endGame("timeup");
    }
    engine.draw();
    updateStatus();
    if (ended) {
      endHold -= dt;
      if (endHold <= 0) {
        finish();
        return;
      }
    }
    raf = requestAnimationFrame(loop);
  }

  /* ---------- public API ---------- */
  function init(refs) {
    canvas = refs.canvas;
    ctx = canvas.getContext("2d");
    stage = refs.stage;
    els = refs;
    window.addEventListener("keydown", (e) => {
      keys[e.code] = true;
      if (running && (e.code === "Space" || e.code.startsWith("Arrow"))) e.preventDefault();
    });
    window.addEventListener("keyup", (e) => {
      keys[e.code] = false;
    });
    window.addEventListener("resize", fit);
    if (typeof ResizeObserver !== "undefined" && stage) {
      new ResizeObserver(fit).observe(stage);
    }
  }

  function start(config, langStrings, endCb) {
    cfg = config;
    lang = langStrings;
    onEnd = endCb;
    C = PALETTES[config.palette] || PALETTES.blue;
    TH = THEMES[config.theme] || THEMES.space;
    engine = ENGINES[config.genre] || ENGINES.paddle;
    score = 0;
    p1 = 0;
    p2 = 0;
    lives = -1;
    ended = false;
    outcome = null;
    E = {};
    for (const k in keys) keys[k] = false;
    engine.init();
    buildHint();
    els.gameMsg.classList.add("hidden");
    Audio.resume();
    Audio.start();
    running = true;
    last = performance.now();
    roundEndAt = performance.now() + ROUND_MS;
    fit();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(loop);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(raf);
  }

  /** End the current game early (e.g. player pressed ESC) and report the live score. */
  function quit() {
    if (!running) return;
    if (!ended) {
      ended = true;
      outcome = "quit";
    }
    finish();
  }

  /** Inject a virtual key state (used by the on-screen mobile touch controls). */
  function setKey(code, isDown) {
    keys[code] = !!isDown;
  }

  function clearKeys() {
    for (const k in keys) keys[k] = false;
  }

  return { init, start, stop, quit, setKey, clearKeys, fit, palettes: PALETTES };
})();
