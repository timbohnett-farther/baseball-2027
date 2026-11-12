import { useEffect, useState, type ReactNode } from "react";

/** Loading placeholder announced to screen readers once (role=status). */
export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <section className="panel">
      <p className="muted loading" role="status"><span className="spinner" aria-hidden /> {label}</p>
    </section>
  );
}

/** Inline error, read out immediately (role=alert); optional retry. */
export function ErrorNote({ message, onRetry }: { message: string | null; onRetry?: () => void }) {
  if (!message) return null;
  return (
    <p className="error" role="alert">
      {message}{onRetry && <> · <button className="link" onClick={onRetry}>Try again</button></>}
    </p>
  );
}

/** Empty state: a title, a line of help, and whatever action makes sense. */
export function Empty({ title, hint, children }: { title: string; hint?: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <b>{title}</b>
      {hint && <p className="muted">{hint}</p>}
      {children}
    </div>
  );
}

// --- Toasts ------------------------------------------------------------------------------
// Module-level bus so any view can `toast("…")` without threading props through the tree.

type Toast = { id: number; text: string; kind: "info" | "bad" };
let nextId = 1;
let listeners: Array<(t: Toast) => void> = [];

export function toast(text: string, kind: Toast["kind"] = "info") {
  const t = { id: nextId++, text, kind };
  listeners.forEach((l) => l(t));
}

export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  useEffect(() => {
    const add = (t: Toast) => {
      setToasts((ts) => ts.some((x) => x.text === t.text) ? ts : [...ts.slice(-2), t]);
      setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== t.id)), t.kind === "bad" ? 7000 : 4000);
    };
    listeners.push(add);
    return () => { listeners = listeners.filter((l) => l !== add); };
  }, []);
  return (
    <div className="toaster" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} role={t.kind === "bad" ? "alert" : "status"}>
          {t.text}
          <button className="link" aria-label="Dismiss" onClick={() => setToasts((ts) => ts.filter((x) => x.id !== t.id))}>×</button>
        </div>
      ))}
    </div>
  );
}
