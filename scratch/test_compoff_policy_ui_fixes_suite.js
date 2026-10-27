const prisma = require('../backend/src/utils/db');
const {
  deleteLeaveType,
  updateGlobalLeavePolicy,
  getGlobalLeavePolicy
} = require('../backend/src/controllers/leavePolicyController');

function createMockReqRes(reqData = {}) {
  const req = {
    params: reqData.params || {},
    query: reqData.query || {},
    body: reqData.body || {},
    user: reqData.user || null,
    headers: reqData.headers || {},
    ip: '127.0.0.1'
  };

  let statusCode = 200;
  let responseData = null;

  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      responseData = data;
      return this;
    },
    send(data) {
      responseData = data;
      return this;
    },
    setHeader(name, value) {
      return this;
    },
    getStatus() {
      return statusCode;
    },
    getData() {
      return responseData;
    }
  };

  return { req, res };
}

function assert(condition, message) {
  if (!condition) {
    console.error(`  ✗ FAIL: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  ✓ PASS: ${message}`);
}

async function runPolicyUIFixesSuite() {
  console.log('\n========================================================================');
  console.log('  InnovEity CRM — Comp-Off Policy UI Fixes Test Suite');
  console.log('========================================================================\n');

  let testOrg = null;
  let superAdminUser = null;
  let compOffType = null;
  let tempCustomType = null;

  try {
    // Setup test fixtures
    testOrg = await prisma.organization.findFirst();
    assert(Boolean(testOrg), 'Test organization located in database');

    superAdminUser = await prisma.user.findFirst({
      where: { role: 'SUPER_ADMIN' }
    });
    if (!superAdminUser) {
      superAdminUser = await prisma.user.findFirst({
        where: { role: 'ADMIN' }
      });
    }
    assert(Boolean(superAdminUser), `Administrative user located: ${superAdminUser?.role}`);

    // Locate or create COMP_OFF leave type
    compOffType = await prisma.leaveType.findFirst({
      where: {
        OR: [
          { code: 'COMP_OFF' },
          { name: { contains: 'Comp' } }
        ]
      }
    });

    if (!compOffType) {
      compOffType = await prisma.leaveType.create({
        data: {
          name: 'Compensatory Off',
          code: 'COMP_OFF',
          description: 'Compensatory off for approved holiday work',
          color: '#8B5CF6',
          icon: 'Clock',
          displayOrder: 99,
          isPaid: true,
          annualDays: 0,
          monthlyCreditDays: 0,
          allowCarryForward: false,
          isSystem: true,
          isActive: true
        }
      });
    }
    assert(Boolean(compOffType), `COMP_OFF leave type verified in database (ID: ${compOffType.id}, Code: ${compOffType.code})`);

    // -------------------------------------------------------------------------
    // TEST GROUP 1: Backend COMP_OFF Non-Deletable Protection
    // -------------------------------------------------------------------------
    console.log('\n--- Test Group 1: Backend COMP_OFF Deletion Protection ---');

    // Attempt to delete COMP_OFF via ID
    {
      const { req, res } = createMockReqRes({
        user: superAdminUser,
        params: { id: compOffType.id }
      });
      await deleteLeaveType(req, res);
      assert(res.getStatus() === 400, 'Direct API attempt to delete COMP_OFF by UUID is rejected with HTTP 400');
      assert(res.getData()?.message.includes('cannot be deleted'), 'Error message clearly indicates COMP_OFF cannot be deleted');
      assert(res.getData()?.message.includes('mandatory system policy'), 'Error message identifies COMP_OFF as a mandatory system policy');
    }

    // Attempt to delete COMP_OFF via Code
    {
      const { req, res } = createMockReqRes({
        user: superAdminUser,
        params: { id: 'COMP_OFF' }
      });
      await deleteLeaveType(req, res);
      assert(res.getStatus() === 400, 'Direct API attempt to delete COMP_OFF by code string is rejected with HTTP 400');
      assert(res.getData()?.message.includes('cannot be deleted'), 'Error message for code-string lookup indicates policy cannot be deleted');
    }

    // Attempt to delete Casual Leave (CL) and Sick Leave (SL) are also protected
    {
      const clType = await prisma.leaveType.findFirst({ where: { code: 'CL' } });
      if (clType) {
        const { req, res } = createMockReqRes({
          user: superAdminUser,
          params: { id: clType.id }
        });
        await deleteLeaveType(req, res);
        assert(res.getStatus() === 400, 'Casual Leave (CL) remains non-deletable (400)');
      }

      const slType = await prisma.leaveType.findFirst({ where: { code: 'SL' } });
      if (slType) {
        const { req, res } = createMockReqRes({
          user: superAdminUser,
          params: { id: slType.id }
        });
        await deleteLeaveType(req, res);
        assert(res.getStatus() === 400, 'Sick Leave (SL) remains non-deletable (400)');
      }
    }

    // Verify COMP_OFF record is still active in database
    const verifyCompOffInDb = await prisma.leaveType.findUnique({
      where: { id: compOffType.id }
    });
    assert(Boolean(verifyCompOffInDb), 'COMP_OFF leave type remains fully intact in database');

    // -------------------------------------------------------------------------
    // TEST GROUP 2: Other Deletable Leave Types Still Function Normally
    // -------------------------------------------------------------------------
    console.log('\n--- Test Group 2: Deletable Custom Leave Types Still Work ---');

    tempCustomType = await prisma.leaveType.create({
      data: {
        name: `Test Custom Deletable ${Date.now()}`,
        code: `TCD_${Math.floor(Math.random() * 9000 + 1000)}`,
        description: 'Temporary custom leave type for deletion test',
        color: '#F59E0B',
        icon: 'Award',
        displayOrder: 88,
        isPaid: true,
        annualDays: 5,
        monthlyCreditDays: 0,
        allowCarryForward: false,
        isSystem: false,
        isActive: true
      }
    });
    assert(Boolean(tempCustomType), `Created custom deletable leave type: ${tempCustomType.code}`);

    {
      const { req, res } = createMockReqRes({
        user: superAdminUser,
        params: { id: tempCustomType.id }
      });
      await deleteLeaveType(req, res);
      assert(res.getStatus() === 200, 'Custom non-system leave type deletes successfully with HTTP 200');
      assert(res.getData()?.message.includes('deleted successfully'), 'Success message returned for custom leave deletion');

      const checkDeleted = await prisma.leaveType.findUnique({
        where: { id: tempCustomType.id }
      });
      assert(!checkDeleted, 'Custom leave type cleanly removed from database');
      tempCustomType = null;
    }

    // -------------------------------------------------------------------------
    // TEST GROUP 3: Retrospective Claim Rule Toggle (ON and OFF States)
    // -------------------------------------------------------------------------
    console.log('\n--- Test Group 3: Retrospective Claim Rule Toggle (ON & OFF) ---');

    // Step A: Turn toggle OFF
    {
      const { req, res } = createMockReqRes({
        user: superAdminUser,
        body: {
          organizationId: testOrg.id,
          compOffClaimWindowEnabled: false,
          compOffClaimWindowDays: 30,
          compOffValidityDays: 90
        }
      });
      await updateGlobalLeavePolicy(req, res);
      assert(res.getStatus() === 200, 'updateGlobalLeavePolicy succeeds when setting compOffClaimWindowEnabled = false');

      // Fetch policy to verify persisted OFF state
      const { req: getReq, res: getRes } = createMockReqRes({
        user: superAdminUser,
        query: { organizationId: testOrg.id }
      });
      await getGlobalLeavePolicy(getReq, getRes);
      assert(getRes.getStatus() === 200, 'getGlobalLeavePolicy succeeds after update');
      const fetchedPolicy = getRes.getData()?.policy;
      assert(fetchedPolicy?.compOffClaimWindowEnabled === false, 'compOffClaimWindowEnabled correctly saved and fetched as false (OFF)');
    }

    // Step B: Turn toggle ON
    {
      const { req, res } = createMockReqRes({
        user: superAdminUser,
        body: {
          organizationId: testOrg.id,
          compOffClaimWindowEnabled: true,
          compOffClaimWindowDays: 30,
          compOffValidityDays: 90
        }
      });
      await updateGlobalLeavePolicy(req, res);
      assert(res.getStatus() === 200, 'updateGlobalLeavePolicy succeeds when setting compOffClaimWindowEnabled = true');

      // Fetch policy to verify persisted ON state
      const { req: getReq, res: getRes } = createMockReqRes({
        user: superAdminUser,
        query: { organizationId: testOrg.id }
      });
      await getGlobalLeavePolicy(getReq, getRes);
      assert(getRes.getStatus() === 200, 'getGlobalLeavePolicy succeeds after re-enabling');
      const fetchedPolicy = getRes.getData()?.policy;
      assert(fetchedPolicy?.compOffClaimWindowEnabled === true, 'compOffClaimWindowEnabled correctly saved and fetched as true (ON)');
    }

    // -------------------------------------------------------------------------
    // TEST GROUP 4: Frontend Component Logic & Safety Invariants
    // -------------------------------------------------------------------------
    console.log('\n--- Test Group 4: Frontend Component Logic & Safety Invariants ---');

    // Simulate LeavePolicySettings.jsx isProtectedLeaveType function
    const isProtectedLeaveType = (lt) => {
      if (!lt) return false;
      const protectedCodes = ['CL', 'SL', 'COMP_OFF'];
      const code = (lt.code || '').toUpperCase();
      const name = (lt.name || '').trim().toLowerCase();
      return protectedCodes.includes(code) ||
        name === 'casual leave' ||
        name === 'sick leave' ||
        name === 'compensatory off' ||
        name === 'comp-off' ||
        lt.isSystem === true;
    };

    assert(isProtectedLeaveType({ code: 'COMP_OFF' }) === true, 'Frontend isProtectedLeaveType marks COMP_OFF as protected');
    assert(isProtectedLeaveType({ code: 'CL' }) === true, 'Frontend isProtectedLeaveType marks CL as protected');
    assert(isProtectedLeaveType({ code: 'SL' }) === true, 'Frontend isProtectedLeaveType marks SL as protected');
    assert(isProtectedLeaveType({ name: 'Compensatory Off' }) === true, 'Frontend isProtectedLeaveType marks "Compensatory Off" by name as protected');
    assert(isProtectedLeaveType({ code: 'CUSTOM_LEAVE', isSystem: false }) === false, 'Frontend isProtectedLeaveType correctly allows custom leave type deletion');

    console.log('\n========================================================================');
    console.log('  ALL COMP-OFF POLICY UI FIX TESTS PASSED (100%)');
    console.log('========================================================================\n');
  } catch (err) {
    console.error('\nSuite execution failed with error:', err);
    throw err;
  } finally {
    // Teardown
    if (tempCustomType) {
      await prisma.leaveType.delete({ where: { id: tempCustomType.id } }).catch(() => null);
    }
  }
}

runPolicyUIFixesSuite()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
