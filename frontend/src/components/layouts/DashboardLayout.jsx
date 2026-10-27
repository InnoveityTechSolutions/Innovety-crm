import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../context/SocketContext';
import { useTheme } from '../../context/ThemeContext';
import api, { getUploadUrl, setManualLogoutFlag } from '../../services/api';
import {
  LayoutDashboard,
  Users,
  Briefcase,
  Clock,
  Ticket,
  Megaphone,
  MessageSquare,
  BarChart3,
  History,
  User as UserIcon,
  LogOut,
  Bell,
  Sun,
  Moon,
  Menu,
  X,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  ShieldCheck,
  CheckCircle2,
  Trash2,
  Layers,
  FileText,
  Code,
  Settings,
  Calendar,
  Mail,
  HelpCircle,
  Search,
  Laptop,
  Pin,
  FolderOpen,
  Wrench,
  FileCode,
  Sparkles,
  Award,
  Loader2,
  Activity,
  HardDrive,
  Folder,
  KeyRound,
  Video
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

import UserAvatar from '../common/UserAvatar';
import CompanyWelcomeModal from '../common/CompanyWelcomeModal';
import { useOrganizationBranding } from '../../context/BrandContext';
import { usePermissions } from '../../hooks/usePermissions';
import { CRM_MODULE_KEYS } from '../../config/crmModules';

// Comprehensive Quick Navigation Module Registry with Partial Keyword Support & Role Security
const QUICK_NAV_ITEMS = [
  // Overview
  { label: 'Dashboard', path: '/', moduleKey: CRM_MODULE_KEYS.DASHBOARD, keywords: ['dashboard', 'home', 'main', 'overview'], category: 'Overview', icon: LayoutDashboard, roles: ['ADMIN', 'EMPLOYEE', 'TEAM_LEADER', 'INTERN'] },
  { label: 'Platform Dashboard', path: '/super-admin/dashboard', keywords: ['super admin', 'platform dashboard', 'superadmin', 'control center'], category: 'Platform Control', icon: LayoutDashboard, roles: ['SUPER_ADMIN'] },
  { label: 'My Profile', path: '/profile', moduleKey: CRM_MODULE_KEYS.PROFILE, keywords: ['profile', 'account', 'me', 'my profile', 'details'], category: 'Overview', icon: UserIcon, roles: ['ADMIN', 'EMPLOYEE', 'TEAM_LEADER', 'INTERN'] },

  // Workspaces & Tasks
  { label: 'Projects', path: '/projects', moduleKey: CRM_MODULE_KEYS.PROJECTS, keywords: ['projects', 'proj', 'project list', 'client projects'], category: 'Workspaces', icon: FolderOpen, roles: ['ADMIN', 'TEAM_LEADER', 'INTERN', 'EMPLOYEE'] },
  { label: 'Active Board', path: '/tasks?tab=Board', moduleKey: CRM_MODULE_KEYS.TASKS, keywords: ['active board', 'board', 'kanban', 'active project', 'sprint', 'active'], category: 'Workspaces', icon: Layers, roles: ['ADMIN', 'EMPLOYEE', 'TEAM_LEADER', 'INTERN'] },
  { label: 'My Tasks / Task Board', path: '/tasks', moduleKey: CRM_MODULE_KEYS.TASKS, keywords: ['tasks', 'task', 'task board', 'my tasks', 'todo'], category: 'Workspaces', icon: FileText, roles: ['ADMIN', 'EMPLOYEE', 'TEAM_LEADER', 'INTERN'] },
  { label: 'Roadmap', path: '/tasks?tab=Timeline', moduleKey: CRM_MODULE_KEYS.TASKS, keywords: ['roadmap', 'timeline', 'schedule', 'gantt'], category: 'Workspaces', icon: Calendar, roles: ['ADMIN', 'EMPLOYEE', 'TEAM_LEADER', 'INTERN'] },

  // Communication
  { label: 'Chat Room', path: '/chat', moduleKey: CRM_MODULE_KEYS.CHAT, keywords: ['chat', 'messages', 'chat room', 'messaging', 'dm', 'discussion'], category: 'Communication', icon: MessageSquare, roles: ['ADMIN', 'EMPLOYEE', 'TEAM_LEADER', 'INTERN'] },
  { label: 'Announcements', path: '/announcements', moduleKey: CRM_MODULE_KEYS.ANNOUNCEMENTS, keywords: ['announcements', 'announcement', 'broadcast', 'news', 'notice'], category: 'Communication', icon: Megaphone, roles: ['ADMIN', 'EMPLOYEE', 'TEAM_LEADER', 'INTERN'] },
  { label: 'Meetings', path: '/meetings', moduleKey: CRM_MODULE_KEYS.MEETINGS, keywords: ['meetings', 'meeting', 'meet', 'google meet', 'schedule meeting', 'calendar meeting'], category: 'Communication', icon: Video, roles: ['ADMIN', 'EMPLOYEE', 'TEAM_LEADER', 'INTERN', 'SUPER_ADMIN'] },

  // Operations
  { label: 'My Work Logs', path: '/worklogs', moduleKey: CRM_MODULE_KEYS.WORKLOGS, keywords: ['work logs', 'worklogs', 'log', 'time tracking', 'hours'], category: 'Operations', icon: Clock, roles: ['ADMIN', 'EMPLOYEE', 'TEAM_LEADER', 'INTERN'] },
  { label: 'Attendance', path: '/attendance', moduleKey: CRM_MODULE_KEYS.ATTENDANCE, keywords: ['attendance', 'atten', 'clock in', 'clock out', 'timesheet'], category: 'Operations', icon: Clock, roles: ['INTERN', 'TEAM_LEADER', 'EMPLOYEE'] },
  { label: 'Attendance Audit', path: '/attendance-audit', moduleKey: CRM_MODULE_KEYS.ATTENDANCE_AUDIT, keywords: ['attendance audit', 'attendance logs', 'attendance history', 'atten'], category: 'Operations', icon: Clock, roles: ['ADMIN', 'TEAM_LEADER'] },
  { label: 'Apply Leave / Leave Management', path: '/leave-management', moduleKey: CRM_MODULE_KEYS.LEAVE_MANAGEMENT, keywords: ['leave', 'leaves', 'apply leave', 'leave management', 'vacation', 'time off', 'pto'], category: 'Operations', icon: Calendar, roles: ['ADMIN', 'EMPLOYEE', 'TEAM_LEADER', 'INTERN', 'SUPER_ADMIN'] },
  { label: 'Work Calendar', path: '/operations/work-calendar', moduleKey: CRM_MODULE_KEYS.WORK_CALENDAR, keywords: ['work calendar', 'calendar', 'holidays', 'schedule', 'wfh', 'working days'], category: 'Operations', icon: Calendar, roles: ['ADMIN', 'EMPLOYEE', 'TEAM_LEADER', 'INTERN', 'SUPER_ADMIN'] },
  { label: 'Sanction WFH & Leaves', path: '/leave-management?tab=Sanction', moduleKey: CRM_MODULE_KEYS.LEAVE_MANAGEMENT, keywords: ['sanction', 'wfh', 'leaves', 'approve leave', 'sanction wfh', 'sanction leaves'], category: 'Operations', icon: CheckCircle2, roles: ['ADMIN', 'TEAM_LEADER'] },

  { label: 'Ticket Desk', path: '/tickets', moduleKey: CRM_MODULE_KEYS.TICKETS, keywords: ['tickets', 'ticket', 'ticket desk', 'support', 'help', 'issue'], category: 'Operations', icon: Ticket, roles: ['ADMIN', 'EMPLOYEE', 'TEAM_LEADER', 'INTERN'] },
  { label: 'Assets', path: '/assets', moduleKey: CRM_MODULE_KEYS.ASSETS, keywords: ['assets', 'asset', 'hardware', 'laptop', 'inventory', 'devices'], category: 'Operations', icon: Laptop, roles: ['ADMIN', 'EMPLOYEE', 'TEAM_LEADER', 'INTERN'] },
  { label: 'Company Documents', path: '/company-documents', moduleKey: CRM_MODULE_KEYS.COMPANY_DOCUMENTS, keywords: ['company documents', 'documents', 'files', 'contracts', 'legal', 'doc'], category: 'Operations', icon: Folder, roles: ['ADMIN', 'TEAM_LEADER', 'SUPER_ADMIN'] },

  // Finance & Payroll
  { label: 'Payroll', path: '/payroll/dashboard', moduleKey: CRM_MODULE_KEYS.PAYROLL_DASHBOARD, keywords: ['payroll', 'pay', 'salary', 'finance', 'payroll dashboard'], category: 'Finance & Payroll', icon: BarChart3, roles: ['ADMIN', 'SUPER_ADMIN'] },
  { label: 'My Payslips & Salary', path: '/my-payroll', moduleKey: CRM_MODULE_KEYS.MY_PAYROLL, keywords: ['payroll', 'pay', 'my payslips', 'salary', 'my payroll', 'payslip'], category: 'Finance & Payroll', icon: FileText, roles: ['EMPLOYEE', 'INTERN', 'TEAM_LEADER'] },
  { label: 'Salary Templates', path: '/payroll/templates', moduleKey: CRM_MODULE_KEYS.PAYROLL_TEMPLATES, keywords: ['salary templates', 'templates', 'payroll templates'], category: 'Finance & Payroll', icon: FileText, roles: ['ADMIN'] },
  { label: 'Salary Structures', path: '/payroll/structures', moduleKey: CRM_MODULE_KEYS.PAYROLL_STRUCTURES, keywords: ['salary structures', 'structures'], category: 'Finance & Payroll', icon: Users, roles: ['ADMIN'] },
  { label: 'Payroll Processing', path: '/payroll/processing', moduleKey: CRM_MODULE_KEYS.PAYROLL_PROCESS, keywords: ['payroll processing', 'process salary', 'disburse'], category: 'Finance & Payroll', icon: Layers, roles: ['ADMIN'] },
  { label: 'Payslips Desk', path: '/payroll/payslips', moduleKey: CRM_MODULE_KEYS.PAYROLL_PAYSLIPS, keywords: ['payslips desk', 'all payslips', 'generate payslip'], category: 'Finance & Payroll', icon: FileCode, roles: ['ADMIN'] },
  { label: 'Calendar / Holiday Calendar', path: '/payroll/holidays', moduleKey: CRM_MODULE_KEYS.PAYROLL_HOLIDAYS, keywords: ['calendar', 'holidays', 'holiday calendar', 'vacation calendar'], category: 'Finance & Payroll', icon: Calendar, roles: ['ADMIN'] },

  // System Control & Directories
  { label: 'Employees Directory', path: '/employees', moduleKey: CRM_MODULE_KEYS.REGISTRY_EMPLOYEES, keywords: ['employees', 'emp', 'employee directory', 'staff'], category: 'System Control', icon: Users, roles: ['ADMIN'] },
  { label: 'Interns Directory', path: '/interns', moduleKey: CRM_MODULE_KEYS.REGISTRY_INTERNS, keywords: ['interns', 'intern', 'intern directory'], category: 'System Control', icon: Users, roles: ['ADMIN'] },
  { label: 'Team Leaders Directory', path: '/team-leaders', moduleKey: CRM_MODULE_KEYS.REGISTRY_TEAMLEADERS, keywords: ['team leaders', 'tl', 'leads', 'managers'], category: 'System Control', icon: Users, roles: ['ADMIN'] },
  { label: 'Teams', path: '/teams', moduleKey: CRM_MODULE_KEYS.TEAMS_HUB, keywords: ['teams', 'departments', 'groups'], category: 'System Control', icon: Briefcase, roles: ['ADMIN', 'TEAM_LEADER', 'INTERN', 'EMPLOYEE'] },
  { label: 'Reports', path: '/reports', moduleKey: CRM_MODULE_KEYS.REPORTS, keywords: ['reports', 'analytics', 'metrics'], category: 'System Control', icon: BarChart3, roles: ['ADMIN', 'TEAM_LEADER'] },
  { label: 'Audit Logs', path: '/audit-logs', moduleKey: CRM_MODULE_KEYS.AUDIT_LOGS, keywords: ['audit logs', 'audit', 'activity log', 'history'], category: 'System Control', icon: History, roles: ['ADMIN'] },
  { label: 'Settings', path: '/settings', moduleKey: CRM_MODULE_KEYS.SITE_SETTINGS, keywords: ['settings', 'site settings', 'config', 'preferences'], category: 'System Control', icon: Settings, roles: ['ADMIN'] },

  // Super Admin Control & Builder
  { label: 'Organization Manager', path: '/super-admin/organization', keywords: ['organization', 'positions', 'position', 'pos-mgr', 'pos-snr', 'pos-int', 'ranks', 'senior', 'lead', 'manager', 'director', 'branches', 'departments'], category: 'Platform Control', icon: Award, roles: ['SUPER_ADMIN'] },
  { label: 'Users Directory', path: '/super-admin/users', keywords: ['users directory', 'all users', 'superadmin users', 'senior', 'junior', 'lead', 'manager'], category: 'Platform Control', icon: Users, roles: ['SUPER_ADMIN'] },
  { label: 'Team Directory', path: '/super-admin/teams', keywords: ['team directory', 'superadmin teams'], category: 'Platform Control', icon: Briefcase, roles: ['SUPER_ADMIN'] },
  { label: 'Employee Self-Service', path: '/self-service', moduleKey: CRM_MODULE_KEYS.SELF_SERVICE, keywords: ['self service', 'my shift', 'portal', 'timeline', 'punches', 'attendance'], category: 'Operations', icon: UserIcon, roles: ['EMPLOYEE', 'INTERN', 'TEAM_LEADER', 'ADMIN', 'SUPER_ADMIN'] },
  { label: 'Admin Management', path: '/super-admin/admins', keywords: ['admin management', 'admins', 'admin list'], category: 'Platform Control', icon: ShieldCheck, roles: ['SUPER_ADMIN'] },
  { label: 'Role-Based Access Management', path: '/super-admin/role-access', keywords: ['role access', 'permissions', 'access templates', 'roles', 'template', 'role-based access management'], category: 'Platform Control', icon: KeyRound, roles: ['SUPER_ADMIN'] },
  { label: 'Branding & Theme', path: '/super-admin/branding', keywords: ['branding', 'theme', 'logo', 'colors'], category: 'Platform Control', icon: Sparkles, roles: ['SUPER_ADMIN'] },
  { label: 'Late Policy', path: '/super-admin/late-policy', keywords: ['late policy', 'late', 'warning', 'deduction', 'lates'], category: 'Platform Control', icon: Clock, roles: ['SUPER_ADMIN'] },
  { label: 'Backup & Restore', path: '/super-admin/backup-restore', keywords: ['backup', 'restore', 'live backup', 'disaster recovery', 'sql dump', 'snapshot', 'mysql'], category: 'Platform Control', icon: HardDrive, roles: ['SUPER_ADMIN'] }
];

const DashboardLayout = ({ children }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const currentFull = location.pathname + location.search;

  const { user, logout } = useAuth();
  const { canView } = usePermissions();
  const { notifications, unreadCount, markRead, markAllAsRead, deleteNotification, clearAllNotifications } = useSocket();
  const { companyName, companyLogo, themeMode, updateThemeSettings, canUseChat } = useTheme();

  console.log('[DEBUG Trace Step 4 - DashboardLayout]', {
    role: user?.role,
    canUseChat
  });

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isPinned, setIsPinned] = useState(() => localStorage.getItem('sidebar_pinned') === 'true');
  const [isHovered, setIsHovered] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchDropdownOpen, setSearchDropdownOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);

  // Phase 7 Shift Notifications
  const [shiftNotifs, setShiftNotifs] = useState([]);
  const [shiftUnreadCount, setShiftUnreadCount] = useState(0);
  const [notifTab, setNotifTab] = useState('all'); // 'all' | 'shifts'

  const fetchShiftNotifs = async () => {
    try {
      const res = await api.get('/workforce/notifications');
      if (res.data?.success) {
        setShiftNotifs(res.data.notifications || []);
        setShiftUnreadCount(res.data.unreadCount || 0);
      }
    } catch {
      // Quiet fail if endpoint not reachable
    }
  };

  useEffect(() => {
    fetchShiftNotifs();
    const interval = setInterval(fetchShiftNotifs, 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (notifOpen) {
      fetchShiftNotifs();
    }
  }, [notifOpen]);

  const handleMarkShiftRead = async (id) => {
    try {
      await api.patch(`/workforce/notifications/${id}/read`);
      setShiftNotifs(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
      setShiftUnreadCount(prev => Math.max(0, prev - 1));
    } catch (err) {
      console.error(err);
    }
  };

  const handleMarkAllShiftRead = async () => {
    try {
      await api.post('/workforce/notifications/mark-all-read');
      setShiftNotifs(prev => prev.map(n => ({ ...n, isRead: true })));
      setShiftUnreadCount(0);
    } catch (err) {
      console.error(err);
    }
  };

  const totalCombinedUnread = (unreadCount || 0) + shiftUnreadCount;

  const isExpanded = isPinned || isHovered || sidebarOpen;

  const togglePin = (e) => {
    e?.stopPropagation();
    const nextPin = !isPinned;
    setIsPinned(nextPin);
    localStorage.setItem('sidebar_pinned', String(nextPin));
  };

  const notifRef = useRef(null);
  const profileRef = useRef(null);
  const searchRef = useRef(null);

  // Handle outside click & Esc key for Notifications Panel
  useEffect(() => {
    if (!notifOpen) return;

    const handlePointerDownOutside = (event) => {
      if (notifRef.current && !notifRef.current.contains(event.target)) {
        setNotifOpen(false);
      }
    };

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setNotifOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDownOutside, true);
    document.addEventListener('keydown', handleKeyDown, true);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDownOutside, true);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [notifOpen]);

  const userRoleUpper = String(user?.role || '').toUpperCase();

  // Instant Client-Side Filter for Quick Navigation Modules with Role Permission Safety & Partial Keyword Matching
  const navSearchResults = React.useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];

    return QUICK_NAV_ITEMS.filter((item) => {
      // 0. Chat Feature Toggle check
      if (item.path === '/chat' && !canUseChat) return false;

      // 1. Role Permission check
      const hasPermission = item.roles.includes(userRoleUpper);
      if (!hasPermission) return false;

      // 2. Dynamic Access Template Permission Check (Phase 4)
      if (item.moduleKey && userRoleUpper !== 'SUPER_ADMIN') {
        if (item.moduleKey !== CRM_MODULE_KEYS.PROFILE && item.moduleKey !== 'profile' && !canView(item.moduleKey)) {
          return false;
        }
      }

      // 3. Partial matching on label, category, path, or keywords
      const labelMatch = item.label.toLowerCase().includes(q);
      const categoryMatch = item.category.toLowerCase().includes(q);
      const pathMatch = item.path.toLowerCase().includes(q);
      const keywordMatch = item.keywords.some((kw) => kw.toLowerCase().includes(q));

      return labelMatch || categoryMatch || pathMatch || keywordMatch;
    });
  }, [searchQuery, userRoleUpper, canUseChat, canView]);

  // Handle outside click for Search Dropdown
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setSearchDropdownOpen(false);
      }
    };
    document.addEventListener('pointerdown', handleOutsideClick, true);
    return () => document.removeEventListener('pointerdown', handleOutsideClick, true);
  }, []);

  const handleQuickNavSubmit = (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    if (navSearchResults.length > 0) {
      navigate(navSearchResults[0].path);
      setSearchDropdownOpen(false);
      setSearchQuery('');
    } else {
      setSearchDropdownOpen(true);
    }
  };

  // Handle outside click, Esc key, and scroll dismissal for Profile Dropdown
  useEffect(() => {
    if (!profileOpen) return;

    const handlePointerDownOutside = (event) => {
      if (profileRef.current && !profileRef.current.contains(event.target)) {
        setProfileOpen(false);
      }
    };

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setProfileOpen(false);
      }
    };

    const handleScroll = () => {
      setProfileOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDownOutside, true);
    document.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('scroll', handleScroll, true);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDownOutside, true);
      document.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [profileOpen]);

  // Close profile dropdown when route changes
  useEffect(() => {
    setProfileOpen(false);
  }, [location.pathname]);

  // Handle popup notifications
  useEffect(() => {
    const unread = notifications.filter(n => !n.isRead);
    if (unread.length > 0) {
      const latest = unread[0];
      setToastMessage({ title: latest.title, message: latest.message });
      const timer = setTimeout(() => {
        setToastMessage(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [notifications]);

  const toggleTheme = () => {
    const nextMode = themeMode === 'dark' ? 'light' : 'dark';
    updateThemeSettings({ themeMode: nextMode });
  };


  const [openCategories, setOpenCategories] = useState({
    Overview: true,
    Workspaces: true,
    Operations: true,
    'System Control': true
  });

  const toggleCategory = (title) => {
    setOpenCategories(prev => ({ ...prev, [title]: !prev[title] }));
  };

  const categories = [
    {
      title: 'Platform Control Center',
      items: [
        { label: 'Platform Dashboard', path: '/super-admin/dashboard', icon: LayoutDashboard, roles: ['SUPER_ADMIN'] },
        { label: 'Branding & Theme', path: '/super-admin/branding', icon: Sparkles, roles: ['SUPER_ADMIN'] },
        { label: 'Users Directory', path: '/super-admin/users', icon: Users, roles: ['SUPER_ADMIN'] },
        { label: 'Team Directory', path: '/super-admin/teams', icon: Briefcase, roles: ['SUPER_ADMIN'] },
        { label: 'Admin Management', path: '/super-admin/admins', icon: ShieldCheck, roles: ['SUPER_ADMIN'] },
        { label: 'Role-Based Access Management', path: '/super-admin/role-access', icon: KeyRound, roles: ['SUPER_ADMIN'] },
        { label: 'Organization Manager', path: '/super-admin/organization', icon: Award, roles: ['SUPER_ADMIN'] },
        { label: 'Leave Policy', path: '/super-admin/leave-policy', icon: Calendar, roles: ['SUPER_ADMIN'] },
        { label: 'Late Policy', path: '/super-admin/late-policy', icon: Clock, roles: ['SUPER_ADMIN'] },
        { label: 'Backup & Restore', path: '/super-admin/backup-restore', icon: HardDrive, roles: ['SUPER_ADMIN'] }
      ]
    },
    {
      title: 'Overview',
      items: [
        { label: 'Dashboard', path: '/', moduleKey: CRM_MODULE_KEYS.DASHBOARD, icon: LayoutDashboard, roles: ['ADMIN', 'EMPLOYEE', 'TEAM_LEADER', 'INTERN'] },
        { label: 'My Profile', path: '/profile', moduleKey: CRM_MODULE_KEYS.PROFILE, icon: UserIcon, roles: ['ADMIN', 'EMPLOYEE', 'TEAM_LEADER', 'INTERN'] }
      ]
    },
    {
      title: 'Workspaces',
      items: [
        { label: 'Projects', path: '/projects', moduleKey: CRM_MODULE_KEYS.PROJECTS, icon: FolderOpen, roles: ['ADMIN', 'TEAM_LEADER', 'SUPER_ADMIN'] },
        { label: 'Active Board', path: '/tasks?tab=Board', moduleKey: CRM_MODULE_KEYS.TASKS, icon: Layers, roles: ['ADMIN', 'EMPLOYEE', 'TEAM_LEADER', 'INTERN', 'SUPER_ADMIN'] },
        { label: 'Roadmap', path: '/tasks?tab=Timeline', moduleKey: CRM_MODULE_KEYS.TASKS, icon: Calendar, roles: ['ADMIN', 'EMPLOYEE', 'TEAM_LEADER', 'INTERN', 'SUPER_ADMIN'] }
      ]
    },
    {
      title: 'Communication',
      items: [
        { label: 'Chat', path: '/chat', moduleKey: CRM_MODULE_KEYS.CHAT, icon: MessageSquare, roles: ['ADMIN', 'EMPLOYEE', 'TEAM_LEADER', 'INTERN', 'SUPER_ADMIN'] },
        { label: 'Announcements', path: '/announcements', moduleKey: CRM_MODULE_KEYS.ANNOUNCEMENTS, icon: Megaphone, roles: ['ADMIN', 'EMPLOYEE', 'TEAM_LEADER', 'INTERN', 'SUPER_ADMIN'] },
        { label: 'Meetings', path: '/meetings', moduleKey: CRM_MODULE_KEYS.MEETINGS, icon: Video, roles: ['ADMIN', 'EMPLOYEE', 'TEAM_LEADER', 'INTERN', 'SUPER_ADMIN'] }
      ]
    },

    {
      title: 'Operations',
      items: [
        { label: 'My Work Logs', path: '/worklogs', moduleKey: CRM_MODULE_KEYS.WORKLOGS, icon: Clock, roles: ['ADMIN', 'EMPLOYEE', 'TEAM_LEADER', 'INTERN', 'SUPER_ADMIN'] },
        { label: 'Attendance Portal', path: '/attendance', moduleKey: CRM_MODULE_KEYS.ATTENDANCE, icon: Clock, roles: ['INTERN', 'TEAM_LEADER', 'EMPLOYEE'] },
        { label: 'Attendance', path: '/attendance-audit', moduleKey: CRM_MODULE_KEYS.ATTENDANCE_AUDIT, icon: Clock, roles: ['ADMIN', 'SUPER_ADMIN'] },
        { label: 'Attendance Audit', path: '/attendance-audit', moduleKey: CRM_MODULE_KEYS.ATTENDANCE_AUDIT, icon: Clock, roles: ['TEAM_LEADER'] },
        { label: 'Leave Management', path: '/leave-management', moduleKey: CRM_MODULE_KEYS.LEAVE_MANAGEMENT, icon: Calendar, roles: ['ADMIN', 'EMPLOYEE', 'TEAM_LEADER', 'INTERN', 'SUPER_ADMIN'] },
        { label: 'Work Calendar', path: '/operations/work-calendar', moduleKey: CRM_MODULE_KEYS.WORK_CALENDAR, icon: Calendar, roles: ['ADMIN', 'EMPLOYEE', 'TEAM_LEADER', 'INTERN', 'SUPER_ADMIN'] },
        { label: 'Ticket Desk', path: '/tickets', moduleKey: CRM_MODULE_KEYS.TICKETS, icon: Ticket, roles: ['ADMIN', 'EMPLOYEE', 'TEAM_LEADER', 'INTERN', 'SUPER_ADMIN'] },

        { label: 'Asset Management', path: '/assets', moduleKey: CRM_MODULE_KEYS.ASSETS, icon: Laptop, roles: ['ADMIN', 'EMPLOYEE', 'TEAM_LEADER', 'INTERN', 'SUPER_ADMIN'] },
        { label: 'Company Documents', path: '/company-documents', moduleKey: CRM_MODULE_KEYS.COMPANY_DOCUMENTS, icon: Folder, roles: ['ADMIN', 'TEAM_LEADER', 'SUPER_ADMIN'] }
      ]
    },
    {
      title: 'Finance & Payroll',
      items: [
        { label: 'Payroll Dashboard', path: '/payroll/dashboard', moduleKey: CRM_MODULE_KEYS.PAYROLL_DASHBOARD, icon: BarChart3, roles: ['ADMIN', 'SUPER_ADMIN'] },
        { label: 'Salary Templates', path: '/payroll/templates', moduleKey: CRM_MODULE_KEYS.PAYROLL_TEMPLATES, icon: FileText, roles: ['ADMIN', 'SUPER_ADMIN'] },
        { label: 'Salary Structures', path: '/payroll/structures', moduleKey: CRM_MODULE_KEYS.PAYROLL_STRUCTURES, icon: Users, roles: ['ADMIN', 'SUPER_ADMIN'] },
        { label: 'Payroll Processing', path: '/payroll/processing', moduleKey: CRM_MODULE_KEYS.PAYROLL_PROCESS, icon: Layers, roles: ['ADMIN', 'SUPER_ADMIN'] },
        { label: 'Payslips Desk', path: '/payroll/payslips', moduleKey: CRM_MODULE_KEYS.PAYROLL_PAYSLIPS, icon: FileCode, roles: ['ADMIN', 'SUPER_ADMIN'] },
        { label: 'Holiday Calendar', path: '/payroll/holidays', moduleKey: CRM_MODULE_KEYS.PAYROLL_HOLIDAYS, icon: Calendar, roles: ['ADMIN', 'SUPER_ADMIN'] },
        { label: 'Payroll Settings', path: '/payroll/settings', moduleKey: CRM_MODULE_KEYS.PAYROLL_SETTINGS, icon: Settings, roles: ['ADMIN', 'SUPER_ADMIN'] },
        { label: 'My Payslips & Salary', path: '/my-payroll', moduleKey: CRM_MODULE_KEYS.MY_PAYROLL, icon: FileText, roles: ['EMPLOYEE', 'INTERN', 'TEAM_LEADER'] }
      ]
    },
    {
      title: 'System Control',
      items: [
        { label: 'Intern Registry', path: '/interns', moduleKey: CRM_MODULE_KEYS.REGISTRY_INTERNS, icon: Users, roles: ['ADMIN'] },
        { label: 'Employee Registry', path: '/employees', moduleKey: CRM_MODULE_KEYS.REGISTRY_EMPLOYEES, icon: Users, roles: ['ADMIN'] },
        { label: 'Team Leader Registry', path: '/team-leaders', moduleKey: CRM_MODULE_KEYS.REGISTRY_TEAMLEADERS, icon: Users, roles: ['ADMIN'] },
        { label: 'Team Hub', path: '/teams', moduleKey: CRM_MODULE_KEYS.TEAMS_HUB, icon: Briefcase, roles: ['ADMIN', 'EMPLOYEE', 'TEAM_LEADER', 'INTERN'] },
        { label: 'Report Center', path: '/reports', moduleKey: CRM_MODULE_KEYS.REPORTS, icon: BarChart3, roles: ['ADMIN', 'TEAM_LEADER', 'SUPER_ADMIN'] },
        { label: 'Audit Logs', path: '/audit-logs', moduleKey: CRM_MODULE_KEYS.AUDIT_LOGS, icon: History, roles: ['ADMIN', 'SUPER_ADMIN'] },
        { label: 'Site Settings', path: '/settings', moduleKey: CRM_MODULE_KEYS.SITE_SETTINGS, icon: ShieldCheck, roles: ['ADMIN', 'SUPER_ADMIN'] }
      ]
    },
    {
      title: 'Account',
      items: [
        { label: 'My Profile', path: '/profile', moduleKey: CRM_MODULE_KEYS.PROFILE, icon: UserIcon, roles: ['SUPER_ADMIN'] }
      ]
    }
  ];

  const handleLogout = () => {
    // 1. Immediately drop auth headers so any pending background requests don't use old token
    if (api.defaults?.headers?.common) {
      delete api.defaults.headers.common['Authorization'];
    }

    // 2. Mark manual logout flag immediately to prevent background API race conditions
    setManualLogoutFlag(true);

    // 3. Close profile dropdown immediately
    setProfileOpen(false);

    // 4. Immediately transition route to /login via React Router without waiting for cleanup
    navigate('/login', { replace: true });

    // 5. Defer full cleanup to idle/background so it does not compete with /login first render
    const runCleanup = () => logout(true);
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(runCleanup, { timeout: 200 });
    } else {
      setTimeout(runCleanup, 80);
    }
  };

  const handleNotificationClick = (notif) => {
    markRead(notif.id);
    setNotifOpen(false);

    if (notif.type.startsWith('TASK')) {
      navigate('/tasks');
    } else if (notif.type.startsWith('TICKET')) {
      navigate('/tickets');
    } else if (notif.type.startsWith('NEW_ANNOUNCEMENT')) {
      navigate('/announcements');
    }
  };

  // Breadcrumb generation based on current path + query params
  const getBreadcrumbs = () => {
    const parts = [{ label: 'Portal', path: '/' }];
    const pathname = location.pathname;
    const query = new URLSearchParams(location.search);
    const tab = query.get('tab');

    if (pathname === '/profile') {
      parts.push({ label: 'My Profile', path: '/profile' });
    } else if (pathname === '/attendance') {
      parts.push({ label: 'Operations', path: '/attendance' });
      parts.push({ label: 'Attendance Portal', path: '/attendance' });
    } else if (pathname === '/attendance-audit') {
      parts.push({ label: 'Operations', path: '/attendance-audit' });
      parts.push({ label: 'Attendance Audit', path: '/attendance-audit' });
    } else if (pathname === '/interns') {
      parts.push({ label: 'System Control', path: '/interns' });
      parts.push({ label: 'Intern Registry', path: '/interns' });
    } else if (pathname === '/team-leaders') {
      parts.push({ label: 'System Control', path: '/team-leaders' });
      parts.push({ label: 'Team Leader Registry', path: '/team-leaders' });
    } else if (pathname === '/employees') {
      parts.push({ label: 'System Control', path: '/employees' });
      parts.push({ label: 'Employee Registry', path: '/employees' });
    } else if (pathname === '/teams') {
      parts.push({ label: 'System Control', path: '/teams' });
      parts.push({ label: 'Team Hub', path: '/teams' });
    } else if (pathname === '/tickets') {
      parts.push({ label: 'Operations', path: '/tickets' });
      parts.push({ label: 'Ticket Desk', path: '/tickets' });
    } else if (pathname === '/chat') {
      parts.push({ label: 'Communication', path: '/chat' });
      parts.push({ label: 'Chat', path: '/chat' });
    } else if (pathname === '/meetings') {
      parts.push({ label: 'Communication', path: '/meetings' });
      parts.push({ label: 'Meetings', path: '/meetings' });
    } else if (pathname === '/announcements') {
      parts.push({ label: 'Operations', path: '/announcements' });
      parts.push({ label: 'Announcements', path: '/announcements' });
    } else if (pathname === '/leave-management' || pathname === '/leaves') {
      parts.push({ label: 'Operations', path: '/leave-management' });
      parts.push({ label: 'Leave Management', path: '/leave-management' });
    } else if (pathname === '/operations/work-calendar' || pathname === '/work-calendar') {
      parts.push({ label: 'Operations', path: '/operations/work-calendar' });
      parts.push({ label: 'Work Calendar', path: '/operations/work-calendar' });
    } else if (pathname === '/super-admin/late-policy') {
      parts.push({ label: 'Platform Control', path: '/super-admin/dashboard' });
      parts.push({ label: 'Late Policy', path: '/super-admin/late-policy' });
    } else if (pathname === '/super-admin/backup-restore' || pathname === '/super-admin/backups') {
      parts.push({ label: 'System Management', path: '/super-admin/backup-restore' });
      parts.push({ label: 'Backup & Restore', path: '/super-admin/backup-restore' });
    } else if (pathname === '/reports') {

      parts.push({ label: 'System Control', path: '/reports' });
      parts.push({ label: 'Report Center', path: '/reports' });
    } else if (pathname === '/audit-logs') {
      parts.push({ label: 'System Control', path: '/audit-logs' });
      parts.push({ label: 'Audit Logs', path: '/audit-logs' });
    } else if (pathname === '/settings') {
      parts.push({ label: 'System Control', path: '/settings' });
      parts.push({ label: 'Site Settings', path: '/settings' });
    } else if (pathname === '/projects') {
      parts.push({ label: 'Workspaces', path: '/projects' });
      parts.push({ label: 'Projects', path: '/projects' });
    } else if (pathname === '/tasks') {
      parts.push({ label: 'Workspaces', path: '/tasks' });
      parts.push({ label: tab ? `${tab}` : 'Active Board', path: currentFull });
    }
    return parts;
  };

  const breadcrumbs = getBreadcrumbs();

  return (
    <div className="flex h-screen overflow-hidden theme-canvas-bg text-foreground">
      {/* Mobile Drawer Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Floating Sidebar for Desktop & Mobile Drawer */}
      <motion.aside
        initial={false}
        animate={{ width: isExpanded ? 280 : 100 }}
        transition={{ duration: 0.22, ease: 'easeInOut' }}
        onMouseEnter={() => !isPinned && setIsHovered(true)}
        onMouseLeave={() => !isPinned && setIsHovered(false)}
        className={`fixed inset-y-0 left-0 z-40 font-sans transition-transform duration-300 md:translate-x-0 md:relative flex flex-col justify-between p-3 select-none ${sidebarOpen ? 'translate-x-0 bg-card shadow-2xl' : '-translate-x-full md:translate-x-0'
          }`}
      >
        <div className="flex flex-col h-full">
          {/* Top Pin / Collapse Controller Bar */}
          <div className={`w-full flex items-center mb-3 px-1 ${isExpanded ? 'justify-between' : 'justify-center'}`}>
            {isExpanded && (
              <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/70 px-2">
                Navigation
              </span>
            )}
            <button
              type="button"
              onClick={togglePin}
              title={isPinned ? "Unpin sidebar (Enable Hover Expand)" : "Pin sidebar (Permanently Expand)"}
              className={`hidden md:flex h-9 w-9 items-center justify-center rounded-full transition-all shrink-0 ${isPinned
                ? 'bg-primary text-white shadow-md shadow-primary/30'
                : 'bg-card text-muted-foreground hover:bg-primary/10 hover:text-primary border border-border/70 shadow-sm'
                }`}
            >
              <ChevronRight className={`h-4.5 w-4.5 transition-transform duration-300 ${isPinned ? 'rotate-180 text-white font-bold' : ''}`} />
            </button>
          </div>

          {/* Navigation Items grouped into floating capsule containers */}
          <nav className="flex-1 space-y-4 overflow-y-auto px-2 py-2 scrollbar-none [&::-webkit-scrollbar]:hidden [ms-overflow-style:none] [scrollbar-width:none] font-sans max-h-[calc(100vh-4rem)]">
            {categories.map((cat) => {
              const filteredItems = cat.items.filter(item => {
                if (item.path === '/chat' && !canUseChat) return false;
                if (!item.roles.includes(user?.role)) return false;

                // Phase 4: Dynamic Access Template Permission filtering
                if (item.moduleKey && user?.role !== 'SUPER_ADMIN') {
                  if (item.moduleKey !== CRM_MODULE_KEYS.PROFILE && item.moduleKey !== 'profile' && !canView(item.moduleKey)) {
                    return false;
                  }
                }
                return true;
              });
              if (filteredItems.length === 0) return null;

              return (
                <div
                  key={cat.title}
                  className="bg-card backdrop-blur-xl border border-border/70 rounded-[28px] p-2 shadow-sm hover:shadow-md shadow-slate-950/5 dark:shadow-black/20 transition-all flex flex-col items-center"
                >
                  {/* Section Title */}
                  {isExpanded && (
                    <div className="w-full px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-muted-foreground/70 flex items-center justify-between">
                      <span>{cat.title}</span>
                    </div>
                  )}

                  {/* Group Items */}
                  <div className="w-full space-y-1.5 mt-0.5">
                    {filteredItems.map((item) => {
                      const Icon = item.icon;
                      const itemPathBase = item.path.split('?')[0];
                      const isActive = location.pathname === item.path || currentFull === item.path || (itemPathBase === '/tasks' && location.pathname === '/tasks' && !location.search && item.label === 'Active Board');

                      return (
                        <Link
                          key={item.label}
                          to={item.path}
                          title={!isExpanded ? item.label : undefined}
                          className={`flex items-center text-xs transition-all relative group ${isExpanded ? 'w-full gap-3 px-3.5 py-3 rounded-2xl' : 'justify-center w-11 h-11 mx-auto rounded-full'
                            } ${isActive
                              ? 'bg-primary text-white font-bold shadow-md shadow-primary/30'
                              : 'text-muted-foreground hover:bg-primary/10 hover:text-primary font-semibold'
                            }`}
                          onClick={() => setSidebarOpen(false)}
                        >
                          <Icon className={`h-5 w-5 shrink-0 transition-transform duration-200 group-hover:scale-110 ${isActive ? 'text-white' : ''}`} />

                          {isExpanded && (
                            <span className="truncate text-xs font-semibold">
                              {item.label}
                            </span>
                          )}

                          {isActive && isExpanded && (
                            <ChevronRight className="ml-auto h-3.5 w-3.5 opacity-90" />
                          )}

                          {!isExpanded && (
                            <div className="absolute left-16 bg-slate-900 text-white text-xs px-2.5 py-1 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50 shadow-xl font-medium">
                              {item.label}
                            </div>
                          )}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </nav>
        </div>
      </motion.aside>

      {/* Main Panel */}
      <div className="flex flex-1 flex-col overflow-hidden min-w-0 bg-transparent">
        {/* Extended Floating Glass App Bar Header Card */}
        <header className="sticky top-0 z-30 w-full px-2 sm:px-3 pt-3 pb-1">
          <div className="flex h-20 w-full items-center justify-between border border-border/60 bg-card px-6 sm:px-8 backdrop-blur-xl shadow-lg shadow-slate-950/5 rounded-[28px] transition-all">
            {/* Left: Main Logo & Breadcrumb Navigation */}
            <div className="flex items-center gap-4 shrink-0">
              <button className="rounded-lg p-1.5 hover:bg-muted md:hidden" onClick={() => setSidebarOpen(true)}>
                <Menu className="h-6 w-6" />
              </button>

              <Link to={user?.role === 'SUPER_ADMIN' ? '/super-admin/dashboard' : '/'} className="flex items-center gap-2.5 pr-3 border-r border-border/40 shrink-0">
                {companyLogo ? (
                  <img
                    src={getUploadUrl(companyLogo)}
                    alt={companyName || 'Logo'}
                    className="h-9 max-w-[170px] object-contain shrink-0"
                    onError={(e) => {
                      e.target.onerror = null;
                      e.target.src = '/logo.png';
                    }}
                  />
                ) : (
                  <img src="/logo.png" alt={companyName || 'INNOVEITY'} className="h-9 max-w-[170px] object-contain shrink-0" />
                )}
              </Link>

              <div className="hidden lg:flex items-center gap-1.5 text-xs text-muted-foreground font-semibold">
                {breadcrumbs.map((crumb, idx) => (
                  <React.Fragment key={idx}>
                    {idx > 0 && <span className="text-muted-foreground/40 font-bold">/</span>}
                    <Link
                      to={crumb.path}
                      className={`hover:text-foreground capitalize ${idx === breadcrumbs.length - 1 ? 'text-foreground font-bold' : ''}`}
                    >
                      {crumb.label.toLowerCase()}
                    </Link>
                  </React.Fragment>
                ))}
              </div>
            </div>

            {/* Center: Quick Navigation Search Bar Berth */}
            <div className="hidden md:flex flex-1 items-center justify-center max-w-2xl mx-6 sm:mx-8 relative" ref={searchRef}>
              <form onSubmit={handleQuickNavSubmit} className="relative w-full">
                <Search className="absolute left-3.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Quick Search: type 'atten', 'proj', 'chat', 'pay', 'leave'..."
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setSearchDropdownOpen(true);
                  }}
                  onFocus={() => {
                    if (searchQuery.trim()) setSearchDropdownOpen(true);
                  }}
                  className="w-full pl-10 pr-10 py-2 text-xs font-medium rounded-2xl border border-border/60 bg-muted/40 hover:bg-muted/60 focus:bg-background focus:border-primary/50 focus:ring-2 focus:ring-primary/20 transition-all shadow-inner"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      setSearchDropdownOpen(false);
                    }}
                    className="absolute right-3.5 top-2.5 text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </form>

              {/* Quick Navigation Dropdown Popover */}
              {searchDropdownOpen && searchQuery.trim() && (
                <div className="absolute top-full left-0 right-0 mt-2 z-50 rounded-2xl border border-border/80 bg-card p-3 shadow-2xl animate-in fade-in slide-in-from-top-2 duration-150 max-h-96 overflow-y-auto">
                  {navSearchResults.length === 0 ? (
                    <div className="py-6 text-center text-xs text-muted-foreground font-semibold">
                      <p>No matching page found.</p>
                      <p className="text-[11px] font-normal text-muted-foreground/70 mt-1">
                        Try typing a page name like "Attendance", "Projects", "Leave", "Tasks", "Chat", or "Payroll".
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <div className="px-2 py-1 text-[10px] font-extrabold uppercase text-muted-foreground tracking-wider border-b border-border/40 mb-1 flex items-center justify-between">
                        <span>Matching Navigation Modules ({navSearchResults.length})</span>
                        <span>Click or Press Enter to Navigate</span>
                      </div>
                      {navSearchResults.map((item, idx) => {
                        const IconComponent = item.icon || Search;
                        return (
                          <div
                            key={idx}
                            onClick={() => {
                              navigate(item.path);
                              setSearchDropdownOpen(false);
                              setSearchQuery('');
                            }}
                            className="flex items-center justify-between p-2.5 rounded-xl hover:bg-primary/10 cursor-pointer transition-colors group"
                          >
                            <div className="flex items-center gap-3 overflow-hidden">
                              <div className="p-2 rounded-lg bg-muted group-hover:bg-primary group-hover:text-white transition-colors shrink-0">
                                <IconComponent className="h-4 w-4" />
                              </div>
                              <div className="truncate">
                                <p className="text-xs font-bold text-foreground group-hover:text-primary transition-colors truncate">
                                  {item.label}
                                </p>
                                <p className="text-[11px] text-muted-foreground font-mono truncate">{item.path}</p>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0 ml-2">
                              <span className="px-2 py-0.5 rounded text-[10px] font-extrabold uppercase tracking-wider bg-muted text-muted-foreground group-hover:bg-primary/20 group-hover:text-primary transition-colors">
                                {item.category}
                              </span>
                              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Right: Tools & User Profile */}
            <div className="flex items-center gap-3 shrink-0">

              <button onClick={toggleTheme} className="rounded-xl p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-all" title={themeMode === 'dark' ? "Switch to Light Mode" : "Switch to Dark Mode"}>
                {themeMode === 'dark' ? <Sun className="h-5 w-5 text-amber-400" /> : <Moon className="h-5 w-5" />}
              </button>

              {/* Notifications Bell */}
              <div className="relative" ref={notifRef}>
                <button onClick={() => setNotifOpen(!notifOpen)} className="relative rounded-xl p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-all">
                  <Bell className="h-5 w-5" />
                  {totalCombinedUnread > 0 && (
                    <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-white ring-2 ring-card animate-pulse">
                      {totalCombinedUnread > 9 ? '9+' : totalCombinedUnread}
                    </span>
                  )}
                </button>

                {notifOpen && (
                  <div className="absolute right-0 mt-2.5 z-40 w-80 sm:w-96 rounded-2xl border border-border/60 bg-card text-card-foreground p-4 shadow-2xl animate-in fade-in slide-in-from-top-3 duration-200">
                    <div className="flex items-center justify-between border-b border-border/40 pb-3">
                      <span className="text-xs font-bold">Notifications</span>
                      <div className="flex items-center gap-2.5">
                        {notifTab === 'all' && unreadCount > 0 && (
                          <button onClick={markAllAsRead} className="text-[10px] text-primary hover:underline font-bold">
                            Mark all read
                          </button>
                        )}
                        {notifTab === 'shifts' && shiftUnreadCount > 0 && (
                          <button onClick={handleMarkAllShiftRead} className="text-[10px] text-primary hover:underline font-bold">
                            Mark all read
                          </button>
                        )}
                        {notifTab === 'all' && notifications.length > 0 && (
                          <button onClick={clearAllNotifications} className="text-[10px] text-muted-foreground hover:text-rose-500 dark:hover:text-rose-400 hover:underline font-bold transition-colors">
                            Clear All
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Tab Selector */}
                    <div className="flex items-center gap-1.5 p-1 bg-muted/60 rounded-xl my-2.5 text-[11px] font-semibold">
                      <button
                        onClick={() => setNotifTab('all')}
                        className={`flex-1 py-1 px-2.5 rounded-lg transition-all text-center flex items-center justify-center gap-1.5 ${
                          notifTab === 'all' ? 'bg-card text-foreground shadow-sm font-bold' : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        <span>Workspace</span>
                        {unreadCount > 0 && (
                          <span className="px-1.5 py-0.2 rounded-full text-[9px] bg-primary/20 text-primary font-extrabold">{unreadCount}</span>
                        )}
                      </button>
                      <button
                        onClick={() => setNotifTab('shifts')}
                        className={`flex-1 py-1 px-2.5 rounded-lg transition-all text-center flex items-center justify-center gap-1.5 ${
                          notifTab === 'shifts' ? 'bg-card text-foreground shadow-sm font-bold' : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        <span>Shifts & Schedule</span>
                        {shiftUnreadCount > 0 && (
                          <span className="px-1.5 py-0.2 rounded-full text-[9px] bg-amber-500/20 text-amber-600 dark:text-amber-400 font-extrabold">{shiftUnreadCount}</span>
                        )}
                      </button>
                    </div>

                    {/* Notification Items */}
                    <div className="max-h-80 overflow-y-auto divide-y divide-border/40 py-1">
                      {notifTab === 'all' ? (
                        notifications.length === 0 ? (
                          <p className="text-xs text-center text-muted-foreground py-6 font-medium">No new notifications</p>
                        ) : (
                          notifications.map((n) => (
                            <div
                              key={n._id || n.id}
                              className={`p-3 rounded-xl transition-colors ${n.isRead ? 'opacity-70' : 'bg-primary/5 font-medium'} hover:bg-muted/50 flex items-start justify-between gap-2 my-1 cursor-pointer`}
                              onClick={() => markRead(n._id || n.id)}
                            >
                              <div className="flex-1">
                                <p className="text-xs font-semibold text-foreground">{n.title}</p>
                                <p className="text-xs text-muted-foreground mt-0.5">{n.message}</p>
                              </div>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  deleteNotification(n._id || n.id);
                                }}
                                className="text-muted-foreground hover:text-danger p-1 rounded-lg transition-colors"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          ))
                        )
                      ) : (
                        shiftNotifs.length === 0 ? (
                          <div className="text-center py-6">
                            <Clock className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
                            <p className="text-xs text-muted-foreground font-medium">No shift updates yet</p>
                          </div>
                        ) : (
                          shiftNotifs.map((sn) => (
                            <div
                              key={sn.id}
                              onClick={() => !sn.isRead && handleMarkShiftRead(sn.id)}
                              className={`p-3 rounded-xl transition-colors cursor-pointer my-1 flex items-start gap-2.5 ${
                                sn.isRead ? 'opacity-75' : 'bg-amber-500/10 border-l-2 border-amber-500 font-medium'
                              } hover:bg-muted/50`}
                            >
                              <div className="p-1.5 rounded-lg bg-muted shrink-0 mt-0.5 text-primary">
                                <Clock size={14} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-1">
                                  <p className="text-xs font-bold text-foreground truncate">{sn.title}</p>
                                  <span className="text-[9px] text-muted-foreground shrink-0">
                                    {new Date(sn.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                  </span>
                                </div>
                                <p className="text-xs text-muted-foreground mt-0.5 break-words">{sn.message}</p>
                                {!sn.isRead && (
                                  <div className="mt-1 flex items-center justify-end">
                                    <span className="text-[9px] text-primary hover:underline font-bold">Mark as read</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          ))
                        )
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Profile Dropdown */}
              <div className="relative" ref={profileRef}>
                <button
                  type="button"
                  onClick={() => setProfileOpen(prev => !prev)}
                  className="flex items-center gap-2 rounded-xl p-1 hover:bg-muted transition-all select-none"
                >
                  <UserAvatar
                    user={user}
                    className="h-8 w-8 rounded-xl object-cover ring-2 ring-primary/20"
                  />
                  <div className="hidden text-left md:block pr-1">
                    <p className="text-xs font-extrabold leading-none">{user?.name}</p>
                    <p className="text-[10px] text-muted-foreground font-semibold mt-0.5 capitalize leading-none">
                      {user?.role === 'ADMIN' ? 'Admin' : user?.role === 'TEAM_LEADER' ? 'Team Leader' : user?.role}
                    </p>
                  </div>
                  <ChevronDown size={14} className={`text-muted-foreground hidden sm:inline-block transition-transform duration-200 ${profileOpen ? 'rotate-180' : ''}`} />
                </button>

                {profileOpen && (
                  <div className="absolute right-0 mt-2.5 z-50 w-56 rounded-2xl border border-border/60 bg-card text-card-foreground p-2 shadow-2xl animate-in fade-in zoom-in-95 slide-in-from-top-2 duration-150 select-none">
                    <div className="px-3 py-2.5 border-b border-border/30 mb-1.5 text-left">
                      <p className="text-xs font-bold text-foreground">{user?.name}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{user?.email}</p>
                      <span className="mt-1.5 inline-block text-[9px] bg-primary/10 text-primary px-2 py-0.5 rounded font-extrabold uppercase">
                        {user?.role === 'ADMIN' ? 'ADMIN' : user?.role === 'TEAM_LEADER' ? 'TEAM LEADER' : user?.role}
                      </span>
                    </div>

                    <Link
                      to="/profile"
                      onClick={() => setProfileOpen(false)}
                      className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground font-semibold transition-colors"
                    >
                      <UserIcon className="h-4 w-4" />
                      <span>My Profile</span>
                    </Link>

                    {user?.role === 'ADMIN' && (
                      <Link
                        to="/settings"
                        onClick={() => setProfileOpen(false)}
                        className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground font-semibold transition-colors"
                      >
                        <Settings className="h-4 w-4" />
                        <span>Site Settings</span>
                      </Link>
                    )}

                    <hr className="my-1 border-border/40" />

                    <button
                      type="button"
                      onClick={() => {
                        setProfileOpen(false);
                        handleLogout();
                      }}
                      className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs text-danger hover:bg-danger/5 font-bold transition-colors text-left"
                    >
                      <LogOut className="h-4 w-4" />
                      <span>Logout</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

        {/* Dynamic content rendering with unified ambient background */}
        <main className="flex-1 flex flex-col min-h-0 min-w-0 overflow-y-auto px-2 sm:px-3 pt-2 pb-4 bg-transparent">
          {children}
        </main>
      </div>

      {/* Company Welcome Onboarding Modal */}
      <CompanyWelcomeModal />

      {/* Toast Alert Popup */}
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 flex max-w-sm gap-3 rounded-2xl border border-primary/20 bg-card p-4 shadow-2xl animate-in slide-in-from-bottom duration-300 text-left">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Bell className="h-5 w-5 animate-bounce" />
          </div>
          <div>
            <h4 className="text-xs font-bold text-foreground">{toastMessage.title}</h4>
            <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">{toastMessage.message}</p>
          </div>
          <button onClick={() => setToastMessage(null)} className="ml-auto rounded-lg p-1 hover:bg-muted self-start">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
};

export default DashboardLayout;
