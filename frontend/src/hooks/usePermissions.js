import React from 'react';
import { useAuth } from '../context/AuthContext';
import { CRM_MODULE_KEYS, ACCESS_LEVELS, getRoleBaselinePermission } from '../config/crmModules';

/**
 * Custom React hook for role-based and access-template module permission evaluation.
 * 
 * Precedence rules:
 * 1. SUPER_ADMIN: Unconditional EDIT access across all operational modules.
 * 2. Universal Self-Service: My Profile ('profile') is guaranteed EDIT for all authenticated users.
 * 3. User with effectivePermissions from backend:
 *    - Uses backend-resolved effectivePermissions as the authoritative source of truth.
 * 4. Fallback for unassigned users (accessTemplateId == null):
 *    - Resolves baseline role defaults from CRM_MODULE_KEYS & ROLE_BASELINES.
 */
export const usePermissions = () => {
  const { user, refreshProfile } = useAuth();

  const isSuperAdmin = Boolean(user?.role && String(user.role).toUpperCase() === 'SUPER_ADMIN');

  /**
   * Get effective permission level for a module: 'NONE' | 'VIEW' | 'EDIT'
   */
  const getPermission = (moduleKey) => {
    if (!user) return ACCESS_LEVELS.NONE;
    if (isSuperAdmin) return ACCESS_LEVELS.EDIT;

    // Universal Self-Service rule: Profile is always EDIT for the logged-in user
    if (moduleKey === CRM_MODULE_KEYS.PROFILE || moduleKey === 'profile') {
      return ACCESS_LEVELS.EDIT;
    }

    // 1. Authoritative backend effective permissions map
    if (user.effectivePermissions && typeof user.effectivePermissions === 'object') {
      const level = user.effectivePermissions[moduleKey];
      if (level !== undefined && level !== null) {
        return level;
      }
    }

    // 2. Backward compatibility fallback for unassigned users
    if (!user.accessTemplateId && user.role) {
      return getRoleBaselinePermission(user.role, moduleKey);
    }

    // 3. Fallback for template-assigned user when module record is missing
    return ACCESS_LEVELS.NONE;
  };

  /**
   * Check if user can view the module (either VIEW or EDIT)
   */
  const canView = (moduleKey) => {
    const level = getPermission(moduleKey);
    return level === ACCESS_LEVELS.VIEW || level === ACCESS_LEVELS.EDIT;
  };

  /**
   * Check if user has edit/mutation permission on the module
   */
  const canEdit = (moduleKey) => {
    const level = getPermission(moduleKey);
    return level === ACCESS_LEVELS.EDIT;
  };

  /**
   * Generic permission check:
   * @param {string} moduleKey - Module key
   * @param {'VIEW'|'EDIT'|'NONE'} requiredLevel - Minimum required level
   */
  const hasPermission = (moduleKey, requiredLevel = ACCESS_LEVELS.VIEW) => {
    if (requiredLevel === ACCESS_LEVELS.EDIT) {
      return canEdit(moduleKey);
    }
    if (requiredLevel === ACCESS_LEVELS.VIEW) {
      return canView(moduleKey);
    }
    return true;
  };

  return {
    user,
    isSuperAdmin,
    accessTemplate: user?.accessTemplate || null,
    accessTemplateId: user?.accessTemplateId || null,
    effectivePermissions: user?.effectivePermissions || {},
    getPermission,
    canView,
    canEdit,
    hasPermission,
    refreshPermissions: refreshProfile
  };
};

/**
 * Reusable declarative permission guard wrapper for UI elements.
 */
export const PermissionGuard = ({
  module: moduleKey,
  required = ACCESS_LEVELS.VIEW,
  fallback = null,
  children
}) => {
  const { hasPermission } = usePermissions();

  if (!hasPermission(moduleKey, required)) {
    return fallback;
  }

  return children;
};

export default usePermissions;
