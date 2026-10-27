const prisma = require('../../backend/src/utils/db');

async function main() {
  try {
    // 1. Check meetingattendee orphans
    const maOrphans = await prisma.$queryRaw`
      SELECT ma.id, ma.meetingId, ma.userId, m.title
      FROM meetingattendee ma
      LEFT JOIN user u ON ma.userId = u.id
      LEFT JOIN meeting m ON ma.meetingId = m.id
      WHERE u.id IS NULL;
    `;
    console.log('=== Orphaned Meeting Attendees ===');
    console.log(maOrphans);

    // 2. Check compoffcredit orphans
    const ccOrphans = await prisma.$queryRaw`
      SELECT cc.id, cc.userId, cc.organizationId, cc.status
      FROM compoffcredit cc
      LEFT JOIN user u ON cc.userId = u.id
      WHERE u.id IS NULL;
    `;
    console.log('=== Orphaned CompOff Credits ===');
    console.log(ccOrphans);

    // 3. Check compoffconsumption orphans
    const cconOrphans = await prisma.$queryRaw`
      SELECT ccon.id, ccon.creditId, ccon.userId
      FROM compoffconsumption ccon
      LEFT JOIN user u ON ccon.userId = u.id
      WHERE u.id IS NULL;
    `;
    console.log('=== Orphaned CompOff Consumptions ===');
    console.log(cconOrphans);

    // 4. Check meetings hostId
    const mOrphans = await prisma.$queryRaw`
      SELECT m.id, m.title, m.hostId
      FROM meeting m
      LEFT JOIN user u ON m.hostId = u.id
      WHERE u.id IS NULL;
    `;
    console.log('=== Orphaned Meeting HostId ===', mOrphans);

    // 5. Check company documents uploadedById
    const docOrphans = await prisma.$queryRaw`
      SELECT cd.id, cd.title, cd.uploadedById
      FROM companydocument cd
      LEFT JOIN user u ON cd.uploadedById = u.id
      WHERE cd.uploadedById IS NOT NULL AND u.id IS NULL;
    `;
    console.log('=== Orphaned Company Document UploadedById ===', docOrphans);

    // 6. Check asset estimate createdById
    const estOrphans = await prisma.$queryRaw`
      SELECT ae.id, ae.estimateNumber, ae.createdById
      FROM assetestimate ae
      LEFT JOIN user u ON ae.createdById = u.id
      WHERE ae.createdById IS NOT NULL AND u.id IS NULL;
    `;
    console.log('=== Orphaned Asset Estimate CreatedById ===', estOrphans);
  } catch (err) {
    console.error('Fatal error:', err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
