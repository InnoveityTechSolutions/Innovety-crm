const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const prisma = require('../utils/db');
const { sendWelcomeEmail } = require('../services/email');
const { logActivity } = require('../utils/activityLogger');
const { getOrganizationWhere, getEffectiveOrgId } = require('../utils/organizationScope');
const { addUserToCompanyChat, removeUserFromCompanyChat } = require('../services/companyChatService');
const { disconnectUserSocket, broadcastShiftUpdate } = require('../socket');
const shiftService = require('../services/shiftService');

// Helper to auto-generate employee ID per role (e.g. EM-1001, IN-1005)
const generateEmployeeId = async (role, organizationId) => {
  const prefix = role === 'EMPLOYEE' ? 'EM' : role === 'ADMIN' ? 'AD' : role === 'TEAM_LEADER' ? 'TL' : 'IN';

  const users = await prisma.user.findMany({
    where: {
      employeeId: {
        startsWith: `${prefix}-`
      }
    },
    select: {
      employeeId: true
    }
  });

  let maxNum = 1000;
  users.forEach(u => {
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

// Helper to format DOB to temporary password (DDMMYYYY)
const formatDobToPassword = (dobString) => {
  const date = new Date(dobString);
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const year = date.getUTCFullYear();
  return `${day}${month}${year}`;
};

const createUser = async (req, res) => {
  try {
    const {
      name,
      email,
      phone,
      dob,
      college,
      department,
      joiningDate,
      role,
      candidateType,
      degree,
      currentYearSemester,
      graduationYear,
      internshipRole,
      internshipDuration,
      highestQualification,
      keySkills,
      companyName,
      designation,
      totalExperience,
      cgpa,
      noticePeriod,
      careerBreakDuration,
      careerBreakReason,
      // Enterprise Organization & Position fields
      positionId,
      branchId,
      departmentId,
      designationId,
      reportingManagerId,
      gender,
      shiftId,
      employmentType,
      probationPeriod,
      grade,
      jobLevel,
      costCenter,
      businessUnit,
      workLocation
    } = req.body;

    // Security & Business Rule Enforcement:
    // Determine strict user role based on targetRole or registry module
    let finalRole = req.body.targetRole;
    if (req.body.targetRole === 'INTERN' || role === 'INTERN') {
      finalRole = 'INTERN';
    } else if (req.body.targetRole === 'TEAM_LEADER' || role === 'TEAM_LEADER') {
      finalRole = 'TEAM_LEADER';
    } else if (req.body.targetRole === 'EMPLOYEE' || role === 'EMPLOYEE') {
      finalRole = 'EMPLOYEE';
    } else {
      // Force default to EMPLOYEE if role is unspecified or if ADMIN / SUPER_ADMIN creation is attempted
      finalRole = 'EMPLOYEE';
    }

    // Multi-Tenant Organization Resolution: getEffectiveOrgId(req) is the single source of truth
    const effectiveOrgId = getEffectiveOrgId(req);
    let finalOrganizationId = effectiveOrgId || req.body.organizationId || req.user?.organizationId;

    if (finalOrganizationId) {
      const targetOrg = await prisma.organization.findUnique({
        where: { id: finalOrganizationId },
        include: { subscriptionPlan: true }
      });
      if (!targetOrg) {
        return res.status(400).json({ message: 'Selected organization does not exist.' });
      }
      if (targetOrg.status === 'SUSPENDED') {
        return res.status(400).json({ message: 'Cannot assign user to a suspended organization.' });
      }

      // Check Organization User Quota Limit
      if (targetOrg.slug !== 'innoveity' && req.user?.role !== 'SUPER_ADMIN') {
        const currentUserCount = await prisma.user.count({
          where: { organizationId: finalOrganizationId }
        });
        const maxUsersAllowed = targetOrg.subscriptionPlan?.maxUsers || 25;
        if (currentUserCount >= maxUsersAllowed) {
          return res.status(403).json({
            message: `Your organization has reached its user limit (${maxUsersAllowed}) for the ${targetOrg.subscriptionPlan?.name || 'Starter'} plan.`
          });
        }
      }
    } else {
      const defaultOrg = await prisma.organization.findUnique({ where: { slug: 'innoveity' } });
      finalOrganizationId = defaultOrg?.id || null;
    }

    if (!name || !email || !dob) {
      return res.status(400).json({ message: 'Name, email, and date of birth are required.' });
    }

    let resumePath = null;
    let resumeDetails = {};
    if (req.files?.resume?.[0]) {
      const file = req.files.resume[0];
      resumePath = `/uploads/resumes/${file.filename}`;
      resumeDetails = {
        resumeFileName: file.filename,
        resumeOriginalName: file.originalname,
        resumePath: resumePath,
        resumeMimeType: file.mimetype,
        resumeSize: file.size
      };
    } else if (req.body.resume) {
      resumePath = req.body.resume;
    }

    let profilePicPath = null;
    if (req.files?.profilePic?.[0]) {
      profilePicPath = `/uploads/profile-pics/${req.files.profilePic[0].filename}`;
    }

    const customData = {
      ...(cgpa ? { cgpa } : {}),
      ...(noticePeriod ? { noticePeriod } : {}),
      ...(careerBreakDuration ? { careerBreakDuration } : {}),
      ...(careerBreakReason ? { careerBreakReason } : {}),
      ...resumeDetails
    };

    let finalInternshipRole = internshipRole || (finalRole === 'INTERN' ? 'INTERN' : null);

    if (candidateType && finalRole !== 'INTERN') {
      if (candidateType === 'Student') {
        if (!college && !companyName) return res.status(400).json({ message: 'College/University Name is required for Student.' });
        if (!degree) return res.status(400).json({ message: 'Degree is required for Student.' });
        if (!currentYearSemester) return res.status(400).json({ message: 'Current Year / Semester is required for Student.' });
      } else if (candidateType === 'Graduate') {
        if (!college && !companyName) return res.status(400).json({ message: 'College/University Name is required for Graduate.' });
        if (!degree) return res.status(400).json({ message: 'Degree is required for Graduate.' });
        if (!graduationYear) return res.status(400).json({ message: 'Graduation Year is required for Graduate.' });
      } else if (candidateType === 'Intern') {
        // Auto-assign internshipRole fallback without blocking onboarding
      } else if (candidateType === 'Fresher') {
        if (!highestQualification) return res.status(400).json({ message: 'Highest Qualification is required for Fresher.' });
        if (!graduationYear) return res.status(400).json({ message: 'Graduation Year is required for Fresher.' });
        if (!keySkills) return res.status(400).json({ message: 'Key Skills are required for Fresher.' });
      } else if (candidateType === 'Professional') {
        if (!companyName && !college) return res.status(400).json({ message: 'Current / Previous Company is required for Professional.' });
        if (!designation) return res.status(400).json({ message: 'Designation is required for Professional.' });
        if (!totalExperience) return res.status(400).json({ message: 'Total Experience is required for Professional.' });
      }
    }

    // Set intern default values automatically for intern onboarding
    let finalEmploymentType = employmentType || null;
    let finalStatus = req.body.status || 'ACTIVE';

    let finalJoiningDate = new Date();
    if (joiningDate) {
      const parsedJoining = new Date(joiningDate);
      if (isNaN(parsedJoining.getTime())) {
        return res.status(400).json({ message: 'Invalid joining date format.' });
      }
      if (typeof joiningDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(joiningDate.trim())) {
        finalJoiningDate = new Date(`${joiningDate.trim()}T00:00:00.000Z`);
      } else {
        finalJoiningDate = parsedJoining;
      }
    }

    let finalProbationPeriod = probationPeriod || null;
    let finalShiftId = shiftId || null;

    if (finalRole === 'INTERN') {
      finalEmploymentType = 'Internship';
      finalStatus = 'ACTIVE';
      finalProbationPeriod = null;
      if (!finalShiftId) {
        const defaultShift = await prisma.shiftMaster.findFirst({ where: { status: 'ACTIVE' } });
        if (defaultShift) finalShiftId = defaultShift.id;
      }
    }

    let finalDepartmentName = department || null;
    if (departmentId) {
      const deptObj = await prisma.departmentMaster.findUnique({ where: { id: departmentId } });
      if (!deptObj) {
        return res.status(400).json({ message: 'Selected department does not exist.' });
      }
      if (deptObj.organizationId && finalOrganizationId && deptObj.organizationId !== finalOrganizationId) {
        return res.status(403).json({ message: 'Department does not belong to your organization.' });
      }
      finalDepartmentName = deptObj.name;
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ message: 'User with this email already exists.' });
    }

    if (positionId) {
      const targetPos = await prisma.position.findUnique({ where: { id: positionId } });
      if (targetPos && targetPos.organizationId && targetPos.organizationId !== finalOrganizationId) {
        return res.status(403).json({ message: 'Position does not belong to your organization.' });
      }
    }

    const tempPasswordText = formatDobToPassword(dob);
    const hashedPassword = await bcrypt.hash(tempPasswordText, 10);

    let newUser = null;
    let attempts = 0;
    const maxAttempts = 3;

    while (!newUser && attempts < maxAttempts) {
      attempts++;
      const employeeId = await generateEmployeeId(finalRole, finalOrganizationId);
      try {
        newUser = await prisma.user.create({
          data: {
            employeeId,
            name,
            email,
            password: hashedPassword,
            phone,
            dob: new Date(dob),
            college: college || companyName || null,
            department: finalDepartmentName,
            joiningDate: finalJoiningDate,
            role: finalRole,
            status: finalStatus,
            profilePic: profilePicPath,
            candidateType: candidateType || null,
            resume: resumePath || null,
            degree: degree || null,
            currentYearSemester: currentYearSemester || null,
            graduationYear: graduationYear || null,
            internshipRole: finalInternshipRole,
            internshipDuration: internshipDuration || null,
            highestQualification: highestQualification || null,
            keySkills: keySkills || null,
            companyName: companyName || college || null,
            designation: designation || null,
            totalExperience: totalExperience || null,
            organizationId: finalOrganizationId,
            positionId: positionId || null,
            branchId: branchId || null,
            departmentId: departmentId || null,
            designationId: designationId || null,
            reportingManagerId: reportingManagerId || null,
            gender: gender || null,
            shiftId: finalShiftId,
            employmentType: finalEmploymentType,
            probationPeriod: finalProbationPeriod,
            grade: grade || null,
            jobLevel: jobLevel || null,
            costCenter: costCenter || null,
            businessUnit: businessUnit || null,
            workLocation: workLocation || null,
            autoClockOutEnabled: (req.body.autoClockOutEnabled !== undefined)
              ? (req.body.autoClockOutEnabled === true || req.body.autoClockOutEnabled === 'true')
              : true,
            customData: Object.keys(customData).length > 0 ? customData : undefined
          }
        });
      } catch (err) {
        if (err.code === 'P2002' && (err.meta?.target?.includes('employeeId') || String(err).includes('employeeId')) && attempts < maxAttempts) {
          console.warn(`[createUser] Concurrency collision on employeeId. Retrying attempt ${attempts}...`);
          continue;
        }
        throw err;
      }
    }

    console.log('[createUser] Successfully created user:', {
      createdEmployeeId: newUser.employeeId,
      createdUserId: newUser.id,
      role: newUser.role
    });

    // Sync user with Company Chat Room
    await addUserToCompanyChat(newUser.id, newUser.organizationId);

    // Send automated email in background
    sendWelcomeEmail(newUser, tempPasswordText).catch((err) => {
      console.error('Failed to send welcome email to user:', newUser.email, err);
    });

    // Sync shiftMember if shift is assigned
    if (finalShiftId) {
      try {
        await prisma.shiftMember.upsert({
          where: { userId: newUser.id },
          create: { shiftId: finalShiftId, userId: newUser.id, assignedById: req.user?.id || null, effectiveFrom: new Date() },
          update: { shiftId: finalShiftId, assignedById: req.user?.id || null, effectiveFrom: new Date() }
        });
        broadcastShiftUpdate(finalOrganizationId, { action: 'USER_SHIFT_ASSIGNED', userId: newUser.id, shiftId: finalShiftId });
      } catch (smErr) {
        console.warn('[createUser] Failed to sync shiftMember:', smErr.message);
      }
    }

    // Sync attendanceLocationIds if provided
    if (req.body.attendanceLocationIds && Array.isArray(req.body.attendanceLocationIds)) {
      try {
        const validLocs = await prisma.attendanceLocation.findMany({
          where: {
            id: { in: req.body.attendanceLocationIds },
            organizationId: newUser.organizationId
          },
          select: { id: true }
        });
        if (validLocs.length > 0) {
          await prisma.userAttendanceLocation.createMany({
            data: validLocs.map(l => ({
              userId: newUser.id,
              attendanceLocationId: l.id
            }))
          });
        }
      } catch (lErr) {
        console.warn('[onboardUser] Failed to sync attendance locations:', lErr.message);
      }
    }

    await logActivity({
      userId: req.user.id,
      action: 'USER_CREATE',
      details: `Created new user ${newUser.name} (${newUser.employeeId}) with role ${finalRole}`
    });

    const { password: _, ...userWithoutPassword } = newUser;
    console.log('[createUser] Returning success response');
    res.status(201).json(userWithoutPassword);
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ message: error.message || 'Failed to create user.' });
  }
};

const getAllUsers = async (req, res) => {
  try {
    const { role, status, teamId, search, department, position, page = 1, limit = 50, excludeSuperAdmin = 'true', excludeSelf, organizationId } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Filter clauses
    const where = {};

    // Multi-tenant Organization Scoping
    if (req.user?.role === 'SUPER_ADMIN') {
      if (organizationId && organizationId !== 'all') {
        where.organizationId = organizationId;
      }
    } else {
      where.organizationId = req.user?.organizationId || null;
    }

    // Always exclude Super Admin account from registry listings
    if (excludeSuperAdmin === 'true' || role?.includes('ADMIN') || role?.includes('TEAM_LEADER')) {
      where.email = { not: 'admin@enterprise-crm.com' };
      where.employeeId = { not: 'AD-0001' };
    }

    if (excludeSelf === 'true' && req.user?.id) {
      where.id = { not: req.user.id };
    }

    if (role) {
      let parsedRoles = [];
      if (typeof role === 'string' && role.includes(',')) {
        parsedRoles = role.split(',').map(r => r.trim());
      } else if (Array.isArray(role)) {
        parsedRoles = role;
      } else {
        parsedRoles = [role];
      }
      parsedRoles = parsedRoles.filter(r => r === 'ADMIN' || r === 'TEAM_LEADER' || r === 'INTERN' || r === 'EMPLOYEE');
      if (parsedRoles.length > 0) {
        where.role = { in: parsedRoles };
      }
    }
    if (status) {
      where.status = status;
    }
    if (teamId) {
      where.teamMembers = {
        some: { teamId }
      };
    }
    if (department) {
      where.OR = [
        ...(where.OR || []),
        { department: { equals: department } },
        { departmentRef: { name: { equals: department } } },
        { departmentId: department }
      ];
    }
    if (position) {
      where.position = {
        name: { equals: position }
      };
    }

    if (search) {
      where.OR = [
        ...(where.OR || []),
        { name: { contains: search } },
        { email: { contains: search } },
        { employeeId: { contains: search } },
        { department: { contains: search } },
        { college: { contains: search } },
        { companyName: { contains: search } },
        { candidateType: { contains: search } }
      ];
    }

    const [users, totalCount] = await prisma.$transaction([
      prisma.user.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { createdAt: 'desc' },
        include: {
          organization: { select: { id: true, name: true, slug: true, logo: true, companyCode: true, timezone: true } },
          position: true,
          branch: true,
          departmentRef: true,
          designationRef: true,
          reportingManager: { select: { id: true, name: true, employeeId: true, role: true } },
          shiftRef: true,
          teamMembers: {
            include: { team: true }
          },
          assignedAttendanceLocations: {
            include: {
              attendanceLocation: true
            }
          }
        }
      }),
      prisma.user.count({ where })
    ]);

    const usersWithoutPassword = users.map((u) => {
      const { password, ...details } = u;
      return {
        ...details,
        department: details.department || details.departmentRef?.name || null,
        profilePhoto: details.profilePic || null,
        assignedLocations: details.assignedAttendanceLocations ? details.assignedAttendanceLocations.map(a => a.attendanceLocation) : [],
        attendanceLocationIds: details.assignedAttendanceLocations ? details.assignedAttendanceLocations.map(a => a.attendanceLocationId) : []
      };
    });

    res.json({
      users: usersWithoutPassword,
      meta: {
        totalCount,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(totalCount / limitNum)
      }
    });
  } catch (error) {
    console.error('Get all users error:', error);
    res.status(500).json({ message: 'Failed to fetch users.' });
  }
};

const getUserById = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    const { id } = req.params;
    const user = await prisma.user.findFirst({
      where: getOrganizationWhere(req, { id }),
      include: {
        organization: { select: { id: true, name: true, slug: true, logo: true, companyCode: true, timezone: true } },
        position: true,
        branch: true,
        departmentRef: true,
        designationRef: true,
        reportingManager: { select: { id: true, name: true, employeeId: true, role: true } },
        shiftRef: true,
        shiftAssignment: {
          include: { shift: true }
        },
        positionHistories: {
          include: {
            oldPosition: true,
            newPosition: true,
            changedBy: { select: { id: true, name: true, employeeId: true, role: true } }
          },
          orderBy: { createdAt: 'desc' }
        },
        teamMembers: {
          include: { team: { include: { leader: true } } }
        },
        attendances: {
          take: 30,
          orderBy: { date: 'desc' }
        },
        assignedAssets: {
          orderBy: { createdAt: 'desc' }
        },
        assignedAttendanceLocations: {
          include: {
            attendanceLocation: true
          }
        }
      }
    });

    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const { password, ...details } = user;

    // Dynamically enrich with active shift if shiftAssignment is missing
    let shiftAssignment = details.shiftAssignment;
    if (!shiftAssignment?.shift) {
      const dynamicShift = await shiftService.getEmployeeShiftWithSchedule(user.id);
      if (dynamicShift) {
        shiftAssignment = {
          userId: user.id,
          shiftId: dynamicShift.id,
          shift: dynamicShift
        };
      }
    }

    res.json({
      ...details,
      shiftAssignment,
      department: details.department || details.departmentRef?.name || null,
      assignedLocations: details.assignedAttendanceLocations ? details.assignedAttendanceLocations.map(a => a.attendanceLocation) : [],
      attendanceLocationIds: details.assignedAttendanceLocations ? details.assignedAttendanceLocations.map(a => a.attendanceLocationId) : []
    });
  } catch (error) {
    console.error('Get user by ID error:', error);
    res.status(500).json({ message: 'Failed to fetch user details.' });
  }
};

const editUser = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      email,
      phone,
      dob,
      college,
      department,
      joiningDate,
      role,
      status,
      candidateType,
      degree,
      currentYearSemester,
      graduationYear,
      internshipRole,
      internshipDuration,
      highestQualification,
      keySkills,
      companyName,
      designation,
      totalExperience,
      // Organization & Position fields
      positionId,
      branchId,
      departmentId,
      designationId,
      reportingManagerId,
      gender,
      shiftId,
      employmentType,
      probationPeriod,
      grade,
      jobLevel,
      costCenter,
      businessUnit,
      workLocation
    } = req.body;

    // Fetch current user to compare DOB and position
    const existingUser = await prisma.user.findUnique({ where: { id } });
    if (!existingUser) {
      return res.status(404).json({ message: 'User not found.' });
    }

    // Organization tenant isolation enforcement
    if (req.user?.role !== 'SUPER_ADMIN' && existingUser.organizationId && req.user?.organizationId && existingUser.organizationId !== req.user.organizationId) {
      return res.status(403).json({ message: 'Access denied: Employee belongs to a different organization.' });
    }

    // Auto Clock-Out individual setting update enforcement: only ADMIN or SUPER_ADMIN
    if (req.body.autoClockOutEnabled !== undefined) {
      if (req.user?.role !== 'ADMIN' && req.user?.role !== 'SUPER_ADMIN') {
        return res.status(403).json({ message: 'Unauthorized: Only Administrators can modify employee Auto Clock-Out settings.' });
      }
    }

    const data = {
      name,
      email,
      phone,
      college: college !== undefined ? (college || companyName || null) : existingUser.college,
      department: department !== undefined ? department : existingUser.department
    };

    // Role & status modification safeguards:
    // Only SUPER_ADMIN or ADMIN can change roles or status.
    // Users cannot change their own role or elevate anyone to SUPER_ADMIN.
    if (role !== undefined) {
      if (req.user?.role === 'SUPER_ADMIN') {
        data.role = role;
      } else if (req.user?.role === 'ADMIN' && existingUser.id !== req.user?.id && role !== 'SUPER_ADMIN') {
        data.role = role;
      }
    }
    if (status !== undefined) {
      if (req.user?.role === 'SUPER_ADMIN' || (req.user?.role === 'ADMIN' && existingUser.id !== req.user?.id)) {
        data.status = status;
      }
    }

    // Access Template assignment safeguards:
    // Only SUPER_ADMIN can change accessTemplateId, and template must belong to target user's organization
    if (req.body.accessTemplateId !== undefined) {
      if (req.user?.role === 'SUPER_ADMIN') {
        if (req.body.accessTemplateId === null || req.body.accessTemplateId === '') {
          data.accessTemplateId = null;
        } else {
          const targetTemplate = await prisma.accessTemplate.findUnique({
            where: { id: req.body.accessTemplateId }
          });
          if (!targetTemplate) {
            return res.status(400).json({ message: 'Selected access template does not exist.' });
          }
          if (targetTemplate.organizationId !== (data.organizationId || existingUser.organizationId)) {
            return res.status(403).json({ message: 'Access template belongs to a different organization.' });
          }
          data.accessTemplateId = req.body.accessTemplateId;
        }
      }
    }

    if (req.body.autoClockOutEnabled !== undefined) {
      data.autoClockOutEnabled = req.body.autoClockOutEnabled === true || req.body.autoClockOutEnabled === 'true';
    }

    if (req.user?.role === 'SUPER_ADMIN' && req.body.organizationId !== undefined && req.body.organizationId !== null && req.body.organizationId !== '') {
      const targetOrg = await prisma.organization.findUnique({ where: { id: req.body.organizationId } });
      if (!targetOrg) {
        return res.status(400).json({ message: 'Selected organization does not exist.' });
      }
      if (targetOrg.status === 'SUSPENDED') {
        return res.status(400).json({ message: 'Cannot assign user to a suspended organization.' });
      }
      data.organizationId = req.body.organizationId;
    }

    if (candidateType !== undefined) data.candidateType = candidateType || null;
    if (degree !== undefined) data.degree = degree || null;
    if (currentYearSemester !== undefined) data.currentYearSemester = currentYearSemester || null;
    if (graduationYear !== undefined) data.graduationYear = graduationYear || null;
    if (internshipRole !== undefined) data.internshipRole = internshipRole || null;
    if (internshipDuration !== undefined) data.internshipDuration = internshipDuration || null;
    if (highestQualification !== undefined) data.highestQualification = highestQualification || null;
    if (keySkills !== undefined) data.keySkills = keySkills || null;
    if (companyName !== undefined) data.companyName = companyName || college || null;
    if (designation !== undefined) data.designation = designation || null;
    if (totalExperience !== undefined) data.totalExperience = totalExperience || null;

    if (departmentId !== undefined) {
      data.departmentId = departmentId || null;
      if (departmentId && !data.department) {
        const deptObj = await prisma.departmentMaster.findUnique({ where: { id: departmentId } });
        if (deptObj) {
          data.department = deptObj.name;
        }
      }
    }
    if (reportingManagerId !== undefined) data.reportingManagerId = reportingManagerId || null;
    if (gender !== undefined) data.gender = gender || null;
    if (shiftId !== undefined) data.shiftId = shiftId || null;
    if (employmentType !== undefined) data.employmentType = employmentType || null;
    if (probationPeriod !== undefined) data.probationPeriod = probationPeriod || null;
    if (grade !== undefined) data.grade = grade || null;
    if (jobLevel !== undefined) data.jobLevel = jobLevel || null;
    if (costCenter !== undefined) data.costCenter = costCenter || null;
    if (businessUnit !== undefined) data.businessUnit = businessUnit || null;
    if (workLocation !== undefined) data.workLocation = workLocation || null;

    // Track Position History if positionId changes
    if (positionId !== undefined && positionId !== existingUser.positionId) {
      if (positionId) {
        const targetPos = await prisma.position.findUnique({ where: { id: positionId } });
        if (targetPos && targetPos.organizationId && targetPos.organizationId !== existingUser.organizationId) {
          return res.status(400).json({ message: 'Employee and Position belong to different organizations.' });
        }
      }
      data.positionId = positionId || null;

      await prisma.positionHistory.create({
        data: {
          userId: id,
          oldPositionId: existingUser.positionId,
          newPositionId: positionId || null,
          changedById: req.user?.id || null,
          reason: req.body.positionChangeReason || 'Administrative Position Change'
        }
      });

      const oldPos = existingUser.positionId ? await prisma.position.findUnique({ where: { id: existingUser.positionId } }) : null;
      const newPos = positionId ? await prisma.position.findUnique({ where: { id: positionId } }) : null;

      await logActivity({
        userId: req.user?.id || id,
        action: 'POSITION_CHANGED',
        details: `Position changed for ${existingUser.name} (${existingUser.employeeId}): ` +
                 `Old Position: ${oldPos?.name || 'None'} -> New Position: ${newPos?.name || 'None'} ` +
                 `by Admin ${req.user?.name || 'System'}`
      });
    }

    let customDataModified = false;
    const existingCustom = (typeof existingUser.customData === 'object' && existingUser.customData) ? { ...existingUser.customData } : {};

    if (req.body.cgpa !== undefined) {
      existingCustom.cgpa = req.body.cgpa ? String(req.body.cgpa).trim() : null;
      customDataModified = true;
    }
    if (req.body.noticePeriod !== undefined) {
      existingCustom.noticePeriod = req.body.noticePeriod ? String(req.body.noticePeriod).trim() : null;
      customDataModified = true;
    }

    if (req.files?.resume?.[0]) {
      const file = req.files.resume[0];
      const resumePath = `/uploads/resumes/${file.filename}`;
      data.resume = resumePath;
      existingCustom.resumeFileName = file.filename;
      existingCustom.resumeOriginalName = file.originalname;
      existingCustom.resumePath = resumePath;
      existingCustom.resumeMimeType = file.mimetype;
      existingCustom.resumeSize = file.size;
      customDataModified = true;
    } else if (req.body.resume !== undefined) {
      data.resume = req.body.resume || null;
    }

    if (customDataModified) {
      data.customData = existingCustom;
    }

    if (req.files?.profilePic?.[0]) {
      data.profilePic = `/uploads/profile-pics/${req.files.profilePic[0].filename}`;
    }

    let dobPasswordReset = false;

    if (dob) {
      const newDob = new Date(dob);
      data.dob = newDob;

      // Detect DOB change for non-admin roles and auto-reset password
      const oldDobStr = existingUser.dob ? existingUser.dob.toISOString().split('T')[0] : null;
      const newDobStr = newDob.toISOString().split('T')[0];
      const roleRequiresReset = ['INTERN', 'EMPLOYEE', 'TEAM_LEADER'].includes(existingUser.role);

      if (roleRequiresReset && oldDobStr !== newDobStr) {
        const newTempPassword = formatDobToPassword(newDob);
        data.password = await bcrypt.hash(newTempPassword, 10);
        dobPasswordReset = true;

        await logActivity({
          userId: req.user.id,
          action: 'USER_DOB_CHANGED',
          details: `Admin updated DOB for ${existingUser.name} (${existingUser.employeeId}): ` +
                   `${oldDobStr || 'not set'} → ${newDobStr}. ` +
                   `Initial password automatically reset based on new DOB.`
        });
      }
    }

    if (joiningDate !== undefined && joiningDate !== null && joiningDate !== '') {
      if (!['ADMIN', 'SUPER_ADMIN'].includes(req.user?.role)) {
        return res.status(403).json({ message: 'Unauthorized: Only Administrators can modify employee Joining Date.' });
      }
      const parsedJoining = new Date(joiningDate);
      if (isNaN(parsedJoining.getTime())) {
        return res.status(400).json({ message: 'Invalid joining date format.' });
      }
      if (typeof joiningDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(joiningDate.trim())) {
        data.joiningDate = new Date(`${joiningDate.trim()}T00:00:00.000Z`);
      } else {
        data.joiningDate = parsedJoining;
      }
    }

    const updatedUser = await prisma.user.update({
      where: { id },
      data
    });

    if (shiftId !== undefined) {
      try {
        if (shiftId) {
          await prisma.shiftMember.upsert({
            where: { userId: id },
            create: { shiftId, userId: id, assignedById: req.user?.id || null, effectiveFrom: new Date() },
            update: { shiftId, assignedById: req.user?.id || null, effectiveFrom: new Date() }
          });
        } else {
          await prisma.shiftMember.deleteMany({
            where: { userId: id }
          });
        }
        broadcastShiftUpdate(updatedUser.organizationId, { action: 'USER_SHIFT_UPDATED', userId: id, shiftId });
      } catch (smErr) {
        console.warn('[editUser] Failed to sync shiftMember:', smErr.message);
      }
    }

    // Phase 4: Notify active user session on template assignment change
    if (req.body.accessTemplateId !== undefined) {
      try {
        const { getIo } = require('../socket');
        const io = getIo();
        if (io) {
          io.emit('user_permissions_updated', {
            userId: id,
            accessTemplateId: updatedUser.accessTemplateId,
            organizationId: updatedUser.organizationId
          });
        }
      } catch (e) {}
    }

    // Sync attendanceLocationIds if provided
    const { attendanceLocationIds } = req.body;
    if (attendanceLocationIds !== undefined) {
      try {
        const locIds = Array.isArray(attendanceLocationIds) ? attendanceLocationIds : [];
        const validLocs = locIds.length > 0 ? await prisma.attendanceLocation.findMany({
          where: {
            id: { in: locIds },
            organizationId: updatedUser.organizationId
          },
          select: { id: true }
        }) : [];
        const validIds = validLocs.map(l => l.id);

        await prisma.$transaction([
          prisma.userAttendanceLocation.deleteMany({ where: { userId: id } }),
          prisma.userAttendanceLocation.createMany({
            data: validIds.map(locId => ({
              userId: id,
              attendanceLocationId: locId
            }))
          })
        ]);
      } catch (locErr) {
        console.warn('[editUser] Failed to sync attendance locations:', locErr.message);
      }
    }

    await logActivity({
      userId: req.user.id,
      action: 'USER_EDIT',
      details: `Updated user info for ${updatedUser.name} (${updatedUser.employeeId})`
    });

    const { password: _, ...userWithoutPassword } = updatedUser;
    res.json({ ...userWithoutPassword, dobPasswordReset });
  } catch (error) {
    console.error('Edit user error:', error);
    res.status(500).json({ message: error.message || 'Failed to update user.' });
  }
};

const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    if (user.role === 'SUPER_ADMIN' || user.email === 'admin@enterprise-crm.com' || user.employeeId === 'AD-0001') {
      return res.status(403).json({ success: false, message: 'Super Admin account cannot be modified or deleted.' });
    }

    if (user.role === 'ADMIN' && user.organizationId) {
      const activeAdminCount = await prisma.user.count({
        where: {
          organizationId: user.organizationId,
          role: 'ADMIN',
          status: 'ACTIVE',
          NOT: { id: user.id }
        }
      });
      if (activeAdminCount === 0) {
        return res.status(400).json({
          success: false,
          message: 'Cannot delete the primary Company Admin. Please assign another Company Admin to this organization first.'
        });
      }
    }

    // Wrap the complete deletion inside an atomic Prisma transaction
    await prisma.$transaction(async (tx) => {
      // 1. Reset references on assigned Assets: set assignedToId = null, assignedDate = null, expectedReturn = null, status = AVAILABLE
      await tx.asset.updateMany({
        where: { assignedToId: id },
        data: {
          assignedToId: null,
          assignedDate: null,
          expectedReturn: null,
          status: 'AVAILABLE'
        }
      });

      // 2. Set assignedById = null on AssetAssignment history
      await tx.assetAssignment.updateMany({
        where: { assignedById: id },
        data: { assignedById: null }
      });

      // 3. Reset references on assigned Tickets: set assigneeId = null
      await tx.ticket.updateMany({
        where: { assigneeId: id },
        data: { assigneeId: null }
      });

      // 4. Reset references on Teams led by this user: set leaderId = null
      await tx.team.updateMany({
        where: { leaderId: id },
        data: { leaderId: null }
      });

      // 5. Delete team memberships
      await tx.teamMember.deleteMany({
        where: { userId: id }
      });

      // 6. Reset targetUserId on Announcements
      await tx.announcement.updateMany({
        where: { targetUserId: id },
        data: { targetUserId: null }
      });

      // 7. Delete ChatRoomMember records
      await tx.chatRoomMember.deleteMany({
        where: { userId: id }
      });

      // 8. Permanently delete user record from MySQL
      await tx.user.delete({
        where: { id }
      });
    });

    // Disconnect active socket connection if user is online
    if (disconnectUserSocket) {
      disconnectUserSocket(id);
    }

    await logActivity({
      userId: req.user.id,
      action: 'USER_DELETE',
      details: `Deleted user ${user.name} (${user.employeeId})`
    });

    return res.json({
      success: true,
      message: 'Record deleted successfully.',
      deletedUserId: id
    });
  } catch (error) {
    console.error('Delete user error:', error);
    return res.status(500).json({ success: false, message: 'Failed to delete record. Please try again.' });
  }
};

const toggleUserStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body; // ACTIVE or INACTIVE

    if (status !== 'ACTIVE' && status !== 'INACTIVE') {
      return res.status(400).json({ message: 'Invalid status value.' });
    }

    const updatedUser = await prisma.user.update({
      where: { id },
      data: { status }
    });

    if (status === 'ACTIVE') {
      await addUserToCompanyChat(id);
    } else {
      await removeUserFromCompanyChat(id);
    }

    await logActivity({
      userId: req.user.id,
      action: 'USER_STATUS_TOGGLE',
      details: `Set status of ${updatedUser.name} to ${status}`
    });

    res.json({ message: `User status set to ${status}.` });
  } catch (error) {
    console.error('Toggle status error:', error);
    res.status(500).json({ message: 'Failed to modify account status.' });
  }
};

const resetUserPassword = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    if (!user.dob) {
      return res.status(400).json({ message: 'DOB must be set on user record to reset password.' });
    }

    const tempPasswordText = formatDobToPassword(user.dob);
    const hashedPassword = await bcrypt.hash(tempPasswordText, 10);

    await prisma.user.update({
      where: { id },
      data: { password: hashedPassword }
    });

    await logActivity({
      userId: req.user.id,
      action: 'USER_PASSWORD_RESET',
      details: `Admin reset password for user ${user.name} (${user.employeeId})`
    });

    res.json({
      message: 'Password successfully reset to DOB format.',
      tempPassword: tempPasswordText
    });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ message: 'Failed to reset password.' });
  }
};

const bulkImport = async (req, res) => {
  try {
    const { usersList } = req.body; // Array of user objects

    if (!Array.isArray(usersList) || usersList.length === 0) {
      return res.status(400).json({ message: 'Invalid or empty user list provided.' });
    }

    const createdUsers = [];
    const skippedUsers = [];

    for (let u of usersList) {
      const { name, email, phone, dob, college, department, role, joiningDate } = u;

      if (!name || !email || !dob || !role) {
        skippedUsers.push({ email, reason: 'Missing required fields.' });
        continue;
      }

      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        skippedUsers.push({ email, reason: 'Email already exists.' });
        continue;
      }

      const employeeId = await generateEmployeeId(role);
      const tempPasswordText = formatDobToPassword(dob);
      const hashedPassword = await bcrypt.hash(tempPasswordText, 10);

      const parsedDob = new Date(dob);
      if (isNaN(parsedDob.getTime())) {
        console.warn(`Skipping invalid DOB line in bulk import for email: ${email}`);
        continue;
      }

      let parsedJoining = new Date();
      if (joiningDate) {
        const p = new Date(joiningDate);
        if (!isNaN(p.getTime())) {
          if (typeof joiningDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(joiningDate.trim())) {
            parsedJoining = new Date(`${joiningDate.trim()}T00:00:00.000Z`);
          } else {
            parsedJoining = p;
          }
        }
      }

      const created = await prisma.user.create({
        data: {
          employeeId,
          name,
          email,
          password: hashedPassword,
          phone,
          dob: parsedDob,
          joiningDate: parsedJoining,
          college,
          department,
          role,
          status: 'ACTIVE'
        }
      });

      await addUserToCompanyChat(created.id);

      sendWelcomeEmail(created, tempPasswordText).catch((err) => {
        console.error('Failed to send welcome email inside bulk import:', created.email, err);
      });

      createdUsers.push(created.email);
    }

    await logActivity({
      userId: req.user.id,
      action: 'USER_BULK_IMPORT',
      details: `Bulk imported ${createdUsers.length} users successfully. Skipped ${skippedUsers.length}.`
    });

    res.status(201).json({
      message: `Successfully imported ${createdUsers.length} users.`,
      createdCount: createdUsers.length,
      skipped: skippedUsers
    });
  } catch (error) {
    console.error('Bulk import error:', error);
    res.status(500).json({ message: 'Failed to process bulk import.' });
  }
};

const bulkDelete = async (req, res) => {
  try {
    const { ids } = req.body; // Array of IDs

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: 'Invalid or empty list of IDs.' });
    }

    const deleteResult = await prisma.user.deleteMany({
      where: {
        id: { in: ids },
        role: { not: 'ADMIN' } // Prevent deleting admins
      }
    });

    await logActivity({
      userId: req.user.id,
      action: 'USER_BULK_DELETE',
      details: `Bulk deleted ${deleteResult.count} users.`
    });

    res.json({ message: `Successfully deleted ${deleteResult.count} users.` });
  } catch (error) {
    console.error('Bulk delete error:', error);
    res.status(500).json({ message: 'Failed to process bulk delete.' });
  }
};

const bulkUpdateAutoClockOut = async (req, res) => {
  try {
    const ids = req.body.userIds || req.body.ids;
    const enabledInput = req.body.enabled !== undefined ? req.body.enabled : req.body.autoClockOutEnabled;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: 'Invalid or empty list of employee IDs.' });
    }

    if (enabledInput === undefined || enabledInput === null) {
      return res.status(400).json({ message: 'The "enabled" boolean property is required.' });
    }

    const enabled = enabledInput === true || enabledInput === 'true';

    // Retrieve candidate users to validate existence, role, and tenant boundaries
    const candidateUsers = await prisma.user.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        name: true,
        employeeId: true,
        email: true,
        role: true,
        organizationId: true
      }
    });

    const foundIdMap = new Map(candidateUsers.map(u => [u.id, u]));
    const eligibleIds = [];
    const failedItems = [];

    for (const targetId of ids) {
      const userObj = foundIdMap.get(targetId);
      if (!userObj) {
        failedItems.push({ id: targetId, reason: 'Employee record not found.' });
        continue;
      }

      // Prevent modifying super admin account
      if (userObj.role === 'SUPER_ADMIN' || userObj.employeeId === 'AD-0001' || userObj.email === 'superadmin@enterprise-crm.com') {
        failedItems.push({ id: targetId, employeeId: userObj.employeeId, reason: 'Super Admin account setting cannot be modified.' });
        continue;
      }

      // Enforce organization isolation: non-super-admins cannot modify users of another organization
      if (req.user?.role !== 'SUPER_ADMIN' && userObj.organizationId && req.user?.organizationId && userObj.organizationId !== req.user.organizationId) {
        failedItems.push({ id: targetId, employeeId: userObj.employeeId, reason: 'Access denied: Employee belongs to a different organization.' });
        continue;
      }

      eligibleIds.push(targetId);
    }

    let updatedCount = 0;
    if (eligibleIds.length > 0) {
      const updateResult = await prisma.user.updateMany({
        where: { id: { in: eligibleIds } },
        data: { autoClockOutEnabled: enabled }
      });
      updatedCount = updateResult.count;
    }

    await logActivity({
      userId: req.user.id,
      action: 'USER_BULK_AUTO_CLOCK_OUT_UPDATE',
      details: `Bulk updated Auto Clock-Out to ${enabled ? 'ENABLED' : 'DISABLED'} for ${updatedCount} employees. Total requested: ${ids.length}. Failed: ${failedItems.length}.`
    }).catch(() => {});

    const failedCount = failedItems.length;
    let message = '';
    if (failedCount === 0) {
      message = `Successfully ${enabled ? 'enabled' : 'disabled'} Auto Clock-Out for all ${updatedCount} selected employees.`;
    } else if (updatedCount === 0) {
      message = `Failed to update Auto Clock-Out. None of the ${failedCount} selected employees could be updated.`;
    } else {
      message = `Updated ${updatedCount} employees successfully (${failedCount} failed or skipped due to security restrictions).`;
    }

    res.json({
      success: true,
      enabled,
      updatedCount,
      failedCount,
      totalCount: ids.length,
      failedItems,
      message
    });
  } catch (error) {
    console.error('Bulk update auto clock out error:', error);
    res.status(500).json({ message: 'Failed to process bulk auto clock-out update.' });
  }
};

// Helper to convert Employee ID prefix while preserving numeric sequence
const convertEmployeeId = (currentId, targetRole) => {
  const targetPrefix = targetRole === 'EMPLOYEE' ? 'EMP' : targetRole === 'TEAM_LEADER' ? 'TL' : targetRole === 'ADMIN' ? 'AD' : 'IN';

  if (!currentId) {
    return `${targetPrefix}-1001`;
  }

  const match = currentId.match(/^(IN|EMP|EM|TL|AD|USR|EMP-)?[-_]?(\d+)$/i);
  if (match && match[2]) {
    return `${targetPrefix}-${match[2]}`;
  }

  return `${targetPrefix}-${currentId}`;
};

const promoteUser = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      targetRole,
      positionId,
      departmentId,
      department,
      reportingManagerId,
      reason,
      effectiveDate
    } = req.body;

    if (req.user.role !== 'ADMIN' && req.user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ message: 'Only Admin and Super Admin can perform user promotions.' });
    }

    if (!targetRole || !positionId || !reason) {
      return res.status(400).json({ message: 'Target Role, Position, and Promotion Reason are required.' });
    }

    const existingUser = await prisma.user.findUnique({
      where: { id },
      include: { position: true }
    });

    if (!existingUser) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const roleHierarchy = {
      INTERN: 1,
      EMPLOYEE: 2,
      TEAM_LEADER: 3,
      ADMIN: 4,
      SUPER_ADMIN: 5
    };

    const currentLevel = roleHierarchy[existingUser.role] || 1;
    const targetLevel = roleHierarchy[targetRole];

    if (!targetLevel) {
      return res.status(400).json({ message: `Invalid target role: ${targetRole}` });
    }

    if (existingUser.role === 'SUPER_ADMIN') {
      return res.status(400).json({ message: 'Super Admin cannot be promoted further.' });
    }

    if (targetLevel <= currentLevel) {
      return res.status(400).json({ message: `User is already at ${existingUser.role} role. Demotions or self-promotions are not permitted.` });
    }

    if (targetLevel > currentLevel + 1 && req.user.role !== 'SUPER_ADMIN') {
      return res.status(400).json({ message: `Non-sequential promotion from ${existingUser.role} to ${targetRole} requires Super Admin override.` });
    }

    const targetPosition = await prisma.position.findUnique({ where: { id: positionId } });
    if (!targetPosition) {
      return res.status(400).json({ message: 'Selected target position does not exist.' });
    }
    if (targetPosition.organizationId && targetPosition.organizationId !== existingUser.organizationId) {
      return res.status(400).json({ message: 'Employee and Position belong to different organizations.' });
    }

    const newEmployeeId = convertEmployeeId(existingUser.employeeId, targetRole);
    const promoEffectiveDate = effectiveDate ? new Date(effectiveDate) : new Date();

    // Sanitize foreign keys and required values
    let cleanDeptId = (departmentId && departmentId.trim() !== '') ? departmentId : (existingUser.departmentId || null);
    let cleanManagerId = (reportingManagerId && reportingManagerId.trim() !== '') ? reportingManagerId : (existingUser.reportingManagerId || null);
    const prevEmpId = existingUser.employeeId || `IN-${existingUser.id.substring(0, 4)}`;

    // Verify foreign keys if supplied
    if (cleanDeptId) {
      const deptExists = await prisma.departmentMaster.findUnique({ where: { id: cleanDeptId } });
      if (!deptExists) {
        console.warn(`[PROMOTION] Department ID ${cleanDeptId} not found, resetting departmentId to null.`);
        cleanDeptId = null;
      }
    }

    if (cleanManagerId) {
      const mgrExists = await prisma.user.findUnique({ where: { id: cleanManagerId } });
      if (!mgrExists) {
        console.warn(`[PROMOTION] Reporting Manager ID ${cleanManagerId} not found, resetting managerId to null.`);
        cleanManagerId = null;
      }
    }

    console.log('[PROMOTION PRE-FLIGHT CHECK]:');
    console.log('- Promoted User ID:', id);
    console.log('- Current Role:', existingUser.role, '-> Target Role:', targetRole);
    console.log('- Current Emp ID:', prevEmpId, '-> New Emp ID:', newEmployeeId);
    console.log('- Target Position ID:', targetPosition.id, '(', targetPosition.name, ')');
    console.log('- Clean Dept ID:', cleanDeptId);
    console.log('- Clean Manager ID:', cleanManagerId);
    console.log('- Promoted By User ID:', req.user.id);

    const result = await prisma.$transaction(async (tx) => {
      console.log('-> STEP 1: Updating User Record in-place...');
      const updatedUser = await tx.user.update({
        where: { id },
        data: {
          role: targetRole,
          employeeId: newEmployeeId,
          positionId: targetPosition.id,
          departmentId: cleanDeptId,
          department: department || existingUser.department,
          reportingManagerId: cleanManagerId,
          promotionDate: promoEffectiveDate,
          promotionEligible: false
        },
        include: {
          position: true,
          departmentRef: true,
          reportingManager: { select: { id: true, name: true, email: true } }
        }
      });
      console.log('-> STEP 1 SUCCESS: User updated.');

      console.log('-> STEP 2: Creating PromotionHistory record...');
      const promotionHistory = await tx.promotionHistory.create({
        data: {
          userId: id,
          previousRole: existingUser.role,
          newRole: targetRole,
          previousPositionId: existingUser.positionId || null,
          newPositionId: targetPosition.id,
          previousEmployeeId: prevEmpId,
          newEmployeeId: newEmployeeId,
          promotedById: req.user.id,
          promotionReason: reason,
          effectiveDate: promoEffectiveDate
        }
      });
      console.log('-> STEP 2 SUCCESS: PromotionHistory created.');

      console.log('-> STEP 3: Creating PositionHistory record...');
      await tx.positionHistory.create({
        data: {
          userId: id,
          oldPositionId: existingUser.positionId || null,
          newPositionId: targetPosition.id,
          changedById: req.user.id,
          reason: `PROMOTION: ${existingUser.role} -> ${targetRole} (${reason})`,
          effectiveDate: promoEffectiveDate
        }
      });
      console.log('-> STEP 3 SUCCESS: PositionHistory created.');

      console.log('-> STEP 4: Creating ActivityLog record...');
      await tx.activityLog.create({
        data: {
          userId: req.user.id,
          action: 'USER_PROMOTED',
          details: `Promoted ${existingUser.name} from ${existingUser.role} (${prevEmpId}) to ${targetRole} (${newEmployeeId}) - Position: ${targetPosition.name}`
        }
      });
      console.log('-> STEP 4 SUCCESS: ActivityLog created.');

      console.log('-> STEP 5: Creating Notification record...');
      await tx.notification.create({
        data: {
          userId: id,
          title: '🎉 Congratulations! You have been promoted',
          message: `You have been officially promoted from ${existingUser.role} to ${targetRole} as ${targetPosition.name} (Employee ID: ${newEmployeeId}). Effective Date: ${promoEffectiveDate.toLocaleDateString()}`,
          type: 'PROMOTION',
          isRead: false
        }
      });
      console.log('-> STEP 5 SUCCESS: Notification created.');

      return { updatedUser, promotionHistory };
    });

    res.json({
      success: true,
      message: `User ${existingUser.name} promoted successfully to ${targetRole}.`,
      user: result.updatedUser,
      updatedUser: result.updatedUser,
      promotionHistory: result.promotionHistory
    });
  } catch (error) {
    console.error('===== PROMOTION ERROR =====');
    console.error(error);
    console.error(error.stack);
    console.error('===========================');
    res.status(500).json({
      message: error.message || 'Failed to promote user.',
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

const getUserPromotionHistory = async (req, res) => {
  try {
    const { id } = req.params;
    const history = await prisma.promotionHistory.findMany({
      where: { userId: id },
      include: {
        previousPosition: { select: { id: true, name: true, code: true, color: true } },
        newPosition: { select: { id: true, name: true, code: true, color: true } },
        promotedBy: { select: { id: true, name: true, email: true, profilePic: true } }
      },
      orderBy: { effectiveDate: 'desc' }
    });

    res.json(history);
  } catch (error) {
    console.error('Fetch promotion history error:', error);
    res.status(500).json({ message: 'Failed to fetch promotion history.' });
  }
};

const removeProfilePicture = async (req, res) => {
  console.log('[PROFILE REMOVE] Request received from user:', req.user?.id || 'anonymous');
  try {
    const targetUserId = req.params?.id || req.user?.id;
    const isSelf = targetUserId === req.user?.id;
    const isSuperOrAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(req.user?.role);

    console.log('[PROFILE REMOVE] User authenticated:', { targetUserId, role: req.user?.role, isSelf });

    if (!isSelf && !isSuperOrAdmin) {
      console.warn('[PROFILE REMOVE] Unauthorized attempt on target:', targetUserId);
      return res.status(403).json({ success: false, message: 'Unauthorized to remove this profile picture.' });
    }

    const user = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, name: true, profilePic: true }
    });

    if (!user) {
      console.warn('[PROFILE REMOVE] Target user not found:', targetUserId);
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    console.log('[PROFILE REMOVE] Current image:', user.profilePic || 'none');

    // If custom upload exists, delete the physical file safely
    if (user.profilePic && typeof user.profilePic === 'string') {
      try {
        let relPath = user.profilePic.trim();
        if (relPath.startsWith('http://') || relPath.startsWith('https://')) {
          try {
            relPath = new URL(relPath).pathname;
          } catch (e) {}
        }
        if (relPath.startsWith('/') || relPath.startsWith('\\')) {
          relPath = relPath.substring(1);
        }
        if (/^(api[/\\])?uploads[/\\]/i.test(relPath)) {
          relPath = relPath.replace(/^(api[/\\])?uploads[/\\]/i, '');
        }

        const uploadsDir = path.resolve(__dirname, '../../uploads');
        const physicalPath = path.resolve(uploadsDir, relPath);

        if (physicalPath.startsWith(uploadsDir) && fs.existsSync(physicalPath)) {
          fs.unlinkSync(physicalPath);
          console.log('[PROFILE REMOVE] File deleted:', physicalPath);
        }
      } catch (fileErr) {
        console.warn('[PROFILE REMOVE] File deletion warning (non-fatal):', fileErr.message);
      }
    }

    const updatedUser = await prisma.user.update({
      where: { id: targetUserId },
      data: { profilePic: null },
      select: {
        id: true,
        name: true,
        email: true,
        employeeId: true,
        role: true,
        department: true,
        profilePic: true,
        phone: true,
        college: true,
        joiningDate: true,
        status: true
      }
    });

    console.log('[PROFILE REMOVE] Database updated');

    await logActivity({
      userId: req.user.id,
      action: 'PROFILE_PICTURE_REMOVE',
      details: `Removed profile picture for ${user.name} (${user.id})`
    }).catch(e => console.warn('Activity log error:', e.message));

    console.log('[PROFILE REMOVE] Response sent 200 OK');
    return res.status(200).json({
      success: true,
      message: 'Profile photo removed successfully.',
      user: updatedUser
    });
  } catch (error) {
    console.error('[PROFILE REMOVE] Controller error:', error);
    return res.status(500).json({ success: false, message: 'Failed to remove profile picture.' });
  }
};

const completeWelcomePopup = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: 'Authentication required.' });
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { welcomePopupSeen: true }
    });

    await logActivity({
      userId,
      action: 'WELCOME_POPUP_COMPLETED',
      details: 'Marked first-time welcome popup as completed'
    }).catch(e => console.warn('Activity log error:', e.message));

    const { password: _, ...userWithoutPassword } = updatedUser;
    return res.json({
      success: true,
      message: 'Welcome onboarding popup completed.',
      user: {
        ...userWithoutPassword,
        profilePhoto: userWithoutPassword.profilePic || null
      }
    });
  } catch (error) {
    console.error('Complete welcome popup error:', error);
    return res.status(500).json({ message: 'Failed to record welcome popup status.' });
  }
};

const resetWelcomePopup = async (req, res) => {
  try {
    const targetUserId = req.params.id || req.body.userId;
    if (!targetUserId) {
      return res.status(400).json({ message: 'User ID is required.' });
    }

    const updatedUser = await prisma.user.update({
      where: { id: targetUserId },
      data: { welcomePopupSeen: false }
    });

    await logActivity({
      userId: req.user?.id || targetUserId,
      action: 'WELCOME_POPUP_RESET',
      details: `Reset welcome popup status for user ${targetUserId}`
    }).catch(e => console.warn('Activity log error:', e.message));

    const { password: _, ...userWithoutPassword } = updatedUser;
    return res.json({
      success: true,
      message: 'Welcome popup reset successfully.',
      user: {
        ...userWithoutPassword,
        profilePhoto: userWithoutPassword.profilePic || null
      }
    });
  } catch (error) {
    console.error('Reset welcome popup error:', error);
    return res.status(500).json({ message: 'Failed to reset welcome popup status.' });
  }
};

module.exports = {
  createUser,
  getAllUsers,
  getUserById,
  editUser,
  deleteUser,
  toggleUserStatus,
  resetUserPassword,
  bulkImport,
  bulkDelete,
  bulkUpdateAutoClockOut,
  promoteUser,
  getUserPromotionHistory,
  removeProfilePicture,
  completeWelcomePopup,
  resetWelcomePopup
};
