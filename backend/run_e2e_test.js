const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const http = require('http');
const prisma = new PrismaClient();
const { getTestConfig } = require('./src/utils/testConfigHelper');

const testConfig = getTestConfig({ isDestructive: true });

function req(method, path, body, token) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: testConfig.hostname, port: testConfig.port, path, method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': 'Bearer ' + token } : {}),
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    };
    const r = http.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode, body: d }); }
      });
    });
    r.on('error', e => resolve({ status: 'ERR', error: e.message }));
    if (data) r.write(data);
    r.end();
  });
}

const RESULTS = [];
function log(icon, module, detail) {
  const line = `${icon} ${module}: ${detail}`;
  console.log(line);
  RESULTS.push({ icon, module, detail });
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║           COMPLETE E2E PLATFORM VERIFICATION                ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // ─── Step 1: Reset admin password to known value ─────────────────────
  const TEST_PASSWORD = 'AdminTest@123';
  const hashed = await bcrypt.hash(TEST_PASSWORD, 10);
  await prisma.user.update({
    where: { email: 'admin@enterprise-crm.com' },
    data: { password: hashed }
  });
  console.log(`[SETUP] Admin password reset to: ${TEST_PASSWORD}\n`);

  // ─── Step 2: Login ────────────────────────────────────────────────────
  const loginRes = await req('POST', '/api/auth/login', { email: 'admin@enterprise-crm.com', password: TEST_PASSWORD });
  if (loginRes.status !== 200 || !loginRes.body?.token) {
    log('❌', 'AUTH/Login', `FAILED: ${JSON.stringify(loginRes.body)}`);
    await prisma.$disconnect(); return;
  }
  const token = loginRes.body.token;
  const adminUser = loginRes.body.user;
  log('✅', 'AUTH/Login', `OK – role=${adminUser.role}, name=${adminUser.name}`);

  // ─── Step 3: Auth Profile ─────────────────────────────────────────────
  const profile = await req('GET', '/api/auth/profile', null, token);
  if (profile.status === 200) log('✅', 'AUTH/Profile', `OK – ${profile.body.name} (${profile.body.role})`);
  else log('❌', 'AUTH/Profile', `${profile.status} ${JSON.stringify(profile.body)}`);

  // ─── Step 4: User Registries ──────────────────────────────────────────
  for (const role of ['INTERN', 'EMPLOYEE', 'ADMIN', 'TEAM_LEADER']) {
    const r = await req('GET', `/api/users?role=${role}&page=1&limit=15`, null, token);
    if (r.status === 200) {
      log('✅', `REGISTRY/${role}`, `OK – ${r.body.data?.length ?? 0} records, total=${r.body.total ?? r.body.totalCount ?? '?'}`);
    } else {
      log('❌', `REGISTRY/${role}`, `${r.status} ${JSON.stringify(r.body).slice(0, 100)}`);
    }
  }

  // ─── Step 5: Create & Delete Intern ──────────────────────────────────
  const newInternEmail = `e2e_test_intern_${Date.now()}@test.com`;
  const createR = await req('POST', '/api/users', {
    name: 'E2E Test Intern',
    email: newInternEmail,
    phone: '9000000001',
    role: 'INTERN',
    department: 'Engineering',
    college: 'Test College',
    candidateType: 'INTERN',
    dob: '2000-01-01',
    password: 'Test@12345'
  }, token);
  if (createR.status === 201 || createR.status === 200) {
    const testId = createR.body.user?.id || createR.body.id;
    log('✅', 'REGISTRY/CreateIntern', `OK – id=${testId}`);
    if (testId) {
      const delR = await req('DELETE', `/api/users/${testId}`, null, token);
      log(delR.status === 200 ? '✅' : '⚠️', 'REGISTRY/DeleteIntern', `${delR.status} ${delR.body?.message || ''}`);
    }
  } else {
    log('❌', 'REGISTRY/CreateIntern', `${createR.status} ${JSON.stringify(createR.body).slice(0, 150)}`);
  }

  // ─── Step 6: Attendance Logs & Analytics ─────────────────────────────
  const attLogs = await req('GET', '/api/attendance/logs?page=1&limit=10', null, token);
  if (attLogs.status === 200) log('✅', 'ATTENDANCE/Logs', `OK – ${attLogs.body.data?.length ?? 0} records`);
  else log('❌', 'ATTENDANCE/Logs', `${attLogs.status} ${JSON.stringify(attLogs.body).slice(0, 100)}`);

  const attStatus = await req('GET', '/api/attendance/status', null, token);
  if (attStatus.status === 200) log('✅', 'ATTENDANCE/Status', `OK – isClockedIn=${attStatus.body.isClockedIn}`);
  else log('❌', 'ATTENDANCE/Status', `${attStatus.status} ${JSON.stringify(attStatus.body).slice(0, 100)}`);

  // ─── Step 7: Tasks ────────────────────────────────────────────────────
  const tasks = await req('GET', '/api/tasks?page=1&limit=10', null, token);
  if (tasks.status === 200) log('✅', 'TASKS/List', `OK – ${tasks.body.data?.length ?? tasks.body.tasks?.length ?? 0} tasks`);
  else log('❌', 'TASKS/List', `${tasks.status} ${JSON.stringify(tasks.body).slice(0, 100)}`);

  // ─── Step 8: Teams ────────────────────────────────────────────────────
  const teams = await req('GET', '/api/teams', null, token);
  if (teams.status === 200) log('✅', 'TEAMS/List', `OK – ${(teams.body.teams || teams.body.data || teams.body)?.length ?? 0} teams`);
  else log('❌', 'TEAMS/List', `${teams.status} ${JSON.stringify(teams.body).slice(0, 100)}`);

  // ─── Step 9: Tickets ──────────────────────────────────────────────────
  const tickets = await req('GET', '/api/tickets?page=1&limit=10', null, token);
  if (tickets.status === 200) log('✅', 'TICKETS/List', `OK – ${tickets.body.data?.length ?? tickets.body.tickets?.length ?? 0} tickets`);
  else log('❌', 'TICKETS/List', `${tickets.status} ${JSON.stringify(tickets.body).slice(0, 100)}`);

  const createTicket = await req('POST', '/api/tickets', {
    title: 'E2E Test Ticket',
    description: 'This is an automated test ticket',
    category: 'TECHNICAL'
  }, token);
  if (createTicket.status === 200 || createTicket.status === 201) log('✅', 'TICKETS/Create', `OK – id=${createTicket.body.id || createTicket.body.ticket?.id}`);
  else log('❌', 'TICKETS/Create', `${createTicket.status} ${JSON.stringify(createTicket.body).slice(0, 100)}`);

  // ─── Step 10: Assets ──────────────────────────────────────────────────
  const assets = await req('GET', '/api/assets?page=1&limit=10', null, token);
  if (assets.status === 200) log('✅', 'ASSETS/List', `OK – ${assets.body.data?.length ?? assets.body.assets?.length ?? 0} assets`);
  else log('❌', 'ASSETS/List', `${assets.status} ${JSON.stringify(assets.body).slice(0, 100)}`);

  // ─── Step 11: Notifications ───────────────────────────────────────────
  const notifs = await req('GET', '/api/notifications', null, token);
  if (notifs.status === 200) log('✅', 'NOTIFICATIONS/List', `OK – ${(notifs.body.notifications || notifs.body.data || notifs.body)?.length ?? 0} notifications`);
  else log('❌', 'NOTIFICATIONS/List', `${notifs.status} ${JSON.stringify(notifs.body).slice(0, 100)}`);

  // ─── Step 12: Announcements ───────────────────────────────────────────
  const anns = await req('GET', '/api/announcements', null, token);
  if (anns.status === 200) log('✅', 'ANNOUNCEMENTS/List', `OK – ${(anns.body.data || anns.body)?.length ?? 0}`);
  else log('❌', 'ANNOUNCEMENTS/List', `${anns.status} ${JSON.stringify(anns.body).slice(0, 100)}`);

  // ─── Step 13: Reports ─────────────────────────────────────────────────
  const repAtt = await req('GET', '/api/reports/attendance', null, token);
  if (repAtt.status === 200) log('✅', 'REPORTS/Attendance', `OK`);
  else log('❌', 'REPORTS/Attendance', `${repAtt.status} ${JSON.stringify(repAtt.body).slice(0, 100)}`);

  const repTasks = await req('GET', '/api/reports/tasks', null, token);
  if (repTasks.status === 200) log('✅', 'REPORTS/Tasks', `OK`);
  else log('❌', 'REPORTS/Tasks', `${repTasks.status} ${JSON.stringify(repTasks.body).slice(0, 100)}`);

  // ─── Step 14: Chat Rooms ──────────────────────────────────────────────
  const rooms = await req('GET', '/api/chat/rooms', null, token);
  if (rooms.status === 200) log('✅', 'CHAT/Rooms', `OK – ${(rooms.body.rooms || rooms.body.data || rooms.body)?.length ?? 0} rooms`);
  else log('❌', 'CHAT/Rooms', `${rooms.status} ${JSON.stringify(rooms.body).slice(0, 100)}`);

  // ─── Step 15: Audit Logs ─────────────────────────────────────────────
  const logs = await req('GET', '/api/logs?page=1&limit=10', null, token);
  if (logs.status === 200) log('✅', 'LOGS/Audit', `OK – ${logs.body.data?.length ?? 0} logs`);
  else log('❌', 'LOGS/Audit', `${logs.status} ${JSON.stringify(logs.body).slice(0, 100)}`);

  // ─── Step 16: Settings ────────────────────────────────────────────────
  const settings = await req('GET', '/api/settings', null, token);
  if (settings.status === 200) log('✅', 'SETTINGS/Get', `OK`);
  else log('❌', 'SETTINGS/Get', `${settings.status} ${JSON.stringify(settings.body).slice(0, 100)}`);

  // ─── Step 17: Change Password (PUT) ──────────────────────────────────
  const changePass = await req('PUT', '/api/auth/change-password', {
    currentPassword: TEST_PASSWORD,
    newPassword: TEST_PASSWORD
  }, token);
  if (changePass.status === 200) log('✅', 'AUTH/ChangePassword', `OK`);
  else log('❌', 'AUTH/ChangePassword', `${changePass.status} ${JSON.stringify(changePass.body).slice(0, 100)}`);

  // ─── Step 18: DB Consistency Check ───────────────────────────────────
  console.log('\n=== DATABASE CONSISTENCY CHECK ===\n');
  const orphanCheck = await prisma.$queryRaw`
    SELECT COUNT(*) as count FROM "TeamMember" tm
    WHERE NOT EXISTS (SELECT 1 FROM "User" u WHERE u.id = tm."userId")
  `;
  log('✅', 'DB/OrphanTeamMembers', `${orphanCheck[0]?.count ?? 0} orphans`);

  const dupEmails = await prisma.$queryRaw`
    SELECT email, COUNT(*) as count FROM "User" GROUP BY email HAVING COUNT(*) > 1
  `;
  if (dupEmails.length === 0) log('✅', 'DB/DuplicateEmails', 'None found');
  else log('❌', 'DB/DuplicateEmails', `Found: ${JSON.stringify(dupEmails)}`);

  // ─── Summary ─────────────────────────────────────────────────────────
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║                    FINAL REPORT                             ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const passed = RESULTS.filter(r => r.icon === '✅').length;
  const failed = RESULTS.filter(r => r.icon === '❌').length;
  const warnings = RESULTS.filter(r => r.icon === '⚠️').length;

  console.log(`PASSED:   ${passed}`);
  console.log(`FAILED:   ${failed}`);
  console.log(`WARNINGS: ${warnings}\n`);

  if (failed > 0) {
    console.log('FAILED ITEMS:');
    RESULTS.filter(r => r.icon === '❌').forEach(r => console.log(`  ❌ ${r.module}: ${r.detail}`));
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
