'use client';

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info';

export interface ToastItem {
  id: string;
  type: ToastType;
  title?: string;
  message: string;
  duration?: number;
}

interface ToastContextType {
  toasts: ToastItem[];
  addToast: (toast: Omit<ToastItem, 'id'>) => string;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

let globalToastHandler: ((toast: Omit<ToastItem, 'id'>) => void) | null = null;

export function notify(toast: Omit<ToastItem, 'id'>) {
  if (globalToastHandler) {
    globalToastHandler(toast);
  } else {
    console.warn('[Toast fallback]:', toast.message);
  }
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback((toast: Omit<ToastItem, 'id'>) => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const newToast: ToastItem = { ...toast, id };
    setToasts((prev) => [...prev, newToast]);
    return id;
  }, []);

  useEffect(() => {
    globalToastHandler = addToast;
    return () => {
      globalToastHandler = null;
    };
  }, [addToast]);

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}
      {/* Toast viewport */}
      <div
        className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none px-4 sm:px-0"
        aria-live="polite"
        role="region"
        aria-label="Notifications"
      >
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onDismiss={() => removeToast(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return {
      toasts: [],
      addToast: notify,
      removeToast: () => {},
      toast: notify,
    };
  }
  return {
    ...ctx,
    toast: ctx.addToast,
  };
}

function ToastCard({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  const duration = toast.duration ?? 4000;

  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(() => {
        onDismiss();
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [duration, onDismiss]);

  const icons = {
    success: <CheckCircle2 className="w-4 h-4 text-[var(--success)] shrink-0" />,
    error: <AlertCircle className="w-4 h-4 text-[var(--error)] shrink-0" />,
    info: <Info className="w-4 h-4 text-[var(--info)] shrink-0" />,
  };

  const borders = {
    success: 'border-[rgba(34,197,94,0.3)]',
    error: 'border-[rgba(239,68,68,0.3)]',
    info: 'border-[rgba(96,165,250,0.3)]',
  };

  return (
    <div
      role="alert"
      className={`pointer-events-auto flex items-start gap-3 p-3.5 bg-[var(--surface)] text-[var(--text)] border ${borders[toast.type]} rounded-[var(--radius-md)] shadow-lg transition-all duration-200 animate-in fade-in slide-in-from-bottom-2`}
    >
      <div className="mt-0.5">{icons[toast.type]}</div>
      <div className="flex-1 min-w-0">
        {toast.title && (
          <div className="text-xs font-semibold text-[var(--text)] mb-0.5 tracking-tight">
            {toast.title}
          </div>
        )}
        <div className="text-xs text-[var(--muted)] leading-relaxed break-words">
          {toast.message}
        </div>
      </div>
      <button
        onClick={onDismiss}
        className="p-1 -mr-1 -mt-1 text-[var(--muted)] hover:text-[var(--text)] rounded-[var(--radius-sm)] focus-visible:ring-1 focus-visible:ring-[var(--accent)] transition-colors min-w-[28px] min-h-[28px] flex items-center justify-center"
        aria-label="Dismiss notification"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
