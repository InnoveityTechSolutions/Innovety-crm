/**
 * Phase 2 Verification Suite: Meetings Backend Core APIs, Authorization, Scope, and Notifications
 */

const path = require('path');
module.paths.push(path.resolve(__dirname, '..', 'backend', 'node_modules'));
require('dotenv').config({ path: path.resolve(__dirname, '..', 'backend', '.env') });

const axios = require('axios');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const API_BASE = 'http://localhost:5000/api';
const JWT_SECRET = process.env.JWT_SECRET || 'enterprise_internship_crm_super_secret_jwt_key_123!';

const makeToken = (user) => {
  return jwt.sign(
    { id: user.id, role: user.role, organizationId: user.organizationId },
    JWT_SECRET,
    { expiresIn: '2h' }
  );
};

async function runSuite() {
  console.log('================================================================');
  console.log(' PHASE 2 TEST SUITE: MEETINGS BACKEND APIS & SECURITY CHECKS');
  console.log('================================================================\n');

  let totalTests = 0;
  let passedTests = 0;
  let failedTests = 0;

  function assert(condition, testName, details = '') {
    totalTests++;
    if (condition) {
      passedTests++;
      console.log(`  [PASS] Test ${totalTests}: ${testName}`);
    } else {
      failedTests++;
      console.error(`  [FAIL] Test ${totalTests}: ${testName}`);
      if (details) console.error(`         Details: ${details}`);
    }
  }

  // --- 1. Fixture Setup ---
  console.log('--- Setting up test fixtures ---');
  const org1 = await prisma.organization.findFirst({ orderBy: { createdAt: 'asc' } });
  let org2 = await prisma.organization.findFirst({ where: { id: { not: org1.id } } });
  if (!org2) {
    org2 = await prisma.organization.create({
      data: { name: 'Test Org 2', slug: 'test-org-2', companyCode: 'ORG2-99' }
    });
  }

  // Existing admin in org1
  const adminUser = await prisma.user.findFirst({ where: { role: 'ADMIN', organizationId: org1.id } });
  const adminToken = makeToken(adminUser);
  const adminHeaders = { Authorization: `Bearer ${adminToken}` };

  // Create temporary test users in org1
  const tlUser = await prisma.user.create({
    data: {
      employeeId: `TL-TEST-${Date.now()}`,
      name: 'Test Team Leader',
      email: `tl_test_${Date.now()}@crm.test`,
      password: 'hashedpassword',
      role: 'TEAM_LEADER',
      organizationId: org1.id,
      status: 'ACTIVE'
    }
  });
  const tlToken = makeToken(tlUser);
  const tlHeaders = { Authorization: `Bearer ${tlToken}` };

  const empTeamA = await prisma.user.create({
    data: {
      employeeId: `EM-TEST-A-${Date.now()}`,
      name: 'Employee Team A',
      email: `emp_a_${Date.now()}@crm.test`,
      password: 'hashedpassword',
      role: 'EMPLOYEE',
      organizationId: org1.id,
      status: 'ACTIVE'
    }
  });
  const empAToken = makeToken(empTeamA);
  const empAHeaders = { Authorization: `Bearer ${empAToken}` };

  const empTeamB = await prisma.user.create({
    data: {
      employeeId: `EM-TEST-B-${Date.now()}`,
      name: 'Employee Team B',
      email: `emp_b_${Date.now()}@crm.test`,
      password: 'hashedpassword',
      role: 'EMPLOYEE',
      organizationId: org1.id,
      status: 'ACTIVE'
    }
  });
  const empBToken = makeToken(empTeamB);
  const empBHeaders = { Authorization: `Bearer ${empBToken}` };

  // User in Org2 (for cross-tenant checks)
  const org2User = await prisma.user.create({
    data: {
      employeeId: `ORG2-EM-${Date.now()}`,
      name: 'Org 2 Employee',
      email: `org2_emp_${Date.now()}@crm.test`,
      password: 'hashedpassword',
      role: 'EMPLOYEE',
      organizationId: org2.id,
      status: 'ACTIVE'
    }
  });

  // Create Teams: Team Alpha (TL leads it, empTeamA is member) and Team Beta (empTeamB is member)
  const teamAlpha = await prisma.team.create({
    data: {
      name: `Team Alpha ${Date.now()}`,
      organizationId: org1.id,
      leaderId: tlUser.id,
      members: {
        create: [
          { userId: tlUser.id },
          { userId: empTeamA.id }
        ]
      }
    }
  });

  const teamBeta = await prisma.team.create({
    data: {
      name: `Team Beta ${Date.now()}`,
      organizationId: org1.id,
      members: {
        create: [
          { userId: empTeamB.id }
        ]
      }
    }
  });

  // Track created meetings for cleanup
  const createdMeetingIds = [];

  try {
    // --- Section 1: Prisma Client Access & DB Tables ---
    console.log('\n--- SECTION 1: Prisma Client & DB Table Verification ---');
    assert(typeof prisma.meeting === 'object', 'prisma.meeting model client accessible');
    assert(typeof prisma.meetingAttendee === 'object', 'prisma.meetingAttendee model client accessible');
    assert(typeof prisma.meetingReport === 'object', 'prisma.meetingReport model client accessible');

    const dbTables = await prisma.$queryRawUnsafe("SHOW TABLES LIKE 'meeting%'");
    assert(dbTables.length >= 3, `MySQL meeting tables exist (${dbTables.length} found)`);

    // --- Section 2: Authentication & Authorization Enforcements ---
    console.log('\n--- SECTION 2: Authentication & Permissions ---');
    try {
      await axios.get(`${API_BASE}/meetings`);
      assert(false, 'Unauthenticated request rejected with 401');
    } catch (e) {
      assert(e.response?.status === 401, 'Unauthenticated request rejected with 401');
    }

    try {
      await axios.get(`${API_BASE}/meetings`, { headers: { Authorization: 'Bearer invalid-token' } });
      assert(false, 'Invalid token request rejected with 401');
    } catch (e) {
      assert(e.response?.status === 401, 'Invalid token request rejected with 401');
    }

    // Default Employee has VIEW access, cannot schedule (EDIT required)
    try {
      await axios.post(`${API_BASE}/meetings`, {
        title: 'Unauthorized Employee Meeting',
        date: new Date().toISOString(),
        startTime: new Date(Date.now() + 3600000).toISOString(),
        endTime: new Date(Date.now() + 7200000).toISOString(),
        attendeeIds: [empTeamB.id]
      }, { headers: empAHeaders });
      assert(false, 'Employee without EDIT access rejected on meeting creation');
    } catch (e) {
      assert(e.response?.status === 403 && e.response?.data?.code === 'READ_ONLY_ACCESS',
        'Employee with default VIEW access rejected with 403 READ_ONLY_ACCESS on creation');
    }

    // --- Section 3: Validation, Required Fields & Time Order ---
    console.log('\n--- SECTION 3: Validation & Error Handling ---');
    // Missing title
    try {
      await axios.post(`${API_BASE}/meetings`, {
        date: new Date().toISOString(),
        startTime: new Date(Date.now() + 3600000).toISOString(),
        endTime: new Date(Date.now() + 7200000).toISOString(),
        attendeeIds: [empTeamA.id]
      }, { headers: tlHeaders });
      assert(false, 'Missing title rejected with 400');
    } catch (e) {
      assert(e.response?.status === 400, 'Missing title rejected with 400');
    }

    // End time before start time
    try {
      await axios.post(`${API_BASE}/meetings`, {
        title: 'Invalid Time Meeting',
        date: new Date().toISOString(),
        startTime: new Date(Date.now() + 7200000).toISOString(),
        endTime: new Date(Date.now() + 3600000).toISOString(), // earlier than start!
        attendeeIds: [empTeamA.id]
      }, { headers: tlHeaders });
      assert(false, 'End time before start time rejected with 400');
    } catch (e) {
      assert(e.response?.status === 400 && e.response?.data?.message?.includes('after start time'),
        'End time before start time rejected with 400');
    }

    // No attendees
    try {
      await axios.post(`${API_BASE}/meetings`, {
        title: 'Zero Attendees Meeting',
        date: new Date().toISOString(),
        startTime: new Date(Date.now() + 3600000).toISOString(),
        endTime: new Date(Date.now() + 7200000).toISOString(),
        attendeeIds: []
      }, { headers: tlHeaders });
      assert(false, 'Empty attendee list rejected with 400');
    } catch (e) {
      assert(e.response?.status === 400, 'Empty attendee list rejected with 400');
    }

    // Only organizer as attendee
    try {
      await axios.post(`${API_BASE}/meetings`, {
        title: 'Self-Only Meeting',
        date: new Date().toISOString(),
        startTime: new Date(Date.now() + 3600000).toISOString(),
        endTime: new Date(Date.now() + 7200000).toISOString(),
        attendeeIds: [tlUser.id] // organizer only
      }, { headers: tlHeaders });
      assert(false, 'Organizer as sole attendee rejected with 400');
    } catch (e) {
      assert(e.response?.status === 400, 'Organizer as sole attendee rejected with 400');
    }

    // --- Section 4: Google Meet URL Security Validation ---
    console.log('\n--- SECTION 4: Google Meet URL Security Validation ---');
    const maliciousUrls = [
      'javascript:alert("hacked")',
      'http://meet.google.com/abc-defg-hij', // insecure http
      'https://malicious-phishing.com/meet',
      'https://zoom.us/j/123456789',
      'ftp://meet.google.com/abc'
    ];

    for (const badUrl of maliciousUrls) {
      try {
        await axios.post(`${API_BASE}/meetings`, {
          title: 'Unsafe Link Meeting',
          date: new Date().toISOString(),
          startTime: new Date(Date.now() + 3600000).toISOString(),
          endTime: new Date(Date.now() + 7200000).toISOString(),
          googleMeetUrl: badUrl,
          attendeeIds: [empTeamA.id]
        }, { headers: tlHeaders });
        assert(false, `Insecure URL "${badUrl}" rejected`);
      } catch (e) {
        assert(e.response?.status === 400, `Insecure URL "${badUrl}" safely rejected with 400`);
      }
    }

    // --- Section 5: Cross-Organization Isolation & Tenant Protection ---
    console.log('\n--- SECTION 5: Cross-Organization Protection ---');
    try {
      await axios.post(`${API_BASE}/meetings`, {
        title: 'Cross-Tenant Attack Meeting',
        date: new Date().toISOString(),
        startTime: new Date(Date.now() + 3600000).toISOString(),
        endTime: new Date(Date.now() + 7200000).toISOString(),
        attendeeIds: [org2User.id] // User from Org 2!
      }, { headers: tlHeaders });
      assert(false, 'Cross-tenant attendee invitation rejected');
    } catch (e) {
      assert(e.response?.status === 400, 'Cross-tenant attendee invitation rejected with 400');
    }

    // --- Section 6: Team Leader Scope Validation (OWN_TEAM_ONLY vs CROSS_TEAM) ---
    console.log('\n--- SECTION 6: Team Leader Scope Restrictions ---');
    // Invalid scope string
    try {
      await axios.post(`${API_BASE}/meetings`, {
        title: 'Invalid Scope Test',
        date: new Date().toISOString(),
        startTime: new Date(Date.now() + 3600000).toISOString(),
        endTime: new Date(Date.now() + 7200000).toISOString(),
        scope: 'UNAUTHORIZED_SCOPE',
        attendeeIds: [empTeamA.id]
      }, { headers: tlHeaders });
      assert(false, 'Invalid scope value rejected with 400');
    } catch (e) {
      assert(e.response?.status === 400, 'Invalid scope value rejected with 400');
    }

    // OWN_TEAM_ONLY (default) attempting to invite colleague from Team Beta
    try {
      await axios.post(`${API_BASE}/meetings`, {
        title: 'OWN_TEAM Violation Test',
        date: new Date().toISOString(),
        startTime: new Date(Date.now() + 3600000).toISOString(),
        endTime: new Date(Date.now() + 7200000).toISOString(),
        scope: 'OWN_TEAM_ONLY',
        attendeeIds: [empTeamB.id] // Outside TL's Team Alpha!
      }, { headers: tlHeaders });
      assert(false, 'OWN_TEAM_ONLY violation rejected with 403');
    } catch (e) {
      assert(e.response?.status === 403 && e.response?.data?.message?.includes('OWN_TEAM_ONLY'),
        'OWN_TEAM_ONLY violation rejected with 403 Forbidden');
    }

    // OWN_TEAM_ONLY inviting member of Team Alpha (TL's team) -> SUCCESS
    const validTeamMeetingRes = await axios.post(`${API_BASE}/meetings`, {
      title: 'Weekly Alpha Sprint Sync',
      description: 'Reviewing current sprint blockers and milestones.',
      date: new Date().toISOString(),
      startTime: new Date(Date.now() + 3600000).toISOString(),
      endTime: new Date(Date.now() + 7200000).toISOString(),
      googleMeetUrl: 'https://meet.google.com/abc-defg-hij',
      scope: 'OWN_TEAM_ONLY',
      teamId: teamAlpha.id,
      attendeeIds: [empTeamA.id, empTeamA.id] // Includes duplicate to verify deduplication!
    }, { headers: tlHeaders });

    assert(validTeamMeetingRes.status === 201, 'OWN_TEAM_ONLY scheduling succeeds with team member');
    const meeting1 = validTeamMeetingRes.data.meeting;
    createdMeetingIds.push(meeting1.id);
    assert(meeting1.attendees.length === 1, 'Duplicate attendee IDs automatically deduplicated to 1 record');
    assert(meeting1.status === 'UPCOMING', 'Initial meeting status is UPCOMING');

    // CROSS_TEAM scope inviting colleague from Team Beta within same organization -> SUCCESS
    const crossTeamMeetingRes = await axios.post(`${API_BASE}/meetings`, {
      title: 'Inter-Team Architecture Discussion',
      description: 'Cross-functional alignment between Team Alpha and Beta.',
      date: new Date().toISOString(),
      startTime: new Date(Date.now() + 10800000).toISOString(),
      endTime: new Date(Date.now() + 14400000).toISOString(),
      googleMeetUrl: 'https://meet.google.com/xyz-uvwx-rst',
      scope: 'CROSS_TEAM',
      attendeeIds: [empTeamA.id, empTeamB.id]
    }, { headers: tlHeaders });

    assert(crossTeamMeetingRes.status === 201, 'CROSS_TEAM scope successfully invites colleagues from different teams in same org');
    const meeting2 = crossTeamMeetingRes.data.meeting;
    createdMeetingIds.push(meeting2.id);
    assert(meeting2.attendees.length === 2, 'CROSS_TEAM meeting stored with 2 distinct attendees');

    // --- Section 7: Meeting Visibility by Role ---
    console.log('\n--- SECTION 7: Meeting Visibility & Organization Isolation ---');
    // Admin list
    const adminListRes = await axios.get(`${API_BASE}/meetings`, { headers: adminHeaders });
    assert(adminListRes.status === 200, 'Admin can list organization meetings');
    const adminMeetingIds = adminListRes.data.meetings.map(m => m.id);
    assert(adminMeetingIds.includes(meeting1.id) && adminMeetingIds.includes(meeting2.id),
      'Admin sees all organization meetings');

    // empTeamA list (invited to meeting 1 and meeting 2)
    const empAListRes = await axios.get(`${API_BASE}/meetings`, { headers: empAHeaders });
    assert(empAListRes.status === 200, 'Employee A can list invited meetings');
    const empAMeetingIds = empAListRes.data.meetings.map(m => m.id);
    assert(empAMeetingIds.includes(meeting1.id) && empAMeetingIds.includes(meeting2.id),
      'Employee A sees both meetings they were invited to');

    // empTeamB list (invited to meeting 2 only)
    const empBListRes = await axios.get(`${API_BASE}/meetings`, { headers: empBHeaders });
    const empBMeetingIds = empBListRes.data.meetings.map(m => m.id);
    assert(empBMeetingIds.includes(meeting2.id) && !empBMeetingIds.includes(meeting1.id),
      'Employee B sees meeting 2, but CANNOT see meeting 1 (scoped to Team Alpha)');

    // Detail fetch & access guard
    const detailRes = await axios.get(`${API_BASE}/meetings/${meeting1.id}`, { headers: empAHeaders });
    assert(detailRes.status === 200 && detailRes.data.meeting.id === meeting1.id, 'Invited attendee can fetch meeting details');

    try {
      await axios.get(`${API_BASE}/meetings/${meeting1.id}`, { headers: empBHeaders });
      assert(false, 'Uninvited employee rejected on private meeting detail');
    } catch (e) {
      assert(e.response?.status === 403, 'Uninvited employee receives 403 Forbidden on private meeting detail');
    }

    // --- Section 8: Unauthorized Updates & Cancellations ---
    console.log('\n--- SECTION 8: Modification Authorization (Organizer / Admin only) ---');
    // Attendee empTeamA attempts to update meeting -> 403
    try {
      await axios.put(`${API_BASE}/meetings/${meeting1.id}`, {
        title: 'Tampered Title by Attendee'
      }, { headers: empAHeaders });
      assert(false, 'Attendee modifying meeting rejected with 403');
    } catch (e) {
      assert(e.response?.status === 403, 'Attendee modifying meeting rejected with 403');
    }

    // Attendee empTeamA attempts to cancel meeting -> 403
    try {
      await axios.put(`${API_BASE}/meetings/${meeting1.id}/cancel`, {
        reason: 'Malicious cancellation'
      }, { headers: empAHeaders });
      assert(false, 'Attendee cancelling meeting rejected with 403');
    } catch (e) {
      assert(e.response?.status === 403, 'Attendee cancelling meeting rejected with 403');
    }

    // --- Section 9: Reschedule, Notifications & Complete Lifecycle ---
    console.log('\n--- SECTION 9: Meeting Lifecycle, Rescheduling & Notifications ---');
    // Check initial notification for empTeamA
    const initialNotifs = await prisma.notification.findMany({
      where: { userId: empTeamA.id, type: 'MEETING_SCHEDULED' }
    });
    assert(initialNotifs.length >= 1, 'Attendee received MEETING_SCHEDULED notification on creation');

    // Check organizer (tlUser) was NOT notified as attendee
    const organizerNotifs = await prisma.notification.findMany({
      where: { userId: tlUser.id, type: 'MEETING_SCHEDULED' }
    });
    assert(organizerNotifs.length === 0, 'Organizer did not receive self-invitation notification');

    // Reschedule meeting 1
    const newStart = new Date(Date.now() + 86400000); // tomorrow
    const newEnd = new Date(Date.now() + 90000000);
    const rescheduleRes = await axios.put(`${API_BASE}/meetings/${meeting1.id}/reschedule`, {
      date: newStart.toISOString(),
      startTime: newStart.toISOString(),
      endTime: newEnd.toISOString()
    }, { headers: tlHeaders });

    assert(rescheduleRes.status === 200 && rescheduleRes.data.meeting.status === 'RESCHEDULED',
      'Organizer can reschedule meeting; status becomes RESCHEDULED');

    // Verify rescheduling notification
    const rescheduleNotifs = await prisma.notification.findMany({
      where: { userId: empTeamA.id, type: 'MEETING_RESCHEDULED' }
    });
    assert(rescheduleNotifs.length >= 1, 'Attendee received MEETING_RESCHEDULED notification');

    // Cancel meeting 2
    const cancelRes = await axios.put(`${API_BASE}/meetings/${meeting2.id}/cancel`, {
      reason: 'Agenda items postponed.'
    }, { headers: tlHeaders });

    assert(cancelRes.status === 200 && cancelRes.data.meeting.status === 'CANCELLED',
      'Organizer can cancel meeting; status becomes CANCELLED');

    // Verify cancellation notification
    const cancelNotifs = await prisma.notification.findMany({
      where: { userId: empTeamB.id, type: 'MEETING_CANCELLED' }
    });
    assert(cancelNotifs.length >= 1, 'Attendee received MEETING_CANCELLED notification');

    // Mark meeting 1 as completed
    const completeRes = await axios.put(`${API_BASE}/meetings/${meeting1.id}/complete`, {}, { headers: tlHeaders });
    assert(completeRes.status === 200 && completeRes.data.meeting.status === 'COMPLETED',
      'Organizer can mark meeting as COMPLETED');

    // --- Section 10: Meeting Reports & Follow-Up Tasks ---
    console.log('\n--- SECTION 10: Meeting Reports & Follow-Up Task Integration ---');
    // Fetch non-existent report returns 404
    try {
      await axios.get(`${API_BASE}/meetings/${meeting1.id}/report`, { headers: tlHeaders });
      assert(false, 'Non-existent report returns 404');
    } catch (e) {
      assert(e.response?.status === 404, 'Non-existent report returns 404');
    }

    // Attendee attempting to create report -> 403
    try {
      await axios.post(`${API_BASE}/meetings/${meeting1.id}/report`, {
        summary: 'Unauthorized report by attendee'
      }, { headers: empAHeaders });
      assert(false, 'Attendee creating report rejected with 403');
    } catch (e) {
      assert(e.response?.status === 403, 'Attendee creating report rejected with 403');
    }

    // Organizer creates report with follow-up tasks
    const reportRes = await axios.post(`${API_BASE}/meetings/${meeting1.id}/report`, {
      summary: 'Reviewed sprint backlog. Team Alpha agreed on database schema design.',
      followUpTasks: [
        {
          title: 'Implement Phase 3 Frontend Views',
          description: 'Build MeetingCalendar.jsx and MeetingDetailDrawer.jsx',
          priority: 'HIGH',
          assigneeId: empTeamA.id
        }
      ]
    }, { headers: tlHeaders });

    assert(reportRes.status === 200, 'Organizer successfully records meeting report');
    assert(reportRes.data.report.summary.includes('Reviewed sprint backlog'), 'Report summary stored correctly');
    assert(Array.isArray(reportRes.data.report.followUpTasks) && reportRes.data.report.followUpTasks.length === 1,
      'Compatible follow-up task payload stored');

    // Idempotent upsert: Updating report does NOT violate unique constraint
    const updateReportRes = await axios.put(`${API_BASE}/meetings/${meeting1.id}/report`, {
      summary: 'Updated summary: Database schema approved without amendments.'
    }, { headers: tlHeaders });

    assert(updateReportRes.status === 200, 'Idempotent report update succeeds without duplicate constraint violation');
    assert(updateReportRes.data.report.summary.includes('without amendments'), 'Updated report summary reflects changes');

    // Verify single report constraint in database
    const reportCount = await prisma.meetingReport.count({ where: { meetingId: meeting1.id } });
    assert(reportCount === 1, 'Database enforces exactly 1 report per meeting');

    // Attendee reads report
    const readReportRes = await axios.get(`${API_BASE}/meetings/${meeting1.id}/report`, { headers: empAHeaders });
    assert(readReportRes.status === 200 && readReportRes.data.report.meetingTitle === 'Weekly Alpha Sprint Sync',
      'Invited attendee can read meeting report with meeting metadata derived');

    // --- Section 11: Regression of Core CRM Modules ---
    console.log('\n--- SECTION 11: Core CRM Module Regression Checks ---');
    // 1. User login check
    const authCheckRes = await axios.get(`${API_BASE}/auth/profile`, { headers: adminHeaders });
    assert(authCheckRes.status === 200 && (authCheckRes.data?.email === adminUser.email || authCheckRes.data?.user?.email === adminUser.email), 'Auth profile endpoint working');

    // 2. Work Calendar
    const calendarRes = await axios.get(`${API_BASE}/work-calendar?month=10&year=2026`, { headers: adminHeaders });
    assert(calendarRes.status === 200, 'Work Calendar endpoint operational');

    // 3. Tasks
    const tasksRes = await axios.get(`${API_BASE}/tasks`, { headers: adminHeaders });
    assert(tasksRes.status === 200, 'Tasks active board endpoint operational');

    // 4. Notifications
    const notifsRes = await axios.get(`${API_BASE}/notifications`, { headers: adminHeaders });
    assert(notifsRes.status === 200, 'Notifications feed endpoint operational');

  } finally {
    // --- Cleanup Fixtures ---
    console.log('\n--- Cleaning up temporary test fixtures ---');
    try {
      if (createdMeetingIds.length > 0) {
        await prisma.meeting.deleteMany({ where: { id: { in: createdMeetingIds } } });
      }
      await prisma.teamMember.deleteMany({ where: { teamId: { in: [teamAlpha.id, teamBeta.id] } } });
      await prisma.team.deleteMany({ where: { id: { in: [teamAlpha.id, teamBeta.id] } } });
      await prisma.notification.deleteMany({ where: { userId: { in: [tlUser.id, empTeamA.id, empTeamB.id] } } });
      await prisma.user.deleteMany({ where: { id: { in: [tlUser.id, empTeamA.id, empTeamB.id, org2User.id] } } });
      console.log('Test fixtures cleaned up successfully.');
    } catch (cleanErr) {
      console.warn('Fixture cleanup note:', cleanErr.message);
    }
    await prisma.$disconnect();
  }

  console.log('\n================================================================');
  console.log(` SUMMARY: ${passedTests} passed, ${failedTests} failed (Total: ${totalTests})`);
  console.log('================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runSuite().catch(err => {
  console.error('[UNEXPECTED ERROR IN TEST SUITE]:', err);
  process.exit(1);
});
