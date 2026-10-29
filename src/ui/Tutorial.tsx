// Tutorial coach panel — shown during scenario T.
import { useCtx } from './ctx';

const STEPS: { title: string; body: string }[] = [
  { title: 'Welcome to your first shift', body: 'You are the system operator at Sparks Municipal Electric. Everything is simulated. Press Enable audio (top right) so you can hear alarms and crews. Pause any time with the ❚❚ button.' },
  { title: 'Read the map', body: 'The map shows six feeders in different colors. Solid lines are energized, dark lines are dead. Click any device (circles and squares) to see its status in the inspector. Use Map focus to enlarge the map.' },
  { title: 'Wait for the call', body: 'In about 45 seconds a customer will call in an outage. Watch the OMS panel: calls roll up into an incident with a predicted device. Click the incident to select it.' },
  { title: 'Dispatch a crew', body: 'With the incident selected, open the Units tab and dispatch the closest truck. With talk-back on, press and hold Space and say: “Truck 233, Sparks Control, respond to incident 4 1 0 1” (use the real incident number shown). Typed works too.' },
  { title: 'Crew patrols and reports', body: 'The truck drives to the scene and reports what it found. Listen to the radio traffic. Each truck keeps its own voice.' },
  { title: 'Permit the repair', body: 'When the crew asks permission to close the fuse, answer on the radio: “Truck 233, permission granted to close the fuse.” Without voice you can click Grant. They will not close anything until you say so.' },
  { title: 'Verify restoration', body: 'Check that customers are back and the incident shows Restored, then close it from the OMS panel. Watch SAIDI at the top: every minute of outage counts.' },
  { title: 'Hot-line tag (non-reclose)', body: 'Select any recloser, turn on “Non-reclose (hot-line tag)”, then turn it off again. This keeps the recloser from re-energizing a line while a crew works on it hot. Required for the rescue scenario.' },
  { title: 'Lockout and emergencies', body: 'Select a feeder breaker or recloser and use LOCK OUT to open it and hold it open with a tag. In an emergency use Emergency traffic and ☎ 911 in the Radio panel, then lock out the source and tell the crew the line is dead.' },
  { title: 'You are ready', body: 'Finish the objectives, then press Finish tutorial. Next try Scenario A, then G (Rescue).' },
];

export function TutorialCoach() {
  const { e, flash } = useCtx();
  const n = Math.min(e.s.scen.flags.tutStep ?? 0, STEPS.length - 1);
  const done = (e.s.scen.flags.tutStep ?? 0) >= 99;
  if (done) return null;
  const st = STEPS[n];
  const last = n === STEPS.length - 1;
  return (
    <div className="coach">
      <div className="ch"><span className="badge cyan">TUTORIAL {n + 1}/{STEPS.length}</span><b>{st.title}</b></div>
      <div className="cb">{st.body}</div>
      <div className="cf">
        <button className="btn sm" disabled={n === 0} onClick={() => e.setTutStep(n - 1)}>Back</button>
        {last
          ? <button className="btn pri sm" onClick={() => { e.setTutStep(99); flash('Tutorial complete', 'good'); }}>Finish tutorial</button>
          : <button className="btn pri sm" onClick={() => e.setTutStep(n + 1)}>Next</button>}
        <button className="btn sm" onClick={() => e.setTutStep(99)}>Skip</button>
      </div>
    </div>
  );
}
