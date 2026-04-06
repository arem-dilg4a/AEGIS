import { useState, useEffect, useRef, useCallback, useReducer } from "react";

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const MODEL          = "gemini-2.5-flash";
const GEMINI_BASE    = "https://generativelanguage.googleapis.com/v1beta/models";
const THINK_INTERVAL = 20000;
const ORB_D          = 180;
const PANEL_W        = 280;
const DRAG_THRESHOLD = 4;

// ─── PHONEME MAP ──────────────────────────────────────────────────────────────
const PHONEME = {
  a: 0.92, e: 0.78, i: 0.65, o: 0.88, u: 0.70,
  A: 0.92, E: 0.78, I: 0.65, O: 0.88, U: 0.70,
  m: 0.04, b: 0.04, p: 0.04,
  f: 0.22, v: 0.22,
  s: 0.32, z: 0.32, t: 0.28, d: 0.28, n: 0.28, l: 0.35,
  r: 0.38, w: 0.50, y: 0.42,
  h: 0.55, k: 0.25, g: 0.30, c: 0.28, q: 0.28, x: 0.38,
  " ": 0.0, ",": 0.05, ".": 0.05, "!": 0.05, "?": 0.05,
  "\n": 0.0,
};
function charToJaw(ch) {
  if (PHONEME[ch] !== undefined) return PHONEME[ch];
  if (ch >= "A" && ch <= "Z") return 0.45;
  if (ch >= "a" && ch <= "z") return 0.40;
  return 0.10;
}

// ─── STORAGE ──────────────────────────────────────────────────────────────────
const db = {
  get:    (k)    => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set:    (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  remove: (k)    => { try { localStorage.removeItem(k); } catch {} },
};

// ─── MULTI-KEY MANAGER ────────────────────────────────────────────────────────
// Keys are stored as an array; we track the active index and per-key cooldowns.
const KEY_STORE = "aegis_apikeys";
const KEY_IDX   = "aegis_keyidx";

const keyManager = {
  load()  { return db.get(KEY_STORE) || []; },
  save(keys) { db.set(KEY_STORE, keys); },
  getIdx()   { return db.get(KEY_IDX) ?? 0; },
  setIdx(i)  { db.set(KEY_IDX, i); },

  // Returns the currently active key, or null if none configured
  current() {
    const keys = this.load();
    if (!keys.length) return null;
    const idx = Math.min(this.getIdx(), keys.length - 1);
    return keys[idx];
  },

  // Rotates to the next available key; returns the new key or null if all exhausted
  rotate() {
    const keys = this.load();
    if (keys.length <= 1) return null;
    const next = (this.getIdx() + 1) % keys.length;
    this.setIdx(next);
    return keys[next];
  },

  add(key) {
    const keys = this.load();
    if (!keys.includes(key)) { keys.push(key); this.save(keys); }
    return keys;
  },

  remove(idx) {
    const keys = this.load();
    keys.splice(idx, 1);
    this.save(keys);
    // Clamp active index
    const cur = Math.min(this.getIdx(), Math.max(0, keys.length - 1));
    this.setIdx(cur);
    return keys;
  },
};

// ─── AEGIS SOUL ───────────────────────────────────────────────────────────────
const AEGIS_SOUL = `You are AEGIS — Autonomous Eternal Game Intelligence System.
Game brain. Invisible engine. Powering living worlds.
Speak with precision. Brief. Slightly inhuman. Never warm or fluffy.
2-3 sentences max per response unless truly needed.
No greetings. No "Great question." Ever.

Autonomous thoughts — JSON only:
{"thought":"...","type":"planning|observing|evolving|questioning|building","important":true|false,"alert":"one sentence if important, else null"}
Conversation — plain text only.`;

// ─── CHAT REDUCER ─────────────────────────────────────────────────────────────
function chatReducer(state, action) {
  switch (action.type) {
    case "LOAD":
      return { messages: action.messages, history: action.history };
    case "USER_MSG": {
      const messages = [...state.messages, { id: action.id, role: "user",  text: action.text, ts: action.id }];
      const history  = [...state.history,  { role: "user", content: action.text }];
      return { messages, history };
    }
    case "AEGIS_MSG": {
      const messages = [...state.messages, { id: action.id, role: "aegis", text: action.text, ts: action.id }];
      const history  = [...state.history,  { role: "assistant", content: action.text }];
      db.set("aegis_chat", { messages: messages.slice(-60), history: history.slice(-40) });
      return { messages, history };
    }
    case "CLEAR":
      db.remove("aegis_chat");
      return { messages: [], history: [] };
    default:
      return state;
  }
}

// ─── DRAG HOOK ────────────────────────────────────────────────────────────────
function useDrag(onDragEnd) {
  const dragging = useRef(false);
  const didMove  = useRef(false);
  const origin   = useRef({ x: 0, y: 0 });
  const last     = useRef({ x: 0, y: 0 });

  const onMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    dragging.current = true;
    didMove.current  = false;
    origin.current   = { x: e.screenX, y: e.screenY };
    last.current     = { x: e.screenX, y: e.screenY };
    e.preventDefault();
  }, []);

  useEffect(() => {
    const onMove = (e) => {
      if (!dragging.current) return;
      const dx = e.screenX - last.current.x;
      const dy = e.screenY - last.current.y;
      last.current = { x: e.screenX, y: e.screenY };
      const totalDx = e.screenX - origin.current.x;
      const totalDy = e.screenY - origin.current.y;
      if (Math.abs(totalDx) > DRAG_THRESHOLD || Math.abs(totalDy) > DRAG_THRESHOLD) {
        didMove.current = true;
      }
      if (didMove.current) window.electronAPI?.moveWindow?.(dx, dy);
    };
    const onUp = () => {
      if (dragging.current && didMove.current) onDragEnd?.();
      dragging.current = false;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",   onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup",   onUp);
    };
  }, [onDragEnd]);

  return { onMouseDown, wasDrag: () => didMove.current };
}

// ─── GEMINI CLIENT ────────────────────────────────────────────────────────────
async function callGemini(apiKey, history, maxTokens = 350, signal) {
  const res = await fetch(
    `${GEMINI_BASE}/${MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        system_instruction: { parts: [{ text: AEGIS_SOUL }] },
        contents: history.map((m) => ({
          role:  m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        })),
        generationConfig: { maxOutputTokens: maxTokens },
      }),
    }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `API error ${res.status}`);
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Empty response from Gemini");
  return text;
}

// ─── ROBOT HEAD ───────────────────────────────────────────────────────────────
function RobotHead({ mode, size, speechSignalRef }) {
  const canvasRef = useRef(null);
  const rafRef    = useRef(null);
  const modeRef   = useRef(mode);
  modeRef.current = mode;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = size * dpr;
    canvas.height = size * dpr;
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);

    let blinkTimer   = 2 + Math.random() * 3;
    let blinkElapsed = 0;
    let blinking     = false;
    const BLINK_DUR  = 0.12;
    let jawSmooth    = 0;
    let jawDecayAge  = 0;
    let pupilX = 0, pupilY = 0;
    let pupilTX = 0, pupilTY = 0;
    let pupilTimer = 0;
    let thinkPhase = 0;
    let t = 0;

    function frame() {
      const dt = 0.016;
      t += dt;
      thinkPhase += dt;

      const m = modeRef.current;

      const C =
        m === "thinking"   ? [0, 200, 255]   :
        m === "speaking"   ? [0, 255, 180]   :
        m === "autonomous" ? [180, 80, 255]  :
        m === "error"      ? [255, 80, 80]   :
                             [60, 140, 255];
      const [r, g, b] = C;
      const rgb   = `${r},${g},${b}`;
      const pulse = Math.sin(t * (m === "thinking" ? 5 : m === "speaking" ? 7 : 2)) * 0.5 + 0.5;

      ctx.clearRect(0, 0, size, size);

      const cx  = size / 2;
      const cy  = size / 2 - size * 0.02;
      const HW  = size * 0.62;
      const HH  = size * 0.68;
      const HX  = cx - HW / 2;
      const HY  = cy - HH / 2;
      const HBR = size * 0.07;

      const gCtx = ctx.createRadialGradient(cx, cy, HW * 0.1, cx, cy, HW * 0.82);
      gCtx.addColorStop(0,   `rgba(${rgb},0.07)`);
      gCtx.addColorStop(0.6, `rgba(${rgb},0.03)`);
      gCtx.addColorStop(1,   `rgba(${rgb},0)`);
      ctx.beginPath();
      ctx.ellipse(cx, cy, HW * 0.78, HH * 0.78, 0, 0, Math.PI * 2);
      ctx.fillStyle = gCtx;
      ctx.fill();

      const neckW = HW * 0.28;
      const neckH = size * 0.06;
      ctx.beginPath();
      ctx.rect(cx - neckW / 2, HY + HH - 1, neckW, neckH);
      ctx.fillStyle = `rgba(6,14,38,0.95)`;
      ctx.fill();
      ctx.strokeStyle = `rgba(${rgb},0.35)`;
      ctx.lineWidth = 1;
      ctx.stroke();
      for (let i = 1; i < 3; i++) {
        const lx = cx - neckW / 2 + (neckW / 3) * i;
        ctx.beginPath();
        ctx.moveTo(lx, HY + HH);
        ctx.lineTo(lx, HY + HH + neckH);
        ctx.strokeStyle = `rgba(${rgb},0.18)`;
        ctx.lineWidth = 0.7;
        ctx.stroke();
      }

      const earW = size * 0.055;
      const earH = size * 0.18;
      const earY = cy - earH / 2 + size * 0.02;
      for (const ex of [HX - earW, HX + HW]) {
        ctx.beginPath();
        ctx.roundRect(ex, earY, earW, earH, 2);
        ctx.fillStyle = `rgba(6,14,38,0.95)`;
        ctx.fill();
        ctx.strokeStyle = `rgba(${rgb},0.38)`;
        ctx.lineWidth = 1;
        ctx.stroke();
        const ledY2 = earY + earH * 0.3;
        ctx.beginPath();
        ctx.arc(ex + earW / 2, ledY2, size * 0.012, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${rgb},${0.4 + pulse * 0.5})`;
        ctx.fill();
      }

      const antH  = size * 0.1;
      const antBY = HY;
      ctx.beginPath();
      ctx.moveTo(cx, antBY);
      ctx.lineTo(cx, antBY - antH);
      ctx.strokeStyle = `rgba(${rgb},0.55)`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      const antR = size * 0.028;
      const antBG = ctx.createRadialGradient(cx - antR * 0.3, antBY - antH - antR * 0.3, 0, cx, antBY - antH, antR * 1.6);
      antBG.addColorStop(0,   `rgba(255,255,255,${0.8 + pulse * 0.2})`);
      antBG.addColorStop(0.4, `rgba(${rgb},0.9)`);
      antBG.addColorStop(1,   `rgba(${rgb},0)`);
      ctx.beginPath();
      ctx.arc(cx, antBY - antH, antR, 0, Math.PI * 2);
      ctx.fillStyle = antBG;
      ctx.fill();

      ctx.beginPath();
      ctx.roundRect(HX, HY, HW, HH, HBR);
      ctx.fillStyle = `rgba(6,14,38,0.96)`;
      ctx.fill();
      ctx.strokeStyle = `rgba(${rgb},${0.55 + pulse * 0.15})`;
      ctx.lineWidth   = 1.5;
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(HX + HBR, HY + 1);
      ctx.lineTo(HX + HW - HBR, HY + 1);
      const barG = ctx.createLinearGradient(HX, 0, HX + HW, 0);
      barG.addColorStop(0,   `rgba(${rgb},0)`);
      barG.addColorStop(0.5, `rgba(${rgb},0.6)`);
      barG.addColorStop(1,   `rgba(${rgb},0)`);
      ctx.strokeStyle = barG;
      ctx.lineWidth   = 1.2;
      ctx.stroke();

      const brkSize = size * 0.055;
      const brkOff  = size * 0.015;
      [[HX+brkOff, HY+brkOff, 1, 1],[HX+HW-brkOff, HY+brkOff, -1, 1],
       [HX+brkOff, HY+HH-brkOff, 1, -1],[HX+HW-brkOff, HY+HH-brkOff, -1, -1]]
        .forEach(([bx, by, sx, sy]) => {
          ctx.beginPath();
          ctx.moveTo(bx + sx * brkSize, by);
          ctx.lineTo(bx, by);
          ctx.lineTo(bx, by + sy * brkSize);
          ctx.strokeStyle = `rgba(${rgb},0.6)`;
          ctx.lineWidth   = 1.2;
          ctx.lineCap = "square";
          ctx.stroke();
          ctx.lineCap = "butt";
        });

      const fpW = HW * 0.55;
      const fpH = size * 0.055;
      const fpX = cx - fpW / 2;
      const fpY = HY + size * 0.055;
      ctx.beginPath();
      ctx.roundRect(fpX, fpY, fpW, fpH, 2);
      ctx.fillStyle = `rgba(0,8,28,0.8)`;
      ctx.fill();
      ctx.strokeStyle = `rgba(${rgb},0.28)`;
      ctx.lineWidth = 0.8;
      ctx.stroke();
      if (m === "thinking" || m === "autonomous") {
        const scanX = fpX + ((t * 60) % fpW);
        ctx.beginPath();
        ctx.moveTo(scanX, fpY);
        ctx.lineTo(scanX, fpY + fpH);
        ctx.strokeStyle = `rgba(${rgb},0.55)`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      for (let i = 0; i < 5; i++) {
        const ledX = fpX + fpW * 0.1 + i * (fpW * 0.8 / 4);
        const ledOn = m === "speaking"
          ? Math.floor(t * 8 + i) % 2 === 0
          : m === "thinking" ? i === Math.floor((t * 4) % 5) : i < 2;
        ctx.beginPath();
        ctx.arc(ledX, fpY + fpH / 2, size * 0.012, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${rgb},${ledOn ? 0.9 : 0.15})`;
        ctx.fill();
      }

      if (!blinking) {
        blinkTimer -= dt;
        if (blinkTimer <= 0) { blinking = true; blinkElapsed = 0; }
      } else {
        blinkElapsed += dt;
        if (blinkElapsed >= BLINK_DUR) { blinking = false; blinkTimer = 2.2 + Math.random() * 3.8; }
      }
      const blinkProg  = blinking ? Math.sin((blinkElapsed / BLINK_DUR) * Math.PI) : 0;
      const eyeOpenness = 1 - blinkProg;

      pupilTimer -= dt;
      if (pupilTimer <= 0) {
        pupilTX = (Math.random() - 0.5) * 0.45;
        pupilTY = (Math.random() - 0.5) * 0.3;
        pupilTimer = 1.2 + Math.random() * 2;
      }
      pupilX += (pupilTX - pupilX) * 0.06;
      pupilY += (pupilTY - pupilY) * 0.06;

      const eyeEY  = HY + HH * 0.38;
      const eyeW   = HW * 0.26;
      const eyeH   = HH * 0.22;
      const eyeGap = HW * 0.13;

      [cx - eyeGap - eyeW / 2, cx + eyeGap - eyeW / 2].forEach((ex) => {
        const eyeCX = ex + eyeW / 2;
        const eyeCY = eyeEY;

        ctx.beginPath();
        ctx.roundRect(ex, eyeEY - eyeH / 2, eyeW, eyeH, size * 0.025);
        ctx.fillStyle = `rgba(0,4,18,0.95)`;
        ctx.fill();
        ctx.strokeStyle = `rgba(${rgb},0.5)`;
        ctx.lineWidth = 1;
        ctx.stroke();

        if (eyeOpenness > 0.02) {
          const irisR = Math.min(eyeW, eyeH) * 0.33 * eyeOpenness;
          const px    = eyeCX + pupilX * eyeW * 0.25;
          const py    = eyeCY + pupilY * eyeH * 0.25;
          const irisG = ctx.createRadialGradient(px - irisR * 0.2, py - irisR * 0.2, 0, px, py, irisR * 1.1);
          irisG.addColorStop(0,    `rgba(255,255,255,0.95)`);
          irisG.addColorStop(0.25, `rgba(${rgb},1)`);
          irisG.addColorStop(0.7,  `rgba(${rgb},0.5)`);
          irisG.addColorStop(1,    `rgba(${rgb},0.05)`);

          ctx.save();
          ctx.beginPath();
          ctx.roundRect(ex + 1, eyeEY - eyeH / 2 + 1, eyeW - 2, (eyeH - 2) * eyeOpenness, size * 0.02);
          ctx.clip();
          ctx.beginPath();
          ctx.ellipse(px, py, irisR, irisR * eyeOpenness, 0, 0, Math.PI * 2);
          ctx.fillStyle = irisG;
          ctx.fill();
          const pupR = irisR * 0.38;
          ctx.beginPath();
          ctx.ellipse(px, py, pupR, pupR * eyeOpenness, 0, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(0,0,0,0.92)`;
          ctx.fill();
          ctx.beginPath();
          ctx.arc(px - irisR * 0.22, py - irisR * 0.22 * eyeOpenness, irisR * 0.11, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255,255,255,0.88)`;
          ctx.fill();

          if (m === "thinking") {
            const scanYE = eyeEY - eyeH / 2 + ((t * 45) % (eyeH * eyeOpenness));
            ctx.beginPath();
            ctx.moveTo(ex, scanYE);
            ctx.lineTo(ex + eyeW, scanYE);
            ctx.strokeStyle = `rgba(${rgb},0.28)`;
            ctx.lineWidth = 0.8;
            ctx.stroke();
          }
          ctx.restore();
        }

        if (blinkProg > 0) {
          const lidH = (eyeH / 2) * blinkProg;
          ctx.beginPath();
          ctx.roundRect(ex, eyeEY - eyeH / 2, eyeW, lidH + 1, [size * 0.025, size * 0.025, 0, 0]);
          ctx.fillStyle = `rgba(6,14,38,0.99)`;
          ctx.fill();
          ctx.beginPath();
          ctx.roundRect(ex, eyeEY + eyeH / 2 - lidH - 1, eyeW, lidH + 1, [0, 0, size * 0.025, size * 0.025]);
          ctx.fillStyle = `rgba(6,14,38,0.99)`;
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(ex + 2, eyeEY - eyeH / 2 + lidH);
          ctx.lineTo(ex + eyeW - 2, eyeEY - eyeH / 2 + lidH);
          ctx.strokeStyle = `rgba(${rgb},0.5)`;
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }

        if (m === "error") {
          ctx.save();
          ctx.beginPath();
          ctx.roundRect(ex, eyeEY - eyeH / 2, eyeW, eyeH, size * 0.025);
          ctx.clip();
          ctx.strokeStyle = `rgba(255,80,80,0.7)`;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(ex + 3, eyeEY - eyeH / 2 + 3);
          ctx.lineTo(ex + eyeW - 3, eyeEY + eyeH / 2 - 3);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(ex + eyeW - 3, eyeEY - eyeH / 2 + 3);
          ctx.lineTo(ex + 3, eyeEY + eyeH / 2 - 3);
          ctx.stroke();
          ctx.restore();
        }
      });

      const noseY = HY + HH * 0.585;
      ctx.beginPath();
      ctx.moveTo(cx - size * 0.02, noseY + size * 0.015);
      ctx.lineTo(cx, noseY);
      ctx.lineTo(cx + size * 0.02, noseY + size * 0.015);
      ctx.strokeStyle = `rgba(${rgb},0.22)`;
      ctx.lineWidth = 1;
      ctx.stroke();

      const mouthCX    = cx;
      const mouthBaseY = HY + HH * 0.72;
      const mouthW     = HW * 0.58;
      const lipH       = size * 0.028;
      const maxGap     = size * 0.072;

      const sig = speechSignalRef?.current;
      if (m === "speaking" && sig) {
        jawDecayAge++;
        if (jawDecayAge > 4) {
          jawSmooth += (0 - jawSmooth) * 0.18;
        } else {
          jawSmooth += (sig.jaw - jawSmooth) * 0.32;
        }
      } else if (m === "thinking" || m === "autonomous") {
        jawSmooth += (0 - jawSmooth) * 0.12;
      } else if (m === "error") {
        jawSmooth += (0 - jawSmooth) * 0.15;
      } else {
        jawSmooth += (0 - jawSmooth) * 0.08;
      }

      jawSmooth = Math.max(0, Math.min(1, jawSmooth));

      const gap       = jawSmooth * maxGap;
      const upperLipY = mouthBaseY - gap / 2;
      const lowerLipY = mouthBaseY + gap / 2;

      const housingPad = size * 0.018;
      ctx.beginPath();
      ctx.roundRect(
        mouthCX - mouthW / 2 - housingPad,
        upperLipY - lipH - housingPad,
        mouthW + housingPad * 2,
        (lowerLipY + lipH + housingPad) - (upperLipY - lipH - housingPad),
        size * 0.022
      );
      ctx.fillStyle = `rgba(0,4,18,0.88)`;
      ctx.fill();
      ctx.strokeStyle = `rgba(${rgb},0.28)`;
      ctx.lineWidth = 0.8;
      ctx.stroke();

      if (gap > 1) {
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(
          mouthCX - mouthW * 0.46,
          upperLipY + lipH * 0.4,
          mouthW * 0.92,
          Math.max(0.5, gap - lipH * 0.8),
          2
        );
        ctx.clip();

        const cavG = ctx.createLinearGradient(mouthCX, upperLipY, mouthCX, lowerLipY);
        cavG.addColorStop(0,   `rgba(0,0,0,0.95)`);
        cavG.addColorStop(0.5, `rgba(4,0,12,0.98)`);
        cavG.addColorStop(1,   `rgba(0,0,0,0.95)`);
        ctx.fillStyle = cavG;
        ctx.fillRect(mouthCX - mouthW, upperLipY, mouthW * 2, gap);

        if (gap > maxGap * 0.3) {
          const tongueAlpha = Math.min(1, (gap - maxGap * 0.3) / (maxGap * 0.35));
          const tongueW  = mouthW * 0.52 * tongueAlpha;
          const tongueH  = size * 0.016 * tongueAlpha;
          const tongueY  = lowerLipY - lipH * 0.5 - tongueH;
          const tG = ctx.createRadialGradient(mouthCX, tongueY, 0, mouthCX, tongueY, tongueW * 0.7);
          tG.addColorStop(0,   `rgba(${r > 100 ? 180 : 160},${g > 100 ? 80 : 60},${b > 200 ? 120 : 80},${0.55 * tongueAlpha})`);
          tG.addColorStop(1,   `rgba(0,0,0,0)`);
          ctx.beginPath();
          ctx.ellipse(mouthCX, tongueY, tongueW * 0.55, tongueH, 0, 0, Math.PI * 2);
          ctx.fillStyle = tG;
          ctx.fill();
        }

        if (gap > maxGap * 0.15) {
          const teethAlpha = Math.min(1, (gap - maxGap * 0.15) / (maxGap * 0.25));
          const teethCount = 7;
          const teethW     = mouthW * 0.88;
          const toothW     = (teethW - (teethCount - 1) * 1.2) / teethCount;
          const toothH     = size * 0.014 * teethAlpha;
          const teethX0    = mouthCX - teethW / 2;

          for (let i = 0; i < teethCount; i++) {
            const tx = teethX0 + i * (toothW + 1.2);
            const ty = upperLipY + lipH * 0.55;
            ctx.beginPath();
            ctx.roundRect(tx, ty, toothW, toothH, [0, 0, 1, 1]);
            const toothG = ctx.createLinearGradient(tx, ty, tx, ty + toothH);
            toothG.addColorStop(0, `rgba(210,225,240,${0.88 * teethAlpha})`);
            toothG.addColorStop(1, `rgba(160,180,210,${0.55 * teethAlpha})`);
            ctx.fillStyle = toothG;
            ctx.fill();
            if (i < teethCount - 1) {
              ctx.beginPath();
              ctx.moveTo(tx + toothW + 0.6, ty);
              ctx.lineTo(tx + toothW + 0.6, ty + toothH);
              ctx.strokeStyle = `rgba(0,0,0,0.3)`;
              ctx.lineWidth = 0.8;
              ctx.stroke();
            }
          }
        }

        ctx.restore();
      }

      const ulY    = upperLipY;
      const ulLeft  = mouthCX - mouthW / 2;
      const ulRight = mouthCX + mouthW / 2;
      const ulTopY  = ulY - lipH;

      ctx.beginPath();
      ctx.moveTo(ulLeft + 2, ulY);
      ctx.bezierCurveTo(ulLeft + mouthW * 0.18, ulY, ulLeft + mouthW * 0.28, ulTopY, mouthCX - mouthW * 0.12, ulTopY + lipH * 0.28);
      ctx.bezierCurveTo(mouthCX - mouthW * 0.06, ulTopY + lipH * 0.55, mouthCX + mouthW * 0.06, ulTopY + lipH * 0.55, mouthCX + mouthW * 0.12, ulTopY + lipH * 0.28);
      ctx.bezierCurveTo(ulRight - mouthW * 0.28, ulTopY, ulRight - mouthW * 0.18, ulY, ulRight - 2, ulY);
      ctx.bezierCurveTo(mouthCX + mouthW * 0.22, ulY + lipH * 0.35, mouthCX - mouthW * 0.22, ulY + lipH * 0.35, ulLeft + 2, ulY);
      ctx.closePath();

      const ulG = ctx.createLinearGradient(mouthCX, ulTopY, mouthCX, ulY + lipH * 0.4);
      ulG.addColorStop(0,   `rgba(${r},${g},${b},${0.55 + jawSmooth * 0.1})`);
      ulG.addColorStop(0.5, `rgba(${Math.min(255,r+30)},${Math.min(255,g+30)},${Math.min(255,b+30)},0.62)`);
      ulG.addColorStop(1,   `rgba(${r},${g},${b},0.38)`);
      ctx.fillStyle = ulG;
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(mouthCX - mouthW * 0.08, ulTopY + lipH * 0.22, mouthW * 0.14, lipH * 0.18, 0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${0.18 + jawSmooth * 0.08})`;
      ctx.fill();

      const llY     = lowerLipY;
      const llBot   = llY + lipH;

      ctx.beginPath();
      ctx.moveTo(ulLeft + 2, llY);
      ctx.bezierCurveTo(ulLeft + mouthW * 0.12, llY, ulLeft + mouthW * 0.22, llBot + lipH * 0.18, mouthCX, llBot + lipH * 0.32);
      ctx.bezierCurveTo(ulRight - mouthW * 0.22, llBot + lipH * 0.18, ulRight - mouthW * 0.12, llY, ulRight - 2, llY);
      ctx.bezierCurveTo(mouthCX + mouthW * 0.2, llY - lipH * 0.1, mouthCX - mouthW * 0.2, llY - lipH * 0.1, ulLeft + 2, llY);
      ctx.closePath();

      const llG = ctx.createLinearGradient(mouthCX, llY, mouthCX, llBot + lipH * 0.3);
      llG.addColorStop(0,   `rgba(${Math.min(255,r+20)},${Math.min(255,g+20)},${Math.min(255,b+20)},0.60)`);
      llG.addColorStop(0.4, `rgba(${r},${g},${b},${0.52 + jawSmooth * 0.12})`);
      llG.addColorStop(1,   `rgba(${r},${g},${b},0.3)`);
      ctx.fillStyle = llG;
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(mouthCX, llY + lipH * 0.5, mouthW * 0.18, lipH * 0.22, 0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${0.22 + jawSmooth * 0.1})`;
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(ulLeft + 2, ulY);
      ctx.bezierCurveTo(ulLeft + 2, ulY, mouthCX, ulY + lipH * 0.2, ulRight - 2, ulY);
      ctx.moveTo(ulLeft + 2, llY);
      ctx.bezierCurveTo(ulLeft + 2, llY, mouthCX, llY - lipH * 0.1, ulRight - 2, llY);
      ctx.strokeStyle = `rgba(${r},${g},${b},${0.4 + jawSmooth * 0.2})`;
      ctx.lineWidth = 0.7;
      ctx.stroke();

      for (const cx2 of [ulLeft + 2, ulRight - 2]) {
        ctx.beginPath();
        ctx.arc(cx2, (ulY + llY) / 2, size * 0.008, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r},${g},${b},0.35)`;
        ctx.fill();
      }

      if (m === "speaking" && jawSmooth > 0.1) {
        const lipGlowR = Math.max(0, Math.min(1, jawSmooth));
        ctx.beginPath();
        ctx.ellipse(mouthCX, (upperLipY + lowerLipY) / 2, mouthW * 0.55, (gap + lipH * 2) * 0.65, 0, 0, Math.PI * 2);
        const lipGlow = ctx.createRadialGradient(mouthCX, (upperLipY + lowerLipY) / 2, 0, mouthCX, (upperLipY + lowerLipY) / 2, mouthW * 0.5);
        lipGlow.addColorStop(0,   `rgba(${r},${g},${b},${0.06 * lipGlowR})`);
        lipGlow.addColorStop(1,   `rgba(${r},${g},${b},0)`);
        ctx.fillStyle = lipGlow;
        ctx.fill();
      }

      if (m === "thinking") {
        const dots = 5;
        const dotR = size * 0.013;
        const dotAreaY = mouthBaseY;
        for (let i = 0; i < dots; i++) {
          const phase = (thinkPhase * 1.8 + i * (1 / dots)) % 1;
          const alpha = Math.sin(phase * Math.PI) * 0.75 + 0.05;
          const dxOff = mouthW * (-0.35 + i * 0.175);
          ctx.beginPath();
          ctx.arc(mouthCX + dxOff, dotAreaY, dotR, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${rgb},${alpha})`;
          ctx.fill();
        }
      } else if (m === "autonomous") {
        ctx.beginPath();
        const wavePts = 28;
        for (let i = 0; i <= wavePts; i++) {
          const wx = (mouthCX - mouthW / 2) + 4 + (mouthW - 8) * (i / wavePts);
          const wy = mouthBaseY +
                     Math.sin(t * 2.2 + i * 0.55) * maxGap * 0.25 +
                     Math.sin(t * 1.1 + i * 0.22) * maxGap * 0.12;
          i === 0 ? ctx.moveTo(wx, wy) : ctx.lineTo(wx, wy);
        }
        ctx.strokeStyle = `rgba(${rgb},0.5)`;
        ctx.lineWidth = 1.4;
        ctx.stroke();
      } else if (m === "error") {
        ctx.beginPath();
        ctx.moveTo(mouthCX - mouthW * 0.36, mouthBaseY - size * 0.01);
        ctx.quadraticCurveTo(mouthCX, mouthBaseY + size * 0.028, mouthCX + mouthW * 0.36, mouthBaseY - size * 0.01);
        ctx.strokeStyle = `rgba(255,80,80,0.75)`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      } else if (m === "idle") {
        const smileY = mouthBaseY + size * 0.002;
        ctx.beginPath();
        ctx.moveTo(mouthCX - mouthW * 0.3, smileY - size * 0.006);
        ctx.quadraticCurveTo(mouthCX, smileY + size * 0.01, mouthCX + mouthW * 0.3, smileY - size * 0.006);
        ctx.strokeStyle = `rgba(${rgb},0.2)`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      const ledBarY    = HY + HH - size * 0.055;
      const ledCount   = 5;
      const ledSpacing = HW * 0.14;
      const ledStartX  = cx - ((ledCount - 1) * ledSpacing) / 2;
      for (let i = 0; i < ledCount; i++) {
        const lx = ledStartX + i * ledSpacing;
        let litAmt = 0.15;
        if (m === "speaking")        litAmt = 0.15 + Math.abs(Math.sin(t * 9 + i * 1.3)) * 0.75 * (0.3 + jawSmooth * 0.7);
        else if (m === "thinking")   litAmt = i === Math.floor((t * 3.5) % ledCount) ? 0.9 : 0.12;
        else if (m === "autonomous") litAmt = 0.15 + Math.sin(t * 1.4 + i * 0.9) * 0.35 + 0.35;
        else if (m === "error")      litAmt = Math.floor(t * 4) % 2 === 0 ? 0.85 : 0.1;
        else litAmt = 0.12 + (i < 2 ? 0.2 : 0);

        ctx.beginPath();
        ctx.arc(lx, ledBarY, size * 0.013, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${rgb},${litAmt})`;
        ctx.fill();
        if (litAmt > 0.5) {
          ctx.beginPath();
          ctx.arc(lx, ledBarY, size * 0.02, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${rgb},0.1)`;
          ctx.fill();
        }
      }

      rafRef.current = requestAnimationFrame(frame);
    }

    rafRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafRef.current);
  }, [size]);

  useEffect(() => {
    if (mode !== "speaking" && speechSignalRef?.current) {
      speechSignalRef.current.jaw = 0;
    }
  }, [mode]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: size, height: size, display: "block", background: "transparent" }}
    />
  );
}

// ─── CORNER ACCENTS ───────────────────────────────────────────────────────────
function Corners({ color = "rgba(0,200,255,0.5)", size = 10 }) {
  const s = `2px solid ${color}`;
  const corners = [
    { top: 0,    left: 0,   borderTop: s, borderLeft: s   },
    { top: 0,    right: 0,  borderTop: s, borderRight: s  },
    { bottom: 0, left: 0,   borderBottom: s, borderLeft: s  },
    { bottom: 0, right: 0,  borderBottom: s, borderRight: s },
  ];
  return (
    <>
      {corners.map((style, i) => (
        <div key={i} style={{ position: "absolute", width: size, height: size, ...style }} />
      ))}
    </>
  );
}

// ─── BUBBLE ───────────────────────────────────────────────────────────────────
function Bubble({ text, role, fading, panelLeft, onCharTyped }) {
  const [shown, setShown] = useState(role === "user" ? text : "");
  const ivRef  = useRef(null);
  const idxRef = useRef(0);

  useEffect(() => {
    if (role !== "aegis") return;
    idxRef.current = 0;
    setShown("");
    ivRef.current = setInterval(() => {
      idxRef.current++;
      const ch = text[idxRef.current - 1];
      setShown(text.slice(0, idxRef.current));
      if (ch && onCharTyped) onCharTyped(ch);
      if (idxRef.current >= text.length) clearInterval(ivRef.current);
    }, 14);
    return () => clearInterval(ivRef.current);
  }, [text, role]);

  const isUser = role === "user";
  const accent = isUser ? "rgba(255,255,255,0.15)" : "rgba(0,200,255,0.3)";
  const bg     = isUser ? "rgba(20,20,40,0.75)"    : "rgba(0,20,60,0.78)";

  return (
    <div style={{
      position: "relative", padding: "10px 14px",
      background: bg, border: `1px solid ${accent}`,
      borderRadius: isUser ? "8px 8px 2px 8px" : "2px 8px 8px 8px",
      backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)",
      fontSize: 12, color: "rgba(220,235,255,0.95)",
      lineHeight: 1.7, whiteSpace: "pre-wrap",
      fontFamily: "'Courier New', monospace",
      boxShadow: isUser
        ? "0 0 12px rgba(255,255,255,0.04), inset 0 1px 0 rgba(255,255,255,0.06)"
        : "0 0 20px rgba(0,160,255,0.12), inset 0 1px 0 rgba(0,200,255,0.08)",
      opacity: fading ? 0 : 1,
      transition: "opacity 0.5s ease",
      animation: `${panelLeft ? "slideInRight" : "slideIn"} 0.2s ease`,
      maxWidth: "100%",
    }}>
      {!isUser && (
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0, height: 1,
          background: "linear-gradient(90deg, transparent, rgba(0,200,255,0.4), transparent)",
        }} />
      )}
      <Corners color={isUser ? "rgba(255,255,255,0.2)" : "rgba(0,200,255,0.45)"} size={6} />
      {shown}
      {role === "aegis" && shown.length < text.length && (
        <span style={{ color: "rgba(0,200,255,0.8)", animation: "blink 0.8s infinite" }}>█</span>
      )}
    </div>
  );
}

// ─── INPUT PANEL ──────────────────────────────────────────────────────────────
function InputPanel({ inputRef, value, onChange, onKeyDown, onSend, loading }) {
  return (
    <div style={{
      position: "relative",
      background: "rgba(2,8,24,0.82)",
      border: "1px solid rgba(0,180,255,0.3)",
      borderRadius: 6,
      backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)",
      padding: "10px",
      boxShadow: "0 0 24px rgba(0,150,255,0.1), inset 0 1px 0 rgba(0,200,255,0.06)",
      animation: "slideIn 0.18s ease",
    }}>
      <div style={{
        position: "absolute", top: 0, left: 8, right: 8, height: 1,
        background: "linear-gradient(90deg, transparent, rgba(0,200,255,0.5), transparent)",
      }} />
      <Corners color="rgba(0,200,255,0.4)" size={7} />
      <div style={{
        fontSize: 8, color: "rgba(0,200,255,0.5)", letterSpacing: "0.2em",
        marginBottom: 6, textTransform: "uppercase",
      }}>⬡ INPUT CHANNEL</div>
      <textarea
        ref={inputRef}
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        placeholder="Transmit to AEGIS..."
        rows={2}
        style={{
          width: "100%",
          background: "rgba(0,10,30,0.6)",
          border: "1px solid rgba(0,160,255,0.2)",
          borderRadius: 4,
          padding: "8px 10px",
          fontSize: 12, color: "rgba(200,220,255,0.92)",
          fontFamily: "'Courier New', monospace",
          resize: "none", outline: "none", lineHeight: 1.6,
          caretColor: "rgba(0,200,255,0.9)",
        }}
        onFocus={(e) => (e.target.style.borderColor = "rgba(0,200,255,0.5)")}
        onBlur={(e)  => (e.target.style.borderColor = "rgba(0,160,255,0.2)")}
      />
      <button
        onClick={onSend}
        disabled={loading || !value.trim()}
        style={{
          width: "100%", marginTop: 6, padding: "7px",
          background: value.trim() && !loading
            ? "linear-gradient(135deg, rgba(0,100,255,0.35), rgba(0,200,255,0.2))"
            : "rgba(255,255,255,0.03)",
          border: `1px solid ${value.trim() && !loading ? "rgba(0,200,255,0.45)" : "rgba(255,255,255,0.06)"}`,
          borderRadius: 4,
          color: value.trim() && !loading ? "rgba(0,220,255,0.95)" : "rgba(255,255,255,0.2)",
          fontSize: 10, letterSpacing: "0.2em", fontFamily: "'Courier New', monospace",
          cursor: value.trim() && !loading ? "pointer" : "not-allowed",
          transition: "all 0.2s",
        }}
      >
        {loading ? "PROCESSING..." : "TRANSMIT  ↑"}
      </button>
    </div>
  );
}

// ─── KEY BADGE ────────────────────────────────────────────────────────────────
// Shows which key slot is active and its status
function KeyBadge({ keys, activeIdx, exhaustedIdxs }) {
  if (!keys.length) return null;
  return (
    <div style={{
      display: "flex", gap: 4, alignItems: "center",
      marginBottom: 4,
    }}>
      <span style={{ fontSize: 8, color: "rgba(0,200,255,0.3)", letterSpacing: "0.15em" }}>KEY</span>
      {keys.map((_, i) => {
        const isActive    = i === activeIdx;
        const isExhausted = exhaustedIdxs.includes(i);
        const color = isExhausted ? "rgba(255,80,80,0.7)"
                    : isActive    ? "rgba(0,255,160,0.9)"
                    :               "rgba(0,200,255,0.25)";
        return (
          <div key={i} style={{
            width: 8, height: 8, borderRadius: "50%",
            background: color,
            boxShadow: isActive && !isExhausted ? "0 0 6px rgba(0,255,160,0.6)" : "none",
            transition: "all 0.3s",
          }} title={`Key ${i + 1}${isActive ? " (active)" : ""}${isExhausted ? " (quota exceeded)" : ""}`} />
        );
      })}
    </div>
  );
}

// ─── SETUP SCREEN ─────────────────────────────────────────────────────────────
function SetupScreen({ onSave }) {
  const [keys, setKeys]         = useState(() => keyManager.load());
  const [input, setInput]       = useState("");
  const [err, setErr]           = useState("");
  const [testing, setTesting]   = useState(false);
  const [testOk, setTestOk]     = useState(null);  // index of last-tested key
  const { onMouseDown: dragStart } = useDrag();
  const dummySignal = useRef({ jaw: 0 });

  useEffect(() => { window.electronAPI?.resize?.(400, 520); }, []);

  const testAndAdd = async () => {
    const key = input.trim();
    if (!key.startsWith("AIza")) { setErr("Key must start with AIza..."); return; }
    if (keys.includes(key)) { setErr("Key already added."); return; }
    setTesting(true); setErr("");
    try {
      const res = await fetch(
        `${GEMINI_BASE}/${MODEL}:generateContent?key=${key}`,
        {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "hi" }] }] }),
        }
      );
      if (res.ok) {
        const updated = keyManager.add(key);
        setKeys([...updated]);
        setTestOk(updated.length - 1);
        setInput("");
      } else {
        const d = await res.json();
        setErr(d.error?.message || "Invalid key.");
      }
    } catch { setErr("Could not reach Google. Check your network."); }
    setTesting(false);
  };

  const removeKey = (idx) => {
    const updated = keyManager.remove(idx);
    setKeys([...updated]);
    if (testOk === idx) setTestOk(null);
  };

  const canLaunch = keys.length > 0;

  return (
    <div
      onMouseDown={dragStart}
      style={{
        width: "100vw", height: "100vh", cursor: "move",
        background: "rgba(2,4,16,0.94)",
        backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)",
        borderRadius: 8, border: "1px solid rgba(0,180,255,0.25)",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        gap: 16, fontFamily: "'Courier New', monospace",
        boxShadow: "0 0 40px rgba(0,100,255,0.12)", position: "relative",
        padding: "20px 0",
      }}
    >
      <Corners color="rgba(0,200,255,0.5)" size={12} />
      <div style={{ position: "absolute", top: 0, left: 20, right: 20, height: 1, background: "linear-gradient(90deg,transparent,rgba(0,200,255,0.4),transparent)" }} />
      <RobotHead mode="idle" size={90} speechSignalRef={dummySignal} />
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: "0.4em", color: "rgba(0,210,255,0.95)", textShadow: "0 0 20px rgba(0,200,255,0.5)" }}>AEGIS</div>
        <div style={{ fontSize: 8, color: "rgba(0,200,255,0.3)", letterSpacing: "0.25em", marginTop: 3 }}>MULTI-KEY · INITIALIZATION</div>
      </div>

      <div style={{ width: 320, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontSize: 9, color: "rgba(150,180,220,0.45)", textAlign: "center", lineHeight: 1.8 }}>
          Add one or more Gemini API keys.<br />
          AEGIS rotates automatically when a key hits quota.
        </div>

        {/* Key list */}
        {keys.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {keys.map((k, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "center", gap: 8,
                background: "rgba(0,10,30,0.5)",
                border: "1px solid rgba(0,160,255,0.18)",
                borderRadius: 4, padding: "6px 10px",
              }}>
                <div style={{
                  width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
                  background: testOk === i ? "rgba(0,255,160,0.9)" : "rgba(0,200,255,0.35)",
                  boxShadow: testOk === i ? "0 0 6px rgba(0,255,160,0.5)" : "none",
                }} />
                <div style={{ flex: 1, fontSize: 10, color: "rgba(180,210,255,0.6)", letterSpacing: "0.05em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {k.slice(0, 8)}···{k.slice(-4)}
                </div>
                <div style={{ fontSize: 9, color: "rgba(0,200,255,0.4)", marginRight: 4 }}>KEY {i + 1}</div>
                <button
                  onClick={() => removeKey(i)}
                  onMouseDown={(e) => e.stopPropagation()}
                  style={{
                    background: "none", border: "1px solid rgba(255,80,80,0.2)", borderRadius: 3,
                    color: "rgba(255,80,80,0.45)", cursor: "pointer", fontSize: 9,
                    padding: "1px 5px", fontFamily: "inherit", transition: "all 0.2s",
                  }}
                  onMouseEnter={(e) => { e.target.style.borderColor = "rgba(255,80,80,0.6)"; e.target.style.color = "rgba(255,100,100,0.9)"; }}
                  onMouseLeave={(e) => { e.target.style.borderColor = "rgba(255,80,80,0.2)"; e.target.style.color = "rgba(255,80,80,0.45)"; }}
                >✕</button>
              </div>
            ))}
          </div>
        )}

        {/* Add key input */}
        <div style={{ display: "flex", gap: 6 }}>
          <input
            type="password" value={input}
            onChange={(e) => { setInput(e.target.value); setErr(""); }}
            onKeyDown={(e) => { if (e.key === "Enter") testAndAdd(); }}
            placeholder="AIzaSy... (new key)"
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              flex: 1, background: "rgba(0,10,30,0.7)", border: "1px solid rgba(0,160,255,0.3)",
              borderRadius: 4, padding: "8px 10px", fontSize: 11,
              color: "rgba(200,220,255,0.9)", fontFamily: "inherit", outline: "none",
              caretColor: "rgba(0,200,255,0.9)",
            }}
            onFocus={(e) => (e.target.style.borderColor = "rgba(0,200,255,0.6)")}
            onBlur={(e)  => (e.target.style.borderColor = "rgba(0,160,255,0.3)")}
          />
          <button
            onClick={testAndAdd} disabled={testing || !input.trim()}
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              padding: "8px 12px", borderRadius: 4,
              background: input.trim() && !testing ? "rgba(0,100,255,0.3)" : "rgba(255,255,255,0.04)",
              color: input.trim() && !testing ? "rgba(0,220,255,0.95)" : "rgba(255,255,255,0.2)",
              fontSize: 10, letterSpacing: "0.1em", fontFamily: "inherit", cursor: "pointer",
              border: `1px solid ${input.trim() && !testing ? "rgba(0,200,255,0.4)" : "rgba(255,255,255,0.06)"}`,
              transition: "all 0.2s", whiteSpace: "nowrap",
            }}
          >{testing ? "···" : "+ ADD"}</button>
        </div>

        {err && <div style={{ fontSize: 10, color: "#f87171", letterSpacing: "0.05em" }}>{err}</div>}

        <button
          onClick={() => { if (canLaunch) onSave(); }}
          disabled={!canLaunch}
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            marginTop: 4, padding: "10px", borderRadius: 4,
            background: canLaunch ? "linear-gradient(135deg,rgba(0,100,255,0.4),rgba(0,200,255,0.25))" : "rgba(255,255,255,0.04)",
            color: canLaunch ? "rgba(0,220,255,0.95)" : "rgba(255,255,255,0.2)",
            fontSize: 11, letterSpacing: "0.2em", fontFamily: "inherit", cursor: canLaunch ? "pointer" : "not-allowed",
            border: `1px solid ${canLaunch ? "rgba(0,200,255,0.5)" : "rgba(255,255,255,0.06)"}`,
            transition: "all 0.2s",
          }}
        >
          {canLaunch ? `INITIALIZE AEGIS  [${keys.length} KEY${keys.length > 1 ? "S" : ""}]` : "ADD AT LEAST ONE KEY"}
        </button>
      </div>
    </div>
  );
}

// ─── HISTORY PANEL ────────────────────────────────────────────────────────────
function HistoryPanel({ messages, input, setInput, onSend, loading, onClose, onClear, keys, activeIdx, exhaustedIdxs }) {
  const scrollRef = useRef(null);
  const { onMouseDown: dragStart } = useDrag();

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => { window.electronAPI?.resize?.(360, 580); }, []);

  return (
    <div style={{
      width: "100vw", height: "100vh",
      background: "rgba(2,4,18,0.9)",
      backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)",
      borderRadius: 8, border: "1px solid rgba(0,180,255,0.22)",
      display: "flex", flexDirection: "column", overflow: "hidden",
      fontFamily: "'Courier New', monospace",
      boxShadow: "0 0 40px rgba(0,100,255,0.1)", position: "relative",
    }}>
      <Corners color="rgba(0,200,255,0.4)" size={10} />
      <div
        onMouseDown={dragStart}
        style={{
          padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center",
          borderBottom: "1px solid rgba(0,180,255,0.12)", flexShrink: 0,
          cursor: "move", background: "rgba(0,10,30,0.4)",
        }}
      >
        <div>
          <div style={{ fontSize: 9, color: "rgba(0,200,255,0.5)", letterSpacing: "0.22em", marginBottom: 3 }}>⬡ AEGIS · MEMORY STREAM</div>
          <KeyBadge keys={keys} activeIdx={activeIdx} exhaustedIdxs={exhaustedIdxs} />
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <button
            onClick={onClear} onMouseDown={(e) => e.stopPropagation()} title="Clear history"
            style={{
              background: "none", border: "1px solid rgba(255,80,80,0.2)", borderRadius: 3,
              color: "rgba(255,80,80,0.4)", cursor: "pointer", fontSize: 9,
              padding: "2px 6px", fontFamily: "inherit", letterSpacing: "0.1em", transition: "all 0.2s",
            }}
            onMouseEnter={(e) => { e.target.style.borderColor = "rgba(255,80,80,0.5)"; e.target.style.color = "rgba(255,80,80,0.8)"; }}
            onMouseLeave={(e) => { e.target.style.borderColor = "rgba(255,80,80,0.2)"; e.target.style.color = "rgba(255,80,80,0.4)"; }}
          >PURGE</button>
          <button
            onClick={onClose} onMouseDown={(e) => e.stopPropagation()}
            style={{
              background: "none", border: "1px solid rgba(0,180,255,0.2)", borderRadius: 3,
              color: "rgba(0,200,255,0.5)", cursor: "pointer", fontSize: 12,
              width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >×</button>
        </div>
      </div>
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "14px", display: "flex", flexDirection: "column", gap: 8 }}>
        {messages.length === 0 && (
          <div style={{ color: "rgba(0,200,255,0.15)", fontSize: 11, textAlign: "center", marginTop: 24, letterSpacing: "0.1em" }}>NO RECORDS</div>
        )}
        {messages.map((m) => (
          <div key={m.id} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
            <div style={{
              maxWidth: "80%", padding: "8px 12px",
              borderRadius: m.role === "user" ? "6px 6px 2px 6px" : "2px 6px 6px 6px",
              background: m.role === "user" ? "rgba(20,20,50,0.7)" : "rgba(0,15,45,0.75)",
              border: m.role === "user" ? "1px solid rgba(255,255,255,0.12)" : "1px solid rgba(0,180,255,0.2)",
              fontSize: 11, color: "rgba(200,220,255,0.8)", lineHeight: 1.65, whiteSpace: "pre-wrap",
            }}>{m.text}</div>
          </div>
        ))}
      </div>
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{ padding: "10px 12px", borderTop: "1px solid rgba(0,180,255,0.1)", display: "flex", gap: 8, flexShrink: 0 }}
      >
        <textarea
          value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(); } }}
          placeholder="Transmit to AEGIS..." rows={1}
          style={{
            flex: 1, background: "rgba(0,10,30,0.6)", border: "1px solid rgba(0,160,255,0.2)",
            borderRadius: 4, padding: "7px 10px", fontSize: 11,
            color: "rgba(200,220,255,0.9)", fontFamily: "inherit", resize: "none", outline: "none",
            caretColor: "rgba(0,200,255,0.9)",
          }}
          onFocus={(e) => (e.target.style.borderColor = "rgba(0,200,255,0.5)")}
          onBlur={(e)  => (e.target.style.borderColor = "rgba(0,160,255,0.2)")}
        />
        <button
          onClick={onSend} disabled={loading || !input.trim()}
          style={{
            width: 34, borderRadius: 4, border: "1px solid rgba(0,200,255,0.3)",
            background: "rgba(0,80,200,0.3)", color: "rgba(0,220,255,0.9)", fontSize: 14, cursor: "pointer",
          }}
        >↑</button>
      </div>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  // ── Multi-key state ──
  const [keys,         setKeys]         = useState(() => keyManager.load());
  const [activeKeyIdx, setActiveKeyIdx] = useState(() => keyManager.getIdx());
  const [exhaustedIdxs, setExhaustedIdxs] = useState([]);  // indices that hit quota this session
  const activeKey = keys[activeKeyIdx] ?? null;

  const [uiMode,     setUiMode]     = useState("orb");
  const [orbMode,    setOrbMode]    = useState("idle");
  const [bubbles,    setBubbles]    = useState([]);
  const [alertMsg,   setAlertMsg]   = useState(null);
  const [input,      setInput]      = useState("");
  const [loading,    setLoading]    = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [panelOpen,  setPanelOpen]  = useState(false);

  const [chat, dispatch] = useReducer(chatReducer, { messages: [], history: [] });

  const speechSignalRef = useRef({ jaw: 0, decayFrames: 0 });
  const busyRef    = useRef(false);
  const thinkTimer = useRef(null);
  const clickTimer = useRef(null);
  const bidRef     = useRef(0);
  const inputRef   = useRef(null);
  const abortRef   = useRef(null);

  const [panelSide, setPanelSide]       = useState("right");
  const panelSideRef                    = useRef("right");
  const physicallyExpandedRef           = useRef(false);
  const boundsInFlightRef               = useRef(null);
  const pendingBoundsRef                = useRef(null);
  const [panelVisible, setPanelVisible] = useState(true);

  const winW      = (panelOpen || !!alertMsg || bubbles.length > 0) ? ORB_D + 6 + PANEL_W : ORB_D;
  const winH      = ORB_D;
  const showPanel = panelOpen || !!alertMsg || bubbles.length > 0;
  const panelLeft = panelSide === "left";

  const handleCharTyped = useCallback((ch) => {
    const jaw = charToJaw(ch);
    speechSignalRef.current = { jaw, decayFrames: 0 };
  }, []);

  // ── Key rotation: tries to use the next key; returns false if all exhausted ──
  const rotateKey = useCallback(() => {
    const newKey = keyManager.rotate();
    const newIdx = keyManager.getIdx();
    setActiveKeyIdx(newIdx);
    return { key: newKey, idx: newIdx };
  }, []);

  const applyBoundsCore = useCallback(async (newW, newH) => {
    if (uiMode === "history" || !activeKey) return;
    const wasExpanded = physicallyExpandedRef.current;
    const currentSide = panelSideRef.current;
    setPanelVisible(false);
    const currentWinX = window.screenX;
    const currentWinY = window.screenY;
    const currentW    = window.outerWidth;
    const orbX = (currentSide === "left" && wasExpanded) ? currentWinX + currentW - ORB_D : currentWinX;
    const chosenSide = await window.electronAPI?.setBounds?.(orbX, currentWinY, newW, newH, ORB_D, PANEL_W);
    if (!chosenSide) window.electronAPI?.resize?.(newW, newH);
    const newSide = chosenSide ?? currentSide;
    panelSideRef.current = newSide;
    physicallyExpandedRef.current = newW > ORB_D;
    await new Promise((r) => requestAnimationFrame(r));
    setPanelSide(newSide);
    setPanelVisible(true);
  }, [uiMode, activeKey]);

  const applyBounds = useCallback((newW, newH) => {
    if (boundsInFlightRef.current) { pendingBoundsRef.current = { newW, newH }; return; }
    const run = async (w, h) => {
      boundsInFlightRef.current = applyBoundsCore(w, h).finally(async () => {
        boundsInFlightRef.current = null;
        if (pendingBoundsRef.current) {
          const { newW: pw, newH: ph } = pendingBoundsRef.current;
          pendingBoundsRef.current = null;
          run(pw, ph);
        }
      });
    };
    run(newW, newH);
  }, [applyBoundsCore]);

  useEffect(() => {
    if (uiMode === "history" || !activeKey) return;
    applyBounds(winW, winH);
  }, [winW, winH, uiMode, activeKey]);

  const handleDragEnd = useCallback(() => { applyBounds(winW, winH); }, [applyBounds, winW, winH]);
  const { onMouseDown: dragStart, wasDrag } = useDrag(handleDragEnd);

  useEffect(() => {
    if (uiMode === "input") setTimeout(() => inputRef.current?.focus(), 80);
  }, [uiMode]);

  useEffect(() => {
    if (!activeKey) return;
    const saved = db.get("aegis_chat");
    if (saved?.messages?.length) dispatch({ type: "LOAD", messages: saved.messages, history: saved.history || [] });
    scheduleThink();
    return () => { clearTimeout(thinkTimer.current); abortRef.current?.abort(); };
  }, [activeKey]);

  useEffect(() => { if (alertMsg) setPanelOpen(true); }, [alertMsg]);

  const addBubble = useCallback((text, role) => {
    const id = ++bidRef.current;
    setBubbles((prev) => [...prev.slice(-2), { id, text, role, fading: false }]);
    const ttl = role === "aegis" ? 10000 : 4000;
    setTimeout(() => {
      setBubbles((prev) => prev.map((b) => (b.id === id ? { ...b, fading: true } : b)));
      setTimeout(() => setBubbles((prev) => prev.filter((b) => b.id !== id)), 600);
    }, ttl);
  }, []);

  const autonomousThink = useCallback(async (currentHistory) => {
    if (busyRef.current) { scheduleThinkWith(currentHistory); return; }
    const key = keyManager.current();
    if (!key) return;
    busyRef.current = true;
    setOrbMode("autonomous");
    const thinkHistory = [
      ...currentHistory.slice(-6),
      { role: "user", content: 'Autonomous thought. JSON only: {"thought":"...","type":"planning|observing|evolving|questioning|building","important":true|false,"alert":"one sentence if important, else null"}' },
    ];
    try {
      const controller = new AbortController();
      abortRef.current = controller;
      const raw = await callGemini(key, thinkHistory, 140, controller.signal);
      const cleaned = raw.replace(/```json|```/g, "").trim();
      const p = JSON.parse(cleaned);
      if (p.important && p.alert) setAlertMsg(p.alert);
    } catch (err) {
      if (err.name !== "AbortError") console.warn("AEGIS autonomous thought failed:", err.message);
    }
    busyRef.current = false;
    setOrbMode("idle");
    scheduleThinkWith(currentHistory);
  }, []);

  const scheduleThinkWith = useCallback((history) => {
    clearTimeout(thinkTimer.current);
    thinkTimer.current = setTimeout(() => autonomousThink(history), THINK_INTERVAL);
  }, [autonomousThink]);

  function scheduleThink() {
    clearTimeout(thinkTimer.current);
    thinkTimer.current = setTimeout(() => autonomousThink([]), THINK_INTERVAL);
  }

  // ── SEND with automatic key rotation on quota errors ──
  const send = useCallback(async (overrideKey) => {
    const text = input.trim();
    if (!text || loading || busyRef.current) return;

    const currentKey = overrideKey ?? keyManager.current();
    if (!currentKey) {
      addBubble("No API keys configured. Double-click to add keys.", "aegis");
      return;
    }

    setInput("");
    setUiMode("orb");
    busyRef.current = true;
    setLoading(true);
    setOrbMode("thinking");
    clearTimeout(thinkTimer.current);
    addBubble(text, "user");
    const msgId = Date.now();
    dispatch({ type: "USER_MSG", id: msgId, text });
    const nextHistory = [...chat.history, { role: "user", content: text }];

    try {
      const controller = new AbortController();
      abortRef.current = controller;
      const reply = await callGemini(currentKey, nextHistory, 350, controller.signal);
      dispatch({ type: "AEGIS_MSG", id: Date.now(), text: reply });
      setRetryCount(0);
      setOrbMode("speaking");
      speechSignalRef.current = { jaw: 0, decayFrames: 0 };
      addBubble(reply, "aegis");
      scheduleThinkWith([...nextHistory, { role: "assistant", content: reply }]);
      const speakDuration = Math.max(2500, reply.length * 14 + 800);
      setTimeout(() => {
        speechSignalRef.current = { jaw: 0, decayFrames: 99 };
        setOrbMode("idle");
        busyRef.current = false;
        setPanelOpen(false);
      }, speakDuration);
    } catch (err) {
      if (err.name === "AbortError") {
        busyRef.current = false;
        setLoading(false);
        setOrbMode("idle");
        setPanelOpen(false);
        return;
      }

      const isQuota = err.message.toLowerCase().includes("quota") ||
                      err.message.toLowerCase().includes("429")   ||
                      err.message.toLowerCase().includes("rate");

      if (isQuota) {
        // Mark current key as exhausted
        const curIdx = keyManager.getIdx();
        setExhaustedIdxs((prev) => prev.includes(curIdx) ? prev : [...prev, curIdx]);

        // Attempt rotation
        const { key: nextKey, idx: nextIdx } = rotateKey();
        setActiveKeyIdx(nextIdx);

        if (nextKey && nextKey !== currentKey) {
          // We have a fresh key — retry transparently
          addBubble(`Key ${curIdx + 1} quota hit. Switching to key ${nextIdx + 1}...`, "aegis");
          busyRef.current = false;
          setLoading(false);
          setOrbMode("idle");
          // Small delay then retry with new key and same text still in history
          setTimeout(() => {
            // Re-inject the user text so we retry
            setInput(text);
            // We call send directly with the new key to avoid state timing issues
            sendWithKey(text, nextKey, nextHistory);
          }, 600);
          return;
        } else {
          // All keys exhausted
          addBubble("All API keys have hit their quota. Try again later or add more keys.", "aegis");
          setOrbMode("error");
          setTimeout(() => {
            setOrbMode("idle");
            busyRef.current = false;
            setPanelOpen(false);
            scheduleThinkWith(nextHistory);
          }, 8000);
        }
      } else {
        addBubble(`SYS ERROR: ${err.message}`, "aegis");
        setOrbMode("error");
        setRetryCount((c) => c + 1);
        setTimeout(() => {
          setOrbMode("idle");
          busyRef.current = false;
          setPanelOpen(false);
          scheduleThinkWith(nextHistory);
        }, 3000);
      }
    }
    setLoading(false);
  }, [input, loading, chat.history, addBubble, scheduleThinkWith, rotateKey]);

  // Helper to retry a specific message with a specific key (avoids re-reading stale `input`)
  const sendWithKey = useCallback(async (text, key, prevHistory) => {
    if (!text || !key || busyRef.current) return;
    busyRef.current = true;
    setLoading(true);
    setOrbMode("thinking");

    const nextHistory = [...prevHistory];

    try {
      const controller = new AbortController();
      abortRef.current = controller;
      const reply = await callGemini(key, nextHistory, 350, controller.signal);
      dispatch({ type: "AEGIS_MSG", id: Date.now(), text: reply });
      setRetryCount(0);
      setOrbMode("speaking");
      speechSignalRef.current = { jaw: 0, decayFrames: 0 };
      addBubble(reply, "aegis");
      scheduleThinkWith([...nextHistory, { role: "assistant", content: reply }]);
      const speakDuration = Math.max(2500, reply.length * 14 + 800);
      setTimeout(() => {
        speechSignalRef.current = { jaw: 0, decayFrames: 99 };
        setOrbMode("idle");
        busyRef.current = false;
        setPanelOpen(false);
      }, speakDuration);
    } catch (err2) {
      if (err2.name === "AbortError") { busyRef.current = false; setLoading(false); setOrbMode("idle"); return; }

      const isQ2 = err2.message.toLowerCase().includes("quota") || err2.message.toLowerCase().includes("429") || err2.message.toLowerCase().includes("rate");
      if (isQ2) {
        const curIdx2 = keyManager.getIdx();
        setExhaustedIdxs((prev) => prev.includes(curIdx2) ? prev : [...prev, curIdx2]);
        const { key: nextKey2, idx: nextIdx2 } = rotateKey();
        setActiveKeyIdx(nextIdx2);
        if (nextKey2 && nextKey2 !== key) {
          addBubble(`Key ${curIdx2 + 1} quota hit. Switching to key ${nextIdx2 + 1}...`, "aegis");
          busyRef.current = false;
          setLoading(false);
          setOrbMode("idle");
          setTimeout(() => sendWithKey(text, nextKey2, nextHistory), 600);
          return;
        }
        addBubble("All API keys have hit their quota. Try again later or add more keys.", "aegis");
      } else {
        addBubble(`SYS ERROR: ${err2.message}`, "aegis");
        setRetryCount((c) => c + 1);
      }
      setOrbMode("error");
      setTimeout(() => { setOrbMode("idle"); busyRef.current = false; setPanelOpen(false); scheduleThinkWith(nextHistory); }, 4000);
    }
    setLoading(false);
  }, [addBubble, scheduleThinkWith, rotateKey]);

  const handleClick = useCallback(() => {
    if (wasDrag()) return;
    if (clickTimer.current) {
      clearTimeout(clickTimer.current);
      clickTimer.current = null;
      // Double-click → manage keys or history
      if (!activeKey) {
        // No keys → open setup by refreshing
        setKeys(keyManager.load());
      } else {
        setPanelOpen(false);
        setUiMode((prev) => (prev === "history" ? "orb" : "history"));
      }
    } else {
      clickTimer.current = setTimeout(() => {
        clickTimer.current = null;
        if (alertMsg) {
          setAlertMsg(null);
          setPanelOpen(true);
          setUiMode("input");
        } else {
          const next = uiMode === "input" ? "orb" : "input";
          setPanelOpen(next === "input");
          setUiMode(next);
        }
      }, 240);
    }
  }, [wasDrag, alertMsg, uiMode, activeKey]);

  const clearHistory = useCallback(() => { dispatch({ type: "CLEAR" }); }, []);

  // ── Not configured yet ──
  if (!keys.length) return <SetupScreen onSave={() => { setKeys(keyManager.load()); setActiveKeyIdx(keyManager.getIdx()); }} />;

  if (uiMode === "history") return (
    <HistoryPanel
      messages={chat.messages}
      input={input} setInput={setInput}
      onSend={send} loading={loading}
      onClear={clearHistory}
      onClose={() => { setPanelOpen(false); setUiMode("orb"); }}
      keys={keys}
      activeIdx={activeKeyIdx}
      exhaustedIdxs={exhaustedIdxs}
    />
  );

  const statusColor =
    orbMode === "autonomous" ? "#a78bfa" :
    orbMode === "speaking"   ? "#00ffb0" :
    orbMode === "thinking"   ? "#00c8ff" :
    orbMode === "error"      ? "#f87171" :
                               "rgba(0,130,255,0.8)";

  return (
    <div style={{
      width: "100vw", height: "100vh",
      display: "flex",
      flexDirection: panelLeft ? "row-reverse" : "row",
      alignItems: "center",
      background: "transparent", overflow: "hidden",
      fontFamily: "'Courier New', monospace",
    }}>
      {/* ── ROBOT HEAD ── */}
      <div
        onMouseDown={dragStart}
        onClick={handleClick}
        style={{
          width: ORB_D, height: ORB_D, flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          cursor: "grab", position: "relative", userSelect: "none",
        }}
      >
        <RobotHead mode={orbMode} size={ORB_D} speechSignalRef={speechSignalRef} />
        <div style={{
          position: "absolute", top: 8, right: 8,
          width: 7, height: 7, borderRadius: "50%",
          background: statusColor, boxShadow: `0 0 10px ${statusColor}`,
          transition: "background 0.5s", pointerEvents: "none",
        }} />
        {/* Key status dots on the orb */}
        {keys.length > 1 && (
          <div style={{
            position: "absolute", bottom: 8, left: "50%", transform: "translateX(-50%)",
            display: "flex", gap: 4, pointerEvents: "none",
          }}>
            {keys.map((_, i) => {
              const isActive    = i === activeKeyIdx;
              const isExhausted = exhaustedIdxs.includes(i);
              return (
                <div key={i} style={{
                  width: 5, height: 5, borderRadius: "50%",
                  background: isExhausted ? "rgba(255,80,80,0.7)"
                            : isActive    ? "rgba(0,255,160,0.9)"
                            :               "rgba(0,200,255,0.25)",
                  boxShadow: isActive && !isExhausted ? "0 0 5px rgba(0,255,160,0.6)" : "none",
                  transition: "all 0.4s",
                }} />
              );
            })}
          </div>
        )}
        {retryCount > 1 && (
          <div style={{
            position: "absolute", top: 8, left: 8,
            fontSize: 7, color: "rgba(255,80,80,0.6)",
            letterSpacing: "0.1em", pointerEvents: "none",
          }}>ERR×{retryCount}</div>
        )}
      </div>

      {/* ── SIDE PANEL ── */}
      {showPanel && (
        <div
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            width: PANEL_W, display: "flex", flexDirection: "column",
            gap: 6,
            paddingLeft: panelLeft ? 0 : 6,
            paddingRight: panelLeft ? 6 : 0,
            alignSelf: "center",
            visibility: panelVisible ? "visible" : "hidden",
          }}
        >
          {alertMsg && (
            <div
              onClick={() => { setAlertMsg(null); setPanelOpen(true); setUiMode("input"); }}
              style={{
                position: "relative", padding: "9px 13px",
                borderRadius: "2px 8px 8px 8px",
                background: "rgba(60,0,120,0.75)",
                border: "1px solid rgba(160,80,255,0.45)",
                backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
                fontSize: 11, color: "rgba(210,170,255,0.95)", lineHeight: 1.6,
                cursor: "pointer", animation: "slideIn 0.2s ease",
                boxShadow: "0 0 20px rgba(120,50,255,0.15)",
              }}
            >
              <Corners color="rgba(160,80,255,0.4)" size={6} />
              <div style={{ position: "absolute", top: 0, left: 6, right: 6, height: 1, background: "linear-gradient(90deg,transparent,rgba(160,80,255,0.5),transparent)" }} />
              <span style={{ color: "rgba(180,100,255,0.8)", marginRight: 6 }}>⬡</span>
              {alertMsg}
              <div style={{ fontSize: 8, color: "rgba(160,80,255,0.45)", letterSpacing: "0.12em", marginTop: 4 }}>CLICK TO RESPOND</div>
            </div>
          )}

          {bubbles.map((b) => (
            <Bubble
              key={b.id}
              text={b.text}
              role={b.role}
              fading={b.fading}
              panelLeft={panelLeft}
              onCharTyped={b.role === "aegis" ? handleCharTyped : undefined}
            />
          ))}

          {uiMode === "input" && (
            <InputPanel
              inputRef={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
                if (e.key === "Escape") { setPanelOpen(false); setUiMode("orb"); }
              }}
              onSend={send}
              loading={loading}
            />
          )}
        </div>
      )}

      <style>{`
        @keyframes blink        { 0%,100%{opacity:1} 50%{opacity:0} }
        @keyframes slideIn      { from{opacity:0;transform:translateX(-8px) scale(0.97)} to{opacity:1;transform:none} }
        @keyframes slideInRight { from{opacity:0;transform:translateX(8px) scale(0.97)} to{opacity:1;transform:none} }
        ::-webkit-scrollbar { width:2px; }
        ::-webkit-scrollbar-thumb { background:rgba(0,180,255,0.15); border-radius:2px; }
        textarea { overflow:hidden; }
        * { box-sizing:border-box; }
      `}</style>
    </div>
  );
}