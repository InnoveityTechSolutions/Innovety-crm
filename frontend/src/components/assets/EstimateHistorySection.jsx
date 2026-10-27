import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Search,
  Calendar,
  Filter,
  Eye,
  Printer,
  Ban,
  RotateCcw,
  RefreshCw,
  FileText,
  AlertCircle,
  CheckCircle,
  X,
  Layers,
  ArrowUpDown
} from 'lucide-react';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import ViewEstimateModal from './ViewEstimateModal';
import CancelEstimateModal from './CancelEstimateModal';

const EstimateHistorySection = ({ organizationId }) => {
  const { user } = useAuth();
  const isAdminOrSuperAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(user?.role);

  const [estimates, setEstimates] = useState([]);
  const [meta, setMeta] = useState({ page: 1, limit: 15, totalCount: 0, totalPages: 1 });
  const [loading, setLoading] = useState(false);
  const [alertMsg, setAlertMsg] = useState({ type: '', text: '' });

  // Filters state
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState('desc');

  // Modals state
  const [viewEstimateId, setViewEstimateId] = useState(null);
  const [cancelEstimateTarget, setCancelEstimateTarget] = useState(null);

  // Debounce search input (300ms)
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(handler);
  }, [search]);

  // Fetch estimates
  const fetchEstimates = useCallback(async () => {
    try {
      setLoading(true);
      const params = {
        page,
        limit: 15,
        status: statusFilter,
        sortBy,
        sortOrder
      };

      if (organizationId) params.organizationId = organizationId;
      if (debouncedSearch.trim()) params.search = debouncedSearch.trim();
      if (fromDate) params.fromDate = fromDate;
      if (toDate) params.toDate = toDate;

      const res = await api.get('/assets/estimates', { params });
      if (res.data) {
        setEstimates(res.data.estimates || []);
        setMeta(res.data.meta || { page: 1, limit: 15, totalCount: 0, totalPages: 1 });
      }
    } catch (err) {
      console.error('Failed to fetch estimate history:', err);
      setAlertMsg({
        type: 'error',
        text: err.response?.data?.message || 'Failed to load estimate history.'
      });
    } finally {
      setLoading(false);
    }
  }, [organizationId, page, debouncedSearch, statusFilter, fromDate, toDate, sortBy, sortOrder]);

  useEffect(() => {
    fetchEstimates();
  }, [fetchEstimates]);

  const handleResetFilters = () => {
    setSearch('');
    setDebouncedSearch('');
    setStatusFilter('ALL');
    setFromDate('');
    setToDate('');
    setSortBy('createdAt');
    setSortOrder('desc');
    setPage(1);
  };

  const handleEstimateCancelled = (updatedEstimate) => {
    setAlertMsg({
      type: 'success',
      text: `Estimate ${updatedEstimate.estimateNumber} cancelled successfully.`
    });
    fetchEstimates();
  };

  const hasActiveFilters = Boolean(
    search.trim() || statusFilter !== 'ALL' || fromDate || toDate
  );

  return (
    <div className="space-y-4">
      {/* Alert Header Banner */}
      {alertMsg.text && (
        <div
          className={`flex items-center gap-2 p-4 rounded-2xl border text-xs font-semibold ${
            alertMsg.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400'
              : 'bg-rose-500/10 border-rose-500/20 text-rose-500'
          }`}
        >
          {alertMsg.type === 'success' ? <CheckCircle className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
          <span>{alertMsg.text}</span>
          <button className="ml-auto" onClick={() => setAlertMsg({ type: '', text: '' })}>
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Control & Search Bar */}
      <div className="bg-card p-4 rounded-2xl border border-border/60 shadow-md flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        {/* Search Input */}
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3.5 top-3 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by estimate number, customer, or reference..."
            className="w-full pl-10 pr-4 py-2 bg-background text-xs rounded-xl border border-border/70 focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all text-foreground placeholder:text-muted-foreground"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Filter Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            className="bg-background text-xs px-3 py-2 rounded-xl border border-border/70 font-semibold text-foreground focus:border-primary"
          >
            <option value="ALL">All Statuses</option>
            <option value="GENERATED">Active / Final</option>
            <option value="CANCELLED">Cancelled</option>
          </select>

          {/* Date Range: From */}
          <div className="flex items-center gap-1 bg-background border border-border/70 rounded-xl px-2.5 py-1 text-xs">
            <span className="text-[10px] uppercase font-bold text-muted-foreground">From</span>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => {
                setFromDate(e.target.value);
                setPage(1);
              }}
              className="bg-transparent text-xs text-foreground font-semibold focus:outline-none"
            />
          </div>

          {/* Date Range: To */}
          <div className="flex items-center gap-1 bg-background border border-border/70 rounded-xl px-2.5 py-1 text-xs">
            <span className="text-[10px] uppercase font-bold text-muted-foreground">To</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => {
                setToDate(e.target.value);
                setPage(1);
              }}
              className="bg-transparent text-xs text-foreground font-semibold focus:outline-none"
            />
          </div>

          {/* Reset Filters */}
          {hasActiveFilters && (
            <button
              onClick={handleResetFilters}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border/70 bg-background hover:bg-muted text-xs font-semibold text-muted-foreground hover:text-foreground transition-all cursor-pointer"
              title="Reset all filters"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Reset</span>
            </button>
          )}

          {/* Refresh Button */}
          <button
            onClick={() => fetchEstimates()}
            className="p-2 rounded-xl border border-border/70 bg-background hover:bg-muted text-muted-foreground hover:text-foreground transition-all cursor-pointer"
            title="Refresh history"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin text-primary' : ''}`} />
          </button>
        </div>
      </div>

      {/* History Table */}
      <div className="w-full min-w-0 overflow-x-auto bg-card border border-border/60 shadow-md rounded-2xl">
        <table className="w-full min-w-[900px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-border/40 bg-muted/40 text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
              <th className="px-6 py-4 whitespace-nowrap">Estimate No</th>
              <th className="px-6 py-4 whitespace-nowrap">Date</th>
              <th className="px-6 py-4 whitespace-nowrap">Bill To / Customer</th>
              <th className="px-6 py-4 whitespace-nowrap">Reference</th>
              <th className="px-6 py-4 whitespace-nowrap text-center">Items</th>
              <th className="px-6 py-4 whitespace-nowrap text-right">Total Amount</th>
              <th className="px-6 py-4 whitespace-nowrap">Created By</th>
              <th className="px-6 py-4 whitespace-nowrap text-center">Status</th>
              <th className="px-6 py-4 text-right whitespace-nowrap">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/30">
            {loading && estimates.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-6 py-16 text-center text-muted-foreground">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <RefreshCw className="h-6 w-6 animate-spin text-primary" />
                    <p className="text-xs font-semibold">Loading estimate history records...</p>
                  </div>
                </td>
              </tr>
            ) : estimates.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-6 py-16 text-center whitespace-nowrap">
                  <div className="mx-auto flex max-w-sm flex-col items-center justify-center text-center">
                    <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary mb-4 shadow-sm border border-primary/20">
                      <FileText className="h-8 w-8" />
                    </div>
                    <h3 className="text-base font-bold text-foreground">
                      {hasActiveFilters ? 'No Matching Estimates' : 'No Estimates Generated Yet'}
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {hasActiveFilters
                        ? 'No historical estimates match your search or filter criteria. Try adjusting filters.'
                        : 'Generate an estimate by selecting one or more items from the Hardware Inventory tab.'}
                    </p>
                    {hasActiveFilters && (
                      <button
                        onClick={handleResetFilters}
                        className="mt-4 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-bold shadow-md hover:bg-primary-hover transition-all cursor-pointer"
                      >
                        Clear Filters
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ) : (
              estimates.map((item) => (
                <tr
                  key={item.id}
                  className="hover:bg-muted/40 cursor-pointer transition-all h-16 whitespace-nowrap"
                  onClick={() => setViewEstimateId(item.id)}
                >
                  {/* Estimate Number */}
                  <td className="px-6 py-4 font-mono font-bold text-xs text-primary whitespace-nowrap">
                    {item.estimateNumber}
                  </td>

                  {/* Date */}
                  <td className="px-6 py-4 text-xs font-medium text-foreground whitespace-nowrap">
                    {item.estimateDate ? new Date(item.estimateDate).toLocaleDateString('en-GB') : '—'}
                  </td>

                  {/* Customer / Bill To */}
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div>
                      <p className="text-xs font-bold text-foreground leading-tight">{item.billToName}</p>
                      {(item.billToCity || item.billToState) && (
                        <span className="text-[10px] text-muted-foreground mt-0.5 block">
                          {[item.billToCity, item.billToState].filter(Boolean).join(', ')}
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Reference */}
                  <td className="px-6 py-4 font-mono text-xs text-muted-foreground whitespace-nowrap">
                    {item.reference || '—'}
                  </td>

                  {/* Items Count */}
                  <td className="px-6 py-4 text-center whitespace-nowrap">
                    <span className="text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-extrabold px-2.5 py-1 rounded-full border border-slate-200 dark:border-slate-700">
                      {item.itemCount || 1} {item.itemCount === 1 ? 'item' : 'items'}
                    </span>
                  </td>

                  {/* Total Amount */}
                  <td className="px-6 py-4 text-right font-bold text-xs text-foreground whitespace-nowrap">
                    ₹{Number(item.grandTotal).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </td>

                  {/* Created By */}
                  <td className="px-6 py-4 whitespace-nowrap">
                    {item.createdBy ? (
                      <div>
                        <p className="text-xs font-bold text-foreground leading-none">{item.createdBy.name}</p>
                        <span className="text-[9px] text-muted-foreground font-mono">{item.createdBy.employeeId}</span>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>

                  {/* Status */}
                  <td className="px-6 py-4 text-center whitespace-nowrap">
                    <span
                      className={`text-[10px] font-extrabold px-2.5 py-1 rounded-full border uppercase ${
                        item.status === 'CANCELLED'
                          ? 'bg-rose-500/10 text-rose-600 border-rose-500/20'
                          : 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
                      }`}
                    >
                      {item.status}
                    </span>
                  </td>

                  {/* Actions */}
                  <td className="px-6 py-4 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1.5">
                      {/* View */}
                      <button
                        onClick={() => setViewEstimateId(item.id)}
                        className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-all cursor-pointer"
                        title="View Estimate Preview"
                      >
                        <Eye size={15} />
                      </button>

                      {/* Print / Save PDF */}
                      <button
                        onClick={() => setViewEstimateId(item.id)}
                        className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-all cursor-pointer"
                        title="Print / Save PDF"
                      >
                        <Printer size={15} />
                      </button>

                      {/* Cancel / Void (Only for active estimates and Admin/Super Admin) */}
                      {isAdminOrSuperAdmin && item.status === 'GENERATED' && (
                        <button
                          onClick={() => setCancelEstimateTarget(item)}
                          className="p-1.5 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-500 hover:text-rose-600 transition-all cursor-pointer"
                          title="Cancel / Void Estimate"
                        >
                          <Ban size={15} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      {meta.totalCount > meta.limit && (
        <div className="flex items-center justify-between px-2 pt-1 text-xs">
          <p className="text-muted-foreground font-semibold">
            Showing <span className="font-bold text-foreground">{(meta.page - 1) * meta.limit + 1}</span> to{' '}
            <span className="font-bold text-foreground">{Math.min(meta.page * meta.limit, meta.totalCount)}</span> of{' '}
            <span className="font-bold text-foreground">{meta.totalCount}</span> estimates
          </p>
          <div className="flex items-center gap-2">
            <button
              disabled={meta.page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="px-3 py-1.5 text-xs font-bold rounded-xl border border-border bg-card hover:bg-muted disabled:opacity-50 transition-all cursor-pointer"
            >
              Previous
            </button>
            <span className="text-xs font-bold text-foreground px-2">
              Page {meta.page} of {meta.totalPages}
            </span>
            <button
              disabled={meta.page >= meta.totalPages || loading}
              onClick={() => setPage((p) => p + 1)}
              className="px-3 py-1.5 text-xs font-bold rounded-xl border border-border bg-card hover:bg-muted disabled:opacity-50 transition-all cursor-pointer"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* View Estimate Modal */}
      {viewEstimateId && (
        <ViewEstimateModal
          isOpen={Boolean(viewEstimateId)}
          estimateId={viewEstimateId}
          onClose={() => setViewEstimateId(null)}
        />
      )}

      {/* Cancel Estimate Modal */}
      {cancelEstimateTarget && (
        <CancelEstimateModal
          isOpen={Boolean(cancelEstimateTarget)}
          estimate={cancelEstimateTarget}
          onClose={() => setCancelEstimateTarget(null)}
          onEstimateCancelled={handleEstimateCancelled}
        />
      )}
    </div>
  );
};

export default EstimateHistorySection;
