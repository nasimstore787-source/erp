import { api, ApiError, type Bootstrap, type SaleBody, type SaleResult } from './api';
import { idbDel, idbGet, idbSet } from './idb';

// A sale is first made durable in IndexedDB, THEN sent. If the phone dies or loses signal nothing is lost; the server de-duplicates by offline_uuid.
const Q = 'queue', F = 'failed', R = 'sent', BOOT = 'boot';
export interface Failed { body: SaleBody; code: string; message: string; at: string }
export interface Sent { receipt_no: string; invoice_no: number | null; sync_status: string; total: number; at: string; reason: string | null }

let mem = { [Q]: [] as SaleBody[], [F]: [] as Failed[], [R]: [] as Sent[] };
let chain: Promise<unknown> = Promise.resolve();                     // writes are applied in order
const persist = (k: keyof typeof mem) => { const snap = mem[k]; chain = chain.then(() => idbSet(k, snap)); return chain as Promise<void>; };
const changed = () => window.dispatchEvent(new Event('erp:queue'));

/** Load state at start-up (and migrate the old localStorage queue once). Must finish before the UI renders. */
let initP: Promise<void> | null = null;
export const init = () => (initP ??= doInit());
async function doInit(): Promise<void> {
  for (const k of [Q, F, R] as const) mem[k] = ((await idbGet(k)) ?? []) as never;
  for (const [old, k] of [['erp.queue', Q], ['erp.failed', F], ['erp.sent', R]] as const) {
    const raw = localStorage.getItem(old); if (!raw) continue;
    try { const arr = JSON.parse(raw) as never[]; if (arr.length) { const have = new Set((mem[k] as { offline_uuid?: string; body?: { offline_uuid: string } }[]).map((x) => x.offline_uuid ?? x.body?.offline_uuid)); mem[k] = [...mem[k], ...arr.filter((x: any) => !have.has(x.offline_uuid ?? x.body?.offline_uuid))] as never; await persist(k); } } catch { /* ignore a corrupt legacy value */ }
    localStorage.removeItem(old);
  }
  navigator.storage?.persist?.().catch(() => {});                    // ask the browser not to evict our data under storage pressure
  changed();
}

export const queue = () => mem[Q];
export const failed = () => mem[F];
export const sent = () => mem[R];
export const total = (b: SaleBody) => b.lines.reduce((s, l) => s + l.qty * l.unit_price, 0);

export const loadBoot = () => idbGet<Bootstrap>(BOOT).then((b) => b ?? null).catch(() => null);
export const saveBoot = (b: Bootstrap) => { chain = chain.then(() => idbSet(BOOT, b)); return chain as Promise<void>; };
export async function clearAll() { mem = { [Q]: [], [F]: [], [R]: [] }; await Promise.all([Q, F, R, BOOT].map(idbDel)); changed(); }
export async function clearBoot() { await idbDel(BOOT); }

/** Resolves only after the sale is durable on the device. */
export async function enqueue(b: SaleBody): Promise<void> { mem[Q] = [...mem[Q], b]; changed(); await persist(Q); }
export async function dismissFailed(uuid: string) { mem[F] = mem[F].filter((f) => f.body.offline_uuid !== uuid); changed(); await persist(F); }

let flushing = false;
/** Sends queued sales one by one, oldest first. Stops at the first network failure; moves server refusals to "failed" (never silently drops money). */
export async function flush(): Promise<void> {
  if (flushing) return; flushing = true;
  try {
    for (;;) {
      const b = mem[Q][0]; if (!b) break;
      try {
        const r = await api<SaleResult>('/sales', { body: b });
        mem[R] = [{ receipt_no: b.receipt_no, invoice_no: r.invoice_no, sync_status: r.sync_status, total: total(b), at: new Date().toISOString(), reason: r.conflict_reason }, ...mem[R]].slice(0, 30);
        mem[Q] = mem[Q].filter((x) => x.offline_uuid !== b.offline_uuid); changed();
        await Promise.all([persist(R), persist(Q)]);                 // a crash before this only causes a harmless re-send (idempotent)
      } catch (e) {
        if (!(e instanceof ApiError) || e.status === 0 || e.status >= 500 || e.status === 401) break;      // try again later
        mem[F] = [...mem[F], { body: b, code: e.code, message: e.message + (e.detail ? ` — ${e.detail}` : ''), at: new Date().toISOString() }];
        mem[Q] = mem[Q].filter((x) => x.offline_uuid !== b.offline_uuid); changed();
        await Promise.all([persist(F), persist(Q)]);
      }
    }
  } finally { flushing = false; }
}
