# GRID OPS — Sparks Municipal Electric

Distribution system operations simulator: GIS, SCADA, OMS, radio dispatch and crew management running off one shared, deterministic electrical model. Local-first, no paid APIs, no cloud.

> Training simulator only. The network is synthetic and Denton-*inspired*; it does not represent the City of Denton's electric system. Nothing connects to real SCADA or utility controls. Amps / MW / end-of-line voltage are simplified estimates, not a validated power flow.

---

## 1. Install & run

Requires **Node.js 18+** (Windows, macOS, Linux, Raspberry Pi OS 64-bit on a Pi 5).

1. Unzip, open a terminal in the `grid-ops` folder.
2. `npm install`
3. `npm run dev` → open the printed URL (default `http://localhost:5173`). `--host` is on, so other machines on the LAN can open it too.
4. Click **Enable audio** in the top bar (browsers block sound until you click). Radio voice uses the browser's built-in speech engine.

Other commands

| Command | Result |
|---|---|
| `npm run build` | Production build in `dist/` (serve with `npm run preview`) |
| `npm run build:single` | One self-contained `dist-single/index.html` — double-click to run, no Node or server needed |
| `npm run simtest` | Headless engine test: drives every scenario outage-to-restoration and prints objectives |

**Offline:** the basemap (zones, roads, creek, street grid) is drawn locally. The "OSM basemap" checkbox adds online OpenStreetMap tiles only if you want them.

**Raspberry Pi 5:** use Chromium, `npm run build && npm run preview`, or the single-file build. Keep speed at 1×/5× if voice stutters. Speech on Pi needs `espeak-ng` / speech-dispatcher installed for Chromium to have voices; text radio works regardless.

**Common failure points**
- No radio audio → you didn't click *Enable audio*, the OS has no TTS voices, or the browser tab is muted.
- Blank map → browser blocked WebGL/canvas (rare) or you're on IE/old Edge. Use Chrome, Edge, or Firefox.
- `npm install` fails behind a corporate proxy → set `npm config set proxy …` or use the single-file build on another machine.
- Saved session missing → saves live in that browser's IndexedDB; a different browser/profile or "clear site data" wipes them.

---

## 2. Architecture

```
src/sim/            ← simulation engine (no React, runs headless)
  types.ts          static topology + serializable SimState
  roads.ts          Sparks road graph (Dijkstra routing), zones, local streets
  topology.ts       synthetic network builder: 3 subs, 6 feeders, 4 ties, ~390 transformers, 4,046 customers
  network.ts        connectivity solver (BFS from sources), upstream trace, section/isolation finder
  engine.ts         clock + event queue, protection, OMS, crews, radio, switching, clearances, readings
  scenarios.ts      scenarios A–F: setup, scripted causal events, objective grading
  radio.ts          phrasing, findings, repair times, ID → spoken-word conversion
  persist.ts        IndexedDB save/restore of full SimState
src/ui/             ← operator workstation (React)
  App.tsx           shell, 10 Hz sim loop, audio, toasts, autosave
  GisMap.tsx        M1  Leaflet GIS (canvas-rendered, offline basemap)
  Scada.tsx         M2  substation one-lines, feeder schematics, points, metering
  Oms.tsx           M3  incidents, calls, history, dispatch, verification
  Radio.tsx         M4  transcript, TX/RX lamps, field requests, unit actions
  Bottom.tsx        M5  crew board / work orders; SCADA alarms, SOE, ops log
  Switching.tsx     switching orders with repeat-back, clearances
  Modals.tsx        select-before-operate, scenario picker, after-action review
  Inspector.tsx     device / transformer / line / truck / incident detail + controls
  audio.ts          alarm tones, squelch, pluggable RadioVoice providers
```

**One source of truth.** Every panel reads `Engine.s`; every operator action is an `Engine` method. Opening a device re-solves connectivity → GIS recolors, SCADA updates, customers drop, OMS customer counts change, calls get scheduled.

**Deterministic.** All randomness comes from a seeded generator stored in state; all future activity is a time-ordered serializable queue. Same seed + same operator actions = same run. Save/restore captures everything mid-incident.

**Electrical model.** Graph of nodes and elements (line sections, breakers, reclosers, switches, ties, fuses, transformers). Energization by BFS from substation buses through closed devices; source feeder tracked per node (tie transfers show the *source* feeder's color). Protection walks upstream from the fault to the first protective device: fuse blows; recloser/breaker trips, recloses twice, locks out; temporary faults clear on reclose (momentary).

**Safety interlocks (training safeguards)**
- Closing a HOLD-tagged device is blocked and logged as a violation.
- Closing a device that would parallel two sources is blocked unless it's a **LOOP** step of an active switching order.
- Clearance is refused unless every isolation point is open and the section is dead (no backfeed path).
- Releasing a clearance without the holder's release is a recorded violation.
- Closing into a *located* fault is a violation; into an un-located fault, protection re-trips.

---

## 3. Operating the desk

- **Pause / 1× / 5× / 10×** in the top bar. Scenario button opens the scenario picker (seed field included).
- **Select anything** on the map, SCADA one-line, OMS, crew board, or alarms → Inspector panel.
- **SCADA control** = Select → Execute (30 s arm window) with a connectivity what-if: customers lost/restored, critical customers, fault energization, loops.
- **Dispatch** from the OMS detail (units listed by drive time) or from a truck's Inspector.
- **Field switching**: Switching tab → new order → add steps (device, action, SCADA or truck, loop flag) → Approve & activate → *Issue by radio* → read the crew's repeat-back → *That's correct — perform* or *Negative — repeat*. Crews drive to the device, operate, and report.
- **Requests** (refuse permission, clearance, release, supervisor pressure) appear at the top of the radio panel.
- **Auto-assist** = a desk dispatcher that handles routine dispatch and fuse-close approvals. Never does switching or clearances.
- **AAR** button any time; it also opens automatically when a scenario completes. Export to JSON.

### Scenarios
| | Scenario | What it tests |
|---|---|---|
| A | Normal Operations | Routine troubles, momentaries, single-customer calls, RTU comm fails; work orders keep crews moving |
| B | Feeder Lockout | IW-2110 locks out (583 cust incl. City Hall/911). Patrol, isolate S-2114/S-2116, pick up via TS-12, clearance, restore normal |
| C | Storm Response | Multiple outages, wire down, R-3115 lockout, high call volume, callout crews 238/240 |
| D | Switching Operations | Planned BS-3120 job: loop through TS-14, isolate, clearance, restore. One repeat-back is wrong on purpose |
| E | Critical Facility | R-1225 lockout drops Sparks Regional Medical Center; restore via S-1226 + TS-13 SCADA in 20 min |
| F | Communication Failure | Truck 235 goes silent while holding a clearance; supervisor pressure to energize |

**Scenario B walk-through** (complete vertical slice)
1. Lockout alarm sounds; feeder goes red; calls cluster under CB-2110 → P1 incident.
2. Dispatch 233 → radio exchange → truck drives roads to IW-2110.
3. 233 reports lockout, patrols, finds the limb, requests isolation between S-2114 and S-2116.
4. SCADA open S-2116; switching order: 233 open S-2114 (repeat-back).
5. SCADA close CB-2110 (upstream restored); order: close TS-12 (downstream picked up from CH-1220 — watch its loading).
6. 233 requests clearance → issue it (tags applied). Repair runs; 233 releases → acknowledge.
7. Restore normal: close S-2114, open TS-12, SCADA close S-2116. OMS shows Restored → Verify & Close. AAR opens.

---

## 4. Extending

- **Voices:** implement `RadioVoice` in `src/ui/audio.ts` (e.g. prerecorded clips keyed by message template, or a local Piper/Coqui TTS server) and add it to `VOICES`. `RadioMsg` carries speaker, kind and unit, so clips can be chosen per crew.
- **More trucks:** add to `TRUCK_ROSTER` (engine.ts) and `addTruck()` in a scenario.
- **More network:** add a `FeederSpec` / `TieSpec` in `topology.ts`; laterals, transformers and customers generate deterministically.
- **New scenario:** add an entry to `SCENARIOS` with `setup`, scripted `event`s, `periodic` grading, and `isDone`.
- **Roster:** M5 → *Roster* tab. Add a truck (number, crew, equipment), edit names, or remove a unit. Your roster is remembered for every new scenario; *Reset to defaults* clears it.
- **Reliability:** M5 → *Reliability* tab (or the *Reliability* view). Live exercise SAIDI, SAIFI, CAIDI, MAIFI, plus per-incident dispatch, response (report → on scene), restore time and customer-minutes. Also in OMS history and the AAR.
- **Status wall:** a big-screen view for a TV or projector — customers out, incidents, crews, indices, feeder loading, last radio traffic.
- **Light / dark:** ☀/☾ in the top bar. Saved per view, so a projector wall can stay light while the desk monitors stay dark.
- **Multi-monitor:** built in. **Monitors → Spread across all screens** (Chrome/Edge) or open any view in its own window. One window runs the simulation, the rest mirror it and send actions to it; if the main window closes, a linked window takes over. Views: `?mon=all|wall|gis|scada|sw|ops|oms|radio|crew|alarms|rel`. Leadership uses the browser's Web Locks API, so a minimized or background main window is never mistaken for a closed one, and its clock runs in a worker so it keeps full speed in the background.
