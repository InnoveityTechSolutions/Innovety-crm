import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Building2, Plus, Search, Edit2, ShieldCheck, CheckCircle2, XCircle,
  RefreshCw, AlertTriangle, AlertCircle, Eye, Globe, Mail, Phone, MapPin, Clock, X,
  Lock, ArrowRight, Upload, Info, Cog, Palette, Check, Key, Users, FolderKanban,
  ClipboardList, FileText, MessageSquare, HeartPulse, HardDrive, Zap, Crown, Award, Activity, Trash2, Briefcase, Layers, Save, ArrowUp, ArrowDown
} from 'lucide-react';
import api, { getUploadUrl } from '../../../services/api';
import { useAuth } from '../../../context/AuthContext';
import CompanyProvisionSuccessModal from '../../../components/organization/CompanyProvisionSuccessModal';
import SubscriptionBadge from '../../../components/organization/SubscriptionBadge';
import StorageUsageBar from '../../../components/organization/StorageUsageBar';
import OrganizationUsageCard from '../../../components/organization/OrganizationUsageCard';
import TenantAuditTimeline from '../../../components/organization/TenantAuditTimeline';
import UserAvatar from '../../../components/common/UserAvatar';
import CompanyScopeSelector from '../../../components/common/CompanyScopeSelector';
import ShiftManager from '../../../components/organization/ShiftManager';
import BranchManager from '../../../components/enterprise/BranchManager';

import { useCompanyScope } from '../../../context/CompanyScopeContext';
import { formatWorkingHoursRange } from '../../../utils/attendanceFormatter';

const OrganizationManager = () => {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const { selectedOrgId, setSelectedOrgId, companies: scopeCompanies } = useCompanyScope();

  // Navigation Tab State
  const [activeTab, setActiveTab] = useState('positions');

  // Company / Organization Management State
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedCompany, setSelectedCompany] = useState(null);

  // Modals & Drawers State
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [viewDrawerOpen, setViewDrawerOpen] = useState(false);
  const [provisionSuccessOpen, setProvisionSuccessOpen] = useState(false);
  const [provisionModalData, setProvisionModalData] = useState(null);
  const [drawerTab, setDrawerTab] = useState('overview');
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [loadingSettings, setLoadingSettings] = useState(false);
  const [selectedCompanySettings, setSelectedCompanySettings] = useState(null);
  const [companyStats, setCompanyStats] = useState(null);
  const [platformHealth, setPlatformHealth] = useState(null);
  const [plans, setPlans] = useState([]);

  // Tenant-Specific Chat Access Control State
  const [tenantChatAdmins, setTenantChatAdmins] = useState(true);
  const [tenantChatUsers, setTenantChatUsers] = useState(true);
  const [showTenantChatModal, setShowTenantChatModal] = useState(false);
  const [pendingTenantChatToggleRole, setPendingTenantChatToggleRole] = useState(null);
  const [savingTenantChat, setSavingTenantChat] = useState(false);

  // Company Settings Form State
  const [settingsData, setSettingsData] = useState({
    companyName: '',
    primaryColor: '#10B981',
    timezone: 'Asia/Kolkata',
    clockInTime: '09:00',
    clockOutTime: '18:00',
    autoClockOutEnabled: true
  });
  const [settingsLogoFile, setSettingsLogoFile] = useState(null);
  const [settingsLogoPreview, setSettingsLogoPreview] = useState(null);

  // Companies Filter & Search State
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // Positions Master State
  const [positions, setPositions] = useState([]);
  const [posLoading, setPosLoading] = useState(false);
  const [posSearch, setPosSearch] = useState('');
  const [posStatusFilter, setPosStatusFilter] = useState('ALL');
  const [posModalOpen, setPosModalOpen] = useState(false);
  const [editingPos, setEditingPos] = useState(null);
  const [posForm, setPosForm] = useState({
    name: '',
    code: '',
    level: 1,
    color: '#10B981',
    textColor: '#FFFFFF',
    icon: 'Award',
    status: 'ACTIVE'
  });

  // Departments Master State
  const [departments, setDepartments] = useState([]);
  const [deptLoading, setDeptLoading] = useState(false);
  const [deptSearch, setDeptSearch] = useState('');
  const [deptStatusFilter, setDeptStatusFilter] = useState('ALL');

  // Shifts Master State
  const [shiftsCount, setShiftsCount] = useState(0);
  const [deptModalOpen, setDeptModalOpen] = useState(false);
  const [editingDept, setEditingDept] = useState(null);
  const [deptForm, setDeptForm] = useState({
    name: '',
    code: '',
    status: 'ACTIVE'
  });

  // Department Member Staging Editor State
  const [selectedDepartment, setSelectedDepartment] = useState(null);
  const [editDeptName, setEditDeptName] = useState('');
  const [editDeptCode, setEditDeptCode] = useState('');
  const [originalDeptMemberIds, setOriginalDeptMemberIds] = useState([]);
  const [stagedAssignedMembers, setStagedAssignedMembers] = useState([]);
  const [stagedUnassignedMembers, setStagedUnassignedMembers] = useState([]);
  const [addMemberSearch, setAddMemberSearch] = useState('');
  const [assignedMemberSearch, setAssignedMemberSearch] = useState('');
  const [membersLoading, setMembersLoading] = useState(false);
  const [saveDeptLoading, setSaveDeptLoading] = useState(false);
  const [deleteDeptModal, setDeleteDeptModal] = useState({ open: false, dept: null, memberCount: 0 });

  // Delete Organization State
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [companyToDelete, setCompanyToDelete] = useState(null);
  const [companyToDeleteStats, setCompanyToDeleteStats] = useState(null);
  const [deleteErrorData, setDeleteErrorData] = useState(null);
  const [deletingCompany, setDeletingCompany] = useState(false);
  const [confirmDeleteText, setConfirmDeleteText] = useState('');

  // Multi-Admin Queuing State for Create Company Flow
  const [queuedAdmins, setQueuedAdmins] = useState([]);
  const [showAddAdminModal, setShowAddAdminModal] = useState(false);
  const [newAdminData, setNewAdminData] = useState({
    name: '',
    email: '',
    phone: '',
    password: 'AdminPassword@123',
    department: 'Administration',
    designation: 'System Administrator',
    status: 'ACTIVE'
  });

  // Form State
  const [formData, setFormData] = useState({
    name: '',
    companyCode: '',
    email: '',
    phone: '',
    website: '',
    address: '',
    timezone: 'Asia/Kolkata'
  });
  const [logoFile, setLogoFile] = useState(null);
  const [logoPreview, setLogoPreview] = useState(null);
  const [slugPreview, setSlugPreview] = useState('');

  // Notification Alert
  const [alert, setAlert] = useState(null);

  const showAlert = (type, text) => {
    setAlert({ type, text });
    setTimeout(() => setAlert(null), 5000);
  };

  const handleOpenAddAdminModal = () => {
    setNewAdminData({
      name: '',
      email: '',
      phone: '',
      password: 'AdminPassword@123',
      department: 'Administration',
      designation: 'System Administrator',
      status: 'ACTIVE'
    });
    setShowAddAdminModal(true);
  };

  const handleAddAdminToQueue = (e) => {
    e.preventDefault();
    if (!newAdminData.name.trim() || !newAdminData.email.trim() || !newAdminData.password) {
      showAlert('error', 'Full Name, Email, and Initial Password are required.');
      return;
    }

    const emailExists = queuedAdmins.some(
      (a) => a.email.toLowerCase() === newAdminData.email.trim().toLowerCase()
    );
    if (emailExists) {
      showAlert('error', `Admin with email "${newAdminData.email}" is already added.`);
      return;
    }

    setQueuedAdmins((prev) => [
      ...prev,
      {
        name: newAdminData.name.trim(),
        email: newAdminData.email.trim().toLowerCase(),
        phone: newAdminData.phone ? newAdminData.phone.trim() : null,
        password: newAdminData.password,
        department: newAdminData.department ? newAdminData.department.trim() : 'Administration',
        designation: newAdminData.designation ? newAdminData.designation.trim() : 'System Administrator',
        status: newAdminData.status || 'ACTIVE'
      }
    ]);

    setShowAddAdminModal(false);
  };

  const handleRemoveQueuedAdmin = (index) => {
    setQueuedAdmins((prev) => prev.filter((_, i) => i !== index));
  };

  const fetchCompanies = async () => {
    try {
      setLoading(true);
      const [companiesRes, healthRes, plansRes] = await Promise.all([
        api.get('/organizations', { params: { search, status: statusFilter } }).catch((err) => ({ error: err })),
        api.get('/organizations/platform/health').catch(() => null),
        api.get('/subscriptions/plans').catch(() => null)
      ]);

      if (companiesRes && !companiesRes.error) {
        const rawCompanies =
          (Array.isArray(companiesRes.data?.data) && companiesRes.data.data) ||
          (Array.isArray(companiesRes.data?.organizations) && companiesRes.data.organizations) ||
          (Array.isArray(companiesRes.data?.companies) && companiesRes.data.companies) ||
          (Array.isArray(companiesRes.data) && companiesRes.data) ||
          [];
        setCompanies(rawCompanies);

        if (rawCompanies.length > 0 && !selectedOrgId) {
          const userOrg = rawCompanies.find((c) => c.id === user?.organizationId);
          const defaultOrgId = userOrg ? userOrg.id : rawCompanies[0].id;
          setSelectedOrgId(defaultOrgId);
          fetchPositions(defaultOrgId);
          fetchDepartments(defaultOrgId);
          fetchShiftsCount(defaultOrgId);
        }
      } else if (companiesRes?.error) {
        console.error('Error fetching companies:', companiesRes.error);
        showAlert('error', companiesRes.error.response?.data?.message || 'Failed to fetch companies.');
      }

      if (healthRes?.data?.health) setPlatformHealth(healthRes.data.health);
      if (plansRes?.data?.data) setPlans(plansRes.data.data);
    } catch (err) {
      console.error('Error fetching companies:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleChangeSubscriptionPlan = async (companyId, newPlanCode) => {
    try {
      const res = await api.put(`/organizations/${companyId}/subscription`, { planCode: newPlanCode });
      if (res.data?.success) {
        showAlert('success', res.data?.message || 'Subscription plan updated.');
        fetchCompanies();
        if (selectedCompany && selectedCompany.id === companyId) {
          setSelectedCompany(res.data.data);
        }
      }
    } catch (err) {
      showAlert('error', err.response?.data?.message || 'Failed to update plan.');
    }
  };

  const fetchPositions = async (targetOrgId) => {
    const orgId = targetOrgId !== undefined ? targetOrgId : selectedOrgId;
    try {
      setPosLoading(true);
      const res = await api.get('/positions', { params: { organizationId: orgId } });
      setPositions(res.data || []);
    } catch (err) {
      console.error('Failed to fetch positions:', err);
    } finally {
      setPosLoading(false);
    }
  };

  const fetchDepartments = async (targetOrgId) => {
    const orgId = targetOrgId !== undefined ? targetOrgId : selectedOrgId;
    try {
      setDeptLoading(true);
      const res = await api.get('/organization/departments', { params: { organizationId: orgId } });
      setDepartments(res.data || []);
    } catch (err) {
      console.error('Failed to fetch departments:', err);
    } finally {
      setDeptLoading(false);
    }
  };

  const fetchShiftsCount = async (targetOrgId) => {
    const orgId = targetOrgId !== undefined ? targetOrgId : selectedOrgId;
    if (!orgId) return;
    try {
      const res = await api.get('/shifts', { params: { organizationId: orgId } });
      if (res.data?.success && Array.isArray(res.data.shifts)) {
        setShiftsCount(res.data.shifts.length);
      }
    } catch (err) {
      console.error('Failed to fetch shifts count:', err);
    }
  };

  useEffect(() => {
    fetchCompanies();
    if (selectedOrgId) {
      setPositions([]);
      fetchPositions(selectedOrgId);
      fetchDepartments(selectedOrgId);
      fetchShiftsCount(selectedOrgId);
    }
  }, [search, statusFilter, selectedOrgId]);

  // Position Master Handlers
  const handleOpenPosModal = (pos = null) => {
    if (pos) {
      setEditingPos(pos);
      setPosForm({
        name: pos.name,
        code: pos.code,
        level: pos.level,
        color: pos.color || '#10B981',
        textColor: pos.textColor || '#FFFFFF',
        icon: pos.icon || 'Award',
        status: pos.status || 'ACTIVE'
      });
    } else {
      setEditingPos(null);
      const nextLevel = positions.length > 0 ? Math.max(...positions.map((p) => parseInt(p.level, 10) || 0)) + 1 : 1;
      setPosForm({
        name: '',
        code: '',
        level: nextLevel,
        color: '#10B981',
        textColor: '#FFFFFF',
        icon: 'Award',
        status: 'ACTIVE'
      });
    }
    setPosModalOpen(true);
  };

  const handleSavePosition = async (e) => {
    e.preventDefault();
    if (!posForm.name.trim() || !posForm.code.trim() || posForm.level === undefined || posForm.level === null) {
      showAlert('error', 'Position Name, Code, and Hierarchy Level are required.');
      return;
    }

    try {
      setSubmitting(true);
      let res;
      const payload = {
        ...posForm,
        level: parseInt(posForm.level, 10),
        organizationId: selectedOrgId
      };
      if (editingPos) {
        res = await api.put(`/positions/${editingPos.id}`, payload, { params: { organizationId: selectedOrgId } });
        showAlert('success', `Position "${posForm.name}" updated successfully.`);
      } else {
        res = await api.post('/positions', payload, { params: { organizationId: selectedOrgId } });
        showAlert('success', `Position "${posForm.name}" created successfully.`);
      }

      if (res && res.data) {
        const savedPos = res.data;
        if (editingPos) {
          setPositions((prev) =>
            prev.map((p) => (p.id === editingPos.id ? { ...p, ...savedPos } : p))
          );
        } else {
          setPositions((prev) => [...prev, savedPos]);
        }
      }
      setPosModalOpen(false);
      await fetchPositions(selectedOrgId);
    } catch (err) {
      showAlert('error', err.response?.data?.message || 'Failed to save position.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleMovePosition = async (index, direction) => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= positions.length) return;

    const newPositions = [...positions];
    const temp = newPositions[index];
    newPositions[index] = newPositions[targetIndex];
    newPositions[targetIndex] = temp;

    // Optimistic UI update
    setPositions(newPositions);

    const items = newPositions.map((pos, idx) => ({
      id: pos.id,
      level: idx + 1,
      sortOrder: idx + 1
    }));

    try {
      const res = await api.put('/positions/reorder', {
        organizationId: selectedOrgId,
        items
      });
      if (res.data && Array.isArray(res.data)) {
        setPositions(res.data);
      }
    } catch (err) {
      console.error('Failed to persist position order:', err);
      showAlert('error', err.response?.data?.message || 'Failed to save position order.');
      fetchPositions(selectedOrgId);
    }
  };

  const getHierarchyBadgeStyle = (pos) => {
    const nameLower = (pos.name || '').toLowerCase();
    const level = pos.level || 1;

    if (nameLower.includes('intern')) {
      return { bg: 'bg-purple-500/10', text: 'text-purple-600', border: 'border-purple-500/20', label: `Level ${level} • Intern` };
    }
    if (nameLower.includes('junior')) {
      return { bg: 'bg-blue-500/10', text: 'text-blue-600', border: 'border-blue-500/20', label: `Level ${level} • Junior` };
    }
    if (nameLower.includes('associate')) {
      return { bg: 'bg-teal-500/10', text: 'text-teal-600', border: 'border-teal-500/20', label: `Level ${level} • Associate` };
    }
    if (nameLower.includes('senior') || nameLower.includes('snr') || nameLower.includes('sr')) {
      return { bg: 'bg-amber-500/10', text: 'text-amber-600', border: 'border-amber-500/20', label: `Level ${level} • Senior` };
    }
    if (nameLower.includes('lead') || nameLower.includes('head')) {
      return { bg: 'bg-indigo-500/10', text: 'text-indigo-600', border: 'border-indigo-500/20', label: `Level ${level} • Lead` };
    }
    if (nameLower.includes('manager') || nameLower.includes('director') || nameLower.includes('admin') || level === 1) {
      return { bg: 'bg-emerald-500/10', text: 'text-emerald-600', border: 'border-emerald-500/20', label: `Level ${level} • Manager` };
    }

    return { bg: 'bg-emerald-500/10', text: 'text-emerald-600', border: 'border-emerald-500/20', label: `Level ${level}` };
  };

  const handleTogglePosStatus = async (pos) => {
    try {
      const res = await api.patch(
        `/positions/${pos.id}/status`,
        { status: pos.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE', organizationId: selectedOrgId },
        { params: { organizationId: selectedOrgId } }
      );
      showAlert('success', res.data?.message || 'Position status updated.');
      fetchPositions(selectedOrgId);
    } catch (err) {
      showAlert('error', err.response?.data?.message || 'Failed to update position status.');
    }
  };

  const handleDeletePos = async (pos) => {
    if (!window.confirm(`Are you sure you want to delete position "${pos.name}"?`)) return;
    try {
      await api.delete(`/positions/${pos.id}`, { params: { organizationId: selectedOrgId } });
      showAlert('success', `Position "${pos.name}" deleted successfully.`);
      setPositions((prev) => prev.filter((p) => p.id !== pos.id));
      await fetchPositions(selectedOrgId);
    } catch (err) {
      showAlert('error', err.response?.data?.message || 'Failed to delete position.');
    }
  };

  // Department Master Handlers
  const handleOpenCreateDeptModal = () => {
    setEditingDept(null);
    setDeptForm({ name: '', code: '', description: '', status: 'ACTIVE' });
    setDeptModalOpen(true);
  };

  const handleSaveDepartment = async (e) => {
    e.preventDefault();
    if (!deptForm.name.trim() || !deptForm.code.trim()) {
      showAlert('error', 'Department Name and Code are required.');
      return;
    }

    try {
      setSubmitting(true);
      if (editingDept) {
        await api.put(`/organization/departments/${editingDept.id}`, {
          ...deptForm,
          organizationId: selectedOrgId
        });
        showAlert('success', `Department "${deptForm.name}" updated successfully.`);
      } else {
        await api.post('/organization/departments', {
          ...deptForm,
          organizationId: selectedOrgId
        });
        showAlert('success', `Department "${deptForm.name}" created successfully.`);
      }
      setDeptModalOpen(false);
      await fetchDepartments(selectedOrgId);
    } catch (err) {
      showAlert('error', err.response?.data?.message || 'Failed to save department.');
    } finally {
      setSubmitting(false);
    }
  };

  const openManageDeptModal = async (dept) => {
    setSelectedDepartment(dept);
    setEditDeptName(dept.name);
    setEditDeptCode(dept.code);
    setAddMemberSearch('');
    setAssignedMemberSearch('');
    try {
      setMembersLoading(true);
      const res = await api.get(`/organization/departments/${dept.id}/members`, {
        params: { organizationId: selectedOrgId }
      });
      const initialAssigned = res.data?.members || [];
      const initialUnassigned = res.data?.availableUsers || [];

      setOriginalDeptMemberIds(initialAssigned.map((u) => u.id));
      setStagedAssignedMembers(initialAssigned);
      setStagedUnassignedMembers(initialUnassigned);
    } catch (err) {
      console.error('Failed to fetch department members:', err);
      showAlert('error', 'Failed to load department members.');
    } finally {
      setMembersLoading(false);
    }
  };

  const handleRemoveStagedMember = (userToMove) => {
    setStagedAssignedMembers((prev) => prev.filter((u) => u.id !== userToMove.id));
    setStagedUnassignedMembers((prev) => {
      if (prev.some((u) => u.id === userToMove.id)) return prev;
      return [...prev, userToMove].sort((a, b) => a.name.localeCompare(b.name));
    });
  };

  const handleAddStagedMember = (userToMove) => {
    setStagedUnassignedMembers((prev) => prev.filter((u) => u.id !== userToMove.id));
    setStagedAssignedMembers((prev) => {
      if (prev.some((u) => u.id === userToMove.id)) return prev;
      return [...prev, userToMove].sort((a, b) => a.name.localeCompare(b.name));
    });
  };

  const handleSaveAllDeptChanges = async () => {
    if (!selectedDepartment) return;
    try {
      setSaveDeptLoading(true);

      // Update name/code if modified
      if (editDeptName !== selectedDepartment.name || editDeptCode !== selectedDepartment.code) {
        await api.put(`/organization/departments/${selectedDepartment.id}`, {
          name: editDeptName.trim(),
          code: editDeptCode.trim()
        });
      }

      // Member diff calculation
      const currentAssignedIds = stagedAssignedMembers.map((u) => u.id);
      const addedIds = currentAssignedIds.filter((id) => !originalDeptMemberIds.includes(id));
      const removedIds = originalDeptMemberIds.filter((id) => !currentAssignedIds.includes(id));

      if (addedIds.length > 0) {
        await api.post(`/organization/departments/${selectedDepartment.id}/members`, { userIds: addedIds });
      }

      if (removedIds.length > 0) {
        for (const uid of removedIds) {
          await api.delete(`/organization/departments/${selectedDepartment.id}/members/${uid}`);
        }
      }

      showAlert('success', `Department "${editDeptName}" updated successfully.`);
      setSelectedDepartment(null);
      fetchDepartments();
    } catch (err) {
      console.error('Save department changes error:', err);
      showAlert('error', err.response?.data?.message || 'Failed to save department changes.');
    } finally {
      setSaveDeptLoading(false);
    }
  };

  const handleDeleteDepartmentClick = () => {
    if (!selectedDepartment) return;
    const memberCount = stagedAssignedMembers.length;
    if (memberCount > 0) {
      setDeleteDeptModal({ open: true, dept: selectedDepartment, memberCount });
    } else {
      executeDeleteDepartment(selectedDepartment.id);
    }
  };

  const executeDeleteDepartment = async (deptId) => {
    try {
      setSaveDeptLoading(true);
      await api.delete(`/organization/departments/${deptId}`);
      showAlert('success', 'Department deleted successfully.');
      setDeleteDeptModal({ open: false, dept: null, memberCount: 0 });
      setSelectedDepartment(null);
      fetchDepartments();
    } catch (err) {
      showAlert('error', err.response?.data?.message || 'Failed to delete department.');
    } finally {
      setSaveDeptLoading(false);
    }
  };

  // Live slug preview generator
  const handleNameChange = (val) => {
    setFormData((prev) => ({ ...prev, name: val }));
    const baseSlug = val
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/[\s_]+/g, '-')
      .replace(/^-+|-+$/g, '');
    setSlugPreview(baseSlug || 'company-slug');
  };

  const handleLogoFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setLogoFile(file);
      setLogoPreview(URL.createObjectURL(file));
    }
  };

  const openCreateModal = () => {
    setFormData({
      name: '',
      companyCode: '',
      email: '',
      phone: '',
      website: '',
      address: '',
      timezone: 'Asia/Kolkata'
    });
    setLogoFile(null);
    setLogoPreview(null);
    setSlugPreview('');
    setQueuedAdmins([]);
    setCreateModalOpen(true);
  };

  const openEditModal = (company) => {
    setSelectedCompany(company);
    setFormData({
      name: company.name,
      companyCode: company.companyCode,
      email: company.email || '',
      phone: company.phone || '',
      website: company.website || '',
      address: company.address || '',
      timezone: company.timezone || 'Asia/Kolkata',
      adminName: '',
      adminEmail: '',
      adminEmployeeId: ''
    });
    setLogoFile(null);
    setLogoPreview(company.logo ? getUploadUrl(company.logo) : null);
    setSlugPreview(company.slug);
    setEditModalOpen(true);
  };

  const openViewDrawer = async (company) => {
    setSelectedCompany(company);
    setSelectedCompanySettings(null);
    setCompanyStats(null);
    setDrawerTab('overview');
    setTenantChatAdmins(true);
    setTenantChatUsers(true);
    setViewDrawerOpen(true);
    try {
      const [settingsRes, statsRes, brandingRes] = await Promise.all([
        api.get(`/organizations/${company.id}/settings`).catch(() => null),
        api.get(`/organizations/${company.id}/stats`).catch(() => null),
        api.get('/super-admin/branding', { params: { organizationId: company.id } }).catch(() => null)
      ]);
      if (settingsRes?.data) setSelectedCompanySettings(settingsRes.data);
      if (statsRes?.data?.stats) setCompanyStats(statsRes.data.stats);
      if (brandingRes?.data) {
        setTenantChatAdmins(brandingRes.data.chatEnabledForAdmins !== false);
        setTenantChatUsers(brandingRes.data.chatEnabledForUsers !== false);
      }
    } catch (err) {
      console.error('Error fetching drawer details:', err);
    }
  };
  const handleViewCompany = openViewDrawer;

  const handleTenantChatToggleClick = (roleTarget) => {
    setPendingTenantChatToggleRole(roleTarget);
    setShowTenantChatModal(true);
  };

  const confirmTenantChatToggle = async () => {
    if (!selectedCompany) return;
    setSavingTenantChat(true);
    try {
      const newAdmins = pendingTenantChatToggleRole === 'ADMIN' ? !tenantChatAdmins : tenantChatAdmins;
      const newUsers = pendingTenantChatToggleRole === 'USER' ? !tenantChatUsers : tenantChatUsers;

      const formData = new FormData();
      formData.append('organizationId', selectedCompany.id);
      formData.append('chatEnabledForAdmins', String(newAdmins));
      formData.append('chatEnabledForUsers', String(newUsers));

      const res = await api.put('/super-admin/branding', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      if (res.data) {
        setTenantChatAdmins(res.data.chatEnabledForAdmins !== false);
        setTenantChatUsers(res.data.chatEnabledForUsers !== false);
      } else {
        setTenantChatAdmins(newAdmins);
        setTenantChatUsers(newUsers);
      }

      showAlert('success', `Chat access settings updated for ${selectedCompany.name}`);
    } catch (err) {
      console.error('Failed to update tenant chat access:', err);
      showAlert('error', 'Failed to update tenant chat access controls.');
    } finally {
      setSavingTenantChat(false);
      setShowTenantChatModal(false);
      setPendingTenantChatToggleRole(null);
    }
  };

  const openSettingsModal = async (company) => {
    setSelectedCompany(company);
    setSettingsLogoFile(null);
    setSettingsLogoPreview(company.logo ? getUploadUrl(company.logo) : null);
    setSettingsData({
      companyName: company.name,
      primaryColor: '#10B981',
      timezone: company.timezone || 'Asia/Kolkata',
      clockInTime: '09:00',
      clockOutTime: '18:00',
      autoClockOutEnabled: true
    });
    setSettingsModalOpen(true);
    try {
      setLoadingSettings(true);
      const res = await api.get(`/organizations/${company.id}/settings`);
      if (res.data) {
        setSettingsData({
          companyName: res.data.companyName || company.name,
          primaryColor: res.data.primaryColor || '#10B981',
          timezone: res.data.timezone || company.timezone || 'Asia/Kolkata',
          clockInTime: res.data.clockInTime || '09:00',
          clockOutTime: res.data.clockOutTime || '18:00',
          autoClockOutEnabled: res.data.autoClockOutEnabled !== false
        });
        if (res.data.logo) {
          setSettingsLogoPreview(getUploadUrl(res.data.logo));
        }
      }
    } catch (err) {
      console.error('Error loading organization settings:', err);
      showAlert('error', 'Failed to load organization settings.');
    } finally {
      setLoadingSettings(false);
    }
  };

  const handleSettingsLogoChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setSettingsLogoFile(file);
      setSettingsLogoPreview(URL.createObjectURL(file));
    }
  };

  const handleSaveSettings = async (e) => {
    e.preventDefault();
    if (!selectedCompany) return;

    if (settingsData.clockInTime && settingsData.clockOutTime) {
      const [inH, inM] = settingsData.clockInTime.split(':').map(Number);
      const [outH, outM] = settingsData.clockOutTime.split(':').map(Number);
      if ((outH * 60 + outM) <= (inH * 60 + inM)) {
        showAlert('error', 'Clock-out time must be later than clock-in time.');
        return;
      }
    }

    try {
      setSubmitting(true);
      const data = new FormData();
      data.append('companyName', settingsData.companyName.trim());
      data.append('primaryColor', settingsData.primaryColor.trim());
      data.append('timezone', settingsData.timezone);
      data.append('clockInTime', settingsData.clockInTime);
      data.append('clockOutTime', settingsData.clockOutTime);
      data.append('autoClockOutEnabled', settingsData.autoClockOutEnabled);
      if (settingsLogoFile) data.append('logo', settingsLogoFile);

      const res = await api.put(`/organizations/${selectedCompany.id}/settings`, data, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      showAlert('success', res.data?.message || 'Organization settings saved successfully.');
      setSettingsModalOpen(false);
      fetchCompanies();
    } catch (err) {
      showAlert('error', err.response?.data?.message || 'Failed to save settings.');
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && createModalOpen) {
        setCreateModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [createModalOpen]);

  const handleCreateCompany = async (e) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      showAlert('error', 'Company Name is required.');
      document.getElementById('create-company-name')?.focus();
      return;
    }
    if (!formData.companyCode.trim()) {
      showAlert('error', 'Company Code is required.');
      document.getElementById('create-company-code')?.focus();
      return;
    }

    try {
      setSubmitting(true);
      const data = new FormData();
      data.append('name', formData.name.trim());
      data.append('companyCode', formData.companyCode.trim().toUpperCase());
      if (formData.email) data.append('email', formData.email.trim());
      if (formData.phone) data.append('phone', formData.phone.trim());
      if (formData.website) data.append('website', formData.website.trim());
      if (formData.address) data.append('address', formData.address.trim());
      if (formData.timezone) data.append('timezone', formData.timezone);
      if (logoFile) data.append('logo', logoFile);

      // 1. Create Organization
      const res = await api.post('/organizations', data, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      const createdOrg = res.data?.data || res.data?.organization || res.data;
      const orgId = createdOrg?.id;

      // 2. Create each queued admin tied to newly created organization ID
      let createdAdminCount = 0;
      let failedAdminCount = 0;
      let firstCreatedAdmin = null;

      if (orgId && queuedAdmins.length > 0) {
        for (const adminPayload of queuedAdmins) {
          try {
            await api.post('/super-admin/admins', {
              ...adminPayload,
              organizationId: orgId
            });
            if (!firstCreatedAdmin) {
              firstCreatedAdmin = {
                email: adminPayload.email,
                temporaryPassword: adminPayload.password
              };
            }
            createdAdminCount++;
          } catch (adminErr) {
            console.error(`Failed to provision admin ${adminPayload.name}:`, adminErr);
            failedAdminCount++;
          }
        }
      }

      setCreateModalOpen(false);
      setQueuedAdmins([]);
      setFormData({
        name: '',
        companyCode: '',
        email: '',
        phone: '',
        website: '',
        address: '',
        timezone: 'Asia/Kolkata'
      });
      setLogoFile(null);
      setLogoPreview(null);
      setSlugPreview('');

      fetchCompanies();
      window.dispatchEvent(new Event('organization-updated'));

      setProvisionModalData({
        organization: createdOrg,
        admin: firstCreatedAdmin || {
          email: formData.email || createdOrg.email || 'N/A',
          temporaryPassword: 'N/A'
        }
      });
      setProvisionSuccessOpen(true);
    } catch (err) {
      showAlert('error', err.response?.data?.message || 'Failed to create company.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResetAdminPassword = async (company) => {
    if (!window.confirm(`Are you sure you want to reset the Company Admin password for "${company.name}"?`)) {
      return;
    }
    try {
      const res = await api.post(`/organizations/${company.id}/reset-admin-password`);
      if (res.data?.success) {
        const adminData = res.data.data;
        setProvisionModalData({
          organization: company,
          admin: {
            email: adminData.email,
            temporaryPassword: adminData.temporaryPassword
          }
        });
        setProvisionSuccessOpen(true);
        showAlert(
          'success',
          `Admin password reset! Admin: ${adminData.email}`
        );
      }
    } catch (err) {
      showAlert('error', err.response?.data?.message || 'Failed to reset admin password.');
    }
  };

  const handleUpdateCompany = async (e) => {
    e.preventDefault();
    if (!selectedCompany) return;

    try {
      setSubmitting(true);
      const data = new FormData();
      data.append('name', formData.name.trim());
      data.append('companyCode', formData.companyCode.trim().toUpperCase());
      if (formData.email !== undefined) data.append('email', formData.email.trim());
      if (formData.phone !== undefined) data.append('phone', formData.phone.trim());
      if (formData.website !== undefined) data.append('website', formData.website.trim());
      if (formData.address !== undefined) data.append('address', formData.address.trim());
      if (formData.timezone) data.append('timezone', formData.timezone);
      if (logoFile) data.append('logo', logoFile);

      const res = await api.put(`/organizations/${selectedCompany.id}`, data, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      showAlert('success', res.data?.message || 'Company updated successfully.');
      setEditModalOpen(false);
      fetchCompanies();
    } catch (err) {
      showAlert('error', err.response?.data?.message || 'Failed to update company.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleStatus = async (company) => {
    const isInnoveity = company.slug === 'innoveity' || company.companyCode === 'INN001';
    if (isInnoveity) {
      showAlert('error', 'The default INNOVEITY organization cannot be deactivated.');
      return;
    }

    const nextStatus = company.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    try {
      const res = await api.patch(`/organizations/${company.id}/status`, {
        status: nextStatus
      });
      showAlert('success', res.data?.message || `Status updated to ${nextStatus}.`);
      fetchCompanies();
    } catch (err) {
      showAlert('error', err.response?.data?.message || 'Failed to toggle company status.');
    }
  };

  const openDeleteCompanyModal = async (company) => {
    const isInnoveity = company.slug === 'innoveity' || company.companyCode === 'INN001';
    if (isInnoveity) {
      showAlert('error', 'Default Innoveity Workspace cannot be deleted.');
      return;
    }
    setCompanyToDelete(company);
    setCompanyToDeleteStats(null);
    setDeleteErrorData(null);
    setConfirmDeleteText('');
    setDeleteConfirmOpen(true);

    try {
      const res = await api.get(`/organizations/${company.id}/stats`);
      if (res.data?.stats) {
        setCompanyToDeleteStats(res.data.stats);
      }
    } catch (e) {}
  };

  const handleConfirmDeleteCompany = async () => {
    if (!companyToDelete) return;
    if (confirmDeleteText.trim() !== 'CONFIRM') {
      showAlert('error', 'Type CONFIRM to continue.');
      return;
    }
    try {
      setDeletingCompany(true);
      setDeleteErrorData(null);
      const res = await api.delete(`/organizations/${companyToDelete.id}`, {
        data: { confirmText: confirmDeleteText.trim() },
        params: { confirmText: confirmDeleteText.trim() }
      });
      if (res.data?.success) {
        showAlert('success', res.data?.message || 'Company deleted successfully.');
        setDeleteConfirmOpen(false);
        setViewDrawerOpen(false);
        if (selectedCompany && selectedCompany.id === companyToDelete.id) {
          setSelectedCompany(null);
        }
        setCompanyToDelete(null);
        setCompanyToDeleteStats(null);
        setConfirmDeleteText('');
        fetchCompanies();
        window.dispatchEvent(new Event('organization-updated'));
      }
    } catch (err) {
      const resData = err.response?.data;
      const errMsg = resData?.message || 'Company deletion failed.';
      setDeleteErrorData({
        message: errMsg
      });
      showAlert('error', errMsg);
    } finally {
      setDeletingCompany(false);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return 'N/A';
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  return (
    <div className="space-y-6 text-left pb-12">
      {/* Header Banner */}
      <div className="rounded-3xl border border-border/60 bg-card p-6 sm:p-8 shadow-md">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3.5 py-1 text-xs font-extrabold text-primary border border-primary/20 mb-3">
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>Multi-Tenant Control • Enterprise HRMS Master Hub</span>
            </div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
                Company & Organization Management
              </h1>
            </div>
            <p className="mt-1 text-sm text-muted-foreground font-medium max-w-2xl">
              Centralized Tenant & HRMS Management Hub for multi-tenant company workspaces, global hierarchy positions, and department masters.
            </p>
          </div>

          <div className="flex items-center gap-3">
            {activeTab === 'companies' && (
              <>
                <button
                  onClick={fetchCompanies}
                  className="inline-flex items-center gap-2 rounded-2xl bg-muted/60 hover:bg-muted text-foreground px-4 py-2.5 text-xs font-bold border border-border/60 transition-all cursor-pointer"
                >
                  <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                  <span>Refresh</span>
                </button>

                {user?.role === 'SUPER_ADMIN' && (
                  <button
                    onClick={openCreateModal}
                    className="inline-flex items-center gap-2 rounded-2xl bg-primary hover:bg-primary-hover text-white px-5 py-2.5 text-xs font-extrabold shadow-md shadow-primary/20 hover:scale-105 active:scale-95 transition-all cursor-pointer"
                  >
                    <Plus className="h-4 w-4 stroke-[3]" />
                    <span>Create Company</span>
                  </button>
                )}
              </>
            )}

            {activeTab === 'positions' && (
              <>
                <button
                  onClick={fetchPositions}
                  className="inline-flex items-center gap-2 rounded-2xl bg-muted/60 hover:bg-muted text-foreground px-4 py-2.5 text-xs font-bold border border-border/60 transition-all cursor-pointer"
                >
                  <RefreshCw className={`h-4 w-4 ${posLoading ? 'animate-spin' : ''}`} />
                  <span>Refresh</span>
                </button>

                {user?.role === 'SUPER_ADMIN' && (
                  <button
                    onClick={() => handleOpenPosModal(null)}
                    className="inline-flex items-center gap-2 rounded-2xl bg-primary hover:bg-primary-hover text-white px-5 py-2.5 text-xs font-extrabold shadow-md shadow-primary/20 hover:scale-105 active:scale-95 transition-all cursor-pointer"
                  >
                    <Plus className="h-4 w-4 stroke-[3]" />
                    <span>Create Position</span>
                  </button>
                )}
              </>
            )}

            {activeTab === 'departments' && (
              <>
                <button
                  onClick={fetchDepartments}
                  className="inline-flex items-center gap-2 rounded-2xl bg-muted/60 hover:bg-muted text-foreground px-4 py-2.5 text-xs font-bold border border-border/60 transition-all cursor-pointer"
                >
                  <RefreshCw className={`h-4 w-4 ${deptLoading ? 'animate-spin' : ''}`} />
                  <span>Refresh</span>
                </button>

                {user?.role === 'SUPER_ADMIN' && (
                  <button
                    onClick={handleOpenCreateDeptModal}
                    className="inline-flex items-center gap-2 rounded-2xl bg-primary hover:bg-primary-hover text-white px-5 py-2.5 text-xs font-extrabold shadow-md shadow-primary/20 hover:scale-105 active:scale-95 transition-all cursor-pointer"
                  >
                    <Plus className="h-4 w-4 stroke-[3]" />
                    <span>Create Department</span>
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Top Navigation Tabs */}
        <div className="flex flex-wrap items-center gap-2 mt-6 pt-6 border-t border-border/60">
          <button
            onClick={() => setActiveTab('companies')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-extrabold transition-all cursor-pointer ${
              activeTab === 'companies'
                ? 'bg-primary text-white shadow-md shadow-primary/20'
                : 'bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            <Building2 className="h-4 w-4" />
            <span>Companies</span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
              activeTab === 'companies' ? 'bg-white/20 text-white' : 'bg-muted text-foreground'
            }`}>
              {companies.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('positions')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-extrabold transition-all cursor-pointer ${
              activeTab === 'positions'
                ? 'bg-primary text-white shadow-md shadow-primary/20'
                : 'bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            <Award className="h-4 w-4" />
            <span>Positions & Hierarchy</span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
              activeTab === 'positions' ? 'bg-white/20 text-white' : 'bg-muted text-foreground'
            }`}>
              {positions.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('departments')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-extrabold transition-all cursor-pointer ${
              activeTab === 'departments'
                ? 'bg-primary text-white shadow-md shadow-primary/20'
                : 'bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            <Briefcase className="h-4 w-4" />
            <span>Departments</span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
              activeTab === 'departments' ? 'bg-white/20 text-white' : 'bg-muted text-foreground'
            }`}>
              {departments.length}
            </span>
          </button>

          <button
            onClick={() => {
              setActiveTab('shifts');
              fetchShiftsCount(selectedOrgId);
            }}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-extrabold transition-all cursor-pointer ${
              activeTab === 'shifts'
                ? 'bg-primary text-white shadow-md shadow-primary/20'
                : 'bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            <Clock className="h-4 w-4" />
            <span>Shifts</span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
              activeTab === 'shifts' ? 'bg-white/20 text-white' : 'bg-muted text-foreground'
            }`}>
              {shiftsCount}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('branches')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-extrabold transition-all cursor-pointer ${
              activeTab === 'branches'
                ? 'bg-primary text-white shadow-md shadow-primary/20'
                : 'bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            <Building2 className="h-4 w-4" />
            <span>Branches</span>
          </button>
        </div>
      </div>

      {/* Shared Company Selector Bar for Positions, Departments & Branches Tabs */}
      {(activeTab === 'positions' || activeTab === 'departments' || activeTab === 'branches') && (
        <CompanyScopeSelector onScopeChange={(newId) => {
          fetchPositions(newId);
          fetchDepartments(newId);
        }} />
      )}

      {/* ALERT BANNER */}
      {alert && (
        <div
          className={`p-4 rounded-2xl border text-xs font-bold flex items-center justify-between shadow-md ${
            alert.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600'
              : 'bg-rose-500/10 border-rose-500/30 text-rose-600'
          }`}
        >
          <span>{alert.text}</span>
          <button onClick={() => setAlert(null)} className="hover:opacity-75 cursor-pointer">✕</button>
        </div>
      )}

      {/* TAB 1: COMPANIES VIEW */}
      {activeTab === 'companies' && (
        <div className="space-y-6">
          {/* Companies Filter & Search Bar */}
          <div className="p-4 rounded-3xl bg-card border border-border/60 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="relative flex-1 max-w-md w-full">
              <Search className="absolute left-3.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search companies by name, code, or email..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2 text-xs font-medium rounded-2xl border border-border/60 bg-muted/30 focus:bg-background focus:ring-2 focus:ring-primary/20 outline-none"
              />
            </div>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-4 py-2 text-xs font-bold rounded-2xl border border-border/60 bg-muted/30 focus:bg-background cursor-pointer"
            >
              <option value="ALL">All Statuses</option>
              <option value="ACTIVE">Active Only</option>
              <option value="SUSPENDED">Suspended Only</option>
            </select>
          </div>

          {/* Platform Governance Health Overview Cards */}
          {platformHealth && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-4 rounded-3xl bg-card border border-border/60 shadow-sm space-y-1">
                <div className="text-[11px] font-extrabold uppercase text-muted-foreground flex items-center justify-between">
                  <span>Active Tenants</span>
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                </div>
                <div className="text-2xl font-black text-foreground">
                  {platformHealth.activeCompanies} <span className="text-xs font-normal text-muted-foreground">/ {platformHealth.totalCompanies}</span>
                </div>
                <div className="text-[10px] text-emerald-600 font-bold">
                  {platformHealth.suspendedCompanies} Suspended
                </div>
              </div>

              <div className="p-4 rounded-3xl bg-card border border-border/60 shadow-sm space-y-1">
                <div className="text-[11px] font-extrabold uppercase text-muted-foreground flex items-center justify-between">
                  <span>Active Users</span>
                  <Users className="h-4 w-4 text-blue-500" />
                </div>
                <div className="text-2xl font-black text-foreground">{platformHealth.activeUsers}</div>
                <div className="text-[10px] text-blue-600 font-bold">
                  Across {platformHealth.totalProjects} Projects
                </div>
              </div>

              <div className="p-4 rounded-3xl bg-card border border-border/60 shadow-sm space-y-1">
                <div className="text-[11px] font-extrabold uppercase text-muted-foreground flex items-center justify-between">
                  <span>Storage Warnings</span>
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                </div>
                <div className="text-2xl font-black text-foreground">{platformHealth.storageWarnings}</div>
                <div className="text-[10px] text-amber-600 font-bold">
                  Tenants &gt; 80% Capacity
                </div>
              </div>

              <div className="p-4 rounded-3xl bg-card border border-border/60 shadow-sm space-y-1">
                <div className="text-[11px] font-extrabold uppercase text-muted-foreground flex items-center justify-between">
                  <span>Live Sockets</span>
                  <Activity className="h-4 w-4 text-purple-500" />
                </div>
                <div className="text-2xl font-black text-foreground">{platformHealth.activeSockets}</div>
                <div className="text-[10px] text-purple-600 font-bold">
                  Uptime: {platformHealth.uptimePercentage}
                </div>
              </div>
            </div>
          )}

          {/* Enterprise Company Table */}
          <div className="rounded-3xl border border-border/60 bg-card overflow-hidden shadow-sm">
            {loading ? (
              <div className="flex h-64 items-center justify-center">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent" />
              </div>
            ) : companies.length === 0 ? (
              <div className="p-12 text-center space-y-3">
                <Building2 className="h-12 w-12 text-muted-foreground/40 mx-auto" />
                <h3 className="text-sm font-extrabold text-foreground">No companies found</h3>
                <p className="text-xs text-muted-foreground font-medium max-w-sm mx-auto">
                  No tenants match your search query. Click "Create Company" to register a new tenant organization.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-muted/50 text-muted-foreground uppercase text-[10px] font-extrabold tracking-wider border-b border-border/60 sticky top-0 backdrop-blur-md">
                    <tr>
                      <th className="py-4 px-6">Company</th>
                      <th className="py-4 px-6">Company Code</th>
                      <th className="py-4 px-6">Timezone</th>
                      <th className="py-4 px-6">Status</th>
                      <th className="py-4 px-6">Created Date</th>
                      <th className="py-4 px-6 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40 font-medium">
                    {companies.map((company) => {
                      const isInnoveity = company.slug === 'innoveity' || company.companyCode === 'INN001';
                      return (
                        <tr key={company.id} className="hover:bg-muted/30 transition-colors group">
                          <td className="py-4 px-6">
                            <div className="flex items-center gap-3">
                              <div className="h-10 w-10 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 flex items-center justify-center overflow-hidden shrink-0 font-extrabold text-sm">
                                {company.logo ? (
                                  <img src={getUploadUrl(company.logo)} alt={company.name} className="h-full w-full object-cover" />
                                ) : (
                                  company.name.charAt(0).toUpperCase()
                                )}
                              </div>
                              <div>
                                <div className="font-extrabold text-foreground text-xs flex items-center gap-2">
                                  <span>{company.name}</span>
                                  {isInnoveity && (
                                    <span className="px-2 py-0.5 rounded-full text-[9px] font-black bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                                      DEFAULT
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] text-muted-foreground font-medium flex items-center gap-2 mt-0.5">
                                  <span>{company.email || 'No contact email'}</span>
                                  {company.website && (
                                    <>
                                      <span>•</span>
                                      <a href={company.website} target="_blank" rel="noopener noreferrer" className="hover:underline text-emerald-600">
                                        {company.website.replace(/^https?:\/\//, '')}
                                      </a>
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>
                          </td>

                          <td className="py-4 px-6 font-mono font-bold text-foreground">
                            <span className="px-2.5 py-1 rounded-xl bg-muted border border-border/60 text-[11px]">
                              {company.companyCode}
                            </span>
                          </td>

                          <td className="py-4 px-6 font-medium text-foreground">
                            {company.timezone || 'Asia/Kolkata'}
                          </td>

                          <td className="py-4 px-6">
                            <span
                              className={`px-3 py-1 rounded-full text-[10px] font-black border ${
                                company.status === 'ACTIVE'
                                  ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
                                  : 'bg-rose-500/10 text-rose-600 border-rose-500/20'
                              }`}
                            >
                              {company.status}
                            </span>
                          </td>

                          <td className="py-4 px-6 text-muted-foreground font-medium">
                            {formatDate(company.createdAt)}
                          </td>

                          <td className="py-4 px-6 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={() => openViewDrawer(company)}
                                className="p-2 rounded-xl border border-border hover:bg-muted text-foreground transition-colors cursor-pointer"
                                title="View Company Details"
                              >
                                <Eye className="h-3.5 w-3.5" />
                              </button>

                              <button
                                onClick={() => openEditModal(company)}
                                className="p-2 rounded-xl border border-border hover:bg-muted text-primary transition-colors cursor-pointer"
                                title="Edit Company"
                              >
                                <Edit2 className="h-3.5 w-3.5" />
                              </button>

                              <button
                                onClick={() => openSettingsModal(company)}
                                className="p-2 rounded-xl border border-border hover:bg-muted text-emerald-600 transition-colors cursor-pointer"
                                title="Organization Settings"
                              >
                                <Cog className="h-3.5 w-3.5" />
                              </button>

                              <button
                                onClick={() => handleResetAdminPassword(company)}
                                className="p-2 rounded-xl border border-border hover:bg-muted text-amber-600 transition-colors cursor-pointer"
                                title="Reset Admin Password"
                              >
                                <Key className="h-3.5 w-3.5" />
                              </button>

                              <button
                                disabled={isInnoveity}
                                onClick={() => handleToggleStatus(company)}
                                className={`px-3 py-1.5 rounded-xl border text-[11px] font-bold transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                                  company.status === 'ACTIVE'
                                    ? 'border-amber-500/30 text-amber-600 hover:bg-amber-500/10'
                                    : 'border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10'
                                }`}
                                title={isInnoveity ? 'INNOVEITY tenant cannot be suspended' : 'Toggle Status'}
                              >
                                {company.status === 'ACTIVE' ? 'Suspend' : 'Activate'}
                              </button>

                              <button
                                disabled={isInnoveity}
                                onClick={() => openDeleteCompanyModal(company)}
                                className="p-2 rounded-xl border border-rose-500/30 text-rose-600 hover:bg-rose-500/10 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                title={isInnoveity ? 'INNOVEITY tenant cannot be deleted' : 'Delete Company'}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: POSITIONS & HIERARCHY VIEW */}
      {activeTab === 'positions' && (
        <div className="space-y-6">
          {/* Position Search & Status Bar */}
          <div className="p-4 rounded-3xl bg-card border border-border/60 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="relative flex-1 max-w-md w-full">
              <Search className="absolute left-3.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search positions by name or code..."
                value={posSearch}
                onChange={(e) => setPosSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2 text-xs font-medium rounded-2xl border border-border/60 bg-muted/30 focus:bg-background focus:ring-2 focus:ring-emerald-500/20 outline-none"
              />
            </div>
            <div className="flex items-center gap-2">
              <select
                value={posStatusFilter}
                onChange={(e) => setPosStatusFilter(e.target.value)}
                className="px-4 py-2 text-xs font-bold rounded-2xl border border-border/60 bg-muted/30 focus:bg-background cursor-pointer"
              >
                <option value="ALL">All Statuses</option>
                <option value="ACTIVE">Active Only</option>
                <option value="INACTIVE">Inactive Only</option>
              </select>
              <button
                onClick={() => fetchPositions(selectedOrgId)}
                className="p-2 text-xs font-bold rounded-2xl border border-border/60 bg-muted/30 hover:bg-muted text-foreground transition-all cursor-pointer"
                title="Refresh Positions"
              >
                <RefreshCw className="h-4 w-4" />
              </button>
              <button
                onClick={() => handleOpenPosModal(null)}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-extrabold rounded-2xl bg-primary hover:bg-primary-hover text-white shadow-md shadow-primary/20 transition-all cursor-pointer shrink-0"
              >
                <Plus className="h-4 w-4" />
                <span>Create Position</span>
              </button>
            </div>
          </div>

          {/* Positions Table */}
          <div className="rounded-3xl border border-border/60 bg-card overflow-hidden shadow-md">
            {posLoading ? (
              <div className="flex h-64 items-center justify-center">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
              </div>
            ) : positions.length === 0 ? (
              <div className="p-12 text-center space-y-3">
                <Award className="h-12 w-12 text-muted-foreground/40 mx-auto" />
                <h3 className="text-sm font-extrabold text-foreground">
                  No positions found for {companies.find((c) => c.id === selectedOrgId)?.name || 'this company'}
                </h3>
                <p className="text-xs text-muted-foreground font-medium max-w-sm mx-auto">
                  Click "Create Position" to define hierarchy titles for {companies.find((c) => c.id === selectedOrgId)?.name || 'this company'}.
                </p>
                <div className="pt-2">
                  <button
                    onClick={() => handleOpenPosModal(null)}
                    className="inline-flex items-center gap-2 rounded-2xl bg-primary hover:bg-primary-hover text-white px-4 py-2 text-xs font-extrabold shadow-md shadow-primary/20 transition-all cursor-pointer"
                  >
                    <Plus className="h-4 w-4" />
                    <span>Create Position</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-muted/40 border-b border-border/60 uppercase font-black tracking-wider text-muted-foreground text-[10px]">
                    <tr>
                      <th className="py-3 px-3 text-center w-10 whitespace-nowrap">#</th>
                      <th className="py-3 px-4 whitespace-nowrap">Position</th>
                      <th className="py-3 px-4 whitespace-nowrap">Code</th>
                      <th className="py-3 px-4 whitespace-nowrap">Hierarchy Level</th>
                      <th className="py-3 px-4 whitespace-nowrap">Assignment</th>
                      <th className="py-3 px-4 whitespace-nowrap">Status</th>
                      <th className="py-3 px-4 text-right whitespace-nowrap">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40 font-medium">
                    {positions
                      .filter((p) => {
                        const matchSearch =
                          !posSearch.trim() ||
                          p.name.toLowerCase().includes(posSearch.toLowerCase()) ||
                          p.code.toLowerCase().includes(posSearch.toLowerCase());
                        const matchStatus = posStatusFilter === 'ALL' || p.status === posStatusFilter;
                        return matchSearch && matchStatus;
                      })
                      .map((pos, idx) => {
                        const badge = getHierarchyBadgeStyle(pos);
                        const assignedCount = pos.totalEmployees || pos._count?.users || 0;
                        return (
                          <tr key={pos.id} className="hover:bg-muted/20 transition-colors group">
                            {/* 1. Row Number */}
                            <td className="py-2.5 px-3 text-center font-extrabold text-xs text-emerald-600 whitespace-nowrap">
                              {idx + 1}
                            </td>

                            {/* 2. Position Title */}
                            <td className="py-2.5 px-4 whitespace-nowrap">
                              <div className="flex items-center gap-2.5">
                                <div
                                  className="h-7 w-7 rounded-xl flex items-center justify-center font-bold text-xs shrink-0 shadow-xs"
                                  style={{ backgroundColor: `${pos.color || '#10B981'}15`, color: pos.color || '#10B981', border: `1px solid ${pos.color || '#10B981'}30` }}
                                >
                                  <Award className="h-3.5 w-3.5" />
                                </div>
                                <span className="font-extrabold text-foreground tracking-tight text-xs">{pos.name}</span>
                              </div>
                            </td>

                            {/* 3. Position Code */}
                            <td className="py-2.5 px-4 whitespace-nowrap">
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-lg bg-emerald-500/10 text-emerald-700 border border-emerald-500/20 font-mono font-extrabold text-xs whitespace-nowrap">
                                {pos.code}
                              </span>
                            </td>

                            {/* 4. Hierarchy Level Badge */}
                            <td className="py-2.5 px-4 whitespace-nowrap">
                              <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-extrabold border whitespace-nowrap ${badge.bg} ${badge.text} ${badge.border}`}>
                                <Layers className="h-3 w-3 shrink-0" />
                                <span>{badge.label}</span>
                              </span>
                            </td>

                            {/* 5. Assignment Chip */}
                            <td className="py-2.5 px-4 whitespace-nowrap">
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-xl bg-muted/60 text-foreground border border-border/60 text-xs font-bold whitespace-nowrap">
                                <Users className="h-3 w-3 text-muted-foreground shrink-0" />
                                <span>{assignedCount} Assigned</span>
                              </span>
                            </td>

                            {/* 6. Status Badge */}
                            <td className="py-2.5 px-4 whitespace-nowrap">
                              <button
                                onClick={() => handleTogglePosStatus(pos)}
                                className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black border transition-all cursor-pointer whitespace-nowrap ${
                                  pos.status === 'ACTIVE'
                                    ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30 hover:bg-emerald-500/20'
                                    : 'bg-rose-500/10 text-rose-600 border-rose-500/30 hover:bg-rose-500/20'
                                }`}
                                title="Click to toggle status"
                              >
                                <CheckCircle2 className="h-3 w-3 shrink-0" />
                                <span>{pos.status}</span>
                              </button>
                            </td>

                            {/* 7. Circular Action Buttons */}
                            <td className="py-2.5 px-4 text-right whitespace-nowrap">
                              <div className="flex items-center justify-end gap-1.5 shrink-0">
                                <button
                                  disabled={idx === 0}
                                  onClick={() => handleMovePosition(idx, 'up')}
                                  className="h-7 w-7 rounded-full border border-border/60 hover:bg-muted text-foreground flex items-center justify-center transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
                                  title="Move Up"
                                >
                                  <ArrowUp className="h-3 w-3" />
                                </button>

                                <button
                                  disabled={idx === positions.length - 1}
                                  onClick={() => handleMovePosition(idx, 'down')}
                                  className="h-7 w-7 rounded-full border border-border/60 hover:bg-muted text-foreground flex items-center justify-center transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
                                  title="Move Down"
                                >
                                  <ArrowDown className="h-3 w-3" />
                                </button>

                                <button
                                  onClick={() => handleOpenPosModal(pos)}
                                  className="h-7 w-7 rounded-full border border-emerald-500/30 hover:bg-emerald-500/10 text-emerald-600 flex items-center justify-center transition-all cursor-pointer shrink-0"
                                  title="Edit Position"
                                >
                                  <Edit2 className="h-3 w-3" />
                                </button>

                                <button
                                  onClick={() => handleDeletePos(pos)}
                                  className="h-7 w-7 rounded-full border border-rose-500/30 hover:bg-rose-500/10 text-rose-600 flex items-center justify-center transition-all cursor-pointer shrink-0"
                                  title="Delete Position"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: DEPARTMENTS VIEW */}
      {activeTab === 'departments' && (
        <div className="space-y-6">
          {/* Department Search Bar */}
          <div className="p-4 rounded-3xl bg-card border border-border/60 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="relative flex-1 max-w-md w-full">
              <Search className="absolute left-3.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search departments by name or code..."
                value={deptSearch}
                onChange={(e) => setDeptSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2 text-xs font-medium rounded-2xl border border-border/60 bg-muted/30 focus:bg-background focus:ring-2 focus:ring-emerald-500/20 outline-none"
              />
            </div>
            <div className="flex items-center gap-2">
              <select
                value={deptStatusFilter}
                onChange={(e) => setDeptStatusFilter(e.target.value)}
                className="px-4 py-2 text-xs font-bold rounded-2xl border border-border/60 bg-muted/30 focus:bg-background cursor-pointer"
              >
                <option value="ALL">All Statuses</option>
                <option value="ACTIVE">Active Only</option>
                <option value="INACTIVE">Inactive Only</option>
              </select>

              <button
                onClick={() => fetchDepartments(selectedOrgId)}
                className="p-2 text-xs font-bold rounded-2xl border border-border/60 bg-muted/30 hover:bg-muted text-foreground transition-all cursor-pointer"
                title="Refresh Departments"
              >
                <RefreshCw className="h-4 w-4" />
              </button>

              <button
                onClick={handleOpenCreateDeptModal}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-extrabold rounded-2xl bg-primary hover:bg-primary-hover text-white shadow-md shadow-primary/20 transition-all cursor-pointer shrink-0"
              >
                <Plus className="h-4 w-4" />
                <span>Create Department</span>
              </button>
            </div>
          </div>

          {/* Departments Table */}
          <div className="rounded-3xl border border-border/60 bg-card overflow-hidden shadow-md">
            {deptLoading ? (
              <div className="flex h-64 items-center justify-center">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
              </div>
            ) : departments.length === 0 ? (
              <div className="p-12 text-center space-y-3">
                <Briefcase className="h-12 w-12 text-muted-foreground/40 mx-auto" />
                <h3 className="text-sm font-extrabold text-foreground">
                  No departments found for {companies.find((c) => c.id === selectedOrgId)?.name || 'this company'}
                </h3>
                <p className="text-xs text-muted-foreground font-medium max-w-sm mx-auto">
                  Click "Create Department" to set up organizational departments for {companies.find((c) => c.id === selectedOrgId)?.name || 'this company'}.
                </p>
                <div className="pt-2">
                  <button
                    onClick={handleOpenCreateDeptModal}
                    className="inline-flex items-center gap-2 rounded-2xl bg-primary hover:bg-primary-hover text-white px-4 py-2 text-xs font-extrabold shadow-md shadow-primary/20 transition-all cursor-pointer"
                  >
                    <Plus className="h-4 w-4" />
                    <span>Create Department</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-muted/40 border-b border-border/60 uppercase font-black tracking-wider text-muted-foreground text-[10px]">
                    <tr>
                      <th className="px-6 py-4">Department Name</th>
                      <th className="px-6 py-4">Code</th>
                      <th className="px-6 py-4">Members</th>
                      <th className="px-6 py-4">Status</th>
                      <th className="px-6 py-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40 font-medium">
                    {departments
                      .filter((d) => {
                        const deptName = d.displayName || d.name;
                        const deptCode = d.displayCode || d.code;
                        const matchSearch =
                          !deptSearch.trim() ||
                          deptName.toLowerCase().includes(deptSearch.toLowerCase()) ||
                          deptCode.toLowerCase().includes(deptSearch.toLowerCase());
                        const matchStatus = deptStatusFilter === 'ALL' || (d.status || 'ACTIVE') === deptStatusFilter;
                        return matchSearch && matchStatus;
                      })
                      .map((dept) => (
                        <tr key={dept.id} className="hover:bg-muted/20 transition-colors">
                          <td className="px-6 py-4 font-bold text-foreground">
                            <div className="flex items-center gap-3">
                              <div className="h-8 w-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold">
                                <Briefcase className="h-4 w-4" />
                              </div>
                              <span>{dept.displayName || dept.name}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4 font-mono font-bold text-foreground">
                            <span className="px-2.5 py-1 rounded-xl bg-muted border border-border/60 text-[11px]">
                              {dept.displayCode || dept.code}
                            </span>
                          </td>
                          <td className="px-6 py-4 font-bold text-foreground">
                            <div className="flex items-center gap-1.5">
                              <Users className="h-3.5 w-3.5 text-muted-foreground" />
                              <span>{dept._count?.users || 0} Members</span>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <span
                              className={`px-2.5 py-0.5 rounded-full text-[10px] font-black border ${
                                (dept.status || 'ACTIVE') === 'ACTIVE'
                                  ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
                                  : 'bg-rose-500/10 text-rose-600 border-rose-500/20'
                              }`}
                            >
                              {dept.status || 'ACTIVE'}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                onClick={() => openManageDeptModal(dept)}
                                className="px-3.5 py-1.5 rounded-xl bg-primary text-white font-bold text-xs hover:bg-primary-hover shadow-xs shadow-primary/20 transition-colors cursor-pointer"
                              >
                                Manage Members
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 4: SHIFTS VIEW */}
      {activeTab === 'shifts' && (
        <ShiftManager onShiftsCountChange={setShiftsCount} />
      )}

      {/* TAB 5: ENTERPRISE BRANCHES VIEW */}
      {activeTab === 'branches' && (
        <BranchManager />
      )}

      {/* CREATE COMPANY MODAL */}
      <AnimatePresence>
        {createModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-card border border-border/80 rounded-3xl max-w-2xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden text-left"
            >
              {/* Sticky Header */}
              <div className="sticky top-0 z-20 bg-card px-6 py-4 sm:px-8 sm:py-5 border-b border-border/60 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-2xl bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                    <Building2 className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-extrabold text-foreground">Create New Company</h3>
                    <p className="text-xs text-muted-foreground font-medium">Add a tenant organization to the CRM platform</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setCreateModalOpen(false)}
                  className="text-muted-foreground hover:text-foreground p-1.5 rounded-xl hover:bg-muted cursor-pointer transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Form Container */}
              <form onSubmit={handleCreateCompany} className="flex flex-col flex-1 overflow-hidden">
                {/* Scrollable Body */}
                <div className="flex-1 overflow-y-auto p-6 sm:p-8 space-y-6">
                  {/* Company Details */}
                  <div className="space-y-4">
                    <h4 className="text-xs font-black uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                      <Building2 className="h-3.5 w-3.5 text-emerald-600" /> Company Details
                    </h4>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold text-foreground mb-1">Company Name *</label>
                        <input
                          id="create-company-name"
                          type="text"
                          required
                          placeholder="e.g. Acme Corporation"
                          value={formData.name}
                          onChange={(e) => handleNameChange(e.target.value)}
                          className="w-full px-3.5 py-2 text-xs font-medium rounded-xl border border-border bg-muted/30 focus:bg-background outline-none focus:ring-2 focus:ring-emerald-500/20"
                        />
                        {slugPreview && (
                          <p className="text-[11px] font-mono text-muted-foreground mt-1">
                            Generated Slug: <span className="text-emerald-600 font-bold">{slugPreview}</span>
                          </p>
                        )}
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-foreground mb-1">Company Code *</label>
                        <input
                          id="create-company-code"
                          type="text"
                          required
                          placeholder="e.g. ACM001"
                          value={formData.companyCode}
                          onChange={(e) => setFormData({ ...formData, companyCode: e.target.value.toUpperCase() })}
                          className="w-full px-3.5 py-2 text-xs font-mono font-bold rounded-xl border border-border bg-muted/30 focus:bg-background outline-none focus:ring-2 focus:ring-emerald-500/20"
                        />
                        <p className="text-[10px] text-muted-foreground mt-1">Uppercase letters & numbers</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold text-foreground mb-1">Contact Email</label>
                        <input
                          type="email"
                          placeholder="e.g. contact@acme.com"
                          value={formData.email}
                          onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                          className="w-full px-3.5 py-2 text-xs font-medium rounded-xl border border-border bg-muted/30 focus:bg-background outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-foreground mb-1">Phone Number</label>
                        <input
                          type="text"
                          placeholder="e.g. +91 98765 43210"
                          value={formData.phone}
                          onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                          className="w-full px-3.5 py-2 text-xs font-medium rounded-xl border border-border bg-muted/30 focus:bg-background outline-none"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold text-foreground mb-1">Website URL</label>
                        <input
                          type="url"
                          placeholder="e.g. https://acme.com"
                          value={formData.website}
                          onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                          className="w-full px-3.5 py-2 text-xs font-medium rounded-xl border border-border bg-muted/30 focus:bg-background outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-foreground mb-1">Timezone</label>
                        <select
                          value={formData.timezone}
                          onChange={(e) => setFormData({ ...formData, timezone: e.target.value })}
                          className="w-full px-3.5 py-2 text-xs font-bold rounded-xl border border-border bg-muted/30 focus:bg-background cursor-pointer outline-none"
                        >
                          <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
                          <option value="UTC">UTC</option>
                          <option value="America/New_York">America/New_York (EST)</option>
                          <option value="Europe/London">Europe/London (GMT)</option>
                          <option value="Asia/Dubai">Asia/Dubai (GST)</option>
                          <option value="Asia/Singapore">Asia/Singapore (SGT)</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-foreground mb-1">Office Address</label>
                      <input
                        type="text"
                        placeholder="e.g. 123 Tech Park, MG Road, Bangalore"
                        value={formData.address}
                        onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                        className="w-full px-3.5 py-2 text-xs font-medium rounded-xl border border-border bg-muted/30 focus:bg-background outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-foreground mb-1">Company Logo</label>
                      <div className="flex items-center gap-4">
                        <label className="flex items-center gap-2 px-4 py-2 rounded-xl bg-muted/50 hover:bg-muted border border-border text-xs font-bold text-foreground cursor-pointer transition-colors">
                          <Upload className="h-4 w-4 text-emerald-600" />
                          <span>Choose File</span>
                          <input
                            type="file"
                            accept="image/*"
                            onChange={handleLogoFileChange}
                            className="hidden"
                          />
                        </label>
                        {logoPreview && (
                          <div className="h-9 w-9 rounded-xl border border-border overflow-hidden bg-muted/30 p-1 flex items-center justify-center">
                            <img src={logoPreview} alt="Logo preview" className="h-full w-full object-contain" />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Company Administrators Section */}
                  <div className="pt-4 border-t border-border/40 space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="text-xs font-black uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                          <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" /> Company Administrators
                        </h4>
                        <p className="text-[11px] text-muted-foreground mt-0.5 font-medium">
                          Provision administrator accounts to assign to this company upon creation.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleOpenAddAdminModal}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary hover:bg-primary-hover text-white text-xs font-bold transition-all shadow-xs shrink-0 cursor-pointer"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        <span>Add Administrator</span>
                      </button>
                    </div>

                    {/* Queued Admin Cards */}
                    {queuedAdmins.length === 0 ? (
                      <div className="p-4 rounded-2xl bg-muted/20 border border-dashed border-border/60 text-center text-xs text-muted-foreground font-medium">
                        No administrators added yet. Click "Add Administrator" to provision one.
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {queuedAdmins.map((admin, idx) => (
                          <div key={idx} className="p-3.5 rounded-2xl bg-card border border-emerald-500/20 shadow-xs flex items-center justify-between gap-3">
                            <div className="flex items-center gap-3 min-w-0">
                              <UserAvatar user={admin} className="h-9 w-9 shrink-0" />
                              <div className="min-w-0">
                                <p className="font-bold text-foreground text-xs truncate">{admin.name}</p>
                                <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium truncate">{admin.designation || 'System Administrator'}</p>
                                <p className="text-[10px] text-muted-foreground font-mono truncate">{admin.email}</p>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleRemoveQueuedAdmin(idx)}
                              className="p-1.5 text-muted-foreground hover:text-rose-600 hover:bg-rose-500/10 rounded-lg transition-all shrink-0 cursor-pointer"
                              title="Remove Administrator"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Live Onboarding Workspace Preview Card */}
                  <div className="p-4 rounded-2xl bg-emerald-500/5 border border-emerald-500/20 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-black uppercase text-emerald-600 tracking-wider">
                        Live Onboarding Workspace Preview
                      </span>
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                        {formData.companyCode || 'CODE'}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-xl bg-primary text-white font-black flex items-center justify-center overflow-hidden shrink-0">
                        {logoPreview ? (
                          <img src={logoPreview} alt="Logo" className="h-full w-full object-cover" />
                        ) : (
                          (formData.name || 'C').charAt(0).toUpperCase()
                        )}
                      </div>
                      <div>
                        <div className="font-extrabold text-sm text-foreground">
                          {formData.name || 'Company Name'}
                        </div>
                        <div className="text-xs text-muted-foreground font-medium flex items-center gap-2">
                          <span className="text-emerald-600 font-bold">{queuedAdmins.length} Admin(s) Queued</span>
                          <span>•</span>
                          <span>{formData.timezone}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Sticky Footer Action Bar */}
                <div className="sticky bottom-0 z-20 bg-card px-6 py-4 sm:px-8 sm:py-5 border-t border-border/60 flex flex-col sm:flex-row items-center justify-end gap-3 shrink-0 shadow-lg">
                  <button
                    type="button"
                    onClick={() => setCreateModalOpen(false)}
                    className="w-full sm:w-auto px-5 py-2.5 rounded-xl border border-border text-xs font-bold text-muted-foreground hover:bg-muted cursor-pointer transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-primary hover:bg-primary-hover text-white text-xs font-extrabold shadow-md shadow-primary/20 cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2 transition-all"
                  >
                    {submitting && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                    <span>{submitting ? 'Creating Company...' : 'Create Company'}</span>
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* PROVISION ADMIN FOR NEW COMPANY SUB-MODAL */}
      <AnimatePresence>
        {showAddAdminModal && (
          <div className="fixed inset-0 z-[60] overflow-y-auto bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-lg rounded-2xl border border-border/40 bg-card p-6 shadow-2xl space-y-4 text-left"
            >
              <form onSubmit={handleAddAdminToQueue}>
                <div className="flex items-center justify-between border-b border-border/30 pb-3 mb-4">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-5 w-5 text-emerald-600" />
                    <h3 className="text-base font-bold text-foreground">Provision Admin Account</h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowAddAdminModal(false)}
                    className="p-1 text-muted-foreground hover:text-foreground rounded-lg cursor-pointer"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5 sm:col-span-2">
                    <label className="text-xs font-bold text-foreground block">
                      Full Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={newAdminData.name}
                      onChange={(e) => setNewAdminData({ ...newAdminData, name: e.target.value })}
                      placeholder="e.g. Alexander Pierce"
                      className="w-full rounded-xl border border-border/60 bg-background px-3.5 py-2 text-xs font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-foreground block">
                      Email Address <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="email"
                      value={newAdminData.email}
                      onChange={(e) => setNewAdminData({ ...newAdminData, email: e.target.value })}
                      placeholder="admin@company.com"
                      className="w-full rounded-xl border border-border/60 bg-background px-3.5 py-2 text-xs font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-foreground block">
                      Phone Number
                    </label>
                    <input
                      type="text"
                      value={newAdminData.phone}
                      onChange={(e) => setNewAdminData({ ...newAdminData, phone: e.target.value })}
                      placeholder="+91 9876543210"
                      className="w-full rounded-xl border border-border/60 bg-background px-3.5 py-2 text-xs font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                    />
                  </div>

                  <div className="space-y-1.5 sm:col-span-2">
                    <label className="text-xs font-bold text-foreground block">
                      Initial Password <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={newAdminData.password}
                      onChange={(e) => setNewAdminData({ ...newAdminData, password: e.target.value })}
                      placeholder="Enter initial password"
                      className="w-full rounded-xl border border-border/60 bg-background px-3.5 py-2 text-xs font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-foreground block">Department</label>
                    <input
                      type="text"
                      value={newAdminData.department}
                      onChange={(e) => setNewAdminData({ ...newAdminData, department: e.target.value })}
                      className="w-full rounded-xl border border-border/60 bg-background px-3.5 py-2 text-xs font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-foreground block">Designation</label>
                    <input
                      type="text"
                      value={newAdminData.designation}
                      onChange={(e) => setNewAdminData({ ...newAdminData, designation: e.target.value })}
                      className="w-full rounded-xl border border-border/60 bg-background px-3.5 py-2 text-xs font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-3 border-t border-border/30 pt-4 mt-4">
                  <button
                    type="button"
                    onClick={() => setShowAddAdminModal(false)}
                    className="px-4 py-2 rounded-xl text-xs font-bold text-muted-foreground hover:bg-muted transition-all cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 rounded-xl bg-primary text-xs font-bold text-white hover:bg-primary-hover shadow-xs shadow-primary/20 transition-all cursor-pointer"
                  >
                    Add Administrator
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* EDIT COMPANY MODAL */}
      <AnimatePresence>
        {editModalOpen && selectedCompany && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-card border border-border/80 rounded-3xl p-6 sm:p-8 max-w-xl w-full shadow-2xl space-y-6 text-left"
            >
              <div className="flex items-center justify-between border-b border-border/60 pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-2xl bg-primary/10 text-primary border border-primary/20">
                    <Edit2 className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-extrabold text-foreground">Edit Company Details</h3>
                    <p className="text-xs text-muted-foreground font-medium">Update tenant profile and contact settings</p>
                  </div>
                </div>
                <button
                  onClick={() => setEditModalOpen(false)}
                  className="text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {(selectedCompany.slug === 'innoveity' || selectedCompany.companyCode === 'INN001') && (
                <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-700 text-xs font-medium flex items-center gap-2">
                  <Lock className="h-4 w-4 shrink-0 text-amber-600" />
                  <span>
                    <strong>INNOVEITY</strong> is the default tenant. Its Company Code and Slug are locked to protect data integrity.
                  </span>
                </div>
              )}

              <form onSubmit={handleUpdateCompany} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-foreground mb-1">Company Name *</label>
                    <input
                      type="text"
                      required
                      value={formData.name}
                      onChange={(e) => handleNameChange(e.target.value)}
                      className="w-full px-3.5 py-2 text-xs font-medium rounded-xl border border-border bg-muted/30 focus:bg-background outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-foreground mb-1">Company Code *</label>
                    <input
                      type="text"
                      required
                      disabled={selectedCompany.slug === 'innoveity' || selectedCompany.companyCode === 'INN001'}
                      value={formData.companyCode}
                      onChange={(e) => setFormData({ ...formData, companyCode: e.target.value.toUpperCase() })}
                      className="w-full px-3.5 py-2 text-xs font-mono font-bold rounded-xl border border-border bg-muted/30 focus:bg-background outline-none disabled:opacity-50"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-foreground mb-1">Contact Email</label>
                    <input
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      className="w-full px-3.5 py-2 text-xs font-medium rounded-xl border border-border bg-muted/30 focus:bg-background outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-foreground mb-1">Phone Number</label>
                    <input
                      type="text"
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                      className="w-full px-3.5 py-2 text-xs font-medium rounded-xl border border-border bg-muted/30 focus:bg-background outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-foreground mb-1">Website URL</label>
                    <input
                      type="url"
                      value={formData.website}
                      onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                      className="w-full px-3.5 py-2 text-xs font-medium rounded-xl border border-border bg-muted/30 focus:bg-background outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-foreground mb-1">Timezone</label>
                    <select
                      value={formData.timezone}
                      onChange={(e) => setFormData({ ...formData, timezone: e.target.value })}
                      className="w-full px-3.5 py-2 text-xs font-bold rounded-xl border border-border bg-muted/30 focus:bg-background cursor-pointer outline-none"
                    >
                      <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
                      <option value="UTC">UTC</option>
                      <option value="America/New_York">America/New_York (EST)</option>
                      <option value="Europe/London">Europe/London (GMT)</option>
                      <option value="Asia/Dubai">Asia/Dubai (GST)</option>
                      <option value="Asia/Singapore">Asia/Singapore (SGT)</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-foreground mb-1">Office Address</label>
                  <input
                    type="text"
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    className="w-full px-3.5 py-2 text-xs font-medium rounded-xl border border-border bg-muted/30 focus:bg-background outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-foreground mb-1">Update Company Logo</label>
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2 px-4 py-2 rounded-xl bg-muted/50 hover:bg-muted border border-border text-xs font-bold text-foreground cursor-pointer transition-colors">
                      <Upload className="h-4 w-4 text-primary" />
                      <span>Choose New Logo</span>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleLogoFileChange}
                        className="hidden"
                      />
                    </label>
                    {logoPreview && (
                      <div className="h-9 w-9 rounded-xl border border-border overflow-hidden bg-muted/30 p-1 flex items-center justify-center">
                        <img src={logoPreview} alt="Logo preview" className="h-full w-full object-contain" />
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-end gap-3 pt-4 border-t border-border/60">
                  <button
                    type="button"
                    onClick={() => setEditModalOpen(false)}
                    className="px-4 py-2 rounded-xl text-xs font-bold text-muted-foreground hover:bg-muted cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-5 py-2 rounded-xl bg-primary text-white text-xs font-extrabold hover:bg-primary/90 shadow-md cursor-pointer disabled:opacity-50"
                  >
                    {submitting ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* VIEW COMPANY DRAWER */}
      <AnimatePresence>
        {viewDrawerOpen && selectedCompany && (
          <div className="fixed inset-0 z-50 overflow-hidden bg-slate-950/50 backdrop-blur-xs">
            <div className="absolute inset-0" onClick={() => setViewDrawerOpen(false)} />

            <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
              <motion.div
                initial={{ x: '100%' }}
                animate={{ x: 0 }}
                exit={{ x: '100%' }}
                transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                className="w-screen max-w-md bg-card border-l border-border/80 shadow-2xl p-6 sm:p-8 flex flex-col justify-between overflow-y-auto text-left"
              >
                <div className="space-y-6">
                  {/* Drawer Header */}
                  <div className="flex items-center justify-between border-b border-border/60 pb-4">
                    <div className="flex items-center gap-3">
                      <div className="h-12 w-12 rounded-2xl border border-border/60 bg-muted/40 flex items-center justify-center overflow-hidden shrink-0 shadow-xs">
                        {selectedCompany.logo ? (
                          <img
                            src={getUploadUrl(selectedCompany.logo)}
                            alt={selectedCompany.name}
                            className="h-full w-full object-contain p-1"
                          />
                        ) : (
                          <Building2 className="h-6 w-6 text-emerald-600" />
                        )}
                      </div>
                      <div>
                        <h2 className="text-lg font-extrabold text-foreground">{selectedCompany.name}</h2>
                        <span className="font-mono text-xs font-bold text-emerald-600 bg-emerald-500/10 px-2 py-0.5 rounded-md">
                          {selectedCompany.companyCode}
                        </span>
                      </div>
                    </div>

                    <button
                      onClick={() => setViewDrawerOpen(false)}
                      className="p-2 rounded-xl text-muted-foreground hover:text-foreground cursor-pointer"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>

                  {/* Informational Callout Section */}
                  <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-800 dark:text-emerald-300 text-xs space-y-1.5 shadow-xs">
                    <div className="flex items-center gap-2 font-black uppercase text-[11px] tracking-wider text-emerald-700 dark:text-emerald-400">
                      <Info className="h-4 w-4 shrink-0" />
                      <span>Current Ownership</span>
                    </div>
                    <p className="font-medium leading-relaxed">
                      This organization currently owns all existing CRM data.
                    </p>
                    <p className="font-medium leading-relaxed text-emerald-700/80 dark:text-emerald-300/80 text-[11px]">
                      Future phases will migrate users, projects, attendance, leave, work logs, and chat into organization-specific data.
                    </p>
                  </div>

                  {/* Details List */}
                  <div className="space-y-4 pt-2">
                    <h4 className="text-xs font-black uppercase text-muted-foreground tracking-wider">
                      Organization Profile
                    </h4>

                    <div className="space-y-3 font-medium text-xs">
                      <div className="flex items-center justify-between p-3 rounded-2xl bg-muted/30 border border-border/40">
                        <span className="text-muted-foreground">Status</span>
                        <span
                          className={`px-3 py-1 rounded-full text-[10px] font-extrabold ${
                            selectedCompany.status === 'ACTIVE'
                              ? 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20'
                              : 'bg-amber-500/10 text-amber-600 border border-amber-500/20'
                          }`}
                        >
                          {selectedCompany.status}
                        </span>
                      </div>

                      <div className="flex items-center justify-between p-3 rounded-2xl bg-muted/30 border border-border/40">
                        <span className="text-muted-foreground">URL Slug</span>
                        <span className="font-mono font-bold text-foreground">{selectedCompany.slug}</span>
                      </div>

                      <div className="flex items-center justify-between p-3 rounded-2xl bg-muted/30 border border-border/40">
                        <span className="text-muted-foreground">Timezone</span>
                        <span className="font-bold text-foreground">{selectedCompany.timezone}</span>
                      </div>

                      <div className="flex items-center justify-between p-3 rounded-2xl bg-muted/30 border border-border/40">
                        <span className="text-muted-foreground flex items-center gap-1.5">
                          <Mail className="h-3.5 w-3.5 text-muted-foreground" /> Email
                        </span>
                        <span className="font-bold text-foreground">{selectedCompany.email || 'Not set'}</span>
                      </div>

                      <div className="flex items-center justify-between p-3 rounded-2xl bg-muted/30 border border-border/40">
                        <span className="text-muted-foreground flex items-center gap-1.5">
                          <Phone className="h-3.5 w-3.5 text-muted-foreground" /> Phone
                        </span>
                        <span className="font-bold text-foreground">{selectedCompany.phone || 'Not set'}</span>
                      </div>

                      <div className="flex items-center justify-between p-3 rounded-2xl bg-muted/30 border border-border/40">
                        <span className="text-muted-foreground flex items-center gap-1.5">
                          <Globe className="h-3.5 w-3.5 text-muted-foreground" /> Website
                        </span>
                        {selectedCompany.website ? (
                          <a
                            href={selectedCompany.website}
                            target="_blank"
                            rel="noreferrer"
                            className="font-bold text-emerald-600 hover:underline"
                          >
                            {selectedCompany.website}
                          </a>
                        ) : (
                          <span className="font-bold text-foreground">Not set</span>
                        )}
                      </div>

                      <div className="flex items-start justify-between p-3 rounded-2xl bg-muted/30 border border-border/40">
                        <span className="text-muted-foreground flex items-center gap-1.5 shrink-0">
                          <MapPin className="h-3.5 w-3.5 text-muted-foreground" /> Address
                        </span>
                        <span className="font-bold text-foreground text-right pl-4">
                          {selectedCompany.address || 'Not set'}
                        </span>
                      </div>

                      <div className="flex items-center justify-between p-3 rounded-2xl bg-muted/30 border border-border/40">
                        <span className="text-muted-foreground">Registered On</span>
                        <span className="font-bold text-foreground">{formatDate(selectedCompany.createdAt)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Read-Only Organization Settings Section */}
                  <div className="space-y-4 pt-4 border-t border-border/40">
                    <h4 className="text-xs font-black uppercase text-muted-foreground tracking-wider flex items-center gap-1.5">
                      <Cog className="h-3.5 w-3.5 text-emerald-600" /> Organization Settings
                    </h4>

                    <div className="space-y-3 font-medium text-xs">
                      <div className="flex items-center justify-between p-3 rounded-2xl bg-muted/30 border border-border/40">
                        <span className="text-muted-foreground">Timezone</span>
                        <span className="font-bold text-foreground">
                          {selectedCompanySettings?.timezone || selectedCompany.timezone || 'Asia/Kolkata'}
                        </span>
                      </div>

                      <div className="flex items-center justify-between p-3 rounded-2xl bg-muted/30 border border-border/40">
                        <span className="text-muted-foreground">Working Hours</span>
                        <span className="font-mono font-bold text-foreground">
                          {formatWorkingHoursRange(selectedCompanySettings?.clockInTime, selectedCompanySettings?.clockOutTime)}
                        </span>
                      </div>

                      <div className="flex items-center justify-between p-3 rounded-2xl bg-muted/30 border border-border/40">
                        <span className="text-muted-foreground">Auto Clock-Out</span>
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[10px] font-extrabold ${
                            selectedCompanySettings?.autoClockOutEnabled !== false
                              ? 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20'
                              : 'bg-muted text-muted-foreground border border-border'
                          }`}
                        >
                          {selectedCompanySettings?.autoClockOutEnabled !== false ? 'Enabled' : 'Disabled'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Organization Usage & Health Overview Card */}
                  <OrganizationUsageCard stats={companyStats} company={selectedCompany} />

                  {/* Tenant Chat Access Controls Card */}
                  <div className="p-4 rounded-2xl bg-card border border-border/60 dark:border-slate-800/80 shadow-xs space-y-4">
                    <div className="flex items-center justify-between border-b border-border/30 pb-3">
                      <div className="flex items-center gap-2.5">
                        <div className="h-8 w-8 rounded-xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center shrink-0">
                          <MessageSquare className="h-4 w-4" />
                        </div>
                        <div>
                          <h4 className="text-xs font-extrabold text-foreground">Chat Access Controls</h4>
                          <p className="text-[10px] text-muted-foreground">Enable or disable Chat only for this company.</p>
                        </div>
                      </div>
                      <span className="inline-flex items-center text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                        Tenant Only
                      </span>
                    </div>

                    <div className="space-y-3">
                      {/* Admin Chat Switch */}
                      <div className="flex items-center justify-between p-3 rounded-xl border border-border/40 bg-muted/20">
                        <div className="space-y-0.5 pr-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-foreground">Admin Chat</span>
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${tenantChatAdmins ? 'bg-emerald-500/10 text-emerald-600' : 'bg-muted text-muted-foreground'}`}>
                              {tenantChatAdmins ? 'Enabled' : 'Disabled'}
                            </span>
                          </div>
                          <p className="text-[10px] text-muted-foreground">Allow company admins to use Chat.</p>
                        </div>

                        <button
                          type="button"
                          role="switch"
                          aria-checked={tenantChatAdmins}
                          onClick={() => handleTenantChatToggleClick('ADMIN')}
                          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                            tenantChatAdmins ? 'bg-primary' : 'bg-slate-300 dark:bg-slate-700'
                          }`}
                        >
                          <span
                            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-md transition duration-200 ease-in-out ${
                              tenantChatAdmins ? 'translate-x-4' : 'translate-x-0'
                            }`}
                          />
                        </button>
                      </div>

                      {/* User Chat Switch */}
                      <div className="flex items-center justify-between p-3 rounded-xl border border-border/40 bg-muted/20">
                        <div className="space-y-0.5 pr-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-foreground">User Chat</span>
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${tenantChatUsers ? 'bg-emerald-500/10 text-emerald-600' : 'bg-muted text-muted-foreground'}`}>
                              {tenantChatUsers ? 'Enabled' : 'Disabled'}
                            </span>
                          </div>
                          <p className="text-[10px] text-muted-foreground">Allow Team Leaders, Employees &amp; Interns.</p>
                        </div>

                        <button
                          type="button"
                          role="switch"
                          aria-checked={tenantChatUsers}
                          onClick={() => handleTenantChatToggleClick('USER')}
                          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                            tenantChatUsers ? 'bg-primary' : 'bg-slate-300 dark:bg-slate-700'
                          }`}
                        >
                          <span
                            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-md transition duration-200 ease-in-out ${
                              tenantChatUsers ? 'translate-x-4' : 'translate-x-0'
                            }`}
                          />
                        </button>
                      </div>
                    </div>

                    <div className="flex items-start gap-2 p-2.5 rounded-xl bg-muted/40 border border-border/30 text-[10px] text-muted-foreground">
                      <Info className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                      <span>Tenant override only. Global platform settings still take priority.</span>
                    </div>
                  </div>

                  {/* Subscription Plan Switcher */}
                  <div className="p-3.5 rounded-2xl bg-muted/30 border border-border/40 space-y-2">
                    <div className="flex items-center justify-between text-xs font-bold text-foreground">
                      <span>Manage Subscription Plan</span>
                      <SubscriptionBadge plan={selectedCompany.subscriptionPlan} />
                    </div>
                    <div className="flex items-center gap-2">
                      {plans.map((p) => {
                        const active = (selectedCompany.subscriptionPlan?.code || 'STARTER') === p.code;
                        return (
                          <button
                            key={p.id}
                            disabled={active}
                            onClick={() => handleChangeSubscriptionPlan(selectedCompany.id, p.code)}
                            className={`flex-1 py-1.5 rounded-xl text-[11px] font-extrabold border transition-all cursor-pointer ${
                              active
                                ? 'bg-primary text-white border-primary shadow-sm'
                                : 'bg-background hover:bg-muted text-foreground border-border'
                            }`}
                          >
                            {p.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Drawer Navigation Sub-Tabs */}
                  <div className="flex items-center gap-2 border-b border-border/40 pb-2">
                    <button
                      onClick={() => setDrawerTab('overview')}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                        drawerTab === 'overview' ? 'bg-primary text-white' : 'text-muted-foreground hover:bg-muted'
                      }`}
                    >
                      Usage Metrics
                    </button>
                    <button
                      onClick={() => setDrawerTab('audit')}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                        drawerTab === 'audit' ? 'bg-primary text-white' : 'text-muted-foreground hover:bg-muted'
                      }`}
                    >
                      Audit Timeline
                    </button>
                  </div>

                  {drawerTab === 'audit' ? (
                    <TenantAuditTimeline organizationId={selectedCompany.id} />
                  ) : (
                    /* Company Usage Statistics Section */
                    <div className="space-y-4 pt-2">
                      <h4 className="text-xs font-black uppercase text-muted-foreground tracking-wider flex items-center gap-1.5">
                        <FolderKanban className="h-3.5 w-3.5 text-emerald-600" /> Usage & Entity Metrics
                      </h4>

                      {companyStats ? (
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                          <div className="p-3 rounded-2xl bg-muted/30 border border-border/40 text-center">
                            <div className="flex items-center justify-center gap-1.5 text-muted-foreground text-[11px] font-bold mb-1">
                              <Users className="h-3.5 w-3.5 text-blue-500" /> Users
                            </div>
                            <div className="font-extrabold text-lg text-foreground">{companyStats.users || 0}</div>
                          </div>

                          <div className="p-3 rounded-2xl bg-muted/30 border border-border/40 text-center">
                            <div className="flex items-center justify-center gap-1.5 text-muted-foreground text-[11px] font-bold mb-1">
                              <FolderKanban className="h-3.5 w-3.5 text-purple-500" /> Projects
                            </div>
                            <div className="font-extrabold text-lg text-foreground">{companyStats.projects || 0}</div>
                          </div>

                          <div className="p-3 rounded-2xl bg-muted/30 border border-border/40 text-center">
                            <div className="flex items-center justify-center gap-1.5 text-muted-foreground text-[11px] font-bold mb-1">
                              <Clock className="h-3.5 w-3.5 text-emerald-500" /> Attendance
                            </div>
                            <div className="font-extrabold text-lg text-foreground">{companyStats.attendances || 0}</div>
                          </div>

                          <div className="p-3 rounded-2xl bg-muted/30 border border-border/40 text-center">
                            <div className="flex items-center justify-center gap-1.5 text-muted-foreground text-[11px] font-bold mb-1">
                              <ClipboardList className="h-3.5 w-3.5 text-amber-500" /> Work Logs
                            </div>
                            <div className="font-extrabold text-lg text-foreground">{companyStats.workLogs || 0}</div>
                          </div>

                          <div className="p-3 rounded-2xl bg-muted/30 border border-border/40 text-center">
                            <div className="flex items-center justify-center gap-1.5 text-muted-foreground text-[11px] font-bold mb-1">
                              <FileText className="h-3.5 w-3.5 text-rose-500" /> Leaves
                            </div>
                            <div className="font-extrabold text-lg text-foreground">{companyStats.leaveRequests || 0}</div>
                          </div>

                          <div className="p-3 rounded-2xl bg-muted/30 border border-border/40 text-center">
                            <div className="flex items-center justify-center gap-1.5 text-muted-foreground text-[11px] font-bold mb-1">
                              <MessageSquare className="h-3.5 w-3.5 text-indigo-500" /> Chat Rooms
                            </div>
                            <div className="font-extrabold text-lg text-foreground">{companyStats.chatRooms || 0}</div>
                          </div>
                        </div>
                      ) : (
                        <div className="p-4 rounded-2xl bg-muted/20 border border-border/40 text-center text-xs text-muted-foreground font-medium">
                          Loading usage metrics...
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="pt-6 border-t border-border/60 flex items-center gap-3">
                  <button
                    disabled={selectedCompany.slug === 'innoveity' || selectedCompany.companyCode === 'INN001'}
                    onClick={() => openDeleteCompanyModal(selectedCompany)}
                    className="px-4 py-2.5 rounded-2xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/30 text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                    title={
                      (selectedCompany.slug === 'innoveity' || selectedCompany.companyCode === 'INN001')
                        ? 'Default INNOVEITY tenant cannot be deleted.'
                        : 'Delete this organization permanently'
                    }
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Delete Company</span>
                  </button>

                  <button
                    onClick={() => setViewDrawerOpen(false)}
                    className="flex-1 py-2.5 rounded-2xl bg-muted hover:bg-muted/80 text-foreground text-xs font-bold transition-all cursor-pointer"
                  >
                    Close Profile
                  </button>
                </div>
              </motion.div>
            </div>
          </div>
        )}
      </AnimatePresence>


      {/* COMPANY PROVISION SUCCESS MODAL */}
      <CompanyProvisionSuccessModal
        isOpen={provisionSuccessOpen}
        onClose={() => setProvisionSuccessOpen(false)}
        data={provisionModalData}
      />

      {/* ORGANIZATION SETTINGS MODAL */}
      <AnimatePresence>
        {settingsModalOpen && selectedCompany && (
          <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-3xl rounded-3xl border border-border/80 bg-card p-6 sm:p-8 shadow-2xl space-y-6 text-left my-8"
            >
              <div className="flex items-center justify-between border-b border-border/60 pb-4">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-2xl bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 flex items-center justify-center">
                    <Cog className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-xl font-extrabold text-foreground">Organization Settings</h3>
                    <p className="text-xs text-muted-foreground font-medium">
                      Manage company-specific branding, theme color, timezone, and attendance parameters.
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setSettingsModalOpen(false)}
                  className="p-2 rounded-xl hover:bg-muted text-muted-foreground transition-colors cursor-pointer"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Live Brand Preview Card */}
              <div
                className="p-4 sm:p-5 rounded-2xl border transition-all space-y-3"
                style={{
                  borderColor: `${settingsData.primaryColor}40`,
                  backgroundColor: `${settingsData.primaryColor}08`
                }}
              >
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-3">
                    <div
                      className="h-10 w-10 rounded-xl overflow-hidden flex items-center justify-center font-extrabold text-white text-sm"
                      style={{ backgroundColor: settingsData.primaryColor }}
                    >
                      {settingsLogoPreview ? (
                        <img src={settingsLogoPreview} alt="Logo" className="h-full w-full object-cover" />
                      ) : (
                        (settingsData.companyName || 'C').charAt(0).toUpperCase()
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-extrabold text-sm text-foreground">
                          {settingsData.companyName || selectedCompany.name}
                        </span>
                        <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-card text-muted-foreground border border-border">
                          Brand Preview
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-xs font-bold mt-0.5" style={{ color: settingsData.primaryColor }}>
                        <span>●</span>
                        <span>Primary Color: {settingsData.primaryColor}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold px-3 py-1 rounded-xl bg-card border border-border text-foreground">
                      Hours: {formatWorkingHoursRange(settingsData.clockInTime, settingsData.clockOutTime)}
                    </span>
                    <span className={`text-xs font-bold px-3 py-1 rounded-xl border ${
                      settingsData.autoClockOutEnabled
                        ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
                        : 'bg-muted text-muted-foreground border-border'
                    }`}>
                      Auto Clock-Out: {settingsData.autoClockOutEnabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </div>
                </div>
              </div>

              {loadingSettings ? (
                <div className="py-12 flex flex-col items-center justify-center gap-3 text-muted-foreground">
                  <RefreshCw className="h-6 w-6 animate-spin text-emerald-600" />
                  <span className="text-xs font-bold">Loading organization settings...</span>
                </div>
              ) : (
                <form onSubmit={handleSaveSettings} className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Left Column: Company & Branding */}
                    <div className="space-y-4">
                      <h4 className="text-xs font-black uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                        <Building2 className="h-3.5 w-3.5" /> Company & Branding
                      </h4>

                      <div>
                        <label className="block text-xs font-bold text-foreground mb-1.5">
                          Company Name <span className="text-destructive">*</span>
                        </label>
                        <input
                          type="text"
                          required
                          value={settingsData.companyName}
                          onChange={(e) => setSettingsData(prev => ({ ...prev, companyName: e.target.value }))}
                          className="w-full rounded-2xl border border-border bg-background px-4 py-2.5 text-xs font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-foreground mb-1.5">Company Logo</label>
                        <div className="flex items-center gap-3">
                          <div className="h-12 w-12 rounded-2xl border border-border bg-muted/30 overflow-hidden flex items-center justify-center shrink-0">
                            {settingsLogoPreview ? (
                              <img src={settingsLogoPreview} alt="Logo" className="h-full w-full object-cover" />
                            ) : (
                              <Building2 className="h-6 w-6 text-muted-foreground" />
                            )}
                          </div>
                          <label className="flex-1 cursor-pointer inline-flex items-center justify-center gap-2 rounded-2xl border border-border/80 bg-muted/40 hover:bg-muted px-4 py-2.5 text-xs font-bold text-foreground transition-all">
                            <Upload className="h-3.5 w-3.5" />
                            <span>{settingsLogoFile ? settingsLogoFile.name : 'Upload Logo'}</span>
                            <input type="file" accept="image/*" onChange={handleSettingsLogoChange} className="hidden" />
                          </label>
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-foreground mb-1.5 flex items-center gap-1.5">
                          <Palette className="h-3.5 w-3.5 text-emerald-600" /> Primary Color
                        </label>
                        <div className="flex items-center gap-2 mb-2">
                          {['#10B981', '#3B82F6', '#6366F1', '#8B5CF6', '#EC4899', '#F59E0B'].map((c) => (
                            <button
                              key={c}
                              type="button"
                              onClick={() => setSettingsData(prev => ({ ...prev, primaryColor: c }))}
                              className="h-7 w-7 rounded-xl flex items-center justify-center transition-transform hover:scale-110 cursor-pointer border border-white/20"
                              style={{ backgroundColor: c }}
                            >
                              {settingsData.primaryColor.toUpperCase() === c.toUpperCase() && (
                                <Check className="h-4 w-4 text-white drop-shadow" />
                              )}
                            </button>
                          ))}
                        </div>
                        <input
                          type="text"
                          value={settingsData.primaryColor}
                          onChange={(e) => setSettingsData(prev => ({ ...prev, primaryColor: e.target.value }))}
                          placeholder="#10B981"
                          className="w-full rounded-2xl border border-border bg-background px-4 py-2 text-xs font-mono font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-foreground mb-1.5 flex items-center gap-1.5">
                          <Globe className="h-3.5 w-3.5" /> Organization Timezone
                        </label>
                        <select
                          value={settingsData.timezone}
                          onChange={(e) => setSettingsData(prev => ({ ...prev, timezone: e.target.value }))}
                          className="w-full rounded-2xl border border-border bg-background px-4 py-2.5 text-xs font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 cursor-pointer"
                        >
                          <option value="Asia/Kolkata">Asia/Kolkata (IST +05:30)</option>
                          <option value="UTC">UTC (GMT +00:00)</option>
                          <option value="America/New_York">America/New_York (EST -05:00)</option>
                          <option value="Europe/London">Europe/London (GMT +00:00)</option>
                          <option value="Asia/Dubai">Asia/Dubai (GST +04:00)</option>
                          <option value="Asia/Singapore">Asia/Singapore (SGT +08:00)</option>
                        </select>
                      </div>
                    </div>

                    {/* Right Column: Attendance Parameters */}
                    <div className="space-y-4">
                      <h4 className="text-xs font-black uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                        <Clock className="h-3.5 w-3.5" /> Attendance Parameters
                      </h4>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-bold text-foreground mb-1.5">Clock In Time</label>
                          <input
                            type="text"
                            placeholder="09:00"
                            value={settingsData.clockInTime}
                            onChange={(e) => setSettingsData(prev => ({ ...prev, clockInTime: e.target.value }))}
                            className="w-full rounded-2xl border border-border bg-background px-4 py-2.5 text-xs font-mono font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-bold text-foreground mb-1.5">Clock Out Time</label>
                          <input
                            type="text"
                            placeholder="18:00"
                            value={settingsData.clockOutTime}
                            onChange={(e) => setSettingsData(prev => ({ ...prev, clockOutTime: e.target.value }))}
                            className="w-full rounded-2xl border border-border bg-background px-4 py-2.5 text-xs font-mono font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                          />
                        </div>
                      </div>

                      <div className="p-4 rounded-2xl bg-muted/40 border border-border/60 flex items-center justify-between gap-4">
                        <div>
                          <div className="text-xs font-extrabold text-foreground">Auto Clock-Out System</div>
                          <div className="text-[11px] text-muted-foreground font-medium mt-0.5">
                            Automatically check out active employees at shift end boundary.
                          </div>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={settingsData.autoClockOutEnabled}
                          title={settingsData.autoClockOutEnabled ? 'Disable Auto Clock-Out' : 'Enable Auto Clock-Out'}
                          onClick={() => setSettingsData(prev => ({ ...prev, autoClockOutEnabled: !prev.autoClockOutEnabled }))}
                          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary/40 focus:ring-offset-2 ${
                            settingsData.autoClockOutEnabled ? 'bg-primary border-primary shadow-xs' : 'bg-slate-300 border-slate-400 dark:bg-slate-700 dark:border-slate-500 shadow-inner'
                          }`}
                        >
                          <span
                            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md border border-black/10 dark:border-white/10 transition duration-200 ease-in-out ${
                              settingsData.autoClockOutEnabled ? 'translate-x-5' : 'translate-x-0'
                            }`}
                          />
                        </button>
                      </div>

                      <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-800 dark:text-amber-300 text-xs font-medium space-y-1">
                        <div className="font-extrabold flex items-center gap-1.5">
                          <Info className="h-4 w-4 text-amber-600" />
                          <span>Safe Phase 4.1 Notice</span>
                        </div>
                        <p className="text-[11px] leading-relaxed">
                          Organization settings saved here are stored in parallel. Business modules (Attendance & Auto Clock-Out) will switch to using these settings in Phase 4.2.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-3 pt-4 border-t border-border/60">
                    <button
                      type="button"
                      onClick={() => setSettingsModalOpen(false)}
                      className="px-4 py-2.5 rounded-2xl bg-muted hover:bg-muted/80 text-foreground text-xs font-bold transition-all cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={submitting}
                      className="inline-flex items-center gap-2 px-6 py-2.5 rounded-2xl bg-primary hover:bg-primary-hover text-white text-xs font-bold transition-all cursor-pointer shadow-lg shadow-primary/20 disabled:opacity-50"
                    >
                      {submitting ? (
                        <>
                          <RefreshCw className="h-4 w-4 animate-spin" />
                          <span>Saving...</span>
                        </>
                      ) : (
                        <>
                          <Check className="h-4 w-4" />
                          <span>Save Settings</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      {/* POSITION CREATE / EDIT MODAL */}
      <AnimatePresence>
        {posModalOpen && (
          <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-lg rounded-3xl border border-border/60 bg-card p-6 sm:p-8 shadow-2xl space-y-4 text-left"
            >
              <div className="flex items-center justify-between border-b border-border/40 pb-3">
                <div className="flex items-center gap-2">
                  <Award className="h-5 w-5 text-emerald-600" />
                  <h3 className="text-base font-extrabold text-foreground">
                    {editingPos ? 'Edit Position' : 'Create New Position'}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setPosModalOpen(false)}
                  className="p-1 text-muted-foreground hover:text-foreground rounded-lg cursor-pointer"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <form onSubmit={handleSavePosition} className="space-y-4 text-xs">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="font-bold text-foreground block">Position Name *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Senior Software Engineer"
                      value={posForm.name}
                      onChange={(e) => setPosForm({ ...posForm, name: e.target.value })}
                      className="w-full rounded-xl border border-border/60 bg-muted/20 px-3.5 py-2 font-medium text-foreground focus:bg-background focus:ring-2 focus:ring-emerald-500/20 outline-none"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="font-bold text-foreground block">Position Code *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. SSE"
                      value={posForm.code}
                      onChange={(e) => setPosForm({ ...posForm, code: e.target.value.toUpperCase() })}
                      className="w-full rounded-xl border border-border/60 bg-muted/20 px-3.5 py-2 font-mono font-bold text-foreground focus:bg-background focus:ring-2 focus:ring-emerald-500/20 outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="font-bold text-foreground block">Hierarchy Level *</label>
                    <input
                      type="number"
                      min="1"
                      required
                      value={posForm.level}
                      onChange={(e) => setPosForm({ ...posForm, level: parseInt(e.target.value, 10) || 1 })}
                      className="w-full rounded-xl border border-border/60 bg-muted/20 px-3.5 py-2 font-bold text-foreground focus:bg-background focus:ring-2 focus:ring-emerald-500/20 outline-none"
                    />
                    <p className="text-[10px] text-muted-foreground">Lower number = Higher authority (1 = CEO/Director)</p>
                  </div>

                  <div className="space-y-1">
                    <label className="font-bold text-foreground block">Badge Accent Color</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={posForm.color}
                        onChange={(e) => setPosForm({ ...posForm, color: e.target.value })}
                        className="h-9 w-12 rounded-xl border border-border/60 bg-muted/20 p-1 cursor-pointer"
                      />
                      <input
                        type="text"
                        value={posForm.color}
                        onChange={(e) => setPosForm({ ...posForm, color: e.target.value })}
                        className="flex-1 rounded-xl border border-border/60 bg-muted/20 px-3 py-2 font-mono text-xs uppercase"
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="font-bold text-foreground block">Status</label>
                    <select
                      value={posForm.status}
                      onChange={(e) => setPosForm({ ...posForm, status: e.target.value })}
                      className="w-full rounded-xl border border-border/60 bg-muted/20 px-3.5 py-2 font-bold text-foreground focus:bg-background focus:ring-2 focus:ring-emerald-500/20 outline-none cursor-pointer"
                    >
                      <option value="ACTIVE">ACTIVE</option>
                      <option value="INACTIVE">INACTIVE</option>
                    </select>
                  </div>
                </div>

                <div className="flex justify-end gap-3 border-t border-border/40 pt-4">
                  <button
                    type="button"
                    onClick={() => setPosModalOpen(false)}
                    className="px-4 py-2 rounded-xl text-xs font-bold text-muted-foreground hover:bg-muted transition-all cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-5 py-2 rounded-xl bg-primary hover:bg-primary-hover text-white text-xs font-bold shadow-md shadow-primary/20 cursor-pointer transition-all disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {submitting && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                    <span>{editingPos ? 'Update Position' : 'Create Position'}</span>
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* DEPARTMENT CREATE / EDIT MODAL */}
      <AnimatePresence>
        {deptModalOpen && (
          <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-md rounded-3xl border border-border/60 bg-card p-6 sm:p-8 shadow-2xl space-y-4 text-left"
            >
              <div className="flex items-center justify-between border-b border-border/40 pb-3">
                <div className="flex items-center gap-2">
                  <Briefcase className="h-5 w-5 text-emerald-600" />
                  <h3 className="text-base font-extrabold text-foreground">
                    {editingDept ? 'Edit Department' : 'Create New Department'}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setDeptModalOpen(false)}
                  className="p-1 text-muted-foreground hover:text-foreground rounded-lg cursor-pointer"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <form onSubmit={handleSaveDepartment} className="space-y-4 text-xs">
                {/* Target Company Read-only Badge */}
                <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-xs flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-emerald-600" />
                    <span className="font-extrabold text-foreground">Target Company:</span>
                  </div>
                  <span className="font-black text-emerald-600">
                    {companies.find((c) => c.id === selectedOrgId)?.name || 'Selected Company'} ({companies.find((c) => c.id === selectedOrgId)?.companyCode || ''})
                  </span>
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-foreground block">Department Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Engineering"
                    value={deptForm.name}
                    onChange={(e) => setDeptForm({ ...deptForm, name: e.target.value })}
                    className="w-full rounded-xl border border-border/60 bg-muted/20 px-3.5 py-2 font-medium text-foreground focus:bg-background focus:ring-2 focus:ring-emerald-500/20 outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-foreground block">Department Code *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. ENG01"
                    value={deptForm.code}
                    onChange={(e) => setDeptForm({ ...deptForm, code: e.target.value.toUpperCase() })}
                    className="w-full rounded-xl border border-border/60 bg-muted/20 px-3.5 py-2 font-mono font-bold text-foreground focus:bg-background focus:ring-2 focus:ring-emerald-500/20 outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-foreground block">Description</label>
                  <textarea
                    rows={2}
                    placeholder="Brief description of department function..."
                    value={deptForm.description || ''}
                    onChange={(e) => setDeptForm({ ...deptForm, description: e.target.value })}
                    className="w-full rounded-xl border border-border/60 bg-muted/20 px-3.5 py-2 font-medium text-foreground focus:bg-background focus:ring-2 focus:ring-emerald-500/20 outline-none resize-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-foreground block">Status</label>
                  <select
                    value={deptForm.status || 'ACTIVE'}
                    onChange={(e) => setDeptForm({ ...deptForm, status: e.target.value })}
                    className="w-full rounded-xl border border-border/60 bg-muted/20 px-3.5 py-2 font-bold text-foreground focus:bg-background focus:ring-2 focus:ring-emerald-500/20 outline-none cursor-pointer"
                  >
                    <option value="ACTIVE">ACTIVE</option>
                    <option value="INACTIVE">INACTIVE</option>
                  </select>
                </div>

                <div className="flex justify-end gap-3 border-t border-border/40 pt-4">
                  <button
                    type="button"
                    onClick={() => setDeptModalOpen(false)}
                    className="px-4 py-2 rounded-xl text-xs font-bold text-muted-foreground hover:bg-muted transition-all cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-5 py-2 rounded-xl bg-primary hover:bg-primary-hover text-white text-xs font-bold shadow-md shadow-primary/20 cursor-pointer transition-all disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {submitting && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                    <span>{editingDept ? 'Update Department' : 'Create Department'}</span>
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* DEPARTMENT MEMBER STAGING MANAGER MODAL */}
      <AnimatePresence>
        {selectedDepartment && (
          <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-2xl rounded-3xl border border-border/60 bg-card p-6 sm:p-8 shadow-2xl space-y-6 text-left max-h-[90vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between border-b border-border/40 pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-2xl bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                    <Briefcase className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-extrabold text-foreground">Department Member Manager</h3>
                    <p className="text-xs text-muted-foreground font-medium">Assign users and configure department settings</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedDepartment(null)}
                  className="p-1.5 text-muted-foreground hover:text-foreground rounded-xl hover:bg-muted transition-colors cursor-pointer"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Section 1: Department Info */}
              <div className="space-y-3 bg-muted/20 p-4 rounded-2xl border border-border/60">
                <h4 className="text-xs font-black uppercase tracking-wider text-muted-foreground">Department Information</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-bold text-foreground block mb-1">Department Name</label>
                    <input
                      type="text"
                      value={editDeptName}
                      onChange={(e) => setEditDeptName(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs font-bold rounded-xl border border-border bg-background outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-foreground block mb-1">Department Code</label>
                    <input
                      type="text"
                      value={editDeptCode}
                      onChange={(e) => setEditDeptCode(e.target.value.toUpperCase())}
                      className="w-full px-3 py-1.5 text-xs font-mono font-bold rounded-xl border border-border bg-background outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* Section 2: Current Department Members */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-black uppercase tracking-wider text-muted-foreground">
                    Assigned Members ({stagedAssignedMembers.length})
                  </h4>
                  <div className="relative w-48">
                    <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
                    <input
                      type="text"
                      placeholder="Filter members..."
                      value={assignedMemberSearch}
                      onChange={(e) => setAssignedMemberSearch(e.target.value)}
                      className="w-full pl-8 pr-3 py-1 text-xs rounded-xl border border-border/60 bg-muted/30 outline-none"
                    />
                  </div>
                </div>

                {membersLoading ? (
                  <div className="p-6 text-center text-xs text-muted-foreground font-medium">Loading department members...</div>
                ) : stagedAssignedMembers.length === 0 ? (
                  <div className="p-4 text-center bg-muted/20 rounded-2xl border border-dashed border-border/60 text-xs text-muted-foreground font-medium">
                    No members currently assigned to this department.
                  </div>
                ) : (
                  <div className="max-h-48 overflow-y-auto space-y-2 pr-1 border border-border/40 p-2 rounded-2xl bg-muted/20">
                    {stagedAssignedMembers
                      .filter((u) => {
                        const q = assignedMemberSearch.toLowerCase();
                        return (u.name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q);
                      })
                      .map((u) => (
                        <div key={u.id} className="flex items-center justify-between p-2.5 rounded-xl border border-border/40 bg-card">
                          <div className="flex items-center gap-3">
                            <UserAvatar user={u} className="h-8 w-8" />
                            <div>
                              <p className="text-xs font-bold text-foreground">{u.name}</p>
                              <p className="text-[10px] text-muted-foreground font-mono">{u.email}</p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRemoveStagedMember(u)}
                            className="p-1 rounded-lg text-rose-500 hover:bg-rose-500/10 transition-colors cursor-pointer"
                            title="Remove from department"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                  </div>
                )}
              </div>

              {/* Section 3: Add Members */}
              <div className="space-y-3 pt-2 border-t border-border/40">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-black uppercase tracking-wider text-muted-foreground">
                    Available Unassigned Members ({stagedUnassignedMembers.length})
                  </h4>
                  <div className="relative w-48">
                    <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
                    <input
                      type="text"
                      placeholder="Search unassigned..."
                      value={addMemberSearch}
                      onChange={(e) => setAddMemberSearch(e.target.value)}
                      className="w-full pl-8 pr-3 py-1 text-xs rounded-xl border border-border/60 bg-muted/30 outline-none"
                    />
                  </div>
                </div>

                {stagedUnassignedMembers.length === 0 ? (
                  <div className="p-4 text-center bg-muted/20 rounded-2xl border border-dashed border-border/60 text-xs text-muted-foreground font-medium">
                    No unassigned users available.
                  </div>
                ) : (
                  <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1 border border-border/40 p-2 rounded-2xl bg-muted/20">
                    {stagedUnassignedMembers
                      .filter((u) => {
                        const q = addMemberSearch.toLowerCase();
                        return (u.name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q);
                      })
                      .map((u) => (
                        <div
                          key={u.id}
                          onClick={() => handleAddStagedMember(u)}
                          className="flex items-center justify-between p-2.5 rounded-xl border border-border/40 bg-card hover:bg-emerald-500/10 hover:border-emerald-500/30 transition-all cursor-pointer group"
                        >
                          <div className="flex items-center gap-3">
                            <UserAvatar user={u} className="h-8 w-8" />
                            <div>
                              <p className="text-xs font-bold text-foreground group-hover:text-emerald-600 transition-colors">{u.name}</p>
                              <p className="text-[10px] text-muted-foreground font-mono">{u.email}</p>
                            </div>
                          </div>
                          <span className="text-[10px] font-extrabold px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                            + Add Member
                          </span>
                        </div>
                      ))}
                  </div>
                )}
              </div>

              {/* Section 4: Modal Actions */}
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-4 border-t border-border/60">
                <button
                  type="button"
                  onClick={handleDeleteDepartmentClick}
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-rose-500/10 text-rose-600 hover:bg-rose-500/20 border border-rose-500/30 text-xs font-bold transition-all cursor-pointer"
                >
                  <Trash2 className="h-4 w-4" />
                  <span>Delete Department</span>
                </button>

                <div className="flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setSelectedDepartment(null)}
                    className="px-4 py-2 rounded-xl text-xs font-bold text-muted-foreground hover:bg-muted transition-all cursor-pointer"
                  >
                    Cancel
                  </button>

                  <button
                    type="button"
                    disabled={saveDeptLoading}
                    onClick={handleSaveAllDeptChanges}
                    className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl bg-primary hover:bg-primary-hover text-white text-xs font-bold shadow-md shadow-primary/20 cursor-pointer transition-all disabled:opacity-50"
                  >
                    <Save className="h-4 w-4" />
                    <span>{saveDeptLoading ? 'Saving...' : 'Save Changes'}</span>
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* DELETE DEPARTMENT CONFIRMATION MODAL */}
      <AnimatePresence>
        {deleteDeptModal.open && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-card border border-border/80 rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl space-y-6 text-left"
            >
              <div className="flex items-center gap-3 border-b border-border/60 pb-4">
                <div className="p-3 rounded-2xl bg-rose-500/10 text-rose-600 border border-rose-500/20">
                  <AlertTriangle className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-foreground">Delete Department</h3>
                  <p className="text-xs text-muted-foreground font-medium">Reassignment Confirmation</p>
                </div>
              </div>

              <div className="space-y-3 bg-muted/20 p-4 rounded-2xl border border-border/60 text-xs font-medium text-foreground">
                <p className="font-extrabold text-foreground">
                  This department contains {deleteDeptModal.memberCount} member(s).
                </p>
                <p className="text-muted-foreground leading-relaxed">
                  If you continue, all members in this department will be moved to <strong className="text-emerald-600 font-bold">Unassigned</strong>.
                </p>
                <p className="font-bold text-foreground pt-1">Do you want to continue?</p>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2 border-t border-border/60">
                <button
                  type="button"
                  onClick={() => setDeleteDeptModal({ open: false, dept: null, memberCount: 0 })}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-muted-foreground hover:bg-muted cursor-pointer transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={saveDeptLoading}
                  onClick={() => executeDeleteDepartment(deleteDeptModal.dept.id)}
                  className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-md cursor-pointer transition-all disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" />
                  <span>{saveDeptLoading ? 'Deleting...' : 'Delete & Move Members'}</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* DELETE COMPANY CONFIRMATION MODAL */}
      <AnimatePresence>
        {deleteConfirmOpen && companyToDelete && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-card border border-border/80 rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl space-y-5 text-left"
            >
              {/* Modal Header */}
              <div className="flex items-center gap-3 border-b border-border/60 pb-4">
                <div className="p-3 rounded-2xl bg-rose-500/10 text-rose-600 border border-rose-500/20 shrink-0">
                  <AlertTriangle className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-foreground">Delete {companyToDelete.name}?</h3>
                  <p className="text-xs text-muted-foreground font-medium">This action cannot be undone.</p>
                </div>
              </div>

              {/* Error Alert Box */}
              {deleteErrorData && (
                <div className="p-3.5 rounded-2xl bg-rose-500/10 text-rose-600 border border-rose-500/20 text-xs font-medium flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
                  <span className="font-bold text-rose-700 dark:text-rose-400 leading-snug">
                    {deleteErrorData.message}
                  </span>
                </div>
              )}

              {/* Impact Summary Card */}
              {(() => {
                const memberCount = companyToDeleteStats?.users ?? companyToDelete?.usersCount ?? companyToDelete?._count?.users ?? companyStats?.users ?? 0;
                const projectCount = companyToDeleteStats?.projects ?? companyToDelete?.projectsCount ?? companyToDelete?._count?.projects ?? companyStats?.projects ?? 0;
                const taskCount = companyToDeleteStats?.tasks ?? companyToDelete?.tasksCount ?? companyToDelete?._count?.tasks ?? companyStats?.tasks ?? 0;
                const deptCount = companyToDeleteStats?.departments ?? companyToDelete?.departmentsCount ?? companyToDelete?._count?.departments ?? 0;
                const teamCount = companyToDeleteStats?.teams ?? companyToDelete?.teamsCount ?? companyToDelete?._count?.teams ?? 0;
                const leaveCount = companyToDeleteStats?.leaveRequests ?? companyToDelete?.leaveRequestsCount ?? 0;
                const attendanceCount = companyToDeleteStats?.attendances ?? companyToDelete?.attendancesCount ?? 0;
                const workLogCount = companyToDeleteStats?.workLogs ?? companyToDelete?.workLogsCount ?? 0;
                const ticketCount = companyToDeleteStats?.tickets ?? companyToDelete?.ticketsCount ?? 0;

                const totalRecordsToDelete = memberCount + projectCount + taskCount + deptCount + teamCount + leaveCount + attendanceCount + workLogCount + ticketCount;

                return (
                  <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 dark:bg-rose-500/10 p-4 space-y-3">
                    <div className="flex items-center justify-between border-b border-rose-500/20 pb-2">
                      <span className="text-xs font-extrabold text-foreground uppercase tracking-wider">
                        Impact Summary
                      </span>
                      <span className="text-[11px] font-mono font-bold text-rose-600 dark:text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded-full border border-rose-500/20">
                        {companyToDelete.companyCode || 'ORG'}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="flex items-center justify-between bg-background/80 dark:bg-background/40 px-3 py-1.5 rounded-xl border border-border/40">
                        <span className="text-muted-foreground font-medium">Company Members</span>
                        <span className="font-extrabold text-foreground font-mono">{memberCount}</span>
                      </div>
                      <div className="flex items-center justify-between bg-background/80 dark:bg-background/40 px-3 py-1.5 rounded-xl border border-border/40">
                        <span className="text-muted-foreground font-medium">Projects</span>
                        <span className="font-extrabold text-foreground font-mono">{projectCount}</span>
                      </div>
                      <div className="flex items-center justify-between bg-background/80 dark:bg-background/40 px-3 py-1.5 rounded-xl border border-border/40">
                        <span className="text-muted-foreground font-medium">Tasks</span>
                        <span className="font-extrabold text-foreground font-mono">{taskCount}</span>
                      </div>
                      <div className="flex items-center justify-between bg-background/80 dark:bg-background/40 px-3 py-1.5 rounded-xl border border-border/40">
                        <span className="text-muted-foreground font-medium">Departments</span>
                        <span className="font-extrabold text-foreground font-mono">{deptCount}</span>
                      </div>
                      <div className="flex items-center justify-between bg-background/80 dark:bg-background/40 px-3 py-1.5 rounded-xl border border-border/40">
                        <span className="text-muted-foreground font-medium">Teams</span>
                        <span className="font-extrabold text-foreground font-mono">{teamCount}</span>
                      </div>
                      <div className="flex items-center justify-between bg-background/80 dark:bg-background/40 px-3 py-1.5 rounded-xl border border-border/40">
                        <span className="text-muted-foreground font-medium">Leave Requests</span>
                        <span className="font-extrabold text-foreground font-mono">{leaveCount}</span>
                      </div>
                      <div className="flex items-center justify-between bg-background/80 dark:bg-background/40 px-3 py-1.5 rounded-xl border border-border/40">
                        <span className="text-muted-foreground font-medium">Attendance</span>
                        <span className="font-extrabold text-foreground font-mono">{attendanceCount}</span>
                      </div>
                      <div className="flex items-center justify-between bg-background/80 dark:bg-background/40 px-3 py-1.5 rounded-xl border border-border/40">
                        <span className="text-muted-foreground font-medium">Work Logs</span>
                        <span className="font-extrabold text-foreground font-mono">{workLogCount}</span>
                      </div>
                      <div className="col-span-2 flex items-center justify-between bg-background/80 dark:bg-background/40 px-3 py-1.5 rounded-xl border border-border/40">
                        <span className="text-muted-foreground font-medium">Tickets</span>
                        <span className="font-extrabold text-foreground font-mono">{ticketCount}</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between bg-rose-500/10 px-3.5 py-2 rounded-xl border border-rose-500/20 text-xs font-bold">
                      <span className="text-rose-700 dark:text-rose-300">Total Records To Delete</span>
                      <span className="font-mono text-sm text-rose-600 dark:text-rose-400 font-black">
                        {totalRecordsToDelete}
                      </span>
                    </div>
                  </div>
                );
              })()}

              {/* Confirmation Input Section */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-foreground block">
                  To permanently delete this company, type <span className="font-mono font-black text-rose-600 dark:text-rose-400">CONFIRM</span>
                </label>
                <input
                  type="text"
                  value={confirmDeleteText}
                  onChange={(e) => setConfirmDeleteText(e.target.value)}
                  placeholder="Type CONFIRM"
                  className="w-full rounded-2xl border border-border/80 bg-background px-4 py-2.5 text-xs font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-rose-500/30 focus:border-rose-500/50 transition-all placeholder:text-muted-foreground/60"
                />
              </div>

              {/* Modal Actions */}
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-border/60">
                <button
                  type="button"
                  onClick={() => {
                    setDeleteConfirmOpen(false);
                    setCompanyToDelete(null);
                    setCompanyToDeleteStats(null);
                    setDeleteErrorData(null);
                    setConfirmDeleteText('');
                  }}
                  className="px-4 py-2.5 rounded-2xl text-xs font-bold text-muted-foreground hover:bg-muted cursor-pointer transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={confirmDeleteText.trim() !== 'CONFIRM' || deletingCompany}
                  onClick={handleConfirmDeleteCompany}
                  className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-2xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-md cursor-pointer transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Trash2 className="h-4 w-4" />
                  <span>{deletingCompany ? 'Deleting...' : 'Delete Company'}</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
        {/* Tenant Chat Confirmation Modal */}
        {showTenantChatModal && selectedCompany && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-200">
            <div className="bg-card dark:bg-slate-900 border border-border rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4 text-left">
              <div className="flex items-center gap-3 text-primary">
                <AlertCircle className="h-6 w-6 shrink-0" />
                <h3 className="text-lg font-bold text-foreground">
                  {pendingTenantChatToggleRole === 'ADMIN'
                    ? (tenantChatAdmins ? `Disable Admin Chat?` : `Enable Admin Chat?`)
                    : (tenantChatUsers ? `Disable User Chat?` : `Enable User Chat?`)}
                </h3>
              </div>

              <div className="text-xs text-muted-foreground space-y-2 leading-relaxed">
                <p>Company: <strong className="text-foreground">{selectedCompany.name}</strong></p>
                <div className="p-3 rounded-xl bg-muted/40 border border-border/40 space-y-1.5">
                  <div className="font-bold text-foreground text-[11px] uppercase tracking-wider">Effect:</div>
                  <ul className="list-disc list-inside space-y-1 text-muted-foreground text-xs">
                    {pendingTenantChatToggleRole === 'ADMIN' ? (
                      tenantChatAdmins ? (
                        <>
                          <li>Chat disappears for company Admins.</li>
                          <li>Admins will be blocked from sending messages or joining chat rooms.</li>
                        </>
                      ) : (
                        <li>Company Admins regain full Chat access immediately.</li>
                      )
                    ) : (
                      tenantChatUsers ? (
                        <>
                          <li>Chat disappears for Team Leaders, Employees, and Interns in this company.</li>
                          <li>Users will be blocked from accessing <code className="bg-muted px-1 rounded">/chat</code>.</li>
                        </>
                      ) : (
                        <li>User Chat access will be restored immediately for this company.</li>
                      )
                    )}
                    <li>Existing message history and rooms remain safe.</li>
                    <li>Other companies remain unaffected.</li>
                  </ul>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  disabled={savingTenantChat}
                  onClick={() => { setShowTenantChatModal(false); setPendingTenantChatToggleRole(null); }}
                  className="px-4 py-2 rounded-xl text-xs font-semibold border border-border/80 hover:bg-muted text-foreground transition-all"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={savingTenantChat}
                  onClick={confirmTenantChatToggle}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-primary text-white hover:bg-primary-hover shadow-md transition-all flex items-center gap-2"
                >
                  {savingTenantChat && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                  <span>Confirm Toggle</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default OrganizationManager;
