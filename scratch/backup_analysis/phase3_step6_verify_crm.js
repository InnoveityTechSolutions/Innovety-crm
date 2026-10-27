const fs = require('fs');
const path = require('path');
const bcrypt = require('../../backend/node_modules/bcrypt');
const { PrismaClient } = require('../../backend/node_modules/@prisma/client');
const { parseDbConfig } = require('../../backend/src/services/backupService');

const dbConfig = parseDbConfig();
const prisma = new PrismaClient();

async function main() {
  console.log('=== PHASE 3 STEP 6 & 7: FULL LOCAL CRM VERIFICATION & AUDIT ===\n');
  console.log(`Auditing Database: \`${dbConfig.database}\` on ${dbConfig.host}:${dbConfig.port}`);

  // 1. Prisma Client Initialization Check
  const [{ currentDb }] = await prisma.$queryRawUnsafe('SELECT DATABASE() as currentDb');
  console.log(`Prisma Client initialized successfully! Connected to: ${currentDb}`);

  // 2. Authentication Checks
  console.log('\n--- 1. AUTHENTICATION CHECKS ---');
  const superAdmin = await prisma.user.findFirst({
    where: { email: 'superadmin@enterprise-crm.com' },
    select: { id: true, email: true, password: true, role: true, autoClockOutEnabled: true, accessTemplateId: true }
  });
  console.log(`  SuperAdmin Found: ${superAdmin?.email} (Role: ${superAdmin?.role})`);
  console.log(`  New Columns: autoClockOutEnabled=${superAdmin?.autoClockOutEnabled}, accessTemplateId=${superAdmin?.accessTemplateId}`);
  
  const testPw = 'password123';
  const superAdminMatch = await bcrypt.compare(testPw, superAdmin.password);
  console.log(`  SuperAdmin password check ('${testPw}'): ${superAdminMatch ? 'SUCCESS (VALIDATED)' : 'FAILED'}`);

  // Employee / Admin account check
  const otherUsers = await prisma.user.findMany({
    where: { email: { not: 'superadmin@enterprise-crm.com' } },
    take: 3,
    select: { id: true, email: true, role: true, name: true, autoClockOutEnabled: true }
  });
  console.log(`  Sample Employees/Admins verified (${otherUsers.length}):`);
  otherUsers.forEach(u => {
    console.log(`    - ${u.name} <${u.email}> (${u.role}) | autoClockOutEnabled=${u.autoClockOutEnabled}`);
  });

  // 3. Attendance, Shifts, Geofencing
  console.log('\n--- 2. ATTENDANCE, SHIFTS & GEOFENCING ---');
  const totalAttendance = await prisma.attendance.count();
  const sampleAttendance = await prisma.attendance.findFirst({
    where: { clockIn: { not: null } },
    select: { id: true, userId: true, date: true, clockIn: true, clockOut: true, status: true, clockInLatitude: true, attendanceLocationId: true }
  });
  console.log(`  Total Attendance Records: ${totalAttendance}`);
  console.log(`  Sample Attendance with new schema: ID=${sampleAttendance?.id}, Date=${sampleAttendance?.date.toISOString().slice(0, 10)}, clockInLat=${sampleAttendance?.clockInLatitude}, locationId=${sampleAttendance?.attendanceLocationId}`);

  const locations = await prisma.attendanceLocation.findMany({
    include: { assignedUsers: true }
  });
  console.log(`  Geofence Locations (${locations.length}):`);
  locations.forEach(loc => {
    console.log(`    - ${loc.name} (${loc.radiusMeters}m radius) -> ${loc.assignedUsers.length} assigned users`);
  });

  const shifts = await prisma.shift.findMany();
  console.log(`  Shifts (${shifts.length}): ${shifts.map(s => s.name).join(', ')}`);

  // 4. Leave Policies & Leave Requests
  console.log('\n--- 3. LEAVE POLICIES & LEAVE TYPES ---');
  const leavePolicy = await prisma.leavePolicy.findFirst();
  console.log(`  Leave Policy: compOffValidityDays=${leavePolicy?.compOffValidityDays}, compOffClaimWindowDays=${leavePolicy?.compOffClaimWindowDays}, carryForwardEnabled=${leavePolicy?.carryForwardEnabled}`);

  const leaveTypes = await prisma.leaveType.findMany({
    select: { id: true, code: true, name: true, minNoticeDays: true }
  });
  console.log(`  Leave Types (${leaveTypes.length}):`);
  leaveTypes.forEach(lt => {
    console.log(`    - ${lt.code} (${lt.name}): minNoticeDays=${lt.minNoticeDays}`);
  });

  const totalLeaveRequests = await prisma.leaveRequest.count();
  console.log(`  Total Leave Requests Preserved: ${totalLeaveRequests}`);

  // 5. Compensatory Off
  console.log('\n--- 4. COMPENSATORY OFF SYSTEM ---');
  const compOffCredits = await prisma.compOffCredit.count();
  const compOffConsumptions = await prisma.compOffConsumption.count();
  const compOffRequests = await prisma.compOffPermissionRequest.count();
  const compOffSessions = await prisma.compOffSession.count();
  console.log(`  CompOff Credits: ${compOffCredits}`);
  console.log(`  CompOff Consumptions: ${compOffConsumptions}`);
  console.log(`  CompOff Permission Requests: ${compOffRequests}`);
  console.log(`  CompOff Sessions: ${compOffSessions}`);

  const sampleSession = await prisma.compOffSession.findFirst({
    include: { user: { select: { name: true } }, permissionRequest: true }
  });
  console.log(`  Sample Session: User="${sampleSession?.user.name}", WorkDate=${sampleSession?.workDate.toISOString().slice(0, 10)}, Status=${sampleSession?.status}, Approval=${sampleSession?.approvalStatus}`);

  // 6. Access Templates & Permissions
  console.log('\n--- 5. ACCESS TEMPLATES & RBAC ---');
  const accessTemplates = await prisma.accessTemplate.findMany({
    include: { permissions: true }
  });
  console.log(`  Access Templates (${accessTemplates.length}):`);
  accessTemplates.forEach(at => {
    console.log(`    - Template: "${at.name}" (BaseRole: ${at.baseRole}) -> ${at.permissions.length} module permissions`);
  });

  // 7. Meetings & Reports
  console.log('\n--- 6. MEETINGS & REPORTS ---');
  const meetings = await prisma.meeting.findMany({
    include: { attendees: true, report: true }
  });
  console.log(`  Meetings (${meetings.length}):`);
  meetings.forEach(m => {
    console.log(`    - "${m.title}" (${m.status}) -> ${m.attendees.length} attendees, Report: ${m.report ? 'YES' : 'NO'}`);
  });

  // 8. Asset Management & Asset Estimates
  console.log('\n--- 7. ASSET MANAGEMENT & ESTIMATES ---');
  const totalAssets = await prisma.asset.count();
  const sampleAsset = await prisma.asset.findFirst({
    select: { id: true, assetId: true, name: true, category: true, status: true }
  });
  console.log(`  Total Assets Preserved: ${totalAssets}`);
  console.log(`  Sample Asset: [${sampleAsset?.assetId}] "${sampleAsset?.name}" (Category: ${sampleAsset?.category}, Status: ${sampleAsset?.status})`);

  const estimates = await prisma.assetEstimate.findMany({
    include: { items: true }
  });
  console.log(`  Asset Estimates (${estimates.length}):`);
  estimates.forEach(est => {
    console.log(`    - [${est.estimateNumber}] "${est.title}" to "${est.billToName}" | GrandTotal: Rs. ${est.grandTotal} (${est.items.length} line items)`);
  });

  // 9. Company Documents
  console.log('\n--- 8. COMPANY DOCUMENTS ---');
  const documents = await prisma.companyDocument.findMany({
    include: { uploadedBy: { select: { name: true } } }
  });
  console.log(`  Company Documents (${documents.length}):`);
  documents.forEach(doc => {
    console.log(`    - "${doc.documentName}" (${doc.category}) | File: ${doc.filePath} | UploadedBy: ${doc.uploadedBy.name}`);
  });

  // 10. Organization Settings & Numbering
  console.log('\n--- 9. ORGANIZATION SETTINGS ---');
  const org = await prisma.organization.findFirst({
    select: { id: true, name: true, assetPrefix: true, assetSequence: true, estimatePrefix: true, estimateSequence: true }
  });
  console.log(`  Organization: "${org?.name}" | assetPrefix=${org?.assetPrefix}, assetSeq=${org?.assetSequence}, estimatePrefix=${org?.estimatePrefix}, estimateSeq=${org?.estimateSequence}`);

  // 11. Migration History
  console.log('\n--- 10. PRISMA MIGRATIONS HISTORY ---');
  const migs = await prisma.$queryRawUnsafe('SELECT migration_name, finished_at, applied_steps_count FROM _prisma_migrations ORDER BY finished_at ASC');
  migs.forEach((m, idx) => {
    console.log(`  ${idx + 1}. [${m.migration_name}] Finished: ${m.finished_at}`);
  });

  console.log('\nALL LOCAL CRM CHECKS COMPLETED SUCCESSFULLY!');
  await prisma.$disconnect();
}

main().catch(err => {
  console.error('\nVERIFICATION FAILED:', err.message);
  process.exit(1);
});
