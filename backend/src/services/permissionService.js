const prisma = require('../utils/db');
const { CRM_MODULES, ACCESS_LEVELS, getDefaultRolePermission } = require('../config/crmModules');

/**
 * Resolves the effective module permission map for a user.
 * 
 * Precedence rules:
 * 1. SUPER_ADMIN: Unconditional EDIT across all CRM modules.
 * 2. User with assigned accessTemplateId:
 *    - Resolves permissions from AccessTemplatePermission table.
 *    - Modules without a record evaluate to NONE.
 *    - profile is universally guaranteed as EDIT (Universal Self-Service Rule).
 *    - Inactive templates continue to grant their configured permissions to already-assigned users.
 * 3. Existing users without a template (accessTemplateId is null):
 *    - Seamless backward-compatibility fallback: resolves verified base role baseline from crmModules.js.
 * 
 * @param {Object} user - User record with id, role, accessTemplateId
 * @returns {Promise<Object>} Map of { [moduleKey]: 'NONE' | 'VIEW' | 'EDIT' }
 */
const getUserEffectivePermissions = async (user) => {
  if (!user) return {};

  // 1. SUPER_ADMIN has full bypass EDIT across all operational modules
  if (user.role === 'SUPER_ADMIN') {
    const adminMap = {};
    for (const mod of CRM_MODULES) {
      adminMap[mod.key] = ACCESS_LEVELS.EDIT;
    }
    return adminMap;
  }

  // 2. User has an assigned Access Template
  if (user.accessTemplateId) {
    const template = await prisma.accessTemplate.findUnique({
      where: { id: user.accessTemplateId },
      include: { permissions: true }
    });

    if (template) {
      const templatePermMap = {};
      for (const p of template.permissions) {
        templatePermMap[p.moduleKey] = p.accessLevel;
      }

      const effectiveMap = {};
      for (const mod of CRM_MODULES) {
        if (mod.key === 'profile') {
          // Universal self-service: Profile is always accessible
          effectiveMap[mod.key] = ACCESS_LEVELS.EDIT;
        } else {
          effectiveMap[mod.key] = templatePermMap[mod.key] || ACCESS_LEVELS.NONE;
        }
      }
      return effectiveMap;
    }
  }

  // 3. Backward-compatible fallback for users without a template (accessTemplateId == null)
  const roleFallbackMap = {};
  for (const mod of CRM_MODULES) {
    if (mod.key === 'profile') {
      roleFallbackMap[mod.key] = ACCESS_LEVELS.EDIT;
    } else {
      roleFallbackMap[mod.key] = getDefaultRolePermission(mod.key, user.role);
    }
  }
  return roleFallbackMap;
};

/**
 * Checks whether a user has the required permission level for a given module.
 * 
 * @param {Object} user - User record (req.user)
 * @param {string} moduleKey - Key matching CRM_MODULES
 * @param {'VIEW'|'EDIT'} requiredLevel - Minimum required level ('VIEW' or 'EDIT')
 * @returns {Promise<boolean>} True if authorized, false otherwise
 */
const hasModulePermission = async (user, moduleKey, requiredLevel = ACCESS_LEVELS.VIEW) => {
  if (!user) return false;

  // SUPER_ADMIN always has full access
  if (user.role === 'SUPER_ADMIN') return true;

  // Universal self-service for profile
  if (moduleKey === 'profile') return true;

  const permissions = await getUserEffectivePermissions(user);
  const userLevel = permissions[moduleKey] || ACCESS_LEVELS.NONE;

  if (userLevel === ACCESS_LEVELS.NONE) return false;

  if (requiredLevel === ACCESS_LEVELS.VIEW) {
    return userLevel === ACCESS_LEVELS.VIEW || userLevel === ACCESS_LEVELS.EDIT;
  }

  if (requiredLevel === ACCESS_LEVELS.EDIT) {
    return userLevel === ACCESS_LEVELS.EDIT;
  }

  return false;
};

module.exports = {
  getUserEffectivePermissions,
  hasModulePermission
};
