import React from 'react';

export type ConfirmModalVariant = 'default' | 'danger' | 'warning';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmModalVariant;
  isLoading?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

const variantStyles: Record<ConfirmModalVariant, { button: string; icon: string; bg: string }> = {
  default: {
    button: 'bg-primary-600 hover:bg-primary-700 text-white',
    icon: 'text-primary-600',
    bg: 'bg-primary-50 dark:bg-primary-900/20',
  },
  danger: {
    button: 'bg-red-600 hover:bg-red-700 text-white',
    icon: 'text-red-600',
    bg: 'bg-red-50 dark:bg-red-900/20',
  },
  warning: {
    button: 'bg-amber-600 hover:bg-amber-700 text-white',
    icon: 'text-amber-600',
    bg: 'bg-amber-50 dark:bg-amber-900/20',
  },
};

export function ConfirmModal({
  isOpen,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  isLoading = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  if (!isOpen) return null;

  const styles = variantStyles[variant];

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/50 dark:bg-black/70 transition-opacity"
        onClick={onCancel}
        aria-hidden="true"
      />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="bg-white dark:bg-slate-900 rounded-lg shadow-xl max-w-md w-full border border-slate-200/50 dark:border-slate-700/50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-title"
          aria-describedby="modal-description"
        >
          {/* Icon */}
          <div className={`flex justify-center pt-6 ${styles.bg}`}>
            <div className={`w-12 h-12 rounded-full ${styles.bg} flex items-center justify-center`}>
              {variant === 'danger' ? (
                <svg className={`w-6 h-6 ${styles.icon}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4v2m0 4v2M9 3h6a2 2 0 012 2v18a2 2 0 01-2 2H9a2 2 0 01-2-2V5a2 2 0 012-2z"
                  />
                </svg>
              ) : variant === 'warning' ? (
                <svg className={`w-6 h-6 ${styles.icon}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v3m0 4h.01M10.29 3.86l-7.5 13A1.5 1.5 0 004.09 19h15.82a1.5 1.5 0 001.3-2.14l-7.5-13a1.5 1.5 0 00-2.42 0z"
                  />
                </svg>
              ) : (
                <svg className={`w-6 h-6 ${styles.icon}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              )}
            </div>
          </div>

          {/* Content */}
          <div className="px-6 py-4 text-center">
            <h2 id="modal-title" className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">
              {title}
            </h2>
            <p id="modal-description" className="text-sm text-slate-600 dark:text-slate-400">
              {description}
            </p>
          </div>

          {/* Actions */}
          <div className="px-6 py-4 bg-slate-50/50 dark:bg-slate-800/30 border-t border-slate-200/50 dark:border-slate-700/50 rounded-b-lg flex gap-3">
            <button
              type="button"
              onClick={onCancel}
              disabled={isLoading}
              className="flex-1 px-4 py-2.5 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 font-medium hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={isLoading}
              className={`flex-1 px-4 py-2.5 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 ${styles.button}`}
            >
              {isLoading && (
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
              )}
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
