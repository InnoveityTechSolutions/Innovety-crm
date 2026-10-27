import React, { useState, useEffect, useRef, useMemo } from 'react';
import api from '../../services/api';
import {
  FileCode, Search, Eye, Download, Printer, ShieldCheck, X, QrCode,
  Users, DollarSign, FileSpreadsheet, Filter, CheckCircle, Calendar,
  Loader2, AlertCircle
} from 'lucide-react';
import CompanyScopeSelector from '../../components/common/CompanyScopeSelector';
import { useCompanyScope } from '../../context/CompanyScopeContext';
import { useAuth } from '../../context/AuthContext';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];
const YEARS = [2027, 2026, 2025, 2024];

export default function PayslipsPage() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const { selectedOrgId, effectiveOrgId, loading: orgsLoading, selectedCompany } = useCompanyScope();
  const targetOrg = isSuperAdmin ? selectedOrgId : (effectiveOrgId || user?.organizationId);
  const selectedOrgIdRef = useRef(targetOrg);

  const [payslips, setPayslips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('ALL');
  const [memberFilter, setMemberFilter] = useState('ALL');
  const [selectedMonth, setSelectedMonth] = useState('');
  const [selectedYear, setSelectedYear] = useState('');
  const [selectedPayslip, setSelectedPayslip] = useState(null);
  const [settings, setSettings] = useState(null);
  const [showModal, setShowModal] = useState(false);

  // Export CSV Modal & Options
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportMonth, setExportMonth] = useState(String(new Date().getMonth() + 1));
  const [exportYear, setExportYear] = useState(String(new Date().getFullYear()));
  const [exportLoading, setExportLoading] = useState(false);
  const [exportError, setExportError] = useState('');

  const fetchPayslips = async () => {
    try {
      setLoading(true);
      const activeOrg = selectedOrgIdRef.current || targetOrg;
      const params = activeOrg ? { organizationId: activeOrg } : {};
      if (selectedMonth) params.month = selectedMonth;
      if (selectedYear) params.year = selectedYear;
      const res = await api.get('/payroll/payslips', { params });
      setPayslips(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error('Failed to fetch payslips:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    selectedOrgIdRef.current = targetOrg;
    setPayslips([]);
    setMemberFilter('ALL');
    if (orgsLoading) return;
    fetchPayslips();
  }, [user, targetOrg, user?.organizationId, orgsLoading, selectedMonth, selectedYear]);

  const handleViewPayslip = async (id) => {
    try {
      const activeOrg = selectedOrgIdRef.current || selectedOrgId;
      const params = activeOrg ? { organizationId: activeOrg } : {};
      const res = await api.get(`/payroll/payslips/${id}`, { params });
      setSelectedPayslip(res.data.payslip);
      setSettings(res.data.settings);
      setShowModal(true);
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to view payslip.');
    }
  };

  const formatINR = (val) => `₹${Number(val || 0).toLocaleString('en-IN')}`;

  // Unique departments from loaded payslips
  const departmentsList = useMemo(() => {
    const depts = new Set();
    payslips.forEach(ps => {
      const d = ps.user?.department;
      if (d) depts.add(d);
    });
    return ['ALL', ...Array.from(depts)];
  }, [payslips]);

  // Unique members from loaded payslips, scoped to selected department if active
  const membersList = useMemo(() => {
    const memberMap = new Map();
    payslips.forEach(ps => {
      if (ps.user && ps.user.id) {
        if (departmentFilter === 'ALL' || (ps.user.department || 'General') === departmentFilter) {
          if (!memberMap.has(ps.user.id)) {
            memberMap.set(ps.user.id, {
              id: ps.user.id,
              name: ps.user.name || 'Unknown',
              employeeId: ps.user.employeeId || ('EMP-' + ps.user.id.substring(0, 6)),
              email: ps.user.email || '',
              department: ps.user.department || 'General'
            });
          }
        }
      }
    });
    return Array.from(memberMap.values()).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [payslips, departmentFilter]);

  // Reset member filter if the selected member is not in the active department list
  useEffect(() => {
    if (memberFilter !== 'ALL') {
      const exists = membersList.some(m => m.id === memberFilter);
      if (!exists) {
        setMemberFilter('ALL');
      }
    }
  }, [departmentFilter, membersList, memberFilter]);

  // Filtered payslips by search query, department, and member
  const filteredPayslips = useMemo(() => {
    return payslips.filter(ps => {
      const name = ps.user?.name?.toLowerCase() || '';
      const email = ps.user?.email?.toLowerCase() || '';
      const empId = (ps.user?.employeeId || '').toLowerCase();
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch = !q || name.includes(q) || email.includes(q) || empId.includes(q);

      const dept = ps.user?.department || 'General';
      const matchesDept = departmentFilter === 'ALL' || dept === departmentFilter;

      const matchesMember = memberFilter === 'ALL' || ps.user?.id === memberFilter;

      return matchesSearch && matchesDept && matchesMember;
    });
  }, [payslips, searchQuery, departmentFilter, memberFilter]);

  // Summary Metrics of currently displayed records
  const deskMetrics = useMemo(() => {
    const totalCount = filteredPayslips.length;
    const totalGross = filteredPayslips.reduce((sum, p) => sum + (p.grossSalary || 0), 0);
    const totalNet = filteredPayslips.reduce((sum, p) => sum + (p.netSalary || 0), 0);
    const totalDeductions = totalGross - totalNet;
    return { totalCount, totalGross, totalNet, totalDeductions };
  }, [filteredPayslips]);

  const periodLabel = (selectedMonth && selectedYear)
    ? `${MONTHS[Number(selectedMonth) - 1]} ${selectedYear}`
    : selectedMonth
      ? `${MONTHS[Number(selectedMonth) - 1]} (All Years)`
      : selectedYear
        ? `Year ${selectedYear}`
        : 'All Periods';

  // Core CSV Export Generation Helper
  const generateCSV = (records, filenameSuffix = '') => {
    if (!records || records.length === 0) return false;
    const companyName = selectedCompany?.name || 'Company';
    const cleanFileName = companyName.replace(/[^a-zA-Z0-9]/g, '_');
    const headers = [
      'Member Name',
      'Employee ID',
      'Email',
      'Department',
      'Pay Period',
      'Basic Salary (INR)',
      'Gross Salary (INR)',
      'Total Deductions (INR)',
      'Net Payout (INR)',
      'Status'
    ];
    const rows = records.map(ps => [
      `"${(ps.user?.name || '').replace(/"/g, '""')}"`,
      `"${(ps.user?.employeeId || 'EMP-' + ps.user?.id?.substring(0, 6)).replace(/"/g, '""')}"`,
      `"${(ps.user?.email || '').replace(/"/g, '""')}"`,
      `"${(ps.user?.department || 'General').replace(/"/g, '""')}"`,
      `"Month ${ps.month}/${ps.year}"`,
      ps.basicSalary || 0,
      ps.grossSalary || 0,
      (ps.grossSalary || 0) - (ps.netSalary || 0),
      ps.netSalary || 0,
      `"${ps.status || 'PUBLISHED'}"`
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `${cleanFileName}_Payslips_${filenameSuffix}_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    return true;
  };

  // Export Current Filtered Results Handler
  const handleExportFiltered = () => {
    if (filteredPayslips.length === 0) {
      setExportError('No payslip records available to export with current filters.');
      return;
    }
    const success = generateCSV(filteredPayslips, `Filtered_${periodLabel.replace(/[^a-zA-Z0-9]/g, '_')}`);
    if (success) {
      setShowExportModal(false);
      setExportError('');
    }
  };

  // Export by Specific Pay Period Handler
  const handleExportByPeriod = async () => {
    try {
      setExportLoading(true);
      setExportError('');
      const activeOrg = selectedOrgIdRef.current || targetOrg;
      const params = activeOrg ? { organizationId: activeOrg } : {};
      if (exportMonth) params.month = exportMonth;
      if (exportYear) params.year = exportYear;

      const res = await api.get('/payroll/payslips', { params });
      const records = Array.isArray(res.data) ? res.data : [];

      if (records.length === 0) {
        const monthName = MONTHS[Number(exportMonth) - 1] || `Month ${exportMonth}`;
        setExportError(`No payslips found for ${monthName} ${exportYear}.`);
        return;
      }

      const periodStr = `${MONTHS[Number(exportMonth) - 1] || exportMonth}_${exportYear}`;
      generateCSV(records, `Period_${periodStr}`);
      setShowExportModal(false);
      setExportError('');
    } catch (err) {
      console.error('Failed to export period payslips:', err);
      setExportError(err.response?.data?.message || 'Failed to export payslips for the selected period.');
    } finally {
      setExportLoading(false);
    }
  };

  return (
    <div className="space-y-6 text-left font-sans w-full max-w-7xl mx-auto">
      {/* Company Scope Selector */}
      <CompanyScopeSelector />

      {/* Header Area: Title, Description, and Period Scope Badge */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-card border border-border p-6 rounded-2xl shadow-sm">
        <div>
          <h1 className="text-2xl font-black text-foreground flex items-center gap-2">
            <FileCode className="w-6 h-6 text-primary shrink-0" />
            <span>Payslips Management Desk</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Authoritative employee-wise monthly payroll ledger. Search, audit, download, and print official payslips.
          </p>
        </div>
        <div className="shrink-0">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold bg-primary/10 text-primary border border-primary/20 shadow-xs">
            <span>Period Scope: {periodLabel}</span>
          </div>
        </div>
      </div>

      {/* Summary Metrics Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-4 rounded-xl border border-border/60 bg-card text-left shadow-sm">
          <span className="text-[10px] font-extrabold uppercase text-muted-foreground block">Payslips Displayed</span>
          <span className="text-xl font-black text-foreground mt-1 block">{loading ? '...' : deskMetrics.totalCount}</span>
          <p className="text-[11px] text-muted-foreground mt-0.5">{periodLabel}</p>
        </div>

        <div className="p-4 rounded-xl border border-border/60 bg-card text-left shadow-sm">
          <span className="text-[10px] font-extrabold uppercase text-muted-foreground block">Cumulative Gross</span>
          <span className="text-xl font-black text-foreground mt-1 block">{loading ? '...' : formatINR(deskMetrics.totalGross)}</span>
          <p className="text-[11px] text-muted-foreground mt-0.5">Base + Allowances</p>
        </div>

        <div className="p-4 rounded-xl border border-border/60 bg-card text-left shadow-sm">
          <span className="text-[10px] font-extrabold uppercase text-muted-foreground block">Total Deductions</span>
          <span className="text-xl font-black text-destructive mt-1 block">{loading ? '...' : `-${formatINR(deskMetrics.totalDeductions)}`}</span>
          <p className="text-[11px] text-muted-foreground mt-0.5">Taxes, PF, ESI & Lates</p>
        </div>

        <div className="p-4 rounded-xl border border-primary/30 bg-primary/5 text-left shadow-sm">
          <span className="text-[10px] font-extrabold uppercase text-primary block">Net Disbursement Total</span>
          <span className="text-xl font-black text-primary mt-1 block">{loading ? '...' : formatINR(deskMetrics.totalNet)}</span>
          <p className="text-[11px] text-muted-foreground mt-0.5">Direct Payouts</p>
        </div>
      </div>

      {/* Dedicated Filter & Export Toolbar Directly Above Payslip Table */}
      <div className="bg-card border border-border p-4 rounded-2xl shadow-sm">
        <div className="flex flex-wrap xl:flex-nowrap items-center gap-3 w-full">
          {/* Month Selector */}
          <select
            value={selectedMonth}
            onChange={e => setSelectedMonth(e.target.value)}
            className="h-10 bg-muted/50 border border-border rounded-xl px-3 py-2 text-xs font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer min-w-[115px] flex-1 sm:flex-initial transition-colors"
            aria-label="Filter by Month"
          >
            <option value="">All Months</option>
            {MONTHS.map((m, idx) => (
              <option key={idx + 1} value={idx + 1}>{m}</option>
            ))}
          </select>

          {/* Year Selector */}
          <select
            value={selectedYear}
            onChange={e => setSelectedYear(e.target.value)}
            className="h-10 bg-muted/50 border border-border rounded-xl px-3 py-2 text-xs font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer min-w-[95px] flex-1 sm:flex-initial transition-colors"
            aria-label="Filter by Year"
          >
            <option value="">All Years</option>
            {YEARS.map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>

          {/* Department Filter */}
          <select
            value={departmentFilter}
            onChange={e => setDepartmentFilter(e.target.value)}
            className="h-10 bg-muted/50 border border-border rounded-xl px-3 py-2 text-xs font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer min-w-[130px] max-w-full sm:max-w-[160px] truncate flex-1 sm:flex-initial transition-colors"
            aria-label="Filter by Department"
          >
            {departmentsList.map(d => (
              <option key={d} value={d}>{d === 'ALL' ? 'All Departments' : d}</option>
            ))}
          </select>

          {/* Member Filter */}
          <select
            value={memberFilter}
            onChange={e => setMemberFilter(e.target.value)}
            className="h-10 bg-muted/50 border border-border rounded-xl px-3 py-2 text-xs font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer min-w-[140px] max-w-full sm:max-w-[190px] truncate flex-1 sm:flex-initial transition-colors"
            aria-label="Filter by Member"
          >
            <option value="ALL">All Members</option>
            {membersList.map(m => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.employeeId})
              </option>
            ))}
          </select>

          {/* Search Input */}
          <div className="relative flex-1 min-w-[180px] w-full sm:w-auto">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              placeholder="Search member name or ID..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="h-10 w-full bg-muted/50 border border-border rounded-xl pl-9 pr-4 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 transition-colors"
            />
          </div>

          {/* Export CSV Button */}
          <button
            onClick={() => {
              setExportError('');
              setShowExportModal(true);
            }}
            className="h-10 inline-flex items-center justify-center gap-2 px-4 py-2 btn-primary rounded-xl font-bold text-xs shadow-md transition-all cursor-pointer shrink-0 w-full sm:w-auto"
            title="Export Payslips CSV"
          >
            <FileSpreadsheet className="w-4 h-4 shrink-0" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* Payslip Records Table */}
      {loading ? (
        <div className="bg-card border border-border rounded-2xl p-12 text-center text-muted-foreground">
          <p className="text-sm font-semibold animate-pulse">Loading employee payslips...</p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/50 border-b border-border text-muted-foreground font-bold uppercase">
                <tr>
                  <th className="p-4">MEMBERS</th>
                  <th className="p-4">Department</th>
                  <th className="p-4">Pay Period</th>
                  <th className="p-4">Basic Salary</th>
                  <th className="p-4">Gross Earnings</th>
                  <th className="p-4">Total Deductions</th>
                  <th className="p-4">Net Payout</th>
                  <th className="p-4">Status</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {filteredPayslips.length === 0 ? (
                  <tr>
                    <td colSpan="9" className="p-8 text-center text-muted-foreground font-semibold">
                      No payslips found matching the selected period and filters for {selectedCompany?.name || 'this company'}.
                    </td>
                  </tr>
                ) : (
                  filteredPayslips.map(ps => {
                    const deductions = (ps.grossSalary || 0) - (ps.netSalary || 0);

                    return (
                      <tr key={ps.id} className="hover:bg-muted/30 transition-colors">
                        <td className="p-4">
                          <p className="font-bold text-foreground whitespace-nowrap">{ps.user?.name}</p>
                          <p className="text-[11px] text-muted-foreground whitespace-nowrap">
                            {ps.user?.employeeId || 'EMP-' + ps.user?.id?.substring(0, 6)} • {ps.user?.email}
                          </p>
                        </td>
                        <td className="p-4 font-semibold text-foreground whitespace-nowrap">
                          <span className="px-2.5 py-0.5 rounded-md bg-muted text-muted-foreground font-bold text-[11px]">
                            {ps.user?.department || 'General'}
                          </span>
                        </td>
                        <td className="p-4 font-semibold text-foreground whitespace-nowrap">
                          Month {ps.month} / {ps.year}
                        </td>
                        <td className="p-4 text-muted-foreground whitespace-nowrap">{formatINR(ps.basicSalary)}</td>
                        <td className="p-4 font-semibold text-foreground whitespace-nowrap">{formatINR(ps.grossSalary)}</td>
                        <td className="p-4 text-destructive font-semibold whitespace-nowrap">
                          {deductions > 0 ? `-${formatINR(deductions)}` : '₹0'}
                        </td>
                        <td className="p-4 font-extrabold text-primary text-sm whitespace-nowrap">
                          {formatINR(ps.netSalary)}
                        </td>
                        <td className="p-4 whitespace-nowrap">
                          <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase ${
                            ps.status === 'PUBLISHED' ? 'bg-success/10 text-success border border-success/20' :
                            ps.status === 'LOCKED' ? 'bg-amber-500/10 text-amber-600 border border-amber-500/20' :
                            'bg-primary/10 text-primary border border-primary/20'
                          }`}>
                            {ps.status}
                          </span>
                        </td>
                        <td className="p-4 text-right whitespace-nowrap">
                          <button
                            onClick={() => handleViewPayslip(ps.id)}
                            className="px-3 py-1.5 btn-primary rounded-lg font-bold transition-all text-xs flex items-center gap-1 ml-auto cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5" /> View / Print
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Export Options Modal */}
      {showExportModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-card border border-border rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl space-y-0 text-left">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-5 border-b border-border bg-muted/20">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-primary/10 text-primary">
                  <FileSpreadsheet className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-foreground text-base">Export Payslips to CSV</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">Select your preferred export scope</p>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowExportModal(false);
                  setExportError('');
                }}
                className="p-1.5 hover:bg-muted rounded-lg text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
                aria-label="Close export modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
              {exportError && (
                <div className="flex items-center gap-2 p-3 text-xs font-semibold rounded-xl bg-destructive/10 text-destructive border border-destructive/20">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{exportError}</span>
                </div>
              )}

              {/* Option 1: Export Current Filtered Results */}
              <div className="p-4 rounded-xl border border-border/80 bg-muted/30 hover:border-primary/40 transition-all space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h4 className="font-bold text-xs text-foreground uppercase tracking-wider flex items-center gap-1.5">
                      <Filter className="w-3.5 h-3.5 text-primary" /> Export Current Filtered Results
                    </h4>
                    <p className="text-xs text-muted-foreground mt-1">
                      Exports only the records currently shown in your table matching all active filters.
                    </p>
                  </div>
                  <span className="px-2 py-0.5 rounded-md bg-primary/10 text-primary text-[11px] font-extrabold shrink-0 border border-primary/20">
                    {filteredPayslips.length} {filteredPayslips.length === 1 ? 'Record' : 'Records'}
                  </span>
                </div>

                <div className="text-[11px] text-muted-foreground space-y-0.5 bg-card/60 p-2.5 rounded-lg border border-border/50">
                  <p><strong className="text-foreground">Period Scope:</strong> {periodLabel}</p>
                  <p><strong className="text-foreground">Department:</strong> {departmentFilter === 'ALL' ? 'All Departments' : departmentFilter}</p>
                  <p><strong className="text-foreground">Member:</strong> {memberFilter === 'ALL' ? 'All Members' : (membersList.find(m => m.id === memberFilter)?.name || 'Selected')}</p>
                  {searchQuery && <p><strong className="text-foreground">Search Query:</strong> &ldquo;{searchQuery}&rdquo;</p>}
                </div>

                <button
                  onClick={handleExportFiltered}
                  disabled={filteredPayslips.length === 0 || exportLoading}
                  className="w-full h-10 inline-flex items-center justify-center gap-2 px-4 py-2 btn-primary rounded-xl font-bold text-xs shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>Download Current Filtered CSV ({filteredPayslips.length})</span>
                </button>
              </div>

              {/* Option 2: Export by Specific Pay Period */}
              <div className="p-4 rounded-xl border border-border/80 bg-muted/30 hover:border-primary/40 transition-all space-y-3">
                <div>
                  <h4 className="font-bold text-xs text-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-primary" /> Export by Specific Pay Period
                  </h4>
                  <p className="text-xs text-muted-foreground mt-1">
                    Export all payslips for a specific month and year, regardless of table filters.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="block text-[11px] font-bold text-muted-foreground mb-1">Month</label>
                    <select
                      value={exportMonth}
                      onChange={e => setExportMonth(e.target.value)}
                      className="w-full h-10 bg-card border border-border rounded-xl px-3 py-2 text-xs font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer"
                    >
                      {MONTHS.map((m, idx) => (
                        <option key={idx + 1} value={idx + 1}>{m}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-muted-foreground mb-1">Year</label>
                    <select
                      value={exportYear}
                      onChange={e => setExportYear(e.target.value)}
                      className="w-full h-10 bg-card border border-border rounded-xl px-3 py-2 text-xs font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer"
                    >
                      {YEARS.map(y => (
                        <option key={y} value={y}>{y}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <button
                  onClick={handleExportByPeriod}
                  disabled={exportLoading}
                  className="w-full h-10 inline-flex items-center justify-center gap-2 px-4 py-2 btn-primary rounded-xl font-bold text-xs shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {exportLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Fetching &amp; Exporting...</span>
                    </>
                  ) : (
                    <>
                      <FileSpreadsheet className="w-4 h-4" />
                      <span>Export Period Payslips ({MONTHS[Number(exportMonth) - 1]} {exportYear})</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-border bg-muted/20 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setShowExportModal(false);
                  setExportError('');
                }}
                className="px-4 py-2 border border-border rounded-xl text-xs font-semibold text-muted-foreground hover:bg-muted cursor-pointer transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Payslip Viewer */}
      {showModal && selectedPayslip && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto space-y-6 shadow-2xl print:p-0 print:border-none print:shadow-none">
            <div className="flex items-center justify-between pb-3 border-b border-border print:hidden">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-primary" />
                <h3 className="font-extrabold text-foreground text-base">Official Employee Payslip</h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => window.print()}
                  className="px-3 py-1.5 border border-border hover:bg-muted rounded-lg font-bold text-xs flex items-center gap-1.5 cursor-pointer"
                >
                  <Printer className="w-4 h-4" /> Print / Save PDF
                </button>
                <button
                  onClick={() => setShowModal(false)}
                  className="p-1 hover:bg-muted rounded-lg text-muted-foreground cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Printable Body */}
            <div className="bg-white text-slate-900 p-8 rounded-xl border border-slate-200 space-y-6 text-xs">
              <div className="flex justify-between items-start border-b border-slate-300 pb-4">
                <div>
                  <h2 className="text-xl font-black text-slate-900 tracking-tight">{settings?.companyName || 'Innoveity Tech'}</h2>
                  <p className="text-slate-500 text-[11px] mt-0.5">{settings?.companyAddress || 'Innovation Towers, Cyber City, Bangalore - 560001'}</p>
                </div>
                <div className="text-right">
                  <span className="px-2.5 py-1 bg-slate-100 text-slate-800 font-black rounded text-[10px] uppercase">CONFIDENTIAL PAYSLIP</span>
                  <p className="text-slate-600 font-bold mt-1 text-sm">Month {selectedPayslip.month} / {selectedPayslip.year}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 bg-slate-50 p-4 rounded-lg border border-slate-200">
                <div>
                  <p className="text-slate-500 font-semibold">Employee Name: <span className="text-slate-900 font-bold">{selectedPayslip.user?.name}</span></p>
                  <p className="text-slate-500 font-semibold">Employee ID: <span className="text-slate-900 font-bold">{selectedPayslip.user?.employeeId || 'EMP-' + selectedPayslip.user?.id?.substring(0, 6)}</span></p>
                  <p className="text-slate-500 font-semibold">Role / Designation: <span className="text-slate-900 font-bold">{selectedPayslip.user?.role}</span></p>
                </div>
                <div>
                  <p className="text-slate-500 font-semibold">Department: <span className="text-slate-900 font-bold">{selectedPayslip.user?.department || 'General'}</span></p>
                  <p className="text-slate-500 font-semibold">Payment Method: <span className="text-slate-900 font-bold">Direct Bank Transfer</span></p>
                  <p className="text-slate-500 font-semibold">Pay Date: <span className="text-slate-900 font-bold">{settings?.payDay ? `${settings.payDay}th of Month` : '30th of Month'}</span></p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-2">
                  <h4 className="font-bold text-slate-800 border-b border-slate-300 pb-1 text-xs uppercase tracking-wider">GROSS EARNINGS</h4>
                  <div className="flex justify-between text-slate-600"><span>Basic Salary</span><span className="font-semibold text-slate-900">{formatINR(selectedPayslip.basicSalary)}</span></div>
                  <div className="flex justify-between text-slate-600"><span>HRA</span><span className="font-semibold text-slate-900">{formatINR(selectedPayslip.hra)}</span></div>
                  <div className="flex justify-between text-slate-600"><span>DA</span><span className="font-semibold text-slate-900">{formatINR(selectedPayslip.da)}</span></div>
                  <div className="flex justify-between text-slate-600"><span>Allowances & Bonus</span><span className="font-semibold text-slate-900">{formatINR((selectedPayslip.allowancesJson?.specialAllowance || 0) + (selectedPayslip.allowancesJson?.travelAllowance || 0))}</span></div>
                  <div className="flex justify-between text-slate-600"><span>Overtime Pay ({selectedPayslip.overtimeHours || 0}h)</span><span className="font-semibold text-slate-900">{formatINR(selectedPayslip.overtimePay)}</span></div>
                  <div className="flex justify-between text-slate-600"><span>Holiday Work Pay ({selectedPayslip.holidayDaysWorked || 0}d)</span><span className="font-semibold text-slate-900">{formatINR(selectedPayslip.holidayPay)}</span></div>
                </div>

                <div className="space-y-2">
                  <h4 className="font-bold text-slate-800 border-b border-slate-300 pb-1 text-xs uppercase tracking-wider">DEDUCTIONS</h4>
                  <div className="flex justify-between text-slate-600"><span>PF Contribution</span><span className="font-semibold text-slate-900">{formatINR(selectedPayslip.deductionsJson?.pfDeduction)}</span></div>
                  <div className="flex justify-between text-slate-600"><span>Professional Tax</span><span className="font-semibold text-slate-900">{formatINR(selectedPayslip.deductionsJson?.profTax)}</span></div>
                  <div className="flex justify-between text-slate-600"><span>Income Tax (TDS)</span><span className="font-semibold text-slate-900">{formatINR(selectedPayslip.deductionsJson?.incomeTax)}</span></div>
                  <div className="flex justify-between text-slate-600"><span>Late Deductions</span><span className="font-semibold text-slate-900">{formatINR(selectedPayslip.lateDeduction)}</span></div>
                  <div className="flex justify-between text-slate-600"><span>Leave (LOP) Deductions</span><span className="font-semibold text-slate-900">{formatINR(selectedPayslip.deductionsJson?.leaveDeduction)}</span></div>
                </div>
              </div>

              <div className="bg-slate-50 border border-slate-300 p-4 rounded-lg flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-bold text-slate-800 uppercase block">NET DISBURSEMENT AMOUNT</span>
                  <span className="text-2xl font-black text-slate-900">{formatINR(selectedPayslip.netSalary)}</span>
                </div>
                <div className="text-right flex items-center gap-2">
                  <QrCode className="w-10 h-10 text-slate-800" />
                  <div>
                    <span className="text-[9px] font-mono text-slate-700 block">QR HASH: {selectedPayslip.qrCodeHash || 'VERIFIED'}</span>
                    <span className="text-[10px] font-bold text-slate-800">Digitally Verified</span>
                  </div>
                </div>
              </div>

              <div className="pt-6 border-t border-slate-300 flex justify-between items-end text-[10px] text-slate-500">
                <p>This is a computer-generated document and requires no physical signature.</p>
                <div className="text-right">
                  <p className="font-bold text-slate-800 text-xs">{settings?.authorizedSignature || 'Authorized Signatory'}</p>
                  <p>Innoveity Payroll Desk</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
