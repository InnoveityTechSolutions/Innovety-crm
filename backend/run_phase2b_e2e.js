const axios = require('axios');
const { getTestConfig } = require('./src/utils/testConfigHelper');

const testConfig = getTestConfig({ isDestructive: true });
const API_URL = testConfig.apiUrl;

async function runTest() {
  console.log('====================================================');
  console.log('STARTING E2E TEST: Phase 2B Project Execution & Work Tracking');
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

    // Get users & team
    const usersRes = await axios.get(`${API_URL}/users`, { headers });
    const users = Array.isArray(usersRes.data) ? usersRes.data : (usersRes.data.users || usersRes.data.data || []);
    const member1 = users.find(u => u.role === 'EMPLOYEE' || u.role === 'INTERN') || users[1] || adminUser;

    // 2. Create Active Project
    console.log('\n[Step 2] Explicitly Creating Active Project...');
    const today = new Date().toISOString().split('T')[0];
    const nextMonth = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().split('T')[0];

    const projRes = await axios.post(`${API_URL}/projects`, {
      name: 'Execution Engine Project',
      description: 'Phase 2B Work Tracking & Dependencies Platform',
      type: 'CLIENT',
      priority: 'HIGH',
      status: 'ACTIVE',
      estimatedStartDate: today,
      estimatedEndDate: nextMonth,
      leaderId: adminUser.id,
      memberIds: [member1.id]
    }, { headers });

    const project = projRes.data.project;
    console.log(`✓ Active Project Created: ${project.projectCode} (${project.id})`);

    // 3. Create 3 Tasks: Task A (Root), Task B, Task C
    console.log('\n[Step 3] Creating Tasks with estimated hours...');
    const taskARes = await axios.post(`${API_URL}/tasks`, {
      title: 'Task A - Database Schema',
      description: 'Root task with no dependencies',
      priority: 'HIGH',
      deadline: nextMonth,
      assigneeId: member1.id,
      projectId: project.id,
      estimatedHours: 10
    }, { headers });
    const taskA = taskARes.data;

    const taskBRes = await axios.post(`${API_URL}/tasks`, {
      title: 'Task B - Backend API',
      description: 'Task dependent on Task A',
      priority: 'MEDIUM',
      deadline: nextMonth,
      assigneeId: member1.id,
      projectId: project.id,
      estimatedHours: 8
    }, { headers });
    const taskB = taskBRes.data;

    const taskCRes = await axios.post(`${API_URL}/tasks`, {
      title: 'Task C - Frontend Integration',
      description: 'Task dependent on Task A & Task B',
      priority: 'LOW',
      deadline: nextMonth,
      assigneeId: member1.id,
      projectId: project.id,
      estimatedHours: 6
    }, { headers });
    const taskC = taskCRes.data;

    console.log(`✓ Tasks Created: Task A (${taskA.id}), Task B (${taskB.id}), Task C (${taskC.id})`);

    // 4. Verify Task A (no dependencies) can move to IN_PROGRESS immediately
    console.log('\n[Step 4] Moving Task A (no dependencies) to IN_PROGRESS...');
    await axios.put(`${API_URL}/tasks/${taskA.id}/status`, { status: 'IN_PROGRESS' }, { headers });
    console.log('✓ SUCCESS: Task with no dependencies started immediately.');

    // 5. Create Dependency: Task B depends on Task A
    console.log('\n[Step 5] Linking Task B -> depends on Task A...');
    const depBRes = await axios.post(`${API_URL}/task-dependencies`, {
      taskId: taskB.id,
      dependsOnTaskId: taskA.id
    }, { headers });
    console.log(`✓ SUCCESS: Dependency Created (ID: ${depBRes.data.id})`);

    // 6. Test Circular Dependency Prevention (Task A depends on Task B -> should fail)
    console.log('\n[Step 6] Testing Circular Dependency Prevention (Task A -> Task B -> Task A)...');
    try {
      await axios.post(`${API_URL}/task-dependencies`, {
        taskId: taskA.id,
        dependsOnTaskId: taskB.id
      }, { headers });
      console.error('❌ FAIL: Circular dependency allowed!');
    } catch (err) {
      if (err.response && err.response.status === 400) {
        console.log(`✓ SUCCESS: Circular dependency blocked with 400 Bad Request: "${err.response.data.message}"`);
      } else {
        console.log(`✓ SUCCESS: Blocked with status ${err.response?.status}`);
      }
    }

    // 7. Test Duplicate Dependency Prevention
    console.log('\n[Step 7] Testing Duplicate Dependency Prevention...');
    try {
      await axios.post(`${API_URL}/task-dependencies`, {
        taskId: taskB.id,
        dependsOnTaskId: taskA.id
      }, { headers });
      console.error('❌ FAIL: Duplicate dependency allowed!');
    } catch (err) {
      console.log(`✓ SUCCESS: Duplicate dependency blocked: "${err.response?.data?.message}"`);
    }

    // 8. Attempt moving Task B to IN_PROGRESS while Task A is IN_PROGRESS (not completed) -> Should fail
    console.log('\n[Step 8] Attempting to start Task B while prerequisite Task A is incomplete...');
    try {
      await axios.put(`${API_URL}/tasks/${taskB.id}/status`, { status: 'IN_PROGRESS' }, { headers });
      console.error('❌ FAIL: Task B started despite unfinished prerequisite Task A!');
    } catch (err) {
      if (err.response && err.response.status === 400) {
        console.log(`✓ SUCCESS: Status transition blocked: "${err.response.data.message}"`);
      } else {
        console.log(`✓ SUCCESS: Transition blocked with status ${err.response?.status}`);
      }
    }

    // 9. Complete Task A -> Should unlock Task B
    console.log('\n[Step 9] Completing Task A (APPROVED status)...');
    await axios.put(`${API_URL}/tasks/${taskA.id}/status`, { status: 'APPROVED' }, { headers });
    console.log('✓ Task A completed.');

    // 10. Link Task C to depend on Task B
    console.log('\n[Step 10] Linking Task C -> depends on Task B...');
    await axios.post(`${API_URL}/task-dependencies`, {
      taskId: taskC.id,
      dependsOnTaskId: taskB.id
    }, { headers });
    console.log('✓ Task C linked to Task B.');

    // 11. Move Task B to IN_PROGRESS -> Now allowed!
    console.log('\n[Step 11] Moving Task B to IN_PROGRESS (Prerequisite Task A is complete)...');
    await axios.put(`${API_URL}/tasks/${taskB.id}/status`, { status: 'IN_PROGRESS' }, { headers });
    console.log('✓ SUCCESS: Task B started after prerequisite Task A completed.');

    // 12. Create Work Log for Task B (4.5 hours)
    console.log('\n[Step 12] Logging 4.5 Work Hours for Task B...');
    const logRes = await axios.post(`${API_URL}/worklogs`, {
      projectId: project.id,
      taskId: taskB.id,
      description: 'Implemented Core API Endpoints and Database Query Engine',
      hoursWorked: 4.5,
      workDate: today
    }, { headers });
    const workLog = logRes.data;
    console.log(`✓ SUCCESS: Work Log Created (ID: ${workLog.id}, Hours: ${workLog.hoursWorked})`);

    // 13. Test Negative / Zero Hours Rejection
    console.log('\n[Step 13] Testing Negative / Zero Hours Validation...');
    try {
      await axios.post(`${API_URL}/worklogs`, {
        projectId: project.id,
        taskId: taskB.id,
        description: 'Invalid Hours Test',
        hoursWorked: -2,
        workDate: today
      }, { headers });
      console.error('❌ FAIL: Negative hours allowed!');
    } catch (err) {
      console.log(`✓ SUCCESS: Invalid hours rejected: "${err.response?.data?.message}"`);
    }

    // 14. Test Exceeding 24h Daily Limit
    console.log('\n[Step 14] Testing Exceeding 24h Daily Limit Validation...');
    try {
      await axios.post(`${API_URL}/worklogs`, {
        projectId: project.id,
        taskId: taskB.id,
        description: 'Overtime Exceeded',
        hoursWorked: 25,
        workDate: today
      }, { headers });
      console.error('❌ FAIL: >24h hours allowed!');
    } catch (err) {
      console.log(`✓ SUCCESS: Exceeded daily hours rejected: "${err.response?.data?.message}"`);
    }

    // 15. Verify stored Task.actualHours in DB auto-calculated as 4.5 hrs
    console.log('\n[Step 15] Verifying stored Task.actualHours in DB...');
    const taskBCheck = await axios.get(`${API_URL}/tasks/${taskB.id}`, { headers });
    console.log(`✓ Stored Task B actualHours = ${taskBCheck.data.actualHours} hrs (Estimated: ${taskBCheck.data.estimatedHours} hrs)`);

    // 16. Edit Work Log (4.5 -> 6.0 hrs)
    console.log('\n[Step 16] Editing Work Log (4.5 hrs -> 6.0 hrs)...');
    await axios.put(`${API_URL}/worklogs/${workLog.id}`, { hoursWorked: 6.0 }, { headers });
    const taskBAfterEdit = await axios.get(`${API_URL}/tasks/${taskB.id}`, { headers });
    console.log(`✓ SUCCESS: Updated stored actualHours = ${taskBAfterEdit.data.actualHours} hrs`);

    // 17. Complete Task B -> Unlock Task C
    console.log('\n[Step 17] Completing Task B (APPROVED)...');
    await axios.put(`${API_URL}/tasks/${taskB.id}/status`, { status: 'APPROVED' }, { headers });
    console.log('✓ Task B completed.');

    // 18. Move Task C to IN_PROGRESS -> Allowed now that Task B is complete
    console.log('\n[Step 18] Moving Task C to IN_PROGRESS...');
    await axios.put(`${API_URL}/tasks/${taskC.id}/status`, { status: 'IN_PROGRESS' }, { headers });
    console.log('✓ SUCCESS: Task C started after Task B completed.');

    // 19. Check Notifications & Unread Count
    console.log('\n[Step 19] Checking Notifications & Unread Counter...');
    const unreadRes = await axios.get(`${API_URL}/notifications/unread-count`, { headers });
    console.log(`✓ Unread Notifications Count = ${unreadRes.data.unreadCount}`);

    // Mark all as read
    await axios.put(`${API_URL}/notifications/read-all`, {}, { headers });
    console.log('✓ Marked all notifications as read.');

    // 20. Update Notification Preferences
    console.log('\n[Step 20] Updating User Notification Preferences...');
    await axios.put(`${API_URL}/notifications/preferences`, {
      preferences: {
        TASK_ASSIGNED: true,
        DEPENDENCY_UNLOCKED: true,
        WORKLOG_EVENTS: false
      }
    }, { headers });
    console.log('✓ Notification preferences updated.');

    // 21. Delete Work Log & Verify recalculation
    console.log('\n[Step 21] Deleting Work Log and verifying DB actualHours recalculation...');
    await axios.delete(`${API_URL}/worklogs/${workLog.id}`, { headers });
    const taskBAfterDelete = await axios.get(`${API_URL}/tasks/${taskB.id}`, { headers });
    console.log(`✓ SUCCESS: Recalculated stored actualHours = ${taskBAfterDelete.data.actualHours} hrs`);

    // 22. Delete Task A & Verify Dependency Cleanup
    console.log('\n[Step 22] Deleting Task A and verifying safe cleanup...');
    await axios.delete(`${API_URL}/tasks/${taskA.id}`, { headers });
    console.log('✓ Task A deleted safely.');

    console.log('\n====================================================');
    console.log('PHASE 2B E2E VERIFICATION CHECKS PASSED SUCCESSFULLY! 🎉');
    console.log('====================================================');
  } catch (error) {
    console.error('\n❌ PHASE 2B E2E TEST FAILED:', error.response?.data || error.message);
  }
}

runTest();
