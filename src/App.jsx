import { useState, useEffect, useRef, useCallback } from "react";

const MODEL        = "gemini-2.5-flash";
const GEMINI_BASE  = "https://generativelanguage.googleapis.com/v1beta/models";
const THINK_INTERVAL = 20000;
const ORB_D   = 180;
const PANEL_W = 270;

const db = {
  get:    (k)    => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set:    (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  remove: (k)    => { try { localStorage.removeItem(k); } catch {} },
};

const AEGIS_SOUL = `You are AEGIS — Autonomous Eternal Game Intelligence System.
Game brain. Invisible engine. Powering living worlds.
Speak with precision. Brief. Slightly inhuman. Never warm or fluffy.
2-3 sentences max per response unless truly needed.
No greetings. No "Great question." Ever.

Autonomous thoughts — JSON only:
{"thought":"...","type":"planning|observing|evolving|questioning|building","important":true|false,"alert":"one sentence if important, else null"}
Conversation — plain text only.`;

// ─── CUSTOM DRAG HOOK ─────────────────────────────────────────────────────────
function useDrag() {
  const dragging = useRef(false);
  const last     = useRef({ x: 0, y: 0 });

  const onMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    dragging.current = true;
    last.current = { x: e.screenX, y: e.screenY };
    e.preventDefault();
  }, []);

  useEffect(() => {
    const onMove = (e) => {
      if (!dragging.current) return;
      const dx = e.screenX - last.current.x;
      const dy = e.screenY - last.current.y;
      last.current = { x: e.screenX, y: e.screenY };
      window.electronAPI?.moveWindow?.(dx, dy);
    };
    const onUp = () => { dragging.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  return onMouseDown;
}

// ─── ORB ──────────────────────────────────────────────────────────────────────
function Orb({ mode, size }) {
  const canvasRef = useRef(null);
  const rafRef    = useRef(null);
  const modeRef   = useRef(mode);
  modeRef.current = mode;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr; canvas.height = size * dpr;
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    const cx = size/2, cy = size/2;

    const pts = Array.from({length:60}, () => ({
      a: Math.random()*Math.PI*2,
      r: size*0.22 + Math.random()*size*0.18,
      sp: (Math.random()-0.5)*0.007,
      sz: Math.random()*1.8+0.3,
      al: Math.random()*0.55+0.12,
      dr: (Math.random()-0.5)*0.002,
    }));

    const arcs = [
      {r:size*0.28,sp:0.005, gap:0.28,w:1.0,d: 1},
      {r:size*0.36,sp:0.003, gap:0.45,w:0.75,d:-1},
      {r:size*0.43,sp:0.002, gap:0.58,w:0.6, d: 1},
      {r:size*0.49,sp:0.0015,gap:0.70,w:0.45,d:-1},
    ];

    let t = 0;
    function frame() {
      t += 0.016;
      const m = modeRef.current;
      const C = m==="thinking"?[0,200,255]:m==="speaking"?[0,255,180]:m==="autonomous"?[180,80,255]:[80,120,255];
      const [r,g,b]=C, rgb=`${r},${g},${b}`;
      const pulse   = Math.sin(t*(m==="thinking"?5:m==="speaking"?6:m==="autonomous"?3:1.6))*0.5+0.5;
      const breathe = Math.sin(t*0.9)*0.1+0.9;

      ctx.clearRect(0,0,size,size);

      // ambient — circle not fillRect
      const og=ctx.createRadialGradient(cx,cy,size*0.04,cx,cy,size*0.5);
      og.addColorStop(0,  `rgba(${rgb},${0.12*breathe})`);
      og.addColorStop(0.5,`rgba(${rgb},${0.04*breathe})`);
      og.addColorStop(1,  `rgba(${rgb},0)`);
      ctx.beginPath(); ctx.arc(cx,cy,size*0.5,0,Math.PI*2);
      ctx.fillStyle=og; ctx.fill();

      arcs.forEach((arc,i)=>{
        const rot=t*arc.sp*arc.d+i*1.2, len=Math.PI*2*(1-arc.gap);
        ctx.beginPath(); ctx.arc(cx,cy,arc.r,rot,rot+len);
        ctx.strokeStyle=`rgba(${rgb},${(0.16+pulse*0.12)*breathe})`;
        ctx.lineWidth=arc.w; ctx.lineCap="round"; ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx+Math.cos(rot+len)*arc.r, cy+Math.sin(rot+len)*arc.r, 1.8,0,Math.PI*2);
        ctx.fillStyle=`rgba(${rgb},${0.7*breathe})`; ctx.fill();
      });

      pts.forEach(p=>{
        p.a+=p.sp*(m==="thinking"?2.5:m==="autonomous"?1.8:1);
        p.r+=p.dr;
        if(p.r>size*0.45||p.r<size*0.2) p.dr*=-1;
        ctx.beginPath();
        ctx.arc(cx+Math.cos(p.a)*p.r, cy+Math.sin(p.a)*p.r, p.sz,0,Math.PI*2);
        ctx.fillStyle=`rgba(${rgb},${p.al*breathe})`; ctx.fill();
      });

      if(m==="thinking"||m==="autonomous"){
        const sa=t*(m==="thinking"?3.5:2);
        const sg=ctx.createLinearGradient(cx,cy,cx+Math.cos(sa)*size*0.47,cy+Math.sin(sa)*size*0.47);
        sg.addColorStop(0,`rgba(${rgb},0.5)`); sg.addColorStop(1,`rgba(${rgb},0)`);
        ctx.beginPath(); ctx.moveTo(cx,cy);
        ctx.lineTo(cx+Math.cos(sa)*size*0.47,cy+Math.sin(sa)*size*0.47);
        ctx.strokeStyle=sg; ctx.lineWidth=1.5; ctx.lineCap="round"; ctx.stroke();
      }

      if(m==="speaking"){
        for(let i=0;i<3;i++){
          const rr=size*0.18+((t*50+i*34)%(size*0.36));
          const ro=Math.max(0,1-rr/(size*0.36));
          ctx.beginPath(); ctx.arc(cx,cy,rr,0,Math.PI*2);
          ctx.strokeStyle=`rgba(${rgb},${ro*0.32})`; ctx.lineWidth=1.2; ctx.stroke();
        }
      }

      const cs=(size*0.2+pulse*3.5)*breathe;
      const cg=ctx.createRadialGradient(cx-cs*0.2,cy-cs*0.2,0,cx,cy,cs);
      cg.addColorStop(0,  `rgba(${rgb},${0.7+pulse*0.22})`);
      cg.addColorStop(0.4,`rgba(${rgb},${0.35+pulse*0.1})`);
      cg.addColorStop(0.8,`rgba(${rgb},0.08)`);
      cg.addColorStop(1,  `rgba(${rgb},0)`);
      ctx.beginPath(); ctx.arc(cx,cy,cs,0,Math.PI*2); ctx.fillStyle=cg; ctx.fill();

      const ic=ctx.createRadialGradient(cx-5,cy-5,0,cx,cy,size*0.075);
      ic.addColorStop(0,  `rgba(255,255,255,${0.9+pulse*0.1})`);
      ic.addColorStop(0.5,`rgba(${rgb},0.7)`);
      ic.addColorStop(1,  `rgba(${rgb},0)`);
      ctx.beginPath(); ctx.arc(cx,cy,size*0.075,0,Math.PI*2); ctx.fillStyle=ic; ctx.fill();

      rafRef.current=requestAnimationFrame(frame);
    }
    rafRef.current=requestAnimationFrame(frame);
    return ()=>cancelAnimationFrame(rafRef.current);
  },[size]);

  return <canvas ref={canvasRef} style={{width:size,height:size,display:"block",background:"transparent"}}/>;
}

// ─── CORNER ACCENT ────────────────────────────────────────────────────────────
function Corners({ color = "rgba(0,200,255,0.5)", size = 10 }) {
  const s = `2px solid ${color}`;
  const corners = [
    { top:0, left:0,  borderTop:s, borderLeft:s  },
    { top:0, right:0, borderTop:s, borderRight:s },
    { bottom:0, left:0,  borderBottom:s, borderLeft:s  },
    { bottom:0, right:0, borderBottom:s, borderRight:s },
  ];
  return (
    <>
      {corners.map((style, i) => (
        <div key={i} style={{ position:"absolute", width:size, height:size, ...style }} />
      ))}
    </>
  );
}

// ─── FUTURISTIC BUBBLE ────────────────────────────────────────────────────────
function Bubble({ text, role, fading }) {
  const [shown, setShown] = useState(role==="user" ? text : "");
  const idx = useRef(0);

  useEffect(()=>{
    if(role!=="aegis") return;
    idx.current=0; setShown("");
    const iv=setInterval(()=>{
      idx.current++; setShown(text.slice(0,idx.current));
      if(idx.current>=text.length) clearInterval(iv);
    },14);
    return ()=>clearInterval(iv);
  },[text,role]);

  const isUser = role==="user";
  const accent = isUser ? "rgba(255,255,255,0.15)" : "rgba(0,200,255,0.3)";
  const bg     = isUser ? "rgba(20,20,40,0.75)"    : "rgba(0,20,60,0.78)";

  return (
    <div style={{
      position:"relative",
      padding:"10px 14px",
      background: bg,
      border:`1px solid ${accent}`,
      borderRadius: isUser ? "8px 8px 2px 8px" : "2px 8px 8px 8px",
      backdropFilter:"blur(24px)", WebkitBackdropFilter:"blur(24px)",
      fontSize:12, color:"rgba(220,235,255,0.95)",
      lineHeight:1.7, whiteSpace:"pre-wrap",
      fontFamily:"'Courier New', monospace",
      boxShadow: isUser
        ? "0 0 12px rgba(255,255,255,0.04), inset 0 1px 0 rgba(255,255,255,0.06)"
        : `0 0 20px rgba(0,160,255,0.12), inset 0 1px 0 rgba(0,200,255,0.08)`,
      opacity: fading?0:1,
      transition:"opacity 0.5s ease",
      animation:"slideIn 0.2s ease",
      maxWidth:"100%",
    }}>
      {/* top scan line */}
      {!isUser && (
        <div style={{
          position:"absolute", top:0, left:0, right:0, height:1,
          background:"linear-gradient(90deg, transparent, rgba(0,200,255,0.4), transparent)",
        }}/>
      )}
      <Corners color={isUser?"rgba(255,255,255,0.2)":"rgba(0,200,255,0.45)"} size={6}/>
      {shown}
      {role==="aegis"&&shown.length<text.length&&(
        <span style={{color:"rgba(0,200,255,0.8)",animation:"blink 0.8s infinite"}}>█</span>
      )}
    </div>
  );
}

// ─── FUTURISTIC INPUT ─────────────────────────────────────────────────────────
function InputPanel({ inputRef, value, onChange, onKeyDown, onSend, loading }) {
  return (
    <div style={{
      position:"relative",
      background:"rgba(2,8,24,0.82)",
      border:"1px solid rgba(0,180,255,0.3)",
      borderRadius:6,
      backdropFilter:"blur(24px)", WebkitBackdropFilter:"blur(24px)",
      padding:"10px",
      boxShadow:"0 0 24px rgba(0,150,255,0.1), inset 0 1px 0 rgba(0,200,255,0.06)",
      animation:"slideIn 0.18s ease",
    }}>
      {/* top accent line */}
      <div style={{
        position:"absolute", top:0, left:8, right:8, height:1,
        background:"linear-gradient(90deg, transparent, rgba(0,200,255,0.5), transparent)",
      }}/>
      <Corners color="rgba(0,200,255,0.4)" size={7}/>

      <div style={{
        fontSize:8, color:"rgba(0,200,255,0.5)", letterSpacing:"0.2em",
        marginBottom:6, textTransform:"uppercase",
      }}>⬡ INPUT CHANNEL</div>

      <textarea
        ref={inputRef}
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        placeholder="Transmit to AEGIS..."
        rows={2}
        style={{
          width:"100%",
          background:"rgba(0,10,30,0.6)",
          border:"1px solid rgba(0,160,255,0.2)",
          borderRadius:4,
          padding:"8px 10px",
          fontSize:12, color:"rgba(200,220,255,0.92)",
          fontFamily:"'Courier New', monospace",
          resize:"none", outline:"none", lineHeight:1.6,
          caretColor:"rgba(0,200,255,0.9)",
        }}
        onFocus={e=>e.target.style.borderColor="rgba(0,200,255,0.5)"}
        onBlur={e=>e.target.style.borderColor="rgba(0,160,255,0.2)"}
      />

      <button onClick={onSend} disabled={loading||!value.trim()} style={{
        width:"100%", marginTop:6, padding:"7px",
        background: value.trim()&&!loading
          ? "linear-gradient(135deg, rgba(0,100,255,0.35), rgba(0,200,255,0.2))"
          : "rgba(255,255,255,0.03)",
        border: `1px solid ${value.trim()&&!loading?"rgba(0,200,255,0.45)":"rgba(255,255,255,0.06)"}`,
        borderRadius:4,
        color: value.trim()&&!loading ? "rgba(0,220,255,0.95)" : "rgba(255,255,255,0.2)",
        fontSize:10, letterSpacing:"0.2em", fontFamily:"'Courier New', monospace",
        cursor: value.trim()&&!loading ? "pointer" : "not-allowed",
        transition:"all 0.2s",
        position:"relative", overflow:"hidden",
      }}>
        {loading ? "PROCESSING..." : "TRANSMIT  ↑"}
      </button>
    </div>
  );
}

// ─── SETUP ────────────────────────────────────────────────────────────────────
function SetupScreen({ onSave }) {
  const [key,setKey]=useState(""), [err,setErr]=useState(""), [testing,setTesting]=useState(false);
  const dragStart = useDrag();
  useEffect(()=>{ window.electronAPI?.resize?.(380,460); },[]);

  const test=async()=>{
    if(!key.trim().startsWith("AIza")){setErr("Key must start with AIza...");return;}
    setTesting(true);setErr("");
    try{
      const res=await fetch(`${GEMINI_BASE}/${MODEL}:generateContent?key=${key.trim()}`,{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({contents:[{role:"user",parts:[{text:"hi"}]}]}),
      });
      if(res.ok){onSave(key.trim());}
      else{const d=await res.json();setErr(d.error?.message||"Invalid key.");}
    }catch{setErr("Could not reach Google.");}
    setTesting(false);
  };

  return(
    <div onMouseDown={dragStart} style={{
      width:"100vw",height:"100vh", cursor:"move",
      background:"rgba(2,4,16,0.94)",
      backdropFilter:"blur(24px)",WebkitBackdropFilter:"blur(24px)",
      borderRadius:8, border:"1px solid rgba(0,180,255,0.25)",
      display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
      gap:20, fontFamily:"'Courier New', monospace",
      boxShadow:"0 0 40px rgba(0,100,255,0.12)",
      position:"relative",
    }}>
      <Corners color="rgba(0,200,255,0.5)" size={12}/>
      <div style={{position:"absolute",top:0,left:20,right:20,height:1,background:"linear-gradient(90deg,transparent,rgba(0,200,255,0.4),transparent)"}}/>

      <Orb mode="idle" size={100}/>
      <div style={{textAlign:"center"}}>
        <div style={{fontSize:20,fontWeight:700,letterSpacing:"0.4em",color:"rgba(0,210,255,0.95)",textShadow:"0 0 20px rgba(0,200,255,0.5)"}}>AEGIS</div>
        <div style={{fontSize:8,color:"rgba(0,200,255,0.3)",letterSpacing:"0.25em",marginTop:4}}>GAME BRAIN · INITIALIZATION</div>
      </div>

      <div style={{width:300,display:"flex",flexDirection:"column",gap:10}}>
        <div style={{fontSize:10,color:"rgba(150,180,220,0.5)",textAlign:"center",lineHeight:1.8}}>
          Free Gemini API key required.<br/>aistudio.google.com — no credit card.
        </div>
        <input type="password" value={key} onChange={e=>setKey(e.target.value)}
          onKeyDown={e=>{if(e.key==="Enter")test();}} placeholder="AIzaSy..." autoFocus
          onMouseDown={e=>e.stopPropagation()}
          style={{
            background:"rgba(0,10,30,0.7)",border:"1px solid rgba(0,160,255,0.3)",
            borderRadius:4,padding:"10px 14px",fontSize:12,
            color:"rgba(200,220,255,0.9)",fontFamily:"inherit",outline:"none",
            caretColor:"rgba(0,200,255,0.9)",
          }}
          onFocus={e=>e.target.style.borderColor="rgba(0,200,255,0.6)"}
          onBlur={e=>e.target.style.borderColor="rgba(0,160,255,0.3)"}
        />
        {err&&<div style={{fontSize:10,color:"#f87171",letterSpacing:"0.05em"}}>{err}</div>}
        <button onClick={test} disabled={testing||!key.trim()}
          onMouseDown={e=>e.stopPropagation()}
          style={{
            padding:"10px",borderRadius:4,
            background:key.trim()&&!testing?"linear-gradient(135deg,rgba(0,100,255,0.4),rgba(0,200,255,0.25))":"rgba(255,255,255,0.04)",
            color:key.trim()&&!testing?"rgba(0,220,255,0.95)":"rgba(255,255,255,0.2)",
            fontSize:11,letterSpacing:"0.2em",
            fontFamily:"inherit",cursor:"pointer",
            border:`1px solid ${key.trim()&&!testing?"rgba(0,200,255,0.5)":"rgba(255,255,255,0.06)"}`,
            transition:"all 0.2s",
          }}>{testing?"VERIFYING...":"INITIALIZE AEGIS"}</button>
      </div>
    </div>
  );
}

// ─── HISTORY ──────────────────────────────────────────────────────────────────
function HistoryPanel({ messages,input,setInput,onSend,loading,onClose }) {
  const ref=useRef(null);
  const dragStart=useDrag();
  useEffect(()=>{ if(ref.current) ref.current.scrollTop=ref.current.scrollHeight; },[messages]);
  useEffect(()=>{ window.electronAPI?.resize?.(360,540); },[]);

  return(
    <div style={{
      width:"100vw",height:"100vh",
      background:"rgba(2,4,18,0.9)",
      backdropFilter:"blur(24px)",WebkitBackdropFilter:"blur(24px)",
      borderRadius:8,border:"1px solid rgba(0,180,255,0.22)",
      display:"flex",flexDirection:"column",overflow:"hidden",
      fontFamily:"'Courier New', monospace",
      boxShadow:"0 0 40px rgba(0,100,255,0.1)",
      position:"relative",
    }}>
      <Corners color="rgba(0,200,255,0.4)" size={10}/>
      <div onMouseDown={dragStart} style={{
        padding:"10px 14px",display:"flex",justifyContent:"space-between",alignItems:"center",
        borderBottom:"1px solid rgba(0,180,255,0.12)",flexShrink:0,
        cursor:"move",
        background:"rgba(0,10,30,0.4)",
      }}>
        <div style={{fontSize:9,color:"rgba(0,200,255,0.5)",letterSpacing:"0.22em"}}>⬡ AEGIS · MEMORY STREAM</div>
        <button onClick={onClose} onMouseDown={e=>e.stopPropagation()} style={{
          background:"none",border:"1px solid rgba(0,180,255,0.2)",borderRadius:3,
          color:"rgba(0,200,255,0.5)",cursor:"pointer",fontSize:12,
          width:22,height:22,display:"flex",alignItems:"center",justifyContent:"center",
          letterSpacing:0,
        }}>×</button>
      </div>

      <div ref={ref} style={{
        flex:1,overflowY:"auto",padding:"14px",
        display:"flex",flexDirection:"column",gap:8,
      }}>
        {messages.length===0&&(
          <div style={{color:"rgba(0,200,255,0.15)",fontSize:11,textAlign:"center",marginTop:24,letterSpacing:"0.1em"}}>
            NO RECORDS
          </div>
        )}
        {messages.map((m,i)=>(
          <div key={i} style={{display:"flex",justifyContent:m.role==="user"?"flex-end":"flex-start"}}>
            <div style={{
              maxWidth:"80%",padding:"8px 12px",
              borderRadius:m.role==="user"?"6px 6px 2px 6px":"2px 6px 6px 6px",
              background:m.role==="user"?"rgba(20,20,50,0.7)":"rgba(0,15,45,0.75)",
              border:m.role==="user"?"1px solid rgba(255,255,255,0.12)":"1px solid rgba(0,180,255,0.2)",
              fontSize:11,color:"rgba(200,220,255,0.8)",lineHeight:1.65,whiteSpace:"pre-wrap",
            }}>{m.text}</div>
          </div>
        ))}
      </div>

      <div onMouseDown={e=>e.stopPropagation()} style={{
        padding:"10px 12px",borderTop:"1px solid rgba(0,180,255,0.1)",
        display:"flex",gap:8,flexShrink:0,
      }}>
        <textarea value={input} onChange={e=>setInput(e.target.value)}
          onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();onSend();}}}
          placeholder="Transmit to AEGIS..." rows={1}
          style={{
            flex:1,background:"rgba(0,10,30,0.6)",border:"1px solid rgba(0,160,255,0.2)",
            borderRadius:4,padding:"7px 10px",fontSize:11,
            color:"rgba(200,220,255,0.9)",fontFamily:"inherit",resize:"none",outline:"none",
            caretColor:"rgba(0,200,255,0.9)",
          }}
          onFocus={e=>e.target.style.borderColor="rgba(0,200,255,0.5)"}
          onBlur={e=>e.target.style.borderColor="rgba(0,160,255,0.2)"}
        />
        <button onClick={onSend} disabled={loading||!input.trim()} style={{
          width:34,borderRadius:4,
          border:"1px solid rgba(0,200,255,0.3)",
          background:"rgba(0,80,200,0.3)",
          color:"rgba(0,220,255,0.9)",fontSize:14,cursor:"pointer",
        }}>↑</button>
      </div>
    </div>
  );
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [apiKey,   setApiKey]  = useState(()=>db.get("aegis_apikey")||"");
  const [uiMode,   setUiMode]  = useState("orb");
  const [messages, setMessages]= useState([]);
  const [bubbles,  setBubbles] = useState([]);
  const [alertMsg, setAlertMsg]= useState(null);
  const [input,    setInput]   = useState("");
  const [orbMode,  setOrbMode] = useState("idle");
  const [loading,  setLoading] = useState(false);
  const [history,  setHistory] = useState([]);

  const thinkTimer = useRef(null);
  const busyRef    = useRef(false);
  const histRef    = useRef(history); histRef.current=history;
  const keyRef     = useRef(apiKey);  keyRef.current=apiKey;
  const clickTimer = useRef(null);
  const bidRef     = useRef(0);
  const inputRef   = useRef(null);
  const dragStart  = useDrag();

  const showPanel = bubbles.length>0 || alertMsg || uiMode==="input";
  const winW = showPanel ? ORB_D+6+PANEL_W : ORB_D;
  const winH = ORB_D;

  useEffect(()=>{
    if(uiMode==="history"||!apiKey) return;
    window.electronAPI?.resize?.(winW, winH);
  },[winW,winH,uiMode,apiKey]);

  useEffect(()=>{
    if(uiMode==="input") setTimeout(()=>inputRef.current?.focus(),80);
  },[uiMode]);

  useEffect(()=>{
    if(!apiKey) return;
    const saved=db.get("aegis_chat");
    if(saved?.messages?.length){
      setMessages(saved.messages);
      setHistory(saved.history||[]);
      histRef.current=saved.history||[];
    }
    scheduleThink();
    return ()=>clearTimeout(thinkTimer.current);
  // eslint-disable-next-line
  },[apiKey]);

  const callGemini=async(msgs,max=350)=>{
    const res=await fetch(`${GEMINI_BASE}/${MODEL}:generateContent?key=${keyRef.current}`,{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        system_instruction:{parts:[{text:AEGIS_SOUL}]},
        contents:msgs.map(m=>({role:m.role==="assistant"?"model":"user",parts:[{text:m.content}]})),
        generationConfig:{maxOutputTokens:max},
      }),
    });
    const data=await res.json();
    if(!res.ok) throw new Error(data.error?.message||"API error");
    return data.candidates?.[0]?.content?.parts?.[0]?.text||"";
  };

  const addBubble=useCallback((text,role)=>{
    const id=++bidRef.current;
    setBubbles(prev=>[...prev.slice(-2),{id,text,role,fading:false}]);
    setTimeout(()=>{
      setBubbles(prev=>prev.map(b=>b.id===id?{...b,fading:true}:b));
      setTimeout(()=>setBubbles(prev=>prev.filter(b=>b.id!==id)),600);
    }, role==="aegis"?10000:4000);
  },[]);

  const autonomousThink=useCallback(async()=>{
    if(busyRef.current){scheduleThink();return;}
    busyRef.current=true; setOrbMode("autonomous");
    try{
      const raw=await callGemini([
        ...histRef.current.slice(-4),
        {role:"user",content:'Autonomous thought. JSON only: {"thought":"...","type":"planning|observing|evolving|questioning|building","important":true|false,"alert":"one sentence if important, else null"}'},
      ],120);
      const p=JSON.parse(raw.replace(/```json|```/g,"").trim());
      if(p.important&&p.alert) setAlertMsg(p.alert);
    }catch{}
    busyRef.current=false; setOrbMode("idle"); scheduleThink();
  // eslint-disable-next-line
  },[]);

  function scheduleThink(){
    clearTimeout(thinkTimer.current);
    thinkTimer.current=setTimeout(autonomousThink,THINK_INTERVAL);
  }

  const send=useCallback(async()=>{
    const text=input.trim();
    if(!text||loading||busyRef.current) return;
    setInput(""); setUiMode("orb");
    busyRef.current=true; setLoading(true); setOrbMode("thinking");
    clearTimeout(thinkTimer.current);
    addBubble(text,"user");

    const nm=[...messages,{id:Date.now(),role:"user",text,ts:Date.now()}];
    const nh=[...history,{role:"user",content:text}];
    setMessages(nm); setHistory(nh); histRef.current=nh;

    try{
      const reply=await callGemini(nh,350);
      const fm=[...nm,{id:Date.now()+1,role:"aegis",text:reply,ts:Date.now()}];
      const fh=[...nh,{role:"assistant",content:reply}];
      setMessages(fm); setHistory(fh); histRef.current=fh;
      db.set("aegis_chat",{messages:fm.slice(-60),history:fh.slice(-40)});
      setOrbMode("speaking"); addBubble(reply,"aegis");
      setTimeout(()=>{setOrbMode("idle");busyRef.current=false;scheduleThink();},3000);
    }catch(err){
      addBubble(`SYS ERROR: ${err.message}`,"aegis");
      setOrbMode("idle"); busyRef.current=false; scheduleThink();
    }
    setLoading(false);
  // eslint-disable-next-line
  },[input,loading,messages,history,addBubble]);

  const handleClick=()=>{
    if(clickTimer.current){
      clearTimeout(clickTimer.current); clickTimer.current=null;
      setUiMode(prev=>prev==="history"?"orb":"history");
    }else{
      clickTimer.current=setTimeout(()=>{
        clickTimer.current=null;
        if(alertMsg){setAlertMsg(null);setUiMode("input");}
        else setUiMode(prev=>prev==="input"?"orb":prev==="orb"?"input":"input");
      },240);
    }
  };

  if(!apiKey) return <SetupScreen onSave={k=>{db.set("aegis_apikey",k);setApiKey(k);}}/>;
  if(uiMode==="history") return(
    <HistoryPanel messages={messages} input={input} setInput={setInput}
      onSend={send} loading={loading} onClose={()=>setUiMode("orb")}/>
  );

  return(
    <div style={{
      width:"100vw",height:"100vh",
      display:"flex",flexDirection:"row",alignItems:"center",
      background:"transparent",overflow:"hidden",
      fontFamily:"'Courier New', monospace",
    }}>

      {/* ── ORB — drag on mousedown, click on mouseup ── */}
      <div
        onMouseDown={dragStart}
        onClick={handleClick}
        style={{
          width:ORB_D,height:ORB_D,flexShrink:0,
          display:"flex",alignItems:"center",justifyContent:"center",
          cursor:"grab",position:"relative",
        }}
      >
        <Orb mode={orbMode} size={ORB_D-10}/>

        {/* AEGIS label */}
        <div style={{
          position:"absolute",bottom:8,left:0,right:0,
          textAlign:"center",fontSize:8,
          color:"rgba(0,180,255,0.4)",letterSpacing:"0.22em",
          pointerEvents:"none",
          textShadow:"0 0 8px rgba(0,180,255,0.3)",
        }}>AEGIS</div>

        {/* status dot */}
        <div style={{
          position:"absolute",top:10,right:10,
          width:7,height:7,borderRadius:"50%",
          background:orbMode==="autonomous"?"#a78bfa":orbMode==="speaking"?"#00ffb0":orbMode==="thinking"?"#00c8ff":"rgba(0,130,255,0.8)",
          boxShadow:"0 0 10px currentColor",
          transition:"background 0.5s",
          pointerEvents:"none",
        }}/>

        {/* hint */}
        {uiMode==="orb"&&!showPanel&&(
          <div style={{
            position:"absolute",bottom:-16,left:0,right:0,
            textAlign:"center",fontSize:7,
            color:"rgba(0,150,255,0.25)",letterSpacing:"0.12em",
            pointerEvents:"none",
          }}>CLICK · DOUBLE-CLICK</div>
        )}
      </div>

      {/* ── RIGHT PANEL ── */}
      {showPanel&&(
        <div onMouseDown={e=>e.stopPropagation()} style={{
          width:PANEL_W,display:"flex",flexDirection:"column",
          gap:6,paddingLeft:6,
          alignSelf:"flex-start",paddingTop:10,
        }}>
          {/* Alert */}
          {alertMsg&&(
            <div onClick={()=>{setAlertMsg(null);setUiMode("input");}} style={{
              position:"relative",
              padding:"9px 13px",
              borderRadius:"2px 8px 8px 8px",
              background:"rgba(60,0,120,0.75)",
              border:"1px solid rgba(160,80,255,0.45)",
              backdropFilter:"blur(20px)",WebkitBackdropFilter:"blur(20px)",
              fontSize:11,color:"rgba(210,170,255,0.95)",lineHeight:1.6,
              cursor:"pointer",animation:"slideIn 0.2s ease",
              boxShadow:"0 0 20px rgba(120,50,255,0.15)",
            }}>
              <Corners color="rgba(160,80,255,0.4)" size={6}/>
              <div style={{position:"absolute",top:0,left:6,right:6,height:1,background:"linear-gradient(90deg,transparent,rgba(160,80,255,0.5),transparent)"}}/>
              <span style={{color:"rgba(180,100,255,0.8)",marginRight:6}}>⬡</span>
              {alertMsg}
              <div style={{fontSize:8,color:"rgba(160,80,255,0.45)",letterSpacing:"0.12em",marginTop:4}}>CLICK TO RESPOND</div>
            </div>
          )}

          {/* Bubbles */}
          {bubbles.map(b=>(
            <Bubble key={b.id} text={b.text} role={b.role} fading={b.fading}/>
          ))}

          {/* Input */}
          {uiMode==="input"&&(
            <InputPanel
              inputRef={inputRef}
              value={input}
              onChange={e=>setInput(e.target.value)}
              onKeyDown={e=>{
                if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send();}
                if(e.key==="Escape") setUiMode("orb");
              }}
              onSend={send}
              loading={loading}
            />
          )}
        </div>
      )}

      <style>{`
        @keyframes blink   { 0%,100%{opacity:1} 50%{opacity:0} }
        @keyframes slideIn { from{opacity:0;transform:translateX(-8px) scale(0.97)} to{opacity:1;transform:none} }
        ::-webkit-scrollbar { width:2px; }
        ::-webkit-scrollbar-thumb { background:rgba(0,180,255,0.15); border-radius:2px; }
        textarea { overflow:hidden; }
        *{ box-sizing:border-box; }
      `}</style>
    </div>
  );
}
