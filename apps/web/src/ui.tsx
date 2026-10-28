import { createContext, useContext, useState, type ReactNode } from 'react';
import { AlertCircle, Check, LoaderCircle, Sparkles, X } from 'lucide-react';
import { Link } from 'react-router-dom';
const ToastContext = createContext<(message: string, error?: boolean) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ message: string; error: boolean } | null>(null);
  const notify = (message: string, error = false) => {
    setToast({ message, error });
    window.setTimeout(
      () => setToast((current) => (current?.message === message ? null : current)),
      6000,
    );
  };
  return (
    <ToastContext.Provider value={notify}>
      {children}
      {toast && (
        <div
          className={`toast ${toast.error ? 'toast-error' : ''}`}
          role={toast.error ? 'alert' : 'status'}
        >
          {toast.error ? <AlertCircle size={20} /> : <Check size={20} />}
          <span>{toast.message}</span>
          <button aria-label="关闭通知" onClick={() => setToast(null)}>
            <X size={16} />
          </button>
        </div>
      )}
    </ToastContext.Provider>
  );
}
export const useToast = () => useContext(ToastContext);
export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link to="/" className="brand" aria-label="CampusFlow 首页">
      <span className="brand-mark">
        <Sparkles size={23} />
      </span>
      <span>CampusFlow{!compact && <small>BY AMYRTLE</small>}</span>
    </Link>
  );
}
export function Loading({ label = '正在加载' }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" size={22} />
      {label}…<div className="skeleton" />
      <div className="skeleton short" />
    </div>
  );
}
export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div className="error-state" role="alert">
      <AlertCircle />
      <h3>暂时无法完成请求</h3>
      <p>{error instanceof Error ? error.message : String(error)}</p>
      {retry && (
        <button className="btn secondary" onClick={retry}>
          重新尝试
        </button>
      )}
    </div>
  );
}
export function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-symbol">
        <Sparkles />
      </div>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function Field({
  label,
  hint,
  children,
  wide = false,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <label className={`field ${wide ? 'wide' : ''}`}>
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function PageHead({
  eyebrow,
  title,
  children,
  actions,
}: {
  eyebrow?: string;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-head">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {children && <p className="muted">{children}</p>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </header>
  );
}
export function Submit({ pending, children }: { pending: boolean; children: ReactNode }) {
  return (
    <button className="btn primary" type="submit" disabled={pending}>
      {pending && <LoaderCircle className="spin" size={17} />} {pending ? '处理中…' : children}
    </button>
  );
}
