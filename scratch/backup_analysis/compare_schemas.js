const fs = require('fs');
const path = require('path');
const JSZip = require('../../backend/node_modules/jszip');

async function main() {
  console.log('=== Step 1: Loading Backup Info & Dump ===');
  const backupZipPath = path.resolve(__dirname, '../../backend/backups/restored_backup_2026-10-23_17-00.zip');
  const data = fs.readFileSync(backupZipPath);
  const zip = await JSZip.loadAsync(data);

  const backupInfoRaw = await zip.file('backup_info.json').async('string');
  const backupInfo = JSON.parse(backupInfoRaw);
  const sqlDump = await zip.file('database/innoveity_live.sql').async('string');

  console.log(`Backup contains ${backupInfo.tablesList.length} tables in backup_info.json.`);
  console.log(`SQL Dump size: ${(sqlDump.length / 1024).toFixed(1)} KB`);

  // Parse all CREATE TABLE in SQL Dump
  const sqlTables = {};
  const createTableRegex = /CREATE TABLE `([^`]+)` \(([\s\S]*?)\) ENGINE=/gi;
  let m;
  while ((m = createTableRegex.exec(sqlDump)) !== null) {
    const tableName = m[1];
    const tableBody = m[2];
    
    // Parse columns
    const columns = [];
    const lines = tableBody.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    for (const line of lines) {
      if (line.startsWith('`')) {
        const colMatch = line.match(/^`([^`]+)`\s+([^\s,]+(?:\([^)]+\))?)/);
        if (colMatch) {
          columns.push({
            name: colMatch[1],
            type: colMatch[2],
            raw: line.replace(/,$/, '')
          });
        }
      }
    }
    sqlTables[tableName.toLowerCase()] = {
      tableName,
      columns,
      rawBody: tableBody
    };
  }

  console.log(`Parsed ${Object.keys(sqlTables).length} tables from innoveity_live.sql.`);

  // Parse Prisma Schema
  const prismaSchemaPath = path.resolve(__dirname, '../../backend/prisma/schema.prisma');
  const prismaContent = fs.readFileSync(prismaSchemaPath, 'utf8');

  // Parse models
  const prismaModels = {};
  // Match model Blocks
  const lines = prismaContent.split('\n');
  let currentModel = null;
  let currentFields = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('model ')) {
      const match = line.match(/^model\s+(\w+)\s+\{/);
      if (match) {
        currentModel = match[1];
        currentFields = [];
      }
    } else if (currentModel) {
      if (line === '}' || line.startsWith('}')) {
        // Find @@map if any
        let mappedTable = currentModel.toLowerCase();
        for (const f of currentFields) {
          if (f.raw.startsWith('@@map(')) {
            const mapMatch = f.raw.match(/@@map\("([^"]+)"\)/);
            if (mapMatch) mappedTable = mapMatch[1].toLowerCase();
          }
        }
        prismaModels[mappedTable] = {
          modelName: currentModel,
          tableName: mappedTable,
          fields: currentFields.filter(f => !f.raw.startsWith('@@'))
        };
        currentModel = null;
      } else if (line.length > 0 && !line.startsWith('//')) {
        // Field definition
        const parts = line.split(/\s+/);
        if (parts.length >= 2 && !parts[0].startsWith('@@')) {
          const fieldName = parts[0];
          const fieldType = parts[1];
          // Check for @map("colName")
          let dbColName = fieldName;
          const colMapMatch = line.match(/@map\("([^"]+)"\)/);
          if (colMapMatch) dbColName = colMapMatch[1];

          currentFields.push({
            fieldName,
            dbColName,
            fieldType,
            raw: line
          });
        } else if (parts[0].startsWith('@@')) {
          currentFields.push({ raw: line });
        }
      }
    }
  }

  console.log(`Parsed ${Object.keys(prismaModels).length} models from schema.prisma.`);

  // Compare tables
  const missingTablesInBackup = [];
  const existingTablesInBackup = [];

  for (const [tableKey, pModel] of Object.entries(prismaModels)) {
    if (!sqlTables[tableKey]) {
      missingTablesInBackup.push({
        modelName: pModel.modelName,
        tableName: pModel.tableName
      });
    } else {
      existingTablesInBackup.push(tableKey);
    }
  }

  console.log('\n=== TABLES IN PRISMA BUT MISSING IN BACKUP (' + missingTablesInBackup.length + ') ===');
  console.log(JSON.stringify(missingTablesInBackup, null, 2));

  // For existing tables, check column discrepancies
  const columnMismatches = [];
  for (const tableKey of existingTablesInBackup) {
    const pModel = prismaModels[tableKey];
    const sTable = sqlTables[tableKey];
    const sqlColNames = new Set(sTable.columns.map(c => c.name.toLowerCase()));

    // Find scalar/relation fields in Prisma that map to real db columns
    // We filter out purely relational virtual fields (e.g. user User @relation(...))
    for (const f of pModel.fields) {
      // If it's a relation with no foreign key representation, Prisma doesn't create a column unless it's a scalar FK
      // We check if fieldType is another model or enum or primitive
      const isPrimitive = ['String', 'Int', 'Float', 'Boolean', 'DateTime', 'Json', 'Decimal', 'Bytes'].some(t => f.fieldType.startsWith(t));
      // If it's not primitive, check if it's an enum or relation
      // In Prisma, scalar FKs are primitive (e.g. userId String).
      // So if it's primitive or has @default / @map, it should exist in SQL.
      if (isPrimitive) {
        if (!sqlColNames.has(f.dbColName.toLowerCase())) {
          columnMismatches.push({
            modelName: pModel.modelName,
            tableName: pModel.tableName,
            missingColumn: f.dbColName,
            prismaField: f.fieldName,
            type: f.fieldType,
            raw: f.raw
          });
        }
      }
    }
  }

  console.log('\n=== COLUMNS IN PRISMA BUT MISSING IN BACKUP (' + columnMismatches.length + ') ===');
  console.log(JSON.stringify(columnMismatches, null, 2));

  // Check enums
  const enumRegex = /enum\s+(\w+)\s+\{([^}]+)\}/g;
  const prismaEnums = {};
  let em;
  while ((em = enumRegex.exec(prismaContent)) !== null) {
    const enumName = em[1];
    const values = em[2].split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('//'));
    prismaEnums[enumName] = values;
  }
  console.log(`\nParsed ${Object.keys(prismaEnums).length} Enums from schema.prisma.`);

  // Write detailed findings to a JSON file for deep analysis
  fs.writeFileSync(
    path.resolve(__dirname, 'detailed_schema_diff.json'),
    JSON.stringify({
      backupInfo,
      missingTablesInBackup,
      columnMismatches,
      prismaEnums
    }, null, 2)
  );
  console.log('\nSaved detailed analysis to scratch/backup_analysis/detailed_schema_diff.json');
}

main().catch(console.error);
