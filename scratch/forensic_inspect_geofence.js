const { PrismaClient } = require('../backend/node_modules/@prisma/client');
const prisma = new PrismaClient();

async function inspect() {
  console.log('=== FORENSIC DATABASE INSPECTION ===\n');

  // 1. Organizations
  console.log('--- 1. ORGANIZATIONS ---');
  const orgs = await prisma.organization.findMany({
    select: { id: true, name: true, slug: true, companyCode: true }
  });
  console.log(JSON.stringify(orgs, null, 2));

  // 2. SystemSettings (Legacy geofence fields)
  console.log('\n--- 2. SYSTEM SETTINGS FULL ---');
  const settings = await prisma.systemSettings.findMany();
  console.log(JSON.stringify(settings, null, 2));

  console.log('\n--- 2b. ORGANIZATION SETTINGS FULL ---');
  const orgSettings = await prisma.organizationSettings.findMany();
  console.log(JSON.stringify(orgSettings, null, 2));

  // 3. AttendanceLocation records
  console.log('\n--- 3. ATTENDANCE LOCATIONS ---');
  const locations = await prisma.attendanceLocation.findMany({
    include: {
      organization: { select: { id: true, name: true, slug: true } },
      _count: { select: { assignedUsers: true, attendances: true } }
    }
  });
  console.log(`Total AttendanceLocation records in DB: ${locations.length}`);
  console.log(JSON.stringify(locations, null, 2));

  // 4. Check users & their organization
  console.log('\n--- 4. KEY USERS & ORG ASSIGNMENTS ---');
  const users = await prisma.user.findMany({
    where: {
      role: { in: ['ADMIN', 'SUPER_ADMIN'] }
    },
    select: {
      id: true,
      email: true,
      role: true,
      organizationId: true,
      organization: { select: { id: true, name: true, slug: true } }
    }
  });
  console.log(JSON.stringify(users, null, 2));

  // 5. Total UserAttendanceLocations
  const userLocs = await prisma.userAttendanceLocation.findMany();
  console.log(`\nTotal UserAttendanceLocation records: ${userLocs.length}`);

  // 6. Inspect all tables in DB
  console.log('\n--- 5. ALL TABLES IN DATABASE ---');
  const tables = await prisma.$queryRawUnsafe(`
    SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE()
  `);
  console.log(tables.map(t => t.TABLE_NAME || Object.values(t)[0]));

  // 7. Check attendance records with locations
  console.log('\n--- 6. PAST ATTENDANCE RECORDS LOCATION SUMMARY ---');
  const pastAttendances = await prisma.attendance.findMany({
    where: {
      workLocation: 'OFFICE'
    },
    take: 10,
    orderBy: { date: 'desc' },
    select: {
      id: true,
      userId: true,
      clockInLocation: true,
      clockOutLocation: true,
      attendanceLocationId: true,
      date: true
    }
  });
  console.log(JSON.stringify(pastAttendances, null, 2));

  await prisma.$disconnect();
}

inspect().catch(err => {
  console.error('Inspection error:', err);
  process.exit(1);
});
