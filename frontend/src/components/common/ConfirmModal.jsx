import React, { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * ConfirmModal Component
 * Fully keyboard accessible confirmation dialog supporting:
 * - Enter & Space key native button activation
 * - Escape key dismissal
 * - Focus trapping (Tab & Shift+Tab cycling between Cancel & Delete)
 * - Auto-focus on default button (Delete)
 * - Focus restoration to triggering element on close
 * - Body scroll locking while open
 * - Backdrop click to close (ignored when loading)
 * - Full ARIA dialog semantics
 */
const ConfirmModal = ({
  isOpen,
  title = 'Delete Record',
  message = 'Are you sure you want to permanently delete this record? This action cannot be undone.',
  confirmText = 'Delete',
  cancelText = 'Cancel',
  onConfirm,
  onClose,
  loading = false,
  triggerElement = null,
  confirmBtnClass = null,
  variant = 'danger'
}) => {
  const cancelBtnRef = useRef(null);
  const confirmBtnRef = useRef(null);
  const dialogRef = useRef(null);

  // Store element that opened modal to restore focus on unmount/close
  const lastActiveElementRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      // Remember triggering element if passed or capture current active element
      lastActiveElementRef.current = triggerElement || document.activeElement;

      // Lock body scroll
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';

      // Auto-focus default button (Confirm/Delete)
      const timer = setTimeout(() => {
        if (confirmBtnRef.current) {
          confirmBtnRef.current.focus();
        }
      }, 50);

      return () => {
        clearTimeout(timer);
        document.body.style.overflow = originalOverflow;
        // Restore focus on close
        if (lastActiveElementRef.current && typeof lastActiveElementRef.current.focus === 'function') {
          lastActiveElementRef.current.focus();
        }
      };
    }
  }, [isOpen, triggerElement]);

  // Keyboard Event Handlers (Escape, Enter, Tab focus trap)
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      // Ignore key events while deletion is in progress
      if (loading) {
        if (e.key === 'Escape' || e.key === 'Enter') {
          e.preventDefault();
        }
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === 'Enter') {
        // Native click activation for active element
        if (document.activeElement && typeof document.activeElement.click === 'function') {
          e.preventDefault();
          document.activeElement.click();
        }
        return;
      }

      // Focus Trap Logic for Tab & Shift+Tab
      if (e.key === 'Tab') {
        const focusableElements = [cancelBtnRef.current, confirmBtnRef.current].filter(Boolean);
        if (focusableElements.length === 0) return;

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey) {
          // Shift + Tab: if on first element, wrap to last
          if (document.activeElement === firstElement) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          // Tab: if on last element, wrap to first
          if (document.activeElement === lastElement) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, loading, onClose]);

  if (!isOpen) return null;

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget && !loading) {
      onClose();
    }
  };

  return (
    <AnimatePresence>
      <div
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
        onClick={handleBackdropClick}
      >
        <motion.div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-dialog-title"
          aria-describedby="confirm-dialog-desc"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
          className="w-full max-w-md rounded-2xl border border-border/40 bg-card p-6 shadow-2xl text-left focus:outline-none"
          tabIndex={-1}
        >
          <h3 id="confirm-dialog-title" className="text-base font-bold text-foreground">
            {title}
          </h3>

          <p id="confirm-dialog-desc" className="mt-2.5 text-xs text-muted-foreground leading-relaxed">
            {message}
          </p>

          <div className="mt-6 flex justify-end gap-3">
            <button
              ref={cancelBtnRef}
              disabled={loading}
              onClick={() => !loading && onClose()}
              className="rounded-xl px-4 py-2 text-xs font-semibold border border-border/30 hover:bg-muted transition-colors disabled:opacity-50 focus:ring-2 focus:ring-primary focus:ring-offset-2 dark:focus:ring-offset-slate-900 focus:outline-none"
            >
              {cancelText}
            </button>

            <button
              ref={confirmBtnRef}
              disabled={loading}
              onClick={() => !loading && onConfirm()}
              className={`rounded-xl px-4 py-2 text-xs font-semibold text-white shadow-md active:scale-95 transition-all disabled:opacity-50 flex items-center gap-2 focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-slate-900 focus:outline-none ${
                confirmBtnClass
                  ? confirmBtnClass
                  : variant === 'success'
                  ? 'bg-emerald-600 hover:bg-emerald-700 focus:ring-emerald-500'
                  : variant === 'primary'
                  ? 'bg-primary hover:bg-primary-hover focus:ring-primary'
                  : 'bg-danger hover:bg-danger-hover focus:ring-danger'
              }`}
            >
              {loading && (
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
              )}
              <span>{confirmText}</span>
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

export default ConfirmModal;
