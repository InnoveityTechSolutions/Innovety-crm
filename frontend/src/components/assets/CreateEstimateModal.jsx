import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  FileText,
  Printer,
  ChevronRight,
  ChevronLeft,
  Plus,
  Trash2,
  CheckCircle2,
  Layers,
  Building,
  CreditCard,
  Percent,
  FileCheck,
  AlertCircle,
  Download,
  RefreshCw
} from 'lucide-react';
import api from '../../services/api';
import EstimateDocumentPreview from './EstimateDocumentPreview';
import { generateEstimatePdf, getEstimatePdfFilename } from '../../utils/estimatePdfGenerator';

const GST_SLABS = [
  { label: '0% (Exempt)', value: 0 },
  { label: '5%', value: 5 },
  { label: '12%', value: 12 },
  { label: '18% (Standard)', value: 18 },
  { label: '28%', value: 28 },
  { label: 'Custom', value: 'CUSTOM' }
];

const CreateEstimateModal = ({ isOpen, onClose, selectedAssets = [], organizationId, onEstimateCreated }) => {
  const [step, setStep] = useState(1); // 1: Items, 2: Customer & Tax, 3: A4 Preview
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successEstimate, setSuccessEstimate] = useState(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  useEffect(() => {
    if (isOpen && step === 3) {
      document.body.classList.add('has-estimate-preview');
      return () => {
        document.body.classList.remove('has-estimate-preview');
      };
    }
  }, [isOpen, step]);

  // Grouped mode toggle
  const [groupIdentical, setGroupIdentical] = useState(true);

  // Base settings loaded from backend
  const [settings, setSettings] = useState(null);

  // Form State
  const [estimateMeta, setEstimateMeta] = useState({
    title: 'Estimate',
    reference: '',
    placeOfSupply: 'Tamil Nadu (33)',
    estimateDate: new Date().toISOString().split('T')[0],
    notes: 'Looking forward for your business.',
    termsAndConditions: [
      '1. Delivery: 2 days against P.O',
      '2. Payment: 100% advance',
      '3. Taxes: As applicable',
      '4. Validity of Quote: 7 days only'
    ]
  });

  const [billTo, setBillTo] = useState({
    name: '',
    address: '',
    city: '',
    state: 'Tamil Nadu',
    pincode: '',
    country: 'India',
    gstin: ''
  });

  const [taxSelection, setTaxSelection] = useState(18);
  const [customTaxRate, setCustomTaxRate] = useState(18);

  const [banking, setBanking] = useState({
    bankName: '',
    bankIfsc: '',
    bankAccountNo: '',
    bankBranch: ''
  });

  // Line items state
  const [items, setItems] = useState([]);

  // Preview data computed from backend or local
  const [previewData, setPreviewData] = useState(null);

  // Load billing settings for current organization
  useEffect(() => {
    if (!isOpen) return;

    const fetchSettings = async () => {
      try {
        setLoading(true);
        const params = organizationId ? { organizationId } : {};
        const res = await api.get('/assets/estimates/settings', { params });
        if (res.data) {
          setSettings(res.data);
          if (res.data.banking) setBanking(res.data.banking);
          if (res.data.defaultNotes) setEstimateMeta((prev) => ({ ...prev, notes: res.data.defaultNotes }));
          if (res.data.defaultTerms) setEstimateMeta((prev) => ({ ...prev, termsAndConditions: res.data.defaultTerms }));
          if (res.data.defaultPlaceOfSupply) {
            setEstimateMeta((prev) => ({ ...prev, placeOfSupply: res.data.defaultPlaceOfSupply }));
          }
        }
      } catch (err) {
        console.error('Failed to load billing settings:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchSettings();
  }, [isOpen, organizationId]);

  // Transform selected assets into line items
  useEffect(() => {
    if (!selectedAssets || selectedAssets.length === 0) {
      setItems([]);
      return;
    }

    if (groupIdentical) {
      // Group by name + cost + brand
      const groups = new Map();
      selectedAssets.forEach((a) => {
        const key = `${a.name || 'Item'}__${a.cost || 0}__${a.brand || ''}`;
        if (!groups.has(key)) {
          groups.set(key, {
            title: a.name || 'Hardware Asset',
            category: a.category || '',
            description: a.description || '',
            quantity: 0,
            unit: 'nos',
            rate: parseFloat(a.cost) || 0,
            assetIds: [],
            serialNumbers: []
          });
        }
        const grp = groups.get(key);
        grp.quantity += 1;
        if (a.assetId) grp.assetIds.push(a.assetId);
        if (a.serialNumber) grp.serialNumbers.push(a.serialNumber);
      });

      const groupedList = Array.from(groups.values()).map((g, idx) => {
        const extraNotes = [];
        if (g.serialNumbers.length > 0) extraNotes.push(`S/N: ${g.serialNumbers.join(', ')}`);
        if (g.assetIds.length > 0) extraNotes.push(`IDs: ${g.assetIds.join(', ')}`);

        const desc = [g.description, extraNotes.join(' | ')].filter(Boolean).join('\n');

        return {
          id: `item-${idx}`,
          title: g.title,
          description: desc,
          quantity: g.quantity,
          unit: g.unit,
          rate: g.rate
        };
      });

      setItems(groupedList);
    } else {
      // Ungrouped mode
      const rawList = selectedAssets.map((a, idx) => {
        const extraNotes = [];
        if (a.serialNumber) extraNotes.push(`S/N: ${a.serialNumber}`);
        if (a.assetId) extraNotes.push(`ID: ${a.assetId}`);

        const desc = [a.description, extraNotes.join(' | ')].filter(Boolean).join('\n');

        return {
          id: `item-${idx}`,
          assetId: a.id,
          title: a.name || 'Hardware Asset',
          description: desc,
          quantity: 1,
          unit: 'nos',
          rate: parseFloat(a.cost) || 0
        };
      });

      setItems(rawList);
    }
  }, [selectedAssets, groupIdentical]);

  const activeTaxRate = taxSelection === 'CUSTOM' ? parseFloat(customTaxRate) || 0 : taxSelection;

  // Item modification handlers
  const handleItemChange = (index, field, value) => {
    setItems((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const handleAddItem = () => {
    setItems((prev) => [
      ...prev,
      {
        id: `manual-${Date.now()}`,
        title: 'Freight / Installation Charges',
        description: '',
        quantity: 1,
        unit: 'nos',
        rate: 250
      }
    ]);
  };

  const handleRemoveItem = (index) => {
    setItems((prev) => prev.filter((_, idx) => idx !== index));
  };

  // Generate / Fetch Preview
  const fetchPreview = async () => {
    try {
      setLoading(true);
      setErrorMsg('');

      if (items.length === 0) {
        setErrorMsg('Please add at least one line item.');
        setLoading(false);
        return false;
      }

      if (!billTo.name.trim()) {
        setErrorMsg('Customer name (Bill To) is required.');
        setLoading(false);
        return false;
      }

      const payload = {
        title: estimateMeta.title || 'Estimate',
        reference: estimateMeta.reference,
        placeOfSupply: estimateMeta.placeOfSupply,
        estimateDate: estimateMeta.estimateDate,
        notes: estimateMeta.notes,
        termsAndConditions: estimateMeta.termsAndConditions,
        taxRate: activeTaxRate,
        billTo,
        banking,
        items: items.map((it) => ({
          title: it.title,
          description: it.description,
          quantity: it.quantity,
          unit: it.unit,
          rate: it.rate,
          assetId: it.assetId || null
        })),
        company: settings?.company || {}
      };

      const params = organizationId ? { organizationId } : {};
      const res = await api.post('/assets/estimates/preview', payload, { params });
      if (res.data) {
        setPreviewData(res.data);
        return true;
      }
      return false;
    } catch (err) {
      console.error('Preview error:', err);
      setErrorMsg(err.response?.data?.message || 'Failed to generate preview.');
      return false;
    } finally {
      setLoading(false);
    }
  };

  const handleProceedToPreview = async () => {
    const ok = await fetchPreview();
    if (ok) {
      setStep(3);
    }
  };

  // Persist estimate
  const handleSaveEstimate = async () => {
    try {
      setSaving(true);
      setErrorMsg('');

      const payload = {
        title: estimateMeta.title || 'Estimate',
        reference: estimateMeta.reference,
        placeOfSupply: estimateMeta.placeOfSupply,
        estimateDate: estimateMeta.estimateDate,
        notes: estimateMeta.notes,
        termsAndConditions: estimateMeta.termsAndConditions,
        taxRate: activeTaxRate,
        billTo,
        banking,
        items: items.map((it) => ({
          title: it.title,
          description: it.description,
          quantity: it.quantity,
          unit: it.unit,
          rate: it.rate,
          assetId: it.assetId || null
        })),
        company: settings?.company || {}
      };

      const params = organizationId ? { organizationId } : {};
      const res = await api.post('/assets/estimates', payload, { params });

      if (res.data?.success && res.data?.estimate) {
        setSuccessEstimate(res.data.estimate);
        setPreviewData({
          ...res.data.estimate,
          items: res.data.estimate.items || previewData.items,
          company: {
            name: res.data.estimate.companyName,
            address: res.data.estimate.companyAddress,
            city: res.data.estimate.companyCity,
            state: res.data.estimate.companyState,
            pincode: res.data.estimate.companyPincode,
            country: res.data.estimate.companyCountry,
            phone: res.data.estimate.companyPhone,
            email: res.data.estimate.companyEmail,
            gstin: res.data.estimate.companyGstin,
            logo: res.data.estimate.companyLogo
          },
          billTo: {
            name: res.data.estimate.billToName,
            address: res.data.estimate.billToAddress,
            city: res.data.estimate.billToCity,
            state: res.data.estimate.billToState,
            pincode: res.data.estimate.billToPincode,
            country: res.data.estimate.billToCountry,
            gstin: res.data.estimate.billToGstin
          },
          banking: {
            bankName: res.data.estimate.bankName,
            bankIfsc: res.data.estimate.bankIfsc,
            bankAccountNo: res.data.estimate.bankAccountNo,
            bankBranch: res.data.estimate.bankBranch
          }
        });

        if (onEstimateCreated) {
          onEstimateCreated(res.data.estimate);
        }
      }
    } catch (err) {
      console.error('Save estimate error:', err);
      setErrorMsg(err.response?.data?.message || 'Failed to save estimate.');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-2 sm:p-4 print:p-0 print:bg-white print:static">
      <div className="w-full max-w-5xl rounded-2xl border border-border/50 bg-card p-4 sm:p-6 shadow-2xl flex flex-col max-h-[95vh] animate-in zoom-in-95 duration-200 print:shadow-none print:border-none print:max-w-none print:p-0 print:max-h-none print:bg-white">
        {/* Modal Header (Hidden in Print) */}
        <div className="flex items-center justify-between border-b border-border pb-3 shrink-0 print:hidden">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center border border-emerald-500/20">
              <FileText className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-foreground">
                {successEstimate ? `Official Document: ${successEstimate.estimateNumber}` : 'Generate Bill / Estimate'}
              </h3>
              <p className="text-[11px] text-muted-foreground">
                {successEstimate
                  ? 'Saved immutable commercial document ready for print or PDF download.'
                  : `Step ${step} of 3: ${
                      step === 1 ? 'Verify Line Items' : step === 2 ? 'Customer, Tax & Banking' : 'A4 Document Preview'
                    }`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-xl transition-all"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Steps Navigation Bar (Hidden when finalized or printing) */}
        {!successEstimate && (
          <div className="flex items-center justify-between pt-3 pb-2 border-b border-border/60 shrink-0 text-xs font-bold print:hidden">
            <div className="flex items-center gap-1 sm:gap-2">
              <button
                type="button"
                onClick={() => setStep(1)}
                className={`px-3 py-1 rounded-lg transition-all ${
                  step === 1 ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                1. Items ({items.length})
              </button>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
              <button
                type="button"
                onClick={() => setStep(2)}
                className={`px-3 py-1 rounded-lg transition-all ${
                  step === 2 ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                2. Customer & Tax
              </button>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
              <button
                type="button"
                onClick={() => handleProceedToPreview()}
                className={`px-3 py-1 rounded-lg transition-all ${
                  step === 3 ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                3. A4 Preview
              </button>
            </div>

            {step === 1 && (
              <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-muted-foreground select-none">
                <input
                  type="checkbox"
                  checked={groupIdentical}
                  onChange={(e) => setGroupIdentical(e.target.checked)}
                  className="rounded border-border text-emerald-600 focus:ring-emerald-500"
                />
                <span className="flex items-center gap-1">
                  <Layers className="h-3.5 w-3.5 text-emerald-600" /> Group Identical Items
                </span>
              </label>
            )}
          </div>
        )}

        {/* Error Notification */}
        {errorMsg && (
          <div className="mt-2.5 p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs font-semibold flex items-center gap-2 print:hidden">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Success Banner */}
        {successEstimate && (
          <div className="mt-2.5 p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-400 text-xs font-bold flex items-center justify-between print:hidden">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
              <span>
                {successEstimate.title} {successEstimate.estimateNumber} successfully saved with immutable snapshot!
              </span>
            </div>
            <span className="font-mono text-[11px] bg-emerald-500/20 px-2 py-0.5 rounded">Grand Total: ₹{successEstimate.grandTotal}</span>
          </div>
        )}

        {/* Modal Scrollable Content */}
        <div className="flex-1 overflow-y-auto py-3 space-y-4 print:overflow-visible print:p-0">
          {/* ──────────────── STEP 1: ITEMS REVIEW ──────────────── */}
          {step === 1 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-muted-foreground uppercase">
                  Line Items ({items.length})
                </p>
                <button
                  type="button"
                  onClick={handleAddItem}
                  className="px-3 py-1 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-bold text-xs flex items-center gap-1 border border-emerald-500/20 transition-all"
                >
                  <Plus className="h-3.5 w-3.5" /> Add Additional Item
                </button>
              </div>

              <div className="space-y-2.5 max-h-[60vh] overflow-y-auto pr-1">
                {items.map((item, idx) => (
                  <div
                    key={item.id || idx}
                    className="p-3 rounded-xl border border-border/70 bg-card/60 space-y-2.5 hover:border-primary/40 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 grid grid-cols-1 sm:grid-cols-12 gap-2">
                        <div className="sm:col-span-6 flex flex-col gap-1">
                          <label className="text-[10px] font-bold text-muted-foreground uppercase">
                            Item Title *
                          </label>
                          <input
                            type="text"
                            required
                            value={item.title}
                            onChange={(e) => handleItemChange(idx, 'title', e.target.value)}
                            className="w-full text-xs font-bold"
                            placeholder="e.g. 2MP WiFi PT Camera Indoor"
                          />
                        </div>

                        <div className="sm:col-span-2 flex flex-col gap-1">
                          <label className="text-[10px] font-bold text-muted-foreground uppercase">
                            Qty *
                          </label>
                          <input
                            type="number"
                            min="0.01"
                            step="1"
                            value={item.quantity}
                            onChange={(e) => handleItemChange(idx, 'quantity', e.target.value)}
                            className="w-full text-xs font-semibold text-center"
                          />
                        </div>

                        <div className="sm:col-span-2 flex flex-col gap-1">
                          <label className="text-[10px] font-bold text-muted-foreground uppercase">
                            Unit
                          </label>
                          <input
                            type="text"
                            value={item.unit || 'nos'}
                            onChange={(e) => handleItemChange(idx, 'unit', e.target.value)}
                            className="w-full text-xs text-center"
                            placeholder="nos"
                          />
                        </div>

                        <div className="sm:col-span-2 flex flex-col gap-1">
                          <label className="text-[10px] font-bold text-muted-foreground uppercase">
                            Rate (₹) *
                          </label>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.rate}
                            onChange={(e) => handleItemChange(idx, 'rate', e.target.value)}
                            className="w-full text-xs font-mono font-bold text-right"
                            placeholder="0.00"
                          />
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleRemoveItem(idx)}
                        className="p-1.5 text-muted-foreground hover:text-rose-500 rounded-lg hover:bg-rose-500/10 transition-all ml-1 mt-5"
                        title="Remove item"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-bold text-muted-foreground uppercase flex items-center justify-between">
                        <span>Description / Serial Numbers / Specs</span>
                        <span className="font-mono text-xs text-foreground">
                          Amount: ₹{((parseFloat(item.quantity) || 0) * (parseFloat(item.rate) || 0)).toFixed(2)}
                        </span>
                      </label>
                      <textarea
                        rows={2}
                        value={item.description}
                        onChange={(e) => handleItemChange(idx, 'description', e.target.value)}
                        placeholder="Additional hardware specs, serial numbers, accessories..."
                        className="text-xs w-full"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ──────────────── STEP 2: CUSTOMER, TAX & DETAILS ──────────────── */}
          {step === 2 && (
            <div className="space-y-4">
              {/* Document Identity */}
              <div className="p-3.5 rounded-xl border border-border/70 bg-card/60 space-y-2.5">
                <p className="text-xs font-bold text-foreground flex items-center gap-1.5">
                  <FileText className="h-4 w-4 text-primary" /> Document Information
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-muted-foreground uppercase">Title</label>
                    <input
                      type="text"
                      value={estimateMeta.title}
                      onChange={(e) => setEstimateMeta({ ...estimateMeta, title: e.target.value })}
                      placeholder="Estimate"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-muted-foreground uppercase">Date</label>
                    <input
                      type="date"
                      value={estimateMeta.estimateDate}
                      onChange={(e) => setEstimateMeta({ ...estimateMeta, estimateDate: e.target.value })}
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-muted-foreground uppercase">Reference</label>
                    <input
                      type="text"
                      value={estimateMeta.reference}
                      onChange={(e) => setEstimateMeta({ ...estimateMeta, reference: e.target.value })}
                      placeholder="e.g. Wifi Pt camera"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-muted-foreground uppercase">Place Of Supply</label>
                    <input
                      type="text"
                      value={estimateMeta.placeOfSupply}
                      onChange={(e) => setEstimateMeta({ ...estimateMeta, placeOfSupply: e.target.value })}
                      placeholder="e.g. Tamil Nadu (33)"
                    />
                  </div>
                </div>
              </div>

              {/* Bill To Customer Section */}
              <div className="p-3.5 rounded-xl border border-border/70 bg-card/60 space-y-2.5">
                <p className="text-xs font-bold text-foreground flex items-center gap-1.5">
                  <Building className="h-4 w-4 text-emerald-600" /> Bill To (Customer Details)
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-2 flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-muted-foreground uppercase">Customer / Client Name *</label>
                    <input
                      type="text"
                      required
                      value={billTo.name}
                      onChange={(e) => setBillTo({ ...billTo, name: e.target.value })}
                      placeholder="e.g. Innoveity / ABC Corp"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-muted-foreground uppercase">Customer GSTIN (Optional)</label>
                    <input
                      type="text"
                      value={billTo.gstin}
                      onChange={(e) => setBillTo({ ...billTo, gstin: e.target.value.toUpperCase() })}
                      placeholder="e.g. 33ACFPN3295D2ZQ"
                    />
                  </div>

                  <div className="sm:col-span-3 flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-muted-foreground uppercase">Address</label>
                    <input
                      type="text"
                      value={billTo.address}
                      onChange={(e) => setBillTo({ ...billTo, address: e.target.value })}
                      placeholder="Street address, building, floor..."
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-muted-foreground uppercase">City</label>
                    <input
                      type="text"
                      value={billTo.city}
                      onChange={(e) => setBillTo({ ...billTo, city: e.target.value })}
                      placeholder="Chennai"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-muted-foreground uppercase">State</label>
                    <input
                      type="text"
                      value={billTo.state}
                      onChange={(e) => setBillTo({ ...billTo, state: e.target.value })}
                      placeholder="Tamil Nadu"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-muted-foreground uppercase">PIN / Postal Code</label>
                    <input
                      type="text"
                      value={billTo.pincode}
                      onChange={(e) => setBillTo({ ...billTo, pincode: e.target.value })}
                      placeholder="600059"
                    />
                  </div>
                </div>
              </div>

              {/* Tax / GST Configuration */}
              <div className="p-3.5 rounded-xl border border-border/70 bg-card/60 space-y-2.5">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold text-foreground flex items-center gap-1.5">
                    <Percent className="h-4 w-4 text-amber-500" /> Tax & GST Configuration
                  </p>
                  <span className="text-[11px] font-bold text-emerald-600 bg-emerald-500/10 px-2 py-0.5 rounded-lg border border-emerald-500/20">
                    {billTo.state?.toLowerCase().trim() === (settings?.company?.state || 'Tamil Nadu').toLowerCase().trim()
                      ? 'Intra-State: CGST (50%) + SGST (50%)'
                      : 'Inter-State: IGST (100%)'}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {GST_SLABS.map((slab) => (
                    <button
                      key={slab.label}
                      type="button"
                      onClick={() => setTaxSelection(slab.value)}
                      className={`px-3 py-1 text-xs font-bold rounded-xl border transition-all ${
                        taxSelection === slab.value
                          ? 'bg-amber-500 text-white border-amber-600 shadow-sm'
                          : 'border-border bg-card hover:bg-muted text-foreground'
                      }`}
                    >
                      {slab.label}
                    </button>
                  ))}

                  {taxSelection === 'CUSTOM' && (
                    <div className="flex items-center gap-1.5 ml-2">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.5"
                        value={customTaxRate}
                        onChange={(e) => setCustomTaxRate(e.target.value)}
                        className="w-20 text-xs font-bold text-center"
                        placeholder="%"
                      />
                      <span className="text-xs font-bold">%</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Banking Details */}
              <div className="p-3.5 rounded-xl border border-border/70 bg-card/60 space-y-2.5">
                <p className="text-xs font-bold text-foreground flex items-center gap-1.5">
                  <CreditCard className="h-4 w-4 text-blue-500" /> Banking Credentials (Printed on Estimate)
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-muted-foreground uppercase">Bank Name</label>
                    <input
                      type="text"
                      value={banking.bankName}
                      onChange={(e) => setBanking({ ...banking, bankName: e.target.value })}
                      placeholder="e.g. HDFC Bank"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-muted-foreground uppercase">IFSC Code</label>
                    <input
                      type="text"
                      value={banking.bankIfsc}
                      onChange={(e) => setBanking({ ...banking, bankIfsc: e.target.value.toUpperCase() })}
                      placeholder="e.g. HDFC0001234"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-muted-foreground uppercase">Account No</label>
                    <input
                      type="text"
                      value={banking.bankAccountNo}
                      onChange={(e) => setBanking({ ...banking, bankAccountNo: e.target.value })}
                      placeholder="e.g. 50200012345678"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-muted-foreground uppercase">Branch</label>
                    <input
                      type="text"
                      value={banking.bankBranch}
                      onChange={(e) => setBanking({ ...banking, bankBranch: e.target.value })}
                      placeholder="e.g. T. Nagar"
                    />
                  </div>
                </div>
              </div>

              {/* Notes & Terms */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase">Notes</label>
                  <textarea
                    rows={3}
                    value={estimateMeta.notes}
                    onChange={(e) => setEstimateMeta({ ...estimateMeta, notes: e.target.value })}
                    placeholder="e.g. Looking forward for your business."
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase">Terms & Conditions (One per line)</label>
                  <textarea
                    rows={3}
                    value={
                      Array.isArray(estimateMeta.termsAndConditions)
                        ? estimateMeta.termsAndConditions.join('\n')
                        : estimateMeta.termsAndConditions
                    }
                    onChange={(e) =>
                      setEstimateMeta({
                        ...estimateMeta,
                        termsAndConditions: e.target.value.split('\n')
                      })
                    }
                    placeholder="1. Delivery: 2 days..."
                  />
                </div>
              </div>
            </div>
          )}

          {/* ──────────────── STEP 3: A4 PREVIEW ──────────────── */}
          {step === 3 && previewData && (
            <div className="space-y-3">
              <EstimateDocumentPreview estimateData={previewData} />
            </div>
          )}
        </div>

        {/* Modal Footer Controls (Hidden in Print) */}
        <div className="border-t border-border pt-3 flex items-center justify-between shrink-0 print:hidden">
          <div>
            {step > 1 && !successEstimate && (
              <button
                type="button"
                onClick={() => setStep(step - 1)}
                className="px-4 py-1.5 rounded-xl border border-border hover:bg-muted font-bold text-xs flex items-center gap-1.5 transition-all"
              >
                <ChevronLeft className="h-4 w-4" /> Back
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 rounded-xl border border-border hover:bg-muted font-bold text-xs transition-all"
            >
              {successEstimate ? 'Close' : 'Cancel'}
            </button>

            {step === 1 && (
              <button
                type="button"
                disabled={items.length === 0}
                onClick={() => setStep(2)}
                className="px-5 py-1.5 rounded-xl bg-primary text-primary-foreground font-bold text-xs flex items-center gap-1.5 shadow-md hover:bg-primary/90 transition-all disabled:opacity-50"
              >
                Next: Billing Details <ChevronRight className="h-4 w-4" />
              </button>
            )}

            {step === 2 && (
              <button
                type="button"
                disabled={loading || !billTo.name.trim()}
                onClick={() => handleProceedToPreview()}
                className="px-5 py-1.5 rounded-xl bg-emerald-600 text-white font-bold text-xs flex items-center gap-1.5 shadow-md hover:bg-emerald-700 transition-all disabled:opacity-50"
              >
                {loading ? 'Calculating...' : 'Preview Document'} <ChevronRight className="h-4 w-4" />
              </button>
            )}

            {step === 3 && !successEstimate && (
              <button
                type="button"
                disabled={saving}
                onClick={handleSaveEstimate}
                className="px-6 py-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-700 text-white font-bold text-xs flex items-center gap-1.5 shadow-lg hover:from-emerald-700 hover:to-teal-800 transition-all disabled:opacity-50"
              >
                <FileCheck className="h-4 w-4" /> {saving ? 'Saving...' : 'Save & Finalize Estimate'}
              </button>
            )}

            {step === 3 && (
              <>
                <button
                  type="button"
                  onClick={() => window.print()}
                  disabled={downloadingPdf}
                  className="px-4 py-1.5 rounded-xl bg-primary text-primary-foreground font-bold text-xs flex items-center gap-1.5 shadow-md hover:bg-primary-hover transition-all disabled:opacity-50"
                  title="Open browser print dialog"
                >
                  <Printer className="h-3.5 w-3.5" /> Print Document
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (downloadingPdf) return;
                    const est = successEstimate || previewData;
                    if (!est) return;
                    try {
                      setDownloadingPdf(true);
                      const filename = getEstimatePdfFilename(est);
                      await generateEstimatePdf('printable-estimate-document', filename);
                    } catch (err) {
                      console.error('Failed to download PDF:', err);
                      alert('Failed to generate PDF document. Please try using Print Document.');
                    } finally {
                      setDownloadingPdf(false);
                    }
                  }}
                  disabled={downloadingPdf}
                  className="px-4 py-1.5 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 font-bold text-xs flex items-center gap-1.5 shadow-md hover:opacity-90 transition-all disabled:opacity-50"
                  title="Download PDF directly to your device"
                >
                  {downloadingPdf ? (
                    <>
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Generating PDF...
                    </>
                  ) : (
                    <>
                      <Download className="h-3.5 w-3.5" /> Download PDF
                    </>
                  )}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CreateEstimateModal;
