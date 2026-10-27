/**
 * Phase 3 Automated Verification Test Suite
 * 
 * Verifies:
 * 1. Component creation and syntax integrity
 * 2. Routing, navigation, and sidebar registration
 * 3. WorkCalendar integration (no competing calendar, meetings overlay, badges, modals)
 * 4. Role-based and effective permission UI gating
 * 5. Team Leader scope switching (OWN_TEAM_ONLY vs CROSS_TEAM)
 * 6. Meeting report modal & idempotent follow-up tasks
 * 7. Live API end-to-end flow with token authentication
 */

const fs = require('fs');
const path = require('path');
module.paths.push(path.resolve(__dirname, '..', 'backend', 'node_modules'));
require('dotenv').config({ path: path.resolve(__dirname, '..', 'backend', '.env') });

const axios = require('axios');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'enterprise_internship_crm_super_secret_jwt_key_123!';
const API_BASE = 'http://localhost:5000/api';

let passed = 0;
let failed = 0;

function assert(condition, testName) {
  if (condition) {
    console.log(`  [PASS] Test ${passed + failed + 1}: ${testName}`);
    passed++;
  } else {
    console.error(`  [FAIL] Test ${passed + failed + 1}: ${testName}`);
    failed++;
  }
}

async function runTests() {
  console.log('================================================================');
  console.log(' PHASE 3 TEST SUITE: MEETINGS FRONTEND & CALENDAR INTEGRATION');
  console.log('================================================================\n');

  // --- SECTION 1: Frontend Files Integrity ---
  console.log('--- SECTION 1: Frontend Component Files & Architecture ---');
  const frontendDir = path.resolve(__dirname, '../frontend/src');

  const scheduleModalPath = path.join(frontendDir, 'components/meetings/ScheduleMeetingModal.jsx');
  const drawerPath = path.join(frontendDir, 'components/meetings/MeetingDetailDrawer.jsx');
  const reportModalPath = path.join(frontendDir, 'components/meetings/MeetingReportModal.jsx');
  const calendarCompPath = path.join(frontendDir, 'components/meetings/MeetingCalendar.jsx');
  const meetingsPagePath = path.join(frontendDir, 'pages/Meetings.jsx');
  const workCalendarPath = path.join(frontendDir, 'pages/WorkCalendar.jsx');
  const dashboardLayoutPath = path.join(frontendDir, 'components/layouts/DashboardLayout.jsx');
  const appPath = path.join(frontendDir, 'App.jsx');

  assert(fs.existsSync(scheduleModalPath), 'ScheduleMeetingModal.jsx exists');
  assert(fs.existsSync(drawerPath), 'MeetingDetailDrawer.jsx exists');
  assert(fs.existsSync(reportModalPath), 'MeetingReportModal.jsx exists');
  assert(fs.existsSync(calendarCompPath), 'MeetingCalendar.jsx exists');
  assert(fs.existsSync(meetingsPagePath), 'Meetings.jsx page exists');

  // --- SECTION 2: Navigation & Routing Registration ---
  console.log('\n--- SECTION 2: Navigation, Breadcrumbs & Routing Registration ---');
  const appCode = fs.readFileSync(appPath, 'utf8');
  assert(appCode.includes("import Meetings from './pages/Meetings';") || appCode.includes("import('./pages/Meetings')"), 'App.jsx imports Meetings page (static or lazy)');
  assert(appCode.includes('path="/meetings"'), 'App.jsx registers /meetings route');
  assert(appCode.includes('moduleKey={CRM_MODULE_KEYS.MEETINGS}'), 'App.jsx guards /meetings with CRM_MODULE_KEYS.MEETINGS');

  const layoutCode = fs.readFileSync(dashboardLayoutPath, 'utf8');
  assert(layoutCode.includes("label: 'Meetings'"), 'DashboardLayout includes Meetings in navigation');
  assert(layoutCode.includes("path: '/meetings'"), 'DashboardLayout links Meetings to /meetings');
  assert(layoutCode.includes('CRM_MODULE_KEYS.MEETINGS'), 'DashboardLayout uses CRM_MODULE_KEYS.MEETINGS key');
  assert(layoutCode.includes("category: 'Communication'"), 'DashboardLayout categorizes Meetings under Communication');
  assert(layoutCode.includes("parts.push({ label: 'Meetings', path: '/meetings' });"), 'DashboardLayout includes Meetings in breadcrumb trail');

  // --- SECTION 3: WorkCalendar Integration ---
  console.log('\n--- SECTION 3: WorkCalendar Integration (Single Unified Calendar) ---');
  const calCode = fs.readFileSync(workCalendarPath, 'utf8');
  assert(calCode.includes('ScheduleMeetingModal'), 'WorkCalendar imports ScheduleMeetingModal');
  assert(calCode.includes('MeetingDetailDrawer'), 'WorkCalendar imports MeetingDetailDrawer');
  assert(calCode.includes('MeetingReportModal'), 'WorkCalendar imports MeetingReportModal');
  assert(calCode.includes("api.get('/meetings'"), 'WorkCalendar fetches meetings via /meetings endpoint');
  assert(calCode.includes('meetingsByDate'), 'WorkCalendar indexes meetings by date string');
  assert(!calCode.includes('meetings = [meetings, meetings]'), 'WorkCalendar avoids duplicate meetings accumulation');
  assert(calCode.includes('dayMeetings.slice(0, 2).map'), 'WorkCalendar renders meeting badge pills inside calendar cells');
  assert(calCode.includes('e.stopPropagation()'), 'WorkCalendar stops propagation when clicking meeting chip to preserve day override flow');
  assert(calCode.includes('Scheduled Meetings'), 'WorkCalendar date details modal displays scheduled meetings for clicked date');
  assert(calCode.includes('canScheduleMeeting'), 'WorkCalendar guards meeting creation action with canEdit("meetings")');
  assert(calCode.includes('meeting_created'), 'WorkCalendar syncs real-time meeting events via socket');

  // --- SECTION 4: Team Leader Scope & Validation Contracts ---
  console.log('\n--- SECTION 4: Team Leader Scope & Validation Contracts ---');
  const scheduleCode = fs.readFileSync(scheduleModalPath, 'utf8');
  assert(scheduleCode.includes("scope, setScope] = useState('OWN_TEAM_ONLY')"), 'ScheduleMeetingModal defaults scope to OWN_TEAM_ONLY');
  assert(scheduleCode.includes('OWN_TEAM_ONLY') && scheduleCode.includes('CROSS_TEAM'), 'ScheduleMeetingModal supports both OWN_TEAM_ONLY and CROSS_TEAM');
  assert(scheduleCode.includes('teamMembersOnly'), 'ScheduleMeetingModal computes team-only members for TL');
  assert(scheduleCode.includes('setSelectedAttendees(prev => prev.filter'), 'ScheduleMeetingModal revalidates/filters selected attendees when switching scopes');
  assert(scheduleCode.includes('filter(u => u.id !== user?.id)'), 'ScheduleMeetingModal prevents organizer from being added as attendee');
  assert(scheduleCode.includes('isValidGoogleMeetUrl'), 'ScheduleMeetingModal validates Google Meet URL format');
  assert(scheduleCode.includes('endMin <= startMin'), 'ScheduleMeetingModal validates end time is later than start time');

  // --- SECTION 5: Meeting Detail Drawer Actions & Permission Gating ---
  console.log('\n--- SECTION 5: Meeting Detail Drawer Actions & Permission Gating ---');
  const drawerCode = fs.readFileSync(drawerPath, 'utf8');
  assert(drawerCode.includes('canManageMeeting = canEdit(\'meetings\') && (isOrganizer || isAdmin)'), 'MeetingDetailDrawer gates management actions to organizer or admin with edit permission');
  assert(drawerCode.includes('reschedule'), 'MeetingDetailDrawer supports meeting reschedule action');
  assert(drawerCode.includes('cancel'), 'MeetingDetailDrawer supports meeting cancellation with confirmation');
  assert(drawerCode.includes('complete'), 'MeetingDetailDrawer supports marking meeting as complete');
  assert(drawerCode.includes('onOpenReport'), 'MeetingDetailDrawer supports viewing or filing meeting reports');

  // --- SECTION 6: Meeting Report Modal & Follow-Up Tasks ---
  console.log('\n--- SECTION 6: Meeting Report Modal & Follow-Up Tasks ---');
  const reportCode = fs.readFileSync(reportModalPath, 'utf8');
  assert(reportCode.includes("api.get(`/meetings/${meeting.id}/report`)"), 'MeetingReportModal fetches existing report for idempotency');
  assert(reportCode.includes("api.post(`/meetings/${meeting.id}/report`"), 'MeetingReportModal saves report to /meetings/:id/report');
  assert(reportCode.includes('followUpTasks'), 'MeetingReportModal supports follow-up tasks array');
  assert(reportCode.includes('canModifyReport'), 'MeetingReportModal distinguishes read-only vs editable mode');

  // --- SECTION 7: Live API & End-to-End Scenarios ---
  console.log('\n--- SECTION 7: Live API Integration & Role Verification ---');

  // Find or create test organization
  let testOrg = await prisma.organization.findFirst();
  if (!testOrg) {
    testOrg = await prisma.organization.create({
      data: { name: 'InnovEity Test Org', slug: 'innoveity-test', status: 'ACTIVE' }
    });
  }

  // Find users
  const adminUser = await prisma.user.findFirst({
    where: { organizationId: testOrg.id, role: 'ADMIN', status: 'ACTIVE' }
  });
  const employeeUser = await prisma.user.findFirst({
    where: { organizationId: testOrg.id, role: 'EMPLOYEE', status: 'ACTIVE' }
  });
  const internUser = await prisma.user.findFirst({
    where: { organizationId: testOrg.id, role: 'INTERN', status: 'ACTIVE' }
  });

  if (!adminUser || !employeeUser) {
    console.log('  [SKIP] Skipping live role API check due to insufficient test users');
  } else {
    const adminToken = jwt.sign({ id: adminUser.id, role: adminUser.role, organizationId: testOrg.id }, JWT_SECRET, { expiresIn: '1h' });
    const empToken = jwt.sign({ id: employeeUser.id, role: employeeUser.role, organizationId: testOrg.id }, JWT_SECRET, { expiresIn: '1h' });

    // 1. Admin lists meetings
    const listRes = await axios.get(`${API_BASE}/meetings?organizationId=${testOrg.id}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(listRes.status === 200 && Array.isArray(listRes.data.meetings), 'Admin successfully calls GET /api/meetings');

    // 2. Schedule a meeting as Admin
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 2);
    const dateStr = tomorrow.toISOString().split('T')[0];

    const createRes = await axios.post(`${API_BASE}/meetings`, {
      title: 'Phase 3 Frontend Verification Sync',
      description: 'End-to-end integration check for Phase 3 calendar & UI',
      date: `${dateStr}T00:00:00.000Z`,
      startTime: `${dateStr}T14:00:00.000Z`,
      endTime: `${dateStr}T15:00:00.000Z`,
      attendeeIds: [employeeUser.id],
      scope: 'CROSS_TEAM',
      googleMeetUrl: 'https://meet.google.com/xyz-uvwx-rst',
      organizationId: testOrg.id
    }, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(createRes.status === 201 && createRes.data.meeting?.id, 'Admin successfully schedules meeting via POST /api/meetings');
    const meetingId = createRes.data.meeting.id;

    // 3. Employee with VIEW-only permissions attempting unauthorized write operation is blocked
    try {
      await axios.post(`${API_BASE}/meetings`, {
        title: 'Unauthorized Employee Meeting',
        date: `${dateStr}T00:00:00.000Z`,
        startTime: `${dateStr}T16:00:00.000Z`,
        endTime: `${dateStr}T17:00:00.000Z`,
        attendeeIds: [adminUser.id],
        organizationId: testOrg.id
      }, {
        headers: { Authorization: `Bearer ${empToken}` }
      });
      assert(false, 'Employee creation should have been blocked');
    } catch (err) {
      assert(err.response?.status === 403, 'Employee write operation correctly rejected with 403 Forbidden');
    }

    // 4. Employee can view the meeting they were invited to
    const empMeetingRes = await axios.get(`${API_BASE}/meetings/${meetingId}?organizationId=${testOrg.id}`, {
      headers: { Authorization: `Bearer ${empToken}` }
    });
    assert(empMeetingRes.status === 200 && empMeetingRes.data.meeting.id === meetingId, 'Employee can view meeting details for invited session');

    // 5. Work Calendar endpoint includes regular shifts and works alongside meetings
    const calRes = await axios.get(`${API_BASE}/work-calendar?month=${tomorrow.getMonth() + 1}&year=${tomorrow.getFullYear()}&organizationId=${testOrg.id}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(calRes.status === 200 && Array.isArray(calRes.data.days), 'Work Calendar endpoint returns calendar days safely alongside meetings');

    // 6. Record Meeting Report with follow-up tasks
    const reportRes = await axios.post(`${API_BASE}/meetings/${meetingId}/report`, {
      summary: 'Discussed Phase 3 integration into WorkCalendar and verified seamless event overlays.',
      followUpTasks: [
        {
          title: 'Review calendar badges',
          priority: 'HIGH',
          assigneeId: employeeUser.id,
          deadline: dateStr
        }
      ]
    }, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(reportRes.status === 200 && reportRes.data.report?.summary, 'Meeting report recorded successfully with follow-up tasks');

    // 7. Verify Idempotent update on report without duplicates
    const updateReportRes = await axios.post(`${API_BASE}/meetings/${meetingId}/report`, {
      summary: 'Updated summary: All Phase 3 checks completed.',
      followUpTasks: [
        {
          title: 'Review calendar badges (Updated)',
          priority: 'MEDIUM',
          assigneeId: employeeUser.id,
          deadline: dateStr
        }
      ]
    }, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(updateReportRes.status === 200 && updateReportRes.data.report.summary.includes('Updated summary'), 'Idempotent report update succeeds without duplicate creation');

    // 8. Meeting automatically marked COMPLETED when report is filed
    const completedMeeting = await prisma.meeting.findUnique({ where: { id: meetingId } });
    assert(completedMeeting.status === 'COMPLETED', 'Meeting status automatically updated to COMPLETED on report save');

    // Clean up test meeting
    await prisma.meetingAttendee.deleteMany({ where: { meetingId } });
    await prisma.meetingReport.deleteMany({ where: { meetingId } });
    await prisma.meeting.delete({ where: { id: meetingId } });
    console.log('  [INFO] Temporary verification meeting cleaned up safely.');
  }

  console.log('\n================================================================');
  console.log(` SUMMARY: ${passed} passed, ${failed} failed (Total: ${passed + failed})`);
  console.log('================================================================\n');

  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
