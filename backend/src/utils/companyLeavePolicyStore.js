const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, '../data/company_leave_policies.json');

// Ensure data directory exists
const dataDir = path.dirname(STORE_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

function normalizeRole(role) {
  if (!role) return null;
  const r = String(role).trim().toUpperCase();
  if (r === 'TL' || r === 'TEAMLEADER' || r === 'TEAM-LEADER' || r === 'TEAM_LEADER' || r === 'TEAM_LEAD' || r === 'TEAMLEAD') {
    return 'TEAM_LEADER';
  }
  return r;
}

/**
 * Get company-specific leave policy configuration
 */
function getCompanyLeavePolicy(organizationId, role = null) {
  const defaultPolicy = {
    allocationType: 'ANNUAL',
    carryForwardEnabled: true,
    maxCarryForwardDays: 5.0,
    halfDayAllowed: true,
    workingDaysOnly: true,
    autoApproval: false,
    compOffValidityDays: 90,
    compOffClaimWindowDays: 30
  };

  if (!organizationId || !fs.existsSync(STORE_PATH)) {
    return defaultPolicy;
  }

  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    const data = JSON.parse(raw);
    const companyData = data.policies && data.policies[organizationId] ? data.policies[organizationId] : null;
    if (!companyData) return defaultPolicy;

    const basePolicy = { ...defaultPolicy, ...companyData };
    const companyAllocationType = companyData.allocationType || basePolicy.allocationType || 'ANNUAL';
    const normRole = normalizeRole(role);

    if (normRole && companyData.roles && (companyData.roles[normRole] || companyData.roles[role])) {
      const roleData = companyData.roles[normRole] || companyData.roles[role];
      return {
        ...basePolicy,
        ...roleData,
        // Crucial: Company's active allocationType always defines the company policy mode for all roles
        allocationType: companyAllocationType,
        allowances: {
          ...(companyData.allowances || {}),
          ...(roleData.allowances || {})
        }
      };
    }
    return {
      ...basePolicy,
      allocationType: companyAllocationType
    };
  } catch (err) {
    console.error('Error reading company leave policy:', err);
    return defaultPolicy;
  }
}

/**
 * Save company-specific leave policy configuration (optionally for a specific role)
 */
function setCompanyLeavePolicy(organizationId, policyData, role = null) {
  if (!organizationId) return;
  let data = { policies: {}, types: {} };
  if (fs.existsSync(STORE_PATH)) {
    try {
      const raw = fs.readFileSync(STORE_PATH, 'utf8');
      data = JSON.parse(raw);
    } catch (err) {
      data = { policies: {}, types: {} };
    }
  }

  if (!data.policies) data.policies = {};
  if (!data.policies[organizationId]) {
    data.policies[organizationId] = {};
  }

  const normRole = normalizeRole(role);
  if (normRole) {
    if (!data.policies[organizationId].roles) {
      data.policies[organizationId].roles = {};
    }
    const cleanPolicyData = { ...policyData };
    delete cleanPolicyData.roles;
    data.policies[organizationId].roles[normRole] = {
      ...data.policies[organizationId].roles[normRole],
      ...cleanPolicyData
    };
  } else {
    data.policies[organizationId] = {
      ...data.policies[organizationId],
      ...policyData
    };
  }

  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Read list of leave type IDs associated with organizationId
 */
function getCompanyLeaveTypeIds(organizationId) {
  if (!organizationId || !fs.existsSync(STORE_PATH)) return null;
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    const data = JSON.parse(raw);
    return data.types ? data.types[organizationId] || null : null;
  } catch (err) {
    console.error('Error reading company leave types:', err);
    return null;
  }
}

/**
 * Get Set of all leave type IDs assigned to any organization
 */
function getAllAssignedLeaveTypeIds() {
  if (!fs.existsSync(STORE_PATH)) return new Set();
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    const data = JSON.parse(raw);
    const set = new Set();
    if (data.types) {
      Object.values(data.types).forEach((ids) => {
        if (Array.isArray(ids)) {
          ids.forEach((id) => set.add(id));
        }
      });
    }
    return set;
  } catch (err) {
    return new Set();
  }
}

/**
 * Add a leave type ID to an organizationId
 */
function addLeaveTypeToCompany(organizationId, leaveTypeId) {
  if (!organizationId || !leaveTypeId) return;
  let data = { policies: {}, types: {} };
  if (fs.existsSync(STORE_PATH)) {
    try {
      const raw = fs.readFileSync(STORE_PATH, 'utf8');
      data = JSON.parse(raw);
    } catch (err) {
      data = { policies: {}, types: {} };
    }
  }

  if (!data.types) data.types = {};
  const current = data.types[organizationId] || [];
  if (!current.includes(leaveTypeId)) {
    data.types[organizationId] = [...current, leaveTypeId];
    fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), 'utf8');
  }
}

/**
 * Remove a leave type ID from an organizationId
 */
function removeLeaveTypeFromCompany(organizationId, leaveTypeId) {
  if (!organizationId || !leaveTypeId) return;
  if (!fs.existsSync(STORE_PATH)) return;

  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    const data = JSON.parse(raw);
    if (data.types && data.types[organizationId]) {
      data.types[organizationId] = data.types[organizationId].filter((id) => id !== leaveTypeId);
      fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), 'utf8');
    }
  } catch (err) {
    console.error('Error removing leave type from company:', err);
  }
}

/**
 * Filter leave types for a company with strict multi-tenant isolation
 */
function filterLeaveTypesForCompany(allTypes, organizationId) {
  if (!Array.isArray(allTypes)) return [];
  if (!organizationId) {
    return allTypes.filter((lt) => lt.isSystem || ['CL', 'SL', 'COMP_OFF', 'WFH'].includes((lt.code || '').toUpperCase()) || lt.isActive);
  }

  const companyTypeIds = getCompanyLeaveTypeIds(organizationId);
  const allAssignedTypeIds = getAllAssignedLeaveTypeIds();

  // If company has an explicit types list configured
  if (Array.isArray(companyTypeIds)) {
    return allTypes.filter((lt) => {
      // Core system leave types (CL, SL, COMP_OFF, WFH) are ALWAYS included for every company
      if (lt.isSystem || ['CL', 'SL', 'COMP_OFF', 'WFH'].includes((lt.code || '').toUpperCase())) return true;
      // Must be explicitly assigned to this company
      return companyTypeIds.includes(lt.id);
    });
  }

  // Fallback for companies with no explicit types configuration yet
  return allTypes.filter((lt) => {
    const isSystemType = lt.isSystem || ['CL', 'SL', 'COMP_OFF', 'WFH'].includes((lt.code || '').toUpperCase());
    if (isSystemType) return true;
    if (allAssignedTypeIds.has(lt.id)) return false;
    return Boolean(lt.isActive);
  });
}

function cleanupCompanyLeavePolicyReferences(organizationId, identifiers = []) {
  if (!fs.existsSync(STORE_PATH)) return;
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    const data = JSON.parse(raw);
    const orgIds = organizationId ? [organizationId] : Object.keys(data.policies || {});
    const allOrgTypes = organizationId ? [organizationId] : Object.keys(data.types || {});

    // Clean from types array across all affected organizations
    allOrgTypes.forEach((org) => {
      if (data.types && data.types[org]) {
        data.types[org] = data.types[org].filter((id) => !identifiers.includes(id));
      }
    });

    orgIds.forEach((org) => {
      // Clean from role allowances
      const comp = data.policies && data.policies[org];
      if (comp && comp.roles) {
        Object.keys(comp.roles).forEach((rKey) => {
          const roleData = comp.roles[rKey];
          if (roleData && roleData.allowances) {
            identifiers.forEach((ident) => {
              if (ident) {
                delete roleData.allowances[ident];
                delete roleData.allowances[ident.toUpperCase()];
                delete roleData.allowances[ident.toLowerCase()];
              }
            });
          }
        });
      }
      if (comp && comp.allowances) {
        identifiers.forEach((ident) => {
          if (ident) {
            delete comp.allowances[ident];
            delete comp.allowances[ident.toUpperCase()];
            delete comp.allowances[ident.toLowerCase()];
          }
        });
      }
    });

    fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('Error cleaning company leave policy references:', err);
  }
}

module.exports = {
  getCompanyLeavePolicy,
  setCompanyLeavePolicy,
  getCompanyLeaveTypeIds,
  getAllAssignedLeaveTypeIds,
  addLeaveTypeToCompany,
  removeLeaveTypeFromCompany,
  cleanupCompanyLeavePolicyReferences,
  filterLeaveTypesForCompany,
  normalizeRole
};

