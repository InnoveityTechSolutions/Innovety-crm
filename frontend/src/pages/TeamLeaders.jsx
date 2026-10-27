import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import api, { getUploadUrl, downloadFile } from '../services/api';
import UserAvatar from '../components/common/UserAvatar';
import ConfirmModal from '../components/common/ConfirmModal';
import CandidateTypeFields from '../components/common/CandidateTypeFields';
import {
  Plus,
  Search,
  Trash2,
  Lock,
  Download,
  Upload,
  X,
  CheckCircle,
  AlertCircle,
  Edit2,
  Eye,
  Mail,
  Phone,
  Calendar,
  Clock,
  GraduationCap,
  Building2,
  Briefcase,
  RotateCcw,
  FileText,
  MessageSquare,
  Award,
  TrendingUp
} from 'lucide-react';
import UserWizardModal from '../components/common/UserWizardModal';
import PromoteUserModal from '../components/common/PromoteUserModal';
import { useAuth } from '../context/AuthContext';
import CompanyScopeSelector from '../components/common/CompanyScopeSelector';
import { useCompanyScope } from '../context/CompanyScopeContext';

const TeamLeaders = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const urlSearch = new URLSearchParams(location.search).get('search') || '';

  const { user: currentUser } = useAuth();
  const isSuperAdmin = currentUser?.role === 'SUPER_ADMIN';
  const { selectedOrgId, effectiveOrgId } = useCompanyScope();
  const targetOrg = isSuperAdmin ? selectedOrgId : (effectiveOrgId || currentUser?.organizationId);
  const [users, setUsers] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState(urlSearch);
  const [statusFilter, setStatusFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');

  const [availableDepartments, setAvailableDepartments] = useState([]);
  const [availableRoles, setAvailableRoles] = useState([]);

  useEffect(() => {
    const sParam = new URLSearchParams(location.search).get('search') || '';
    setSearch(sParam);
  }, [location.search]);

  useEffect(() => {
    api.get('/organization/tree')
      .then((res) => {
        const depts = (res.data?.departments || []).map(d => d.name).filter(Boolean);
        const pos = (res.data?.positions || []).map(p => p.name).filter(Boolean);
        if (depts.length > 0) setAvailableDepartments(prev => Array.from(new Set([...prev, ...depts])));
        if (pos.length > 0) setAvailableRoles(prev => Array.from(new Set([...prev, ...pos])));
      })
      .catch((err) => console.error('Failed to fetch org tree for filters:', err));
  }, []);

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [detailsModalUser, setDetailsModalUser] = useState(null);
  const [promoteModalUser, setPromoteModalUser] = useState(null);

  // Custom Confirmation Modal state
  const [confirmModal, setConfirmModal] = useState({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: null
  });

  // Form states
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    dob: '',
    college: '',
    department: '',
    joiningDate: '',
    role: 'TEAM_LEADER',
    candidateType: '',
    degree: '',
    currentYearSemester: '',
    graduationYear: '',
    internshipRole: '',
    internshipDuration: '',
    highestQualification: '',
    keySkills: '',
    companyName: '',
    designation: '',
    totalExperience: '',
    resume: '',
    resumeFile: null
  });

  const [importText, setImportText] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [alertMsg, setAlertMsg] = useState({ type: '', text: '' });
  const [loading, setLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const deleteTriggerRef = useRef(null);


  const fetchUsers = async () => {
    try {
      setLoading(true);
      const res = await api.get('/users', {
        params: {
          page,
          search,
          role: 'TEAM_LEADER',
          status: statusFilter,
          department: departmentFilter,
          position: roleFilter,
          limit: 50,
          organizationId: targetOrg
        }
      });
      const fetchedUsers = res.data.users || [];
      setUsers(fetchedUsers);
      setTotalCount(res.data.meta?.totalCount || 0);

      // Collect departments and roles dynamically
      const deptsFromUsers = fetchedUsers.map(u => u.department || u.departmentRef?.name).filter(Boolean);
      const rolesFromUsers = fetchedUsers.map(u => u.position?.name || (u.role === 'TEAM_LEADER' ? 'Lead' : u.role === 'INTERN' ? 'Intern' : 'Junior')).filter(Boolean);
      if (deptsFromUsers.length > 0) setAvailableDepartments(prev => Array.from(new Set([...prev, ...deptsFromUsers])));
      if (rolesFromUsers.length > 0) setAvailableRoles(prev => Array.from(new Set([...prev, ...rolesFromUsers])));

      setAlertMsg({ type: '', text: '' });
      setLoading(false);
    } catch (err) {
      console.error('Fetch team leader registry error:', err);
      setAlertMsg({ type: 'error', text: err.response?.data?.message || 'Failed to fetch team leader registry.' });
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
    const handleUserPromoted = () => {
      fetchUsers();
    };
    window.addEventListener('crm-user-promoted', handleUserPromoted);
    return () => window.removeEventListener('crm-user-promoted', handleUserPromoted);
  }, [page, statusFilter, roleFilter, departmentFilter, targetOrg, currentUser?.organizationId]);

  const displayUsers = React.useMemo(() => {
    return users.filter((u) => {
      if (u.role !== 'TEAM_LEADER' || u.id === currentUser?.id) return false;
      if (statusFilter && u.status !== statusFilter) return false;
      if (departmentFilter) {
        const userDept = u.department || u.departmentRef?.name || '';
        if (userDept.toLowerCase() !== departmentFilter.toLowerCase() && u.departmentId !== departmentFilter) {
          return false;
        }
      }
      if (roleFilter) {
        const userPosName = u.position?.name || (u.role === 'TEAM_LEADER' ? 'Lead' : u.role === 'INTERN' ? 'Intern' : u.role);
        if (userPosName.toLowerCase() !== roleFilter.toLowerCase() && u.role !== roleFilter) {
          return false;
        }
      }
      if (search) {
        const q = search.toLowerCase();
        const matchesName = u.name?.toLowerCase().includes(q);
        const matchesEmail = u.email?.toLowerCase().includes(q);
        const matchesId = u.employeeId?.toLowerCase().includes(q);
        const matchesDept = (u.department || u.departmentRef?.name || '').toLowerCase().includes(q);
        if (!matchesName && !matchesEmail && !matchesId && !matchesDept) return false;
      }
      return true;
    });
  }, [users, currentUser?.id, statusFilter, departmentFilter, roleFilter, search]);

  const handleClearFilters = () => {
    setSearch('');
    setStatusFilter('');
    setRoleFilter('');
    setDepartmentFilter('');
    setPage(1);
  };

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    setPage(1);
    fetchUsers();
  };

  const handleInputChange = (e) => {
    if (e.updatedData) {
      setFormData(e.updatedData);
    } else {
      setFormData({ ...formData, [e.target.name]: e.target.value });
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) setFormData({ ...formData, resumeFile: file });
  };

  const resetFormData = () => ({
    name: '',
    email: '',
    phone: '',
    dob: '',
    college: '',
    department: '',
    joiningDate: '',
    role: 'TEAM_LEADER',
    candidateType: '',
    degree: '',
    currentYearSemester: '',
    graduationYear: '',
    internshipRole: '',
    internshipDuration: '',
    highestQualification: '',
    keySkills: '',
    companyName: '',
    designation: '',
    totalExperience: '',
    resume: '',
    resumeFile: null
  });

  const handleCreateSubmit = async (e) => {
    e.preventDefault();
    try {
      setLoading(true);
      const fd = new FormData();
      Object.keys(formData).forEach((key) => {
        if (key === 'resumeFile' || key === 'resume') return;
        if (formData[key] !== null && formData[key] !== undefined) fd.append(key, formData[key]);
      });
      fd.set('role', 'TEAM_LEADER');
      if (formData.resumeFile) fd.append('resume', formData.resumeFile);
      await api.post('/users', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setCreateModalOpen(false);
      setFormData(resetFormData());
      setAlertMsg({ type: 'success', text: 'Team Leader onboarded successfully! Welcome email is being dispatched.' });
      fetchUsers();
    } catch (err) {
      setAlertMsg({ type: 'error', text: err.response?.data?.message || 'Failed to onboard team leader.' });
      setLoading(false);
    }
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    try {
      setLoading(true);
      const fd = new FormData();
      Object.keys(formData).forEach((key) => {
        if (key === 'resumeFile' || key === 'resume') return;
        if (formData[key] !== null && formData[key] !== undefined) fd.append(key, formData[key]);
      });
      if (formData.resumeFile) fd.append('resume', formData.resumeFile);
      const res = await api.put(`/users/${selectedUser.id}`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setEditModalOpen(false);
      setSelectedUser(null);
      const successMsg = res.data.dobPasswordReset
        ? 'Date of Birth updated successfully. The user\'s initial password has been reset based on the new DOB.'
        : 'Team Leader details updated.';
      setAlertMsg({ type: 'success', text: successMsg });
      fetchUsers();
    } catch (err) {
      setAlertMsg({ type: 'error', text: err.response?.data?.message || 'Failed to edit team leader details.' });
      setLoading(false);
    }
  };

  const handleDeleteUser = (id, e) => {
    deleteTriggerRef.current = e?.currentTarget || document.activeElement;
    setConfirmModal({
      isOpen: true,
      title: 'Delete Record',
      message: 'Are you sure you want to permanently delete this record? This action cannot be undone.',
      onConfirm: async () => {
        try {
          setDeleteLoading(true);
          const res = await api.delete(`/users/${id}`);
          setAlertMsg({ type: 'success', text: res.data?.message || 'Record deleted successfully.' });
          await fetchUsers();
        } catch (err) {
          console.error('Delete user error:', err);
          setAlertMsg({ type: 'error', text: 'Failed to delete record. Please try again.' });
        } finally {
          setDeleteLoading(false);
          setConfirmModal(prev => ({ ...prev, isOpen: false }));
        }
      }
    });
  };

  const handleToggleStatus = async (id, currentStatus) => {
    const nextStatus = currentStatus === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    try {
      await api.put(`/users/${id}/status`, { status: nextStatus });
      setAlertMsg({ type: 'success', text: `Team Leader status set to ${nextStatus}.` });
      fetchUsers();
    } catch (err) {
      setAlertMsg({ type: 'error', text: 'Failed to toggle status.' });
    }
  };

  const handleResetPassword = async (id) => {
    try {
      const res = await api.put(`/users/${id}/reset-password`);
      setAlertMsg({
        type: 'success',
        text: `Password reset to default DOB format. Temporary: "${res.data.tempPassword}"`
      });
    } catch (err) {
      setAlertMsg({ type: 'error', text: err.response?.data?.message || 'Failed to reset password.' });
    }
  };

  const handleBulkDelete = () => {
    if (selectedIds.length === 0) return;
    setConfirmModal({
      isOpen: true,
      title: 'Bulk Delete Team Leaders',
      message: `Are you sure you want to delete the ${selectedIds.length} selected Team Leaders? This action is permanent.`,
      onConfirm: async () => {
        try {
          await api.post('/users/bulk-delete', { ids: selectedIds });
          setSelectedIds([]);
          setAlertMsg({ type: 'success', text: 'Selected accounts deleted.' });
          fetchUsers();
        } catch (err) {
          setAlertMsg({ type: 'error', text: 'Bulk delete operations failed.' });
        }
      }
    });
  };

  const handleImportSubmit = async (e) => {
    e.preventDefault();
    try {
      const lines = importText.split('\n');
      const headers = lines[0].split(',').map(h => h.trim());
      const parsedUsers = [];

      for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        const columns = lines[i].split(',').map(c => c.trim());
        const userObj = {};
        headers.forEach((header, idx) => {
          userObj[header] = columns[idx];
        });
        userObj['role'] = 'TEAM_LEADER'; // Enforce Team Leader role
        parsedUsers.push(userObj);
      }

      setLoading(true);
      const res = await api.post('/users/bulk-import', { usersList: parsedUsers });
      setImportModalOpen(false);
      setImportText('');
      setAlertMsg({
        type: 'success',
        text: `Import completed. Created: ${res.data.createdCount}. Skipped: ${res.data.skipped.length}.`
      });
      fetchUsers();
    } catch (err) {
      setAlertMsg({ type: 'error', text: 'Invalid CSV format or values. Ensure columns match: name,email,dob,phone,college,department' });
      setLoading(false);
    }
  };

  const triggerExport = async () => {
    try {
      setLoading(true);
      const res = await api.get('/users', {
        params: {
          role: 'TEAM_LEADER',
          status: statusFilter,
          search: search,
          limit: 1000
        }
      });
      const exportList = res.data.users || users;

      const headers = ['Employee ID', 'Full Name', 'Email', 'Phone', 'College', 'Department', 'Role', 'Status', 'Joining Date', 'Created At'];
      const csvRows = exportList.map(u => [
        `"${(u.employeeId || '').replace(/"/g, '""')}"`,
        `"${(u.name || '').replace(/"/g, '""')}"`,
        `"${(u.email || '').replace(/"/g, '""')}"`,
        `"${(u.phone || '').replace(/"/g, '""')}"`,
        `"${(u.college || '').replace(/"/g, '""')}"`,
        `"${(u.department || '').replace(/"/g, '""')}"`,
        `"${(u.role || '').replace(/"/g, '""')}"`,
        `"${(u.status || '').replace(/"/g, '""')}"`,
        `"${u.joiningDate ? new Date(u.joiningDate).toLocaleDateString() : ''}"`,
        `"${u.createdAt ? new Date(u.createdAt).toLocaleDateString() : ''}"`
      ].join(','));

      const csvContent = '\uFEFF' + [headers.join(','), ...csvRows].join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `employee_registry_${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      setLoading(false);
      setAlertMsg({ type: 'success', text: `Successfully exported ${exportList.length} employee records to CSV.` });
    } catch (err) {
      console.error(err);
      setAlertMsg({ type: 'error', text: 'Failed to export CSV file.' });
      setLoading(false);
    }
  };

  const openEditModal = (user) => {
    setSelectedUser(user);
    setFormData({
      name: user.name,
      email: user.email,
      phone: user.phone || '',
      dob: user.dob ? user.dob.split('T')[0] : '',
      college: user.college || '',
      department: user.department || '',
      joiningDate: user.joiningDate ? user.joiningDate.split('T')[0] : '',
      role: user.role || 'ADMIN',
      candidateType: user.candidateType || '',
      degree: user.degree || '',
      currentYearSemester: user.currentYearSemester || '',
      graduationYear: user.graduationYear || '',
      internshipRole: user.internshipRole || '',
      internshipDuration: user.internshipDuration || '',
      highestQualification: user.highestQualification || '',
      keySkills: user.keySkills || '',
      companyName: user.companyName || '',
      designation: user.designation || '',
      totalExperience: user.totalExperience || '',
      resume: user.resume || '',
      resumeFile: null
    });
    setEditModalOpen(true);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <CompanyScopeSelector />

      {/* Alert Header Banner */}
      {alertMsg.text && (
        <div className={`flex items-center gap-2 p-4 rounded-xl border ${alertMsg.type === 'success' ? 'bg-primary/10 border-primary/20 text-primary' : 'bg-red-500/10 border-red-500/20 text-red-500'}`}>
          {alertMsg.type === 'success' ? <CheckCircle className="h-5 w-5" /> : <AlertCircle className="h-5 w-5" />}
          <span className="text-xs font-semibold">{alertMsg.text}</span>
          <button className="ml-auto" onClick={() => setAlertMsg({ type: '', text: '' })}>
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Control Actions Bar */}
      <div className="glass-card p-4 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between border border-white/70 dark:border-white/10 shadow-lg">
        {/* Horizontal Filters Row */}
        <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-0">
          {/* Status Dropdown */}
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            className="h-11 px-3.5 py-2 bg-white/80 dark:bg-slate-800/80 text-xs font-semibold rounded-xl border border-border/60 focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer shadow-xs"
          >
            <option value="">All Statuses</option>
            <option value="ACTIVE">ACTIVE</option>
            <option value="INACTIVE">INACTIVE</option>
          </select>

          {/* Role Dropdown */}
          <select
            value={roleFilter}
            onChange={(e) => {
              setRoleFilter(e.target.value);
              setPage(1);
            }}
            className="h-11 px-3.5 py-2 bg-white/80 dark:bg-slate-800/80 text-xs font-semibold rounded-xl border border-border/60 focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer shadow-xs"
          >
            <option value="">All Roles</option>
            {availableRoles.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>

          {/* Department Dropdown */}
          <select
            value={departmentFilter}
            onChange={(e) => {
              setDepartmentFilter(e.target.value);
              setPage(1);
            }}
            className="h-11 px-3.5 py-2 bg-white/80 dark:bg-slate-800/80 text-xs font-semibold rounded-xl border border-border/60 focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer shadow-xs"
          >
            <option value="">All Departments</option>
            {availableDepartments.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>

          {/* Search Input */}
          <div className="relative flex-1 min-w-[220px] max-w-xs sm:max-w-sm">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search by name / ID / email..."
              className="w-full h-11 pl-10 pr-4 bg-white/80 dark:bg-slate-800/80 text-xs font-medium rounded-xl border border-border/60 focus:bg-white dark:focus:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all shadow-xs"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>

          {/* Clear Filters Button */}
          {(search || statusFilter || roleFilter || departmentFilter) && (
            <button
              type="button"
              onClick={handleClearFilters}
              className="h-11 px-3.5 inline-flex items-center gap-1.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-400 border border-red-500/20 text-xs font-bold transition-all cursor-pointer shadow-xs"
              title="Reset all filters"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Clear Filters</span>
            </button>
          )}
        </div>

        {/* Right Side Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={triggerExport} className="h-11 px-3.5 flex items-center gap-1.5 rounded-xl border border-border/60 bg-card text-xs font-semibold hover:bg-muted transition-all shadow-xs">
            <Download className="h-3.5 w-3.5" />
            <span>Export CSV</span>
          </button>

          <button onClick={() => setCreateModalOpen(true)} className="h-11 px-4 flex items-center gap-1.5 rounded-xl bg-primary text-xs font-semibold text-primary-foreground shadow-md hover:bg-primary-hover transition-all">
            <Plus className="h-3.5 w-3.5" />
            <span>Add Team Leader</span>
          </button>

          {selectedIds.length > 0 && (
            <button onClick={handleBulkDelete} className="h-11 px-3.5 flex items-center gap-1.5 rounded-xl bg-danger text-xs font-semibold text-white shadow-md hover:bg-danger-hover transition-all">
              <Trash2 className="h-3.5 w-3.5" />
              <span>Delete Selected ({selectedIds.length})</span>
            </button>
          )}
        </div>
      </div>

      {/* Grid Registry Table */}
      <div className="w-full min-w-0 overflow-x-auto glass-card border border-white/70 dark:border-white/10 shadow-lg">
        <table className="w-full min-w-[1000px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-border/40 bg-white/40 dark:bg-slate-800/40 text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
              <th className="w-12 px-4 py-4 whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={displayUsers.length > 0 && selectedIds.length === displayUsers.length}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedIds(displayUsers.map(u => u.id));
                    } else {
                      setSelectedIds([]);
                    }
                  }}
                  className="rounded border-border text-primary focus:ring-primary"
                />
              </th>
              <th className="w-[120px] px-4 py-4 whitespace-nowrap">ID</th>
              <th className="px-4 py-4 whitespace-nowrap">Team Leader Name</th>
              <th className="w-[140px] px-4 py-4 whitespace-nowrap">Role</th>
              <th className="w-[200px] px-4 py-4 whitespace-nowrap">Department</th>
              <th className="w-[120px] px-4 py-4 whitespace-nowrap">Status</th>
              <th className="w-[200px] min-w-[200px] px-4 py-4 text-right whitespace-nowrap">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/30">
            {loading ? (
              <tr>
                <td colSpan={7} className="px-6 py-16 text-center whitespace-nowrap">
                  <div className="flex flex-col items-center justify-center gap-3">
                    <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                    <span className="text-xs font-semibold text-muted-foreground">Loading admin registry...</span>
                  </div>
                </td>
              </tr>
            ) : alertMsg.type === 'error' && displayUsers.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-6 py-16 text-center whitespace-nowrap">
                  <div className="mx-auto flex max-w-sm flex-col items-center justify-center text-center">
                    <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-red-500/10 text-red-500 mb-4 shadow-sm">
                      <AlertCircle className="h-8 w-8" />
                    </div>
                    <h3 className="text-base font-bold text-foreground">Failed to Load Team Leaders</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {alertMsg.text || 'Failed to load team leader records. Please check your network connection and try again.'}
                    </p>
                    <button
                      onClick={fetchUsers}
                      className="mt-4 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-foreground shadow-md hover:bg-primary-hover transition-all"
                    >
                      <RotateCcw className="h-4 w-4" />
                      <span>Retry Loading</span>
                    </button>
                  </div>
                </td>
              </tr>
            ) : displayUsers.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-6 py-16 text-center whitespace-nowrap">
                  <div className="mx-auto flex max-w-sm flex-col items-center justify-center text-center">
                    <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary mb-4 shadow-sm">
                      <Briefcase className="h-8 w-8" />
                    </div>
                    <h3 className="text-base font-bold text-foreground">No Team Leaders Found</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      No team leader records match the selected filter criteria.
                    </p>
                    <button
                      onClick={handleClearFilters}
                      className="mt-4 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-foreground shadow-md hover:bg-primary-hover transition-all"
                    >
                      <RotateCcw className="h-4 w-4" />
                      <span>Clear Filters</span>
                    </button>
                  </div>
                </td>
              </tr>
            ) : (
              displayUsers.map((item) => (
                <tr
                  key={item.id}
                  className="hover:bg-muted/30 cursor-pointer transition-all h-16 whitespace-nowrap"
                  onClick={() => setDetailsModalUser(item)}
                >
                  <td className="w-12 px-4 py-4 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(item.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedIds([...selectedIds, item.id]);
                        } else {
                          setSelectedIds(selectedIds.filter(id => id !== item.id));
                        }
                      }}
                      className="rounded border-border text-primary focus:ring-primary"
                    />
                  </td>
                  <td className="w-[120px] px-4 py-4 font-mono font-bold text-xs text-primary whitespace-nowrap">
                    {item.employeeId}
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-3">
                      <UserAvatar
                        src={item.profilePic}
                        name={item.name}
                        className="h-10 w-10 rounded-xl object-cover ring-1 ring-border/40 shadow-sm shrink-0"
                      />
                      <div className="flex flex-col min-w-0">
                        <span className="font-semibold text-foreground hover:text-primary transition-colors text-xs sm:text-sm truncate">
                          {item.name}
                        </span>
                        <span className="text-[11px] font-medium text-muted-foreground truncate mt-0.5" title={item.email}>
                          {item.email}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className="w-[140px] px-4 py-4 whitespace-nowrap">
                    {item.position ? (
                      <span
                        className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-extrabold shadow-xs"
                        style={{ backgroundColor: item.position.color || '#F59E0B', color: item.position.textColor || '#FFFFFF' }}
                      >
                        <Award className="h-3 w-3" />
                        <span>{item.position.name}</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-slate-500/10 text-slate-600 dark:text-slate-400 border border-slate-500/20">
                        <Award className="h-3 w-3" />
                        <span>Unassigned</span>
                      </span>
                    )}
                  </td>
                  <td className="w-[200px] px-4 py-4 text-xs font-medium text-foreground truncate whitespace-nowrap" title={item.department || item.departmentRef?.name || 'N/A'}>{item.department || item.departmentRef?.name || 'N/A'}</td>
                  <td className="w-[120px] px-4 py-4 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => handleToggleStatus(item.id, item.status)}
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase transition-all ${item.status === 'ACTIVE' ? 'bg-primary/10 text-primary' : 'bg-red-500/10 text-red-500'}`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${item.status === 'ACTIVE' ? 'bg-primary' : 'bg-red-500'}`} />
                      <span>{item.status}</span>
                    </button>
                  </td>
                  <td className="w-[200px] min-w-[200px] px-4 py-4 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1 whitespace-nowrap">
                      {['ADMIN', 'SUPER_ADMIN'].includes(currentUser?.role) && (
                        <button
                          onClick={() => setPromoteModalUser(item)}
                          className="rounded-lg p-1.5 text-amber-600 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 transition-colors"
                          title="Promote User"
                        >
                          <TrendingUp className="h-4 w-4" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (item.resume) {
                            downloadFile(item.resume);
                          } else {
                            alert('No resume uploaded for this team leader.');
                          }
                        }}
                        className={`rounded-lg p-1.5 border transition-colors inline-flex items-center gap-1 cursor-pointer ${
                          item.resume
                            ? 'text-blue-600 bg-blue-500/10 hover:bg-blue-500/20 border-blue-500/30'
                            : 'text-muted-foreground/40 bg-muted/10 border-border/20 cursor-not-allowed'
                        }`}
                        title={item.resume ? 'View Resume' : 'No resume uploaded'}
                      >
                        <FileText className="h-4 w-4" />
                      </button>
                      <button onClick={() => setDetailsModalUser(item)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-primary transition-colors" title="View Details Card">
                        <Eye className="h-4 w-4" />
                      </button>
                      <button onClick={() => handleResetPassword(item.id)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" title="Reset password">
                        <Lock className="h-4 w-4" />
                      </button>
                      <button onClick={() => openEditModal(item)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" title="Edit Record">
                        <Edit2 className="h-4 w-4" />
                      </button>
                      <button onClick={(e) => handleDeleteUser(item.id, e)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-danger focus:ring-2 focus:ring-danger focus:outline-none" title="Delete Record">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Controls */}
      <div className="flex justify-between items-center px-2">
        <span className="text-xs text-muted-foreground">Total records: {totalCount}</span>
        <div className="flex gap-2">
          <button
            disabled={page === 1}
            onClick={() => setPage(page - 1)}
            className="px-3 py-1 bg-card border rounded-lg text-xs font-semibold disabled:opacity-50 hover:bg-muted"
          >
            Prev
          </button>
          <button
            disabled={users.length < 15}
            onClick={() => setPage(page + 1)}
            className="px-3 py-1 bg-card border rounded-lg text-xs font-semibold disabled:opacity-50 hover:bg-muted"
          >
            Next
          </button>
        </div>
      </div>

      {/* Onboard Create / Edit User Wizard Modal */}
      <UserWizardModal
        isOpen={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        targetRole="TEAM_LEADER"
        loading={loading}
        onSubmit={async (wizardData) => {
          try {
            setLoading(true);
            await api.post('/users', wizardData);
            setAlertMsg({ type: 'success', text: 'Team Leader onboarded successfully!' });
            setCreateModalOpen(false);
            fetchUsers();
          } catch (err) {
            setAlertMsg({ type: 'error', text: err.response?.data?.message || 'Failed to onboard team leader.' });
          } finally {
            setLoading(false);
          }
        }}
      />

      <UserWizardModal
        isOpen={editModalOpen}
        onClose={() => {
          setEditModalOpen(false);
          setSelectedUser(null);
        }}
        isEdit={true}
        initialData={selectedUser}
        targetRole="TEAM_LEADER"
        loading={loading}
        onSubmit={async (wizardData) => {
          try {
            setLoading(true);
            await api.put(`/users/${selectedUser.id}`, wizardData);
            setAlertMsg({ type: 'success', text: 'Team Leader record updated successfully.' });
            setEditModalOpen(false);
            setSelectedUser(null);
            fetchUsers();
          } catch (err) {
            setAlertMsg({ type: 'error', text: err.response?.data?.message || 'Failed to update team leader record.' });
          } finally {
            setLoading(false);
          }
        }}
      />

      {/* CSV Import Modal */}
      {importModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl border border-border/40 bg-card p-6 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-border/40 pb-3">
              <h3 className="text-base font-bold">Bulk Import Team Leaders (CSV)</h3>
              <button className="rounded-lg p-1 hover:bg-muted" onClick={() => setImportModalOpen(false)}>
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleImportSubmit} className="mt-4 space-y-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-muted-foreground">CSV Text Data</label>
                <textarea
                  rows={8}
                  placeholder="name,email,dob,phone,college,department,joiningDate&#10;Alice Smith,alice@example.com,1992-04-12,,MIT,CS,2026-09-01&#10;Bob Jones,bob@example.com,1990-11-23,123456,IIT,EE,2026-10-01"
                  className="w-full border border-border p-3 text-xs bg-muted/40 font-mono rounded-lg outline-none"
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  required
                />
              </div>

              <button type="submit" disabled={loading} className="w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground shadow-md hover:bg-primary-hover active:scale-95 disabled:opacity-50">
                Execute Bulk Import
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Accessible Confirmation Modal */}
      <ConfirmModal
        isOpen={confirmModal.isOpen}
        title={confirmModal.title}
        message={confirmModal.message}
        onConfirm={confirmModal.onConfirm}
        onClose={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
        loading={deleteLoading}
        triggerElement={deleteTriggerRef.current}
      />

      {/* User Details Card Modal / Panel */}
      {detailsModalUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-2xl rounded-3xl border border-border/40 bg-card p-5 shadow-2xl animate-in zoom-in-95 duration-200 text-left">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border/40 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Team Leader Details Profile Card</span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${detailsModalUser.status === 'ACTIVE' ? 'bg-primary/10 text-primary' : 'bg-red-500/10 text-red-500'}`}>
                  {detailsModalUser.status}
                </span>
              </div>
              <button
                className="rounded-lg p-1 hover:bg-muted text-muted-foreground hover:text-foreground"
                onClick={() => setDetailsModalUser(null)}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Compact Horizontal Profile Header Banner */}
            <div className="my-3 p-3.5 rounded-2xl bg-muted/30 border border-border/30 flex items-center gap-4">
              <UserAvatar
                user={detailsModalUser}
                className="h-14 w-14 rounded-2xl border-2 border-primary/20 shadow-sm shrink-0"
              />
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-foreground">{detailsModalUser.name}</h3>
                  <span className="text-[11px] font-mono font-bold bg-primary/10 text-primary px-2 py-0.5 rounded-md">
                    {detailsModalUser.employeeId}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 font-medium">
                  {detailsModalUser.role === 'TEAM_LEADER' ? 'Team Leader Account' : 'Admin Account'}
                </p>
              </div>

              <div className="ml-auto flex items-center gap-2">
                <button
                  onClick={() => { setDetailsModalUser(null); navigate(`/chat?dm=${detailsModalUser.id}`); }}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-primary hover:bg-primary-hover text-white text-xs font-bold shadow-md shadow-primary/20 transition-all active:scale-95 cursor-pointer"
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  <span>Message</span>
                </button>
                <a
                  href={`mailto:${detailsModalUser.email}`}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-foreground text-xs font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition-all cursor-pointer"
                >
                  <Mail className="h-3.5 w-3.5" />
                  <span>Email</span>
                </a>
              </div>
            </div>

            {/* Compact Profile Details Grid */}
            <div className="space-y-3 py-1">
              <div>
                <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Contact & Personal Details</h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div className="bg-muted/20 border border-border/20 p-2.5 rounded-xl">
                    <span className="text-[9px] font-bold text-muted-foreground uppercase flex items-center gap-1 mb-0.5">
                      <Mail className="h-3 w-3 text-primary" /> Email
                    </span>
                    <span className="font-semibold text-foreground truncate block text-xs">{detailsModalUser.email}</span>
                  </div>

                  <div className="bg-muted/20 border border-border/20 p-2.5 rounded-xl">
                    <span className="text-[9px] font-bold text-muted-foreground uppercase flex items-center gap-1 mb-0.5">
                      <Phone className="h-3 w-3 text-primary" /> Phone
                    </span>
                    <span className="font-semibold text-foreground text-xs">{detailsModalUser.phone || 'N/A'}</span>
                  </div>

                  <div className="bg-muted/20 border border-border/20 p-2.5 rounded-xl">
                    <span className="text-[9px] font-bold text-muted-foreground uppercase flex items-center gap-1 mb-0.5">
                      <Calendar className="h-3 w-3 text-primary" /> DOB
                    </span>
                    <span className="font-semibold text-foreground text-xs">
                      {detailsModalUser.dob ? new Date(detailsModalUser.dob).toLocaleDateString() : 'N/A'}
                    </span>
                  </div>

                  <div className="bg-muted/20 border border-border/20 p-2.5 rounded-xl">
                    <span className="text-[9px] font-bold text-muted-foreground uppercase flex items-center gap-1 mb-0.5">
                      <Clock className="h-3 w-3 text-primary" /> Joining Date
                    </span>
                    <span className="font-semibold text-foreground text-xs">
                      {detailsModalUser.joiningDate ? new Date(detailsModalUser.joiningDate).toLocaleDateString() : 'N/A'}
                    </span>
                  </div>
                </div>
              </div>

              <div>
                <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Academic & Department Info</h4>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-muted/20 border border-border/20 p-2.5 rounded-xl">
                    <span className="text-[9px] font-bold text-muted-foreground uppercase flex items-center gap-1 mb-0.5">
                      <GraduationCap className="h-3 w-3 text-primary" /> College / Institution
                    </span>
                    <span className="font-semibold text-foreground text-xs">{detailsModalUser.college || detailsModalUser.companyName || 'N/A'}</span>
                  </div>

                  <div className="bg-muted/20 border border-border/20 p-2.5 rounded-xl">
                    <span className="text-[9px] font-bold text-muted-foreground uppercase flex items-center gap-1 mb-0.5">
                      <Building2 className="h-3 w-3 text-primary" /> Department
                    </span>
                    <span className="font-semibold text-foreground text-xs">{detailsModalUser.department || 'N/A'}</span>
                  </div>
                </div>
              </div>

              {detailsModalUser.candidateType && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Candidate Profile</h4>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-bold">{detailsModalUser.candidateType}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {detailsModalUser.degree && (<div className="bg-muted/20 border border-border/20 p-2.5 rounded-xl"><span className="text-[9px] font-bold text-muted-foreground uppercase block mb-0.5">Degree</span><span className="font-semibold text-foreground text-xs">{detailsModalUser.degree}</span></div>)}
                    {detailsModalUser.currentYearSemester && (<div className="bg-muted/20 border border-border/20 p-2.5 rounded-xl"><span className="text-[9px] font-bold text-muted-foreground uppercase block mb-0.5">Year / Sem</span><span className="font-semibold text-foreground text-xs">{detailsModalUser.currentYearSemester}</span></div>)}
                    {detailsModalUser.graduationYear && (<div className="bg-muted/20 border border-border/20 p-2.5 rounded-xl"><span className="text-[9px] font-bold text-muted-foreground uppercase block mb-0.5">Graduation Year</span><span className="font-semibold text-foreground text-xs">{detailsModalUser.graduationYear}</span></div>)}
                    {detailsModalUser.internshipRole && (<div className="bg-muted/20 border border-border/20 p-2.5 rounded-xl"><span className="text-[9px] font-bold text-muted-foreground uppercase block mb-0.5">Internship Role</span><span className="font-semibold text-foreground text-xs">{detailsModalUser.internshipRole}</span></div>)}
                    {detailsModalUser.internshipDuration && (<div className="bg-muted/20 border border-border/20 p-2.5 rounded-xl"><span className="text-[9px] font-bold text-muted-foreground uppercase block mb-0.5">Duration</span><span className="font-semibold text-foreground text-xs">{detailsModalUser.internshipDuration}</span></div>)}
                    {detailsModalUser.highestQualification && (<div className="bg-muted/20 border border-border/20 p-2.5 rounded-xl"><span className="text-[9px] font-bold text-muted-foreground uppercase block mb-0.5">Qualification</span><span className="font-semibold text-foreground text-xs">{detailsModalUser.highestQualification}</span></div>)}
                    {detailsModalUser.keySkills && (<div className="bg-muted/20 border border-border/20 p-2.5 rounded-xl col-span-2"><span className="text-[9px] font-bold text-muted-foreground uppercase block mb-0.5">Key Skills</span><span className="font-semibold text-foreground text-xs">{detailsModalUser.keySkills}</span></div>)}
                    {detailsModalUser.companyName && (<div className="bg-muted/20 border border-border/20 p-2.5 rounded-xl"><span className="text-[9px] font-bold text-muted-foreground uppercase block mb-0.5">Company</span><span className="font-semibold text-foreground text-xs">{detailsModalUser.companyName}</span></div>)}
                    {detailsModalUser.designation && (<div className="bg-muted/20 border border-border/20 p-2.5 rounded-xl"><span className="text-[9px] font-bold text-muted-foreground uppercase block mb-0.5">Designation</span><span className="font-semibold text-foreground text-xs">{detailsModalUser.designation}</span></div>)}
                    {detailsModalUser.totalExperience && (<div className="bg-muted/20 border border-border/20 p-2.5 rounded-xl"><span className="text-[9px] font-bold text-muted-foreground uppercase block mb-0.5">Experience</span><span className="font-semibold text-foreground text-xs">{detailsModalUser.totalExperience}</span></div>)}
                    {detailsModalUser.resume && (
                      <div className="bg-muted/20 border border-border/20 p-2.5 rounded-xl col-span-2">
                        <span className="text-[9px] font-bold text-muted-foreground uppercase block mb-1">Resume</span>
                        <button
                          type="button"
                          onClick={() => downloadFile(detailsModalUser.resume)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 text-xs font-semibold transition-all"
                        >
                          <FileText className="h-3.5 w-3.5" /> Download Resume
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Footer Actions */}
            <div className="pt-3 mt-2 border-t border-border/40 flex items-center justify-end gap-2.5">
              {['ADMIN', 'SUPER_ADMIN'].includes(currentUser?.role) && (
                <button
                  onClick={() => {
                    const u = detailsModalUser;
                    setDetailsModalUser(null);
                    setPromoteModalUser(u);
                  }}
                  className="flex items-center gap-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-md transition-all cursor-pointer"
                >
                  <TrendingUp className="h-3.5 w-3.5" />
                  <span>Promote User</span>
                </button>
              )}
              <button
                onClick={() => {
                  const u = detailsModalUser;
                  setDetailsModalUser(null);
                  openEditModal(u);
                }}
                className="flex items-center gap-1.5 rounded-xl border border-border bg-card px-3.5 py-1.5 text-xs font-semibold hover:bg-muted"
              >
                <Edit2 className="h-3.5 w-3.5" />
                <span>Edit Profile</span>
              </button>
              <button
                onClick={() => {
                  const u = detailsModalUser;
                  setDetailsModalUser(null);
                  handleResetPassword(u.id);
                }}
                className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground shadow-md hover:bg-primary-hover"
              >
                <Lock className="h-3.5 w-3.5" />
                <span>Reset Password</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PROMOTE USER MODAL */}
      <PromoteUserModal
        isOpen={!!promoteModalUser}
        onClose={() => setPromoteModalUser(null)}
        user={promoteModalUser}
        onSuccess={(updatedUser, msg) => {
          const targetId = updatedUser?.id || promoteModalUser?.id;
          setUsers(prev => prev.filter(u => u.id !== targetId));
          setTotalCount(prev => Math.max(0, prev - 1));
          setAlertMsg({ type: 'success', text: msg || 'User promoted successfully!' });
          fetchUsers();
        }}
      />
    </div>
  );
};

export default TeamLeaders;
