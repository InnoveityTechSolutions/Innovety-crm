const { hasModulePermission, getUserEffectivePermissions } = require('../services/permissionService');
const { ACCESS_LEVELS } = require('../config/crmModules');

/**
 * Express middleware to enforce module-level authorization (VIEW or EDIT).
 * 
 * @param {string} moduleKey - Stable key matching an entry in CRM_MODULES
 * @param {'VIEW'|'EDIT'} requiredLevel - Minimum required access level ('VIEW' default)
 */
const requirePermission = (moduleKey, requiredLevel = ACCESS_LEVELS.VIEW) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({ success: false, message: 'Authentication required.' });
      }

      // SUPER_ADMIN unconditionally bypasses module permission restrictions
      if (req.user.role === 'SUPER_ADMIN') {
        return next();
      }

      // Universal self-service: Profile operations on own account are always allowed
      if (moduleKey === 'profile' || (Array.isArray(moduleKey) && moduleKey.includes('profile'))) {
        return next();
      }

      const permissions = await getUserEffectivePermissions(req.user);

      // Handle array of module keys (OR condition: user having sufficient access to any one of the modules is authorized)
      if (Array.isArray(moduleKey)) {
        const hasAccess = moduleKey.some(key => {
          if (key === 'user_management') {
            const subLevels = ['registry_employees', 'registry_interns', 'registry_teamleaders'].map(k => permissions[k] || ACCESS_LEVELS.NONE);
            return requiredLevel === ACCESS_LEVELS.EDIT
              ? subLevels.includes(ACCESS_LEVELS.EDIT)
              : (subLevels.includes(ACCESS_LEVELS.VIEW) || subLevels.includes(ACCESS_LEVELS.EDIT));
          }
          const userLevel = permissions[key] || ACCESS_LEVELS.NONE;
          return requiredLevel === ACCESS_LEVELS.EDIT
            ? userLevel === ACCESS_LEVELS.EDIT
            : (userLevel === ACCESS_LEVELS.VIEW || userLevel === ACCESS_LEVELS.EDIT);
        });

        if (!hasAccess) {
          return res.status(403).json({
            success: false,
            code: 'PERMISSION_DENIED',
            module: moduleKey.join(','),
            message: `Access denied: Insufficient permissions for module group.`
          });
        }

        req.userPermissions = permissions;
        return next();
      }

      // Handle legacy/alias 'user_management'
      if (moduleKey === 'user_management') {
        const subLevels = ['registry_employees', 'registry_interns', 'registry_teamleaders'].map(k => permissions[k] || ACCESS_LEVELS.NONE);
        const hasAccess = requiredLevel === ACCESS_LEVELS.EDIT
          ? subLevels.includes(ACCESS_LEVELS.EDIT)
          : (subLevels.includes(ACCESS_LEVELS.VIEW) || subLevels.includes(ACCESS_LEVELS.EDIT));
        if (!hasAccess) {
          return res.status(403).json({
            success: false,
            code: 'PERMISSION_DENIED',
            module: 'user_management',
            message: `Access denied: You do not have permission to access user registries.`
          });
        }
        req.userPermissions = permissions;
        return next();
      }

      const userLevel = permissions[moduleKey] || ACCESS_LEVELS.NONE;

      // Check if user has no access at all
      if (userLevel === ACCESS_LEVELS.NONE) {
        return res.status(403).json({
          success: false,
          code: 'PERMISSION_DENIED',
          module: moduleKey,
          message: `Access denied: You do not have permission to access the '${moduleKey}' module.`
        });
      }

      // Check if user has VIEW but EDIT is required
      if (requiredLevel === ACCESS_LEVELS.EDIT && userLevel !== ACCESS_LEVELS.EDIT) {
        return res.status(403).json({
          success: false,
          code: 'READ_ONLY_ACCESS',
          module: moduleKey,
          message: `Access denied: Edit permission required for module '${moduleKey}'. Your access is read-only.`
        });
      }

      // Attach resolved permissions to req for controller use if needed
      req.userPermissions = permissions;
      next();
    } catch (error) {
      console.error(`[Permission Middleware Error on ${moduleKey}]:`, error);
      return res.status(500).json({
        success: false,
        message: 'Internal authorization evaluation error.'
      });
    }
  };
};

module.exports = {
  requirePermission
};
