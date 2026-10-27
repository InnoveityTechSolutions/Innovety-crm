/**
 * Phase 4 Verification Suite: Meetings Security Audit, Defect Fixes & Production Readiness
 */

const path = require('path');
module.paths.push(path.resolve(__dirname, '..', 'backend', 'node_modules'));
module.paths.push(path.resolve(__dirname, '..', 'frontend', 'node_modules'));
require('dotenv').config({ path: path.resolve(__dirname, '..', 'backend', '.env') });

const axios = require('axios');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const { io } = require('socket.io-client');
const fs = require('fs');

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'enterprise_internship_crm_super_secret_jwt_key_123!';
const API_BASE = 'http://localhost:5000/api';
const SOCKET_URL = 'http://localhost:5000';

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

const makeToken = (user, orgId) => {
  return jwt.sign(
    { id: user.id, role: user.role, organizationId: orgId || user.organizationId },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
};

async function runPhase4Tests() {
  console.log('================================================================');
  console.log(' PHASE 4 TEST SUITE: MEETINGS AUDIT, DEFECT FIXES & READINESS');
  console.log('================================================================\n');

  // --- Fixture Setup ---
  console.log('--- Setting up test fixtures ---');
  const orgA = await prisma.organization.findUnique({ where: { slug: 'innoveity' } });
  const orgB = await prisma.organization.findUnique({ where: { slug: 'autoclock-org' } });

  // Users in Org A
  const adminA = await prisma.user.findFirst({ where: { organizationId: orgA.id, role: 'ADMIN', status: 'ACTIVE' } });
  const empA = await prisma.user.findFirst({ where: { organizationId: orgA.id, role: 'EMPLOYEE', status: 'ACTIVE' } });

  // User in Org B (for cross-tenant checks)
  const empB = await prisma.user.findFirst({ where: { organizationId: orgB.id, role: 'EMPLOYEE', status: 'ACTIVE' } });

  if (!orgA || !orgB || !adminA || !empA || !empB) {
    throw new Error('Required test organization or user fixtures missing in database');
  }

  const adminToken = makeToken(adminA, orgA.id);
  const empAToken = makeToken(empA, orgA.id);
  const empBToken = makeToken(empB, orgB.id);

  // --- SECTION 1: Defect 1 - Cancelled Meeting Reschedule Guard ---
  console.log('\n--- SECTION 1: Defect 1 - Cancelled Meeting Reschedule Guard ---');
  const d = new Date();
  d.setDate(d.getDate() + 3);
  const dateStr = d.toISOString().split('T')[0];

  const m1Res = await axios.post(`${API_BASE}/meetings`, {
    title: 'Meeting To Cancel Then Test Reschedule',
    date: `${dateStr}T00:00:00.000Z`,
    startTime: `${dateStr}T10:00:00.000Z`,
    endTime: `${dateStr}T11:00:00.000Z`,
    attendeeIds: [empA.id],
    organizationId: orgA.id
  }, { headers: { Authorization: `Bearer ${adminToken}` } });
  const m1Id = m1Res.data.meeting.id;

  // Cancel m1
  await axios.put(`${API_BASE}/meetings/${m1Id}/cancel`, { reason: 'Cancellation test' }, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });

  // Attempt to reschedule cancelled m1
  try {
    await axios.put(`${API_BASE}/meetings/${m1Id}/reschedule`, {
      date: `${dateStr}T00:00:00.000Z`,
      startTime: `${dateStr}T12:00:00.000Z`,
      endTime: `${dateStr}T13:00:00.000Z`
    }, { headers: { Authorization: `Bearer ${adminToken}` } });
    assert(false, 'Rescheduling cancelled meeting should fail');
  } catch (err) {
    assert(err.response?.status === 400 && err.response?.data?.message.includes('Cannot reschedule a cancelled meeting'),
      'Defect 1 Fixed: Rescheduling a cancelled meeting rejected with 400');
  }

  // --- SECTION 2: Defect 2 - Cancelled Meeting Completion Guard ---
  console.log('\n--- SECTION 2: Defect 2 - Cancelled Meeting Completion Guard ---');
  try {
    await axios.put(`${API_BASE}/meetings/${m1Id}/complete`, {}, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(false, 'Completing cancelled meeting should fail');
  } catch (err) {
    assert(err.response?.status === 400 && err.response?.data?.message.includes('Cannot complete a cancelled meeting'),
      'Defect 2 Fixed: Completing a cancelled meeting rejected with 400');
  }

  // --- SECTION 3: Defect 3 - Cancelled Meeting Report Filing Guard ---
  console.log('\n--- SECTION 3: Defect 3 - Cancelled Meeting Report Filing Guard ---');
  try {
    await axios.post(`${API_BASE}/meetings/${m1Id}/report`, {
      summary: 'Report on cancelled meeting',
      followUpTasks: []
    }, { headers: { Authorization: `Bearer ${adminToken}` } });
    assert(false, 'Filing report on cancelled meeting should fail');
  } catch (err) {
    assert(err.response?.status === 400 && err.response?.data?.message.includes('Cannot submit a report for a cancelled meeting'),
      'Defect 3 Fixed: Filing report on cancelled meeting rejected with 400');
  }

  // --- SECTION 4: Defect 4 - Follow-Up Tasks Cross-Tenant Assignee Guard ---
  console.log('\n--- SECTION 4: Defect 4 - Follow-Up Tasks Cross-Tenant Assignee Guard ---');
  // Create an active meeting m2
  const m2Res = await axios.post(`${API_BASE}/meetings`, {
    title: 'Meeting For Report Validation',
    date: `${dateStr}T00:00:00.000Z`,
    startTime: `${dateStr}T14:00:00.000Z`,
    endTime: `${dateStr}T15:00:00.000Z`,
    attendeeIds: [empA.id],
    organizationId: orgA.id
  }, { headers: { Authorization: `Bearer ${adminToken}` } });
  const m2Id = m2Res.data.meeting.id;

  // Try to assign a follow-up task to empB (who belongs to orgB!)
  try {
    await axios.post(`${API_BASE}/meetings/${m2Id}/report`, {
      summary: 'Attempting cross-tenant task assignment',
      followUpTasks: [
        {
          title: 'Cross tenant task',
          assigneeId: empB.id
        }
      ]
    }, { headers: { Authorization: `Bearer ${adminToken}` } });
    assert(false, 'Cross-tenant task assignee should fail');
  } catch (err) {
    assert(err.response?.status === 400 && err.response?.data?.message.includes('belong to another organization'),
      'Defect 4 Fixed: Foreign organization task assignee in meeting report rejected with 400');
  }

  // Valid task assignee in same org succeeds
  const validReportRes = await axios.post(`${API_BASE}/meetings/${m2Id}/report`, {
    summary: 'Valid task assignment within org A',
    followUpTasks: [
      {
        title: 'Valid task for Employee A',
        assigneeId: empA.id,
        priority: 'HIGH',
        deadline: dateStr
      }
    ]
  }, { headers: { Authorization: `Bearer ${adminToken}` } });
  assert(validReportRes.status === 200 && validReportRes.data.report.summary.includes('Valid task assignment'),
    'Valid task assignee from same organization succeeds');

  // --- SECTION 5: Defect 5 - Real-Time Socket.IO Meeting Event Broadcasts ---
  console.log('\n--- SECTION 5: Defect 5 - Real-Time Socket.IO Meeting Event Broadcasts ---');
  let socketReceivedEvents = [];
  const testSocket = io(SOCKET_URL, {
    auth: { token: adminToken },
    transports: ['websocket', 'polling'],
    reconnection: false
  });

  await new Promise((resolve) => {
    testSocket.on('connect', () => {
      resolve();
    });
    setTimeout(resolve, 1500); // safety timeout
  });

  testSocket.on('meeting_created', (data) => socketReceivedEvents.push({ event: 'meeting_created', data }));
  testSocket.on('meeting_rescheduled', (data) => socketReceivedEvents.push({ event: 'meeting_rescheduled', data }));
  testSocket.on('meeting_cancelled', (data) => socketReceivedEvents.push({ event: 'meeting_cancelled', data }));
  testSocket.on('meeting_updated', (data) => socketReceivedEvents.push({ event: 'meeting_updated', data }));

  // Create m3 to trigger socket broadcast
  const m3Res = await axios.post(`${API_BASE}/meetings`, {
    title: 'Meeting For Socket Verification',
    date: `${dateStr}T00:00:00.000Z`,
    startTime: `${dateStr}T16:00:00.000Z`,
    endTime: `${dateStr}T17:00:00.000Z`,
    attendeeIds: [empA.id],
    organizationId: orgA.id
  }, { headers: { Authorization: `Bearer ${adminToken}` } });
  const m3Id = m3Res.data.meeting.id;

  // Reschedule m3
  await axios.put(`${API_BASE}/meetings/${m3Id}/reschedule`, {
    date: `${dateStr}T00:00:00.000Z`,
    startTime: `${dateStr}T17:00:00.000Z`,
    endTime: `${dateStr}T18:00:00.000Z`
  }, { headers: { Authorization: `Bearer ${adminToken}` } });

  // Cancel m3
  await axios.put(`${API_BASE}/meetings/${m3Id}/cancel`, { reason: 'Socket cancellation test' }, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });

  // Allow socket messages to arrive
  await new Promise(r => setTimeout(r, 600));

  const hasCreated = socketReceivedEvents.some(e => e.event === 'meeting_created' && e.data?.meeting?.id === m3Id);
  const hasRescheduled = socketReceivedEvents.some(e => e.event === 'meeting_rescheduled' && e.data?.meeting?.id === m3Id);
  const hasCancelled = socketReceivedEvents.some(e => e.event === 'meeting_cancelled' && e.data?.meeting?.id === m3Id);

  assert(hasCreated, 'Defect 5 Fixed: meeting_created Socket.IO event received by client');
  assert(hasRescheduled, 'Defect 5 Fixed: meeting_rescheduled Socket.IO event received by client');
  assert(hasCancelled, 'Defect 5 Fixed: meeting_cancelled Socket.IO event received by client');

  testSocket.disconnect();

  // --- SECTION 6: Cross-Tenant Isolation Security Audit ---
  console.log('\n--- SECTION 6: Cross-Tenant Isolation Security Audit ---');
  // Employee B in Org B trying to access Org A meeting details
  try {
    await axios.get(`${API_BASE}/meetings/${m2Id}?organizationId=${orgB.id}`, {
      headers: { Authorization: `Bearer ${empBToken}` }
    });
    assert(false, 'Cross-tenant meeting access should fail');
  } catch (err) {
    assert(err.response?.status === 404 || err.response?.status === 403,
      'Tenant isolation: Cross-tenant GET /api/meetings/:id rejected with 403/404');
  }

  // Employee B trying to access Org A meeting report
  try {
    await axios.get(`${API_BASE}/meetings/${m2Id}/report?organizationId=${orgB.id}`, {
      headers: { Authorization: `Bearer ${empBToken}` }
    });
    assert(false, 'Cross-tenant report access should fail');
  } catch (err) {
    assert(err.response?.status === 404 || err.response?.status === 403,
      'Tenant isolation: Cross-tenant GET /api/meetings/:id/report rejected with 403/404');
  }

  // --- SECTION 7: Frontend Lazy Loading & Chunk Verification ---
  console.log('\n--- SECTION 7: Frontend Lazy Loading & Chunk Verification ---');
  const distAssetsDir = path.resolve(__dirname, '../frontend/dist/assets');
  if (fs.existsSync(distAssetsDir)) {
    const files = fs.readdirSync(distAssetsDir);
    const meetingChunk = files.find(f => f.startsWith('Meetings-') && f.endsWith('.js'));
    assert(Boolean(meetingChunk), `Defect 7 Fixed: Meetings page split into dedicated chunk (${meetingChunk || 'not found'})`);
  } else {
    console.log('  [SKIP] dist/assets not found, skipping chunk inspection');
  }

  // --- SECTION 8: Core CRM Modules Regression Health Checks ---
  console.log('\n--- SECTION 8: Core CRM Modules Regression Health Checks ---');
  const profileRes = await axios.get(`${API_BASE}/auth/profile`, { headers: { Authorization: `Bearer ${adminToken}` } });
  assert(profileRes.status === 200 && (profileRes.data?.email === adminA.email || profileRes.data?.user?.email === adminA.email), 'Auth /auth/profile operational');

  const workCalRes = await axios.get(`${API_BASE}/work-calendar?month=${d.getMonth() + 1}&year=${d.getFullYear()}&organizationId=${orgA.id}`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(workCalRes.status === 200 && Array.isArray(workCalRes.data?.days), 'Work Calendar endpoint operational with days array');

  const notifRes = await axios.get(`${API_BASE}/notifications`, { headers: { Authorization: `Bearer ${adminToken}` } });
  assert(notifRes.status === 200 && Array.isArray(notifRes.data), 'Notifications feed operational');

  // --- Cleanup Fixtures ---
  console.log('\n--- Cleaning up temporary test fixtures ---');
  const testMeetingIds = [m1Id, m2Id, m3Id];
  await prisma.meetingAttendee.deleteMany({ where: { meetingId: { in: testMeetingIds } } });
  await prisma.meetingReport.deleteMany({ where: { meetingId: { in: testMeetingIds } } });
  await prisma.meeting.deleteMany({ where: { id: { in: testMeetingIds } } });
  await prisma.notification.deleteMany({
    where: {
      userId: { in: [adminA.id, empA.id, empB.id] },
      type: { in: ['MEETING_SCHEDULED', 'MEETING_RESCHEDULED', 'MEETING_CANCELLED'] }
    }
  });
  console.log('Test fixtures cleaned up successfully.');

  console.log('\n================================================================');
  console.log(` SUMMARY: ${passed} passed, ${failed} failed (Total: ${passed + failed})`);
  console.log('================================================================\n');

  if (failed > 0) process.exit(1);
}

runPhase4Tests().catch(err => {
  console.error('Phase 4 test execution error:', err);
  process.exit(1);
});
