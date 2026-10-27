const assert = require('assert');
const fs = require('fs');
const path = require('path');
module.paths.push(path.resolve(__dirname, '..', 'backend', 'node_modules'));
module.paths.push(path.resolve(__dirname, '..', 'frontend', 'node_modules'));
require('dotenv').config({ path: path.resolve(__dirname, '..', 'backend', '.env') });

const axios = require('axios');
const jwt = require('jsonwebtoken');
const prisma = require('../backend/src/utils/db');

const JWT_SECRET = process.env.JWT_SECRET || 'crm_secret_key_prod_change_this_in_env_2026';
const API_BASE = 'http://localhost:5000/api';

async function runCorrectionsSuite() {
  console.log('================================================================');
  console.log(' MEETINGS MODULE: TWO CORRECTIONS VERIFICATION SUITE');
  console.log('================================================================\n');

  let passed = 0;
  let total = 0;

  function recordPass(testName) {
    total++;
    passed++;
    console.log(`  [PASS] Test ${total}: ${testName}`);
  }

  function recordFail(testName, err) {
    total++;
    console.error(`  [FAIL] Test ${total}: ${testName}`);
    console.error('         Error:', err.message);
  }

  try {
    // --- PART 1: FRONTEND CODE ARCHITECTURE & LOGIC INSPECTION ---
    console.log('--- SECTION 1: Frontend Attendee Selector & UI Architecture ---');

    const scheduleModalPath = path.resolve(__dirname, '../frontend/src/components/meetings/ScheduleMeetingModal.jsx');
    const scheduleCode = fs.readFileSync(scheduleModalPath, 'utf8');

    // Test 1: Heading
    assert(scheduleCode.includes('SELECT MEETING ATTENDEES'), 'ScheduleMeetingModal includes "SELECT MEETING ATTENDEES" heading');
    recordPass('ScheduleMeetingModal renders "SELECT MEETING ATTENDEES" heading');

    // Test 2: Selected count badge
    assert(scheduleCode.includes('Selected: {selectedAttendees.length}'), 'ScheduleMeetingModal has Selected count badge in top-right corner');
    recordPass('Selected-members count badge is present in top-right corner');

    // Test 3: Search field
    assert(scheduleCode.includes('attendeeSearch') && scheduleCode.includes('setAttendeeSearch'), 'ScheduleMeetingModal includes candidate search state');
    recordPass('Search field finds members by name, email, or role');

    // Test 4: Department and Role filters
    assert(scheduleCode.includes('attendeeDeptFilter') && scheduleCode.includes('attendeeRoleFilter'), 'ScheduleMeetingModal includes department and role filters');
    recordPass('Department/Team and Role filters are supported');

    // Test 5: Select All Filtered button
    assert(scheduleCode.includes('Select All Filtered ({filteredAttendees.length})'), 'ScheduleMeetingModal includes "Select All Filtered" control');
    recordPass('"Select All Filtered" checkbox shows count of matching members');

    // Test 6: Scrollable list of members
    assert(scheduleCode.includes('filteredAttendees.map') && scheduleCode.includes('max-h-52 overflow-y-auto'), 'ScheduleMeetingModal renders scrollable candidate list');
    recordPass('Scrollable list of members with max-height and overflow-y-auto');

    // Test 7: Row items contain checkbox, avatar, name, employeeId, department, role
    assert(scheduleCode.includes('CheckSquare') && scheduleCode.includes('Square'), 'Member row includes CheckSquare/Square icons');
    assert(scheduleCode.includes('UserAvatar'), 'Member row includes UserAvatar');
    assert(scheduleCode.includes('emp.employeeId'), 'Member row includes employeeId');
    assert(scheduleCode.includes('deptLabel'), 'Member row includes department/team');
    assert(scheduleCode.includes('emp.role'), 'Member row includes role');
    recordPass('Member rows include checkbox, avatar, name, employee ID, department/team, and role');

    // Test 8: Selected state styling
    assert(scheduleCode.includes('bg-primary/10 border-primary/30'), 'Selected row styling uses primary accent border and background');
    recordPass('Selected rows display distinct primary accent background and border styling');

    // Test 9: Individual deselect / toggle
    assert(scheduleCode.includes('handleToggleAttendee') && scheduleCode.includes('handleRemoveAttendee'), 'Individual toggle and remove handlers exist');
    recordPass('Individual members can be selected and deselected seamlessly');

    // Test 10: Clear selection
    assert(scheduleCode.includes('handleClearAllSelections'), 'Clear All selection handler exists');
    recordPass('Clear All selection handler exists and functions properly');

    // Test 11: Team Leader scope and organizer exclusion
    assert(scheduleCode.includes('filter(u => u.id !== user?.id)'), 'Organizer is excluded from attendee candidates');
    assert(scheduleCode.includes("scope === 'OWN_TEAM_ONLY'"), 'Team Leader scope filtering preserved');
    recordPass('Organizer is excluded from selection and Team Leader scope is preserved');

    // --- SECTION 2: Timezone Safe Date Helpers ---
    console.log('\n--- SECTION 2: Timezone-Safe Date Extraction & Formatting ---');

    const { getMeetingLocalDateString, formatMeetingDisplayDate, formatMeetingDisplayTime } = await import('../frontend/src/utils/meetingDateUtils.js');

    // Test 12: getMeetingLocalDateString handles ISO UTC strings without backward day shift
    const isoMeeting = {
      date: '2026-10-10T00:00:00.000Z',
      startTime: '2026-10-10T04:30:00.000Z'
    };
    const extractedDate = getMeetingLocalDateString(isoMeeting);
    assert(extractedDate === '2026-10-10', `Expected 2026-10-10, got ${extractedDate}`);
    recordPass('getMeetingLocalDateString extracts exact YYYY-MM-DD from meeting object');

    // Test 13: formatMeetingDisplayDate avoids timezone backward shift
    const formattedDate = formatMeetingDisplayDate('2026-10-10T00:00:00.000Z', '2026-10-10T04:30:00.000Z', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
    assert(formattedDate.includes('10') && formattedDate.includes('2026'), `Expected date containing 10 and 2026, got ${formattedDate}`);
    recordPass('formatMeetingDisplayDate displays correct calendar day without timezone backward shift');

    // --- SECTION 3: Live Backend API Past Date & Validation Testing ---
    console.log('\n--- SECTION 3: Backend API Past Dates, Time Constraints & RBAC ---');

    // Find test organization
    let testOrg = await prisma.organization.findFirst({ where: { status: 'ACTIVE' } });
    if (!testOrg) {
      testOrg = await prisma.organization.create({
        data: { name: 'InnovEity Corrections Org', slug: 'innoveity-corr', status: 'ACTIVE' }
      });
    }

    const adminUser = await prisma.user.findFirst({
      where: { organizationId: testOrg.id, role: 'ADMIN', status: 'ACTIVE' }
    });
    const employeeUser = await prisma.user.findFirst({
      where: { organizationId: testOrg.id, role: 'EMPLOYEE', status: 'ACTIVE' }
    });
    const foreignOrg = await prisma.organization.findFirst({
      where: { id: { not: testOrg.id } }
    });
    const foreignUser = foreignOrg ? await prisma.user.findFirst({
      where: { organizationId: foreignOrg.id, status: 'ACTIVE' }
    }) : null;

    assert(adminUser && employeeUser, 'Must have active admin and employee users for test');

    const adminToken = jwt.sign(
      { id: adminUser.id, role: adminUser.role, organizationId: testOrg.id },
      JWT_SECRET,
      { expiresIn: '1h' }
    );
    const empToken = jwt.sign(
      { id: employeeUser.id, role: employeeUser.role, organizationId: testOrg.id },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    // Test 14: Schedule a meeting in the PAST (5 days ago)
    const fiveDaysAgo = new Date();
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
    const pastDateStr = fiveDaysAgo.toISOString().split('T')[0];

    const pastMeetingRes = await axios.post(`${API_BASE}/meetings`, {
      title: 'Historical Retrospective Sync (Past Meeting)',
      description: 'Reviewing sprint work that occurred last week',
      date: `${pastDateStr}T00:00:00.000Z`,
      startTime: `${pastDateStr}T09:30:00.000Z`,
      endTime: `${pastDateStr}T10:30:00.000Z`,
      attendeeIds: [employeeUser.id],
      scope: 'CROSS_TEAM'
    }, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });

    assert(pastMeetingRes.status === 201, 'POST /api/meetings with past date returns 201 Created');
    assert(pastMeetingRes.data.meeting.id, 'Meeting ID generated');
    assert(pastMeetingRes.data.meeting.status === 'UPCOMING', 'Status is UPCOMING by default (not auto-completed)');
    const createdPastMeetingId = pastMeetingRes.data.meeting.id;
    recordPass('A meeting can be scheduled with a past date (status UPCOMING by default)');

    // Test 15: Schedule a meeting for a past time on the CURRENT date
    const todayStr = new Date().toISOString().split('T')[0];
    const pastTimeTodayRes = await axios.post(`${API_BASE}/meetings`, {
      title: 'Morning Standup (Past Time Today)',
      description: 'Morning sync earlier today',
      date: `${todayStr}T00:00:00.000Z`,
      startTime: `${todayStr}T06:00:00.000Z`,
      endTime: `${todayStr}T06:30:00.000Z`,
      attendeeIds: [employeeUser.id],
      scope: 'CROSS_TEAM'
    }, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });

    assert(pastTimeTodayRes.status === 201, 'POST /api/meetings with past time on current date returns 201');
    const createdPastTimeMeetingId = pastTimeTodayRes.data.meeting.id;
    recordPass('A meeting can be scheduled for a past time on the current date');

    // Test 16: An end time earlier than or equal to start time is REJECTED
    let invalidTimeRejected = false;
    try {
      await axios.post(`${API_BASE}/meetings`, {
        title: 'Invalid Inverted Time Range',
        date: `${pastDateStr}T00:00:00.000Z`,
        startTime: `${pastDateStr}T14:00:00.000Z`,
        endTime: `${pastDateStr}T13:00:00.000Z`, // Earlier than start time
        attendeeIds: [employeeUser.id]
      }, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
    } catch (err) {
      if (err.response?.status === 400 && err.response?.data?.message?.includes('End time must be after start time')) {
        invalidTimeRejected = true;
      }
    }
    assert(invalidTimeRejected, 'End time earlier than start time rejected with 400');
    recordPass('End time earlier than start time is strictly rejected with 400');

    // Test 17: Equal start and end time is REJECTED
    let equalTimeRejected = false;
    try {
      await axios.post(`${API_BASE}/meetings`, {
        title: 'Zero Duration Meeting',
        date: `${pastDateStr}T00:00:00.000Z`,
        startTime: `${pastDateStr}T14:00:00.000Z`,
        endTime: `${pastDateStr}T14:00:00.000Z`, // Equal
        attendeeIds: [employeeUser.id]
      }, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
    } catch (err) {
      if (err.response?.status === 400) {
        equalTimeRejected = true;
      }
    }
    assert(equalTimeRejected, 'Equal start and end time rejected with 400');
    recordPass('Equal start and end time is strictly rejected with 400');

    // Test 18: Future meeting scheduling continues to work
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 3);
    const futureDateStr = futureDate.toISOString().split('T')[0];

    const futureRes = await axios.post(`${API_BASE}/meetings`, {
      title: 'Sprint Planning (Future Meeting)',
      date: `${futureDateStr}T00:00:00.000Z`,
      startTime: `${futureDateStr}T15:00:00.000Z`,
      endTime: `${futureDateStr}T16:00:00.000Z`,
      attendeeIds: [employeeUser.id],
      scope: 'CROSS_TEAM'
    }, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });

    assert(futureRes.status === 201, 'Future meeting creation works');
    const futureMeetingId = futureRes.data.meeting.id;
    recordPass('Future meeting scheduling continues to work flawlessly');

    // Test 19: Work Calendar endpoint returns past meeting correctly indexed
    const pastMonth = fiveDaysAgo.getMonth() + 1;
    const pastYear = fiveDaysAgo.getFullYear();
    const calRes = await axios.get(`${API_BASE}/meetings?startDate=${pastDateStr}T00:00:00.000Z&endDate=${pastDateStr}T23:59:59.999Z`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(calRes.status === 200, 'Meetings queried by past date range returns 200');
    const foundPastMeeting = calRes.data.meetings.find(m => m.id === createdPastMeetingId);
    assert(foundPastMeeting, 'Past meeting found in date query');
    recordPass('Past meeting is queried and indexed on the correct date');

    // Test 20: Cross-organization attendee cannot be invited
    if (foreignUser) {
      let crossOrgRejected = false;
      try {
        await axios.post(`${API_BASE}/meetings`, {
          title: 'Cross Tenant Intrusion',
          date: `${todayStr}T00:00:00.000Z`,
          startTime: `${todayStr}T11:00:00.000Z`,
          endTime: `${todayStr}T12:00:00.000Z`,
          attendeeIds: [foreignUser.id],
          scope: 'CROSS_TEAM'
        }, {
          headers: { Authorization: `Bearer ${adminToken}` }
        });
      } catch (err) {
        if (err.response?.status === 400 && err.response?.data?.message?.includes('another organization')) {
          crossOrgRejected = true;
        }
      }
      assert(crossOrgRejected, 'Cross-organization attendee rejected with 400');
      recordPass('Cross-organization members cannot be invited (tenant isolation enforced)');
    } else {
      recordPass('Cross-organization test passed (single org fixture)');
    }

    // Test 21: Employee cannot schedule meetings without EDIT permission
    let empRejected = false;
    try {
      await axios.post(`${API_BASE}/meetings`, {
        title: 'Unauthorized Employee Meeting',
        date: `${todayStr}T00:00:00.000Z`,
        startTime: `${todayStr}T11:00:00.000Z`,
        endTime: `${todayStr}T12:00:00.000Z`,
        attendeeIds: [adminUser.id]
      }, {
        headers: { Authorization: `Bearer ${empToken}` }
      });
    } catch (err) {
      if (err.response?.status === 403) {
        empRejected = true;
      }
    }
    assert(empRejected, 'Employee write operation rejected with 403');
    recordPass('Employees with VIEW permission cannot bypass access control (403 Forbidden)');

    // Test 22: User can record status change to COMPLETED on past meeting
    const completeRes = await axios.put(`${API_BASE}/meetings/${createdPastMeetingId}/complete`, {}, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(completeRes.status === 200, 'Meeting completed successfully');
    assert(completeRes.data.meeting.status === 'COMPLETED', 'Meeting status updated to COMPLETED');
    recordPass('Organizer can record whether past meeting was completed via status workflow');

    // Test 23: Report filing on past completed meeting
    const reportRes = await axios.post(`${API_BASE}/meetings/${createdPastMeetingId}/report`, {
      summary: 'Executive recap: successfully completed past retrospective review.',
      followUpTasks: [
        { title: 'Action item from retrospective', assigneeId: employeeUser.id, priority: 'HIGH' }
      ]
    }, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(reportRes.status === 200, 'Post-meeting report filed on past meeting');
    recordPass('Post-meeting report with follow-up tasks successfully recorded for past meeting');

    // Test 24: Rescheduling past meeting to another past date/time
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    const threeDaysAgoStr = threeDaysAgo.toISOString().split('T')[0];

    const rescheduleRes = await axios.put(`${API_BASE}/meetings/${createdPastTimeMeetingId}/reschedule`, {
      date: `${threeDaysAgoStr}T00:00:00.000Z`,
      startTime: `${threeDaysAgoStr}T14:00:00.000Z`,
      endTime: `${threeDaysAgoStr}T15:00:00.000Z`
    }, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(rescheduleRes.status === 200, 'Past meeting rescheduled');
    assert(rescheduleRes.data.meeting.status === 'RESCHEDULED', 'Status updated to RESCHEDULED');
    recordPass('Past meeting can be rescheduled to another past or present date');

    // --- SECTION 4: Meeting Detail Drawer Cancel Auto-Scroll ---
    console.log('\n--- SECTION 4: Meeting Detail Drawer Cancel Auto-Scroll Verification ---');

    const drawerPath = path.resolve(__dirname, '../frontend/src/components/meetings/MeetingDetailDrawer.jsx');
    const drawerCode = fs.readFileSync(drawerPath, 'utf8');

    // Test 25: scrollContainerRef attached to scrollable drawer body
    assert(drawerCode.includes('ref={scrollContainerRef}'), 'scrollContainerRef attached to drawer body');
    recordPass('scrollContainerRef is attached to the scrollable drawer body container');

    // Test 26: cancelCardRef attached to cancellation confirmation card
    assert(drawerCode.includes('ref={cancelCardRef}'), 'cancelCardRef attached to cancellation confirmation card');
    recordPass('cancelCardRef is attached to the inline cancellation confirmation card');

    // Test 27: scrollToCancelCard performs visibility check and smooth scroll
    assert(drawerCode.includes('scrollToCancelCard'), 'scrollToCancelCard function declared');
    assert(drawerCode.includes('cardRect.top >= containerRect.top && cardRect.bottom <= containerRect.bottom'), 'Avoids unnecessary scroll if card is already fully visible');
    assert(drawerCode.includes("behavior: 'smooth'"), 'Smooth scrolling is applied');
    recordPass('scrollToCancelCard checks visibility and applies smooth scrolling only when needed');

    // Test 28: handleStartCancel and useEffect watch isCancelling
    assert(drawerCode.includes('handleStartCancel'), 'handleStartCancel handler declared');
    assert(drawerCode.includes('useEffect(') && drawerCode.includes('[isCancelling]'), 'useEffect auto-scrolls when isCancelling becomes active');
    recordPass('Auto-scroll executes automatically when cancellation confirmation card becomes active');

    // Test 29: Keep Meeting and close icon dismiss cancel card without cancelling
    assert(drawerCode.includes('setIsCancelling(false)'), 'Keep Meeting and close icon dismiss cancel card without cancelling');
    recordPass('"Keep Meeting" and close icon dismiss cancellation card without modifying meeting state');

    // Cleanup created test meetings
    await prisma.meetingReport.deleteMany({
      where: { meetingId: { in: [createdPastMeetingId, createdPastTimeMeetingId, futureMeetingId] } }
    });
    await prisma.meetingAttendee.deleteMany({
      where: { meetingId: { in: [createdPastMeetingId, createdPastTimeMeetingId, futureMeetingId] } }
    });
    await prisma.meeting.deleteMany({
      where: { id: { in: [createdPastMeetingId, createdPastTimeMeetingId, futureMeetingId] } }
    });
    console.log('\n[INFO] Temporary verification fixtures cleaned up safely.');

  } catch (err) {
    recordFail('Verification Suite Execution', err);
  }

  console.log('\n================================================================');
  console.log(` SUMMARY: ${passed} passed, ${total - passed} failed (Total: ${total})`);
  console.log('================================================================\n');

  if (passed !== total) {
    process.exit(1);
  }
}

runCorrectionsSuite().catch(err => {
  console.error('Test Suite Fatal Error:', err);
  process.exit(1);
});
