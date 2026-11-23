import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Action, Field } from './ui';

export function PanelDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => { if (node?.open) node.close(); };
  }, []);
  return <dialog ref={dialog} className="e-dialog" aria-label={title} onCancel={(event) => { event.preventDefault(); onClose(); }}><div className="e-stack"><h2>{title}</h2>{children}</div></dialog>;
}
export function Confirm({ title, label, children, reason = false, danger = true, onClose, onConfirm }: { title: string; label: string; children: ReactNode; reason?: boolean; danger?: boolean; onClose: () => void; onConfirm: (reason: string) => void }) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  return <PanelDialog title={title} onClose={onClose}><div>{children}</div><form className="e-stack" noValidate onSubmit={(event) => { event.preventDefault(); if (reason && !text.trim()) { setError('اذكر السبب قبل تأكيد العملية.'); (event.currentTarget.elements.namedItem('سبب العملية') as HTMLElement)?.focus(); return; } onConfirm(text.trim()); }}>
    {reason && <Field spec={{label:'سبب العملية',type:'textarea'}} value={text} set={(value) => { setText(value); setError(''); }} error={error} onBlur={() => { if (!text.trim()) setError('اذكر سبب العملية.'); }} />}
    <div className="e-actions"><button type="button" className="e-button secondary" autoFocus onClick={onClose}>تراجع</button><button className={`e-button ${danger ? 'danger' : 'primary'}`} type="submit">{label}</button></div>
  </form></PanelDialog>;
}
export function DoneMessage({ title, children, onReset }: { title: string; children: ReactNode; onReset?: () => void }) { return <div className="e-panel e-form"><h2 tabIndex={-1}>{title}</h2><p role="status">{children}</p>{onReset && <div><Action onClick={onReset}>ابدأ من جديد</Action></div>}</div>; }
