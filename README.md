# AEGIS — Autonomous Eternal Game Intelligence System
## Desktop Application

---

### Requirements
- Node.js 18+ (https://nodejs.org)
- An Anthropic API key (https://console.anthropic.com)

---

### Setup & Run

```bash
# 1. Install dependencies
npm install

# 2. Run in development mode
npm run dev

# 3. Build a distributable installer
npm run build
```

The built installer will be in the `release/` folder.

---

### First Launch
When AEGIS opens for the first time, it will ask for your Anthropic API key.
- Enter your `sk-ant-...` key
- It is stored **locally only** — never sent anywhere except directly to Anthropic's API
- You can reset it anytime via the KEY button in the top bar

---

### How AEGIS Runs
- **Auto-starts on boot** — AEGIS starts with your computer, hidden in the background
- **System tray** — click the tray icon to show/hide the window
- **Always thinking** — even when the window is hidden, AEGIS generates autonomous thoughts every 18 seconds
- **Close = hide** — closing the window hides AEGIS to tray. It never truly stops.
- To fully quit: right-click the tray icon → **Quit AEGIS**

---

### Window Controls
- 🔴 Red dot — Hide to tray
- 🟡 Yellow dot — Minimize
- 🟢 Green dot — Maximize/restore

---

### What AEGIS Does
AEGIS is the game brain — an autonomous AI that thinks continuously about game systems:
- Mob ecosystems and boss evolution
- Infinite story generation
- Faction dynamics
- World events
- Dungeon architecture

Talk to it. Watch it think on its own. This is the face of the engine.
