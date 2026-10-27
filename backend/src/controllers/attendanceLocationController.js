const prisma = require('../utils/db');
const { getEffectiveOrgId, getOrganizationWhere } = require('../utils/organizationScope');
const { logActivity } = require('../utils/activityLogger');

/**
 * GET /api/attendance-locations
 * List attendance locations for the effective organization (Super Admin switchable)
 */
const getAttendanceLocations = async (req, res) => {
  try {
    const where = getOrganizationWhere(req);

    const locations = await prisma.attendanceLocation.findMany({
      where,
      include: {
        _count: {
          select: {
            assignedUsers: true,
            attendances: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json({
      success: true,
      locations: locations.map(loc => ({
        id: loc.id,
        organizationId: loc.organizationId,
        name: loc.name,
        address: loc.address,
        latitude: loc.latitude,
        longitude: loc.longitude,
        radiusMeters: loc.radiusMeters,
        isActive: loc.isActive,
        createdAt: loc.createdAt,
        updatedAt: loc.updatedAt,
        assignedUserCount: loc._count.assignedUsers,
        attendanceCount: loc._count.attendances
      }))
    });
  } catch (error) {
    console.error('[getAttendanceLocations Error]:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve attendance locations.' });
  }
};

/**
 * GET /api/attendance-locations/:id
 */
const getAttendanceLocationById = async (req, res) => {
  try {
    const { id } = req.params;
    const effectiveOrgId = getEffectiveOrgId(req);

    const location = await prisma.attendanceLocation.findUnique({
      where: { id },
      include: {
        _count: {
          select: { assignedUsers: true, attendances: true }
        }
      }
    });

    if (!location) {
      return res.status(404).json({ success: false, message: 'Attendance location not found.' });
    }

    if (req.user.role !== 'SUPER_ADMIN' && location.organizationId !== effectiveOrgId) {
      return res.status(403).json({ success: false, message: 'Unauthorized access to this location.' });
    }

    res.json({ success: true, location });
  } catch (error) {
    console.error('[getAttendanceLocationById Error]:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve location details.' });
  }
};

/**
 * POST /api/attendance-locations
 * Create a new attendance location
 */
const createAttendanceLocation = async (req, res) => {
  try {
    const effectiveOrgId = getEffectiveOrgId(req);
    if (!effectiveOrgId) {
      return res.status(400).json({ success: false, message: 'Organization scope is required to create a location.' });
    }

    const { name, address, latitude, longitude, radiusMeters = 100, isActive = true } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Location name is required.' });
    }

    const lat = parseFloat(latitude);
    const lon = parseFloat(longitude);
    if (isNaN(lat) || lat < -90 || lat > 90) {
      return res.status(400).json({ success: false, message: 'Valid latitude is required.' });
    }
    if (isNaN(lon) || lon < -180 || lon > 180) {
      return res.status(400).json({ success: false, message: 'Valid longitude is required.' });
    }

    const radius = parseFloat(radiusMeters);
    if (isNaN(radius) || radius <= 0) {
      return res.status(400).json({ success: false, message: 'Allowed radius must be greater than 0 meters.' });
    }

    const newLocation = await prisma.attendanceLocation.create({
      data: {
        organizationId: effectiveOrgId,
        name: name.trim(),
        address: address ? address.trim() : null,
        latitude: lat,
        longitude: lon,
        radiusMeters: radius,
        isActive: Boolean(isActive)
      }
    });

    await logActivity({
      userId: req.user.id,
      action: 'CREATE_ATTENDANCE_LOCATION',
      details: `Created attendance location "${newLocation.name}" (Radius: ${radius}m) for organization ${effectiveOrgId}.`
    });

    res.status(201).json({
      success: true,
      message: 'Attendance location created successfully.',
      location: newLocation
    });
  } catch (error) {
    console.error('[createAttendanceLocation Error]:', error);
    res.status(500).json({ success: false, message: 'Failed to create attendance location.' });
  }
};

/**
 * PUT /api/attendance-locations/:id
 * Update an existing attendance location
 */
const updateAttendanceLocation = async (req, res) => {
  try {
    const { id } = req.params;
    const effectiveOrgId = getEffectiveOrgId(req);

    const existing = await prisma.attendanceLocation.findUnique({
      where: { id }
    });

    if (!existing) {
      return res.status(404).json({ success: false, message: 'Attendance location not found.' });
    }

    if (req.user.role !== 'SUPER_ADMIN' && existing.organizationId !== effectiveOrgId) {
      return res.status(403).json({ success: false, message: 'Unauthorized to modify this location.' });
    }

    const { name, address, latitude, longitude, radiusMeters, isActive } = req.body;
    const updateData = {};

    if (name !== undefined) {
      if (!name.trim()) return res.status(400).json({ success: false, message: 'Location name cannot be empty.' });
      updateData.name = name.trim();
    }

    if (address !== undefined) {
      updateData.address = address ? address.trim() : null;
    }

    if (latitude !== undefined) {
      const lat = parseFloat(latitude);
      if (isNaN(lat) || lat < -90 || lat > 90) {
        return res.status(400).json({ success: false, message: 'Valid latitude is required.' });
      }
      updateData.latitude = lat;
    }

    if (longitude !== undefined) {
      const lon = parseFloat(longitude);
      if (isNaN(lon) || lon < -180 || lon > 180) {
        return res.status(400).json({ success: false, message: 'Valid longitude is required.' });
      }
      updateData.longitude = lon;
    }

    if (radiusMeters !== undefined) {
      const radius = parseFloat(radiusMeters);
      if (isNaN(radius) || radius <= 0) {
        return res.status(400).json({ success: false, message: 'Allowed radius must be greater than 0 meters.' });
      }
      updateData.radiusMeters = radius;
    }

    if (isActive !== undefined) {
      updateData.isActive = Boolean(isActive);
    }

    const updated = await prisma.attendanceLocation.update({
      where: { id },
      data: updateData
    });

    await logActivity({
      userId: req.user.id,
      action: 'UPDATE_ATTENDANCE_LOCATION',
      details: `Updated attendance location "${updated.name}".`
    });

    res.json({
      success: true,
      message: 'Attendance location updated successfully.',
      location: updated
    });
  } catch (error) {
    console.error('[updateAttendanceLocation Error]:', error);
    res.status(500).json({ success: false, message: 'Failed to update attendance location.' });
  }
};

/**
 * DELETE /api/attendance-locations/:id
 * Delete an attendance location safely
 */
const deleteAttendanceLocation = async (req, res) => {
  try {
    const { id } = req.params;
    const effectiveOrgId = getEffectiveOrgId(req);

    const existing = await prisma.attendanceLocation.findUnique({
      where: { id },
      include: {
        _count: {
          select: { attendances: true, assignedUsers: true }
        }
      }
    });

    if (!existing) {
      return res.status(404).json({ success: false, message: 'Attendance location not found.' });
    }

    if (req.user.role !== 'SUPER_ADMIN' && existing.organizationId !== effectiveOrgId) {
      return res.status(403).json({ success: false, message: 'Unauthorized to delete this location.' });
    }

    // If attendance logs reference this location, prevent hard delete to protect historical audit trail
    if (existing._count.attendances > 0) {
      // Soft-disable the location instead
      await prisma.attendanceLocation.update({
        where: { id },
        data: { isActive: false }
      });

      return res.json({
        success: true,
        message: `Location "${existing.name}" is linked to ${existing._count.attendances} historical attendance record(s). It has been deactivated to preserve audit integrity.`,
        deactivated: true
      });
    }

    // Safe to delete completely
    await prisma.attendanceLocation.delete({
      where: { id }
    });

    await logActivity({
      userId: req.user.id,
      action: 'DELETE_ATTENDANCE_LOCATION',
      details: `Deleted attendance location "${existing.name}".`
    });

    res.json({
      success: true,
      message: `Attendance location "${existing.name}" deleted successfully.`
    });
  } catch (error) {
    console.error('[deleteAttendanceLocation Error]:', error);
    res.status(500).json({ success: false, message: 'Failed to delete attendance location.' });
  }
};

/**
 * GET /api/attendance-locations/:id/members
 * Get users assigned to a specific location
 */
const getLocationMembers = async (req, res) => {
  try {
    const { id } = req.params;
    const effectiveOrgId = getEffectiveOrgId(req);

    const location = await prisma.attendanceLocation.findUnique({
      where: { id }
    });

    if (!location) {
      return res.status(404).json({ success: false, message: 'Location not found.' });
    }

    if (req.user.role !== 'SUPER_ADMIN' && location.organizationId !== effectiveOrgId) {
      return res.status(403).json({ success: false, message: 'Unauthorized access.' });
    }

    const assignments = await prisma.userAttendanceLocation.findMany({
      where: { attendanceLocationId: id },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            employeeId: true,
            role: true,
            status: true
          }
        }
      }
    });

    res.json({
      success: true,
      members: assignments.map(a => a.user)
    });
  } catch (error) {
    console.error('[getLocationMembers Error]:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve location members.' });
  }
};

/**
 * POST /api/attendance-locations/:id/members
 * Update assigned users for a location
 */
const updateLocationMembers = async (req, res) => {
  try {
    const { id } = req.params;
    const effectiveOrgId = getEffectiveOrgId(req);
    const { userIds = [] } = req.body;

    const location = await prisma.attendanceLocation.findUnique({
      where: { id }
    });

    if (!location) {
      return res.status(404).json({ success: false, message: 'Location not found.' });
    }

    if (req.user.role !== 'SUPER_ADMIN' && location.organizationId !== effectiveOrgId) {
      return res.status(403).json({ success: false, message: 'Unauthorized access.' });
    }

    // Verify all target users belong to this organization
    if (userIds.length > 0) {
      const validUsers = await prisma.user.findMany({
        where: {
          id: { in: userIds },
          organizationId: location.organizationId
        },
        select: { id: true }
      });

      const validUserIds = validUsers.map(u => u.id);

      // Replace mappings transactionally
      await prisma.$transaction([
        prisma.userAttendanceLocation.deleteMany({
          where: { attendanceLocationId: id }
        }),
        prisma.userAttendanceLocation.createMany({
          data: validUserIds.map(uId => ({
            userId: uId,
            attendanceLocationId: id
          }))
        })
      ]);
    } else {
      await prisma.userAttendanceLocation.deleteMany({
        where: { attendanceLocationId: id }
      });
    }

    res.json({
      success: true,
      message: 'Location member assignments updated successfully.'
    });
  } catch (error) {
    console.error('[updateLocationMembers Error]:', error);
    res.status(500).json({ success: false, message: 'Failed to update location members.' });
  }
};

/**
 * GET /api/attendance-locations/user/:userId
 * Get assigned locations for a user
 */
const getUserLocations = async (req, res) => {
  try {
    const { userId } = req.params;
    const effectiveOrgId = getEffectiveOrgId(req);

    const targetUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, organizationId: true }
    });

    if (!targetUser) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    if (req.user.role !== 'SUPER_ADMIN' && targetUser.organizationId !== effectiveOrgId) {
      return res.status(403).json({ success: false, message: 'Unauthorized access.' });
    }

    const assignments = await prisma.userAttendanceLocation.findMany({
      where: { userId },
      include: {
        attendanceLocation: true
      }
    });

    res.json({
      success: true,
      locations: assignments.map(a => a.attendanceLocation)
    });
  } catch (error) {
    console.error('[getUserLocations Error]:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve user locations.' });
  }
};

/**
 * POST /api/attendance-locations/user/:userId
 * Update assigned locations for a user
 */
const updateUserLocations = async (req, res) => {
  try {
    const { userId } = req.params;
    const effectiveOrgId = getEffectiveOrgId(req);
    const locationIds = req.body.locationIds || req.body.attendanceLocationIds || [];

    const targetUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, organizationId: true }
    });

    if (!targetUser) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    if (req.user.role !== 'SUPER_ADMIN' && targetUser.organizationId !== effectiveOrgId) {
      return res.status(403).json({ success: false, message: 'Unauthorized access.' });
    }

    // Verify all target locations belong to the user's organization
    let validLocationIds = [];
    if (locationIds.length > 0) {
      const validLocations = await prisma.attendanceLocation.findMany({
        where: {
          id: { in: locationIds },
          organizationId: targetUser.organizationId
        },
        select: { id: true }
      });
      validLocationIds = validLocations.map(l => l.id);
    }

    // Replace assignments transactionally
    await prisma.$transaction([
      prisma.userAttendanceLocation.deleteMany({
        where: { userId }
      }),
      prisma.userAttendanceLocation.createMany({
        data: validLocationIds.map(locId => ({
          userId,
          attendanceLocationId: locId
        }))
      })
    ]);

    res.json({
      success: true,
      message: 'User attendance locations updated successfully.',
      assignedCount: validLocationIds.length,
      assignedLocations: validLocationIds
    });
  } catch (error) {
    console.error('[updateUserLocations Error]:', error);
    res.status(500).json({ success: false, message: 'Failed to update user attendance locations.' });
  }
};

module.exports = {
  getAttendanceLocations,
  getAttendanceLocationById,
  createAttendanceLocation,
  updateAttendanceLocation,
  deleteAttendanceLocation,
  getLocationMembers,
  updateLocationMembers,
  getUserLocations,
  updateUserLocations
};
