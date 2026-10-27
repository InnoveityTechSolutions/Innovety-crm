import React, { useState, useEffect } from 'react';
import { getUploadUrl } from '../../services/api';

/**
 * Formats a number to Indian currency format with 2 decimals (e.g. 11,387.00)
 */
const formatIndianNumber = (num) => {
  const n = parseFloat(num);
  if (isNaN(n)) return '0.00';
  return n.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
};

/**
 * A4 Printable Document Preview Component.
 * Styled closely to match the reference document: EST-000224_camera_bill.pdf
 */
const EstimateDocumentPreview = ({ estimateData }) => {
  if (!estimateData) return null;

  const {
    title = 'Estimate',
    estimateNumber = 'EST-000224',
    estimateDate = new Date(),
    reference = '',
    placeOfSupply = '',
    items = [],
    subTotal = 0,
    cgstRate = 0,
    sgstRate = 0,
    igstRate = 0,
    cgstAmount = 0,
    sgstAmount = 0,
    igstAmount = 0,
    grandTotal = 0,
    totalInWords = '',
    notes = '',
    termsAndConditions = [],
    signatoryTitle = 'Authorized Signatory',
    signatureImage = null,
    status = 'GENERATED',
    cancelledAt = null,
    cancellationReason = ''
  } = estimateData;

  // Support both structured objects and flat database snapshot properties
  const company = estimateData.company || {
    name: estimateData.companyName,
    address: estimateData.companyAddress,
    city: estimateData.companyCity,
    state: estimateData.companyState,
    pincode: estimateData.companyPincode,
    country: estimateData.companyCountry,
    phone: estimateData.companyPhone,
    email: estimateData.companyEmail,
    gstin: estimateData.companyGstin,
    logo: estimateData.companyLogo
  };

  const billTo = estimateData.billTo || {
    name: estimateData.billToName,
    address: estimateData.billToAddress,
    city: estimateData.billToCity,
    state: estimateData.billToState,
    pincode: estimateData.billToPincode,
    country: estimateData.billToCountry,
    gstin: estimateData.billToGstin
  };

  const banking = estimateData.banking || {
    bankName: estimateData.bankName,
    bankIfsc: estimateData.bankIfsc,
    bankAccountNo: estimateData.bankAccountNo,
    bankBranch: estimateData.bankBranch
  };

  const isCancelled = status === 'CANCELLED';

  // Safely resolve company logo and signature URLs (relative /uploads, absolute HTTP/S, data URLs)
  const rawLogo = company.logo || estimateData.companyLogo;
  const resolvedCompanyLogo = getUploadUrl(rawLogo);
  const [logoLoadFailed, setLogoLoadFailed] = useState(false);

  useEffect(() => {
    setLogoLoadFailed(false);
  }, [rawLogo]);

  const rawSignature = signatureImage || estimateData.signatureImage || company.signatureImage;
  const resolvedSignatureImage = getUploadUrl(rawSignature);
  const [sigLoadFailed, setSigLoadFailed] = useState(false);

  useEffect(() => {
    setSigLoadFailed(false);
  }, [rawSignature]);

  const formattedDate = estimateDate
    ? new Date(estimateDate).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      })
    : '';

  const formattedCancelledDate = cancelledAt
    ? new Date(cancelledAt).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      })
    : '';

  const termsList = Array.isArray(termsAndConditions)
    ? termsAndConditions
    : typeof termsAndConditions === 'string'
    ? termsAndConditions.split('\n').filter(Boolean)
    : [];

  return (
    <div className="estimate-print-wrapper w-full flex justify-center bg-muted/30 p-2 sm:p-4 overflow-x-auto print:p-0 print:bg-white print:overflow-visible">
      {/* A4 Document Container: 210mm wide standard */}
      <div
        id="printable-estimate-document"
        className="estimate-document relative overflow-hidden bg-white text-slate-900 shadow-xl border border-slate-300 w-full max-w-[800px] min-h-[1050px] p-8 sm:p-10 flex flex-col justify-between font-sans text-xs leading-normal print:shadow-none print:border-none print:max-w-none print:w-full print:p-0 print:m-0 print:min-h-0 print:h-auto print:overflow-visible"
        style={{
          boxSizing: 'border-box'
        }}
      >
        {/* Diagonal CANCELLED Watermark */}
        {isCancelled && (
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center overflow-hidden z-20 opacity-15 select-none print:opacity-20">
            <span className="text-8xl font-black text-rose-600 tracking-widest uppercase -rotate-45 border-8 border-rose-600 p-8 rounded-3xl">
              CANCELLED
            </span>
          </div>
        )}

        <div>
          {/* Prominent Cancellation Banner if Cancelled */}
          {isCancelled && (
            <div className="mb-4 bg-rose-50 border-2 border-rose-500 rounded-xl p-3 flex items-center justify-between text-rose-800 print:bg-rose-50 print:border-rose-600">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded bg-rose-600 text-white font-black text-[10px] uppercase tracking-wider">
                  CANCELLED / VOID
                </span>
                <span className="text-xs font-semibold">
                  This estimate was cancelled{formattedCancelledDate ? ` on ${formattedCancelledDate}` : ''}.
                  {cancellationReason ? ` Reason: "${cancellationReason}"` : ''}
                </span>
              </div>
              <span className="text-[10px] font-mono text-rose-600 uppercase font-bold">Non-Negotiable</span>
            </div>
          )}

          {/* Header Section: Company Logo & Details (Left) + Document Title (Right) */}
          <div className="flex justify-between items-center pb-4 border-b border-slate-300 gap-4">
            <div className="flex items-center gap-5 max-w-[72%]">
              {/* Dedicated Logo Container */}
              <div className="w-36 min-w-[130px] max-w-[150px] flex items-center justify-center shrink-0 py-1">
                {resolvedCompanyLogo && !logoLoadFailed ? (
                  <img
                    src={resolvedCompanyLogo}
                    alt={company.name || 'Company Logo'}
                    className="max-h-[85px] max-w-[140px] w-auto h-auto object-contain"
                    onError={() => setLogoLoadFailed(true)}
                    crossOrigin="anonymous"
                  />
                ) : (
                  <div className="h-16 w-16 rounded-xl bg-emerald-600 text-white font-black flex items-center justify-center text-2xl uppercase tracking-wider print:bg-slate-800 shadow-xs">
                    {(company.name || 'IN')[0]}
                  </div>
                )}
              </div>

              {/* Company Information */}
              <div className="space-y-0.5 text-slate-800 flex-1 min-w-0">
                <h1 className="text-base font-extrabold text-slate-950 uppercase tracking-tight">
                  {company.name || 'Company Name'}
                </h1>
                {company.address && <p className="text-[11px] leading-snug text-slate-600">{company.address}</p>}
                {(company.city || company.state || company.pincode) && (
                  <p className="text-[11px] leading-snug text-slate-600">
                    {[company.city, company.state, company.pincode].filter(Boolean).join(', ')}
                  </p>
                )}
                <div className="text-[11px] text-slate-600 flex flex-wrap gap-x-3 gap-y-0.5 pt-0.5">
                  {company.phone && <span>Ph: {company.phone}</span>}
                  {company.email && <span>Email: {company.email}</span>}
                </div>
                {company.gstin && (
                  <p className="text-[11px] font-bold text-slate-900 pt-0.5">
                    GSTIN: <span className="font-mono">{company.gstin}</span>
                  </p>
                )}
              </div>
            </div>

            <div className="text-right shrink-0">
              <h2 className="text-3xl font-black text-slate-950 uppercase tracking-tight">
                {title || 'Estimate'}
              </h2>
            </div>
          </div>

          {/* Subheader Metadata Box */}
          <div className="grid grid-cols-2 border border-slate-300 mt-3 text-[11px] bg-slate-50/50 print:bg-transparent">
            <div className="p-2.5 border-r border-slate-300 space-y-1">
              <div className="flex">
                <span className="w-28 font-bold text-slate-700">{title} No</span>
                <span className="font-bold text-slate-950 font-mono">: {estimateNumber}</span>
              </div>
              <div className="flex">
                <span className="w-28 font-bold text-slate-700">{title} Date</span>
                <span className="font-semibold text-slate-900">: {formattedDate}</span>
              </div>
              {reference && (
                <div className="flex">
                  <span className="w-28 font-bold text-slate-700">Reference</span>
                  <span className="font-medium text-slate-800">: {reference}</span>
                </div>
              )}
            </div>
            <div className="p-2.5 space-y-1">
              <div className="flex">
                <span className="w-32 font-bold text-slate-700">Place Of Supply</span>
                <span className="font-semibold text-slate-900">: {placeOfSupply || 'Not Specified'}</span>
              </div>
            </div>
          </div>

          {/* Bill To Section */}
          <div className="border-x border-b border-slate-300 p-2.5 text-[11px]">
            <p className="font-bold text-slate-700 uppercase tracking-wide text-[10px]">Bill To</p>
            <p className="font-extrabold text-sm text-slate-950 mt-0.5">{billTo.name || 'Valued Customer'}</p>
            {billTo.address && <p className="text-slate-700 leading-snug mt-0.5">{billTo.address}</p>}
            {(billTo.city || billTo.state || billTo.pincode) && (
              <p className="text-slate-700 leading-snug">
                {[billTo.city, billTo.state, billTo.pincode].filter(Boolean).join(', ')}
              </p>
            )}
            {billTo.country && <p className="text-slate-700">{billTo.country}</p>}
            {billTo.gstin && (
              <p className="font-bold text-slate-900 pt-0.5">
                GSTIN: <span className="font-mono">{billTo.gstin}</span>
              </p>
            )}
          </div>

          {/* Itemized Table */}
          <div className="mt-3 overflow-hidden border border-slate-300">
            <table className="w-full text-left border-collapse text-[11px]">
              <thead>
                <tr className="bg-[#00c853] text-slate-950 font-extrabold uppercase text-[10px] tracking-wider border-b border-slate-300 print:bg-[#00c853]">
                  <th className="py-2 px-2.5 border-r border-slate-300 w-10 text-center">Sr. No</th>
                  <th className="py-2 px-3 border-r border-slate-300">Item & Description</th>
                  <th className="py-2 px-2.5 border-r border-slate-300 w-16 text-center">Qty</th>
                  <th className="py-2 px-2.5 border-r border-slate-300 w-24 text-right">Rate (₹)</th>
                  {igstRate > 0 ? (
                    <th className="py-2 px-2.5 border-r border-slate-300 w-20 text-right">IGST (₹)</th>
                  ) : (
                    <>
                      <th className="py-2 px-2 border-r border-slate-300 w-20 text-right">CGST (₹)</th>
                      <th className="py-2 px-2 border-r border-slate-300 w-20 text-right">SGST (₹)</th>
                    </>
                  )}
                  <th className="py-2 px-3 w-24 text-right">Amount (₹)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {items.map((item, idx) => (
                  <tr key={idx} className="hover:bg-slate-50/50">
                    <td className="py-2 px-2.5 border-r border-slate-200 text-center font-medium text-slate-600 align-top">
                      {item.itemIndex || idx + 1}
                    </td>
                    <td className="py-2 px-3 border-r border-slate-200 align-top space-y-0.5">
                      <p className="font-bold text-slate-950">{item.title}</p>
                      {item.description && (
                        <p className="text-[10px] text-slate-600 whitespace-pre-line leading-relaxed">
                          {item.description}
                        </p>
                      )}
                    </td>
                    <td className="py-2 px-2.5 border-r border-slate-200 text-center align-top">
                      <span className="font-semibold text-slate-900">{parseFloat(item.quantity).toFixed(2)}</span>
                      <span className="block text-[9px] text-slate-500 lowercase">{item.unit || 'nos'}</span>
                    </td>
                    <td className="py-2 px-2.5 border-r border-slate-200 text-right font-mono font-medium text-slate-900 align-top">
                      {formatIndianNumber(item.rate)}
                    </td>
                    {igstRate > 0 ? (
                      <td className="py-2 px-2.5 border-r border-slate-200 text-right font-mono text-slate-700 align-top">
                        {formatIndianNumber(item.igstAmount)}
                      </td>
                    ) : (
                      <>
                        <td className="py-2 px-2 border-r border-slate-200 text-right font-mono text-slate-700 align-top">
                          {formatIndianNumber(item.cgstAmount)}
                        </td>
                        <td className="py-2 px-2 border-r border-slate-200 text-right font-mono text-slate-700 align-top">
                          {formatIndianNumber(item.sgstAmount)}
                        </td>
                      </>
                    )}
                    <td className="py-2 px-3 text-right font-mono font-bold text-slate-950 align-top">
                      {formatIndianNumber(item.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals Section */}
          <div className="grid grid-cols-1 sm:grid-cols-2 border-x border-b border-slate-300">
            {/* Left: Total in words & Notes */}
            <div className="p-3 border-b sm:border-b-0 sm:border-r border-slate-300 space-y-3 flex flex-col justify-between">
              <div>
                <p className="text-[10px] font-bold text-slate-700 uppercase tracking-wide">Total In Words</p>
                <p className="text-xs font-bold text-slate-950 italic mt-0.5 leading-snug">
                  {totalInWords || 'Indian Rupee Zero Only'}
                </p>
              </div>

              {notes && (
                <div className="pt-2 border-t border-slate-200">
                  <p className="text-[10px] font-bold text-slate-700 uppercase tracking-wide">Notes</p>
                  <p className="text-[11px] text-slate-600 italic mt-0.5 whitespace-pre-line">{notes}</p>
                </div>
              )}
            </div>

            {/* Right: Subtotal, Taxes & Grand Total Breakdown */}
            <div className="p-3 text-[11px] space-y-1.5 bg-slate-50/30 print:bg-transparent">
              <div className="flex justify-between items-center text-slate-700">
                <span className="font-semibold">Sub Total</span>
                <span className="font-mono font-bold text-slate-900">{formatIndianNumber(subTotal)}</span>
              </div>

              {igstRate > 0 ? (
                <div className="flex justify-between items-center text-slate-700">
                  <span>IGST ({igstRate}%)</span>
                  <span className="font-mono">{formatIndianNumber(igstAmount)}</span>
                </div>
              ) : (
                <>
                  <div className="flex justify-between items-center text-slate-700">
                    <span>CGST ({cgstRate}%)</span>
                    <span className="font-mono">{formatIndianNumber(cgstAmount)}</span>
                  </div>
                  <div className="flex justify-between items-center text-slate-700">
                    <span>SGST ({sgstRate}%)</span>
                    <span className="font-mono">{formatIndianNumber(sgstAmount)}</span>
                  </div>
                </>
              )}

              <div className="flex justify-between items-center pt-2 border-t border-slate-300 text-sm font-extrabold text-slate-950">
                <span>Total</span>
                <span className="font-mono text-base">₹{formatIndianNumber(grandTotal)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer: Banking Details, Terms, and Authorized Signature */}
        <div className="mt-4 pt-3 border-t border-slate-300 grid grid-cols-1 sm:grid-cols-2 gap-4 items-end break-inside-avoid print:break-inside-avoid">
          {/* Left Column: Banking Details Table & Terms & Conditions */}
          <div className="space-y-3 text-[11px]">
            {/* Banking Details Bordered Box */}
            <div className="space-y-1">
              <p className="font-bold text-slate-800 uppercase tracking-wide text-[10px]">BANKING DETAILS:</p>
              <table className="w-full text-left border border-slate-300 text-[10px] border-collapse bg-slate-50/30">
                <tbody>
                  <tr className="border-b border-slate-300">
                    <td className="p-1.5 font-bold text-slate-700 border-r border-slate-300 w-24">BANK</td>
                    <td className="p-1.5 font-bold text-slate-900">{banking.bankName || '—'}</td>
                  </tr>
                  <tr className="border-b border-slate-300">
                    <td className="p-1.5 font-bold text-slate-700 border-r border-slate-300">IFSC CODE</td>
                    <td className="p-1.5 font-mono font-bold text-slate-900">{banking.bankIfsc || '—'}</td>
                  </tr>
                  <tr className="border-b border-slate-300">
                    <td className="p-1.5 font-bold text-slate-700 border-r border-slate-300">AC NO</td>
                    <td className="p-1.5 font-mono font-bold text-slate-900">{banking.bankAccountNo || '—'}</td>
                  </tr>
                  <tr>
                    <td className="p-1.5 font-bold text-slate-700 border-r border-slate-300">BRANCH</td>
                    <td className="p-1.5 font-semibold text-slate-900">{banking.bankBranch || '—'}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Terms & Conditions */}
            {termsList.length > 0 && (
              <div className="space-y-0.5 text-[10px] text-slate-600">
                <p className="font-bold text-slate-800 uppercase tracking-wide">Terms & Conditions</p>
                <div className="space-y-0.5 pt-0.5">
                  {termsList.map((t, idx) => (
                    <p key={idx} className="leading-snug">
                      {t}
                    </p>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right Column: Authorized Signatory Stamp & Signature */}
          <div className="flex flex-col items-center sm:items-end justify-end">
            <div className="w-48 flex flex-col items-center text-center">
              {/* Company Name */}
              <p className="font-extrabold text-xs text-slate-950 uppercase tracking-wider w-full text-center">
                {company.name || 'Company Name'}
              </p>

              {/* Blank vertical space for physical signature or seal (or digital signature image) */}
              {resolvedSignatureImage && !sigLoadFailed ? (
                <div className="h-16 w-full flex items-center justify-center p-1 my-1">
                  <img
                    src={resolvedSignatureImage}
                    alt="Authorized Signature"
                    className="max-h-full max-w-full object-contain"
                    onError={() => setSigLoadFailed(true)}
                    crossOrigin="anonymous"
                  />
                </div>
              ) : (
                <div className="h-16 w-full" />
              )}

              {/* Signature Line & Authorized Signatory Label */}
              <div className="w-full border-t border-slate-400 pt-1 text-center">
                <p className="text-[11px] font-bold text-slate-800 tracking-wide">
                  {signatoryTitle === 'Authorized Signature' ? 'Authorized Signatory' : (signatoryTitle || 'Authorized Signatory')}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Page Footer */}
        <div className="text-right text-[9px] text-slate-400 pt-3 border-t border-slate-200 mt-2 break-inside-avoid print:break-inside-avoid">
          Page 1
        </div>
      </div>
    </div>
  );
};

export default EstimateDocumentPreview;
