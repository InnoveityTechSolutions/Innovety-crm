import React, { useState } from 'react';
import { X, Ban, AlertTriangle } from 'lucide-react';
import api from '../../services/api';

const CancelEstimateModal = ({ isOpen, onClose, estimate, onEstimateCancelled }) => {
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  if (!isOpen || !estimate) return null;

  const handleCancelSubmit = async (e) => {
    e.preventDefault();
    const trimmed = reason.trim();
    if (!trimmed) {
      setErrorMsg('Please provide a reason for cancelling this estimate.');
      return;
    }
    if (trimmed.length > 250) {
      setErrorMsg('Reason cannot exceed 250 characters.');
      return;
    }

    try {
      setLoading(true);
      setErrorMsg('');
      const res = await api.patch(`/assets/estimates/${estimate.id}/cancel`, {
        reason: trimmed
      });
      if (res.data?.success) {
        if (onEstimateCancelled) {
          onEstimateCancelled(res.data.estimate);
        }
        onClose();
      }
    } catch (err) {
      console.error('Failed to cancel estimate:', err);
      setErrorMsg(err.response?.data?.message || 'Failed to cancel estimate.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-card w-full max-w-md rounded-2xl border border-border shadow-2xl p-6 text-foreground animate-in zoom-in-95 duration-200 text-left">
        <div className="flex items-center justify-between pb-3 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-rose-500/10 text-rose-500 border border-rose-500/20">
              <Ban className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-foreground">Cancel Estimate</h3>
              <p className="text-xs text-muted-foreground font-mono">{estimate.estimateNumber}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleCancelSubmit} className="mt-4 space-y-4">
          <div className="p-3 rounded-xl bg-rose-500/5 border border-rose-500/20 space-y-1.5">
            <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400 font-bold text-xs">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>Voiding Estimate Record</span>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              This action marks estimate <strong className="text-foreground">{estimate.estimateNumber}</strong> (issued to{' '}
              <strong className="text-foreground">{estimate.billToName}</strong> for{' '}
              <strong className="text-foreground">₹{Number(estimate.grandTotal).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong>) as{' '}
              <strong className="text-rose-600">CANCELLED</strong>. The record will remain permanently preserved for audit compliance.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-foreground">
              Cancellation Reason <span className="text-rose-500">*</span>
            </label>
            <textarea
              rows={3}
              required
              maxLength={250}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                if (errorMsg) setErrorMsg('');
              }}
              placeholder="e.g. Client requested quotation change / Order cancelled by purchaser"
              className="w-full bg-background border border-border/80 focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20 rounded-xl p-3 text-xs text-foreground placeholder:text-muted-foreground transition-all resize-none"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>{errorMsg && <span className="text-rose-500 font-semibold">{errorMsg}</span>}</span>
              <span>{reason.length}/250</span>
            </div>
          </div>

          <div className="pt-2 flex justify-end gap-2 border-t border-border">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 rounded-xl border border-border hover:bg-muted text-xs font-bold transition-all cursor-pointer"
            >
              Keep Estimate
            </button>
            <button
              type="submit"
              disabled={loading || !reason.trim()}
              className="px-4 py-2 rounded-xl bg-rose-600 text-white hover:bg-rose-700 text-xs font-extrabold shadow-md shadow-rose-600/20 transition-all disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
            >
              <Ban className="h-3.5 w-3.5" />
              <span>{loading ? 'Cancelling...' : 'Confirm Cancellation'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CancelEstimateModal;
