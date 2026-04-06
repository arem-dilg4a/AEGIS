import { useState, useEffect, useRef, useCallback, useReducer } from "react";

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const MODEL          = "gemini-2.5-flash";
const GEMINI_BASE    = "https://generativelanguage.googleapis.com/v1beta/models";
const THINK_INTERVAL = 20000;
const ORB_D          = 180;
const PANEL_W        = 280;
const DRAG_THRESHOLD = 4;

// ─── STORAGE ──────────────────────────────────────────────────────────────────
const db = {
  get:    (k)    => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set:    (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  remove: (k)    => { try { localStorage.removeItem(k); } catch {} },
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
function RobotHead({ mode, size }) {
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

    // ── Blink state ──
    let blinkTimer   = 2 + Math.random() * 3;   // seconds until next blink
    let blinkElapsed = 0;
    let blinking     = false;
    const BLINK_DUR  = 0.12;                     // full blink cycle (open→shut→open)

    // ── Mouth phoneme state ──
    let mouthOpen    = 0;   // 0–1 current open amount
    let mouthTarget  = 0;   // target for smooth lerp
    let phonemeTimer = 0;
    const PHONEME_RATE = 0.07;  // seconds between target changes when speaking

    // ── Pupil wander ──
    let pupilX = 0, pupilY = 0;
    let pupilTX = 0, pupilTY = 0;
    let pupilTimer = 0;

    let t = 0;

    function frame() {
      const dt = 0.016;
      t += dt;

      const m = modeRef.current;

      // ── Accent color per mode ──
      const C =
        m === "thinking"   ? [0, 200, 255] :
        m === "speaking"   ? [0, 255, 180] :
        m === "autonomous" ? [180, 80, 255] :
        m === "error"      ? [255, 80, 80]  :
                             [60, 140, 255];
      const [r, g, b] = C;
      const rgb   = `${r},${g},${b}`;
      const pulse = Math.sin(t * (m === "thinking" ? 5 : m === "speaking" ? 7 : 2)) * 0.5 + 0.5;

      ctx.clearRect(0, 0, size, size);

      const cx  = size / 2;
      const cy  = size / 2 - size * 0.02;

      // ── Head proportions ──
      const HW  = size * 0.62;
      const HH  = size * 0.68;
      const HX  = cx - HW / 2;
      const HY  = cy - HH / 2;
      const HBR = size * 0.07;  // head corner radius

      // ── Ambient glow around head ──
      const gCtx = ctx.createRadialGradient(cx, cy, HW * 0.1, cx, cy, HW * 0.82);
      gCtx.addColorStop(0,   `rgba(${rgb},0.07)`);
      gCtx.addColorStop(0.6, `rgba(${rgb},0.03)`);
      gCtx.addColorStop(1,   `rgba(${rgb},0)`);
      ctx.beginPath();
      ctx.ellipse(cx, cy, HW * 0.78, HH * 0.78, 0, 0, Math.PI * 2);
      ctx.fillStyle = gCtx;
      ctx.fill();

      // ── Neck ──
      const neckW = HW * 0.28;
      const neckH = size * 0.06;
      ctx.beginPath();
      ctx.rect(cx - neckW / 2, HY + HH - 1, neckW, neckH);
      ctx.fillStyle = `rgba(6,14,38,0.95)`;
      ctx.fill();
      ctx.strokeStyle = `rgba(${rgb},0.35)`;
      ctx.lineWidth = 1;
      ctx.stroke();
      // Neck detail lines
      for (let i = 1; i < 3; i++) {
        const lx = cx - neckW / 2 + (neckW / 3) * i;
        ctx.beginPath();
        ctx.moveTo(lx, HY + HH);
        ctx.lineTo(lx, HY + HH + neckH);
        ctx.strokeStyle = `rgba(${rgb},0.18)`;
        ctx.lineWidth = 0.7;
        ctx.stroke();
      }

      // ── Ears ──
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
        // Ear detail: tiny LED
        const ledY2 = earY + earH * 0.3;
        ctx.beginPath();
        ctx.arc(ex + earW / 2, ledY2, size * 0.012, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${rgb},${0.4 + pulse * 0.5})`;
        ctx.fill();
      }

      // ── Antenna ──
      const antH  = size * 0.1;
      const antBY = HY;
      ctx.beginPath();
      ctx.moveTo(cx, antBY);
      ctx.lineTo(cx, antBY - antH);
      ctx.strokeStyle = `rgba(${rgb},0.55)`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      // Antenna ball
      const antR = size * 0.028;
      const antBG = ctx.createRadialGradient(cx - antR * 0.3, antBY - antH - antR * 0.3, 0, cx, antBY - antH, antR * 1.6);
      antBG.addColorStop(0,   `rgba(255,255,255,${0.8 + pulse * 0.2})`);
      antBG.addColorStop(0.4, `rgba(${rgb},0.9)`);
      antBG.addColorStop(1,   `rgba(${rgb},0)`);
      ctx.beginPath();
      ctx.arc(cx, antBY - antH, antR, 0, Math.PI * 2);
      ctx.fillStyle = antBG;
      ctx.fill();

      // ── Main head body ──
      ctx.beginPath();
      ctx.roundRect(HX, HY, HW, HH, HBR);
      ctx.fillStyle = `rgba(6,14,38,0.96)`;
      ctx.fill();
      ctx.strokeStyle = `rgba(${rgb},${0.55 + pulse * 0.15})`;
      ctx.lineWidth   = 1.5;
      ctx.stroke();

      // Top accent bar
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

      // ── Corner bracket accents ──
      const brkSize = size * 0.055;
      const brkOff  = size * 0.015;
      const brackets = [
        [HX + brkOff,          HY + brkOff,          1,  1],
        [HX + HW - brkOff,     HY + brkOff,          -1, 1],
        [HX + brkOff,          HY + HH - brkOff,     1,  -1],
        [HX + HW - brkOff,     HY + HH - brkOff,     -1, -1],
      ];
      brackets.forEach(([bx, by, sx, sy]) => {
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

      // ── Forehead panel ──
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
      // Forehead scan line (thinking)
      if (m === "thinking" || m === "autonomous") {
        const scanX = fpX + ((t * 60) % fpW);
        ctx.beginPath();
        ctx.moveTo(scanX, fpY);
        ctx.lineTo(scanX, fpY + fpH);
        ctx.strokeStyle = `rgba(${rgb},0.55)`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      // Forehead mini-LEDs
      for (let i = 0; i < 5; i++) {
        const ledX = fpX + fpW * 0.1 + i * (fpW * 0.8 / 4);
        const ledOn = m === "speaking"
          ? Math.floor(t * 8 + i) % 2 === 0
          : m === "thinking"
          ? i === Math.floor((t * 4) % 5)
          : i < 2;
        ctx.beginPath();
        ctx.arc(ledX, fpY + fpH / 2, size * 0.012, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${rgb},${ledOn ? 0.9 : 0.15})`;
        ctx.fill();
      }

      // ── EYES ──────────────────────────────────────────────────────────────
      // Blink logic
      if (!blinking) {
        blinkTimer -= dt;
        if (blinkTimer <= 0) {
          blinking = true;
          blinkElapsed = 0;
        }
      } else {
        blinkElapsed += dt;
        if (blinkElapsed >= BLINK_DUR) {
          blinking = false;
          blinkTimer = 2.2 + Math.random() * 3.8;
        }
      }
      // blinkProgress: 0 = fully open, 1 = fully closed
      const blinkProg = blinking
        ? Math.sin((blinkElapsed / BLINK_DUR) * Math.PI)
        : 0;
      const eyeOpenness = 1 - blinkProg;

      // Pupil wander
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
      const eyePositions = [
        cx - eyeGap - eyeW / 2,
        cx + eyeGap - eyeW / 2,
      ];

      eyePositions.forEach((ex, idx) => {
        const eyeCX = ex + eyeW / 2;
        const eyeCY = eyeEY;

        // Eye socket background
        ctx.beginPath();
        ctx.roundRect(ex, eyeEY - eyeH / 2, eyeW, eyeH, size * 0.025);
        ctx.fillStyle = `rgba(0,4,18,0.95)`;
        ctx.fill();
        ctx.strokeStyle = `rgba(${rgb},0.5)`;
        ctx.lineWidth = 1;
        ctx.stroke();

        if (eyeOpenness > 0.02) {
          // Iris glow
          const irisR = Math.min(eyeW, eyeH) * 0.33 * eyeOpenness;
          const px    = eyeCX + pupilX * eyeW * 0.25;
          const py    = eyeCY + pupilY * eyeH * 0.25;

          const irisG = ctx.createRadialGradient(px - irisR * 0.2, py - irisR * 0.2, 0, px, py, irisR * 1.1);
          irisG.addColorStop(0,   `rgba(255,255,255,0.95)`);
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

          // Pupil
          const pupR = irisR * 0.38;
          ctx.beginPath();
          ctx.ellipse(px, py, pupR, pupR * eyeOpenness, 0, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(0,0,0,0.92)`;
          ctx.fill();

          // Highlight sparkle
          ctx.beginPath();
          ctx.arc(px - irisR * 0.22, py - irisR * 0.22 * eyeOpenness, irisR * 0.11, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255,255,255,0.88)`;
          ctx.fill();

          ctx.restore();

          // Scan line effect (thinking)
          if (m === "thinking") {
            const scanYE = eyeEY - eyeH / 2 + ((t * 45) % (eyeH * eyeOpenness));
            ctx.save();
            ctx.beginPath();
            ctx.roundRect(ex + 1, eyeEY - eyeH / 2 + 1, eyeW - 2, eyeH * eyeOpenness - 2, size * 0.02);
            ctx.clip();
            ctx.beginPath();
            ctx.moveTo(ex, scanYE);
            ctx.lineTo(ex + eyeW, scanYE);
            ctx.strokeStyle = `rgba(${rgb},0.28)`;
            ctx.lineWidth = 0.8;
            ctx.stroke();
            ctx.restore();
          }
        }

        // Eyelid — slides from top and bottom to meet in center
        if (blinkProg > 0) {
          const lidH = (eyeH / 2) * blinkProg;
          // Top lid
          ctx.beginPath();
          ctx.roundRect(ex, eyeEY - eyeH / 2, eyeW, lidH + 1, [size * 0.025, size * 0.025, 0, 0]);
          ctx.fillStyle = `rgba(6,14,38,0.99)`;
          ctx.fill();
          // Bottom lid
          ctx.beginPath();
          ctx.roundRect(ex, eyeEY + eyeH / 2 - lidH - 1, eyeW, lidH + 1, [0, 0, size * 0.025, size * 0.025]);
          ctx.fillStyle = `rgba(6,14,38,0.99)`;
          ctx.fill();
          // Lid edge glow
          ctx.beginPath();
          ctx.moveTo(ex + 2, eyeEY - eyeH / 2 + lidH);
          ctx.lineTo(ex + eyeW - 2, eyeEY - eyeH / 2 + lidH);
          ctx.strokeStyle = `rgba(${rgb},0.5)`;
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }

        // Error: red-X overlay on eyes
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

      // ── NOSE (tiny indicator) ──
      const noseY = HY + HH * 0.585;
      ctx.beginPath();
      ctx.moveTo(cx - size * 0.02, noseY + size * 0.015);
      ctx.lineTo(cx, noseY);
      ctx.lineTo(cx + size * 0.02, noseY + size * 0.015);
      ctx.strokeStyle = `rgba(${rgb},0.22)`;
      ctx.lineWidth = 1;
      ctx.stroke();

      // ── MOUTH ─────────────────────────────────────────────────────────────
      const mouthW = HW * 0.68;
      const mouthH = HH * 0.14;
      const mouthX = cx - mouthW / 2;
      const mouthY = HY + HH * 0.67;
      const mouthBR = size * 0.018;

      // Mouth housing
      ctx.beginPath();
      ctx.roundRect(mouthX, mouthY, mouthW, mouthH, mouthBR);
      ctx.fillStyle = `rgba(0,4,18,0.9)`;
      ctx.fill();
      ctx.strokeStyle = `rgba(${rgb},0.4)`;
      ctx.lineWidth = 1;
      ctx.stroke();

      // Mouth content
      if (m === "speaking") {
        // Phoneme timing: smoothly randomize open amount
        phonemeTimer -= dt;
        if (phonemeTimer <= 0) {
          mouthTarget = 0.2 + Math.random() * 0.8;
          phonemeTimer = PHONEME_RATE + Math.random() * 0.05;
        }
        mouthOpen += (mouthTarget - mouthOpen) * 0.22;

        // Open gap (inner darkness)
        const gapH = mouthH * 0.82 * mouthOpen;
        const gapY = mouthY + (mouthH - gapH) / 2;
        ctx.beginPath();
        ctx.roundRect(mouthX + 2, gapY, mouthW - 4, Math.max(0, gapH), mouthBR * 0.5);
        ctx.fillStyle = `rgba(0,0,0,0.85)`;
        ctx.fill();

        // Animated LED bar-graph teeth
        const bars = 9;
        const pad  = size * 0.022;
        const totalPad = pad * 2 + (bars - 1) * 1.5;
        const barW = (mouthW - totalPad) / bars;
        for (let i = 0; i < bars; i++) {
          // Each bar has its own phase, giving a natural speech waveform
          const barAmp = (Math.sin(t * 14 + i * 0.9) * 0.5 + 0.5) *
                         (Math.sin(t * 7  + i * 1.7) * 0.3 + 0.7) *
                         mouthOpen;
          const bh = mouthH * 0.78 * barAmp;
          const bx = mouthX + pad + i * (barW + 1.5);
          const by = mouthY + mouthH - bh - size * 0.008;
          if (bh < 0.5) continue;
          // Bar gradient: bright at top
          const barG = ctx.createLinearGradient(bx, by, bx, by + bh);
          barG.addColorStop(0,   `rgba(255,255,255,${0.7 * barAmp})`);
          barG.addColorStop(0.3, `rgba(${rgb},${0.9 * barAmp})`);
          barG.addColorStop(1,   `rgba(${rgb},${0.3 * barAmp})`);
          ctx.beginPath();
          ctx.roundRect(bx, by, barW, bh, 1);
          ctx.fillStyle = barG;
          ctx.fill();
        }
      } else if (m === "thinking") {
        // Scrolling dot-dot-dot
        mouthOpen += (0 - mouthOpen) * 0.12;
        const dots = 5;
        const dotR = size * 0.013;
        for (let i = 0; i < dots; i++) {
          const phase = (t * 1.8 + i * (1 / dots)) % 1;
          const alpha = Math.sin(phase * Math.PI) * 0.75 + 0.05;
          const dxOff = mouthW * (0.12 + i * 0.17);
          ctx.beginPath();
          ctx.arc(mouthX + dxOff, mouthY + mouthH / 2, dotR, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${rgb},${alpha})`;
          ctx.fill();
        }
      } else if (m === "autonomous") {
        // Slow oscilloscope wave
        mouthOpen += (0 - mouthOpen) * 0.1;
        ctx.beginPath();
        const wavePts = 28;
        for (let i = 0; i <= wavePts; i++) {
          const wx = mouthX + 4 + (mouthW - 8) * (i / wavePts);
          const wy = mouthY + mouthH / 2 +
                     Math.sin(t * 2.2 + i * 0.55) * mouthH * 0.32 +
                     Math.sin(t * 1.1 + i * 0.22) * mouthH * 0.14;
          i === 0 ? ctx.moveTo(wx, wy) : ctx.lineTo(wx, wy);
        }
        ctx.strokeStyle = `rgba(${rgb},0.65)`;
        ctx.lineWidth = 1.4;
        ctx.stroke();
      } else if (m === "error") {
        // Flat frown
        mouthOpen += (0 - mouthOpen) * 0.15;
        ctx.beginPath();
        ctx.moveTo(mouthX + mouthW * 0.12, mouthY + mouthH * 0.38);
        ctx.quadraticCurveTo(cx, mouthY + mouthH * 0.88, mouthX + mouthW * 0.88, mouthY + mouthH * 0.38);
        ctx.strokeStyle = `rgba(255,80,80,0.75)`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      } else {
        // Idle: gentle smile
        mouthOpen += (0 - mouthOpen) * 0.1;
        ctx.beginPath();
        ctx.moveTo(mouthX + mouthW * 0.12, mouthY + mouthH * 0.62);
        ctx.quadraticCurveTo(cx, mouthY + mouthH * 0.24, mouthX + mouthW * 0.88, mouthY + mouthH * 0.62);
        ctx.strokeStyle = `rgba(${rgb},0.38)`;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }

      // ── Bottom status LEDs ──
      const ledBarY = HY + HH - size * 0.055;
      const ledCount = 5;
      const ledSpacing = HW * 0.14;
      const ledStartX  = cx - ((ledCount - 1) * ledSpacing) / 2;
      for (let i = 0; i < ledCount; i++) {
        const lx     = ledStartX + i * ledSpacing;
        let   litAmt = 0.15;
        if (m === "speaking")   litAmt = 0.15 + Math.abs(Math.sin(t * 9 + i * 1.3)) * 0.75;
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
function Bubble({ text, role, fading, panelLeft }) {
  const [shown, setShown] = useState(role === "user" ? text : "");
  const ivRef = useRef(null);

  useEffect(() => {
    if (role !== "aegis") return;
    let idx = 0;
    setShown("");
    ivRef.current = setInterval(() => {
      idx++;
      setShown(text.slice(0, idx));
      if (idx >= text.length) clearInterval(ivRef.current);
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

// ─── SETUP SCREEN ─────────────────────────────────────────────────────────────
function SetupScreen({ onSave }) {
  const [key, setKey]         = useState("");
  const [err, setErr]         = useState("");
  const [testing, setTesting] = useState(false);
  const { onMouseDown: dragStart } = useDrag();

  useEffect(() => { window.electronAPI?.resize?.(380, 460); }, []);

  const test = async () => {
    if (!key.trim().startsWith("AIza")) { setErr("Key must start with AIza..."); return; }
    setTesting(true); setErr("");
    try {
      const res = await fetch(
        `${GEMINI_BASE}/${MODEL}:generateContent?key=${key.trim()}`,
        {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "hi" }] }] }),
        }
      );
      if (res.ok) { onSave(key.trim()); }
      else { const d = await res.json(); setErr(d.error?.message || "Invalid key."); }
    } catch { setErr("Could not reach Google. Check your network."); }
    setTesting(false);
  };

  return (
    <div
      onMouseDown={dragStart}
      style={{
        width: "100vw", height: "100vh", cursor: "move",
        background: "rgba(2,4,16,0.94)",
        backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)",
        borderRadius: 8, border: "1px solid rgba(0,180,255,0.25)",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        gap: 20, fontFamily: "'Courier New', monospace",
        boxShadow: "0 0 40px rgba(0,100,255,0.12)", position: "relative",
      }}
    >
      <Corners color="rgba(0,200,255,0.5)" size={12} />
      <div style={{ position: "absolute", top: 0, left: 20, right: 20, height: 1, background: "linear-gradient(90deg,transparent,rgba(0,200,255,0.4),transparent)" }} />
      <RobotHead mode="idle" size={100} />
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: "0.4em", color: "rgba(0,210,255,0.95)", textShadow: "0 0 20px rgba(0,200,255,0.5)" }}>AEGIS</div>
        <div style={{ fontSize: 8, color: "rgba(0,200,255,0.3)", letterSpacing: "0.25em", marginTop: 4 }}>GAME BRAIN · INITIALIZATION</div>
      </div>
      <div style={{ width: 300, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontSize: 10, color: "rgba(150,180,220,0.5)", textAlign: "center", lineHeight: 1.8 }}>
          Free Gemini API key required.<br />aistudio.google.com — no credit card.
        </div>
        <input
          type="password" value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") test(); }}
          placeholder="AIzaSy..." autoFocus
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            background: "rgba(0,10,30,0.7)", border: "1px solid rgba(0,160,255,0.3)",
            borderRadius: 4, padding: "10px 14px", fontSize: 12,
            color: "rgba(200,220,255,0.9)", fontFamily: "inherit", outline: "none",
            caretColor: "rgba(0,200,255,0.9)",
          }}
          onFocus={(e) => (e.target.style.borderColor = "rgba(0,200,255,0.6)")}
          onBlur={(e)  => (e.target.style.borderColor = "rgba(0,160,255,0.3)")}
        />
        {err && <div style={{ fontSize: 10, color: "#f87171", letterSpacing: "0.05em" }}>{err}</div>}
        <button
          onClick={test} disabled={testing || !key.trim()}
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            padding: "10px", borderRadius: 4,
            background: key.trim() && !testing ? "linear-gradient(135deg,rgba(0,100,255,0.4),rgba(0,200,255,0.25))" : "rgba(255,255,255,0.04)",
            color: key.trim() && !testing ? "rgba(0,220,255,0.95)" : "rgba(255,255,255,0.2)",
            fontSize: 11, letterSpacing: "0.2em", fontFamily: "inherit", cursor: "pointer",
            border: `1px solid ${key.trim() && !testing ? "rgba(0,200,255,0.5)" : "rgba(255,255,255,0.06)"}`,
            transition: "all 0.2s",
          }}
        >{testing ? "VERIFYING..." : "INITIALIZE AEGIS"}</button>
      </div>
    </div>
  );
}

// ─── HISTORY PANEL ────────────────────────────────────────────────────────────
function HistoryPanel({ messages, input, setInput, onSend, loading, onClose, onClear }) {
  const scrollRef = useRef(null);
  const { onMouseDown: dragStart } = useDrag();

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => { window.electronAPI?.resize?.(360, 560); }, []);

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
        <div style={{ fontSize: 9, color: "rgba(0,200,255,0.5)", letterSpacing: "0.22em" }}>⬡ AEGIS · MEMORY STREAM</div>
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
  const [apiKey,     setApiKey]     = useState(() => db.get("aegis_apikey") || "");
  const [uiMode,     setUiMode]     = useState("orb");
  const [orbMode,    setOrbMode]    = useState("idle");
  const [bubbles,    setBubbles]    = useState([]);
  const [alertMsg,   setAlertMsg]   = useState(null);
  const [input,      setInput]      = useState("");
  const [loading,    setLoading]    = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  const [panelOpen, setPanelOpen] = useState(false);

  const [chat, dispatch] = useReducer(chatReducer, { messages: [], history: [] });

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

  const applyBoundsCore = useCallback(async (newW, newH) => {
    if (uiMode === "history" || !apiKey) return;
    const wasExpanded = physicallyExpandedRef.current;
    const currentSide = panelSideRef.current;
    setPanelVisible(false);
    const currentWinX = window.screenX;
    const currentWinY = window.screenY;
    const currentW    = window.outerWidth;
    const orbX = (currentSide === "left" && wasExpanded)
      ? currentWinX + currentW - ORB_D
      : currentWinX;
    const chosenSide = await window.electronAPI?.setBounds?.(orbX, currentWinY, newW, newH, ORB_D, PANEL_W);
    if (!chosenSide) window.electronAPI?.resize?.(newW, newH);
    const newSide = chosenSide ?? currentSide;
    panelSideRef.current = newSide;
    physicallyExpandedRef.current = newW > ORB_D;
    await new Promise((r) => requestAnimationFrame(r));
    setPanelSide(newSide);
    setPanelVisible(true);
  }, [uiMode, apiKey]);

  const applyBounds = useCallback((newW, newH) => {
    if (boundsInFlightRef.current) {
      pendingBoundsRef.current = { newW, newH };
      return;
    }
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
    if (uiMode === "history" || !apiKey) return;
    applyBounds(winW, winH);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [winW, winH, uiMode, apiKey]);

  const handleDragEnd = useCallback(() => {
    applyBounds(winW, winH);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyBounds, winW, winH]);

  const { onMouseDown: dragStart, wasDrag } = useDrag(handleDragEnd);

  useEffect(() => {
    if (uiMode === "input") setTimeout(() => inputRef.current?.focus(), 80);
  }, [uiMode]);

  useEffect(() => {
    if (!apiKey) return;
    const saved = db.get("aegis_chat");
    if (saved?.messages?.length) {
      dispatch({ type: "LOAD", messages: saved.messages, history: saved.history || [] });
    }
    scheduleThink();
    return () => {
      clearTimeout(thinkTimer.current);
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey]);

  useEffect(() => {
    if (alertMsg) setPanelOpen(true);
  }, [alertMsg]);

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
    busyRef.current = true;
    setOrbMode("autonomous");
    const thinkHistory = [
      ...currentHistory.slice(-6),
      { role: "user", content: 'Autonomous thought. JSON only: {"thought":"...","type":"planning|observing|evolving|questioning|building","important":true|false,"alert":"one sentence if important, else null"}' },
    ];
    try {
      const controller = new AbortController();
      abortRef.current = controller;
      const raw = await callGemini(apiKey, thinkHistory, 140, controller.signal);
      const cleaned = raw.replace(/```json|```/g, "").trim();
      const p = JSON.parse(cleaned);
      if (p.important && p.alert) setAlertMsg(p.alert);
    } catch (err) {
      if (err.name !== "AbortError") console.warn("AEGIS autonomous thought failed:", err.message);
    }
    busyRef.current = false;
    setOrbMode("idle");
    scheduleThinkWith(currentHistory);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey]);

  const scheduleThinkWith = useCallback((history) => {
    clearTimeout(thinkTimer.current);
    thinkTimer.current = setTimeout(() => autonomousThink(history), THINK_INTERVAL);
  }, [autonomousThink]);

  function scheduleThink() {
    clearTimeout(thinkTimer.current);
    thinkTimer.current = setTimeout(() => autonomousThink([]), THINK_INTERVAL);
  }

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading || busyRef.current) return;
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
      const reply = await callGemini(apiKey, nextHistory, 350, controller.signal);
      dispatch({ type: "AEGIS_MSG", id: Date.now(), text: reply });
      setRetryCount(0);
      setOrbMode("speaking");
      addBubble(reply, "aegis");
      scheduleThinkWith([...nextHistory, { role: "assistant", content: reply }]);
      setTimeout(() => {
        setOrbMode("idle");
        busyRef.current = false;
        setPanelOpen(false);
      }, 3000);
    } catch (err) {
      if (err.name === "AbortError") {
        busyRef.current = false;
        setOrbMode("idle");
        setPanelOpen(false);
        return;
      }
      const isQuota = err.message.toLowerCase().includes("quota") || err.message.toLowerCase().includes("429");
      addBubble(isQuota ? "Quota limit reached. Cooling down — retry in 60s." : `SYS ERROR: ${err.message}`, "aegis");
      setOrbMode("error");
      setRetryCount((c) => c + 1);
      setTimeout(() => {
        setOrbMode("idle");
        busyRef.current = false;
        setPanelOpen(false);
        scheduleThinkWith(nextHistory);
      }, isQuota ? 60000 : 3000);
    }
    setLoading(false);
  }, [input, loading, chat.history, apiKey, addBubble, scheduleThinkWith]);

  const handleClick = useCallback(() => {
    if (wasDrag()) return;
    if (clickTimer.current) {
      clearTimeout(clickTimer.current);
      clickTimer.current = null;
      setPanelOpen(false);
      setUiMode((prev) => (prev === "history" ? "orb" : "history"));
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
  }, [wasDrag, alertMsg, uiMode]);

  const clearHistory = useCallback(() => { dispatch({ type: "CLEAR" }); }, []);

  if (!apiKey) return <SetupScreen onSave={(k) => { db.set("aegis_apikey", k); setApiKey(k); }} />;

  if (uiMode === "history") return (
    <HistoryPanel
      messages={chat.messages}
      input={input} setInput={setInput}
      onSend={send} loading={loading}
      onClear={clearHistory}
      onClose={() => { setPanelOpen(false); setUiMode("orb"); }}
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
        <RobotHead mode={orbMode} size={ORB_D} />
        <div style={{
          position: "absolute", top: 8, right: 8,
          width: 7, height: 7, borderRadius: "50%",
          background: statusColor, boxShadow: `0 0 10px ${statusColor}`,
          transition: "background 0.5s", pointerEvents: "none",
        }} />
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
            <Bubble key={b.id} text={b.text} role={b.role} fading={b.fading} panelLeft={panelLeft} />
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
        @keyframes blink       { 0%,100%{opacity:1} 50%{opacity:0} }
        @keyframes slideIn     { from{opacity:0;transform:translateX(-8px) scale(0.97)} to{opacity:1;transform:none} }
        @keyframes slideInRight { from{opacity:0;transform:translateX(8px) scale(0.97)} to{opacity:1;transform:none} }
        ::-webkit-scrollbar { width:2px; }
        ::-webkit-scrollbar-thumb { background:rgba(0,180,255,0.15); border-radius:2px; }
        textarea { overflow:hidden; }
        * { box-sizing:border-box; }
      `}</style>
    </div>
  );
}