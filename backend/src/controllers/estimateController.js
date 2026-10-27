const prisma = require('../utils/db');
const { getEffectiveOrgId, assertOrganizationAccess } = require('../utils/organizationScope');
const { logActivity } = require('../utils/activityLogger');
const { numberToWordsIndian } = require('../utils/numberToWordsIndian');
const { previewNextEstimateNumber, generateNextEstimateNumber } = require('../utils/estimateNumberGenerator');

// Default terms & conditions
const DEFAULT_TERMS = [
  '1. Delivery: 2 days against P.O',
  '2. Payment: 100% advance',
  '3. Taxes: As applicable',
  '4. Validity of Quote: 7 days only'
];

const DEFAULT_NOTES = 'Looking forward for your business.';

/**
 * Helper to round amounts cleanly to 2 decimal places.
 */
function round2(val) {
  return Math.round((Number(val) + Number.EPSILON) * 100) / 100;
}

/**
 * Calculates line items and taxes.
 */
function computeEstimateTotals({ items = [], taxRate = 18, companyState = '', placeOfSupply = '' }) {
  const normCompState = (companyState || '').trim().toLowerCase();
  const normSupplyState = (placeOfSupply || '').trim().toLowerCase();

  // If place of supply matches company state or is empty, it's Intra-state (CGST + SGST)
  // If different, it's Inter-state (IGST)
  const isIntraState = !normSupplyState || normCompState === normSupplyState || normSupplyState.includes(normCompState);

  const numTaxRate = Math.max(0, parseFloat(taxRate) || 0);
  const cgstRate = isIntraState ? round2(numTaxRate / 2) : 0;
  const sgstRate = isIntraState ? round2(numTaxRate / 2) : 0;
  const igstRate = !isIntraState ? round2(numTaxRate) : 0;

  let subTotal = 0;
  let totalCgst = 0;
  let totalSgst = 0;
  let totalIgst = 0;

  const processedItems = items.map((it, idx) => {
    const qty = Math.max(0.001, parseFloat(it.quantity) || 1);
    const rate = Math.max(0, parseFloat(it.rate) || 0);
    const itemAmount = round2(qty * rate);

    const itemCgst = round2((itemAmount * cgstRate) / 100);
    const itemSgst = round2((itemAmount * sgstRate) / 100);
    const itemIgst = round2((itemAmount * igstRate) / 100);

    subTotal = round2(subTotal + itemAmount);
    totalCgst = round2(totalCgst + itemCgst);
    totalSgst = round2(totalSgst + itemSgst);
    totalIgst = round2(totalIgst + itemIgst);

    return {
      assetId: it.assetId || null,
      itemIndex: idx + 1,
      title: (it.title || 'Item').trim(),
      description: (it.description || '').trim() || null,
      quantity: qty,
      unit: (it.unit || 'nos').trim(),
      rate: rate,
      cgstAmount: itemCgst,
      sgstAmount: itemSgst,
      igstAmount: itemIgst,
      amount: itemAmount
    };
  });

  const grandTotal = round2(subTotal + totalCgst + totalSgst + totalIgst);
  const totalInWords = numberToWordsIndian(grandTotal);

  return {
    processedItems,
    subTotal,
    cgstRate,
    sgstRate,
    igstRate,
    cgstAmount: totalCgst,
    sgstAmount: totalSgst,
    igstAmount: totalIgst,
    grandTotal,
    totalInWords
  };
}

/**
 * GET /api/assets/estimates/settings
 * Retrieves default billing & organization details for estimate generation.
 */
const getBillingSettings = async (req, res) => {
  try {
    const targetOrgId = getEffectiveOrgId(req);
    let org = null;
    if (targetOrgId) {
      org = await prisma.organization.findUnique({
        where: { id: targetOrgId },
        include: { settings: true }
      });
    }

    const nextEstimateNo = await previewNextEstimateNumber(targetOrgId);

    const companyAddress = org?.address || 'MCC - MFR Innovation Park, East Tambaram, Chennai 600059 Tamil Nadu, India';
    const companyCity = org?.city || 'Chennai';
    const companyState = org?.state || 'Tamil Nadu';
    const companyPincode = org?.pincode || '600059';
    const companyCountry = org?.country || 'India';
    const companyPhone = org?.phone || '+91 9094021161';
    const companyEmail = org?.email || 'contact@innoveity.com';
    const companyGstin = org?.gstin || '33ACFPN3295D2ZQ';
    const companyLogo = org?.logo || null;

    const bankName = org?.bankName || 'INDIAN BANK';
    const bankIfsc = org?.bankIfsc || 'IDIB000M126';
    const bankAccountNo = org?.bankAccountNo || '453691659';
    const bankBranch = org?.bankBranch || 'MADIPAKKAM';
    const signatoryTitle = org?.signatoryTitle || 'Authorized Signature';
    const signatureImage = org?.signatureImage || null;

    res.json({
      organizationId: targetOrgId,
      nextEstimateNumber: nextEstimateNo,
      company: {
        name: org?.name || 'Innoveity',
        address: companyAddress,
        city: companyCity,
        state: companyState,
        pincode: companyPincode,
        country: companyCountry,
        phone: companyPhone,
        email: companyEmail,
        website: org?.website || 'https://innoveity.tech',
        gstin: companyGstin,
        logo: companyLogo
      },
      banking: {
        bankName,
        bankIfsc,
        bankAccountNo,
        bankBranch
      },
      signatory: {
        title: signatoryTitle,
        signatureImage
      },
      defaultNotes: DEFAULT_NOTES,
      defaultTerms: DEFAULT_TERMS,
      defaultPlaceOfSupply: `${companyState} (33)`
    });
  } catch (error) {
    console.error('Get billing settings error:', error);
    res.status(500).json({ message: 'Failed to retrieve billing settings.' });
  }
};

/**
 * PUT /api/assets/estimates/settings
 * Updates organization billing defaults.
 */
const updateBillingSettings = async (req, res) => {
  try {
    const targetOrgId = getEffectiveOrgId(req);
    if (!targetOrgId) {
      return res.status(400).json({ message: 'Organization scope is required to update billing settings.' });
    }

    const {
      estimatePrefix,
      gstin,
      address,
      city,
      state,
      pincode,
      country,
      bankName,
      bankIfsc,
      bankAccountNo,
      bankBranch,
      signatureImage,
      signatoryTitle
    } = req.body;

    const updated = await prisma.organization.update({
      where: { id: targetOrgId },
      data: {
        estimatePrefix: estimatePrefix ? estimatePrefix.toUpperCase().trim() : undefined,
        gstin: gstin !== undefined ? gstin.trim() : undefined,
        address: address !== undefined ? address.trim() : undefined,
        city: city !== undefined ? city.trim() : undefined,
        state: state !== undefined ? state.trim() : undefined,
        pincode: pincode !== undefined ? pincode.trim() : undefined,
        country: country !== undefined ? country.trim() : undefined,
        bankName: bankName !== undefined ? bankName.trim() : undefined,
        bankIfsc: bankIfsc !== undefined ? bankIfsc.trim() : undefined,
        bankAccountNo: bankAccountNo !== undefined ? bankAccountNo.trim() : undefined,
        bankBranch: bankBranch !== undefined ? bankBranch.trim() : undefined,
        signatureImage: signatureImage !== undefined ? signatureImage : undefined,
        signatoryTitle: signatoryTitle !== undefined ? signatoryTitle.trim() : undefined
      }
    });

    res.json({ message: 'Billing settings updated successfully.', organization: updated });
  } catch (error) {
    console.error('Update billing settings error:', error);
    res.status(500).json({ message: 'Failed to update billing settings.' });
  }
};

/**
 * POST /api/assets/estimates/preview
 * Calculates estimate totals and formats preview WITHOUT saving to database.
 */
const previewEstimate = async (req, res) => {
  try {
    const targetOrgId = getEffectiveOrgId(req);
    const {
      items = [],
      taxRate = 18,
      billTo = {},
      company = {},
      reference = '',
      placeOfSupply = '',
      estimateDate = new Date(),
      title = 'Estimate',
      notes = DEFAULT_NOTES,
      termsAndConditions = DEFAULT_TERMS,
      banking = {}
    } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'Please provide at least one line item for the estimate.' });
    }

    let org = null;
    if (targetOrgId) {
      org = await prisma.organization.findUnique({ where: { id: targetOrgId } });
    }

    const companyName = company.name || org?.name || 'Innoveity';
    const companyAddress = company.address || org?.address || '';
    const companyCity = company.city || org?.city || 'Chennai';
    const companyState = company.state || org?.state || 'Tamil Nadu';
    const companyPincode = company.pincode || org?.pincode || '600059';
    const companyCountry = company.country || org?.country || 'India';
    const companyPhone = company.phone || org?.phone || '';
    const companyEmail = company.email || org?.email || '';
    const companyGstin = company.gstin || org?.gstin || '';
    const companyLogo = company.logo || org?.logo || null;

    const supplyState = placeOfSupply || billTo.state || companyState;

    const totals = computeEstimateTotals({
      items,
      taxRate,
      companyState,
      placeOfSupply: supplyState
    });

    const nextEstimateNo = await previewNextEstimateNumber(targetOrgId);

    res.json({
      success: true,
      estimateNumber: nextEstimateNo,
      estimateDate: estimateDate ? new Date(estimateDate) : new Date(),
      title: title || 'Estimate',
      reference: reference || null,
      placeOfSupply: placeOfSupply || `${companyState} (33)`,
      company: {
        name: companyName,
        address: companyAddress,
        city: companyCity,
        state: companyState,
        pincode: companyPincode,
        country: companyCountry,
        phone: companyPhone,
        email: companyEmail,
        gstin: companyGstin,
        logo: companyLogo
      },
      billTo: {
        name: billTo.name || 'Valued Customer',
        address: billTo.address || '',
        city: billTo.city || '',
        state: billTo.state || '',
        pincode: billTo.pincode || '',
        country: billTo.country || 'India',
        gstin: billTo.gstin || ''
      },
      items: totals.processedItems,
      subTotal: totals.subTotal,
      cgstRate: totals.cgstRate,
      sgstRate: totals.sgstRate,
      igstRate: totals.igstRate,
      cgstAmount: totals.cgstAmount,
      sgstAmount: totals.sgstAmount,
      igstAmount: totals.igstAmount,
      grandTotal: totals.grandTotal,
      totalInWords: totals.totalInWords,
      banking: {
        bankName: banking.bankName || '',
        bankIfsc: banking.bankIfsc || '',
        bankAccountNo: banking.bankAccountNo || '',
        bankBranch: banking.bankBranch || ''
      },
      notes: notes || DEFAULT_NOTES,
      termsAndConditions: termsAndConditions || DEFAULT_TERMS,
      signatoryTitle: company.signatoryTitle || 'Authorized Signature',
      signatureImage: company.signatureImage || null
    });
  } catch (error) {
    console.error('Preview estimate error:', error);
    res.status(500).json({ message: 'Failed to generate estimate preview.' });
  }
};

/**
 * POST /api/assets/estimates
 * Persists a new AssetEstimate and AssetEstimateItem records inside a transaction.
 */
const createEstimate = async (req, res) => {
  try {
    const targetOrgId = getEffectiveOrgId(req);
    const {
      items = [],
      taxRate = 18,
      billTo = {},
      company = {},
      reference = '',
      placeOfSupply = '',
      estimateDate = new Date(),
      title = 'Estimate',
      notes = DEFAULT_NOTES,
      termsAndConditions = DEFAULT_TERMS,
      banking = {},
      status = 'GENERATED'
    } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'At least one line item is required to create an estimate.' });
    }

    if (!billTo || !billTo.name || !billTo.name.trim()) {
      return res.status(400).json({ message: 'Customer name (Bill To) is required.' });
    }

    // Resolve company defaults from organization if missing
    let org = null;
    if (targetOrgId) {
      org = await prisma.organization.findUnique({ where: { id: targetOrgId } });
    }

    const companyName = company.name || org?.name || 'Innoveity';
    const companyAddress = company.address || org?.address || '';
    const companyCity = company.city || org?.city || 'Chennai';
    const companyState = company.state || org?.state || 'Tamil Nadu';
    const companyPincode = company.pincode || org?.pincode || '600059';
    const companyCountry = company.country || org?.country || 'India';
    const companyPhone = company.phone || org?.phone || '';
    const companyEmail = company.email || org?.email || '';
    const companyGstin = company.gstin || org?.gstin || '';
    const companyLogo = company.logo || org?.logo || null;

    const supplyState = placeOfSupply || billTo.state || companyState;

    const totals = computeEstimateTotals({
      items,
      taxRate,
      companyState,
      placeOfSupply: supplyState
    });

    const bankName = banking.bankName || org?.bankName || '';
    const bankIfsc = banking.bankIfsc || org?.bankIfsc || '';
    const bankAccountNo = banking.bankAccountNo || org?.bankAccountNo || '';
    const bankBranch = banking.bankBranch || org?.bankBranch || '';
    const signatoryTitle = company.signatoryTitle || org?.signatoryTitle || 'Authorized Signature';
    const signatureImage = company.signatureImage || org?.signatureImage || null;

    // Concurrency-safe atomic transaction
    const savedEstimate = await prisma.$transaction(async (tx) => {
      // 1. Generate next atomic Estimate Number
      const estimateNumber = await generateNextEstimateNumber(targetOrgId, tx);

      // 2. Create the AssetEstimate snapshot header
      const createdHeader = await tx.assetEstimate.create({
        data: {
          organizationId: targetOrgId || null,
          createdById: req.user?.id || null,
          estimateNumber,
          estimateDate: estimateDate ? new Date(estimateDate) : new Date(),
          reference: reference ? reference.trim() : null,
          placeOfSupply: supplyState ? supplyState.trim() : null,
          status: status || 'GENERATED',
          title: title || 'Estimate',

          // Company snapshot
          companyName,
          companyAddress,
          companyCity,
          companyState,
          companyPincode,
          companyCountry,
          companyPhone,
          companyEmail,
          companyGstin,
          companyLogo,

          // Bill To snapshot
          billToName: billTo.name.trim(),
          billToAddress: billTo.address ? billTo.address.trim() : null,
          billToCity: billTo.city ? billTo.city.trim() : null,
          billToState: billTo.state ? billTo.state.trim() : null,
          billToPincode: billTo.pincode ? billTo.pincode.trim() : null,
          billToCountry: billTo.country ? billTo.country.trim() : 'India',
          billToGstin: billTo.gstin ? billTo.gstin.trim() : null,

          // Financial snapshot
          subTotal: totals.subTotal,
          cgstRate: totals.cgstRate,
          sgstRate: totals.sgstRate,
          igstRate: totals.igstRate,
          cgstAmount: totals.cgstAmount,
          sgstAmount: totals.sgstAmount,
          igstAmount: totals.igstAmount,
          grandTotal: totals.grandTotal,
          totalInWords: totals.totalInWords,

          // Banking & Terms snapshot
          bankName,
          bankIfsc,
          bankAccountNo,
          bankBranch,
          notes: notes ? notes.trim() : null,
          termsAndConditions: termsAndConditions || DEFAULT_TERMS,
          signatureImage,
          signatoryTitle
        }
      });

      // 3. Create line items
      const itemData = totals.processedItems.map((it) => ({
        estimateId: createdHeader.id,
        assetId: it.assetId || null,
        itemIndex: it.itemIndex,
        title: it.title,
        description: it.description,
        quantity: it.quantity,
        unit: it.unit || 'nos',
        rate: it.rate,
        cgstAmount: it.cgstAmount,
        sgstAmount: it.sgstAmount,
        igstAmount: it.igstAmount,
        amount: it.amount
      }));

      await tx.assetEstimateItem.createMany({
        data: itemData
      });

      // Return complete estimate with items
      return await tx.assetEstimate.findUnique({
        where: { id: createdHeader.id },
        include: {
          items: { orderBy: { itemIndex: 'asc' } },
          organization: { select: { id: true, name: true, slug: true } }
        }
      });
    });

    await logActivity({
      userId: req.user.id,
      organizationId: targetOrgId,
      action: 'ESTIMATE_CREATED',
      details: `Generated ${savedEstimate.title} ${savedEstimate.estimateNumber} for "${savedEstimate.billToName}" (Grand Total: ₹${savedEstimate.grandTotal})`
    });

    return res.status(201).json({
      success: true,
      message: `${savedEstimate.title} ${savedEstimate.estimateNumber} created successfully.`,
      estimate: savedEstimate
    });
  } catch (error) {
    console.error('Create estimate error:', error);
    res.status(500).json({ message: 'Failed to create estimate.' });
  }
};

/**
 * GET /api/assets/estimates
 * Lists estimates for the organization with pagination, search, status & date filters, and sorting.
 */
const getEstimates = async (req, res) => {
  try {
    const targetOrgId = getEffectiveOrgId(req);
    const {
      page = 1,
      limit = 15,
      search = '',
      status = 'ALL',
      fromDate = '',
      toDate = '',
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 15));
    const skip = (pageNum - 1) * limitNum;

    // Allowed sort fields to prevent arbitrary query injection
    const allowedSortFields = ['createdAt', 'estimateDate', 'estimateNumber', 'grandTotal', 'billToName', 'status'];
    const validSortBy = allowedSortFields.includes(sortBy) ? sortBy : 'createdAt';
    const validSortOrder = String(sortOrder).toLowerCase() === 'asc' ? 'asc' : 'desc';

    const where = {};

    // Organization scoping
    if (targetOrgId) {
      where.organizationId = targetOrgId;
    }

    // Status filter
    if (status && status !== 'ALL') {
      where.status = status.toUpperCase().trim();
    }

    // Date range filter
    if (fromDate || toDate) {
      where.estimateDate = {};
      if (fromDate) {
        const fDate = new Date(fromDate);
        fDate.setHours(0, 0, 0, 0);
        where.estimateDate.gte = fDate;
      }
      if (toDate) {
        const tDate = new Date(toDate);
        tDate.setHours(23, 59, 59, 999);
        where.estimateDate.lte = tDate;
      }
    }

    // Server-side search across estimateNumber, billToName, and reference
    if (search && search.trim()) {
      const term = search.trim();
      const searchCondition = {
        OR: [
          { estimateNumber: { contains: term } },
          { billToName: { contains: term } },
          { reference: { contains: term } }
        ]
      };
      if (where.AND) {
        where.AND.push(searchCondition);
      } else {
        where.AND = [searchCondition];
      }
    }

    const [estimates, totalCount] = await Promise.all([
      prisma.assetEstimate.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { [validSortBy]: validSortOrder },
        select: {
          id: true,
          organizationId: true,
          createdById: true,
          estimateNumber: true,
          estimateDate: true,
          reference: true,
          placeOfSupply: true,
          status: true,
          title: true,
          billToName: true,
          billToCity: true,
          billToState: true,
          subTotal: true,
          grandTotal: true,
          createdAt: true,
          cancelledAt: true,
          cancelledById: true,
          cancellationReason: true,
          _count: {
            select: { items: true }
          }
        }
      }),
      prisma.assetEstimate.count({ where })
    ]);

    // Efficiently lookup creator user details for display
    const userIds = [...new Set(estimates.map((e) => e.createdById).filter(Boolean))];
    const userMap = {};
    if (userIds.length > 0) {
      const users = await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, employeeId: true, email: true, profilePic: true }
      });
      users.forEach((u) => {
        userMap[u.id] = u;
      });
    }

    const formattedEstimates = estimates.map((e) => ({
      ...e,
      itemCount: e._count?.items || 0,
      createdBy: e.createdById ? (userMap[e.createdById] || null) : null
    }));

    res.json({
      estimates: formattedEstimates,
      meta: {
        totalCount,
        page: pageNum,
        totalPages: Math.ceil(totalCount / limitNum),
        limit: limitNum
      }
    });
  } catch (error) {
    console.error('Get estimates history error:', error);
    res.status(500).json({ message: 'Failed to retrieve estimate history.' });
  }
};

/**
 * GET /api/assets/estimates/:id
 * Retrieves an estimate by ID with items and structures snapshot for preview rendering.
 */
const getEstimateById = async (req, res) => {
  try {
    const { id } = req.params;
    const estimate = await prisma.assetEstimate.findUnique({
      where: { id },
      include: {
        items: { orderBy: { itemIndex: 'asc' } },
        organization: { select: { id: true, name: true } }
      }
    });

    if (!estimate) {
      return res.status(404).json({ message: 'Estimate not found.' });
    }

    assertOrganizationAccess(estimate, req);

    // Lookup creator user details
    let createdBy = null;
    if (estimate.createdById) {
      createdBy = await prisma.user.findUnique({
        where: { id: estimate.createdById },
        select: { id: true, name: true, employeeId: true, email: true, profilePic: true }
      });
    }

    // Lookup canceller user details if cancelled
    let cancelledBy = null;
    if (estimate.cancelledById) {
      cancelledBy = await prisma.user.findUnique({
        where: { id: estimate.cancelledById },
        select: { id: true, name: true, employeeId: true, email: true }
      });
    }

    // Map flat snapshot fields into nested objects for EstimateDocumentPreview
    const formatted = {
      ...estimate,
      createdBy,
      cancelledBy,
      company: {
        name: estimate.companyName,
        address: estimate.companyAddress,
        city: estimate.companyCity,
        state: estimate.companyState,
        pincode: estimate.companyPincode,
        country: estimate.companyCountry,
        phone: estimate.companyPhone,
        email: estimate.companyEmail,
        gstin: estimate.companyGstin,
        logo: estimate.companyLogo
      },
      billTo: {
        name: estimate.billToName,
        address: estimate.billToAddress,
        city: estimate.billToCity,
        state: estimate.billToState,
        pincode: estimate.billToPincode,
        country: estimate.billToCountry,
        gstin: estimate.billToGstin
      },
      banking: {
        bankName: estimate.bankName,
        bankIfsc: estimate.bankIfsc,
        bankAccountNo: estimate.bankAccountNo,
        bankBranch: estimate.bankBranch
      }
    };

    res.json(formatted);
  } catch (error) {
    if (error.statusCode === 403) {
      return res.status(403).json({ message: error.message });
    }
    console.error('Get estimate by ID error:', error);
    res.status(500).json({ message: 'Failed to retrieve estimate.' });
  }
};

/**
 * PATCH /api/assets/estimates/:id/cancel
 * Voids/cancels an estimate, stores the cancellation reason and timestamp, and logs activity.
 */
const cancelEstimate = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body || {};

    const estimate = await prisma.assetEstimate.findUnique({
      where: { id }
    });

    if (!estimate) {
      return res.status(404).json({ message: 'Estimate not found.' });
    }

    assertOrganizationAccess(estimate, req);

    if (estimate.status === 'CANCELLED') {
      return res.status(400).json({ message: 'Estimate is already cancelled.' });
    }

    const trimmedReason = (reason || '').trim();
    if (!trimmedReason) {
      return res.status(400).json({ message: 'Cancellation reason is required.' });
    }

    if (trimmedReason.length > 250) {
      return res.status(400).json({ message: 'Cancellation reason cannot exceed 250 characters.' });
    }

    const updated = await prisma.assetEstimate.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelledById: req.user?.id || null,
        cancellationReason: trimmedReason
      },
      include: {
        items: { orderBy: { itemIndex: 'asc' } }
      }
    });

    await logActivity({
      userId: req.user.id,
      organizationId: estimate.organizationId,
      action: 'ESTIMATE_CANCELLED',
      details: `Cancelled Estimate ${estimate.estimateNumber} for "${estimate.billToName}". Reason: ${trimmedReason}`
    });

    return res.json({
      success: true,
      message: `Estimate ${estimate.estimateNumber} cancelled successfully.`,
      estimate: updated
    });
  } catch (error) {
    if (error.statusCode === 403) {
      return res.status(403).json({ message: error.message });
    }
    console.error('Cancel estimate error:', error);
    res.status(500).json({ message: 'Failed to cancel estimate.' });
  }
};

module.exports = {
  getBillingSettings,
  updateBillingSettings,
  previewEstimate,
  createEstimate,
  getEstimates,
  getEstimateById,
  cancelEstimate
};
