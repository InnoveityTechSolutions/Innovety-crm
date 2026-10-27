const bcrypt = require('bcrypt');
const prisma = require('../utils/db');
const { CRM_MODULES, ACCESS_LEVELS, SUPER_ADMIN_EXCLUDED_MODULES, getModuleByKey } = require('../config/crmModules');
const { logActivity } = require('../utils/activityLogger');
const { getEffectiveOrgId } = require('../utils/organizationScope');

/**
 * Helper to auto-generate employee ID per role (e.g. EM-1001, IN-1005, TL-1002, AD-1003)
 */
const generateEmployeeId = async (role) => {
  const prefix = role === 'EMPLOYEE' ? 'EM' : role === 'ADMIN' ? 'AD' : role === 'TEAM_LEADER' ? 'TL' : 'IN';

  const users = await prisma.user.findMany({
    where: {
      employeeId: { startsWith: `${prefix}-` }
    },
    select: { employeeId: true }
  });

  let maxNum = 1000;
  users.forEach((u) => {
    if (u.employeeId) {
      const match = u.employeeId.match(/^[A-Z]+-(\d+)$/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (!isNaN(num) && num > maxNum) {
          maxNum = num;
        }
      }
    }
  });

  const nextNum = maxNum + 1;
  return `${prefix}-${nextNum}`;
};

/**
 * Helper to log organization audit entry
 */
const logOrgAudit = async (organizationId, performedById, action, details, ipAddress = '127.0.0.1') => {
  try {
    if (!organizationId) return;
    await prisma.organizationAuditLog.create({
      data: {
        organizationId,
        performedById,
        action,
        details,
        ipAddress
      }
    });
  } catch (err) {
    console.warn('[AccessTemplateAudit Warning]:', err.message);
  }
};

/**
 * 1. List Access Templates by Organization
 * Supports search, role, status filters, and returns accurate member counts.
 */
const listTemplates = async (req, res) => {
  try {
    const { search, role, status } = req.query;
    const targetOrgId = getEffectiveOrgId(req);

    // Build filter where clause
    const where = {};

    // Organization filter
    if (targetOrgId && targetOrgId !== 'all') {
      where.organizationId = targetOrgId;
    }

    // Role filter
    if (role && role !== 'ALL') {
      where.baseRole = role;
    }

    // Status filter
    if (status && status !== 'ALL') {
      where.status = status;
    } else if (!status) {
      // Default to non-archived unless explicitly asked for ALL
      where.status = { not: 'ARCHIVED' };
    }

    // Search filter (name or description)
    if (search && search.trim()) {
      where.OR = [
        { name: { contains: search.trim() } },
        { description: { contains: search.trim() } }
      ];
    }

    const templates = await prisma.accessTemplate.findMany({
      where,
      include: {
        organization: {
          select: { id: true, name: true, slug: true, companyCode: true }
        },
        createdBy: {
          select: { id: true, name: true, email: true }
        },
        permissions: {
          select: { moduleKey: true, accessLevel: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    // Compute accurate member counts for each template
    const templatesWithCounts = await Promise.all(
      templates.map(async (tpl) => {
        const [totalMembers, activeMembers] = await Promise.all([
          prisma.user.count({ where: { accessTemplateId: tpl.id } }),
          prisma.user.count({ where: { accessTemplateId: tpl.id, status: 'ACTIVE' } })
        ]);

        return {
          id: tpl.id,
          name: tpl.name,
          description: tpl.description,
          baseRole: tpl.baseRole,
          status: tpl.status,
          organizationId: tpl.organizationId,
          organization: tpl.organization,
          createdBy: tpl.createdBy,
          createdAt: tpl.createdAt,
          updatedAt: tpl.updatedAt,
          modulesCount: tpl.permissions.length,
          totalMembers,
          activeMembers,
          permissions: tpl.permissions
        };
      })
    );

    res.json({
      success: true,
      templates: templatesWithCounts
    });
  } catch (error) {
    console.error('List templates error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve access templates.' });
  }
};

/**
 * 2. Get Available CRM Modules Registry
 * Returns list of modules, categories, and excluded platform modules.
 */
const getAvailableModules = async (req, res) => {
  try {
    res.json({
      success: true,
      modules: CRM_MODULES,
      excludedModules: SUPER_ADMIN_EXCLUDED_MODULES
    });
  } catch (error) {
    console.error('Get modules error:', error);
    res.status(500).json({ success: false, message: 'Failed to load modules registry.' });
  }
};

/**
 * 3. Get Single Access Template by ID
 */
const getTemplateById = async (req, res) => {
  try {
    const { id } = req.params;
    const template = await prisma.accessTemplate.findUnique({
      where: { id },
      include: {
        organization: {
          select: { id: true, name: true, slug: true, companyCode: true }
        },
        createdBy: {
          select: { id: true, name: true, email: true }
        },
        permissions: {
          select: { moduleKey: true, accessLevel: true }
        }
      }
    });

    if (!template) {
      return res.status(404).json({ success: false, message: 'Access template not found.' });
    }

    const [totalMembers, activeMembers] = await Promise.all([
      prisma.user.count({ where: { accessTemplateId: template.id } }),
      prisma.user.count({ where: { accessTemplateId: template.id, status: 'ACTIVE' } })
    ]);

    res.json({
      success: true,
      template: {
        ...template,
        totalMembers,
        activeMembers
      }
    });
  } catch (error) {
    console.error('Get template by ID error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve template details.' });
  }
};

/**
 * 4. Create Access Template
 * Transactional save of template and permission records with organization isolation.
 */
const createTemplate = async (req, res) => {
  try {
    const { name, description, baseRole, organizationId, status = 'ACTIVE', permissions = [] } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Template name is required.' });
    }

    if (!baseRole) {
      return res.status(400).json({ success: false, message: 'Base system role is required.' });
    }

    // STRICT PRIVILEGE ESCALATION PREVENTION: Templates cannot grant SUPER_ADMIN
    if (baseRole === 'SUPER_ADMIN') {
      return res.status(400).json({
        success: false,
        message: 'Access templates cannot be created for the SUPER_ADMIN system role.'
      });
    }

    const validRoles = ['INTERN', 'EMPLOYEE', 'TEAM_LEADER', 'ADMIN'];
    if (!validRoles.includes(baseRole)) {
      return res.status(400).json({ success: false, message: 'Invalid base system role.' });
    }

    if (!organizationId) {
      return res.status(400).json({ success: false, message: 'Organization ID is required.' });
    }

    // Validate organization existence
    const org = await prisma.organization.findUnique({ where: { id: organizationId } });
    if (!org) {
      return res.status(400).json({ success: false, message: 'Specified organization does not exist.' });
    }

    // Check unique template name per organization
    const existing = await prisma.accessTemplate.findUnique({
      where: {
        organizationId_name: {
          organizationId,
          name: name.trim()
        }
      }
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        message: `A template named '${name.trim()}' already exists in ${org.name}.`
      });
    }

    // Filter valid permissions
    const validPerms = (Array.isArray(permissions) ? permissions : []).filter((p) => {
      const mod = getModuleByKey(p.moduleKey);
      return mod && (p.accessLevel === ACCESS_LEVELS.VIEW || p.accessLevel === ACCESS_LEVELS.EDIT);
    });

    // Transactional creation
    const createdTemplate = await prisma.$transaction(async (tx) => {
      const template = await tx.accessTemplate.create({
        data: {
          name: name.trim(),
          description: description ? description.trim() : null,
          baseRole,
          organizationId,
          status,
          createdById: req.user.id
        }
      });

      if (validPerms.length > 0) {
        await tx.accessTemplatePermission.createMany({
          data: validPerms.map((p) => ({
            templateId: template.id,
            moduleKey: p.moduleKey,
            accessLevel: p.accessLevel === ACCESS_LEVELS.EDIT ? ACCESS_LEVELS.EDIT : ACCESS_LEVELS.VIEW
          }))
        });
      }

      return template;
    });

    // Log Activity & Audit
    await logActivity({
      userId: req.user.id,
      action: 'CREATE_ACCESS_TEMPLATE',
      details: `Created access template '${createdTemplate.name}' for role ${baseRole} in organization ${org.name}`,
      ipAddress: req.ip || '127.0.0.1'
    });

    await logOrgAudit(
      organizationId,
      req.user.id,
      'CREATE_ACCESS_TEMPLATE',
      `Super Admin created access template '${createdTemplate.name}' (${validPerms.length} modules configured)`,
      req.ip || '127.0.0.1'
    );

    // Return created template with full details
    const fullTemplate = await prisma.accessTemplate.findUnique({
      where: { id: createdTemplate.id },
      include: {
        organization: { select: { id: true, name: true, slug: true, companyCode: true } },
        permissions: { select: { moduleKey: true, accessLevel: true } },
        createdBy: { select: { id: true, name: true, email: true } }
      }
    });

    res.status(201).json({
      success: true,
      template: {
        ...fullTemplate,
        totalMembers: 0,
        activeMembers: 0
      }
    });
  } catch (error) {
    console.error('Create template error:', error);
    res.status(500).json({ success: false, message: 'Failed to create access template.' });
  }
};

/**
 * 5. Update Access Template
 * Transactionally replaces permissions and updates metadata.
 */
const updateTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, baseRole, status, permissions } = req.body;

    const existing = await prisma.accessTemplate.findUnique({
      where: { id },
      include: { organization: true }
    });

    if (!existing) {
      return res.status(404).json({ success: false, message: 'Access template not found.' });
    }

    // STRICT ORGANIZATION ISOLATION: Organization ID cannot be changed
    if (req.body.organizationId && req.body.organizationId !== existing.organizationId) {
      return res.status(400).json({
        success: false,
        message: 'Forbidden: Moving templates across organizations is not permitted.'
      });
    }

    // Reject changing baseRole to SUPER_ADMIN
    if (baseRole && baseRole === 'SUPER_ADMIN') {
      return res.status(400).json({
        success: false,
        message: 'Cannot assign base role SUPER_ADMIN to an access template.'
      });
    }

    // Check unique name constraint if name is changed
    if (name && name.trim() !== existing.name) {
      const duplicate = await prisma.accessTemplate.findUnique({
        where: {
          organizationId_name: {
            organizationId: existing.organizationId,
            name: name.trim()
          }
        }
      });
      if (duplicate && duplicate.id !== id) {
        return res.status(400).json({
          success: false,
          message: `A template named '${name.trim()}' already exists in ${existing.organization.name}.`
        });
      }
    }

    // Transactional update
    await prisma.$transaction(async (tx) => {
      // 1. Update template scalar fields
      const updateData = {};
      if (name) updateData.name = name.trim();
      if (description !== undefined) updateData.description = description ? description.trim() : null;
      if (baseRole) updateData.baseRole = baseRole;
      if (status) updateData.status = status;

      await tx.accessTemplate.update({
        where: { id },
        data: updateData
      });

      // 2. Replace permissions if array provided
      if (Array.isArray(permissions)) {
        await tx.accessTemplatePermission.deleteMany({
          where: { templateId: id }
        });

        const validPerms = permissions.filter((p) => {
          const mod = getModuleByKey(p.moduleKey);
          return mod && (p.accessLevel === ACCESS_LEVELS.VIEW || p.accessLevel === ACCESS_LEVELS.EDIT);
        });

        if (validPerms.length > 0) {
          await tx.accessTemplatePermission.createMany({
            data: validPerms.map((p) => ({
              templateId: id,
              moduleKey: p.moduleKey,
              accessLevel: p.accessLevel === ACCESS_LEVELS.EDIT ? ACCESS_LEVELS.EDIT : ACCESS_LEVELS.VIEW
            }))
          });
        }
      }
    });

    // Audit Log
    await logActivity({
      userId: req.user.id,
      action: 'UPDATE_ACCESS_TEMPLATE',
      details: `Updated access template '${existing.name}' (ID: ${id})`,
      ipAddress: req.ip || '127.0.0.1'
    });

    await logOrgAudit(
      existing.organizationId,
      req.user.id,
      'UPDATE_ACCESS_TEMPLATE',
      `Super Admin updated permissions for template '${existing.name}'`,
      req.ip || '127.0.0.1'
    );

    // Socket.IO notification for real-time permission cache invalidation
    try {
      const { getIo } = require('../socket');
      const io = getIo();
      if (io) {
        io.emit('access_template_updated', {
          templateId: id,
          organizationId: existing.organizationId
        });
      }
    } catch (e) {
      // Non-blocking socket notification
    }

    // Return updated template
    const updated = await prisma.accessTemplate.findUnique({
      where: { id },
      include: {
        organization: { select: { id: true, name: true, slug: true, companyCode: true } },
        permissions: { select: { moduleKey: true, accessLevel: true } },
        createdBy: { select: { id: true, name: true, email: true } }
      }
    });

    const [totalMembers, activeMembers] = await Promise.all([
      prisma.user.count({ where: { accessTemplateId: id } }),
      prisma.user.count({ where: { accessTemplateId: id, status: 'ACTIVE' } })
    ]);

    res.json({
      success: true,
      template: {
        ...updated,
        totalMembers,
        activeMembers
      }
    });
  } catch (error) {
    console.error('Update template error:', error);
    res.status(500).json({ success: false, message: 'Failed to update access template.' });
  }
};

/**
 * 6. Duplicate Access Template
 * Clones template and all its permission records within the same organization.
 */
const duplicateTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;

    const source = await prisma.accessTemplate.findUnique({
      where: { id },
      include: { permissions: true, organization: true }
    });

    if (!source) {
      return res.status(404).json({ success: false, message: 'Source access template not found.' });
    }

    let targetName = (name || `Copy of ${source.name}`).trim();

    // Check if target name exists, append timestamp if so
    const existingName = await prisma.accessTemplate.findUnique({
      where: {
        organizationId_name: {
          organizationId: source.organizationId,
          name: targetName
        }
      }
    });

    if (existingName) {
      targetName = `${targetName} (${Date.now()})`;
    }

    const duplicated = await prisma.$transaction(async (tx) => {
      const newTemplate = await tx.accessTemplate.create({
        data: {
          name: targetName,
          description: source.description ? `(Duplicated from ${source.name}) ${source.description}` : `Duplicated from ${source.name}`,
          baseRole: source.baseRole,
          organizationId: source.organizationId,
          status: 'ACTIVE',
          createdById: req.user.id
        }
      });

      if (source.permissions.length > 0) {
        await tx.accessTemplatePermission.createMany({
          data: source.permissions.map((p) => ({
            templateId: newTemplate.id,
            moduleKey: p.moduleKey,
            accessLevel: p.accessLevel
          }))
        });
      }

      return newTemplate;
    });

    await logActivity({
      userId: req.user.id,
      action: 'DUPLICATE_ACCESS_TEMPLATE',
      details: `Duplicated template '${source.name}' to '${duplicated.name}'`,
      ipAddress: req.ip || '127.0.0.1'
    });

    const fullDuplicate = await prisma.accessTemplate.findUnique({
      where: { id: duplicated.id },
      include: {
        organization: { select: { id: true, name: true, slug: true, companyCode: true } },
        permissions: { select: { moduleKey: true, accessLevel: true } },
        createdBy: { select: { id: true, name: true, email: true } }
      }
    });

    res.status(201).json({
      success: true,
      template: {
        ...fullDuplicate,
        totalMembers: 0,
        activeMembers: 0
      }
    });
  } catch (error) {
    console.error('Duplicate template error:', error);
    res.status(500).json({ success: false, message: 'Failed to duplicate access template.' });
  }
};

/**
 * 7. Update Template Status (Activate / Deactivate)
 */
const updateTemplateStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status || !['ACTIVE', 'INACTIVE', 'ARCHIVED'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Valid status is required ('ACTIVE', 'INACTIVE', 'ARCHIVED')."
      });
    }

    const template = await prisma.accessTemplate.findUnique({ where: { id } });
    if (!template) {
      return res.status(404).json({ success: false, message: 'Access template not found.' });
    }

    const updated = await prisma.accessTemplate.update({
      where: { id },
      data: { status }
    });

    await logActivity({
      userId: req.user.id,
      action: 'UPDATE_TEMPLATE_STATUS',
      details: `Set status of template '${template.name}' to ${status}`,
      ipAddress: req.ip || '127.0.0.1'
    });

    try {
      const { getIo } = require('../socket');
      const io = getIo();
      if (io) {
        io.emit('access_template_updated', {
          templateId: id,
          organizationId: template.organizationId
        });
      }
    } catch (e) {}

    res.json({
      success: true,
      message: `Template status updated to ${status}.`,
      status: updated.status
    });
  } catch (error) {
    console.error('Update template status error:', error);
    res.status(500).json({ success: false, message: 'Failed to update template status.' });
  }
};

/**
 * 8. Delete Access Template
 * Fails if assigned members > 0.
 */
const deleteTemplate = async (req, res) => {
  try {
    const { id } = req.params;

    const template = await prisma.accessTemplate.findUnique({ where: { id } });
    if (!template) {
      return res.status(404).json({ success: false, message: 'Access template not found.' });
    }

    const assignedCount = await prisma.user.count({ where: { accessTemplateId: id } });
    if (assignedCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete template '${template.name}' because ${assignedCount} user(s) are currently assigned to it. Please reassign those users first.`
      });
    }

    await prisma.accessTemplate.delete({ where: { id } });

    await logActivity({
      userId: req.user.id,
      action: 'DELETE_ACCESS_TEMPLATE',
      details: `Deleted access template '${template.name}' (ID: ${id})`,
      ipAddress: req.ip || '127.0.0.1'
    });

    try {
      const { getIo } = require('../socket');
      const io = getIo();
      if (io) {
        io.emit('access_template_deleted', {
          templateId: id,
          organizationId: template.organizationId
        });
      }
    } catch (e) {}

    res.json({
      success: true,
      message: `Access template '${template.name}' deleted successfully.`
    });
  } catch (error) {
    console.error('Delete template error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete access template.' });
  }
};

/**
 * 9. Get Template Assigned Members
 */
const getTemplateMembers = async (req, res) => {
  try {
    const { id } = req.params;

    const template = await prisma.accessTemplate.findUnique({
      where: { id },
      select: { id: true, name: true, baseRole: true, organizationId: true }
    });

    if (!template) {
      return res.status(404).json({ success: false, message: 'Access template not found.' });
    }

    const users = await prisma.user.findMany({
      where: { accessTemplateId: id },
      select: {
        id: true,
        employeeId: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        status: true,
        department: true,
        designation: true,
        joiningDate: true,
        organization: {
          select: { id: true, name: true, slug: true, companyCode: true }
        }
      },
      orderBy: { name: 'asc' }
    });

    res.json({
      success: true,
      template,
      totalCount: users.length,
      members: users
    });
  } catch (error) {
    console.error('Get template members error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve template members.' });
  }
};

/**
 * 10. Register User from Access Template
 * Derives baseRole and organizationId strictly from the template.
 */
const registerUserFromTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, password, phone, dob, department, designation, status = 'ACTIVE' } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Full name is required.' });
    }

    if (!email || !email.trim()) {
      return res.status(400).json({ success: false, message: 'Email address is required.' });
    }

    if (!password || !password.trim()) {
      return res.status(400).json({ success: false, message: 'Initial password is required.' });
    }

    const cleanEmail = email.trim().toLowerCase();

    // 1. Fetch template and validate status
    const template = await prisma.accessTemplate.findUnique({
      where: { id },
      include: {
        organization: {
          include: { subscriptionPlan: true }
        }
      }
    });

    if (!template) {
      return res.status(404).json({ success: false, message: 'Access template not found.' });
    }

    if (template.status !== 'ACTIVE') {
      return res.status(400).json({
        success: false,
        message: `Cannot register users using an ${template.status.toLowerCase()} template.`
      });
    }

    // STRICT SECURITY: Reject SUPER_ADMIN templates
    if (template.baseRole === 'SUPER_ADMIN') {
      return res.status(403).json({
        success: false,
        message: 'Super Admin accounts cannot be created using access templates.'
      });
    }

    // 2. Validate email uniqueness
    const existingUser = await prisma.user.findUnique({ where: { email: cleanEmail } });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'User with this email already exists.' });
    }

    // 3. Organization Quota Verification
    const org = template.organization;
    if (!org) {
      return res.status(400).json({ success: false, message: 'Associated organization not found.' });
    }

    if (org.status === 'SUSPENDED') {
      return res.status(400).json({ success: false, message: 'Cannot register user to a suspended organization.' });
    }

    if (org.slug !== 'innoveity') {
      const currentUserCount = await prisma.user.count({
        where: { organizationId: org.id }
      });
      const maxUsersAllowed = org.subscriptionPlan?.maxUsers || 25;
      if (currentUserCount >= maxUsersAllowed) {
        return res.status(403).json({
          success: false,
          message: `Organization '${org.name}' has reached its user quota (${maxUsersAllowed}) for the ${org.subscriptionPlan?.name || 'Starter'} plan.`
        });
      }
    }

    // 4. Secure Password Hashing (never logged or stored plaintext)
    const hashedPassword = await bcrypt.hash(password.trim(), 10);

    // 5. Employee ID Generation with collision retry
    let newUser = null;
    let attempts = 0;
    const maxAttempts = 3;

    while (!newUser && attempts < maxAttempts) {
      attempts++;
      const employeeId = await generateEmployeeId(template.baseRole);
      try {
        newUser = await prisma.user.create({
          data: {
            employeeId,
            name: name.trim(),
            email: cleanEmail,
            password: hashedPassword,
            phone: phone ? phone.trim() : null,
            dob: dob ? new Date(dob) : null,
            role: template.baseRole, // Strictly derived from template
            organizationId: template.organizationId, // Strictly derived from template
            accessTemplateId: template.id,
            status,
            department: department ? department.trim() : 'General',
            designation: designation ? designation.trim() : template.name
          },
          select: {
            id: true,
            employeeId: true,
            name: true,
            email: true,
            phone: true,
            role: true,
            status: true,
            department: true,
            designation: true,
            joiningDate: true,
            accessTemplateId: true,
            organizationId: true,
            organization: {
              select: { id: true, name: true, slug: true, companyCode: true }
            }
          }
        });
      } catch (err) {
        if (err.code === 'P2002' && (err.meta?.target?.includes('employeeId') || String(err).includes('employeeId')) && attempts < maxAttempts) {
          continue;
        }
        throw err;
      }
    }

    // 6. Audit Logging
    await logActivity({
      userId: req.user.id,
      action: 'REGISTER_USER_FROM_TEMPLATE',
      details: `Super Admin registered ${newUser.name} (${newUser.email}, ${newUser.employeeId}) via template '${template.name}'`,
      ipAddress: req.ip || '127.0.0.1'
    });

    await logOrgAudit(
      template.organizationId,
      req.user.id,
      'REGISTER_USER_FROM_TEMPLATE',
      `Registered user ${newUser.name} (${newUser.email}) bound to access template '${template.name}'`,
      req.ip || '127.0.0.1'
    );

    res.status(201).json({
      success: true,
      message: `User ${newUser.name} registered successfully with role ${newUser.role}!`,
      user: newUser
    });
  } catch (error) {
    console.error('Register user from template error:', error);
    res.status(500).json({ success: false, message: 'Failed to register user from template.' });
  }
};

module.exports = {
  listTemplates,
  getAvailableModules,
  getTemplateById,
  createTemplate,
  updateTemplate,
  duplicateTemplate,
  updateTemplateStatus,
  deleteTemplate,
  getTemplateMembers,
  registerUserFromTemplate
};
