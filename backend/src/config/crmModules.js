/**
 * InnovEity CRM — Central Module Registry
 * 
 * Single source of truth for all CRM functional modules, route bindings, 
 * backend API mappings, and role access baselines.
 * 
 * Rules:
 * - Every CRM module is declared with a stable, immutable unique key.
 * - Access levels supported per module: NONE (absent), VIEW (read-only), EDIT (full edit + view).
 * - Future modules added here appear automatically in the template editor with NO ACCESS by default.
 * - Platform infrastructure routes (/super-admin/*) are strictly excluded from tenant templates.
 */

// Permitted access levels
const ACCESS_LEVELS = Object.freeze({
  NONE: 'NONE',
  VIEW: 'VIEW',
  EDIT: 'EDIT'
});

// Module categories for organization in UI
const MODULE_CATEGORIES = Object.freeze({
  OVERVIEW: 'Overview',
  WORKSPACES: 'Workspaces',
  COMMUNICATION: 'Communication',
  OPERATIONS: 'Operations',
  FINANCE: 'Finance & Payroll',
  SYSTEM_CONTROL: 'System Control'
});

/**
 * Standard Operational CRM Modules eligible for template delegation
 */
const CRM_MODULES = [
  // --- Overview Category ---
  {
    key: 'dashboard',
    displayName: 'Dashboard Overview',
    category: MODULE_CATEGORIES.OVERVIEW,
    description: 'System overview dashboard, KPI summary widgets, attendance quick punches, and tasks stream.',
    defaultRoute: '/',
    routes: ['/'],
    apiPrefixes: [
      { method: 'GET', path: '/api/dashboard', required: ACCESS_LEVELS.VIEW }
    ],
    roleBaselines: {
      SUPER_ADMIN: ACCESS_LEVELS.EDIT,
      ADMIN: ACCESS_LEVELS.VIEW,
      TEAM_LEADER: ACCESS_LEVELS.VIEW,
      EMPLOYEE: ACCESS_LEVELS.VIEW,
      INTERN: ACCESS_LEVELS.VIEW
    },
    isProtectedSelfService: false
  },
  {
    key: 'profile',
    displayName: 'My Profile',
    category: MODULE_CATEGORIES.OVERVIEW,
    description: 'Personal account details, contact updates, password change, and avatar management.',
    defaultRoute: '/profile',
    routes: ['/profile'],
    apiPrefixes: [
      { method: 'GET', path: '/api/auth/profile', required: ACCESS_LEVELS.VIEW },
      { method: 'PUT', path: '/api/auth/profile', required: ACCESS_LEVELS.EDIT },
      { method: 'DELETE', path: '/api/users/profile-photo', required: ACCESS_LEVELS.EDIT }
    ],
    roleBaselines: {
      SUPER_ADMIN: ACCESS_LEVELS.EDIT,
      ADMIN: ACCESS_LEVELS.EDIT,
      TEAM_LEADER: ACCESS_LEVELS.EDIT,
      EMPLOYEE: ACCESS_LEVELS.EDIT,
      INTERN: ACCESS_LEVELS.EDIT
    },
    // Mandatory self-service rule: Universally accessible to every template-based login
    isUniversalSelfService: true
  },

  // --- Workspaces Category ---
  {
    key: 'projects',
    displayName: 'Projects & Milestones',
    category: MODULE_CATEGORIES.WORKSPACES,
    description: 'Manage client and internal projects, sprint milestones, documentation, and project teams.',
    defaultRoute: '/projects',
    routes: ['/projects', '/projects/:id'],
    apiPrefixes: [
      { method: 'GET', path: '/api/projects', required: ACCESS_LEVELS.VIEW },
      { method: 'POST', path: '/api/projects', required: ACCESS_LEVELS.EDIT },
      { method: 'PUT', path: '/api/projects', required: ACCESS_LEVELS.EDIT },
      { method: 'DELETE', path: '/api/projects', required: ACCESS_LEVELS.EDIT },
      { method: 'GET', path: '/api/milestones', required: ACCESS_LEVELS.VIEW },
      { method: 'POST', path: '/api/milestones', required: ACCESS_LEVELS.EDIT },
      { method: 'PUT', path: '/api/milestones', required: ACCESS_LEVELS.EDIT },
      { method: 'DELETE', path: '/api/milestones', required: ACCESS_LEVELS.EDIT }
    ],
    roleBaselines: {
      SUPER_ADMIN: ACCESS_LEVELS.EDIT,
      ADMIN: ACCESS_LEVELS.EDIT,
      TEAM_LEADER: ACCESS_LEVELS.EDIT,
      EMPLOYEE: ACCESS_LEVELS.VIEW,
      INTERN: ACCESS_LEVELS.VIEW
    }
  },
  {
    key: 'tasks',
    displayName: 'Tasks & Active Board',
    category: MODULE_CATEGORIES.WORKSPACES,
    description: 'Sprint Kanban board, timeline roadmap, task delegation, backlog tracking, and review workflows.',
    defaultRoute: '/tasks',
    routes: ['/tasks'],
    apiPrefixes: [
      { method: 'GET', path: '/api/tasks', required: ACCESS_LEVELS.VIEW },
      { method: 'POST', path: '/api/tasks', required: ACCESS_LEVELS.EDIT },
      { method: 'PUT', path: '/api/tasks', required: ACCESS_LEVELS.EDIT },
      { method: 'DELETE', path: '/api/tasks', required: ACCESS_LEVELS.EDIT },
      { method: 'POST', path: '/api/tasks/:id/submit', required: ACCESS_LEVELS.VIEW }, // Assignee submit
      { method: 'PUT', path: '/api/tasks/:id/status', required: ACCESS_LEVELS.VIEW }, // Assignee move
      { method: 'GET', path: '/api/task-dependencies', required: ACCESS_LEVELS.VIEW },
      { method: 'POST', path: '/api/task-dependencies', required: ACCESS_LEVELS.EDIT }
    ],
    roleBaselines: {
      SUPER_ADMIN: ACCESS_LEVELS.EDIT,
      ADMIN: ACCESS_LEVELS.EDIT,
      TEAM_LEADER: ACCESS_LEVELS.EDIT,
      EMPLOYEE: ACCESS_LEVELS.EDIT,
      INTERN: ACCESS_LEVELS.EDIT
    }
  },

  // --- Communication Category ---
  {
    key: 'chat',
    displayName: 'Company Chat Room',
    category: MODULE_CATEGORIES.COMMUNICATION,
    description: 'Real-time team messaging channels, direct messages, attachments, and unread badges.',
    defaultRoute: '/chat',
    routes: ['/chat'],
    apiPrefixes: [
      { method: 'GET', path: '/api/chat/rooms', required: ACCESS_LEVELS.VIEW },
      { method: 'POST', path: '/api/chat/rooms', required: ACCESS_LEVELS.EDIT },
      { method: 'GET', path: '/api/chat/rooms/:id/messages', required: ACCESS_LEVELS.VIEW },
      { method: 'POST', path: '/api/chat/messages', required: ACCESS_LEVELS.EDIT },
      { method: 'DELETE', path: '/api/chat/messages', required: ACCESS_LEVELS.EDIT }
    ],
    roleBaselines: {
      SUPER_ADMIN: ACCESS_LEVELS.EDIT,
      ADMIN: ACCESS_LEVELS.EDIT,
      TEAM_LEADER: ACCESS_LEVELS.EDIT,
      EMPLOYEE: ACCESS_LEVELS.EDIT,
      INTERN: ACCESS_LEVELS.EDIT
    }
  },
  {
    key: 'announcements',
    displayName: 'Announcements Bulletin',
    category: MODULE_CATEGORIES.COMMUNICATION,
    description: 'Broadcast company bulletins and team notifications with priority flags.',
    defaultRoute: '/announcements',
    routes: ['/announcements'],
    apiPrefixes: [
      { method: 'GET', path: '/api/announcements', required: ACCESS_LEVELS.VIEW },
      { method: 'POST', path: '/api/announcements', required: ACCESS_LEVELS.EDIT },
      { method: 'DELETE', path: '/api/announcements', required: ACCESS_LEVELS.EDIT }
    ],
    roleBaselines: {
      SUPER_ADMIN: ACCESS_LEVELS.EDIT,
      ADMIN: ACCESS_LEVELS.EDIT,
      TEAM_LEADER: ACCESS_LEVELS.EDIT,
      EMPLOYEE: ACCESS_LEVELS.VIEW,
      INTERN: ACCESS_LEVELS.VIEW
    }
  },
  {
    key: 'meetings',
    displayName: 'Meetings & Conferences',
    category: MODULE_CATEGORIES.COMMUNICATION,
    description: 'Schedule video conferences, Google Meet integration, attendee management, and meeting minutes & reports.',
    defaultRoute: '/meetings',
    routes: ['/meetings', '/meetings/:id'],
    apiPrefixes: [
      { method: 'GET', path: '/api/meetings', required: ACCESS_LEVELS.VIEW },
      { method: 'POST', path: '/api/meetings', required: ACCESS_LEVELS.EDIT },
      { method: 'PUT', path: '/api/meetings', required: ACCESS_LEVELS.EDIT },
      { method: 'DELETE', path: '/api/meetings', required: ACCESS_LEVELS.EDIT },
      { method: 'GET', path: '/api/meetings/:id/report', required: ACCESS_LEVELS.VIEW },
      { method: 'POST', path: '/api/meetings/:id/report', required: ACCESS_LEVELS.EDIT },
      { method: 'PUT', path: '/api/meetings/:id/report', required: ACCESS_LEVELS.EDIT }
    ],
    roleBaselines: {
      SUPER_ADMIN: ACCESS_LEVELS.EDIT,
      ADMIN: ACCESS_LEVELS.EDIT,
      TEAM_LEADER: ACCESS_LEVELS.EDIT,
      EMPLOYEE: ACCESS_LEVELS.VIEW,
      INTERN: ACCESS_LEVELS.VIEW
    }
  },

  // --- Operations Category ---
  {
    key: 'worklogs',
    displayName: 'Work Logs Tracking',
    category: MODULE_CATEGORIES.OPERATIONS,
    description: 'Daily operational time tracking, work descriptions, hours logged, and leader approvals.',
    defaultRoute: '/worklogs',
    routes: ['/worklogs'],
    apiPrefixes: [
      { method: 'GET', path: '/api/worklogs', required: ACCESS_LEVELS.VIEW },
      { method: 'POST', path: '/api/worklogs', required: ACCESS_LEVELS.EDIT },
      { method: 'PUT', path: '/api/worklogs', required: ACCESS_LEVELS.EDIT },
      { method: 'DELETE', path: '/api/worklogs', required: ACCESS_LEVELS.EDIT }
    ],
    roleBaselines: {
      SUPER_ADMIN: ACCESS_LEVELS.EDIT,
      ADMIN: ACCESS_LEVELS.EDIT,
      TEAM_LEADER: ACCESS_LEVELS.EDIT,
      EMPLOYEE: ACCESS_LEVELS.EDIT,
      INTERN: ACCESS_LEVELS.EDIT
    }
  },
  {
    key: 'attendance',
    displayName: 'Attendance Portal (Self-Service)',
    category: MODULE_CATEGORIES.OPERATIONS,
    description: 'Daily Clock-In and Clock-Out, GPS geofencing verification, and personal monthly history.',
    defaultRoute: '/attendance',
    routes: ['/attendance'],
    apiPrefixes: [
      { method: 'GET', path: '/api/attendance/today', required: ACCESS_LEVELS.VIEW },
      { method: 'GET', path: '/api/attendance/history', required: ACCESS_LEVELS.VIEW },
      { method: 'POST', path: '/api/attendance/clock-in', required: ACCESS_LEVELS.VIEW }, // Personal punch
      { method: 'POST', path: '/api/attendance/clock-out', required: ACCESS_LEVELS.VIEW },
      { method: 'GET', path: '/api/attendance/office-locations', required: ACCESS_LEVELS.VIEW }
    ],
    roleBaselines: {
      SUPER_ADMIN: ACCESS_LEVELS.EDIT,
      ADMIN: ACCESS_LEVELS.VIEW,
      TEAM_LEADER: ACCESS_LEVELS.VIEW,
      EMPLOYEE: ACCESS_LEVELS.VIEW,
      INTERN: ACCESS_LEVELS.VIEW
    }
  },
  {
    key: 'attendance_audit',
    displayName: 'Attendance Audit Logs',
    category: MODULE_CATEGORIES.OPERATIONS,
    description: 'Review system-wide clock-in/out records, verify IPs, browser headers, GPS coordinates, and CSV export.',
    defaultRoute: '/attendance-audit',
    routes: ['/attendance-audit'],
    apiPrefixes: [
      { method: 'GET', path: '/api/attendance/audit', required: ACCESS_LEVELS.VIEW },
      { method: 'GET', path: '/api/attendance/logs', required: ACCESS_LEVELS.VIEW },
      { method: 'GET', path: '/api/attendance/export', required: ACCESS_LEVELS.VIEW },
      { method: 'GET', path: '/api/attendance/company-leave-report', required: ACCESS_LEVELS.VIEW }
    ],
    roleBaselines: {
      SUPER_ADMIN: ACCESS_LEVELS.EDIT,
      ADMIN: ACCESS_LEVELS.EDIT,
      TEAM_LEADER: ACCESS_LEVELS.VIEW,
      EMPLOYEE: ACCESS_LEVELS.NONE,
      INTERN: ACCESS_LEVELS.NONE
    }
  },
  {
    key: 'leave_management',
    displayName: 'Leave Management',
    category: MODULE_CATEGORIES.OPERATIONS,
    description: 'Leave balance overview, application filing, calendar visualization, and managerial sanctioning.',
    defaultRoute: '/leave-management',
    routes: ['/leave-management', '/leaves'],
    apiPrefixes: [
      { method: 'GET', path: '/api/leaves', required: ACCESS_LEVELS.VIEW },
      { method: 'POST', path: '/api/leaves', required: ACCESS_LEVELS.VIEW }, // Filing own leave
      { method: 'GET', path: '/api/leaves/balances', required: ACCESS_LEVELS.VIEW },
      { method: 'PUT', path: '/api/leaves/:id/cancel', required: ACCESS_LEVELS.VIEW },
      { method: 'PUT', path: '/api/leaves/:id/status', required: ACCESS_LEVELS.EDIT }, // Approving others
      { method: 'POST', path: '/api/leaves/sanction', required: ACCESS_LEVELS.EDIT }
    ],
    roleBaselines: {
      SUPER_ADMIN: ACCESS_LEVELS.EDIT,
      ADMIN: ACCESS_LEVELS.EDIT,
      TEAM_LEADER: ACCESS_LEVELS.EDIT,
      EMPLOYEE: ACCESS_LEVELS.VIEW,
      INTERN: ACCESS_LEVELS.VIEW
    }
  },
  {
    key: 'work_calendar',
    displayName: 'Work Calendar & Shifts',
    category: MODULE_CATEGORIES.OPERATIONS,
    description: 'Company-wide work calendar, holiday schedules, weekend overrides, and shift timeline.',
    defaultRoute: '/operations/work-calendar',
    routes: ['/operations/work-calendar', '/work-calendar'],
    apiPrefixes: [
      { method: 'GET', path: '/api/work-calendar', required: ACCESS_LEVELS.VIEW },
      { method: 'POST', path: '/api/work-calendar', required: ACCESS_LEVELS.EDIT },
      { method: 'PUT', path: '/api/work-calendar', required: ACCESS_LEVELS.EDIT },
      { method: 'DELETE', path: '/api/work-calendar', required: ACCESS_LEVELS.EDIT }
    ],
    roleBaselines: {
      SUPER_ADMIN: ACCESS_LEVELS.EDIT,
      ADMIN: ACCESS_LEVELS.EDIT,
      TEAM_LEADER: ACCESS_LEVELS.VIEW,
      EMPLOYEE: ACCESS_LEVELS.VIEW,
      INTERN: ACCESS_LEVELS.VIEW
    }
  },
  {
    key: 'tickets',
    displayName: 'Ticket Helpdesk',
    category: MODULE_CATEGORIES.OPERATIONS,
    description: 'Support and IT ticketing desk, issue tracking, ticket assignment, and resolution comments.',
    defaultRoute: '/tickets',
    routes: ['/tickets'],
    apiPrefixes: [
      { method: 'GET', path: '/api/tickets', required: ACCESS_LEVELS.VIEW },
      { method: 'POST', path: '/api/tickets', required: ACCESS_LEVELS.VIEW }, // Raise own ticket
      { method: 'PUT', path: '/api/tickets', required: ACCESS_LEVELS.EDIT },
      { method: 'DELETE', path: '/api/tickets', required: ACCESS_LEVELS.EDIT },
      { method: 'PUT', path: '/api/tickets/:id/assign', required: ACCESS_LEVELS.EDIT },
      { method: 'PUT', path: '/api/tickets/:id/resolve', required: ACCESS_LEVELS.EDIT },
      { method: 'POST', path: '/api/tickets/:id/comments', required: ACCESS_LEVELS.VIEW }
    ],
    roleBaselines: {
      SUPER_ADMIN: ACCESS_LEVELS.EDIT,
      ADMIN: ACCESS_LEVELS.EDIT,
      TEAM_LEADER: ACCESS_LEVELS.EDIT,
      EMPLOYEE: ACCESS_LEVELS.VIEW,
      INTERN: ACCESS_LEVELS.VIEW
    }
  },
  {
    key: 'assets',
    displayName: 'Asset Management',
    category: MODULE_CATEGORIES.OPERATIONS,
    description: 'Hardware inventory, serial numbers, user assignments, handover tracking, and maintenance repair estimates.',
    defaultRoute: '/assets',
    routes: ['/assets'],
    apiPrefixes: [
      { method: 'GET', path: '/api/assets', required: ACCESS_LEVELS.VIEW },
      { method: 'POST', path: '/api/assets', required: ACCESS_LEVELS.EDIT },
      { method: 'PUT', path: '/api/assets', required: ACCESS_LEVELS.EDIT },
      { method: 'DELETE', path: '/api/assets', required: ACCESS_LEVELS.EDIT },
      { method: 'POST', path: '/api/assets/:id/assign', required: ACCESS_LEVELS.EDIT },
      { method: 'POST', path: '/api/assets/:id/return', required: ACCESS_LEVELS.EDIT },
      { method: 'GET', path: '/api/assets/estimates', required: ACCESS_LEVELS.VIEW }
    ],
    roleBaselines: {
      SUPER_ADMIN: ACCESS_LEVELS.EDIT,
      ADMIN: ACCESS_LEVELS.EDIT,
      TEAM_LEADER: ACCESS_LEVELS.VIEW,
      EMPLOYEE: ACCESS_LEVELS.VIEW,
      INTERN: ACCESS_LEVELS.VIEW
    }
  },
  {
    key: 'company_documents',
    displayName: 'Company Documents',
    category: MODULE_CATEGORIES.OPERATIONS,
    description: 'Organization contracts, compliance policies, legal forms, and staff downloads.',
    defaultRoute: '/company-documents',
    routes: ['/company-documents'],
    apiPrefixes: [
      { method: 'GET', path: '/api/company-documents', required: ACCESS_LEVELS.VIEW },
      { method: 'POST', path: '/api/company-documents', required: ACCESS_LEVELS.EDIT },
      { method: 'DELETE', path: '/api/company-documents', required: ACCESS_LEVELS.EDIT },
      { method: 'GET', path: '/api/company-documents/:id/download', required: ACCESS_LEVELS.VIEW }
    ],
    roleBaselines: {
      SUPER_ADMIN: ACCESS_LEVELS.EDIT,
      ADMIN: ACCESS_LEVELS.EDIT,
      TEAM_LEADER: ACCESS_LEVELS.EDIT,
      EMPLOYEE: ACCESS_LEVELS.NONE,
      INTERN: ACCESS_LEVELS.NONE
    }
  },
  {
    key: 'self_service',
    displayName: 'Employee Self-Service Portal',
    category: MODULE_CATEGORIES.OPERATIONS,
    description: 'Upcoming shift schedule, punch timeline, shift duration calculations, and shift swap requests.',
    defaultRoute: '/self-service',
    routes: ['/self-service'],
    apiPrefixes: [
      { method: 'GET', path: '/api/intelligence/self-service', required: ACCESS_LEVELS.VIEW },
      { method: 'GET', path: '/api/shifts/my-shift', required: ACCESS_LEVELS.VIEW },
      { method: 'POST', path: '/api/schedules/swap-request', required: ACCESS_LEVELS.VIEW }
    ],
    roleBaselines: {
      SUPER_ADMIN: ACCESS_LEVELS.EDIT,
      ADMIN: ACCESS_LEVELS.VIEW,
      TEAM_LEADER: ACCESS_LEVELS.VIEW,
      EMPLOYEE: ACCESS_LEVELS.VIEW,
      INTERN: ACCESS_LEVELS.VIEW
    }
  },

  // --- Finance & Payroll Category ---
  {
    key: 'payroll_dashboard',
    displayName: 'Payroll Dashboard',
    category: MODULE_CATEGORIES.FINANCE,
    description: 'Financial compensation KPIs, monthly disbursement overviews, and payroll status.',
    defaultRoute: '/payroll/dashboard',
    routes: ['/payroll/dashboard', '/payroll'],
    apiPrefixes: [
      { method: 'GET', path: '/api/payroll', required: ACCESS_LEVELS.VIEW },
      { method: 'GET', path: '/api/payroll/batches', required: ACCESS_LEVELS.VIEW }
    ],
    roleBaselines: {
      SUPER_ADMIN: ACCESS_LEVELS.EDIT,
      ADMIN: ACCESS_LEVELS.VIEW,
      TEAM_LEADER: ACCESS_LEVELS.NONE,
      EMPLOYEE: ACCESS_LEVELS.NONE,
      INTERN: ACCESS_LEVELS.NONE
    }
  },
  {
    key: 'payroll_templates',
    displayName: 'Salary Templates',
    category: MODULE_CATEGORIES.FINANCE,
    description: 'Configure compensation earnings, deductions, PF, ESI, professional tax, and allowances.',
    defaultRoute: '/payroll/templates',
    routes: ['/payroll/templates'],
    apiPrefixes: [
      { method: 'GET', path: '/api/payroll/templates', required: ACCESS_LEVELS.VIEW },
      { method: 'POST', path: '/api/payroll/templates', required: ACCESS_LEVELS.EDIT },
      { method: 'PUT', path: '/api/payroll/templates', required: ACCESS_LEVELS.EDIT },
      { method: 'DELETE', path: '/api/payroll/templates', required: ACCESS_LEVELS.EDIT }
    ],
    roleBaselines: {
      SUPER_ADMIN: ACCESS_LEVELS.EDIT,
      ADMIN: ACCESS_LEVELS.EDIT,
      TEAM_LEADER: ACCESS_LEVELS.NONE,
      EMPLOYEE: ACCESS_LEVELS.NONE,
      INTERN: ACCESS_LEVELS.NONE
    }
  },
  {
    key: 'payroll_structures',
    displayName: 'Salary Structures',
    category: MODULE_CATEGORIES.FINANCE,
    description: 'Assign compensation templates to individual workforce employees and view compensation brackets.',
    defaultRoute: '/payroll/structures',
    routes: ['/payroll/structures'],
    apiPrefixes: [
      { method: 'GET', path: '/api/payroll/salary-structures', required: ACCESS_LEVELS.VIEW },
      { method: 'POST', path: '/api/payroll/salary-structures', required: ACCESS_LEVELS.EDIT },
      { method: 'PUT', path: '/api/payroll/salary-structures', required: ACCESS_LEVELS.EDIT }
    ],
    roleBaselines: {
      SUPER_ADMIN: ACCESS_LEVELS.EDIT,
      ADMIN: ACCESS_LEVELS.EDIT,
      TEAM_LEADER: ACCESS_LEVELS.NONE,
      EMPLOYEE: ACCESS_LEVELS.NONE,
      INTERN: ACCESS_LEVELS.NONE
    }
  },
  {
    key: 'payroll_process',
    displayName: 'Payroll Processing Desk',
    category: MODULE_CATEGORIES.FINANCE,
    description: 'Execute monthly payroll batches, calculate deductions, review pay sheets, lock, and publish.',
    defaultRoute: '/payroll/processing',
    routes: ['/payroll/processing'],
    apiPrefixes: [
      { method: 'POST', path: '/api/payroll/process', required: ACCESS_LEVELS.EDIT },
      { method: 'PUT', path: '/api/payroll/batches/:id/lock', required: ACCESS_LEVELS.EDIT },
      { method: 'PUT', path: '/api/payroll/batches/:id/publish', required: ACCESS_LEVELS.EDIT },
      { method: 'PUT', path: '/api/payroll/batches/:id/rollback', required: ACCESS_LEVELS.EDIT }
    ],
    roleBaselines: {
      SUPER_ADMIN: ACCESS_LEVELS.EDIT,
      ADMIN: ACCESS_LEVELS.EDIT,
      TEAM_LEADER: ACCESS_LEVELS.NONE,
      EMPLOYEE: ACCESS_LEVELS.NONE,
      INTERN: ACCESS_LEVELS.NONE
    }
  },
  {
    key: 'payroll_payslips',
    displayName: 'Payslips Management Desk',
    category: MODULE_CATEGORIES.FINANCE,
    description: 'Inspect generated employee payslips, issue digital receipts, and download PDF statements.',
    defaultRoute: '/payroll/payslips',
    routes: ['/payroll/payslips'],
    apiPrefixes: [
      { method: 'GET', path: '/api/payroll/payslips', required: ACCESS_LEVELS.VIEW },
      { method: 'GET', path: '/api/payroll/payslips/:id/download', required: ACCESS_LEVELS.VIEW }
    ],
    roleBaselines: {
      SUPER_ADMIN: ACCESS_LEVELS.EDIT,
      ADMIN: ACCESS_LEVELS.EDIT,
      TEAM_LEADER: ACCESS_LEVELS.NONE,
      EMPLOYEE: ACCESS_LEVELS.NONE,
      INTERN: ACCESS_LEVELS.NONE
    }
  },
  {
    key: 'payroll_holidays',
    displayName: 'Payroll Holiday Calendar',
    category: MODULE_CATEGORIES.FINANCE,
    description: 'Configure financial holiday dates for payroll attendance computation.',
    defaultRoute: '/payroll/holidays',
    routes: ['/payroll/holidays'],
    apiPrefixes: [
      { method: 'GET', path: '/api/payroll/holidays', required: ACCESS_LEVELS.VIEW },
      { method: 'POST', path: '/api/payroll/holidays', required: ACCESS_LEVELS.EDIT },
      { method: 'DELETE', path: '/api/payroll/holidays', required: ACCESS_LEVELS.EDIT }
    ],
    roleBaselines: {
      SUPER_ADMIN: ACCESS_LEVELS.EDIT,
      ADMIN: ACCESS_LEVELS.EDIT,
      TEAM_LEADER: ACCESS_LEVELS.NONE,
      EMPLOYEE: ACCESS_LEVELS.NONE,
      INTERN: ACCESS_LEVELS.NONE
    }
  },
  {
    key: 'payroll_reports',
    displayName: 'Payroll Financial Reports',
    category: MODULE_CATEGORIES.FINANCE,
    description: 'Monthly payroll expenditure summaries, tax deductions, and bank disbursement audits.',
    defaultRoute: '/payroll/reports',
    routes: ['/payroll/reports'],
    apiPrefixes: [
      { method: 'GET', path: '/api/payroll/reports', required: ACCESS_LEVELS.VIEW }
    ],
    roleBaselines: {
      SUPER_ADMIN: ACCESS_LEVELS.EDIT,
      ADMIN: ACCESS_LEVELS.VIEW,
      TEAM_LEADER: ACCESS_LEVELS.NONE,
      EMPLOYEE: ACCESS_LEVELS.NONE,
      INTERN: ACCESS_LEVELS.NONE
    }
  },
  {
    key: 'payroll_settings',
    displayName: 'Payroll Configuration Settings',
    category: MODULE_CATEGORIES.FINANCE,
    description: 'Deduction policies, tax calculations, pay cycle cut-offs, and compliance formulas.',
    defaultRoute: '/payroll/settings',
    routes: ['/payroll/settings'],
    apiPrefixes: [
      { method: 'GET', path: '/api/payroll/settings', required: ACCESS_LEVELS.VIEW },
      { method: 'PUT', path: '/api/payroll/settings', required: ACCESS_LEVELS.EDIT }
    ],
    roleBaselines: {
      SUPER_ADMIN: ACCESS_LEVELS.EDIT,
      ADMIN: ACCESS_LEVELS.EDIT,
      TEAM_LEADER: ACCESS_LEVELS.NONE,
      EMPLOYEE: ACCESS_LEVELS.NONE,
      INTERN: ACCESS_LEVELS.NONE
    }
  },
  {
    key: 'my_payroll',
    displayName: 'My Payslips & Salary',
    category: MODULE_CATEGORIES.FINANCE,
    description: 'Personal salary history, monthly payslip viewing, breakdown, and download.',
    defaultRoute: '/my-payroll',
    routes: ['/my-payroll'],
    apiPrefixes: [
      { method: 'GET', path: '/api/payroll/payslips/my', required: ACCESS_LEVELS.VIEW }
    ],
    roleBaselines: {
      SUPER_ADMIN: ACCESS_LEVELS.EDIT,
      ADMIN: ACCESS_LEVELS.VIEW,
      TEAM_LEADER: ACCESS_LEVELS.VIEW,
      EMPLOYEE: ACCESS_LEVELS.VIEW,
      INTERN: ACCESS_LEVELS.VIEW
    }
  },

  // --- System Control Category ---
  {
    key: 'registry_interns',
    displayName: 'Interns Registry',
    category: MODULE_CATEGORIES.SYSTEM_CONTROL,
    description: 'Intern directory, university records, onboarding, profile updates, and evaluation status.',
    defaultRoute: '/interns',
    routes: ['/interns'],
    apiPrefixes: [
      { method: 'GET', path: '/api/users', required: ACCESS_LEVELS.VIEW },
      { method: 'POST', path: '/api/users', required: ACCESS_LEVELS.EDIT },
      { method: 'PUT', path: '/api/users', required: ACCESS_LEVELS.EDIT },
      { method: 'DELETE', path: '/api/users', required: ACCESS_LEVELS.EDIT }
    ],
    roleBaselines: {
      SUPER_ADMIN: ACCESS_LEVELS.EDIT,
      ADMIN: ACCESS_LEVELS.EDIT,
      TEAM_LEADER: ACCESS_LEVELS.NONE,
      EMPLOYEE: ACCESS_LEVELS.NONE,
      INTERN: ACCESS_LEVELS.NONE
    }
  },
  {
    key: 'registry_employees',
    displayName: 'Employees Registry',
    category: MODULE_CATEGORIES.SYSTEM_CONTROL,
    description: 'Staff directory, organizational positions, department mappings, promotions, and status control.',
    defaultRoute: '/employees',
    routes: ['/employees'],
    apiPrefixes: [
      { method: 'GET', path: '/api/users', required: ACCESS_LEVELS.VIEW },
      { method: 'POST', path: '/api/users', required: ACCESS_LEVELS.EDIT },
      { method: 'PUT', path: '/api/users', required: ACCESS_LEVELS.EDIT },
      { method: 'DELETE', path: '/api/users', required: ACCESS_LEVELS.EDIT },
      { method: 'GET', path: '/api/positions', required: ACCESS_LEVELS.VIEW }
    ],
    roleBaselines: {
      SUPER_ADMIN: ACCESS_LEVELS.EDIT,
      ADMIN: ACCESS_LEVELS.EDIT,
      TEAM_LEADER: ACCESS_LEVELS.NONE,
      EMPLOYEE: ACCESS_LEVELS.NONE,
      INTERN: ACCESS_LEVELS.NONE
    }
  },
  {
    key: 'registry_teamleaders',
    displayName: 'Team Leaders Registry',
    category: MODULE_CATEGORIES.SYSTEM_CONTROL,
    description: 'Team leadership directory, team assignments, credential management, and leader metrics.',
    defaultRoute: '/team-leaders',
    routes: ['/team-leaders'],
    apiPrefixes: [
      { method: 'GET', path: '/api/users', required: ACCESS_LEVELS.VIEW },
      { method: 'POST', path: '/api/users', required: ACCESS_LEVELS.EDIT },
      { method: 'PUT', path: '/api/users', required: ACCESS_LEVELS.EDIT },
      { method: 'DELETE', path: '/api/users', required: ACCESS_LEVELS.EDIT }
    ],
    roleBaselines: {
      SUPER_ADMIN: ACCESS_LEVELS.EDIT,
      ADMIN: ACCESS_LEVELS.EDIT,
      TEAM_LEADER: ACCESS_LEVELS.NONE,
      EMPLOYEE: ACCESS_LEVELS.NONE,
      INTERN: ACCESS_LEVELS.NONE
    }
  },
  {
    key: 'teams_hub',
    displayName: 'Teams Hub',
    category: MODULE_CATEGORIES.SYSTEM_CONTROL,
    description: 'Team units, team leader assignments, member rosters, and team collaboration scope.',
    defaultRoute: '/teams',
    routes: ['/teams'],
    apiPrefixes: [
      { method: 'GET', path: '/api/teams', required: ACCESS_LEVELS.VIEW },
      { method: 'POST', path: '/api/teams', required: ACCESS_LEVELS.EDIT },
      { method: 'PUT', path: '/api/teams', required: ACCESS_LEVELS.EDIT },
      { method: 'DELETE', path: '/api/teams', required: ACCESS_LEVELS.EDIT },
      { method: 'PUT', path: '/api/teams/:id/members', required: ACCESS_LEVELS.EDIT }
    ],
    roleBaselines: {
      SUPER_ADMIN: ACCESS_LEVELS.EDIT,
      ADMIN: ACCESS_LEVELS.EDIT,
      TEAM_LEADER: ACCESS_LEVELS.VIEW,
      EMPLOYEE: ACCESS_LEVELS.VIEW,
      INTERN: ACCESS_LEVELS.VIEW
    }
  },
  {
    key: 'reports',
    displayName: 'Reports Center',
    category: MODULE_CATEGORIES.SYSTEM_CONTROL,
    description: 'Cross-functional operational reports, attendance analytics, task completions, and CSV exports.',
    defaultRoute: '/reports',
    routes: ['/reports'],
    apiPrefixes: [
      { method: 'GET', path: '/api/reports/attendance', required: ACCESS_LEVELS.VIEW },
      { method: 'GET', path: '/api/reports/tasks', required: ACCESS_LEVELS.VIEW },
      { method: 'GET', path: '/api/reports/leaves', required: ACCESS_LEVELS.VIEW },
      { method: 'GET', path: '/api/reports/export', required: ACCESS_LEVELS.VIEW }
    ],
    roleBaselines: {
      SUPER_ADMIN: ACCESS_LEVELS.EDIT,
      ADMIN: ACCESS_LEVELS.VIEW,
      TEAM_LEADER: ACCESS_LEVELS.VIEW,
      EMPLOYEE: ACCESS_LEVELS.NONE,
      INTERN: ACCESS_LEVELS.NONE
    }
  },
  {
    key: 'audit_logs',
    displayName: 'System Audit Logs',
    category: MODULE_CATEGORIES.SYSTEM_CONTROL,
    description: 'Enterprise activity logging, IP addresses, authentication traces, and administrative audit history.',
    defaultRoute: '/audit-logs',
    routes: ['/audit-logs'],
    apiPrefixes: [
      { method: 'GET', path: '/api/logs', required: ACCESS_LEVELS.VIEW }
    ],
    roleBaselines: {
      SUPER_ADMIN: ACCESS_LEVELS.EDIT,
      ADMIN: ACCESS_LEVELS.VIEW,
      TEAM_LEADER: ACCESS_LEVELS.NONE,
      EMPLOYEE: ACCESS_LEVELS.NONE,
      INTERN: ACCESS_LEVELS.NONE
    }
  },
  {
    key: 'site_settings',
    displayName: 'Site Settings & Geofencing',
    category: MODULE_CATEGORIES.SYSTEM_CONTROL,
    description: 'Company coordinates, GPS geofence bounds, shift time definitions, and branding themes.',
    defaultRoute: '/settings',
    routes: ['/settings'],
    apiPrefixes: [
      { method: 'GET', path: '/api/settings', required: ACCESS_LEVELS.VIEW },
      { method: 'PUT', path: '/api/settings', required: ACCESS_LEVELS.EDIT },
      { method: 'GET', path: '/api/organizations/settings', required: ACCESS_LEVELS.VIEW },
      { method: 'PUT', path: '/api/organizations/settings', required: ACCESS_LEVELS.EDIT }
    ],
    roleBaselines: {
      SUPER_ADMIN: ACCESS_LEVELS.EDIT,
      ADMIN: ACCESS_LEVELS.EDIT,
      TEAM_LEADER: ACCESS_LEVELS.NONE,
      EMPLOYEE: ACCESS_LEVELS.NONE,
      INTERN: ACCESS_LEVELS.NONE
    }
  }
];

/**
 * Super Admin Platform-Control Infrastructure Routes
 * 
 * STRICT SECURITY REQUIREMENT:
 * These routes are permanently restricted to the SUPER_ADMIN system role
 * and CANNOT be delegated to any access template or tenant user.
 */
const SUPER_ADMIN_EXCLUDED_MODULES = [
  { key: 'platform_dashboard', name: 'Platform Dashboard', route: '/super-admin/dashboard' },
  { key: 'platform_branding', name: 'Branding & Theme Center', route: '/super-admin/branding' },
  { key: 'platform_users', name: 'All Users Directory', route: '/super-admin/users' },
  { key: 'platform_teams', name: 'Global Team Directory', route: '/super-admin/teams' },
  { key: 'platform_admins', name: 'Administrator Provisioning', route: '/super-admin/admins' },
  { key: 'platform_organizations', name: 'Organization Manager & Ranks', route: '/super-admin/organization' },
  { key: 'platform_leave_policy', name: 'Global Leave Policy', route: '/super-admin/leave-policy' },
  { key: 'platform_late_policy', name: 'Global Late Policy', route: '/super-admin/late-policy' },
  { key: 'platform_operations', name: 'Operations & Telemetry', route: '/super-admin/operations' },
  { key: 'platform_backup_restore', name: 'Live Database Backup & Disaster Recovery', route: '/super-admin/backup-restore' }
];

/**
 * Helper: Find module by unique key
 */
const getModuleByKey = (key) => {
  return CRM_MODULES.find(m => m.key === key) || null;
};

/**
 * Helper: Get default baseline permission for a base role on a module
 */
const getDefaultRolePermission = (moduleKey, baseRole) => {
  const mod = getModuleByKey(moduleKey);
  if (!mod || !mod.roleBaselines) return ACCESS_LEVELS.NONE;
  return mod.roleBaselines[baseRole] || ACCESS_LEVELS.NONE;
};

module.exports = {
  ACCESS_LEVELS,
  MODULE_CATEGORIES,
  CRM_MODULES,
  SUPER_ADMIN_EXCLUDED_MODULES,
  getModuleByKey,
  getDefaultRolePermission
};
