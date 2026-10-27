const prisma = require('./db');

/**
 * Previews the next Estimate Number for an organization without consuming or incrementing the sequence.
 *
 * @param {string} orgId
 * @returns {Promise<string>} Next preview number, e.g. "EST-001001"
 */
async function previewNextEstimateNumber(orgId) {
  if (!orgId) {
    const count = await prisma.assetEstimate.count({ where: { organizationId: null } });
    return `EST-${String(1001 + count).padStart(6, '0')}`;
  }

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { estimatePrefix: true, estimateSequence: true }
  });

  const prefix = (org?.estimatePrefix || 'EST').toUpperCase().trim();
  const nextSeq = (org?.estimateSequence || 1000) + 1;

  return `${prefix}-${String(nextSeq).padStart(6, '0')}`;
}

/**
 * Concurrency-safe atomic generation of the next unique Estimate Number for an organization.
 * Increments organization.estimateSequence inside the provided transaction client.
 *
 * @param {string} orgId
 * @param {object} tx - Prisma transaction client
 * @returns {Promise<string>} Generated unique Estimate Number (e.g. "EST-001001")
 */
async function generateNextEstimateNumber(orgId, tx = prisma) {
  if (!orgId) {
    // For non-org fallback
    const count = await tx.assetEstimate.count({ where: { organizationId: null } });
    let seq = 1001 + count;
    let candidate = `EST-${String(seq).padStart(6, '0')}`;
    while (await tx.assetEstimate.findFirst({ where: { organizationId: null, estimateNumber: candidate } })) {
      seq++;
      candidate = `EST-${String(seq).padStart(6, '0')}`;
    }
    return candidate;
  }

  // Atomically increment estimateSequence on the organization
  const updatedOrg = await tx.organization.update({
    where: { id: orgId },
    data: { estimateSequence: { increment: 1 } },
    select: { estimatePrefix: true, estimateSequence: true }
  });

  const prefix = (updatedOrg.estimatePrefix || 'EST').toUpperCase().trim();
  let candidate = `${prefix}-${String(updatedOrg.estimateSequence).padStart(6, '0')}`;

  // Safety loop in the rare event that an estimate was previously inserted with this number
  while (await tx.assetEstimate.findFirst({ where: { organizationId: orgId, estimateNumber: candidate } })) {
    const reInc = await tx.organization.update({
      where: { id: orgId },
      data: { estimateSequence: { increment: 1 } },
      select: { estimatePrefix: true, estimateSequence: true }
    });
    candidate = `${prefix}-${String(reInc.estimateSequence).padStart(6, '0')}`;
  }

  return candidate;
}

module.exports = {
  previewNextEstimateNumber,
  generateNextEstimateNumber
};
