import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api, { getUploadUrl, downloadFile } from '../services/api';
import {
  FolderOpen,
  Plus,
  Search,
  Calendar as CalendarIcon,
  Clock,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  PauseCircle,
  Archive,
  FileText,
  Users,
  UserCheck,
  Briefcase,
  ChevronRight,
  Upload,
  Download,
  Trash2,
  Edit3,
  MessageSquare,
  History,
  Activity,
  Layers,
  ArrowRight,
  X,
  AlertCircle,
  Sparkles,
  GripVertical,
  Building2
} from 'lucide-react';
import UserAvatar from '../components/common/UserAvatar';
import CompanyScopeSelector from '../components/common/CompanyScopeSelector';
import {
  ProjectCard,
  ProjectStatusBadge,
  PriorityBadge,
  ProgressRing,
  MemberAvatarGroup,
  TaskCard,
  KanbanColumn,
  MilestoneCard,
  ActivityItem
} from '../components/project';
import ConfirmModal from '../components/ConfirmModal';
import { getProjectStageProgress } from '../utils/projectProgress';

import { useCompanyScope } from '../context/CompanyScopeContext';
import { usePermissions } from '../hooks/usePermissions';
import { CRM_MODULE_KEYS } from '../config/crmModules';

const extractCompanyList = (responseData) => {
  if (Array.isArray(responseData)) return responseData;
  if (Array.isArray(responseData?.data)) return responseData.data;
  if (Array.isArray(responseData?.organizations)) return responseData.organizations;
  if (Array.isArray(responseData?.companies)) return responseData.companies;
  return [];
};

const Projects = () => {
  const { user } = useAuth();
  const { canEdit } = usePermissions();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const canEditProjects = isSuperAdmin || canEdit(CRM_MODULE_KEYS.PROJECTS);
  const { selectedOrgId, effectiveOrgId, companies: scopeCompanies } = useCompanyScope();
  const navigate = useNavigate();
  const location = useLocation();

  const safeCompanies = Array.isArray(scopeCompanies) ? scopeCompanies : [];

  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState([]);
  const [metrics, setMetrics] = useState({
    total: 0,
    active: 0,
    overdue: 0,
    completed: 0,
    onHold: 0,
    cancelled: 0,
    draft: 0,
    scheduled: 0,
    archived: 0
  });

  const [activeTab, setActiveTab] = useState('ALL');
  const urlSearch = new URLSearchParams(location.search).get('search') || '';
  const [searchQuery, setSearchQuery] = useState(urlSearch);
  const [alertMsg, setAlertMsg] = useState('');

  useEffect(() => {
    const sParam = new URLSearchParams(location.search).get('search') || '';
    setSearchQuery(sParam);
  }, [location.search]);

  // Modals state
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [detailDrawerOpen, setDetailDrawerOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState(null);
  const [drawerTab, setDrawerTab] = useState('Overview'); // Overview, Kanban Board, Milestones, Project Calendar, Documents, Audit History
  const [deleteConfirmModalOpen, setDeleteConfirmModalOpen] = useState(false);
  const [projectToDeleteId, setProjectToDeleteId] = useState(null);

  // Users & Teams for dropdown selectors
  const [teamLeaders, setTeamLeaders] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [teams, setTeams] = useState([]);

  // Milestone creation modal
  const [createMilestoneModal, setCreateMilestoneModal] = useState(false);
  const [milestoneFormData, setMilestoneFormData] = useState({
    title: '',
    description: '',
    dueDate: '',
    status: 'PENDING'
  });

  const fetchProjects = async (orgId = effectiveOrgId) => {
    const targetOrg = isSuperAdmin ? orgId : (effectiveOrgId || user?.organizationId);
    try {
      setLoading(true);
      const params = targetOrg ? { organizationId: targetOrg } : {};
      const res = await api.get('/projects', { params });
      setProjects(res.data.projects || []);
      setMetrics(res.data.metrics || {});
    } catch (err) {
      console.error('Failed to fetch projects:', err);
      setAlertMsg('Failed to load projects.');
    } finally {
      setLoading(false);
    }
  };

  const fetchUsersAndTeams = async (orgId = effectiveOrgId) => {
    const targetOrg = isSuperAdmin ? orgId : (effectiveOrgId || user?.organizationId);
    try {
      const params = targetOrg ? { organizationId: targetOrg } : {};
      const userRes = await api.get('/users', { params: { ...params, limit: 1000, status: 'ACTIVE' } });
      const usersList = userRes.data.users || [];
      setAllUsers(usersList);
      setTeamLeaders(usersList.filter(u => u.role === 'ADMIN' || u.role === 'TEAM_LEADER'));

      const teamRes = await api.get('/teams', { params });
      setTeams(teamRes.data || []);
    } catch (err) {
      console.error('Failed to fetch dropdown data:', err);
    }
  };

  useEffect(() => {
    fetchProjects(effectiveOrgId);
    fetchUsersAndTeams(effectiveOrgId);
  }, [effectiveOrgId, user?.organizationId]);

  // Form State
  const [wizardStep, setWizardStep] = useState(1);
  const [wizardSubmitAttempted, setWizardSubmitAttempted] = useState(false);
  const [wizardTouched, setWizardTouched] = useState({});
  const [draggedStageIndex, setDraggedStageIndex] = useState(null);
  const [dragOverStageIndex, setDragOverStageIndex] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    type: 'CLIENT',
    priority: 'MEDIUM',
    status: 'ACTIVE',
    estimatedStartDate: '',
    estimatedEndDate: '',
    teamId: '',
    leaderId: '',
    memberIds: [],
    workflowStages: [
      { name: 'To Do', color: '#64748B', order: 0, requiresApproval: false, approverRole: 'PROJECT_LEADER', approverId: '', isCompletedStage: false },
      { name: 'In Progress', color: '#EAB308', order: 1, requiresApproval: false, approverRole: 'PROJECT_LEADER', approverId: '', isCompletedStage: false },
      { name: 'In Review', color: '#8B5CF6', order: 2, requiresApproval: true, approverRole: 'PROJECT_LEADER', approverId: '', isCompletedStage: false },
      { name: 'Done', color: '#10B981', order: 3, requiresApproval: true, approverRole: 'PROJECT_LEADER', approverId: '', isCompletedStage: true }
    ]
  });

  const [fileUpload, setFileUpload] = useState(null);
  const [uploadingDoc, setUploadingDoc] = useState(false);

  const handleTeamSelect = (newTeamId) => {
    if (newTeamId === formData.teamId) {
      // Re-selecting exact same team preserves existing manual choices
      return;
    }

    if (!newTeamId) {
      setFormData(prev => ({
        ...prev,
        teamId: '',
        memberIds: prev.leaderId ? [prev.leaderId] : []
      }));
      return;
    }

    const selectedTeam = teams.find(t => t.id === newTeamId);
    const activeMembers = [];

    if (selectedTeam) {
      if (selectedTeam.leaderId) {
        const leaderUser = allUsers.find(u => u.id === selectedTeam.leaderId);
        if (leaderUser && leaderUser.status !== 'INACTIVE') {
          activeMembers.push(selectedTeam.leaderId);
        }
      }
      if (selectedTeam.members) {
        selectedTeam.members.forEach(m => {
          const uId = m.userId || m.user?.id;
          const memberUser = allUsers.find(u => u.id === uId);
          if (memberUser && memberUser.status !== 'INACTIVE') {
            activeMembers.push(uId);
          }
        });
      }
    }

    if (formData.leaderId && !activeMembers.includes(formData.leaderId)) {
      activeMembers.push(formData.leaderId);
    }

    const finalMemberIds = Array.from(new Set(activeMembers.filter(Boolean)));
    setFormData(prev => ({
      ...prev,
      teamId: newTeamId,
      memberIds: finalMemberIds
    }));
  };

  const handleLeaderSelect = (newLeaderId) => {
    setFormData(prev => {
      let updatedMembers = [...prev.memberIds];
      if (newLeaderId && !updatedMembers.includes(newLeaderId)) {
        updatedMembers.push(newLeaderId);
      }
      return {
        ...prev,
        leaderId: newLeaderId,
        memberIds: Array.from(new Set(updatedMembers.filter(Boolean)))
      };
    });
  };

  const getStepValidation = (step) => {
    if (step === 1) {
      if (!formData.name.trim()) return { valid: false, error: 'Project Name is required.', field: 'name' };
      if (!formData.estimatedStartDate) return { valid: false, error: 'Start Date is required.', field: 'estimatedStartDate' };
      if (!formData.estimatedEndDate) return { valid: false, error: 'End Date is required.', field: 'estimatedEndDate' };
      if (new Date(formData.estimatedEndDate) < new Date(formData.estimatedStartDate)) {
        return { valid: false, error: 'End Date must be greater than or equal to Start Date.', field: 'estimatedEndDate' };
      }
      if (!formData.leaderId) return { valid: false, error: 'Project Leader selection is required.', field: 'leaderId' };
      return { valid: true };
    }

    if (step === 2) {
      if (formData.memberIds.length === 0) {
        return { valid: false, error: 'At least one project member or leader must be assigned.', field: 'memberIds' };
      }
      return { valid: true };
    }

    if (step === 3) {
      const stages = formData.workflowStages || [];
      if (stages.length < 2 || stages.length > 10) {
        return { valid: false, error: 'Workflow must contain between 2 and 10 stages.', field: 'workflowStages' };
      }
      const names = new Set();
      let completedCount = 0;
      for (const stg of stages) {
        const name = (stg.name || '').trim();
        if (!name) return { valid: false, error: 'All workflow stage names must be non-empty.', field: 'workflowStages' };
        if (names.has(name.toLowerCase())) return { valid: false, error: `Duplicate stage name "${name}".`, field: 'workflowStages' };
        names.add(name.toLowerCase());
        if (stg.isCompletedStage) completedCount++;
      }
      if (completedCount !== 1) {
        return { valid: false, error: 'Select exactly one completed stage.', field: 'workflowStages' };
      }
      return { valid: true };
    }

    if (step === 4) {
      for (const stg of formData.workflowStages || []) {
        if (stg.requiresApproval && !stg.approverRole && !stg.approverId) {
          return { valid: false, error: `Select an approver for approval-required stage "${stg.name}".`, field: 'workflowStages' };
        }
      }
      return { valid: true };
    }

    return { valid: true };
  };

  const handleStageDragStart = (e, index) => {
    e.dataTransfer.setData('text/plain', index.toString());
    e.dataTransfer.effectAllowed = 'move';
    setDraggedStageIndex(index);
  };

  const handleStageDragOver = (e, index) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverStageIndex !== index) {
      setDragOverStageIndex(index);
    }
  };

  const handleStageDrop = (e, dropIndex) => {
    e.preventDefault();
    const dragIndexStr = e.dataTransfer.getData('text/plain');
    const dragIndex = draggedStageIndex !== null ? draggedStageIndex : parseInt(dragIndexStr, 10);

    if (isNaN(dragIndex) || dragIndex === dropIndex) {
      setDraggedStageIndex(null);
      setDragOverStageIndex(null);
      return;
    }

    const updatedStages = [...formData.workflowStages];
    const [draggedItem] = updatedStages.splice(dragIndex, 1);
    updatedStages.splice(dropIndex, 0, draggedItem);

    const reorderedStages = updatedStages.map((stg, idx) => ({
      ...stg,
      order: idx
    }));

    setFormData(prev => ({
      ...prev,
      workflowStages: reorderedStages
    }));

    setDraggedStageIndex(null);
    setDragOverStageIndex(null);
  };

  const openCreateModal = () => {
    const today = new Date().toISOString().split('T')[0];
    const nextMonth = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().split('T')[0];
    const defaultLeaderId = user?.id || '';

    setFormData({
      name: '',
      description: '',
      type: 'CLIENT',
      priority: 'MEDIUM',
      status: 'ACTIVE',
      estimatedStartDate: today,
      estimatedEndDate: nextMonth,
      teamId: '',
      leaderId: defaultLeaderId,
      memberIds: defaultLeaderId ? [defaultLeaderId] : [],
      workflowStages: [
        { name: 'To Do', color: '#64748B', order: 0, requiresApproval: false, approverRole: 'PROJECT_LEADER', approverId: '', isCompletedStage: false },
        { name: 'In Progress', color: '#EAB308', order: 1, requiresApproval: false, approverRole: 'PROJECT_LEADER', approverId: '', isCompletedStage: false },
        { name: 'In Review', color: '#8B5CF6', order: 2, requiresApproval: true, approverRole: 'PROJECT_LEADER', approverId: '', isCompletedStage: false },
        { name: 'Done', color: '#10B981', order: 3, requiresApproval: true, approverRole: 'PROJECT_LEADER', approverId: '', isCompletedStage: true }
      ]
    });
    setWizardStep(1);
    setWizardSubmitAttempted(false);
    setWizardTouched({});
    setCreateModalOpen(true);
  };

  const handleCreateSubmit = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!formData.name) {
      setAlertMsg('Project Name is required.');
      return;
    }
    if (new Date(formData.estimatedEndDate) <= new Date(formData.estimatedStartDate)) {
      setAlertMsg('Estimated End Date must be after Estimated Start Date.');
      return;
    }
    if (formData.teamId && formData.memberIds.length === 0) {
      setAlertMsg('Please select at least one project member.');
      return;
    }

    const stageValidation = getStepValidation(3);
    if (!stageValidation.valid) {
      setAlertMsg(stageValidation.error);
      return;
    }

    const targetOrg = effectiveOrgId || selectedOrgId || user?.organizationId || null;
    const payload = {
      ...formData,
      organizationId: targetOrg
    };

    console.log('[PROJECT CREATE]', {
      Payload: payload,
      Endpoint: '/projects'
    });

    try {
      const res = await api.post('/projects', payload);
      console.log('[PROJECT CREATE] Response:', res.data);
      setAlertMsg(`Project "${res.data.project?.name || formData.name}" (${res.data.project?.projectCode || ''}) created successfully.`);
      setCreateModalOpen(false);
      fetchProjects(targetOrg);
    } catch (err) {
      console.error('[PROJECT CREATE] Error:', err);
      setAlertMsg(err.response?.data?.message || 'Failed to create project.');
    }
  };

  const openEditModal = (proj) => {
    setSelectedProject(proj);
    const existingMemberIds = proj.members?.map(m => m.userId) || [];
    if (proj.leaderId && !existingMemberIds.includes(proj.leaderId)) {
      existingMemberIds.push(proj.leaderId);
    }
    setFormData({
      name: proj.name,
      description: proj.description || '',
      type: proj.type,
      priority: proj.priority,
      status: proj.status,
      estimatedStartDate: new Date(proj.estimatedStartDate).toISOString().split('T')[0],
      estimatedEndDate: new Date(proj.estimatedEndDate).toISOString().split('T')[0],
      teamId: proj.teamId || '',
      leaderId: proj.leaderId || '',
      memberIds: Array.from(new Set(existingMemberIds))
    });
    setEditModalOpen(true);
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    if (new Date(formData.estimatedEndDate) <= new Date(formData.estimatedStartDate)) {
      setAlertMsg('Estimated End Date must be after Estimated Start Date.');
      return;
    }
    if (formData.teamId && formData.memberIds.length === 0) {
      setAlertMsg('Please select at least one project member.');
      return;
    }

    try {
      const res = await api.put(`/projects/${selectedProject.id}`, formData);
      setAlertMsg(`Project "${res.data.project.name}" updated successfully.`);
      setEditModalOpen(false);
      fetchProjects();
      if (detailDrawerOpen && selectedProject?.id === res.data.project.id) {
        setSelectedProject(res.data.project);
      }
    } catch (err) {
      setAlertMsg(err.response?.data?.message || 'Failed to update project.');
    }
  };

  const openDetailDrawer = async (proj) => {
    try {
      const res = await api.get(`/projects/${proj.id}`);
      setSelectedProject(res.data);
      setDetailDrawerOpen(true);
    } catch (err) {
      setAlertMsg('Failed to load project details.');
    }
  };

  const confirmDeleteProject = (projId) => {
    setProjectToDeleteId(projId);
    setDeleteConfirmModalOpen(true);
  };

  const executeDeleteProject = async () => {
    if (!projectToDeleteId) return;
    const projId = projectToDeleteId;
    setDeleteConfirmModalOpen(false);
    setProjectToDeleteId(null);
    try {
      await api.delete(`/projects/${projId}`);
      setAlertMsg('Project deleted and archived successfully.');
      setDetailDrawerOpen(false);
      fetchProjects();
    } catch (err) {
      setAlertMsg(err.response?.data?.message || 'Failed to delete project.');
    }
  };

  const handleUploadDocument = async (e) => {
    e.preventDefault();
    if (!fileUpload || !selectedProject) return;
    try {
      setUploadingDoc(true);
      const data = new FormData();
      data.append('file', fileUpload);

      const res = await api.post(`/projects/${selectedProject.id}/documents`, data, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      setSelectedProject({
        ...selectedProject,
        documents: [res.data.document, ...(selectedProject.documents || [])]
      });

      setFileUpload(null);
      setUploadingDoc(false);
      setAlertMsg('Document uploaded successfully.');
    } catch (err) {
      setUploadingDoc(false);
      setAlertMsg(err.response?.data?.message || 'Failed to upload document.');
    }
  };

  const handleDeleteDocument = async (docId) => {
    try {
      await api.delete(`/projects/${selectedProject.id}/documents/${docId}`);
      setSelectedProject({
        ...selectedProject,
        documents: selectedProject.documents.filter(d => d.id !== docId)
      });
      setAlertMsg('Document removed successfully.');
    } catch (err) {
      setAlertMsg('Failed to delete document.');
    }
  };

  const handleCreateMilestone = async (e) => {
    e.preventDefault();
    if (!selectedProject) return;
    try {
      const res = await api.post('/milestones', {
        projectId: selectedProject.id,
        ...milestoneFormData
      });
      setSelectedProject({
        ...selectedProject,
        milestones: [...(selectedProject.milestones || []), res.data]
      });
      setCreateMilestoneModal(false);
      setMilestoneFormData({ title: '', description: '', dueDate: '', status: 'PENDING' });
      setAlertMsg(`Milestone "${res.data.title}" created successfully.`);
    } catch (err) {
      setAlertMsg(err.response?.data?.message || 'Failed to create milestone.');
    }
  };

  const handleTaskDrop = async (e, targetStatus) => {
    e.preventDefault();
    const taskId = e.dataTransfer.getData('text/plain');
    if (!taskId) return;
    try {
      const res = await api.put(`/tasks/${taskId}/status`, { status: targetStatus });
      setSelectedProject({
        ...selectedProject,
        tasks: selectedProject.tasks.map(t => t.id === taskId ? res.data : t)
      });
      fetchProjects();
    } catch (err) {
      setAlertMsg('Failed to update task status.');
    }
  };

  // Filter projects by active tab and search query
  const filteredProjects = projects.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          p.projectCode.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          (p.leader?.name && p.leader.name.toLowerCase().includes(searchQuery.toLowerCase())) ||
                          (p.description && p.description.toLowerCase().includes(searchQuery.toLowerCase()));

    if (!matchesSearch) return false;

    if (activeTab === 'ALL') return !p.isDeleted;
    if (activeTab === 'ACTIVE') return p.status === 'ACTIVE';
    if (activeTab === 'OVERDUE') return p.isOverdue;
    if (activeTab === 'DRAFT') return p.status === 'DRAFT';
    if (activeTab === 'SCHEDULED') return p.status === 'SCHEDULED';
    if (activeTab === 'ON_HOLD') return p.status === 'ON_HOLD';
    if (activeTab === 'COMPLETED') return p.status === 'COMPLETED';
    if (activeTab === 'CANCELLED') return p.status === 'CANCELLED';
    if (activeTab === 'ARCHIVED') return p.status === 'ARCHIVED';

    return true;
  });

  const currentCompany = safeCompanies.find((c) => c.id === selectedOrgId);

  return (
    <div className="flex-1 flex flex-col space-y-6 text-left">
      {/* Alert Banner */}
      {alertMsg && (
        <div className="bg-primary/10 border border-primary/30 text-primary px-4 py-3 rounded-2xl flex items-center justify-between animate-in fade-in duration-300">
          <span className="text-xs font-bold">{alertMsg}</span>
          <button onClick={() => setAlertMsg('')} className="text-primary hover:opacity-70">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Top Header & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-foreground flex items-center gap-2.5">
            <FolderOpen className="w-7 h-7 text-primary" /> Enterprise Projects
          </h1>
          <p className="text-xs text-muted-foreground mt-1 font-medium">
            Manage project lifecycles, 1:1 project chat groups, milestones, and Kanban workflows for {currentCompany?.name || 'selected company'}.
          </p>
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto">
          {/* Search Box near Create New Project button */}
          <div className="relative flex-1 sm:w-64">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search by code, title, or lead..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-card border border-border/60 text-xs focus:outline-none focus:ring-2 focus:ring-primary/40 shadow-xs"
            />
          </div>

          {(user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN' || user?.role === 'TEAM_LEADER') && canEditProjects && (
            <button
              onClick={openCreateModal}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-primary hover:bg-primary-hover text-white font-bold text-xs shadow-md shadow-primary/20 hover:scale-[1.01] active:scale-[0.99] transition-all cursor-pointer whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4 text-white" /> Create New Project
            </button>
          )}
        </div>
      </div>

      {/* Shared Company Selector Bar */}
      <CompanyScopeSelector onScopeChange={(newId) => {
        fetchProjects(newId);
        fetchUsersAndTeams(newId);
      }} />

      {/* Metric Cards Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3.5">
        <div className="bg-card p-4 rounded-2xl border border-border/60 shadow-sm space-y-1">
          <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Total Projects</div>
          <div className="text-2xl font-black text-foreground">{metrics.total}</div>
        </div>

        <div className="bg-card p-4 rounded-2xl border border-border/60 shadow-sm space-y-1">
          <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider text-primary">Active</div>
          <div className="text-2xl font-black text-primary">{metrics.active}</div>
        </div>

        <div className="bg-card p-4 rounded-2xl border border-border/60 shadow-sm space-y-1">
          <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider text-amber-500">Overdue</div>
          <div className="text-2xl font-black text-amber-600 dark:text-amber-400">{metrics.overdue}</div>
        </div>

        <div className="bg-card p-4 rounded-2xl border border-border/60 shadow-sm space-y-1">
          <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider text-blue-500">Completed</div>
          <div className="text-2xl font-black text-blue-600 dark:text-blue-400">{metrics.completed}</div>
        </div>

        <div className="bg-card p-4 rounded-2xl border border-border/60 shadow-sm space-y-1">
          <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider text-orange-500">On Hold</div>
          <div className="text-2xl font-black text-orange-600 dark:text-orange-400">{metrics.onHold}</div>
        </div>

        <div className="bg-card p-4 rounded-2xl border border-border/60 shadow-sm space-y-1">
          <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider text-gray-500">Archived</div>
          <div className="text-2xl font-black text-gray-600 dark:text-gray-400">{metrics.archived}</div>
        </div>
      </div>

      {/* Centered Filter Tabs */}
      <div className="flex items-center justify-center border-b border-border/40 pb-4">
        <div className="flex items-center justify-center gap-1.5 overflow-x-auto w-full sm:w-auto pb-2 sm:pb-0 scrollbar-none">
          {[
            { id: 'ALL', label: 'All Projects' },
            { id: 'ACTIVE', label: 'Active' },
            { id: 'OVERDUE', label: 'Overdue' },
            { id: 'DRAFT', label: 'Draft' },
            { id: 'SCHEDULED', label: 'Scheduled' },
            { id: 'ON_HOLD', label: 'On Hold' },
            { id: 'COMPLETED', label: 'Completed' },
            { id: 'ARCHIVED', label: 'Archived' }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
                activeTab === tab.id
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Project Cards Grid */}
      {loading ? (
        <div className="text-center py-16 text-muted-foreground text-sm font-bold animate-pulse">
          Loading project workspace...
        </div>
      ) : filteredProjects.length === 0 ? (
        <div className="text-center py-16 glass-card rounded-2xl border border-border/40 p-8 space-y-3">
          <FolderOpen className="w-12 h-12 text-muted-foreground/40 mx-auto" />
          <h3 className="text-base font-bold text-foreground">No projects found</h3>
          <p className="text-xs text-muted-foreground max-w-sm mx-auto">
            No projects match the selected filter criteria. Click "Create New Project" to get started.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredProjects.map(proj => (
            <ProjectCard
              key={proj.id}
              project={proj}
              onSelect={() => openDetailDrawer(proj)}
              onOpenChat={(proj) => {
                const targetId = proj?.id || proj?.projectId;
                navigate(`/chat?projectId=${targetId}`);
              }}
            />
          ))}
        </div>
      )}

      {/* Create Project Wizard Modal */}
      {createModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-card w-full max-w-3xl rounded-3xl border border-white/80 dark:border-white/10 shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
            {/* Modal Header */}
            <div className="px-6 py-4 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent border-b border-border/40 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-2xl bg-primary/15 border border-primary/20 text-primary">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-black tracking-tight text-foreground">Project & Workflow Setup Wizard</h2>
                    {isSuperAdmin && (
                      <span className="text-[10px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                        Company: {safeCompanies.find((c) => c.id === selectedOrgId)?.name || 'Selected Company'}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">Step {wizardStep} of 5 — {
                    wizardStep === 1 ? 'Basic Info' :
                    wizardStep === 2 ? 'Team Members' :
                    wizardStep === 3 ? 'Workflow Stages' :
                    wizardStep === 4 ? 'Approval Rules' : 'Preview & Create'
                  }</p>
                </div>
              </div>
              <button
                onClick={() => setCreateModalOpen(false)}
                className="p-2 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-all cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Stepper Navigation Bar */}
            <div className="px-6 py-2.5 bg-muted/20 border-b border-border/40 flex items-center justify-between gap-1 overflow-x-auto text-xs shrink-0">
              {[
                { step: 1, label: '1. Basic Info' },
                { step: 2, label: '2. Team Members' },
                { step: 3, label: '3. Workflow Stages' },
                { step: 4, label: '4. Approval Rules' },
                { step: 5, label: '5. Preview & Create' }
              ].map(s => (
                <button
                  key={s.step}
                  onClick={() => {
                    if (s.step < wizardStep) setWizardStep(s.step);
                  }}
                  disabled={s.step > wizardStep}
                  className={`px-3 py-1.5 rounded-xl font-bold transition-all whitespace-nowrap cursor-pointer ${
                    wizardStep === s.step
                      ? 'bg-primary text-white shadow-sm'
                      : s.step < wizardStep
                      ? 'bg-primary/15 text-primary hover:bg-primary/25'
                      : 'text-muted-foreground opacity-60 cursor-not-allowed'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>

            {/* Modal Body (Step Specific Content) */}
            <div className="p-6 overflow-y-auto space-y-5 text-left flex-1">
              {/* STEP 1: BASIC INFO */}
              {wizardStep === 1 && (
                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-bold text-foreground block mb-1.5">Project Name <span className="text-rose-500">*</span></label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Enterprise Website Redesign"
                      value={formData.name}
                      onChange={e => {
                        const val = e.target.value;
                        setFormData({ ...formData, name: val });
                        if (val.trim()) {
                          setWizardTouched(prev => ({ ...prev, name: true }));
                        }
                      }}
                      onBlur={() => setWizardTouched(prev => ({ ...prev, name: true }))}
                      className={`w-full px-4 py-2.5 rounded-2xl bg-muted/30 border text-sm text-foreground placeholder:text-muted-foreground/50 focus:bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all ${
                        (wizardSubmitAttempted || wizardTouched.name) && !formData.name.trim()
                          ? 'border-rose-500/80 ring-2 ring-rose-500/10'
                          : 'border-border/80'
                      }`}
                    />
                  </div>

                  <div>
                    <label className="text-xs font-bold text-foreground block mb-1.5">Description</label>
                    <textarea
                      rows={3}
                      placeholder="Brief summary of goals, scope, and target deliverables..."
                      value={formData.description}
                      onChange={e => setFormData({ ...formData, description: e.target.value })}
                      className="w-full px-4 py-2.5 rounded-2xl bg-muted/30 border border-border/80 text-sm text-foreground placeholder:text-muted-foreground/50 focus:bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all resize-none"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label className="text-xs font-bold text-foreground block mb-1.5">Project Type</label>
                      <select
                        value={formData.type}
                        onChange={e => setFormData({ ...formData, type: e.target.value })}
                        className="w-full px-3.5 py-2.5 rounded-2xl bg-muted/30 border border-border/80 text-xs font-semibold text-foreground focus:bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all cursor-pointer"
                      >
                        <option value="CLIENT">Client Project</option>
                        <option value="INTERNAL">Internal Improvement</option>
                        <option value="MAINTENANCE">Maintenance</option>
                        <option value="RND">R&D / Research</option>
                        <option value="TRAINING">Intern Training</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-xs font-bold text-foreground block mb-1.5">Priority</label>
                      <select
                        value={formData.priority}
                        onChange={e => setFormData({ ...formData, priority: e.target.value })}
                        className="w-full px-3.5 py-2.5 rounded-2xl bg-muted/30 border border-border/80 text-xs font-semibold text-foreground focus:bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all cursor-pointer"
                      >
                        <option value="LOW">🟢 Low</option>
                        <option value="MEDIUM">🟡 Medium</option>
                        <option value="HIGH">🟠 High</option>
                        <option value="CRITICAL">🔴 Critical</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-xs font-bold text-foreground block mb-1.5">Initial Status</label>
                      <select
                        value={formData.status}
                        onChange={e => setFormData({ ...formData, status: e.target.value })}
                        className="w-full px-3.5 py-2.5 rounded-2xl bg-muted/30 border border-border/80 text-xs font-bold text-primary focus:bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all cursor-pointer"
                      >
                        <option value="DRAFT">Draft</option>
                        <option value="SCHEDULED">Scheduled</option>
                        <option value="ACTIVE">Active</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-2xl bg-muted/20 border border-border/40">
                    <div>
                      <label className="text-xs font-bold text-foreground block mb-1.5">Estimated Start Date <span className="text-rose-500">*</span></label>
                      <input
                        type="date"
                        required
                        value={formData.estimatedStartDate}
                        onChange={e => setFormData({ ...formData, estimatedStartDate: e.target.value })}
                        className="w-full px-3.5 py-2 rounded-xl bg-background border border-border/80 text-xs font-medium text-foreground focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                      />
                    </div>

                    <div>
                      <label className="text-xs font-bold text-foreground block mb-1.5">Estimated End Date <span className="text-rose-500">*</span></label>
                      <input
                        type="date"
                        required
                        value={formData.estimatedEndDate}
                        onChange={e => setFormData({ ...formData, estimatedEndDate: e.target.value })}
                        className="w-full px-3.5 py-2 rounded-xl bg-background border border-border/80 text-xs font-medium text-foreground focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-bold text-foreground block mb-1.5">Project Leader</label>
                    <select
                      value={formData.leaderId}
                      onChange={e => handleLeaderSelect(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-2xl bg-muted/30 border border-border/80 text-xs font-medium text-foreground focus:bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all cursor-pointer"
                    >
                      <option value="">-- Unassigned --</option>
                      {teamLeaders.map(u => (
                        <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {/* STEP 2: TEAM MEMBERS */}
              {wizardStep === 2 && (
                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-bold text-foreground block mb-1.5">Assigned Team (Optional)</label>
                    <select
                      value={formData.teamId}
                      onChange={e => handleTeamSelect(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-2xl bg-muted/30 border border-border/80 text-xs font-medium text-foreground focus:bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all cursor-pointer"
                    >
                      <option value="">-- No Team --</option>
                      {teams.map(t => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-xs font-bold text-foreground block mb-1.5">
                      Select Project Members ({formData.memberIds.length} selected)
                    </label>

                    {(() => {
                      const selectedTeamObj = teams.find(t => t.id === formData.teamId);
                      const teamMemberUserIds = new Set();
                      if (selectedTeamObj) {
                        if (selectedTeamObj.leaderId) teamMemberUserIds.add(selectedTeamObj.leaderId);
                        if (selectedTeamObj.members) {
                          selectedTeamObj.members.forEach(m => teamMemberUserIds.add(m.userId || m.user?.id));
                        }
                      }
                      const activeUsers = allUsers.filter(u => u.status !== 'INACTIVE');

                      return (
                        <div className="max-h-64 overflow-y-auto p-3 rounded-2xl bg-muted/30 border border-border/80 grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {activeUsers.map(u => {
                            const isSelected = formData.memberIds.includes(u.id);
                            const isLeader = formData.leaderId && u.id === formData.leaderId;
                            const isExternal = formData.teamId && isSelected && !teamMemberUserIds.has(u.id);

                            return (
                              <label
                                key={u.id}
                                className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs cursor-pointer border transition-all ${
                                  isSelected
                                    ? 'bg-primary/10 border-primary/40 text-foreground font-bold shadow-2xs'
                                    : 'bg-background/60 border-border/40 text-muted-foreground hover:text-foreground hover:bg-background'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={isSelected || isLeader}
                                  disabled={isLeader}
                                  onChange={e => {
                                    if (isLeader) return;
                                    if (e.target.checked) {
                                      setFormData(prev => ({ ...prev, memberIds: Array.from(new Set([...prev.memberIds, u.id])) }));
                                    } else {
                                      setFormData(prev => ({ ...prev, memberIds: prev.memberIds.filter(id => id !== u.id) }));
                                    }
                                  }}
                                  className="rounded border-border text-primary focus:ring-primary/20 h-4 w-4 disabled:opacity-70"
                                />
                                <div className="flex-1 truncate">
                                  <div className="flex items-center gap-1.5 truncate">
                                    <span className="truncate block font-semibold">{u.name}</span>
                                    {isLeader && (
                                      <span className="bg-primary/15 text-primary text-[9px] px-1.5 py-0.2 rounded-md font-bold shrink-0">
                                        Project Leader
                                      </span>
                                    )}
                                  </div>
                                  <span className="text-[10px] text-muted-foreground font-mono uppercase block">{u.role}</span>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              )}

              {/* STEP 3: WORKFLOW STAGES */}
              {wizardStep === 3 && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-bold text-foreground">Configure Project Workflow Stages</h4>
                      <p className="text-[11px] text-muted-foreground">Min 2, Max 10 stages. Check "Approval" for review stages, and select exactly 1 Completed stage.</p>
                    </div>
                    <button
                      type="button"
                      disabled={formData.workflowStages.length >= 10}
                      onClick={() => {
                        if (formData.workflowStages.length >= 10) return;
                        const newOrder = formData.workflowStages.length;
                        setFormData(prev => ({
                          ...prev,
                          workflowStages: [
                            ...prev.workflowStages,
                            { name: `Stage ${newOrder + 1}`, color: '#0EA5E9', order: newOrder, requiresApproval: false, approverRole: 'PROJECT_LEADER', approverId: '', isCompletedStage: false }
                          ]
                        }));
                      }}
                      className="px-3 py-1.5 rounded-xl bg-primary/15 hover:bg-primary/25 text-primary text-xs font-bold transition-all flex items-center gap-1 cursor-pointer disabled:opacity-50"
                    >
                      <Plus className="w-3.5 h-3.5" /> Add Stage
                    </button>
                  </div>

                  <div className="space-y-3">
                    {formData.workflowStages.map((stg, index) => {
                      const isDragging = draggedStageIndex === index;
                      const isDragOver = dragOverStageIndex === index;

                      return (
                        <div
                          key={index}
                          draggable
                          onDragStart={e => handleStageDragStart(e, index)}
                          onDragOver={e => handleStageDragOver(e, index)}
                          onDrop={e => handleStageDrop(e, index)}
                          onDragEnd={() => {
                            setDraggedStageIndex(null);
                            setDragOverStageIndex(null);
                          }}
                          className={`p-3.5 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 transition-all duration-150 ${
                            isDragging
                              ? 'opacity-40 border-2 border-dashed border-primary/60 bg-primary/5 shadow-none'
                              : isDragOver
                              ? 'border-2 border-primary bg-primary/10 ring-2 ring-primary/20 scale-[1.01] shadow-lg'
                              : 'bg-muted/20 border border-border/40 hover:border-border/80 shadow-2xs'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 w-full sm:w-auto flex-1">
                            <div
                              className="p-1 rounded-md text-muted-foreground/60 hover:text-foreground hover:bg-muted/60 cursor-grab active:cursor-grabbing shrink-0 transition-colors"
                              title="Drag to reorder stage"
                            >
                              <GripVertical className="w-4 h-4" />
                            </div>
                            <span className="text-xs font-bold text-muted-foreground font-mono w-6 text-center">#{index + 1}</span>
                            <input
                              type="color"
                              value={stg.color}
                              onChange={e => {
                                const updated = [...formData.workflowStages];
                                updated[index].color = e.target.value;
                                setFormData({ ...formData, workflowStages: updated });
                              }}
                              className="w-8 h-8 rounded-lg cursor-pointer border border-border bg-transparent shrink-0"
                            />
                            <input
                              type="text"
                              value={stg.name}
                              onChange={e => {
                                const updated = [...formData.workflowStages];
                                updated[index].name = e.target.value;
                                setFormData({ ...formData, workflowStages: updated });
                              }}
                              placeholder="Stage Name"
                              className="flex-1 px-3 py-1.5 rounded-xl bg-background border border-border/80 text-xs font-bold text-foreground focus:ring-2 focus:ring-primary/20 focus:border-primary"
                            />
                          </div>

                          <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto justify-between sm:justify-end">
                            {index === formData.workflowStages.length - 1 ? (
                              <span className="px-2.5 py-1 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-extrabold text-[10px] uppercase border border-emerald-500/20">
                                Final Approval Stage – Auto Completed
                              </span>
                            ) : (
                              <label className="flex items-center gap-1.5 text-xs font-bold text-foreground cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={!!stg.requiresApproval}
                                  onChange={e => {
                                    const updated = [...formData.workflowStages];
                                    updated[index].requiresApproval = e.target.checked;
                                    setFormData({ ...formData, workflowStages: updated });
                                  }}
                                  className="rounded border-border text-primary focus:ring-primary/20 h-4 w-4"
                                />
                                <span className={stg.requiresApproval ? 'text-primary font-bold' : 'text-muted-foreground font-normal'}>
                                  {stg.requiresApproval ? '✓ Approval' : 'Approval'}
                                </span>
                              </label>
                            )}

                            <button
                              type="button"
                              disabled={formData.workflowStages.length <= 2}
                              onClick={() => {
                                if (formData.workflowStages.length <= 2) return;
                                const updated = formData.workflowStages.filter((_, idx) => idx !== index).map((s, idx) => ({ ...s, order: idx }));
                                setFormData({ ...formData, workflowStages: updated });
                              }}
                              className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-500/10 disabled:opacity-30 cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* STEP 4: APPROVAL RULES */}
              {wizardStep === 4 && (
                <div className="space-y-4">
                  <div>
                    <h4 className="text-xs font-bold text-foreground mb-1">Workflow Approval Configuration</h4>
                    <p className="text-[11px] text-muted-foreground">Define which stages require approval before tasks can move forward, and who evaluates them.</p>
                  </div>

                  <div className="space-y-3">
                    {formData.workflowStages.map((stg, index) => (
                      <div key={index} className="p-4 rounded-2xl bg-muted/20 border border-border/40 space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="w-3 h-3 rounded-full" style={{ backgroundColor: stg.color }} />
                            <span className="text-xs font-bold text-foreground">{stg.name}</span>
                            {stg.isCompletedStage && (
                              <span className="text-[10px] bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-bold px-2 py-0.5 rounded-md">
                                Completed Stage
                              </span>
                            )}
                          </div>

                          <label className="flex items-center gap-2 text-xs font-bold cursor-pointer">
                            <input
                              type="checkbox"
                              checked={!!stg.requiresApproval}
                              onChange={e => {
                                const updated = [...formData.workflowStages];
                                updated[index].requiresApproval = e.target.checked;
                                setFormData({ ...formData, workflowStages: updated });
                              }}
                              className="rounded border-border text-primary focus:ring-primary/20 h-4 w-4"
                            />
                            <span className={stg.requiresApproval ? 'text-primary' : 'text-muted-foreground'}>Requires Approval</span>
                          </label>
                        </div>

                        {stg.requiresApproval && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-border/30 animate-in fade-in duration-150">
                            <div>
                              <label className="text-[11px] font-bold text-muted-foreground block mb-1">Approver Role</label>
                              <select
                                value={stg.approverRole || 'PROJECT_LEADER'}
                                onChange={e => {
                                  const updated = [...formData.workflowStages];
                                  updated[index].approverRole = e.target.value;
                                  setFormData({ ...formData, workflowStages: updated });
                                }}
                                className="w-full px-3 py-1.5 rounded-xl bg-background border border-border/80 text-xs font-semibold text-foreground"
                              >
                                <option value="PROJECT_LEADER">Project Leader</option>
                                <option value="ADMIN">System Administrator</option>
                              </select>
                            </div>

                            <div>
                              <label className="text-[11px] font-bold text-muted-foreground block mb-1">Specific Approver (Optional)</label>
                              <select
                                value={stg.approverId || ''}
                                onChange={e => {
                                  const updated = [...formData.workflowStages];
                                  updated[index].approverId = e.target.value;
                                  setFormData({ ...formData, workflowStages: updated });
                                }}
                                className="w-full px-3 py-1.5 rounded-xl bg-background border border-border/80 text-xs font-medium text-foreground"
                              >
                                <option value="">-- Use Approver Role Default --</option>
                                {teamLeaders.map(u => (
                                  <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
                                ))}
                              </select>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* STEP 5: PREVIEW & CREATE */}
              {wizardStep === 5 && (
                <div className="space-y-4">
                  <div className="p-4 rounded-2xl bg-primary/10 border border-primary/20 space-y-2">
                    <h4 className="text-sm font-black text-primary">Project Configuration Summary</h4>
                    <p className="text-xs text-muted-foreground">Review your project settings before launching the workflow.</p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                    <div className="p-3.5 rounded-2xl bg-muted/20 border border-border/40 space-y-1">
                      <span className="text-muted-foreground font-bold block">Project Name & Code</span>
                      <span className="font-extrabold text-foreground block text-sm">{formData.name}</span>
                      <span className="text-[11px] text-muted-foreground uppercase">{formData.type} • {formData.priority} Priority</span>
                    </div>

                    <div className="p-3.5 rounded-2xl bg-muted/20 border border-border/40 space-y-1">
                      <span className="text-muted-foreground font-bold block">Timeline & Leader</span>
                      <span className="font-semibold text-foreground block">{formData.estimatedStartDate} → {formData.estimatedEndDate}</span>
                      <span className="text-muted-foreground block">
                        Leader: {teamLeaders.find(u => u.id === formData.leaderId)?.name || 'Unassigned'}
                      </span>
                    </div>
                  </div>

                  <div>
                    <h5 className="text-xs font-bold text-foreground mb-2">Configured Workflow Pipeline ({formData.workflowStages.length} Stages)</h5>
                    <div className="flex items-center gap-2 overflow-x-auto p-3 rounded-2xl bg-muted/20 border border-border/40">
                      {formData.workflowStages.map((stg, idx) => (
                        <div key={idx} className="flex items-center gap-2 shrink-0">
                          <div className="px-3 py-2 rounded-xl bg-background border border-border/80 shadow-2xs text-center space-y-1 min-w-[110px]">
                            <div className="flex items-center justify-center gap-1.5">
                              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: stg.color }} />
                              <span className="font-bold text-xs text-foreground truncate">{stg.name}</span>
                            </div>
                            <div className="flex items-center justify-center gap-1 text-[9px] font-bold">
                              {stg.isCompletedStage ? (
                                <span className="text-emerald-500">Completed</span>
                              ) : stg.requiresApproval ? (
                                <span className="text-purple-500">Approval Req</span>
                              ) : (
                                <span className="text-muted-foreground">Standard</span>
                              )}
                            </div>
                          </div>
                          {idx < formData.workflowStages.length - 1 && (
                            <ChevronRight className="w-4 h-4 text-muted-foreground/40 shrink-0" />
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer Actions */}
            <div className="px-6 py-4 border-t border-border/40 bg-muted/10 shrink-0 space-y-3">
              {/* Step Inline Validation Error Banner */}
              {(() => {
                const stepCheck = getStepValidation(wizardStep);
                if (!stepCheck.valid) {
                  const shouldShow = wizardSubmitAttempted || (stepCheck.field && wizardTouched[stepCheck.field]);
                  if (shouldShow) {
                    return (
                      <div className="px-4 py-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 text-xs font-bold flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        <span>{stepCheck.error}</span>
                      </div>
                    );
                  }
                }
                return null;
              })()}

              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => {
                    if (wizardStep > 1) {
                      setWizardStep(wizardStep - 1);
                      setWizardSubmitAttempted(false);
                    } else {
                      setCreateModalOpen(false);
                    }
                  }}
                  className="px-4 py-2.5 rounded-xl border border-border/80 text-xs font-bold text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-all cursor-pointer"
                >
                  {wizardStep === 1 ? 'Cancel' : '← Back'}
                </button>

                {wizardStep < 5 ? (
                  <button
                    type="button"
                    onClick={() => {
                      const check = getStepValidation(wizardStep);
                      if (!check.valid) {
                        setWizardSubmitAttempted(true);
                        if (check.field) {
                          setWizardTouched(prev => ({ ...prev, [check.field]: true }));
                        }
                        return;
                      }
                      setWizardSubmitAttempted(false);
                      setWizardStep(wizardStep + 1);
                    }}
                    className="px-6 py-2.5 rounded-xl bg-primary hover:bg-primary-hover text-primary-foreground text-xs font-extrabold shadow-md shadow-primary/20 transition-all flex items-center gap-1.5 cursor-pointer"
                  >
                    <span>Next Step</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={(e) => {
                      const check1 = getStepValidation(1);
                      if (!check1.valid) {
                        setWizardStep(1);
                        setWizardSubmitAttempted(true);
                        if (check1.field) setWizardTouched(prev => ({ ...prev, [check1.field]: true }));
                        return;
                      }
                      const check2 = getStepValidation(2);
                      if (!check2.valid) {
                        setWizardStep(2);
                        setWizardSubmitAttempted(true);
                        if (check2.field) setWizardTouched(prev => ({ ...prev, [check2.field]: true }));
                        return;
                      }
                      const check3 = getStepValidation(3);
                      if (!check3.valid) {
                        setWizardStep(3);
                        setWizardSubmitAttempted(true);
                        if (check3.field) setWizardTouched(prev => ({ ...prev, [check3.field]: true }));
                        return;
                      }
                      const check4 = getStepValidation(4);
                      if (!check4.valid) {
                        setWizardStep(4);
                        setWizardSubmitAttempted(true);
                        if (check4.field) setWizardTouched(prev => ({ ...prev, [check4.field]: true }));
                        return;
                      }
                      handleCreateSubmit(e);
                    }}
                    className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold shadow-md shadow-emerald-600/20 hover:scale-[1.01] transition-all flex items-center gap-2 cursor-pointer"
                  >
                    <Sparkles className="w-4 h-4 text-white" /> Launch Project & Workflow
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Compact Single-Card Dashboard Layout Modal */}
      {detailDrawerOpen && selectedProject && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200 outline-none"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDetailDrawerOpen(false);
          }}
        >
          <div className="relative w-full max-w-[820px] max-h-[90vh] bg-white dark:bg-card border border-[#E5E7EB] dark:border-border/50 rounded-[24px] p-6 shadow-2xl flex flex-col space-y-5 animate-in zoom-in-95 duration-200 overflow-y-auto text-left">
            {/* Top Header Section */}
            <div className="pb-4 border-b border-[#EEF2F7] dark:border-border/40 flex items-start justify-between gap-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-xs font-mono font-extrabold border border-emerald-500/20">
                    {selectedProject.projectCode || `PRJ-${selectedProject.id.slice(0, 4).toUpperCase()}`}
                  </span>
                </div>
                <h2 className="text-xl font-bold text-[#0F172A] dark:text-foreground tracking-tight leading-snug">
                  {selectedProject.name}
                </h2>
                <div className="flex flex-wrap items-center gap-2 pt-0.5">
                  <ProjectStatusBadge status={selectedProject.status} isOverdue={selectedProject.isOverdue} health={selectedProject.health} />
                  <PriorityBadge priority={selectedProject.priority} />
                </div>
              </div>

              {/* Delete & Close Buttons */}
              <div className="flex items-center gap-1.5 shrink-0">
                {(user?.role === 'ADMIN' || isSuperAdmin) && canEditProjects && (
                  <button
                    onClick={() => confirmDeleteProject(selectedProject.id)}
                    className="p-2 rounded-xl text-rose-500 hover:bg-rose-500/10 transition-colors cursor-pointer"
                    title="Delete Project"
                  >
                    <Trash2 className="w-4.5 h-4.5" />
                  </button>
                )}
                <button
                  onClick={() => setDetailDrawerOpen(false)}
                  className="p-2 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors cursor-pointer"
                  aria-label="Close"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Main Content 2-Column Grid (Desktop 60% / 40%, Mobile 1-Column) */}
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              {/* Left Card — Project Overview (60% width on Desktop) */}
              <div className="md:col-span-3 rounded-[20px] border border-[#E5E7EB] dark:border-border/50 bg-[#F8FAFC]/50 dark:bg-muted/20 p-5 space-y-4 shadow-2xs">
                <div>
                  <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1.5">
                    Description
                  </h4>
                  <p className="text-xs text-foreground leading-relaxed bg-white dark:bg-card p-3 rounded-xl border border-[#E5E7EB] dark:border-border/40">
                    {selectedProject.description || 'No description provided.'}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 rounded-xl bg-white dark:bg-card border border-[#E5E7EB] dark:border-border/40 space-y-0.5">
                    <span className="text-[10px] font-bold text-muted-foreground uppercase">Start Date</span>
                    <div className="text-xs font-bold text-foreground">
                      {new Date(selectedProject.estimatedStartDate).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                    </div>
                  </div>
                  <div className="p-3 rounded-xl bg-white dark:bg-card border border-[#E5E7EB] dark:border-border/40 space-y-0.5">
                    <span className="text-[10px] font-bold text-muted-foreground uppercase">End Date</span>
                    <div className={`text-xs font-bold ${selectedProject.isOverdue ? 'text-rose-500 font-extrabold' : 'text-foreground'}`}>
                      {new Date(selectedProject.estimatedEndDate).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                    </div>
                  </div>
                </div>

                {/* Progress Summary Card */}
                {(() => {
                  const { progressPct, completedTasks, totalTasks } = getProjectStageProgress(selectedProject, selectedProject.tasks);
                  return (
                    <div className="p-3 rounded-xl bg-white dark:bg-card border border-[#E5E7EB] dark:border-border/40 space-y-2">
                      <div className="flex items-center justify-between text-xs font-bold">
                        <span className="text-muted-foreground uppercase text-[10px] tracking-wider">
                          COMPLETION <span className="text-primary font-black">{progressPct}%</span> <span className="text-foreground font-extrabold">({completedTasks}/{totalTasks})</span>
                        </span>
                        <span className="text-emerald-600 dark:text-emerald-400 font-extrabold">{progressPct}%</span>
                      </div>
                      <div className="w-full bg-emerald-100 dark:bg-slate-800 rounded-full h-2 overflow-hidden border border-border/20">
                        <div
                          className="bg-emerald-500 h-full rounded-full transition-all duration-500"
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>
                      <p className="text-[10px] text-muted-foreground font-semibold">
                        {completedTasks} of {totalTasks} tasks finished
                      </p>
                    </div>
                  );
                })()}
              </div>

              {/* Right Card — Team Members (40% width on Desktop) */}
              <div className="md:col-span-2 rounded-[20px] border border-[#E5E7EB] dark:border-border/50 bg-[#F8FAFC]/50 dark:bg-muted/20 p-5 space-y-3 shadow-2xs">
                <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                  Team Members ({selectedProject.members?.length || 0})
                </h4>

                {(() => {
                  const projTeamObj = teams.find(t => t.id === selectedProject.teamId);
                  const projTeamMembers = new Set();
                  if (projTeamObj) {
                    if (projTeamObj.leaderId) projTeamMembers.add(projTeamObj.leaderId);
                    if (projTeamObj.members) projTeamObj.members.forEach(tm => projTeamMembers.add(tm.userId || tm.user?.id));
                  }

                  return (
                    <div className="space-y-2 max-h-[220px] overflow-y-auto pr-0.5 scrollbar-thin">
                      {selectedProject.members?.map(m => {
                        const isLeader = selectedProject.leaderId === m.userId;
                        const isExternal = selectedProject.teamId && !projTeamMembers.has(m.userId);

                        return (
                          <div key={m.userId} className="flex items-center gap-2.5 p-2 rounded-xl bg-white dark:bg-card border border-[#E5E7EB] dark:border-border/40">
                            <UserAvatar user={m.user} size="sm" />
                            <div className="truncate flex-1">
                              <div className="flex items-center gap-1.5 truncate">
                                <span className="text-xs font-bold text-foreground truncate">{m.user?.name}</span>
                                {isLeader && (
                                  <span className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[9px] px-1.5 py-0.2 rounded-md font-bold shrink-0">
                                    Leader
                                  </span>
                                )}
                                {isExternal && !isLeader && (
                                  <span className="bg-amber-500/15 text-amber-600 dark:text-amber-400 text-[9px] px-1.5 py-0.2 rounded-md font-bold shrink-0">
                                    External
                                  </span>
                                )}
                              </div>
                              <div className="text-[10px] text-muted-foreground">{m.role || m.user?.role || 'Member'}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* Footer / Open Board Button */}
            <div className="pt-3 border-t border-[#EEF2F7] dark:border-border/40 flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground font-medium">
                Created {new Date(selectedProject.createdAt).toLocaleDateString()}
              </span>
              <button
                onClick={() => {
                  setDetailDrawerOpen(false);
                  navigate(`/tasks?tab=Board&projectId=${selectedProject.id}`);
                }}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold shadow-md hover:shadow-lg transition-all flex items-center gap-1.5 cursor-pointer"
              >
                <span>Open Board</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Milestone Modal */}
      {createMilestoneModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-card w-full max-w-md rounded-3xl border border-white/80 dark:border-white/10 shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="px-6 py-5 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent border-b border-border/40 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-primary/15 border border-primary/20 text-primary">
                  <CheckCircle2 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-black text-foreground">Create Project Milestone</h3>
                  <p className="text-[11px] text-muted-foreground">Define major deliverable target dates</p>
                </div>
              </div>
              <button
                onClick={() => setCreateMilestoneModal(false)}
                className="p-1.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-all cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleCreateMilestone} className="p-6 space-y-4 text-left">
              <div>
                <label className="text-xs font-bold text-foreground block mb-1.5">
                  Milestone Title <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Authentication Module & Role Assignment"
                  value={milestoneFormData.title}
                  onChange={e => setMilestoneFormData({ ...milestoneFormData, title: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-2xl bg-muted/30 border border-border/80 text-xs font-medium text-foreground placeholder:text-muted-foreground/50 focus:bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-foreground block mb-1.5">Description</label>
                <textarea
                  rows={2}
                  placeholder="Milestone scope and key acceptance criteria..."
                  value={milestoneFormData.description}
                  onChange={e => setMilestoneFormData({ ...milestoneFormData, description: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-2xl bg-muted/30 border border-border/80 text-xs font-medium text-foreground placeholder:text-muted-foreground/50 focus:bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all resize-none"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-foreground block mb-1.5">
                  Target Due Date <span className="text-rose-500">*</span>
                </label>
                <input
                  type="date"
                  required
                  value={milestoneFormData.dueDate}
                  onChange={e => setMilestoneFormData({ ...milestoneFormData, dueDate: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-2xl bg-muted/30 border border-border/80 text-xs font-medium text-foreground focus:bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                />
              </div>

              {/* Modal Footer */}
              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-border/40">
                <button
                  type="button"
                  onClick={() => setCreateMilestoneModal(false)}
                  className="px-4 py-2 rounded-xl border border-border/80 text-xs font-bold text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-all cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-primary hover:bg-primary-hover text-white text-xs font-bold shadow-md shadow-primary/20 hover:scale-[1.01] active:scale-[0.99] transition-all cursor-pointer"
                >
                  Save Milestone
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Project Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={deleteConfirmModalOpen}
        onClose={() => {
          setDeleteConfirmModalOpen(false);
          setProjectToDeleteId(null);
        }}
        onConfirm={executeDeleteProject}
        title="Are you sure?"
        message="This project will be deleted permanently."
        confirmText="Yes"
        cancelText="No"
        variant="danger"
      />
    </div>
  );
};

export default Projects;
