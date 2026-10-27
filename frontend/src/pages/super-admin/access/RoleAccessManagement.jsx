import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Shield, Plus, Search, Filter, Edit3, Copy, Trash2, Users,
  UserPlus, CheckCircle2, AlertCircle, RefreshCw, Building2,
  Lock, Power, AlertTriangle, Layers, Calendar, ChevronRight, X
} from 'lucide-react';
import api from '../../../services/api';
import CompanyScopeSelector from '../../../components/common/CompanyScopeSelector';
import { useCompanyScope, extractCompanyList } from '../../../context/CompanyScopeContext';
import TemplateMatrixModal from './TemplateMatrixModal';
import RegisterTemplateUserModal from './RegisterTemplateUserModal';
import TemplateMembersDrawer from './TemplateMembersDrawer';

const RoleAccessManagement = () => {
  const { selectedOrgId, selectedCompany, companies: scopeCompanies, refetchCompanies } = useCompanyScope();

  // Data states
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [organizations, setOrganizations] = useState([]);

  // Filter & Search states
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // Modals & Action states
  const [modalMode, setModalMode] = useState(null); // 'create' | 'edit' | 'register' | 'members' | 'duplicate' | 'delete' | 'status' | null
  const [activeTemplate, setActiveTemplate] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [toast, setToast] = useState({ type: '', text: '' });

  // Secondary dialog inputs
  const [duplicateName, setDuplicateName] = useState('');
  const [statusTarget, setStatusTarget] = useState('ACTIVE');

  // Load organizations list
  const fetchOrganizations = useCallback(async () => {
    try {
      const res = await api.get('/organizations');
      const list = extractCompanyList(res.data);
      setOrganizations(Array.isArray(list) ? list : []);
    } catch (err) {
      console.error('Failed to fetch organizations list:', err);
    }
  }, []);

  useEffect(() => {
    fetchOrganizations();
  }, [fetchOrganizations]);

  useEffect(() => {
    if (Array.isArray(scopeCompanies) && scopeCompanies.length > 0) {
      setOrganizations(scopeCompanies);
    }
  }, [scopeCompanies]);

  // Fetch access templates for currently selected organization
  const fetchTemplates = useCallback(async () => {
    if (!selectedOrgId || selectedOrgId === 'all') {
      // Organization must be specifically selected
      setTemplates([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setErrorMessage('');

      const params = {
        organizationId: selectedOrgId
      };
      if (roleFilter !== 'ALL') params.role = roleFilter;
      if (statusFilter !== 'ALL') params.status = statusFilter;
      if (searchTerm.trim()) params.search = searchTerm.trim();

      const res = await api.get('/super-admin/access-templates', { params });
      const tpls = res.data?.templates || res.data || [];
      setTemplates(Array.isArray(tpls) ? tpls : []);
    } catch (err) {
      console.error('Failed to fetch access templates:', err);
      setErrorMessage(err.response?.data?.message || 'Failed to retrieve access templates for selected organization.');
    } finally {
      setLoading(false);
    }
  }, [selectedOrgId, roleFilter, statusFilter, searchTerm]);

  // Re-fetch when organization or filters change
  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const showToast = (type, text) => {
    setToast({ type, text });
    setTimeout(() => setToast({ type: '', text: '' }), 4000);
  };

  // KPI Metrics
  const metrics = useMemo(() => {
    const total = templates.length;
    const active = templates.filter((t) => t.status === 'ACTIVE').length;
    const inactive = templates.filter((t) => t.status === 'INACTIVE').length;
    const assignedMembers = templates.reduce((sum, t) => sum + (t.totalMembers || 0), 0);
    const activeMembers = templates.reduce((sum, t) => sum + (t.activeMembers || 0), 0);
    return { total, active, inactive, assignedMembers, activeMembers };
  }, [templates]);

  // --- Actions ---

  // 1. Open Create Modal
  const handleOpenCreateModal = () => {
    setActiveTemplate(null);
    setModalMode('create');
  };

  // 2. Open Edit Modal
  const handleOpenEditModal = (template) => {
    setActiveTemplate(template);
    setModalMode('edit');
  };

  // 3. Open Register User Modal
  const handleOpenRegisterModal = (template) => {
    setActiveTemplate(template);
    setModalMode('register');
  };

  // 4. Open Members Drawer
  const handleOpenMembersDrawer = (template) => {
    setActiveTemplate(template);
    setModalMode('members');
  };

  // 5. Open Duplicate Dialog
  const handleOpenDuplicate = (template) => {
    setActiveTemplate(template);
    setDuplicateName(`Copy of ${template.name}`);
    setModalMode('duplicate');
  };

  // Execute Duplicate
  const handleConfirmDuplicate = async (e) => {
    e.preventDefault();
    if (!activeTemplate || !duplicateName.trim()) return;

    try {
      setActionLoading(true);
      const res = await api.post(`/super-admin/access-templates/${activeTemplate.id}/duplicate`, {
        name: duplicateName.trim()
      });
      showToast('success', res.data?.message || `Template duplicated as '${duplicateName.trim()}'`);
      setModalMode(null);
      fetchTemplates();
    } catch (err) {
      console.error('Duplicate template failed:', err);
      showToast('error', err.response?.data?.message || 'Failed to duplicate template.');
    } finally {
      setActionLoading(false);
    }
  };

  // 6. Open Status Toggle Dialog
  const handleOpenStatusToggle = (template) => {
    setActiveTemplate(template);
    const nextStatus = template.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    setStatusTarget(nextStatus);
    setModalMode('status');
  };

  // Execute Status Toggle
  const handleConfirmStatusToggle = async () => {
    if (!activeTemplate) return;

    try {
      setActionLoading(true);
      const res = await api.put(`/super-admin/access-templates/${activeTemplate.id}/status`, {
        status: statusTarget
      });
      showToast('success', res.data?.message || `Template status changed to ${statusTarget}`);
      setModalMode(null);
      fetchTemplates();
    } catch (err) {
      console.error('Status toggle failed:', err);
      showToast('error', err.response?.data?.message || 'Failed to update template status.');
    } finally {
      setActionLoading(false);
    }
  };

  // 7. Open Delete Dialog
  const handleOpenDelete = (template) => {
    setActiveTemplate(template);
    setModalMode('delete');
  };

  // Execute Delete
  const handleConfirmDelete = async () => {
    if (!activeTemplate) return;

    if (activeTemplate.totalMembers > 0) {
      showToast('error', `Cannot delete template: ${activeTemplate.totalMembers} member(s) are assigned to it.`);
      setModalMode(null);
      return;
    }

    try {
      setActionLoading(true);
      const res = await api.delete(`/super-admin/access-templates/${activeTemplate.id}`);
      showToast('success', res.data?.message || `Template '${activeTemplate.name}' deleted.`);
      setModalMode(null);
      fetchTemplates();
    } catch (err) {
      console.error('Delete template failed:', err);
      showToast('error', err.response?.data?.message || 'Failed to delete template.');
    } finally {
      setActionLoading(false);
    }
  };

  // Handle Save Callback from Create/Edit
  const handleSaveSuccess = (saved) => {
    showToast('success', `Access template '${saved?.name || 'record'}' saved successfully.`);
    fetchTemplates();
  };

  // Handle Register Success
  const handleRegisterSuccess = (newUser) => {
    showToast('success', `User '${newUser?.name}' registered with ID: ${newUser?.employeeId}`);
    fetchTemplates();
  };

  const getRoleBadgeStyle = (role) => {
    switch (role) {
      case 'ADMIN':
        return 'bg-amber-500/10 text-amber-600 border-amber-500/20';
      case 'TEAM_LEADER':
        return 'bg-purple-500/10 text-purple-600 border-purple-500/20';
      case 'EMPLOYEE':
        return 'bg-blue-500/10 text-blue-600 border-blue-500/20';
      case 'INTERN':
        return 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20';
      default:
        return 'bg-slate-500/10 text-slate-600 border-slate-500/20';
    }
  };

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {toast.text && (
        <div className="fixed top-6 right-6 z-50 animate-in fade-in slide-in-from-top-4 duration-300">
          <div
            className={`flex items-center gap-2.5 px-4 py-3 rounded-2xl shadow-xl border text-xs font-bold ${
              toast.type === 'error'
                ? 'bg-destructive text-destructive-foreground border-destructive/20 shadow-destructive/20'
                : 'bg-emerald-600 text-white border-emerald-500/30 shadow-emerald-600/20'
            }`}
          >
            {toast.type === 'error' ? <AlertCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
            <span>{toast.text}</span>
          </div>
        </div>
      )}

      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 rounded-2xl bg-primary/10 text-primary border border-primary/20">
              <Shield className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-black tracking-tight text-foreground">
                Role-Based Access Management
              </h1>
              <p className="text-xs text-muted-foreground font-medium mt-0.5">
                Configure module permissions, save reusable role templates, and register accounts per organization.
              </p>
            </div>
          </div>
        </div>

        {/* Create Template Quick Action */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={!selectedOrgId || selectedOrgId === 'all'}
            onClick={handleOpenCreateModal}
            className="px-5 py-2.5 rounded-2xl bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-black shadow-lg shadow-primary/20 transition-all disabled:opacity-50 flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            Create Access Template
          </button>
        </div>
      </div>

      {/* Organization Scope Selector */}
      <CompanyScopeSelector allowAllCompanies={false} />

      {/* Multi-Tenant Notice if no org or "all" selected */}
      {(!selectedOrgId || selectedOrgId === 'all') ? (
        <div className="p-12 text-center rounded-3xl bg-card border border-border/60 shadow-sm space-y-4">
          <div className="h-16 w-16 mx-auto rounded-3xl bg-primary/10 text-primary border border-primary/20 flex items-center justify-center">
            <Building2 className="h-8 w-8" />
          </div>
          <div className="space-y-1.5 max-w-md mx-auto">
            <h3 className="text-base font-black text-foreground">Select an Organization to Manage Templates</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Every access template belongs strictly to one organization. Please select a specific company using the
              organization selector above to view and configure its templates.
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* KPI Metrics Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
            <div className="p-4 rounded-3xl bg-card border border-border/60 shadow-xs space-y-1">
              <span className="text-[11px] font-extrabold text-muted-foreground flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5 text-primary" /> Total Templates
              </span>
              <p className="text-2xl font-black text-foreground">{metrics.total}</p>
            </div>

            <div className="p-4 rounded-3xl bg-card border border-border/60 shadow-xs space-y-1">
              <span className="text-[11px] font-extrabold text-muted-foreground flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> Active Templates
              </span>
              <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400">{metrics.active}</p>
            </div>

            <div className="p-4 rounded-3xl bg-card border border-border/60 shadow-xs space-y-1">
              <span className="text-[11px] font-extrabold text-muted-foreground flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5 text-blue-500" /> Assigned Users
              </span>
              <p className="text-2xl font-black text-blue-600 dark:text-blue-400">
                {metrics.assignedMembers}{' '}
                <span className="text-xs text-muted-foreground font-semibold">({metrics.activeMembers} active)</span>
              </p>
            </div>

            <div className="p-4 rounded-3xl bg-card border border-border/60 shadow-xs space-y-1">
              <span className="text-[11px] font-extrabold text-muted-foreground flex items-center gap-1.5">
                <Building2 className="h-3.5 w-3.5 text-purple-500" /> Target Org
              </span>
              <p className="text-xs font-black text-foreground truncate mt-2">
                {selectedCompany?.name || organizations.find((o) => o.id === selectedOrgId)?.name || 'Selected'}
              </p>
            </div>
          </div>

          {/* Search and Filters Bar */}
          <div className="p-4 rounded-3xl bg-card border border-border/60 shadow-xs flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
            {/* Search Input */}
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search templates by name or description..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 text-xs font-medium rounded-2xl border border-border/60 bg-muted/20 focus:bg-background focus:ring-2 focus:ring-primary/20 outline-none transition"
              />
            </div>

            {/* Filter Dropdowns */}
            <div className="flex flex-wrap items-center gap-2.5">
              {/* Role Filter */}
              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-muted-foreground font-bold text-[11px]">Role:</span>
                <select
                  value={roleFilter}
                  onChange={(e) => setRoleFilter(e.target.value)}
                  className="px-3 py-1.5 rounded-xl border border-border/60 bg-muted/20 text-xs font-bold text-foreground outline-none cursor-pointer"
                >
                  <option value="ALL">All Roles</option>
                  <option value="EMPLOYEE">Employee</option>
                  <option value="TEAM_LEADER">Team Leader</option>
                  <option value="ADMIN">Admin</option>
                  <option value="INTERN">Intern</option>
                </select>
              </div>

              {/* Status Filter */}
              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-muted-foreground font-bold text-[11px]">Status:</span>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="px-3 py-1.5 rounded-xl border border-border/60 bg-muted/20 text-xs font-bold text-foreground outline-none cursor-pointer"
                >
                  <option value="ALL">All Statuses</option>
                  <option value="ACTIVE">Active</option>
                  <option value="INACTIVE">Inactive</option>
                </select>
              </div>

              {/* Refresh Button */}
              <button
                type="button"
                onClick={fetchTemplates}
                title="Reload templates"
                className="p-2 rounded-xl border border-border/60 bg-muted/20 text-muted-foreground hover:text-foreground hover:bg-muted/40 transition"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {/* Templates Display Area */}
          {errorMessage && (
            <div className="p-4 rounded-3xl bg-destructive/10 border border-destructive/20 text-destructive flex items-center justify-between gap-3 text-xs font-bold">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{errorMessage}</span>
              </div>
              <button
                type="button"
                onClick={fetchTemplates}
                className="px-3 py-1 rounded-xl bg-destructive/20 hover:bg-destructive/30 text-destructive text-[11px] font-black"
              >
                Retry
              </button>
            </div>
          )}

          {loading ? (
            <div className="p-16 rounded-3xl bg-card border border-border/60 text-center text-muted-foreground space-y-3">
              <RefreshCw className="h-8 w-8 animate-spin mx-auto text-primary" />
              <p className="text-xs font-bold">Loading templates for selected organization...</p>
            </div>
          ) : templates.length === 0 ? (
            <div className="p-16 rounded-3xl bg-card border border-dashed border-border/80 text-center space-y-4">
              <Shield className="h-10 w-10 mx-auto text-muted-foreground/40" />
              <div className="space-y-1 max-w-sm mx-auto">
                <h3 className="text-sm font-black text-foreground">No Access Templates Found</h3>
                <p className="text-xs text-muted-foreground">
                  {searchTerm || roleFilter !== 'ALL' || statusFilter !== 'ALL'
                    ? 'No templates match the current filter criteria.'
                    : 'This organization does not have any access templates configured yet.'}
                </p>
              </div>
              <button
                type="button"
                onClick={handleOpenCreateModal}
                className="px-5 py-2.5 rounded-2xl bg-primary text-primary-foreground text-xs font-black shadow-md hover:bg-primary/90 transition inline-flex items-center gap-2"
              >
                <Plus className="h-4 w-4" />
                Create First Template
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {templates.map((tpl) => (
                <div
                  key={tpl.id}
                  className="p-5 rounded-3xl bg-card border border-border/60 hover:border-border/90 hover:shadow-md transition-all flex flex-col justify-between space-y-4"
                >
                  {/* Card Header */}
                  <div className="space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <span className={`px-2.5 py-0.5 rounded-xl text-[10px] font-black border ${getRoleBadgeStyle(tpl.baseRole)}`}>
                        {tpl.baseRole}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-lg text-[10px] font-black border ${
                          tpl.status === 'ACTIVE'
                            ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
                            : 'bg-amber-500/10 text-amber-600 border-amber-500/20'
                        }`}
                      >
                        {tpl.status}
                      </span>
                    </div>

                    <div>
                      <h3 className="text-sm font-black text-foreground line-clamp-1">
                        {tpl.name}
                      </h3>
                      {tpl.description ? (
                        <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">
                          {tpl.description}
                        </p>
                      ) : (
                        <p className="text-[11px] text-muted-foreground/60 italic mt-0.5">
                          No description provided
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Card Metrics & Specs */}
                  <div className="p-3 rounded-2xl bg-muted/20 border border-border/40 grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-[10px] text-muted-foreground font-bold">Configured Modules:</span>
                      <p className="font-black text-foreground">
                        {tpl.modulesCount || tpl.permissions?.length || 0}{' '}
                        <span className="text-[10px] text-muted-foreground font-normal">/ 31</span>
                      </p>
                    </div>
                    <div>
                      <span className="text-[10px] text-muted-foreground font-bold">Assigned Users:</span>
                      <p className="font-black text-foreground">
                        {tpl.totalMembers || 0}{' '}
                        <span className="text-[10px] text-emerald-600 font-semibold">({tpl.activeMembers || 0} active)</span>
                      </p>
                    </div>
                  </div>

                  {/* Last Updated Date */}
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-1">
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      Updated {new Date(tpl.updatedAt || tpl.createdAt).toLocaleDateString()}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleOpenMembersDrawer(tpl)}
                      className="text-primary hover:underline font-bold flex items-center gap-0.5"
                    >
                      {tpl.totalMembers} Member(s)
                      <ChevronRight className="h-3 w-3" />
                    </button>
                  </div>

                  {/* Action Bar */}
                  <div className="pt-2 border-t border-border/40 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => handleOpenRegisterModal(tpl)}
                      disabled={tpl.status !== 'ACTIVE'}
                      className="px-3 py-2 rounded-xl bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 text-xs font-black transition flex items-center justify-center gap-1.5 disabled:opacity-40"
                    >
                      <UserPlus className="h-3.5 w-3.5" />
                      Register User
                    </button>

                    <button
                      type="button"
                      onClick={() => handleOpenEditModal(tpl)}
                      className="px-3 py-2 rounded-xl bg-card hover:bg-muted text-foreground border border-border/60 text-xs font-bold transition flex items-center justify-center gap-1.5"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                      Edit Matrix
                    </button>

                    {/* Secondary Actions Row */}
                    <div className="col-span-2 flex items-center justify-between gap-1 pt-1">
                      <button
                        type="button"
                        onClick={() => handleOpenDuplicate(tpl)}
                        className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-muted-foreground hover:text-foreground hover:bg-muted/40 transition flex items-center gap-1"
                        title="Duplicate Template"
                      >
                        <Copy className="h-3 w-3" />
                        Duplicate
                      </button>

                      <button
                        type="button"
                        onClick={() => handleOpenStatusToggle(tpl)}
                        className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-muted-foreground hover:text-foreground hover:bg-muted/40 transition flex items-center gap-1"
                        title={tpl.status === 'ACTIVE' ? 'Deactivate Template' : 'Activate Template'}
                      >
                        <Power className="h-3 w-3" />
                        {tpl.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleOpenDelete(tpl)}
                        className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition flex items-center gap-1 ${
                          tpl.totalMembers > 0
                            ? 'text-muted-foreground/50 hover:bg-muted/20 cursor-not-allowed'
                            : 'text-destructive hover:bg-destructive/10'
                        }`}
                        title={tpl.totalMembers > 0 ? 'Cannot delete template with assigned members' : 'Delete Template'}
                      >
                        <Trash2 className="h-3 w-3" />
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* --- MODALS & DRAWERS --- */}

      {/* 1. Template Matrix Modal (Create & Edit) */}
      <TemplateMatrixModal
        isOpen={modalMode === 'create' || modalMode === 'edit'}
        onClose={() => setModalMode(null)}
        onSave={handleSaveSuccess}
        template={activeTemplate}
        currentOrgId={selectedOrgId}
        organizations={organizations}
      />

      {/* 2. Register Template User Modal */}
      <RegisterTemplateUserModal
        isOpen={modalMode === 'register'}
        onClose={() => setModalMode(null)}
        onSuccess={handleRegisterSuccess}
        template={activeTemplate}
      />

      {/* 3. Template Assigned Members Drawer */}
      <TemplateMembersDrawer
        isOpen={modalMode === 'members'}
        onClose={() => setModalMode(null)}
        template={activeTemplate}
        onRegisterNew={(tpl) => handleOpenRegisterModal(tpl)}
      />

      {/* 4. Duplicate Template Dialog */}
      {modalMode === 'duplicate' && activeTemplate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
          <div className="w-full max-w-md bg-card border border-border shadow-2xl rounded-3xl p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-2xl bg-primary/10 text-primary border border-primary/20">
                <Copy className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-black text-foreground">Duplicate Access Template</h3>
                <p className="text-xs text-muted-foreground">Clones template permissions within the same organization.</p>
              </div>
            </div>

            <form onSubmit={handleConfirmDuplicate} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-extrabold text-foreground">New Template Name</label>
                <input
                  type="text"
                  required
                  value={duplicateName}
                  onChange={(e) => setDuplicateName(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-xs font-semibold rounded-2xl border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setModalMode(null)}
                  disabled={actionLoading}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-muted-foreground hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading || !duplicateName.trim()}
                  className="px-5 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-black shadow hover:bg-primary/90 transition disabled:opacity-50"
                >
                  {actionLoading ? 'Cloning...' : 'Confirm Duplicate'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 5. Status Toggle Confirmation Dialog */}
      {modalMode === 'status' && activeTemplate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
          <div className="w-full max-w-md bg-card border border-border shadow-2xl rounded-3xl p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-2xl bg-amber-500/10 text-amber-600 border border-amber-500/20">
                <Power className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-black text-foreground">
                  {statusTarget === 'INACTIVE' ? 'Deactivate Template?' : 'Activate Template?'}
                </h3>
                <p className="text-xs text-muted-foreground">Template: '{activeTemplate.name}'</p>
              </div>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">
              {statusTarget === 'INACTIVE'
                ? 'Deactivating this template will prevent new users from registering through it. Existing assigned members will retain their current permissions.'
                : 'Activating this template allows new user registrations using its configured module permissions.'}
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setModalMode(null)}
                disabled={actionLoading}
                className="px-4 py-2 rounded-xl text-xs font-bold text-muted-foreground hover:bg-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmStatusToggle}
                disabled={actionLoading}
                className={`px-5 py-2 rounded-xl text-white text-xs font-black shadow transition disabled:opacity-50 ${
                  statusTarget === 'INACTIVE' ? 'bg-amber-600 hover:bg-amber-700' : 'bg-emerald-600 hover:bg-emerald-700'
                }`}
              >
                {actionLoading ? 'Updating...' : `Confirm ${statusTarget}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 6. Delete Confirmation Dialog */}
      {modalMode === 'delete' && activeTemplate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
          <div className="w-full max-w-md bg-card border border-border shadow-2xl rounded-3xl p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-2xl bg-destructive/10 text-destructive border border-destructive/20">
                <Trash2 className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-black text-foreground">Delete Access Template</h3>
                <p className="text-xs text-muted-foreground">Template: '{activeTemplate.name}'</p>
              </div>
            </div>

            {activeTemplate.totalMembers > 0 ? (
              <div className="p-3.5 rounded-2xl bg-destructive/10 border border-destructive/20 text-destructive text-xs space-y-1">
                <p className="font-extrabold">Deletion Prohibited</p>
                <p className="leading-relaxed">
                  This template currently has <strong>{activeTemplate.totalMembers} assigned member(s)</strong>.
                  The backend safety policy requires all members to be reassigned before deleting a template.
                </p>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground leading-relaxed">
                Are you sure you want to permanently delete template <strong>'{activeTemplate.name}'</strong>?
                This action cannot be undone.
              </p>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setModalMode(null)}
                disabled={actionLoading}
                className="px-4 py-2 rounded-xl text-xs font-bold text-muted-foreground hover:bg-muted"
              >
                {activeTemplate.totalMembers > 0 ? 'Close' : 'Cancel'}
              </button>
              {activeTemplate.totalMembers === 0 && (
                <button
                  type="button"
                  onClick={handleConfirmDelete}
                  disabled={actionLoading}
                  className="px-5 py-2 rounded-xl bg-destructive text-destructive-foreground text-xs font-black shadow hover:bg-destructive/90 transition disabled:opacity-50"
                >
                  {actionLoading ? 'Deleting...' : 'Confirm Delete'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RoleAccessManagement;
