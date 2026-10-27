/**
 * InnovEity CRM — Client-Side Module Registry & Permission Keys
 * 
 * Synchronized with backend/src/config/crmModules.js.
 * Single source of truth for all 31 operational CRM module keys,
 * access levels, and baseline role defaults.
 */

export const ACCESS_LEVELS = Object.freeze({
  NONE: 'NONE',
  VIEW: 'VIEW',
  EDIT: 'EDIT'
});

export const CRM_MODULE_KEYS = Object.freeze({
  // Overview
  DASHBOARD: 'dashboard',
  PROFILE: 'profile',

  // Workspaces
  PROJECTS: 'projects',
  TASKS: 'tasks',

  // Communication
  CHAT: 'chat',
  ANNOUNCEMENTS: 'announcements',
  MEETINGS: 'meetings',

  // Operations
  WORKLOGS: 'worklogs',
  ATTENDANCE: 'attendance',
  ATTENDANCE_AUDIT: 'attendance_audit',
  LEAVE_MANAGEMENT: 'leave_management',
  WORK_CALENDAR: 'work_calendar',
  TICKETS: 'tickets',
  ASSETS: 'assets',
  COMPANY_DOCUMENTS: 'company_documents',
  SELF_SERVICE: 'self_service',

  // Finance & Payroll
  PAYROLL_DASHBOARD: 'payroll_dashboard',
  PAYROLL_TEMPLATES: 'payroll_templates',
  PAYROLL_STRUCTURES: 'payroll_structures',
  PAYROLL_PROCESS: 'payroll_process',
  PAYROLL_PAYSLIPS: 'payroll_payslips',
  PAYROLL_HOLIDAYS: 'payroll_holidays',
  PAYROLL_REPORTS: 'payroll_reports',
  PAYROLL_SETTINGS: 'payroll_settings',
  MY_PAYROLL: 'my_payroll',

  // System Control
  REGISTRY_INTERNS: 'registry_interns',
  REGISTRY_EMPLOYEES: 'registry_employees',
  REGISTRY_TEAMLEADERS: 'registry_teamleaders',
  TEAMS_HUB: 'teams_hub',
  REPORTS: 'reports',
  AUDIT_LOGS: 'audit_logs',
  SITE_SETTINGS: 'site_settings'
});

/**
 * Backward-compatible role baselines for existing users without an assigned template.
 * Matches backend/src/config/crmModules.js roleBaselines.
 */
export const ROLE_BASELINES = Object.freeze({
  SUPER_ADMIN: {
    dashboard: 'EDIT',
    profile: 'EDIT',
    projects: 'EDIT',
    tasks: 'EDIT',
    chat: 'EDIT',
    announcements: 'EDIT',
    meetings: 'EDIT',
    worklogs: 'EDIT',
    attendance: 'EDIT',
    attendance_audit: 'EDIT',
    leave_management: 'EDIT',
    work_calendar: 'EDIT',
    tickets: 'EDIT',
    assets: 'EDIT',
    company_documents: 'EDIT',
    self_service: 'EDIT',
    payroll_dashboard: 'EDIT',
    payroll_templates: 'EDIT',
    payroll_structures: 'EDIT',
    payroll_process: 'EDIT',
    payroll_payslips: 'EDIT',
    payroll_holidays: 'EDIT',
    payroll_reports: 'EDIT',
    payroll_settings: 'EDIT',
    my_payroll: 'EDIT',
    registry_interns: 'EDIT',
    registry_employees: 'EDIT',
    registry_teamleaders: 'EDIT',
    teams_hub: 'EDIT',
    reports: 'EDIT',
    audit_logs: 'EDIT',
    site_settings: 'EDIT'
  },
  ADMIN: {
    dashboard: 'VIEW',
    profile: 'EDIT',
    projects: 'EDIT',
    tasks: 'EDIT',
    chat: 'EDIT',
    announcements: 'EDIT',
    meetings: 'EDIT',
    worklogs: 'EDIT',
    attendance: 'VIEW',
    attendance_audit: 'EDIT',
    leave_management: 'EDIT',
    work_calendar: 'EDIT',
    tickets: 'EDIT',
    assets: 'EDIT',
    company_documents: 'EDIT',
    self_service: 'VIEW',
    payroll_dashboard: 'VIEW',
    payroll_templates: 'EDIT',
    payroll_structures: 'EDIT',
    payroll_process: 'EDIT',
    payroll_payslips: 'EDIT',
    payroll_holidays: 'EDIT',
    payroll_reports: 'VIEW',
    payroll_settings: 'EDIT',
    my_payroll: 'VIEW',
    registry_interns: 'EDIT',
    registry_employees: 'EDIT',
    registry_teamleaders: 'EDIT',
    teams_hub: 'EDIT',
    reports: 'VIEW',
    audit_logs: 'VIEW',
    site_settings: 'EDIT'
  },
  TEAM_LEADER: {
    dashboard: 'VIEW',
    profile: 'EDIT',
    projects: 'EDIT',
    tasks: 'EDIT',
    chat: 'EDIT',
    announcements: 'EDIT',
    meetings: 'EDIT',
    worklogs: 'EDIT',
    attendance: 'VIEW',
    attendance_audit: 'VIEW',
    leave_management: 'EDIT',
    work_calendar: 'VIEW',
    tickets: 'EDIT',
    assets: 'VIEW',
    company_documents: 'EDIT',
    self_service: 'VIEW',
    payroll_dashboard: 'NONE',
    payroll_templates: 'NONE',
    payroll_structures: 'NONE',
    payroll_process: 'NONE',
    payroll_payslips: 'NONE',
    payroll_holidays: 'NONE',
    payroll_reports: 'NONE',
    payroll_settings: 'NONE',
    my_payroll: 'VIEW',
    registry_interns: 'NONE',
    registry_employees: 'NONE',
    registry_teamleaders: 'NONE',
    teams_hub: 'VIEW',
    reports: 'VIEW',
    audit_logs: 'NONE',
    site_settings: 'NONE'
  },
  EMPLOYEE: {
    dashboard: 'VIEW',
    profile: 'EDIT',
    projects: 'VIEW',
    tasks: 'EDIT',
    chat: 'EDIT',
    announcements: 'VIEW',
    meetings: 'VIEW',
    worklogs: 'EDIT',
    attendance: 'VIEW',
    attendance_audit: 'NONE',
    leave_management: 'VIEW',
    work_calendar: 'VIEW',
    tickets: 'VIEW',
    assets: 'VIEW',
    company_documents: 'NONE',
    self_service: 'VIEW',
    payroll_dashboard: 'NONE',
    payroll_templates: 'NONE',
    payroll_structures: 'NONE',
    payroll_process: 'NONE',
    payroll_payslips: 'NONE',
    payroll_holidays: 'NONE',
    payroll_reports: 'NONE',
    payroll_settings: 'NONE',
    my_payroll: 'VIEW',
    registry_interns: 'NONE',
    registry_employees: 'NONE',
    registry_teamleaders: 'NONE',
    teams_hub: 'VIEW',
    reports: 'NONE',
    audit_logs: 'NONE',
    site_settings: 'NONE'
  },
  INTERN: {
    dashboard: 'VIEW',
    profile: 'EDIT',
    projects: 'VIEW',
    tasks: 'EDIT',
    chat: 'EDIT',
    announcements: 'VIEW',
    meetings: 'VIEW',
    worklogs: 'EDIT',
    attendance: 'VIEW',
    attendance_audit: 'NONE',
    leave_management: 'VIEW',
    work_calendar: 'VIEW',
    tickets: 'VIEW',
    assets: 'VIEW',
    company_documents: 'NONE',
    self_service: 'VIEW',
    payroll_dashboard: 'NONE',
    payroll_templates: 'NONE',
    payroll_structures: 'NONE',
    payroll_process: 'NONE',
    payroll_payslips: 'NONE',
    payroll_holidays: 'NONE',
    payroll_reports: 'NONE',
    payroll_settings: 'NONE',
    my_payroll: 'VIEW',
    registry_interns: 'NONE',
    registry_employees: 'NONE',
    registry_teamleaders: 'NONE',
    teams_hub: 'VIEW',
    reports: 'NONE',
    audit_logs: 'NONE',
    site_settings: 'NONE'
  }
});

export const getRoleBaselinePermission = (role, moduleKey) => {
  if (!role) return ACCESS_LEVELS.NONE;
  const roleUpper = String(role).toUpperCase();
  if (roleUpper === 'SUPER_ADMIN') return ACCESS_LEVELS.EDIT;
  if (moduleKey === CRM_MODULE_KEYS.PROFILE || moduleKey === 'profile') return ACCESS_LEVELS.EDIT;
  return ROLE_BASELINES[roleUpper]?.[moduleKey] || ACCESS_LEVELS.NONE;
};
