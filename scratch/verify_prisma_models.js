const path = require('path');
module.paths.push(path.resolve(__dirname, '..', 'backend', 'node_modules'));
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  console.log('p.meeting type:', typeof prisma.meeting);
  console.log('p.meetingAttendee type:', typeof prisma.meetingAttendee);
  console.log('p.meetingReport type:', typeof prisma.meetingReport);

  const meetingCount = await prisma.meeting.count();
  const attendeeCount = await prisma.meetingAttendee.count();
  const reportCount = await prisma.meetingReport.count();

  console.log('Counts in DB:');
  console.log('  meeting count:', meetingCount);
  console.log('  meetingAttendee count:', attendeeCount);
  console.log('  meetingReport count:', reportCount);

  await prisma.$disconnect();
}

check().catch(console.error);
