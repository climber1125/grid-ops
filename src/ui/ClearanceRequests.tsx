// Pending clearance / release requests, shown where the operator is working:
// top of Switching & clearances, top of the Field tab, and the Radio panel.
import { useCtx } from './ctx';

export function ClearanceRequests({ fieldOnly = false }: { fieldOnly?: boolean }) {
  const { e, flash, setSel } = useCtx();
  const pend = e.s.requests.filter(r => r.status === 'Pending' && (r.type === 'clearance' || r.type === 'release') && (!fieldOnly || e.s.trucks[r.truck]?.field));
  if (!pend.length) return null;
  const run = (r: string | null | void) => { if (r) flash(r, 'warn'); };
  return (
    <div className="creqs">
      {pend.map(r => {
        const field = !!e.s.trucks[r.truck]?.field;
        return (
          <div key={r.id} className={`creq ${r.type}`}>
            <div>
              <b className="c-amber">{r.type === 'clearance' ? '🔒 CLEARANCE REQUEST' : '🔓 CLEARANCE RELEASE'}</b>{' '}
              <b>Truck {r.truck}</b>{field && <span className="badge amber" style={{ marginLeft: 4 }}>FIELD</span>} <span className="mono dim">{e.hhmm(r.t)}</span>
              <div>{r.text}</div>
              {r.type === 'clearance' && <div className="dim" style={{ fontSize: 11 }}>The section must be open at every boundary and dead. Issuing puts HOLD tags on the boundary devices{field ? ' and tells the crew\'s phone' : ''}.</div>}
            </div>
            <div className="acts">
              {r.devs?.map(d => <button key={d} className="btn sm" title="Show on the map" onClick={() => setSel({ kind: 'dev', id: d })}>{d}</button>)}
              {r.type === 'clearance'
                ? <><button className="btn warn" onClick={() => run(e.approve(r.id))}>Issue clearance</button><button className="btn sm" onClick={() => run(e.deny(r.id))}>Defer</button></>
                : <button className="btn good" onClick={() => run(e.approve(r.id))}>Acknowledge release</button>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
