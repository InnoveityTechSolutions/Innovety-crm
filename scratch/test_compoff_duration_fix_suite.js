/**
 * Test Suite: Comp-Off Clock-Out Duration Normalization & Defensive Formatting
 * Verifies backend serializeCompOffSession and frontend duration formatters.
 */
import assert from 'assert';
import { serializeCompOffSession } from '../backend/src/services/compOffService.js';
import { formatDurationHours, formatCompOffWorkedDuration } from '../frontend/src/utils/attendanceFormatter.js';

console.log('================================================================');
console.log('RUNNING COMP-OFF DURATION FIX TEST SUITE');
console.log('================================================================\n');

let passedTests = 0;
let totalTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✓ PASS: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error(`    ${err.message}`);
    process.exitCode = 1;
  }
}

// -------------------------------------------------------------
// PART 1: Backend serializeCompOffSession Tests
// -------------------------------------------------------------
console.log('--- PART 1: Backend serializeCompOffSession Normalization ---');

runTest('Handles null or undefined session without errors', () => {
  assert.strictEqual(serializeCompOffSession(null), null);
  assert.strictEqual(serializeCompOffSession(undefined), undefined);
});

runTest('Preserves session fields while normalizing Decimal string', () => {
  const session = {
    id: 'sess-123',
    userId: 'user-456',
    status: 'COMPLETED',
    workDate: new Date('2026-10-22'),
    durationHours: '4.50', // Simulated Prisma Decimal serialized as string
    permissionRequest: { id: 'perm-789', status: 'APPROVED' }
  };

  const serialized = serializeCompOffSession(session);
  assert.strictEqual(serialized.id, 'sess-123');
  assert.strictEqual(serialized.userId, 'user-456');
  assert.strictEqual(serialized.status, 'COMPLETED');
  assert.strictEqual(typeof serialized.durationHours, 'number');
  assert.strictEqual(serialized.durationHours, 4.5);
  assert.deepStrictEqual(serialized.permissionRequest, session.permissionRequest);
});

runTest('Normalizes native number durationHours correctly', () => {
  const session = { id: 'sess-1', durationHours: 7.25 };
  const serialized = serializeCompOffSession(session);
  assert.strictEqual(typeof serialized.durationHours, 'number');
  assert.strictEqual(serialized.durationHours, 7.25);
});

runTest('Normalizes zero Decimal ("0.00" or 0) correctly', () => {
  const sessionStr = { id: 'sess-2', durationHours: '0.00' };
  const sessionNum = { id: 'sess-3', durationHours: 0 };
  assert.strictEqual(serializeCompOffSession(sessionStr).durationHours, 0);
  assert.strictEqual(serializeCompOffSession(sessionNum).durationHours, 0);
});

runTest('Safely preserves null and undefined durationHours', () => {
  const sessionNull = { id: 'sess-4', durationHours: null };
  const sessionUndef = { id: 'sess-5' };
  assert.strictEqual(serializeCompOffSession(sessionNull).durationHours, null);
  assert.strictEqual(serializeCompOffSession(sessionUndef).durationHours, undefined);
});

runTest('Handles invalid strings and NaN by defaulting to 0', () => {
  const sessionInvalid = { id: 'sess-6', durationHours: 'invalid_duration' };
  const sessionNaN = { id: 'sess-7', durationHours: NaN };
  const sessionInf = { id: 'sess-8', durationHours: Infinity };
  assert.strictEqual(serializeCompOffSession(sessionInvalid).durationHours, 0);
  assert.strictEqual(serializeCompOffSession(sessionNaN).durationHours, 0);
  assert.strictEqual(serializeCompOffSession(sessionInf).durationHours, 0);
});

runTest('Simulates Prisma Decimal object with custom toString / toJSON', () => {
  const mockPrismaDecimal = {
    d: [4, 5000000],
    e: 0,
    s: 1,
    toString: () => '4.50',
    toJSON: () => '4.50'
  };
  const session = { id: 'sess-prisma', durationHours: mockPrismaDecimal };
  const serialized = serializeCompOffSession(session);
  assert.strictEqual(typeof serialized.durationHours, 'number');
  assert.strictEqual(serialized.durationHours, 4.5);
});

// -------------------------------------------------------------
// PART 2: Frontend formatDurationHours Tests
// -------------------------------------------------------------
console.log('\n--- PART 2: Frontend formatDurationHours Tests ---');

runTest('formatDurationHours formats positive numbers correctly', () => {
  assert.strictEqual(formatDurationHours(4.5), '4.5');
  assert.strictEqual(formatDurationHours(8.0), '8.0');
  assert.strictEqual(formatDurationHours(5.267, 2), '5.27');
});

runTest('formatDurationHours formats numeric strings correctly', () => {
  assert.strictEqual(formatDurationHours('4.50'), '4.5');
  assert.strictEqual(formatDurationHours('8.00'), '8.0');
  assert.strictEqual(formatDurationHours('0.15'), '0.1');
});

runTest('formatDurationHours formats zero correctly', () => {
  assert.strictEqual(formatDurationHours(0), '0.0');
  assert.strictEqual(formatDurationHours('0.00'), '0.0');
});

runTest('formatDurationHours returns null for null, undefined, empty, and non-numeric values', () => {
  assert.strictEqual(formatDurationHours(null), null);
  assert.strictEqual(formatDurationHours(undefined), null);
  assert.strictEqual(formatDurationHours(''), null);
  assert.strictEqual(formatDurationHours('invalid'), null);
  assert.strictEqual(formatDurationHours(NaN), null);
  assert.strictEqual(formatDurationHours(Infinity), null);
});

// -------------------------------------------------------------
// PART 3: Frontend formatCompOffWorkedDuration Tests
// -------------------------------------------------------------
console.log('\n--- PART 3: Frontend formatCompOffWorkedDuration Tests ---');

runTest('Dashboard format: positive duration returns formatted value with "h"', () => {
  assert.strictEqual(formatCompOffWorkedDuration(4.5, 'h', 'Completed'), '4.5h');
  assert.strictEqual(formatCompOffWorkedDuration('4.50', 'h', 'Completed'), '4.5h');
  assert.strictEqual(formatCompOffWorkedDuration(8, 'h', 'Completed'), '8.0h');
});

runTest('Dashboard format: zero, null, undefined, or invalid returns "Completed" fallback', () => {
  assert.strictEqual(formatCompOffWorkedDuration(0, 'h', 'Completed'), 'Completed');
  assert.strictEqual(formatCompOffWorkedDuration('0.00', 'h', 'Completed'), 'Completed');
  assert.strictEqual(formatCompOffWorkedDuration(null, 'h', 'Completed'), 'Completed');
  assert.strictEqual(formatCompOffWorkedDuration(undefined, 'h', 'Completed'), 'Completed');
  assert.strictEqual(formatCompOffWorkedDuration('', 'h', 'Completed'), 'Completed');
  assert.strictEqual(formatCompOffWorkedDuration('corrupt_data', 'h', 'Completed'), 'Completed');
  assert.strictEqual(formatCompOffWorkedDuration(NaN, 'h', 'Completed'), 'Completed');
});

runTest('Attendance page format: positive duration returns formatted value with " hrs"', () => {
  assert.strictEqual(formatCompOffWorkedDuration(4.5, ' hrs', 'Logged Out'), '4.5 hrs');
  assert.strictEqual(formatCompOffWorkedDuration('4.50', ' hrs', 'Logged Out'), '4.5 hrs');
});

runTest('Attendance page format: zero, null, undefined returns "Logged Out" fallback', () => {
  assert.strictEqual(formatCompOffWorkedDuration(0, ' hrs', 'Logged Out'), 'Logged Out');
  assert.strictEqual(formatCompOffWorkedDuration('0.00', ' hrs', 'Logged Out'), 'Logged Out');
  assert.strictEqual(formatCompOffWorkedDuration(null, ' hrs', 'Logged Out'), 'Logged Out');
  assert.strictEqual(formatCompOffWorkedDuration(undefined, ' hrs', 'Logged Out'), 'Logged Out');
});

runTest('CompOffSessionCard detail line: {formatDurationHours(val) || "0.0"} Hours Logged', () => {
  assert.strictEqual(`${formatDurationHours(4.5) || '0.0'} Hours Logged`, '4.5 Hours Logged');
  assert.strictEqual(`${formatDurationHours('4.50') || '0.0'} Hours Logged`, '4.5 Hours Logged');
  assert.strictEqual(`${formatDurationHours(0) || '0.0'} Hours Logged`, '0.0 Hours Logged');
  assert.strictEqual(`${formatDurationHours('0.00') || '0.0'} Hours Logged`, '0.0 Hours Logged');
  assert.strictEqual(`${formatDurationHours(null) || '0.0'} Hours Logged`, '0.0 Hours Logged');
  assert.strictEqual(`${formatDurationHours(undefined) || '0.0'} Hours Logged`, '0.0 Hours Logged');
  assert.strictEqual(`${formatDurationHours('invalid') || '0.0'} Hours Logged`, '0.0 Hours Logged');
});

// -------------------------------------------------------------
// PART 4: End-to-End JSON Roundtrip Simulation
// -------------------------------------------------------------
console.log('\n--- PART 4: JSON Roundtrip Simulation ---');

runTest('Simulates backend response -> JSON.stringify -> JSON.parse -> frontend render', () => {
  // Backend returns serialized session
  const backendSession = serializeCompOffSession({
    id: 'session-e2e',
    status: 'COMPLETED',
    durationHours: '5.25' // From Prisma Decimal
  });

  const backendResponse = {
    message: 'Comp-Off clock-out completed successfully.',
    session: backendSession
  };

  // Express JSON serialization + Axios client deserialization
  const wireData = JSON.stringify(backendResponse);
  const frontendData = JSON.parse(wireData);

  // Frontend assertions
  assert.strictEqual(typeof frontendData.session.durationHours, 'number');
  assert.strictEqual(frontendData.session.durationHours, 5.25);

  // Frontend rendering evaluates without TypeError
  const dashboardText = `Comp-Off Worked: ${formatCompOffWorkedDuration(frontendData.session?.durationHours, 'h', 'Completed')}`;
  assert.strictEqual(dashboardText, 'Comp-Off Worked: 5.3h');

  const attendanceText = `Comp-Off Session Completed Today (${formatCompOffWorkedDuration(frontendData.session?.durationHours, ' hrs', 'Logged Out')})`;
  assert.strictEqual(attendanceText, 'Comp-Off Session Completed Today (5.3 hrs)');

  const cardText = `${formatDurationHours(frontendData.session?.durationHours) || '0.0'} Hours Logged`;
  assert.strictEqual(cardText, '5.3 Hours Logged');
});

console.log('\n================================================================');
console.log(`TOTAL TESTS: ${totalTests} | PASSED: ${passedTests} | FAILED: ${totalTests - passedTests}`);
console.log('================================================================\n');

if (passedTests === totalTests) {
  console.log('ALL TESTS PASSED SUCCESSFULLY!');
} else {
  process.exit(1);
}
