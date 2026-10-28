import { createContext, useContext } from 'react';
import type { Engine } from '../sim/engine';
import type { LatLng } from '../sim/types';

export type Sel = { kind: 'dev' | 'load' | 'truck' | 'inc' | 'line' | 'sub'; id: string } | null;
export interface SboReq { dev: string; action: 'open' | 'close'; order?: string; viaOrder?: boolean; }

export interface Ctx {
  e: Engine;
  sel: Sel;
  setSel(s: Sel): void;
  openSbo(r: SboReq): void;
  flyTo(pos: LatLng, zoom?: number): void;
  setTab(t: 'gis' | 'scada' | 'sw'): void;
  swPrefill: { dev: string; action: 'open' | 'close' } | null;
  setSwPrefill(p: { dev: string; action: 'open' | 'close' } | null): void;
  flash(text: string, level?: 'info' | 'warn' | 'alarm' | 'good'): void;
}

export const EngineCtx = createContext<Ctx>(null as unknown as Ctx);
export const useCtx = () => useContext(EngineCtx);

export function age(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;
}

export const statusCls = (s: string) => s.replace(/\s+/g, '');
