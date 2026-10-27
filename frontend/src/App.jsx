import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Link } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { CompanyScopeProvider } from './context/CompanyScopeContext';
import { SocketProvider } from './context/SocketContext';
import DashboardLayout from './components/layouts/DashboardLayout';

// Pages
import Login from './pages/Login';
import CompanyLogin from './pages/CompanyLogin';
import Dashboard from './pages/Dashboard';
import Interns from './pages/Interns';
import TeamLeaders from './pages/TeamLeaders';
import Employees from './pages/Employees';
import Teams from './pages/Teams';
import Tasks from './pages/Tasks';
import Attendance from './pages/Attendance';
import AttendanceAudit from './pages/AttendanceAudit';
import LeaveManagementPage from './pages/LeaveManagementPage';
import Tickets from './pages/Tickets';
import Announcements from './pages/Announcements';
import Chat from './pages/Chat';
import Profile from './pages/Profile';
import Reports from './pages/Reports';
import AuditLogs from './pages/AuditLogs';
import SiteSettings from './pages/SiteSettings';
import AssetManagement from './pages/AssetManagement';
import CompanyDocuments from './pages/CompanyDocuments';
import Projects from './pages/Projects';
import WorkLogs from './pages/WorkLogs';
import WorkCalendar from './pages/WorkCalendar';
const Meetings = React.lazy(() => import('./pages/Meetings'));



// Finance & Payroll Pages
import PayrollDashboardPage from './pages/finance/PayrollDashboardPage';
import SalaryTemplatesPage from './pages/finance/SalaryTemplatesPage';
import SalaryStructuresPage from './pages/finance/SalaryStructuresPage';
import PayrollProcessingPage from './pages/finance/PayrollProcessingPage';
import PayslipsPage from './pages/finance/PayslipsPage';
import HolidayCalendarPage from './pages/finance/HolidayCalendarPage';
import PayrollSettingsPage from './pages/finance/PayrollSettingsPage';
import EmployeePayrollPage from './pages/finance/EmployeePayrollPage';

import { ThemeProvider, useTheme } from './context/ThemeContext';
import { BrandProvider } from './context/BrandContext';
import SuperAdminDashboard from './pages/super-admin/dashboard/SuperAdminDashboard';
import UsersDirectory from './pages/super-admin/users/UsersDirectory';
import TeamDirectory from './pages/super-admin/teams/TeamDirectory';
import AdminManagement from './pages/super-admin/admins/AdminManagement';
import OrganizationManager from './pages/super-admin/organization/OrganizationManager';
import PlatformOperationsDashboard from './pages/super-admin/operations/PlatformOperationsDashboard';
import LeavePolicySettings from './pages/super-admin/LeavePolicySettings';
import LatePolicySettings from './pages/super-admin/LatePolicySettings';
import BackupRestore from './pages/super-admin/BackupRestore';
import RoleAccessManagement from './pages/super-admin/access/RoleAccessManagement';
import EmployeeSelfService from './components/intelligence/EmployeeSelfService';
import ErrorBoundary from './components/common/ErrorBoundary';

// Enterprise Branding Center
import BrandingCenter from './components/enterprise/BrandingCenter';
import { usePermissions } from './hooks/usePermissions';
import { CRM_MODULE_KEYS } from './config/crmModules';
import { ShieldAlert } from 'lucide-react';

// Access Denied view when a user is restricted by their assigned access template
const AccessDeniedView = ({ moduleKey }) => {
  const { user } = useAuth();
  const { canView } = usePermissions();

  // For template-assigned users who cannot access dashboard, provide safe route to /profile
  const hasDashboardAccess = canView ? canView(CRM_MODULE_KEYS.DASHBOARD) : false;
  const isTemplateUser = Boolean(user?.accessTemplateId);
  const returnPath = (!hasDashboardAccess || isTemplateUser) ? '/profile' : '/';
  const returnLabel = (!hasDashboardAccess || isTemplateUser) ? 'Return to My Profile' : 'Return to Dashboard';

  return (
    <div className="flex-1 flex items-center justify-center p-6 text-center min-h-[60vh]">
      <div className="max-w-md w-full bg-card border border-border/80 rounded-3xl p-8 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-200">
        <div className="mx-auto w-16 h-16 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 flex items-center justify-center">
          <ShieldAlert className="w-8 h-8" />
        </div>
        <div className="space-y-2">
          <h2 className="text-xl font-black text-foreground">Access Restricted</h2>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Your assigned role access template does not authorize access to this module
            {moduleKey ? <span className="font-mono font-bold text-foreground"> ({moduleKey})</span> : ''}.
          </p>
          <p className="text-[11px] text-muted-foreground/80">
            If you require access to this operational workspace, please request an access update from your system administrator.
          </p>
        </div>
        <div className="pt-2">
          <Link
            to={returnPath}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-xs font-bold shadow-md hover:bg-primary-hover transition-all"
          >
            {returnLabel}
          </Link>
        </div>
      </div>
    </div>
  );
};

// Protected Route wrapper with Role Check & Dynamic Access Template Module Check
const ProtectedRoute = ({ children, allowedRoles, moduleKey, requiredPermission = 'VIEW' }) => {
  const { user, loading } = useAuth();
  const { canView, canEdit } = usePermissions();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // 1. Role-based baseline checks (Super Admin platform routes or explicit allowed roles)
  if (allowedRoles && allowedRoles.length > 0 && user?.role) {
    const userRoleUpper = String(user.role).toUpperCase();
    const allowedUpper = allowedRoles.map(r => String(r).toUpperCase());
    if (!allowedUpper.includes(userRoleUpper)) {
      return <Navigate to="/" replace />;
    }
  }

  // 2. Dynamic Template Module Permission Check (Phase 4)
  if (moduleKey && user?.role !== 'SUPER_ADMIN') {
    // Universal self-service: Profile is always allowed
    if (moduleKey !== CRM_MODULE_KEYS.PROFILE && moduleKey !== 'profile') {
      const isAllowed = requiredPermission === 'EDIT' ? canEdit(moduleKey) : canView(moduleKey);
      if (!isAllowed) {
        return (
          <DashboardLayout>
            <AccessDeniedView moduleKey={moduleKey} />
          </DashboardLayout>
        );
      }
    }
  }

  return (
    <DashboardLayout>
      <ErrorBoundary>
        {children}
      </ErrorBoundary>
    </DashboardLayout>
  );
};

// Chat Feature Protected Route wrapper
const ChatProtectedRoute = ({ children }) => {
  const { canUseChat } = useTheme();
  console.log('[DEBUG Trace Step 5 - ChatProtectedRoute]', { canUseChat });
  if (!canUseChat) {
    return <Navigate to="/" replace />;
  }
  return children;
};

const RootDashboardRedirect = () => {
  const { user } = useAuth();
  if (user?.role === 'SUPER_ADMIN') {
    return <Navigate to="/super-admin/dashboard" replace />;
  }
  return <Dashboard />;
};

const App = () => {
  return (
    <Router>
      <AuthProvider>
        <CompanyScopeProvider>
          <BrandProvider>
            <ThemeProvider>
              <SocketProvider>
                <React.Suspense fallback={
                  <div className="flex h-screen items-center justify-center bg-background">
                    <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                  </div>
                }>
                  <Routes>
                  {/* Public Auth Routes */}
                  <Route path="/login" element={<Login />} />
                  <Route path="/company/:slug" element={<CompanyLogin />} />

                  {/* Super Admin Platform Control Center Routes */}
                  <Route
                    path="/super-admin"
                    element={<Navigate to="/super-admin/dashboard" replace />}
                  />
                  <Route
                    path="/super-admin/dashboard"
                    element={
                      <ProtectedRoute allowedRoles={['SUPER_ADMIN']}>
                        <SuperAdminDashboard />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/super-admin/branding"
                    element={
                      <ProtectedRoute allowedRoles={['SUPER_ADMIN']}>
                        <BrandingCenter />
                      </ProtectedRoute>
                    }
                  />

                  <Route
                    path="/super-admin/users"
                    element={
                      <ProtectedRoute allowedRoles={['SUPER_ADMIN']}>
                        <UsersDirectory />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/super-admin/teams"
                    element={
                      <ProtectedRoute allowedRoles={['SUPER_ADMIN']}>
                        <TeamDirectory />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/super-admin/admins"
                    element={
                      <ProtectedRoute allowedRoles={['SUPER_ADMIN']}>
                        <AdminManagement />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/super-admin/role-access"
                    element={
                      <ProtectedRoute allowedRoles={['SUPER_ADMIN']}>
                        <RoleAccessManagement />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/super-admin/organization"
                    element={
                      <ProtectedRoute allowedRoles={['SUPER_ADMIN']}>
                        <OrganizationManager />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/super-admin/leave-policy"
                    element={
                      <ProtectedRoute allowedRoles={['SUPER_ADMIN']}>
                        <LeavePolicySettings />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/super-admin/late-policy"
                    element={
                      <ProtectedRoute allowedRoles={['SUPER_ADMIN']}>
                        <LatePolicySettings />
                      </ProtectedRoute>
                    }
                  />

                  <Route
                    path="/super-admin/operations"
                    element={
                      <ProtectedRoute allowedRoles={['SUPER_ADMIN']}>
                        <PlatformOperationsDashboard />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/super-admin/backup-restore"
                    element={
                      <ProtectedRoute allowedRoles={['SUPER_ADMIN']}>
                        <BackupRestore />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/super-admin/backups"
                    element={
                      <ProtectedRoute allowedRoles={['SUPER_ADMIN']}>
                        <BackupRestore />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/self-service"
                    element={
                      <ProtectedRoute allowedRoles={['EMPLOYEE', 'INTERN', 'TEAM_LEADER', 'ADMIN', 'SUPER_ADMIN']} moduleKey={CRM_MODULE_KEYS.SELF_SERVICE}>
                        <div className="p-6 max-w-7xl mx-auto">
                          <EmployeeSelfService />
                        </div>
                      </ProtectedRoute>
                    }
                  />

                  {/* Protected Role-Based Routes */}
                  <Route
                    path="/"
                    element={
                      <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ADMIN', 'EMPLOYEE', 'TEAM_LEADER', 'INTERN']} moduleKey={CRM_MODULE_KEYS.DASHBOARD}>
                        <RootDashboardRedirect />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/interns"
                    element={
                      <ProtectedRoute allowedRoles={['ADMIN', 'SUPER_ADMIN']} moduleKey={CRM_MODULE_KEYS.REGISTRY_INTERNS}>
                        <Interns />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/team-leaders"
                    element={
                      <ProtectedRoute allowedRoles={['ADMIN', 'SUPER_ADMIN']} moduleKey={CRM_MODULE_KEYS.REGISTRY_TEAMLEADERS}>
                        <TeamLeaders />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/employees"
                    element={
                      <ProtectedRoute allowedRoles={['ADMIN', 'SUPER_ADMIN']} moduleKey={CRM_MODULE_KEYS.REGISTRY_EMPLOYEES}>
                        <Employees />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/projects"
                    element={
                      <ProtectedRoute allowedRoles={['ADMIN', 'TEAM_LEADER', 'INTERN', 'EMPLOYEE', 'SUPER_ADMIN']} moduleKey={CRM_MODULE_KEYS.PROJECTS}>
                        <Projects />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/teams"
                    element={
                      <ProtectedRoute allowedRoles={['ADMIN', 'TEAM_LEADER', 'INTERN', 'EMPLOYEE', 'SUPER_ADMIN']} moduleKey={CRM_MODULE_KEYS.TEAMS_HUB}>
                        <Teams />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/tasks"
                    element={
                      <ProtectedRoute allowedRoles={['ADMIN', 'TEAM_LEADER', 'INTERN', 'EMPLOYEE', 'SUPER_ADMIN']} moduleKey={CRM_MODULE_KEYS.TASKS}>
                        <Tasks />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/attendance"
                    element={
                      <ProtectedRoute allowedRoles={['INTERN', 'TEAM_LEADER', 'EMPLOYEE', 'ADMIN', 'SUPER_ADMIN']} moduleKey={CRM_MODULE_KEYS.ATTENDANCE}>
                        <Attendance />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/attendance-audit"
                    element={
                      <ProtectedRoute allowedRoles={['ADMIN', 'TEAM_LEADER', 'SUPER_ADMIN']} moduleKey={CRM_MODULE_KEYS.ATTENDANCE_AUDIT}>
                        <AttendanceAudit />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/leave-management"
                    element={
                      <ProtectedRoute allowedRoles={['ADMIN', 'TEAM_LEADER', 'EMPLOYEE', 'INTERN', 'SUPER_ADMIN']} moduleKey={CRM_MODULE_KEYS.LEAVE_MANAGEMENT}>
                        <LeaveManagementPage />
                      </ProtectedRoute>
                    }
                  />
                  <Route path="/leaves" element={<Navigate to="/leave-management" replace />} />
                  <Route path="/operations/leave" element={<Navigate to="/leave-management" replace />} />
                  <Route path="/work-calendar" element={<Navigate to="/operations/work-calendar" replace />} />
                  <Route
                    path="/operations/work-calendar"
                    element={
                      <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ADMIN', 'TEAM_LEADER', 'EMPLOYEE', 'INTERN']} moduleKey={CRM_MODULE_KEYS.WORK_CALENDAR}>
                        <WorkCalendar />
                      </ProtectedRoute>
                    }
                  />

                  <Route
                    path="/tickets"
                    element={
                      <ProtectedRoute allowedRoles={['ADMIN', 'TEAM_LEADER', 'INTERN', 'EMPLOYEE', 'SUPER_ADMIN']} moduleKey={CRM_MODULE_KEYS.TICKETS}>
                        <Tickets />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/announcements"
                    element={
                      <ProtectedRoute allowedRoles={['ADMIN', 'TEAM_LEADER', 'INTERN', 'EMPLOYEE', 'SUPER_ADMIN']} moduleKey={CRM_MODULE_KEYS.ANNOUNCEMENTS}>
                        <Announcements />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/chat"
                    element={
                      <ProtectedRoute allowedRoles={['ADMIN', 'TEAM_LEADER', 'INTERN', 'EMPLOYEE', 'SUPER_ADMIN']} moduleKey={CRM_MODULE_KEYS.CHAT}>
                        <ChatProtectedRoute>
                          <Chat />
                        </ChatProtectedRoute>
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/meetings"
                    element={
                      <ProtectedRoute allowedRoles={['ADMIN', 'TEAM_LEADER', 'INTERN', 'EMPLOYEE', 'SUPER_ADMIN']} moduleKey={CRM_MODULE_KEYS.MEETINGS}>
                        <Meetings />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/assets"
                    element={
                      <ProtectedRoute allowedRoles={['ADMIN', 'TEAM_LEADER', 'INTERN', 'EMPLOYEE', 'SUPER_ADMIN']} moduleKey={CRM_MODULE_KEYS.ASSETS}>
                        <AssetManagement />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/company-documents"
                    element={
                      <ProtectedRoute allowedRoles={['ADMIN', 'TEAM_LEADER', 'SUPER_ADMIN']} moduleKey={CRM_MODULE_KEYS.COMPANY_DOCUMENTS}>
                        <CompanyDocuments />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/profile"
                    element={
                      <ProtectedRoute allowedRoles={['ADMIN', 'TEAM_LEADER', 'INTERN', 'EMPLOYEE', 'SUPER_ADMIN']} moduleKey={CRM_MODULE_KEYS.PROFILE}>
                        <Profile />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/reports"
                    element={
                      <ProtectedRoute allowedRoles={['ADMIN', 'TEAM_LEADER', 'SUPER_ADMIN']} moduleKey={CRM_MODULE_KEYS.REPORTS}>
                        <Reports />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/audit-logs"
                    element={
                      <ProtectedRoute allowedRoles={['ADMIN', 'SUPER_ADMIN']} moduleKey={CRM_MODULE_KEYS.AUDIT_LOGS}>
                        <AuditLogs />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/settings"
                    element={
                      <ProtectedRoute allowedRoles={['ADMIN', 'SUPER_ADMIN']} moduleKey={CRM_MODULE_KEYS.SITE_SETTINGS}>
                        <SiteSettings />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/worklogs"
                    element={
                      <ProtectedRoute allowedRoles={['ADMIN', 'EMPLOYEE', 'TEAM_LEADER', 'INTERN', 'SUPER_ADMIN']} moduleKey={CRM_MODULE_KEYS.WORKLOGS}>
                        <WorkLogs />
                      </ProtectedRoute>
                    }
                  />

                  {/* Finance & Payroll Module Routes */}
                  <Route path="/payroll" element={<Navigate to="/payroll/dashboard" replace />} />
                  <Route
                    path="/payroll/dashboard"
                    element={
                      <ProtectedRoute allowedRoles={['ADMIN', 'SUPER_ADMIN']} moduleKey={CRM_MODULE_KEYS.PAYROLL_DASHBOARD}>
                        <PayrollDashboardPage />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/payroll/templates"
                    element={
                      <ProtectedRoute allowedRoles={['ADMIN', 'SUPER_ADMIN']} moduleKey={CRM_MODULE_KEYS.PAYROLL_TEMPLATES}>
                        <SalaryTemplatesPage />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/payroll/structures"
                    element={
                      <ProtectedRoute allowedRoles={['ADMIN', 'SUPER_ADMIN']} moduleKey={CRM_MODULE_KEYS.PAYROLL_STRUCTURES}>
                        <SalaryStructuresPage />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/payroll/processing"
                    element={
                      <ProtectedRoute allowedRoles={['ADMIN', 'SUPER_ADMIN']} moduleKey={CRM_MODULE_KEYS.PAYROLL_PROCESS}>
                        <PayrollProcessingPage />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/payroll/payslips"
                    element={
                      <ProtectedRoute allowedRoles={['ADMIN', 'SUPER_ADMIN']} moduleKey={CRM_MODULE_KEYS.PAYROLL_PAYSLIPS}>
                        <PayslipsPage />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/payroll/holidays"
                    element={
                      <ProtectedRoute allowedRoles={['ADMIN', 'SUPER_ADMIN']} moduleKey={CRM_MODULE_KEYS.PAYROLL_HOLIDAYS}>
                        <HolidayCalendarPage />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/payroll/settings"
                    element={
                      <ProtectedRoute allowedRoles={['ADMIN', 'SUPER_ADMIN']} moduleKey={CRM_MODULE_KEYS.PAYROLL_SETTINGS}>
                        <PayrollSettingsPage />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/my-payroll"
                    element={
                      <ProtectedRoute allowedRoles={['ADMIN', 'EMPLOYEE', 'TEAM_LEADER', 'INTERN']} moduleKey={CRM_MODULE_KEYS.MY_PAYROLL}>
                        <EmployeePayrollPage />
                      </ProtectedRoute>
                    }
                  />

                  {/* Catch-all fallback */}
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
                </React.Suspense>
              </SocketProvider>
            </ThemeProvider>
          </BrandProvider>
        </CompanyScopeProvider>
      </AuthProvider>
    </Router>
  );
};

export default App;
