import React, { useState, useEffect, useCallback, useRef } from 'react';
import api from '../services/api';
import {
  BarChart3,
  Download,
  Calendar,
  X,
  FileSpreadsheet,
  AlertCircle
} from 'lucide-react';

import { useAuth } from '../context/AuthContext';
import CompanyScopeSelector from '../components/common/CompanyScopeSelector';
import { useCompanyScope } from '../context/CompanyScopeContext';

const Reports = () => {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const { selectedOrgId, effectiveOrgId, loading: orgsLoading, selectedCompany } = useCompanyScope();
  const targetOrg = isSuperAdmin ? selectedOrgId : (effectiveOrgId || user?.organizationId);
  const selectedOrgIdRef = useRef(targetOrg);

  const [reportType, setReportType] = useState('attendance');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');

  const [previewData, setPreviewData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [alertMsg, setAlertMsg] = useState('');

  const fetchReport = useCallback(async (type = reportType, start = startDate, end = endDate) => {
    setLoading(true);
    setAlertMsg('');
    setPreviewData([]);

    try {
      const activeOrg = selectedOrgIdRef.current || targetOrg;
      const params = {};
      if (activeOrg) params.organizationId = activeOrg;
      if (start) params.startDate = start;
      if (end) params.endDate = end;
      if (statusFilter) params.status = statusFilter;
      if (priorityFilter) params.priority = priorityFilter;

      let endpoint = '/reports/attendance';
      if (type === 'tasks') endpoint = '/reports/tasks';
      if (type === 'projects') endpoint = '/reports/projects';
      if (type === 'performance') endpoint = '/reports/performance';

      const res = await api.get(endpoint, { params });
      setPreviewData(Array.isArray(res.data) ? res.data : (res.data?.data || []));
      setLoading(false);
    } catch (err) {
      console.error(err);
      setAlertMsg('Failed to generate report data.');
      setLoading(false);
    }
  }, [reportType, startDate, endDate, statusFilter, priorityFilter, targetOrg]);

  // Auto-fetch data when company scope or report category changes
  useEffect(() => {
    selectedOrgIdRef.current = targetOrg;
    setPreviewData([]);
    if (orgsLoading) return;
    fetchReport(reportType, startDate, endDate);
  }, [user, targetOrg, user?.organizationId, reportType, orgsLoading]);

  const handleGenerateReport = (e) => {
    e.preventDefault();
    fetchReport(reportType, startDate, endDate);
  };

  const handleDownloadCsv = () => {
    if (previewData.length === 0) return;

    const targetOrg = selectedOrgIdRef.current || selectedOrgId;
    const companyName = selectedCompany?.name || 'Company';
    const cleanCompanyName = companyName.replace(/[^a-zA-Z0-9]/g, '_');

    api.get(`/reports/${reportType}`, {
      params: {
        format: 'csv',
        ...(targetOrg ? { organizationId: targetOrg } : {}),
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : {}),
        ...(statusFilter ? { status: statusFilter } : {}),
        ...(priorityFilter ? { priority: priorityFilter } : {})
      },
      responseType: 'blob'
    })
      .then(res => {
        const url = window.URL.createObjectURL(new Blob([res.data]));
        const a = document.createElement('a');
        a.setAttribute('href', url);
        a.setAttribute('download', `${cleanCompanyName}_${reportType}_report.csv`);
        a.click();
        window.URL.revokeObjectURL(url);
      })
      .catch(() => setAlertMsg('Failed to initiate CSV download.'));
  };

  const getHeaders = () => {
    if (previewData.length === 0) return [];
    return Object.keys(previewData[0]);
  };

  return (
    <div className="flex-1 flex flex-col space-y-6 text-left animate-in fade-in duration-300">
      {/* Company Scope Selector */}
      <CompanyScopeSelector />

      {alertMsg && (
        <div className="flex items-center justify-between p-4 rounded-xl border border-primary/20 bg-primary/5 text-primary text-xs font-semibold">
          <span>{alertMsg}</span>
          <button onClick={() => setAlertMsg('')}>✕</button>
        </div>
      )}

      {/* Control Configuration panel */}
      <div className="rounded-2xl border border-border/40 bg-card p-6 shadow-premium text-left">
        <div className="flex items-center gap-3 border-b border-border/30 pb-3 mb-6">
          <BarChart3 className="h-5 w-5 text-primary animate-pulse" />
          <h2 className="text-sm font-bold uppercase tracking-tight">
            Configure Reports Export ({selectedCompany?.name || 'Selected Scope'})
          </h2>
        </div>

        <form onSubmit={handleGenerateReport} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
          <div className="flex flex-col gap-1.5 text-left">
            <label className="text-xs font-semibold text-muted-foreground">Report Category</label>
            <select value={reportType} onChange={(e) => setReportType(e.target.value)} className="bg-muted/50 border border-border rounded-xl p-2.5 text-xs text-foreground font-semibold">
              <option value="attendance">Attendance Reports</option>
              <option value="tasks">Task Allocation Logs</option>
              <option value="projects">Projects Portfolio Report</option>
              <option value="teams">Team Performance Audits</option>
              <option value="tickets">Support Tickets Summaries</option>
              <option value="leaves">Leave Applications Report</option>
              <option value="payroll">Payroll Expense Report</option>
              <option value="assets">Asset Allocation Report</option>
              <option value="worklogs">Daily Work Logs Report</option>
            </select>
          </div>

          <div className="flex flex-col gap-1.5 text-left">
            <label className="text-xs font-semibold text-muted-foreground">Start Date</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="bg-muted/50 border border-border rounded-xl p-2.5 text-xs text-foreground font-semibold" />
          </div>

          <div className="flex flex-col gap-1.5 text-left">
            <label className="text-xs font-semibold text-muted-foreground">End Date</label>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="bg-muted/50 border border-border rounded-xl p-2.5 text-xs text-foreground font-semibold" />
          </div>

          <div className="flex gap-2">
            <button type="submit" disabled={loading} className="flex-1 rounded-xl bg-primary py-2.5 text-xs font-semibold text-primary-foreground shadow-md hover:bg-primary-hover active:scale-95 disabled:opacity-50">
              Query Preview
            </button>
            
            {previewData.length > 0 && (
              <button 
                type="button" 
                onClick={handleDownloadCsv} 
                className="rounded-xl border border-primary/20 bg-primary/5 py-2.5 px-3 text-xs font-semibold text-primary hover:bg-primary/10 transition-all"
                title="Download CSV File"
              >
                <Download className="h-4.5 w-4.5" />
              </button>
            )}
          </div>
        </form>
      </div>

      {/* Grid preview data table */}
      {loading ? (
        <div className="skeleton h-60 w-full" />
      ) : previewData.length > 0 ? (
        <div className="rounded-2xl border border-border/40 bg-card p-6 shadow-premium text-left space-y-4">
          <div className="flex items-center justify-between border-b border-border/30 pb-2">
            <h3 className="text-xs font-bold uppercase tracking-tight text-foreground/80">
              Report Data Preview ({previewData.length} records found in {selectedCompany?.name || 'company'})
            </h3>
            <button onClick={handleDownloadCsv} className="flex items-center gap-1.5 text-xs font-bold text-primary hover:underline">
              <Download className="h-4 w-4" />
              <span>Download CSV File</span>
            </button>
          </div>

          <div className="w-full min-w-0 overflow-x-auto max-h-96 rounded-xl border">
            <table className="w-full min-w-[700px] text-xs text-left border-collapse">
              <thead>
                <tr className="bg-muted/30 border-b font-bold uppercase text-muted-foreground whitespace-nowrap">
                  {getHeaders().map((header, idx) => (
                    <th key={idx} className="px-4 py-3 whitespace-nowrap">{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {previewData.map((row, idx) => (
                  <tr key={idx} className="hover:bg-muted/10 whitespace-nowrap">
                    {getHeaders().map((col, colIdx) => (
                      <td key={colIdx} className="px-4 py-3 whitespace-nowrap max-w-[200px] truncate" title={row[col] === null || row[col] === undefined ? 'N/A' : row[col].toString()}>
                        {row[col] === null || row[col] === undefined ? 'N/A' : row[col].toString()}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-border/40 bg-card p-12 text-center text-muted-foreground font-semibold text-xs">
          No report data found for {selectedCompany?.name || 'this company'}.
        </div>
      )}
    </div>
  );
};

export default Reports;
