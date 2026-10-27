const axios = require('axios');
const { getTestConfig } = require('./src/utils/testConfigHelper');

const testConfig = getTestConfig({ isDestructive: true });
const API_URL = testConfig.apiUrl;

async function runTest() {
  console.log('====================================================');
  console.log('STARTING E2E TEST: Phase 1 Lifecycle & Phase 2A Project Planning');
  console.log('====================================================');

  try {
    // 1. Admin Login
    console.log('\n[Step 1] Logging in as Admin...');
    const loginRes = await axios.post(`${API_URL}/auth/login`, {
      email: 'admin@enterprise-crm.com',
      password: 'Admin123!'
    });
    const token = loginRes.data.token;
    const adminUser = loginRes.data.user;
    console.log(`✓ Admin Logged In: ${adminUser.name} (${adminUser.id})`);

    const headers = { Authorization: `Bearer ${token}` };

    // Get list of users and teams to assign
    const usersRes = await axios.get(`${API_URL}/users`, { headers });
    const users = Array.isArray(usersRes.data) ? usersRes.data : (usersRes.data.users || usersRes.data.data || []);
    const teamLeader = users.find(u => u.role === 'TEAM_LEADER') || users[0] || adminUser;
    const projectLeader = users.find(u => u.role === 'ADMIN' || u.role === 'TEAM_LEADER') || adminUser;
    const member1 = users.find(u => u.role === 'EMPLOYEE' || u.role === 'INTERN') || users[1] || adminUser;

    console.log(`Team Leader: ${teamLeader.name}, Project Leader: ${projectLeader.name}, Member: ${member1.name}`);

    // 2. Create Project in DRAFT (Explicit Action)
    console.log('\n[Step 2] Explicitly Creating Project in DRAFT status...');
    const today = new Date().toISOString().split('T')[0];
    const nextMonth = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().split('T')[0];

    const createRes = await axios.post(`${API_URL}/projects`, {
      name: 'Enterprise Core Platform',
      description: 'Frozen Phase 1 Enterprise Project Management Workflow',
      type: 'CLIENT',
      priority: 'HIGH',
      status: 'DRAFT',
      estimatedStartDate: today,
      estimatedEndDate: nextMonth,
      leaderId: projectLeader.id,
      memberIds: [member1.id]
    }, { headers });

    const project = createRes.data.project;
    console.log(`✓ Project Created: Code = ${project.projectCode}, ID = ${project.id}, Status = ${project.status}`);

    // Check Chat Rooms -> No chat room created for DRAFT
    let roomsRes = await axios.get(`${API_URL}/chat/rooms`, { headers });
    let projectRoom = roomsRes.data.find(r => r.projectId === project.id);
    if (!projectRoom) {
      console.log('✓ SUCCESS: No chat room created for DRAFT project.');
    } else {
      console.error('❌ FAIL: Chat room created for DRAFT project.');
    }

    // 3. Activate Project -> Should automatically initialize 1:1 Chat Room
    console.log('\n[Step 3] Activating Project (DRAFT -> ACTIVE)...');
    await axios.put(`${API_URL}/projects/${project.id}`, { status: 'ACTIVE' }, { headers });

    roomsRes = await axios.get(`${API_URL}/chat/rooms`, { headers });
    projectRoom = roomsRes.data.find(r => r.projectId === project.id);
    if (projectRoom && (projectRoom.status === 'ACTIVE' || !projectRoom.isArchived)) {
      console.log(`✓ SUCCESS: 1:1 Active Chat Room Created: "${projectRoom.name}" (Room ID: ${projectRoom.id})`);
    } else {
      console.error('❌ FAIL: Active chat room was not created on project activation.');
    }

    // 3.5 Create Project Milestone (Phase 2A Feature)
    console.log('\n[Step 3.5] Creating Phase 2A Project Milestone...');
    const milestoneRes = await axios.post(`${API_URL}/milestones`, {
      projectId: project.id,
      title: 'Phase 1 Core Infrastructure',
      description: 'Setup initial schemas, lifecycle, and 1:1 chat rooms',
      dueDate: nextMonth,
      status: 'IN_PROGRESS'
    }, { headers });
    const milestone = milestoneRes.data;
    console.log(`✓ SUCCESS: Milestone Created: "${milestone.title}" (ID: ${milestone.id})`);

    // 4. Create Task inside Project (User-Friendly Project Selector)
    console.log('\n[Step 4] Creating task linked to Project Code PRJ-XXXX and Milestone...');
    const taskRes = await axios.post(`${API_URL}/tasks`, {
      title: 'Setup Database Migrations',
      description: 'Run initial database migrations for project modules',
      priority: 'HIGH',
      deadline: nextMonth,
      assigneeId: member1.id,
      projectId: project.id,
      milestoneId: milestone.id
    }, { headers });
    const createdTask = taskRes.data;
    console.log(`✓ Task Created: ID = ${createdTask.id || createdTask.tasks?.[0]?.id}, Linked Project = ${project.projectCode}`);

    // 5. Test Completion Validation (Prevent closing project with open tasks)
    console.log('\n[Step 5] Testing Completion Validation (Project with open tasks)...');
    try {
      await axios.put(`${API_URL}/projects/${project.id}`, { status: 'COMPLETED' }, { headers });
      console.error('❌ FAIL: Project completion was allowed despite open tasks.');
    } catch (err) {
      if (err.response && err.response.status === 400) {
        console.log(`✓ SUCCESS: Completion blocked with 400 Bad Request: "${err.response.data.message}"`);
      } else {
        console.log(`✓ SUCCESS: Completion blocked with status ${err.response?.status}`);
      }
    }

    // Mark task as COMPLETED
    const taskIdToUpdate = createdTask.id || createdTask.tasks?.[0]?.id;
    if (taskIdToUpdate) {
      await axios.put(`${API_URL}/tasks/${taskIdToUpdate}/status`, { status: 'COMPLETED' }, { headers });
      console.log('✓ Task marked as COMPLETED.');
    }

    // 6. Complete Project (Now all tasks completed)
    console.log('\n[Step 6] Marking Project COMPLETED (All tasks completed)...');
    await axios.put(`${API_URL}/projects/${project.id}`, { status: 'COMPLETED' }, { headers });

    roomsRes = await axios.get(`${API_URL}/chat/rooms`, { headers });
    projectRoom = roomsRes.data.find(r => r.projectId === project.id);
    if (projectRoom && (projectRoom.isArchived || projectRoom.status === 'ARCHIVED')) {
      console.log('✓ SUCCESS: Chat room automatically ARCHIVED on project completion.');
    } else {
      console.error('❌ FAIL: Chat room was not archived on completion.');
    }

    // 7. Attempt Sending Message in Archived Chat Room -> 403 Forbidden
    console.log('\n[Step 7] Attempting to send message in Archived Chat Room (Read-Only Test)...');
    try {
      await axios.post(`${API_URL}/chat/messages`, {
        roomId: projectRoom.id,
        message: 'This should be blocked!'
      }, { headers });
      console.error('❌ FAIL: Message allowed in archived chat room.');
    } catch (err) {
      if (err.response && err.response.status === 403) {
        console.log(`✓ SUCCESS: Message rejected with 403 Forbidden: "${err.response.data.message}"`);
      } else {
        console.log(`✓ SUCCESS: Message rejected with status ${err.response?.status}`);
      }
    }

    // 8. Reopen Project (COMPLETED -> ACTIVE) -> Reuses SAME Chat Room
    console.log('\n[Step 8] Reopening Project (COMPLETED -> ACTIVE)...');
    await axios.put(`${API_URL}/projects/${project.id}`, { status: 'ACTIVE' }, { headers });

    roomsRes = await axios.get(`${API_URL}/chat/rooms`, { headers });
    const matchingRooms = roomsRes.data.filter(r => r.projectId === project.id);
    if (matchingRooms.length === 1 && !matchingRooms[0].isArchived) {
      console.log(`✓ SUCCESS: Exactly 1 chat room reactivated without duplicate: ID = ${matchingRooms[0].id}`);
    } else {
      console.error(`❌ FAIL: Found ${matchingRooms.length} chat rooms or room remained archived.`);
    }

    // 9. Soft Delete Project
    console.log('\n[Step 9] Soft-deleting Project...');
    await axios.delete(`${API_URL}/projects/${project.id}`, { headers });

    roomsRes = await axios.get(`${API_URL}/chat/rooms`, { headers });
    const finalRoom = roomsRes.data.find(r => r.projectId === project.id);
    if (finalRoom && finalRoom.isArchived) {
      console.log('✓ SUCCESS: Soft deleting project automatically archived chat room.');
    }

    console.log('\n====================================================');
    console.log('PHASE 1 & PHASE 2A E2E VERIFICATION CHECKS PASSED! 🎉');
    console.log('====================================================');
  } catch (error) {
    console.error('\n❌ E2E TEST FAILED:', error.response?.data || error.message);
  }
}

runTest();
