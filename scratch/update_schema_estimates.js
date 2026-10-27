const fs = require('fs');
const path = require('path');

const schemaPath = path.join(__dirname, '../backend/prisma/schema.prisma');
let content = fs.readFileSync(schemaPath, 'utf8');

const target = '  assetSequence      Int                   @default(1000)\r\n';
const addition = `  estimatePrefix     String?               @default("EST")\r\n  estimateSequence   Int                   @default(1000)\r\n  gstin              String?\r\n  city               String?\r\n  state              String?\r\n  pincode            String?\r\n  country            String?               @default("India")\r\n  bankName           String?\r\n  bankIfsc           String?\r\n  bankAccountNo      String?\r\n  bankBranch         String?\r\n  signatureImage     String?\r\n  signatoryTitle     String?               @default("Authorized Signatory")\r\n`;

if (!content.includes('estimatePrefix')) {
  content = content.replace(target, target + addition);
  fs.writeFileSync(schemaPath, content, 'utf8');
  console.log('Successfully added estimatePrefix and billing fields to Organization!');
} else {
  console.log('estimatePrefix already present in schema.');
}
