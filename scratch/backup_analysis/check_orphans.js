const { PrismaClient } = require('../../backend/node_modules/@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('=== CHECKING MEETING ATTENDEES & COMP-OFF ERRORS ===\n');

  // 1. Meeting attendees
  const attendees = await prisma.$queryRawUnsafe('SELECT * FROM meetingattendee');
  console.log(`Total Meeting Attendees: ${attendees.length}`);
  for (const a of attendees) {
    const user = await prisma.user.findUnique({ where: { id: a.userId }, select: { id: true, name: true, email: true } });
    console.log(`Attendee [${a.id}]: User ID ${a.userId} -> ${user ? user.name : 'MISSING (NULL)!'}`);
  }

  // Also check Meeting organizers
  const meetings = await prisma.$queryRawUnsafe('SELECT * FROM meeting');
  console.log(`\nTotal Meetings: ${meetings.length}`);
  for (const m of meetings) {
    const organizer = await prisma.user.findUnique({ where: { id: m.organizerId }, select: { id: true, name: true, email: true } });
    console.log(`Meeting [${m.id}] "${m.title}": Organizer ID ${m.organizerId} -> ${organizer ? organizer.name : 'MISSING!'}`);
  }

  // 3. Check all user foreign keys across the 14 tables
  console.log('\n--- Checking all tables for missing User IDs ---');
  const tablesToCheck = [
    { tbl: 'userattendancelocation', col: 'userId' },
    { tbl: 'meetingattendee', col: 'userId' },
    { tbl: 'meetingreport', col: 'authorId' },
    { tbl: 'compoffcredit', col: 'userId' },
    { tbl: 'compoffconsumption', col: 'userId' },
    { tbl: 'compoffpermissionrequest', col: 'userId' },
    { tbl: 'compoffsession', col: 'userId' },
    { tbl: 'companydocument', col: 'uploadedById' },
    { tbl: 'assetestimate', col: 'createdById' }
  ];

  for (const t of tablesToCheck) {
    const rows = await prisma.$queryRawUnsafe(`SELECT DISTINCT \`${t.col}\` as uid FROM \`${t.tbl}\` WHERE \`${t.col}\` IS NOT NULL`);
    const missing = [];
    for (const r of rows) {
      const u = await prisma.user.findUnique({ where: { id: r.uid } });
      if (!u) missing.push(r.uid);
    }
    if (missing.length > 0) {
      console.log(`  Table \`${t.tbl}.${t.col}\`: ${missing.length} orphaned IDs -> ${missing.join(', ')}`);
    } else {
      console.log(`  Table \`${t.tbl}.${t.col}\`: OK (All IDs valid)`);
    }
  }

  await prisma.$disconnect();
}

main().catch(console.error);
