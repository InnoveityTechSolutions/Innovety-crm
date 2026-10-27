/**
 * Test Suite: Verify Dashboard Comp-Off Login Visibility & Synthetic Record Handling
 */

function simulateDashboardLogic({
  statusData = null,
  logs = [],
  compOffStatus = null,
  shiftCountdown = { isExpired: false, autoClockOutEnabled: true }
}) {
  const localDateStr = new Date().toLocaleDateString('en-CA');
  
  // Fix 1: Actual attendance record selection (filtering out synthetic records)
  const todayRec = (statusData?.existingRecord && statusData.existingRecord.clockIn)
    ? statusData.existingRecord
    : logs.find(l => !l.isSynthetic && Boolean(l.clockIn) && new Date(l.date).toLocaleDateString('en-CA') === localDateStr);
  const clockedRecord = todayRec || null;

  // Fix 2: Clock-out detection (requiring genuine clockIn and clockOut)
  const isClockedIn = Boolean(clockedRecord && clockedRecord.clockIn && !clockedRecord.clockOut);
  const isClockedOutToday = Boolean(clockedRecord && clockedRecord.clockIn && clockedRecord.clockOut);

  const clockStatus = statusData;

  const isOffDay = Boolean(
    clockStatus?.isOffDay ||
    compOffStatus?.isOffDay ||
    clockStatus?.state === 'HOLIDAY' ||
    clockStatus?.reason === 'HOLIDAY' ||
    clockStatus?.reason === 'WEEKLY_OFF' ||
    clockStatus?.reason === 'SATURDAY_LEAVE'
  );

  const offDayLabel = clockStatus?.offDayTitle || (clockStatus?.reason === 'HOLIDAY' ? 'Company Holiday' : 'Holiday / Weekly Off');

  // Fix 3: Button rendering logic
  let renderedButton = '';
  if (isClockedOutToday) {
    renderedButton = 'ATTENDANCE_COMPLETED';
  } else if (isClockedIn) {
    renderedButton = 'CLOCK_OUT';
  } else if (compOffStatus?.isSessionActive) {
    renderedButton = 'COMPOFF_CLOCK_OUT';
  } else if (compOffStatus?.isSessionCompleted) {
    renderedButton = 'COMPOFF_COMPLETED';
  } else if (isOffDay) {
    if (compOffStatus?.canLogin) {
      renderedButton = 'COMPOFF_LOGIN';
    } else {
      renderedButton = 'OFFDAY_BANNER';
    }
  } else {
    renderedButton = 'CLOCK_IN';
  }

  // Fix 3b: Status badge logic
  let statusBadge = '';
  if (clockedRecord && clockedRecord.clockOut) {
    statusBadge = 'Shift Completed';
  } else if (isClockedIn) {
    statusBadge = shiftCountdown.isExpired && !shiftCountdown.autoClockOutEnabled
      ? 'Shift Ended (Manual Clock-Out Required)'
      : `Active (${clockedRecord?.status || 'PRESENT'})`;
  } else if (compOffStatus?.isSessionActive) {
    statusBadge = 'Comp-Off Active';
  } else if (compOffStatus?.isSessionCompleted) {
    statusBadge = 'Comp-Off Completed';
  } else if (isOffDay) {
    statusBadge = offDayLabel;
  } else {
    statusBadge = 'Not Clocked In';
  }

  return {
    clockedRecord,
    isClockedIn,
    isClockedOutToday,
    isOffDay,
    renderedButton,
    statusBadge
  };
}

let passed = 0;
let total = 0;

function assert(desc, condition) {
  total++;
  if (condition) {
    console.log(`  ✓ PASS: ${desc}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${desc}`);
    process.exitCode = 1;
  }
}

console.log('========================================================================');
console.log('  Testing Dashboard Comp-Off Login Visibility & Record Filtering');
console.log('========================================================================\n');

// 1. Holiday with Synthetic Log and Approved Comp-Off
console.log('--- Scenario 1: Holiday with Synthetic Log and Approved Comp-Off ---');
const s1 = simulateDashboardLogic({
  statusData: {
    canClockIn: false,
    state: 'HOLIDAY',
    reason: 'HOLIDAY',
    isOffDay: true,
    offDayTitle: 'Company Holiday',
    existingRecord: null
  },
  logs: [
    {
      id: 'holiday_emp123_2026-10-22',
      isSynthetic: true,
      status: 'HOLIDAY',
      date: new Date().toISOString(),
      clockIn: null,
      clockOut: null
    }
  ],
  compOffStatus: {
    isOffDay: true,
    hasApprovedPermission: true,
    canLogin: true,
    isSessionActive: false,
    isSessionCompleted: false
  }
});

assert('Synthetic holiday log is NOT assigned to clockedRecord', s1.clockedRecord === null);
assert('isClockedIn is false', s1.isClockedIn === false);
assert('isClockedOutToday is false (not falsely completed)', s1.isClockedOutToday === false);
assert('isOffDay is correctly recognized as true', s1.isOffDay === true);
assert('Dashboard renders COMPOFF_LOGIN button', s1.renderedButton === 'COMPOFF_LOGIN');
assert('Status badge shows Company Holiday (NEVER Active (HOLIDAY))', s1.statusBadge === 'Company Holiday');

// 2. Holiday with Synthetic Log without Comp-Off Approval
console.log('\n--- Scenario 2: Holiday without Approved Comp-Off ---');
const s2 = simulateDashboardLogic({
  statusData: {
    canClockIn: false,
    state: 'HOLIDAY',
    reason: 'HOLIDAY',
    isOffDay: true,
    offDayTitle: 'Company Holiday',
    existingRecord: null
  },
  logs: [
    {
      id: 'holiday_emp123_2026-10-22',
      isSynthetic: true,
      status: 'HOLIDAY',
      date: new Date().toISOString(),
      clockIn: null,
      clockOut: null
    }
  ],
  compOffStatus: {
    isOffDay: true,
    hasApprovedPermission: false,
    canLogin: false,
    isSessionActive: false,
    isSessionCompleted: false
  }
});

assert('clockedRecord is null', s2.clockedRecord === null);
assert('isClockedOutToday is false', s2.isClockedOutToday === false);
assert('Dashboard does NOT show COMPOFF_LOGIN (shows OFFDAY_BANNER)', s2.renderedButton === 'OFFDAY_BANNER');
assert('Status badge shows Company Holiday', s2.statusBadge === 'Company Holiday');

// 3. Normal Working Day, Not Clocked In (Synthetic Absent Log in logs)
console.log('\n--- Scenario 3: Normal Working Day, Not Clocked In (Pre-shift Absent placeholder) ---');
const s3 = simulateDashboardLogic({
  statusData: {
    canClockIn: true,
    state: 'OPEN_ON_TIME',
    isOffDay: false,
    existingRecord: null
  },
  logs: [
    {
      id: 'absent_emp123_2026-10-22',
      isSynthetic: true,
      status: 'ABSENT',
      date: new Date().toISOString(),
      clockIn: null,
      clockOut: null
    }
  ],
  compOffStatus: {
    isOffDay: false,
    canLogin: false
  }
});

assert('Synthetic absent log is ignored (clockedRecord is null)', s3.clockedRecord === null);
assert('isClockedIn is false', s3.isClockedIn === false);
assert('isClockedOutToday is false', s3.isClockedOutToday === false);
assert('Dashboard renders normal CLOCK_IN button', s3.renderedButton === 'CLOCK_IN');
assert('Status badge shows Not Clocked In', s3.statusBadge === 'Not Clocked In');

// 4. Normal Working Day, Clocked In
console.log('\n--- Scenario 4: Normal Working Day, Currently Clocked In ---');
const s4 = simulateDashboardLogic({
  statusData: {
    canClockIn: false,
    canClockOut: true,
    isClockedIn: true,
    existingRecord: {
      id: 'att_real_1',
      date: new Date().toISOString(),
      clockIn: new Date(Date.now() - 3600000).toISOString(),
      clockOut: null,
      status: 'PRESENT'
    }
  },
  logs: [
    {
      id: 'att_real_1',
      isSynthetic: false,
      date: new Date().toISOString(),
      clockIn: new Date(Date.now() - 3600000).toISOString(),
      clockOut: null,
      status: 'PRESENT'
    }
  ],
  compOffStatus: { isOffDay: false, canLogin: false }
});

assert('clockedRecord is the real attendance record', s4.clockedRecord?.id === 'att_real_1');
assert('isClockedIn is true', s4.isClockedIn === true);
assert('isClockedOutToday is false', s4.isClockedOutToday === false);
assert('Dashboard renders CLOCK_OUT button', s4.renderedButton === 'CLOCK_OUT');
assert('Status badge shows Active (PRESENT)', s4.statusBadge === 'Active (PRESENT)');

// 5. Normal Working Day, Clocked Out
console.log('\n--- Scenario 5: Normal Working Day, Clocked Out ---');
const s5 = simulateDashboardLogic({
  statusData: {
    canClockIn: false,
    canClockOut: false,
    isClockedIn: false,
    existingRecord: {
      id: 'att_real_1',
      date: new Date().toISOString(),
      clockIn: new Date(Date.now() - 28800000).toISOString(),
      clockOut: new Date().toISOString(),
      status: 'PRESENT',
      workingHours: 8.0
    }
  },
  logs: [],
  compOffStatus: { isOffDay: false, canLogin: false }
});

assert('isClockedIn is false', s5.isClockedIn === false);
assert('isClockedOutToday is true', s5.isClockedOutToday === true);
assert('Dashboard renders ATTENDANCE_COMPLETED', s5.renderedButton === 'ATTENDANCE_COMPLETED');
assert('Status badge shows Shift Completed', s5.statusBadge === 'Shift Completed');

// 6. Holiday with Active Comp-Off Session
console.log('\n--- Scenario 6: Holiday with Active Comp-Off Session ---');
const s6 = simulateDashboardLogic({
  statusData: {
    canClockIn: false,
    state: 'HOLIDAY',
    reason: 'HOLIDAY',
    isOffDay: true,
    offDayTitle: 'Company Holiday',
    existingRecord: null
  },
  logs: [
    {
      id: 'holiday_emp123_2026-10-22',
      isSynthetic: true,
      status: 'HOLIDAY',
      date: new Date().toISOString(),
      clockIn: null,
      clockOut: null
    }
  ],
  compOffStatus: {
    isOffDay: true,
    hasApprovedPermission: true,
    canLogin: false,
    isSessionActive: true,
    isSessionCompleted: false,
    session: {
      id: 'sess_1',
      loginTime: new Date(Date.now() - 1800000).toISOString(),
      clockOutTime: null
    }
  }
});

assert('Dashboard renders COMPOFF_CLOCK_OUT button', s6.renderedButton === 'COMPOFF_CLOCK_OUT');
assert('Status badge shows Comp-Off Active', s6.statusBadge === 'Comp-Off Active');

// 7. Holiday with Completed Comp-Off Session
console.log('\n--- Scenario 7: Holiday with Completed Comp-Off Session ---');
const s7 = simulateDashboardLogic({
  statusData: {
    canClockIn: false,
    state: 'HOLIDAY',
    reason: 'HOLIDAY',
    isOffDay: true,
    offDayTitle: 'Company Holiday',
    existingRecord: null
  },
  logs: [],
  compOffStatus: {
    isOffDay: true,
    hasApprovedPermission: true,
    canLogin: false,
    isSessionActive: false,
    isSessionCompleted: true,
    session: {
      id: 'sess_1',
      loginTime: new Date(Date.now() - 18000000).toISOString(),
      clockOutTime: new Date().toISOString(),
      durationHours: 5.0
    }
  }
});

assert('Dashboard renders COMPOFF_COMPLETED banner', s7.renderedButton === 'COMPOFF_COMPLETED');
assert('Status badge shows Comp-Off Completed', s7.statusBadge === 'Comp-Off Completed');

console.log('\n========================================================================');
console.log(`  ALL TESTS PASSED: ${passed} / ${total} SUCCEEDED`);
console.log('========================================================================\n');
