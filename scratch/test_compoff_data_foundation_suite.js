const prisma = require('../backend/src/utils/db');
const compOffService = require('../backend/src/services/compOffService');
const { recalculateCompanyUserBalances } = require('../backend/src/controllers/leavePolicyController');

async function runTestSuite() {
  console.log('================================================================');
  console.log('  InnovEity CRM — Comp-Off Phase 1: Data Foundation Test Suite');
  console.log('================================================================\n');

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition, message) {
    totalTests++;
    if (condition) {
      passedTests++;
      console.log(`  ✓ PASS: ${message}`);
    } else {
      console.error(`  ✗ FAIL: ${message}`);
      throw new Error(`Assertion failed: ${message}`);
    }
  }

  try {
    // -------------------------------------------------------------
    // Test 1: Verify Database Table & Column Schema
    // -------------------------------------------------------------
    console.log('--- Test Group 1: Database Table & Schema Structure ---');
    const tableDesc = await prisma.$queryRawUnsafe('DESCRIBE `compoffcredit`');
    const fieldMap = new Set(tableDesc.map(col => col.Field));

    assert(fieldMap.has('id'), 'compoffcredit table has "id" column');
    assert(fieldMap.has('organizationId'), 'compoffcredit table has "organizationId" column');
    assert(fieldMap.has('userId'), 'compoffcredit table has "userId" column');
    assert(fieldMap.has('workDate'), 'compoffcredit table has "workDate" column');
    assert(fieldMap.has('attendanceId'), 'compoffcredit table has "attendanceId" column');
    assert(fieldMap.has('creditDays'), 'compoffcredit table has "creditDays" column');
    assert(fieldMap.has('usedDays'), 'compoffcredit table has "usedDays" column');
    assert(fieldMap.has('availableDays'), 'compoffcredit table has "availableDays" column');
    assert(fieldMap.has('earnedAt'), 'compoffcredit table has "earnedAt" column');
    assert(fieldMap.has('expiresAt'), 'compoffcredit table has "expiresAt" column');
    assert(fieldMap.has('status'), 'compoffcredit table has "status" column');
    assert(fieldMap.has('reason'), 'compoffcredit table has "reason" column');
    assert(fieldMap.has('claimedByRole'), 'compoffcredit table has "claimedByRole" column');
    assert(fieldMap.has('claimedById'), 'compoffcredit table has "claimedById" column');

    // Check leavepolicy table columns
    const policyCols = await prisma.$queryRawUnsafe("SHOW COLUMNS FROM `leavepolicy` LIKE 'compOff%'");
    const policyColNames = policyCols.map(c => c.Field);
    assert(policyColNames.includes('compOffValidityDays'), 'leavepolicy table has compOffValidityDays column');
    assert(policyColNames.includes('compOffClaimWindowDays'), 'leavepolicy table has compOffClaimWindowDays column');

    // -------------------------------------------------------------
    // Test 2: Credit Amount Validation (Strictly 0.5 or 1.0)
    // -------------------------------------------------------------
    console.log('\n--- Test Group 2: Credit Amount Validation ---');
    assert(compOffService.validateCreditAmount(1.0).isValid === true, '1.0 is valid full-day credit');
    assert(compOffService.validateCreditAmount(0.5).isValid === true, '0.5 is valid half-day credit');
    assert(compOffService.validateCreditAmount('1.0').isValid === true, 'String "1.0" parses to valid 1.0 credit');
    assert(compOffService.validateCreditAmount('0.5').isValid === true, 'String "0.5" parses to valid 0.5 credit');
    assert(compOffService.validateCreditAmount(0.75).isValid === false, '0.75 is rejected as invalid credit');
    assert(compOffService.validateCreditAmount(2.0).isValid === false, '2.0 is rejected as invalid credit');
    assert(compOffService.validateCreditAmount(-1.0).isValid === false, '-1.0 is rejected as invalid credit');
    assert(compOffService.validateCreditAmount('invalid').isValid === false, 'Non-numeric string is rejected');

    // -------------------------------------------------------------
    // Test 3: Claim Window Validation (30 Calendar Days Rule)
    // -------------------------------------------------------------
    console.log('\n--- Test Group 3: 30 Calendar Days Claim Window ---');
    const today = new Date('2026-10-15T12:00:00.000Z');

    // Case A: Work today
    const resToday = compOffService.validateClaimWindow('2026-10-15', 30, today);
    assert(resToday.isValid === true && resToday.elapsedDays === 0, 'Work date today is valid (0 elapsed days)');

    // Case B: Work 10 days ago (2026-10-05)
    const res10Days = compOffService.validateClaimWindow('2026-10-05', 30, today);
    assert(res10Days.isValid === true && res10Days.elapsedDays === 10, 'Work date 10 days ago is valid (10 elapsed days <= 30)');

    // Case C: Work exactly 30 days ago (2026-09-15)
    const res30Days = compOffService.validateClaimWindow('2026-09-15', 30, today);
    assert(res30Days.isValid === true && res30Days.elapsedDays === 30, 'Work date exactly 30 days ago is valid (boundary test)');

    // Case D: Work 31 days ago (2026-09-14) -> EXPIRED
    const res31Days = compOffService.validateClaimWindow('2026-09-14', 30, today);
    assert(res31Days.isValid === false && res31Days.elapsedDays === 31, 'Work date 31 days ago is rejected (> 30 calendar days)');

    // Case E: Work date in future (2026-10-16) -> REJECTED
    const resFuture = compOffService.validateClaimWindow('2026-10-16', 30, today);
    assert(resFuture.isValid === false, 'Future work date is rejected');

    // -------------------------------------------------------------
    // Test 4: Configurable Expiry Calculation (Default 90 Days)
    // -------------------------------------------------------------
    console.log('\n--- Test Group 4: Configurable Expiry Calculation ---');
    const workDate = new Date('2026-10-01T00:00:00.000Z');
    const expiry90 = compOffService.calculateExpiryDate(workDate, 90);
    // 2026-10-01 + 90 days = 2026-12-30
    assert(expiry90.toISOString().startsWith('2026-12-30'), 'Default 90 days expiry calculates to 2026-12-30');
    assert(expiry90.getHours() === 23 && expiry90.getMinutes() === 59, 'Expiry time set to end-of-day (23:59:59)');

    // Custom 60 days expiry
    const expiry60 = compOffService.calculateExpiryDate(workDate, 60);
    assert(expiry60.toISOString().startsWith('2026-11-30'), 'Configurable 60 days expiry calculates to 2026-11-30');

    // -------------------------------------------------------------
    // Test 5: Eligible Workday Detection (Sunday, Holiday, Shift Off)
    // -------------------------------------------------------------
    console.log('\n--- Test Group 5: Eligible Workday Detection ---');
    // Sunday Oct 18, 2026
    const resSunday = await compOffService.validateEligibleDay({
      workDate: new Date('2026-10-18T00:00:00.000Z')
    });
    assert(resSunday.isEligible === true && resSunday.eligibleReason === 'SUNDAY_WEEKLY_OFF', 'Sunday detected as eligible SUNDAY_WEEKLY_OFF');

    // Normal Wednesday Oct 14, 2026 (not a holiday)
    const resWednesday = await compOffService.validateEligibleDay({
      workDate: new Date('2026-10-14T00:00:00.000Z')
    });
    assert(resWednesday.isEligible === false, 'Normal Wednesday rejected as regular working day');

    // -------------------------------------------------------------
    // Test 6: Comp-Off System LeaveType Registration
    // -------------------------------------------------------------
    console.log('\n--- Test Group 6: System COMP_OFF LeaveType ---');
    const compOffType = await compOffService.ensureCompOffLeaveType();
    assert(compOffType !== null, 'COMP_OFF leave type ensured');
    assert(compOffType.code === 'COMP_OFF', 'Leave type code is COMP_OFF');
    assert(compOffType.isSystem === true, 'COMP_OFF is flagged as a protected system type');
    assert(compOffType.isPaid === true, 'COMP_OFF is marked as paid leave');
    assert(compOffType.annualDays === 0, 'COMP_OFF baseline annualDays is 0 (ledger-derived)');
    assert(compOffType.monthlyCreditDays === 0, 'COMP_OFF baseline monthlyCreditDays is 0');

    // -------------------------------------------------------------
    // Test 7: Database Constraints & Ledger Operations
    // -------------------------------------------------------------
    console.log('\n--- Test Group 7: Database Constraints & Ledger CRUD ---');
    const testUser = await prisma.user.findFirst({
      where: { role: 'EMPLOYEE', status: 'ACTIVE' }
    });
    assert(testUser !== null, 'Found active employee for ledger test');

    const testOrgId = testUser.organizationId;
    const testWorkDate = new Date('2026-10-11T00:00:00.000Z'); // Sunday Oct 11, 2026
    const testExpiry = compOffService.calculateExpiryDate(testWorkDate, 90);

    // Clean up any pre-existing test record for this user/date
    await prisma.compOffCredit.deleteMany({
      where: { userId: testUser.id, workDate: testWorkDate }
    });

    // 1. Insert valid Comp-Off Credit
    const credit1 = await prisma.compOffCredit.create({
      data: {
        organizationId: testOrgId,
        userId: testUser.id,
        workDate: testWorkDate,
        creditDays: 1.0,
        availableDays: 1.0,
        usedDays: 0.0,
        expiresAt: testExpiry,
        status: 'APPROVED',
        reason: 'Worked on Sunday deployment support',
        claimedByRole: 'EMPLOYEE',
        claimedById: testUser.id,
        adminApprovedById: testUser.id,
        adminApprovedAt: new Date()
      }
    });

    assert(credit1.id !== undefined, 'CompOffCredit record created successfully');
    assert(credit1.creditDays === 1.0, 'Credit record has 1.0 creditDays');
    assert(credit1.availableDays === 1.0, 'Credit record has 1.0 availableDays');

    // 2. Test Unique Constraint on [userId, workDate] (Must Reject Duplicate)
    let duplicateRejected = false;
    try {
      await prisma.compOffCredit.create({
        data: {
          organizationId: testOrgId,
          userId: testUser.id,
          workDate: testWorkDate, // Identical user & workDate!
          creditDays: 1.0,
          availableDays: 1.0,
          usedDays: 0.0,
          expiresAt: testExpiry,
          status: 'APPROVED',
          reason: 'Duplicate claim attempt',
          claimedByRole: 'EMPLOYEE',
          claimedById: testUser.id
        }
      });
    } catch (dbErr) {
      duplicateRejected = true;
      assert(dbErr.code === 'P2002' || String(dbErr.message).includes('Unique constraint'), 'Duplicate claim rejected by database unique constraint (P2002)');
    }
    assert(duplicateRejected === true, 'Duplicate credit insert for same workDate was strictly blocked');

    // -------------------------------------------------------------
    // Test 8: Live Ledger Balance Derivation
    // -------------------------------------------------------------
    console.log('\n--- Test Group 8: Ledger-Derived Balance Derivation ---');
    const ledgerBal = await compOffService.getUserCompOffLedgerBalance(testUser.id, new Date('2026-10-15T00:00:00.000Z'));
    assert(ledgerBal.totalEarned >= 1.0, 'totalEarned reflects earned credit >= 1.0');
    assert(ledgerBal.totalAvailable >= 1.0, 'totalAvailable reflects active credit >= 1.0');
    assert(ledgerBal.netAvailable >= 1.0, 'netAvailable matches active unexpired credits');

    // -------------------------------------------------------------
    // Test 9: Recalculation Safety Invariant
    // -------------------------------------------------------------
    console.log('\n--- Test Group 9: Policy Recalculation Safety Invariant ---');
    // Ensure recalculateCompanyUserBalances runs without throwing or wiping comp-off
    if (testOrgId) {
      await recalculateCompanyUserBalances(testOrgId);
      console.log('  Ran recalculateCompanyUserBalances on organization.');
    }

    // Verify credit record in compOffCredit is completely untouched
    const verifiedCredit = await prisma.compOffCredit.findUnique({
      where: { id: credit1.id }
    });
    assert(verifiedCredit !== null, 'Credit record persists after policy recalculation');
    assert(verifiedCredit.availableDays === 1.0, 'Credit availableDays preserved at 1.0 (no corruption)');

    // -------------------------------------------------------------
    // Test 10: Cleanup Test Fixtures
    // -------------------------------------------------------------
    console.log('\n--- Test Group 10: Fixture Cleanup ---');
    await prisma.compOffCredit.delete({
      where: { id: credit1.id }
    });
    console.log('  Cleaned up temporary test credit record.');

    console.log('\n================================================================');
    console.log(`  ALL TESTS PASSED! (${passedTests} / ${totalTests} assertions passed)`);
    console.log('================================================================\n');

  } catch (err) {
    console.error('\nTest Suite Failed:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runTestSuite();
