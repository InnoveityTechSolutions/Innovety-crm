const fs = require('fs');
const path = require('path');

const schemaPath = path.join(__dirname, '../backend/prisma/schema.prisma');
let content = fs.readFileSync(schemaPath, 'utf8');

const targetStr = `  signatureImage     String?
  signatoryTitle     String?            @default("Authorized Signature")

  createdAt          DateTime           @default(now())
  updatedAt          DateTime           @updatedAt

  organization       Organization?      @relation(fields: [organizationId], references: [id], onDelete: SetNull)
  items              AssetEstimateItem[]

  @@unique([organizationId, estimateNumber])
  @@index([organizationId])
  @@index([estimateNumber])
  @@map("assetestimate")`;

const replacementStr = `  signatureImage     String?
  signatoryTitle     String?            @default("Authorized Signature")

  // Cancellation metadata
  cancelledAt        DateTime?
  cancelledById      String?
  cancellationReason String?            @db.Text

  createdAt          DateTime           @default(now())
  updatedAt          DateTime           @updatedAt

  organization       Organization?      @relation(fields: [organizationId], references: [id], onDelete: SetNull)
  items              AssetEstimateItem[]

  @@unique([organizationId, estimateNumber])
  @@index([organizationId])
  @@index([estimateNumber])
  @@index([organizationId, createdAt])
  @@index([organizationId, status])
  @@index([organizationId, estimateDate])
  @@index([organizationId, billToName])
  @@map("assetestimate")`;

// Normalize matching by handling both CRLF and LF
const normTarget = targetStr.replace(/\r\n/g, '\n');
const normContent = content.replace(/\r\n/g, '\n');

if (normContent.includes(normTarget)) {
  const normReplacement = replacementStr.replace(/\r\n/g, '\n');
  const updatedNorm = normContent.replace(normTarget, normReplacement);
  // Preserve CRLF if original had CRLF
  const finalContent = content.includes('\r\n') ? updatedNorm.replace(/\n/g, '\r\n') : updatedNorm;
  fs.writeFileSync(schemaPath, finalContent, 'utf8');
  console.log('Successfully updated schema.prisma with Stage 2 fields and indexes.');
} else {
  console.error('Target string not found in schema.prisma');
  process.exit(1);
}
