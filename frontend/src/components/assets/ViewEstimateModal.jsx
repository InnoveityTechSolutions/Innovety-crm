import React, { useState, useEffect } from 'react';
import { X, Printer, FileText, AlertCircle, RefreshCw, Download } from 'lucide-react';
import api from '../../services/api';
import EstimateDocumentPreview from './EstimateDocumentPreview';
import { generateEstimatePdf, getEstimatePdfFilename } from '../../utils/estimatePdfGenerator';

const ViewEstimateModal = ({ isOpen, onClose, estimateId }) => {
  const [estimate, setEstimate] = useState(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  useEffect(() => {
    if (!isOpen || !estimateId) {
      setEstimate(null);
      setErrorMsg('');
      setDownloadingPdf(false);
      return;
    }

    const fetchEstimate = async () => {
      try {
        setLoading(true);
        setErrorMsg('');
        const res = await api.get(`/assets/estimates/${estimateId}`);
        setEstimate(res.data);
      } catch (err) {
        console.error('Failed to load estimate:', err);
        setErrorMsg(err.response?.data?.message || 'Failed to load estimate details.');
      } finally {
        setLoading(false);
      }
    };

    fetchEstimate();
  }, [isOpen, estimateId]);

  useEffect(() => {
    if (isOpen) {
      document.body.classList.add('has-estimate-preview');
      return () => {
        document.body.classList.remove('has-estimate-preview');
      };
    }
  }, [isOpen]);

  const handleDownloadPdf = async () => {
    if (downloadingPdf || !estimate) return;
    try {
      setDownloadingPdf(true);
      const filename = getEstimatePdfFilename(estimate);
      await generateEstimatePdf('printable-estimate-document', filename);
    } catch (err) {
      console.error('Failed to download PDF:', err);
      alert('Failed to generate PDF document. Please try again or use Print Document.');
    } finally {
      setDownloadingPdf(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-2 sm:p-4 animate-in fade-in duration-200 print:p-0 print:bg-white print:static print:z-auto">
      <div className="bg-card w-full max-w-5xl h-[92vh] rounded-3xl border border-border shadow-2xl flex flex-col overflow-hidden text-foreground print:border-none print:shadow-none print:w-full print:h-auto print:max-w-none print:p-0">
        {/* Header - Hidden during browser print */}
        <div className="px-6 py-4 border-b border-border flex items-center justify-between shrink-0 bg-muted/20 print:hidden">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20">
              <FileText className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-sm text-foreground">
                  {estimate?.estimateNumber ? `Estimate ${estimate.estimateNumber}` : 'Estimate Document Preview'}
                </h3>
                {estimate?.status && (
                  <span
                    className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full border uppercase ${
                      estimate.status === 'CANCELLED'
                        ? 'bg-rose-500/10 text-rose-600 border-rose-500/20'
                        : 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
                    }`}
                  >
                    {estimate.status}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {estimate?.billToName ? `Issued to ${estimate.billToName}` : 'Historical estimate snapshot'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted transition-all cursor-pointer"
              title="Close Preview"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-muted/10 print:p-0 print:bg-white print:overflow-visible">
          {loading && (
            <div className="h-full min-h-[400px] flex flex-col items-center justify-center gap-3">
              <RefreshCw className="h-8 w-8 text-primary animate-spin" />
              <p className="text-xs font-semibold text-muted-foreground">Loading frozen estimate snapshot...</p>
            </div>
          )}

          {errorMsg && !loading && (
            <div className="h-full min-h-[400px] flex flex-col items-center justify-center gap-3 text-center">
              <div className="p-3 rounded-2xl bg-rose-500/10 text-rose-500 border border-rose-500/20">
                <AlertCircle className="h-8 w-8" />
              </div>
              <h4 className="text-sm font-bold text-foreground">Failed to Load Estimate</h4>
              <p className="text-xs text-muted-foreground max-w-sm">{errorMsg}</p>
              <button
                onClick={onClose}
                className="mt-2 px-4 py-2 rounded-xl border border-border bg-card text-xs font-bold hover:bg-muted transition-all"
              >
                Close
              </button>
            </div>
          )}

          {!loading && !errorMsg && estimate && (
            <div className="flex justify-center">
              <EstimateDocumentPreview estimateData={estimate} />
            </div>
          )}
        </div>

        {/* Footer Controls - Hidden during print */}
        <div className="px-6 py-3 border-t border-border flex items-center justify-between shrink-0 bg-card print:hidden">
          <p className="text-[11px] text-muted-foreground">
            {estimate?.createdAt ? `Generated on ${new Date(estimate.createdAt).toLocaleString()}` : ''}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded-xl border border-border hover:bg-muted text-xs font-bold transition-all cursor-pointer"
            >
              Close
            </button>
            <button
              onClick={() => window.print()}
              disabled={loading || !estimate || downloadingPdf}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-primary text-primary-foreground text-xs font-bold shadow-md hover:bg-primary-hover transition-all disabled:opacity-50 cursor-pointer"
              title="Open browser print dialog"
            >
              <Printer className="h-3.5 w-3.5" />
              <span>Print Document</span>
            </button>
            <button
              onClick={handleDownloadPdf}
              disabled={loading || !estimate || downloadingPdf}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-bold shadow-md hover:opacity-90 transition-all disabled:opacity-50 cursor-pointer"
              title="Download PDF directly to your device"
            >
              {downloadingPdf ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  <span>Generating PDF...</span>
                </>
              ) : (
                <>
                  <Download className="h-3.5 w-3.5" />
                  <span>Download PDF</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ViewEstimateModal;
