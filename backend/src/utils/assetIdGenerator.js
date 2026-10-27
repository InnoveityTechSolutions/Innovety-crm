const prisma = require('./db');

const LEGAL_ENTITY_WORDS = new Set([
  'PVT', 'PRIVATE',
  'LTD', 'LIMITED',
  'LLP',
  'INC', 'INCORPORATED',
  'LLC',
  'GMBH',
  'PLC'
]);

/**
 * Normalizes an organization name and generates a unique, readable short-form prefix.
 *
 * Examples:
 * - MRF Innovation -> MRFI
 * - MRF Corporation -> MRFC
 * - MRF Technologies -> MRFT
 * - InnovEity Technologies -> INNT
 * - ABC Solutions -> ABCS
 *
 * Collision Handling:
 * - Extends deterministically using subsequent characters from distinguishing word(s).
 * - Does NOT use numbers to distinguish companies.
 *
 * @param {string} companyName
 * @param {Set<string>} existingPrefixes
 * @returns {string} Unique uppercase prefix
 */
function generateCompanyPrefix(companyName, existingPrefixes = new Set()) {
  if (!companyName || typeof companyName !== 'string') {
    return 'AST';
  }

  // 1. Normalize and extract words
  const rawWords = companyName
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (rawWords.length === 0) return 'AST';

  // 2. Filter legal entity words, preserve meaningful/descriptive words
  let meaningfulWords = rawWords.filter(w => !LEGAL_ENTITY_WORDS.has(w));
  if (meaningfulWords.length === 0) {
    meaningfulWords = rawWords;
  }

  // 3. Base prefix generation
  let base = '';
  if (meaningfulWords.length === 1) {
    const w = meaningfulWords[0];
    base = w.length <= 4 ? w : w.slice(0, 4);
  } else if (meaningfulWords.length === 2) {
    const [first, second] = meaningfulWords;
    // If first word is a short acronym/word (<= 3 chars, e.g. MRF, ABC):
    if (first.length <= 3) {
      base = first + second[0];
    } else {
      // e.g. InnovEity Technologies -> INN + T = INNT
      base = first.slice(0, 3) + second[0];
    }
  } else {
    // 3 or more words
    const first = meaningfulWords[0];
    if (first.length <= 3) {
      // e.g. MRF Global Solutions -> MRF + G + S = MRFGS
      base = first + meaningfulWords.slice(1).map(w => w[0]).join('');
    } else {
      base = meaningfulWords.map(w => w[0]).join('');
      if (base.length < 4) {
        base = first.slice(0, 4 - base.length + 1) + meaningfulWords.slice(1).map(w => w[0]).join('');
      }
    }
  }

  // Ensure minimum length of 3
  if (base.length < 3) {
    const padSource = meaningfulWords.join('');
    base = padSource.slice(0, Math.min(3, padSource.length)).padEnd(3, 'X');
  }

  // Return base if unique
  if (!existingPrefixes.has(base)) {
    return base;
  }

  // 4. Deterministic collision resolution
  // Extend using characters from the distinguishing word (last meaningful word)
  const distWord = meaningfulWords.length > 1
    ? meaningfulWords[meaningfulWords.length - 1]
    : meaningfulWords[0];

  for (let i = 1; i < distWord.length; i++) {
    const candidate = base + distWord[i];
    if (!existingPrefixes.has(candidate)) {
      return candidate;
    }
  }

  // Try extending using characters from the first word
  const firstWord = meaningfulWords[0];
  for (let i = 1; i < firstWord.length; i++) {
    const candidate = base + firstWord[i];
    if (!existingPrefixes.has(candidate)) {
      return candidate;
    }
  }

  // Additional deterministic letters fallback
  for (let charCode = 65; charCode <= 90; charCode++) {
    const candidate = base + String.fromCharCode(charCode);
    if (!existingPrefixes.has(candidate)) {
      return candidate;
    }
  }

  let counter = 1;
  while (existingPrefixes.has(`${base}${counter}`)) {
    counter++;
  }
  return `${base}${counter}`;
}

/**
 * Gets or initializes the permanent assetPrefix and assetSequence for an organization.
 * Uses the saved Organization.companyCode as the asset prefix.
 *
 * @param {string} orgId
 * @param {object} client - Prisma Client or Transaction instance
 * @returns {Promise<{ prefix: string, sequence: number }>}
 */
async function getOrInitOrgAssetPrefix(orgId, client = prisma) {
  if (!orgId) {
    return { prefix: 'AST', sequence: 1000 };
  }

  const org = await client.organization.findUnique({
    where: { id: orgId },
    select: { id: true, name: true, companyCode: true, assetPrefix: true, assetSequence: true }
  });

  if (!org) {
    return { prefix: 'AST', sequence: 1000 };
  }

  // Use the verified, unique companyCode as the prefix
  const targetPrefix = org.companyCode ? org.companyCode.trim().toUpperCase() : 'AST';

  // If assetPrefix matches companyCode, return current state
  if (org.assetPrefix === targetPrefix) {
    return { prefix: org.assetPrefix, sequence: org.assetSequence };
  }

  // Check if any existing assets for this org have sequential IDs with this prefix
  const existingAssets = await client.asset.findMany({
    where: {
      organizationId: orgId,
      assetId: { startsWith: `${targetPrefix}-` }
    },
    select: { assetId: true }
  });

  let maxSeq = 1000;
  for (const a of existingAssets) {
    const parts = a.assetId.split('-');
    if (parts.length >= 2) {
      const num = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(num) && num > maxSeq) {
        maxSeq = num;
      }
    }
  }

  const updatedOrg = await client.organization.update({
    where: { id: orgId },
    data: {
      assetPrefix: targetPrefix,
      assetSequence: maxSeq
    },
    select: { assetPrefix: true, assetSequence: true }
  });

  return { prefix: updatedOrg.assetPrefix, sequence: updatedOrg.assetSequence };
}

/**
 * Atomically generates the next unique Asset ID for a single asset.
 * Concurrency-safe: utilizes atomic update on organization.assetSequence.
 *
 * @param {string} orgId
 * @param {object} tx - Prisma transaction client
 * @returns {Promise<string>} Next unique Asset ID (e.g. "MRFI-1001")
 */
async function generateNextAssetId(orgId, tx = prisma) {
  if (!orgId) {
    const count = await tx.asset.count({ where: { organizationId: null } });
    let number = 1001 + count;
    let candidate = `AST-${number}`;
    while (await tx.asset.findUnique({ where: { assetId: candidate } })) {
      number++;
      candidate = `AST-${number}`;
    }
    return candidate;
  }

  // Ensure prefix is initialized
  await getOrInitOrgAssetPrefix(orgId, tx);

  // Atomically increment sequence
  const updatedOrg = await tx.organization.update({
    where: { id: orgId },
    data: { assetSequence: { increment: 1 } },
    select: { assetPrefix: true, assetSequence: true }
  });

  let nextSeq = updatedOrg.assetSequence;
  let candidateId = `${updatedOrg.assetPrefix}-${nextSeq}`;

  // Extra safety check in case manual/legacy record used this ID
  while (await tx.asset.findUnique({ where: { assetId: candidateId } })) {
    const bumped = await tx.organization.update({
      where: { id: orgId },
      data: { assetSequence: { increment: 1 } },
      select: { assetPrefix: true, assetSequence: true }
    });
    nextSeq = bumped.assetSequence;
    candidateId = `${bumped.assetPrefix}-${nextSeq}`;
  }

  return candidateId;
}

/**
 * Atomically reserves a batch of sequential Asset IDs for bulk asset creation.
 *
 * @param {string} orgId
 * @param {number} quantity
 * @param {object} [tx] - Optional Prisma transaction client
 * @returns {Promise<string[]>} Array of reserved Asset IDs
 */
async function generateNextAssetIds(orgId, quantity, tx = prisma) {
  if (!orgId) {
    const baseCount = await tx.asset.count({ where: { organizationId: null } });
    const ids = [];
    for (let i = 0; i < quantity; i++) {
      let num = 1001 + baseCount + i;
      let candidate = `AST-${num}`;
      while (await tx.asset.findUnique({ where: { assetId: candidate } }) || ids.includes(candidate)) {
        num++;
        candidate = `AST-${num}`;
      }
      ids.push(candidate);
    }
    return ids;
  }

  // Ensure prefix is initialized
  await getOrInitOrgAssetPrefix(orgId, tx);

  const updatedOrg = await tx.organization.update({
    where: { id: orgId },
    data: { assetSequence: { increment: quantity } },
    select: { assetPrefix: true, assetSequence: true }
  });

  const prefix = updatedOrg.assetPrefix;
  const endSeq = updatedOrg.assetSequence;
  const startSeq = endSeq - quantity + 1;

  const reservedIds = [];
  for (let s = startSeq; s <= endSeq; s++) {
    reservedIds.push(`${prefix}-${s}`);
  }

  // Check if any collide with existing assets; if so, resolve individually
  const existingCollisions = await tx.asset.findMany({
    where: { assetId: { in: reservedIds } },
    select: { assetId: true }
  });

  if (existingCollisions.length === 0) {
    return reservedIds;
  }

  // If there are collisions from legacy data, safely generate one by one
  const safeIds = [];
  for (let i = 0; i < quantity; i++) {
    const id = await generateNextAssetId(orgId, tx);
    safeIds.push(id);
  }
  return safeIds;
}

/**
 * Preview the next Asset ID for an organization without incrementing.
 *
 * @param {string} orgId
 * @returns {Promise<string>} Next Asset ID preview (e.g. "MRFI-1001")
 */
async function previewNextAssetId(orgId) {
  if (!orgId) {
    const count = await prisma.asset.count({ where: { organizationId: null } });
    return `AST-${1001 + count}`;
  }

  const { prefix, sequence } = await getOrInitOrgAssetPrefix(orgId, prisma);
  return `${prefix}-${sequence + 1}`;
}

module.exports = {
  generateCompanyPrefix,
  getOrInitOrgAssetPrefix,
  generateNextAssetId,
  generateNextAssetIds,
  previewNextAssetId
};
