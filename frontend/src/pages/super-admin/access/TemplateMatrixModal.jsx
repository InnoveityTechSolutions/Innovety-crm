import React, { useState, useEffect, useMemo } from 'react';
import {
  X, Shield, Check, Eye, Edit3, Slash, AlertCircle, Info,
  Search, Sparkles, Building2, Layers, RefreshCw, AlertTriangle
} from 'lucide-react';
import api from '../../../services/api';

const PERMISSION_LEVELS = {
  NONE: 'NONE',
  VIEW: 'VIEW',
  EDIT: 'EDIT'
};

const BASE_ROLES = [
  { value: 'INTERN', label: 'Intern', color: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' },
  { value: 'EMPLOYEE', label: 'Employee', color: 'bg-blue-500/10 text-blue-600 border-blue-500/20' },
  { value: 'TEAM_LEADER', label: 'Team Leader', color: 'bg-purple-500/10 text-purple-600 border-purple-500/20' },
  { value: 'ADMIN', label: 'Admin', color: 'bg-amber-500/10 text-amber-600 border-amber-500/20' }
];

const TemplateMatrixModal = ({
  isOpen,
  onClose,
  onSave,
  template = null,
  currentOrgId = '',
  organizations = []
}) => {
  const isEditing = Boolean(template && template.id);

  // Form Fields
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [organizationId, setOrganizationId] = useState('');
  const [baseRole, setBaseRole] = useState('EMPLOYEE');
  const [permissions, setPermissions] = useState({});

  // Module Registry & Categories
  const [modules, setModules] = useState([]);
  const [loadingModules, setLoadingModules] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [moduleSearch, setModuleSearch] = useState('');

  // UI / Confirmation state
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [confirmAffectUsers, setConfirmAffectUsers] = useState(false);

  // Load modules registry on mount
  useEffect(() => {
    let isMounted = true;
    const fetchModules = async () => {
      try {
        setLoadingModules(true);
        const res = await api.get('/super-admin/access-templates/modules');
        if (isMounted && res.data?.modules) {
          setModules(res.data.modules);
        }
      } catch (err) {
        console.error('Failed to load CRM modules registry:', err);
        if (isMounted) {
          setErrorMessage('Failed to load CRM modules registry. Please retry.');
        }
      } finally {
        if (isMounted) setLoadingModules(false);
      }
    };

    if (isOpen) {
      fetchModules();
    }

    return () => { isMounted = false; };
  }, [isOpen]);

  // Initialize or reset form values
  useEffect(() => {
    if (!isOpen) return;

    if (isEditing && template) {
      setName(template.name || '');
      setDescription(template.description || '');
      setOrganizationId(template.organizationId || currentOrgId || '');
      setBaseRole(template.baseRole || 'EMPLOYEE');

      // Populate permissions from template
      const permMap = {};
      if (Array.isArray(template.permissions)) {
        template.permissions.forEach((p) => {
          permMap[p.moduleKey] = p.accessLevel;
        });
      }
      // Ensure universal self-service for profile
      permMap.profile = PERMISSION_LEVELS.EDIT;
      setPermissions(permMap);
    } else {
      // Create Mode
      setName('');
      setDescription('');
      setOrganizationId(currentOrgId || (organizations[0]?.id || ''));
      setBaseRole('EMPLOYEE');
      setPermissions({ profile: PERMISSION_LEVELS.EDIT });
    }

    setConfirmAffectUsers(false);
    setErrorMessage('');
    setModuleSearch('');
    setSelectedCategory('ALL');
  }, [isOpen, template, currentOrgId, organizations, isEditing]);

  // Apply default role baseline
  const handleApplyRoleBaseline = (roleToApply = baseRole) => {
    if (!modules.length) return;

    const newPermMap = {};
    modules.forEach((mod) => {
      if (mod.key === 'profile') {
        newPermMap[mod.key] = PERMISSION_LEVELS.EDIT;
      } else if (mod.roleBaselines && mod.roleBaselines[roleToApply]) {
        newPermMap[mod.key] = mod.roleBaselines[roleToApply];
      } else {
        newPermMap[mod.key] = PERMISSION_LEVELS.NONE;
      }
    });

    setPermissions(newPermMap);
  };

  // When changing baseRole in Create mode, auto-apply baseline if permissions are empty
  const handleBaseRoleChange = (newRole) => {
    setBaseRole(newRole);
    if (!isEditing) {
      handleApplyRoleBaseline(newRole);
    }
  };

  // Grouped Categories
  const categories = useMemo(() => {
    const cats = new Set();
    modules.forEach((m) => {
      if (m.category) cats.add(m.category);
    });
    return Array.from(cats);
  }, [modules]);

  // Filtered Modules
  const filteredModules = useMemo(() => {
    return modules.filter((m) => {
      const matchesCategory = selectedCategory === 'ALL' || m.category === selectedCategory;
      const matchesSearch = !moduleSearch.trim() ||
        m.displayName.toLowerCase().includes(moduleSearch.toLowerCase()) ||
        m.key.toLowerCase().includes(moduleSearch.toLowerCase()) ||
        (m.description && m.description.toLowerCase().includes(moduleSearch.toLowerCase()));
      return matchesCategory && matchesSearch;
    });
  }, [modules, selectedCategory, moduleSearch]);

  // Permission Stats
  const stats = useMemo(() => {
    let viewCount = 0;
    let editCount = 0;
    let noneCount = 0;

    modules.forEach((m) => {
      const level = permissions[m.key] || PERMISSION_LEVELS.NONE;
      if (level === PERMISSION_LEVELS.EDIT) editCount++;
      else if (level === PERMISSION_LEVELS.VIEW) viewCount++;
      else noneCount++;
    });

    return { viewCount, editCount, noneCount, total: modules.length };
  }, [modules, permissions]);

  // Set single module permission
  const handleSetModulePermission = (moduleKey, level) => {
    if (moduleKey === 'profile') return; // Universal self-service cannot be revoked
    setPermissions((prev) => ({
      ...prev,
      [moduleKey]: level
    }));
  };

  // Category bulk setter
  const handleBulkSetCategory = (categoryName, level) => {
    setPermissions((prev) => {
      const updated = { ...prev };
      modules
        .filter((m) => m.category === categoryName && m.key !== 'profile')
        .forEach((m) => {
          updated[m.key] = level;
        });
      return updated;
    });
  };

  // Form Submit
  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage('');

    if (!name.trim()) {
      setErrorMessage('Template name is required.');
      return;
    }

    if (!organizationId) {
      setErrorMessage('A valid organization must be selected.');
      return;
    }

    // Require confirmation if editing a template with assigned members
    if (isEditing && (template?.totalMembers > 0) && !confirmAffectUsers) {
      setConfirmAffectUsers(true);
      return;
    }

    // Format permissions payload
    const permissionsPayload = Object.entries(permissions)
      .filter(([key, level]) => level === PERMISSION_LEVELS.VIEW || level === PERMISSION_LEVELS.EDIT)
      .map(([moduleKey, accessLevel]) => ({
        moduleKey,
        accessLevel
      }));

    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      baseRole,
      organizationId,
      permissions: permissionsPayload
    };

    try {
      setSubmitting(true);
      let response;
      if (isEditing) {
        response = await api.put(`/super-admin/access-templates/${template.id}`, payload);
      } else {
        response = await api.post('/super-admin/access-templates', payload);
      }

      if (onSave) {
        onSave(response.data?.template || response.data);
      }
      onClose();
    } catch (err) {
      console.error('Failed to save access template:', err);
      const apiMsg = err.response?.data?.message || 'Failed to save access template. Please verify input fields.';
      setErrorMessage(apiMsg);
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-background/80 backdrop-blur-md overflow-y-auto">
      <div className="relative w-full max-w-5xl my-6 bg-card border border-border/80 shadow-2xl rounded-3xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Modal Header */}
        <div className="px-6 py-5 border-b border-border/60 flex items-center justify-between bg-muted/20">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-primary/10 text-primary border border-primary/20">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-black tracking-tight text-foreground">
                {isEditing ? `Edit Access Template: ${template?.name}` : 'Create New Access Template'}
              </h2>
              <p className="text-xs text-muted-foreground font-medium">
                {isEditing
                  ? 'Update module permissions for dynamic live inheritance by assigned members.'
                  : 'Define reusable role permissions for an organization and assign to members.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-2xl text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
          {errorMessage && (
            <div className="p-4 rounded-2xl bg-destructive/10 border border-destructive/20 text-destructive flex items-center gap-3 text-xs font-bold">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Assigned Members Warning Banner */}
          {isEditing && (template?.totalMembers > 0) && (
            <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400 flex items-start gap-3 text-xs">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-extrabold text-sm">Active Member Assignment Notice</p>
                <p className="mt-0.5 font-medium leading-relaxed">
                  This template is actively assigned to{' '}
                  <span className="font-black underline">{template.totalMembers} user(s)</span>{' '}
                  ({template.activeMembers} active). Any permissions granted or revoked here take effect
                  immediately on their subsequent API requests.
                </p>
              </div>
            </div>
          )}

          {/* Section 1: Template Metadata */}
          <div className="p-5 rounded-3xl bg-muted/20 border border-border/60 space-y-4">
            <h3 className="text-xs font-black uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <Layers className="h-3.5 w-3.5 text-primary" />
              General Template Information
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Template Name */}
              <div className="sm:col-span-2 space-y-1.5">
                <label className="text-xs font-extrabold text-foreground">
                  Template Name <span className="text-destructive">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Senior Software Engineer - Core Modules"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-4 py-2.5 text-xs font-semibold rounded-2xl border border-border/60 bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary/50 outline-none transition"
                />
              </div>

              {/* Organization Selection */}
              <div className="space-y-1.5">
                <label className="text-xs font-extrabold text-foreground flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5 text-primary" />
                  Organization <span className="text-destructive">*</span>
                </label>
                <select
                  disabled={isEditing}
                  value={organizationId}
                  onChange={(e) => setOrganizationId(e.target.value)}
                  className="w-full px-4 py-2.5 text-xs font-semibold rounded-2xl border border-border/60 bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary/50 outline-none transition disabled:opacity-60 cursor-pointer"
                >
                  {organizations.map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.name || org.companyName} ({org.companyCode || 'ORG'})
                    </option>
                  ))}
                </select>
                {isEditing && (
                  <p className="text-[10px] text-muted-foreground">Organization is immutable after creation.</p>
                )}
              </div>

              {/* Base System Role */}
              <div className="space-y-1.5">
                <label className="text-xs font-extrabold text-foreground">
                  Base System Role <span className="text-destructive">*</span>
                </label>
                <select
                  value={baseRole}
                  onChange={(e) => handleBaseRoleChange(e.target.value)}
                  className="w-full px-4 py-2.5 text-xs font-bold rounded-2xl border border-border/60 bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary/50 outline-none transition cursor-pointer"
                >
                  {BASE_ROLES.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Description */}
              <div className="sm:col-span-2 space-y-1.5">
                <label className="text-xs font-extrabold text-foreground">
                  Description <span className="text-muted-foreground font-normal">(Optional)</span>
                </label>
                <input
                  type="text"
                  placeholder="Brief summary of duties or squad assignments granted by this template..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-4 py-2.5 text-xs font-medium rounded-2xl border border-border/60 bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary/50 outline-none transition"
                />
              </div>
            </div>

            {/* Role Baseline Helper */}
            <div className="pt-2 flex flex-wrap items-center justify-between gap-3 border-t border-border/40">
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                <span>Selected Base Role: <strong className="text-foreground">{baseRole}</strong></span>
              </div>
              <button
                type="button"
                onClick={() => handleApplyRoleBaseline(baseRole)}
                className="px-3 py-1.5 rounded-xl bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 text-xs font-black flex items-center gap-1.5 transition-all"
              >
                <RefreshCw className="h-3 w-3" />
                Apply {baseRole} Baseline Permissions
              </button>
            </div>
          </div>

          {/* Section 2: Module Permission Matrix */}
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-xs font-black uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                  <Shield className="h-3.5 w-3.5 text-primary" />
                  Granular Module Access Matrix ({stats.total} Operational Modules)
                </h3>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Select permission level per operational module. Missing permissions default to No Access.
                </p>
              </div>

              {/* Matrix Live Counters */}
              <div className="flex items-center gap-2 text-xs font-black">
                <span className="px-2.5 py-1 rounded-xl bg-slate-500/10 text-slate-600 dark:text-slate-400 border border-slate-500/20">
                  {stats.noneCount} None
                </span>
                <span className="px-2.5 py-1 rounded-xl bg-blue-500/10 text-blue-600 border border-blue-500/20">
                  {stats.viewCount} View
                </span>
                <span className="px-2.5 py-1 rounded-xl bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                  {stats.editCount} Edit
                </span>
              </div>
            </div>

            {/* Filter & Search Bar */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
              {/* Category Pills */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 max-w-full">
                <button
                  type="button"
                  onClick={() => setSelectedCategory('ALL')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all shrink-0 ${
                    selectedCategory === 'ALL'
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'bg-muted/40 text-muted-foreground hover:bg-muted/70'
                  }`}
                >
                  All ({modules.length})
                </button>
                {categories.map((cat) => {
                  const catCount = modules.filter((m) => m.category === cat).length;
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setSelectedCategory(cat)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all shrink-0 ${
                        selectedCategory === cat
                          ? 'bg-primary text-primary-foreground shadow-sm'
                          : 'bg-muted/40 text-muted-foreground hover:bg-muted/70'
                      }`}
                    >
                      {cat} ({catCount})
                    </button>
                  );
                })}
              </div>

              {/* Module Search */}
              <div className="relative min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Filter modules..."
                  value={moduleSearch}
                  onChange={(e) => setModuleSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 text-xs font-medium rounded-xl border border-border/60 bg-background focus:ring-2 focus:ring-primary/20 outline-none"
                />
              </div>
            </div>

            {/* Modules List by Category */}
            {loadingModules ? (
              <div className="p-12 text-center text-muted-foreground space-y-2">
                <RefreshCw className="h-6 w-6 animate-spin mx-auto text-primary" />
                <p className="text-xs font-bold">Loading operational CRM modules registry...</p>
              </div>
            ) : filteredModules.length === 0 ? (
              <div className="p-8 text-center border border-dashed border-border rounded-2xl text-muted-foreground text-xs">
                No modules match your current filter.
              </div>
            ) : (
              <div className="space-y-4">
                {categories
                  .filter((cat) => selectedCategory === 'ALL' || selectedCategory === cat)
                  .map((category) => {
                    const catModules = filteredModules.filter((m) => m.category === category);
                    if (catModules.length === 0) return null;

                    return (
                      <div
                        key={category}
                        className="rounded-3xl border border-border/60 bg-muted/10 overflow-hidden shadow-sm"
                      >
                        {/* Category Header */}
                        <div className="px-5 py-3 bg-muted/30 border-b border-border/40 flex items-center justify-between">
                          <span className="text-xs font-black tracking-wide text-foreground">
                            {category}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleBulkSetCategory(category, PERMISSION_LEVELS.NONE)}
                              className="px-2 py-1 rounded-lg text-[10px] font-bold text-muted-foreground hover:bg-muted/60 transition"
                            >
                              Clear (None)
                            </button>
                            <button
                              type="button"
                              onClick={() => handleBulkSetCategory(category, PERMISSION_LEVELS.VIEW)}
                              className="px-2 py-1 rounded-lg text-[10px] font-bold text-blue-600 hover:bg-blue-500/10 transition"
                            >
                              Set All View
                            </button>
                            <button
                              type="button"
                              onClick={() => handleBulkSetCategory(category, PERMISSION_LEVELS.EDIT)}
                              className="px-2 py-1 rounded-lg text-[10px] font-bold text-emerald-600 hover:bg-emerald-500/10 transition"
                            >
                              Set All Edit
                            </button>
                          </div>
                        </div>

                        {/* Modules Table / Rows */}
                        <div className="divide-y divide-border/40">
                          {catModules.map((mod) => {
                            const currentLevel = mod.key === 'profile'
                              ? PERMISSION_LEVELS.EDIT
                              : (permissions[mod.key] || PERMISSION_LEVELS.NONE);
                            const isProfile = mod.key === 'profile';

                            return (
                              <div
                                key={mod.key}
                                className="px-5 py-3.5 flex flex-col md:flex-row md:items-center justify-between gap-3 hover:bg-muted/20 transition-colors"
                              >
                                {/* Module Info */}
                                <div className="space-y-0.5 flex-1 pr-4">
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs font-black text-foreground">
                                      {mod.displayName}
                                    </span>
                                    <code className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">
                                      {mod.key}
                                    </code>
                                    {isProfile && (
                                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 font-black">
                                        Universal Self-Service
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-[11px] text-muted-foreground line-clamp-1">
                                    {mod.description}
                                  </p>
                                </div>

                                {/* Segmented Permission Choices */}
                                <div className="flex items-center gap-1.5 shrink-0 self-start md:self-auto">
                                  {isProfile ? (
                                    <span className="px-3 py-1.5 rounded-xl bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 text-xs font-black flex items-center gap-1.5">
                                      <Check className="h-3.5 w-3.5" />
                                      Guaranteed Self-Service
                                    </span>
                                  ) : (
                                    <>
                                      {/* NONE Pill */}
                                      <button
                                        type="button"
                                        onClick={() => handleSetModulePermission(mod.key, PERMISSION_LEVELS.NONE)}
                                        className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all flex items-center gap-1 ${
                                          currentLevel === PERMISSION_LEVELS.NONE
                                            ? 'bg-slate-500 text-white shadow-sm'
                                            : 'bg-muted/40 text-muted-foreground hover:bg-muted/70'
                                        }`}
                                      >
                                        <Slash className="h-3 w-3" />
                                        No Access
                                      </button>

                                      {/* VIEW Pill */}
                                      <button
                                        type="button"
                                        onClick={() => handleSetModulePermission(mod.key, PERMISSION_LEVELS.VIEW)}
                                        className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all flex items-center gap-1 ${
                                          currentLevel === PERMISSION_LEVELS.VIEW
                                            ? 'bg-blue-600 text-white shadow-sm'
                                            : 'bg-muted/40 text-muted-foreground hover:bg-muted/70'
                                        }`}
                                      >
                                        <Eye className="h-3 w-3" />
                                        View
                                      </button>

                                      {/* EDIT Pill */}
                                      <button
                                        type="button"
                                        onClick={() => handleSetModulePermission(mod.key, PERMISSION_LEVELS.EDIT)}
                                        className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all flex items-center gap-1 ${
                                          currentLevel === PERMISSION_LEVELS.EDIT
                                            ? 'bg-emerald-600 text-white shadow-sm'
                                            : 'bg-muted/40 text-muted-foreground hover:bg-muted/70'
                                        }`}
                                      >
                                        <Edit3 className="h-3 w-3" />
                                        Edit
                                      </button>
                                    </>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>

          {/* Confirmation Overlay if assigned members exist */}
          {confirmAffectUsers && (
            <div className="p-5 rounded-3xl bg-amber-500/10 border-2 border-amber-500/40 text-foreground space-y-3">
              <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 font-black text-sm">
                <AlertTriangle className="h-5 w-5" />
                <span>Confirm Immediate Permission Overwrite</span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                You are about to save changes to template <strong>'{template?.name}'</strong>. This will
                immediately change the operational privileges of{' '}
                <strong className="text-foreground">{template?.totalMembers} registered account(s)</strong> across the CRM.
              </p>
              <div className="flex items-center gap-3 pt-1">
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 rounded-2xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-black shadow transition disabled:opacity-50"
                >
                  {submitting ? 'Updating...' : 'Yes, Apply Changes to Assigned Users'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmAffectUsers(false)}
                  className="px-4 py-2 rounded-2xl bg-muted/60 hover:bg-muted text-muted-foreground text-xs font-bold transition"
                >
                  Back to Review
                </button>
              </div>
            </div>
          )}

          {/* Modal Footer */}
          <div className="pt-4 border-t border-border/60 flex items-center justify-between">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-5 py-2.5 rounded-2xl text-xs font-bold text-muted-foreground hover:bg-muted/50 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || confirmAffectUsers}
              className="px-6 py-2.5 rounded-2xl bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-black shadow-lg shadow-primary/20 transition-all disabled:opacity-50 flex items-center gap-2"
            >
              {submitting ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Saving Template...
                </>
              ) : (
                <>
                  <Check className="h-4 w-4" />
                  {isEditing ? 'Save Template Changes' : 'Create Access Template'}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default TemplateMatrixModal;
