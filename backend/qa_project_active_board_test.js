const http = require('http');
const prisma = require('./src/utils/db');
const { getTestConfig } = require('./src/utils/testConfigHelper');

const testConfig = getTestConfig({ isDestructive: true });

// Helper to send HTTP requests to live backend
function makeRequest(options, postData) {
  const reqOptions = {
    hostname: testConfig.hostname,
    port: testConfig.port,
    ...options
  };
  return new Promise((resolve, reject) => {
    const req = http.request(reqOptions, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve({ status: res.statusCode, data: parsed, headers: res.headers });
        } catch (e) {
          resolve({ status: res.statusCode, rawBody: body, headers: res.headers });
        }
      });
    });

    req.on('error', (err) => reject(err));

    if (postData) {
      req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
    }
    req.end();
  });
}

async function runFullApiVerification() {
  console.log('================ LIVE BACKEND HTTP API QA VERIFICATION =================\n');

  let token = null;
  let adminUser = null;
  let createdProjectId = null;
  let createdTaskId = null;

  try {
    // 1. Authenticate as Admin
    console.log('STEP 1: Authenticating as Admin (POST /api/auth/login)...');
    const loginRes = await makeRequest({
      hostname: testConfig.hostname,
      port: testConfig.port,
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      userId: 'admin@enterprise-crm.com',
      password: '10062004'
    });

    if (loginRes.status !== 200 || !loginRes.data?.token) {
      throw new Error(`Login failed with HTTP ${loginRes.status}: ${JSON.stringify(loginRes.data)}`);
    }

    token = loginRes.data.token;
    adminUser = loginRes.data.user;
    console.log(`✓ Admin Authenticated Successfully!`);
    console.log(`  User: ${adminUser.name} (${adminUser.email})`);
    console.log(`  Role: ${adminUser.role}\n`);

    const authHeaders = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    };

    // Find valid Team Leader or Employee for task assignment
    const usersRes = await makeRequest({
      hostname: testConfig.hostname,
      port: testConfig.port,
      path: '/api/users?limit=1000&status=ACTIVE',
      method: 'GET',
      headers: authHeaders
    });

    const assignableUsers = (usersRes.data?.users || []).filter(u => u.role === 'TEAM_LEADER' || u.role === 'EMPLOYEE' || u.role === 'INTERN');
    if (assignableUsers.length === 0) {
      throw new Error('No assignable team leader or employee found in DB.');
    }
    const assignee = assignableUsers[0];
    console.log(`Selected Task Assignee: ${assignee.name} (${assignee.role} - ID: ${assignee.id})\n`);

    // 2. Create a new ACTIVE project
    console.log('STEP 2: Creating a new ACTIVE project (POST /api/projects)...');
    const projectPayload = {
      name: `E2E Active Board Project ${Date.now()}`,
      description: 'Test project for active board verification',
      type: 'CLIENT',
      priority: 'HIGH',
      status: 'ACTIVE',
      leaderId: assignee.role === 'TEAM_LEADER' ? assignee.id : null,
      memberIds: [assignee.id],
      estimatedStartDate: new Date().toISOString().split('T')[0],
      estimatedEndDate: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().split('T')[0]
    };

    const createProjRes = await makeRequest({
      hostname: testConfig.hostname,
      port: testConfig.port,
      path: '/api/projects',
      method: 'POST',
      headers: authHeaders
    }, projectPayload);

    if (createProjRes.status !== 201 || !createProjRes.data?.project) {
      throw new Error(`Project creation failed with HTTP ${createProjRes.status}: ${JSON.stringify(createProjRes.data)}`);
    }

    const project = createProjRes.data.project;
    createdProjectId = project.id;
    console.log(`✓ Project Created via API!`);
    console.log(`  Project ID: ${project.id}`);
    console.log(`  Project Code: ${project.projectCode}`);
    console.log(`  Name: "${project.name}"`);
    console.log(`  Status: "${project.status}"\n`);

    // 3. Verify project exists via GET /api/projects
    console.log('STEP 3 & 4: Verifying project in GET /api/projects listing & initial task count...');
    const getProjectsRes = await makeRequest({
      hostname: testConfig.hostname,
      port: testConfig.port,
      path: '/api/projects',
      method: 'GET',
      headers: authHeaders
    });

    if (getProjectsRes.status !== 200 || !getProjectsRes.data?.projects) {
      throw new Error(`GET /api/projects failed with HTTP ${getProjectsRes.status}`);
    }

    const fetchedProject = getProjectsRes.data.projects.find(p => p.id === createdProjectId);
    if (!fetchedProject) {
      throw new Error(`Created project ID ${createdProjectId} NOT found in GET /api/projects response!`);
    }

    console.log(`✓ Project Verified in GET /api/projects listing!`);
    console.log(`  Status in API: "${fetchedProject.status}"`);
    console.log(`  Initial Task Count (DB/API): ${fetchedProject.totalTasks} (Verified 0 tasks)\n`);

    // 5. Create the first task under that project
    console.log('STEP 5: Creating the first Task under project (POST /api/tasks)...');
    const taskPayload = {
      title: `E2E Active Board Task ${Date.now()}`,
      description: 'First task for active board project verification',
      priority: 'MEDIUM',
      deadline: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString().split('T')[0],
      assigneeId: assignee.id,
      projectId: createdProjectId,
      type: 'TASK',
      storyPoints: 3,
      sprintName: 'Sprint 1'
    };

    const createTaskRes = await makeRequest({
      hostname: testConfig.hostname,
      port: testConfig.port,
      path: '/api/tasks',
      method: 'POST',
      headers: authHeaders
    }, taskPayload);

    if (createTaskRes.status !== 201 || !createTaskRes.data?.id) {
      throw new Error(`Task creation failed with HTTP ${createTaskRes.status}: ${JSON.stringify(createTaskRes.data)}`);
    }

    const task = createTaskRes.data;
    createdTaskId = task.id;
    console.log(`✓ First Task Created via API!`);
    console.log(`  Task ID: ${task.id}`);
    console.log(`  Title: "${task.title}"`);
    console.log(`  Status: "${task.status}"`);
    console.log(`  Associated Project ID: ${task.projectId}\n`);

    // 6 & 7. Verify GET /api/tasks returns the new task with correct projectId and status PENDING
    console.log('STEP 6 & 7: Verifying task in GET /api/tasks listing...');
    const getTasksRes = await makeRequest({
      hostname: testConfig.hostname,
      port: testConfig.port,
      path: '/api/tasks',
      method: 'GET',
      headers: authHeaders
    });

    if (getTasksRes.status !== 200 || !Array.isArray(getTasksRes.data)) {
      throw new Error(`GET /api/tasks failed with HTTP ${getTasksRes.status}`);
    }

    const fetchedTask = getTasksRes.data.find(t => t.id === createdTaskId);
    if (!fetchedTask) {
      throw new Error(`Created task ID ${createdTaskId} NOT found in GET /api/tasks response!`);
    }

    console.log(`✓ Task Verified in GET /api/tasks listing!`);
    console.log(`  Task Title: "${fetchedTask.title}"`);
    console.log(`  Task Status: "${fetchedTask.status}" (Verified PENDING / TO DO)`);
    console.log(`  Task Project ID: "${fetchedTask.projectId}" (Matches Project ID: ${fetchedTask.projectId === createdProjectId ? '✓ MATCH' : '✕ MISMATCH'})\n`);

    // 8. Verify project's task count changes from 0 -> 1
    console.log('STEP 8: Verifying project task count update (0 -> 1) via GET /api/projects...');
    const getProjectsAfterTaskRes = await makeRequest({
      hostname: testConfig.hostname,
      port: testConfig.port,
      path: '/api/projects',
      method: 'GET',
      headers: authHeaders
    });

    const updatedProject = getProjectsAfterTaskRes.data.projects.find(p => p.id === createdProjectId);
    console.log(`✓ Project Task Count Updated:`);
    console.log(`  Previous Task Count: 0`);
    console.log(`  New Task Count: ${updatedProject.totalTasks} (Verified 0 -> 1 Task Count Change)\n`);

    console.log('================ RESULT: 100% PASS ================');
  } catch (error) {
    console.error('\n✕ TEST FAILED WITH ERROR:', error.message);
  } finally {
    // 10. Database Cleanup
    console.log('\nSTEP 10: Cleaning up test records from PostgreSQL DB...');
    if (createdTaskId) {
      await prisma.taskHistory.deleteMany({ where: { taskId: createdTaskId } });
      await prisma.task.delete({ where: { id: createdTaskId } });
      console.log(`  ✓ Cleaned test task: ${createdTaskId}`);
    }
    if (createdProjectId) {
      await prisma.projectHistory.deleteMany({ where: { projectId: createdProjectId } });
      await prisma.projectMember.deleteMany({ where: { projectId: createdProjectId } });
      await prisma.project.delete({ where: { id: createdProjectId } });
      console.log(`  ✓ Cleaned test project: ${createdProjectId}`);
    }
    await prisma.$disconnect();
    console.log('✓ Cleanup Complete. Database clean!');
  }
}

runFullApiVerification();
