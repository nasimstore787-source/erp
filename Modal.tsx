import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export default function Modal({ title, onClose, children, locked = false, className }: { title: string; onClose: () => void; children: ReactNode; locked?: boolean; className?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => { if (node?.open) node.close(); };
  }, []);
  function dismiss() {
    if (locked) return;
    dialog.current?.close();
    onClose();
  }
  return <dialog ref={dialog} className={className ? `sheet ${className}` : 'sheet'} aria-label={title} onCancel={(event) => { event.preventDefault(); dismiss(); }}>
    <div className="sheet-head"><h2>{title}</h2><button className="soft-icon" type="button" disabled={locked} onClick={dismiss} aria-label="إغلاق النافذة"><X size={19} aria-hidden="true" /></button></div>
    {children}
  </dialog>;
}
