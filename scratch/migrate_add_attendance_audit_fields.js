const { PrismaClient } = require('../backend/node_modules/@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('=== Step 1: Checking existing columns in attendance table ===');
  
  const existingColsRaw = await prisma.$queryRawUnsafe(`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance';
  `);
  const existingCols = existingColsRaw.map(r => r.COLUMN_NAME);
  console.log('Found', existingCols.length, 'columns in attendance table.');

  const columnsToAdd = [
    { name: 'clockInLatitude', def: 'DOUBLE NULL' },
    { name: 'clockInLongitude', def: 'DOUBLE NULL' },
    { name: 'clockInAddress', def: 'TEXT NULL' },
    { name: 'clockOutLatitude', def: 'DOUBLE NULL' },
    { name: 'clockOutLongitude', def: 'DOUBLE NULL' },
    { name: 'clockOutAddress', def: 'TEXT NULL' },
    { name: 'clockOutWorkLocation', def: 'VARCHAR(191) NULL' },
    { name: 'clockOutWorkLocationOther', def: 'VARCHAR(191) NULL' }
  ];

  for (const col of columnsToAdd) {
    if (!existingCols.includes(col.name)) {
      console.log(`Adding column \`${col.name}\` (${col.def})...`);
      await prisma.$executeRawUnsafe(`ALTER TABLE \`attendance\` ADD COLUMN \`${col.name}\` ${col.def};`);
      console.log(`Column \`${col.name}\` added successfully.`);
    } else {
      console.log(`Column \`${col.name}\` already exists, skipping.`);
    }
  }

  console.log('\n=== Step 2: Backfilling coordinates from existing location strings ===');
  const rows = await prisma.$queryRawUnsafe(`
    SELECT id, clockInLocation, clockOutLocation, attendanceLocationId, workLocation
    FROM attendance
    WHERE (clockInLatitude IS NULL AND clockInLocation IS NOT NULL)
       OR (clockOutLatitude IS NULL AND clockOutLocation IS NOT NULL)
  `);

  console.log(`Found ${rows.length} rows eligible for coordinate backfill.`);
  let backfilledIn = 0;
  let backfilledOut = 0;

  for (const row of rows) {
    let updateFields = [];
    if (row.clockInLocation) {
      const matchIn = row.clockInLocation.match(/Lat:\s*([-\d.]+),\s*Lon:\s*([-\d.]+)/i);
      if (matchIn) {
        const lat = parseFloat(matchIn[1]);
        const lon = parseFloat(matchIn[2]);
        if (!isNaN(lat) && !isNaN(lon)) {
          updateFields.push(`clockInLatitude = ${lat}`, `clockInLongitude = ${lon}`);
          backfilledIn++;
        }
      }
    }

    if (row.clockOutLocation) {
      const matchOut = row.clockOutLocation.match(/Lat:\s*([-\d.]+),\s*Lon:\s*([-\d.]+)/i);
      if (matchOut) {
        const lat = parseFloat(matchOut[1]);
        const lon = parseFloat(matchOut[2]);
        if (!isNaN(lat) && !isNaN(lon)) {
          updateFields.push(`clockOutLatitude = ${lat}`, `clockOutLongitude = ${lon}`);
          backfilledOut++;
        }
      }
    }

    if (updateFields.length > 0) {
      await prisma.$executeRawUnsafe(`
        UPDATE attendance
        SET ${updateFields.join(', ')}
        WHERE id = '${row.id}';
      `);
    }
  }

  console.log(`Backfilled ${backfilledIn} clock-in coordinates and ${backfilledOut} clock-out coordinates.`);

  // Step 3: Backfill address from assigned attendance location where available
  console.log('\n=== Step 3: Backfilling addresses from assigned AttendanceLocation ===');
  await prisma.$executeRawUnsafe(`
    UPDATE attendance a
    JOIN attendancelocation al ON a.attendanceLocationId = al.id
    SET a.clockInAddress = al.address
    WHERE a.clockInAddress IS NULL AND al.address IS NOT NULL AND al.address != '';
  `);
  console.log('Address backfill completed.');

  console.log('\n=== Migration completed successfully! ===');
  await prisma.$disconnect();
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
