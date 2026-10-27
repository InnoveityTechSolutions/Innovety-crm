const meetingService = require('../services/meetingService');
const { getEffectiveOrgId } = require('../utils/organizationScope');

/**
 * List all meetings visible to the authenticated user.
 */
const listMeetings = async (req, res) => {
  try {
    const organizationId = getEffectiveOrgId(req);
    if (!organizationId) {
      return res.status(400).json({ success: false, message: 'Organization scope is required.' });
    }

    const meetings = await meetingService.listMeetings({
      user: req.user,
      query: req.query,
      organizationId
    });

    res.json({
      success: true,
      count: meetings.length,
      meetings
    });
  } catch (error) {
    console.error('[MeetingController:listMeetings Error]:', error);
    res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Failed to list meetings.'
    });
  }
};

/**
 * Get meeting details by ID.
 */
const getMeetingById = async (req, res) => {
  try {
    const organizationId = getEffectiveOrgId(req);
    if (!organizationId) {
      return res.status(400).json({ success: false, message: 'Organization scope is required.' });
    }

    const meeting = await meetingService.getMeetingById({
      id: req.params.id,
      user: req.user,
      organizationId
    });

    res.json({
      success: true,
      meeting
    });
  } catch (error) {
    res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Failed to load meeting details.'
    });
  }
};

/**
 * Schedule a new meeting.
 */
const createMeeting = async (req, res) => {
  try {
    const organizationId = getEffectiveOrgId(req);
    if (!organizationId) {
      return res.status(400).json({ success: false, message: 'Organization scope is required.' });
    }

    const meeting = await meetingService.createMeeting({
      user: req.user,
      data: req.body,
      organizationId
    });

    res.status(201).json({
      success: true,
      message: 'Meeting scheduled successfully.',
      meeting
    });
  } catch (error) {
    res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Failed to schedule meeting.'
    });
  }
};

/**
 * Update meeting details.
 */
const updateMeeting = async (req, res) => {
  try {
    const organizationId = getEffectiveOrgId(req);
    if (!organizationId) {
      return res.status(400).json({ success: false, message: 'Organization scope is required.' });
    }

    const meeting = await meetingService.updateMeeting({
      id: req.params.id,
      user: req.user,
      data: req.body,
      organizationId
    });

    res.json({
      success: true,
      message: 'Meeting updated successfully.',
      meeting
    });
  } catch (error) {
    res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Failed to update meeting.'
    });
  }
};

/**
 * Reschedule a meeting.
 */
const rescheduleMeeting = async (req, res) => {
  try {
    const organizationId = getEffectiveOrgId(req);
    if (!organizationId) {
      return res.status(400).json({ success: false, message: 'Organization scope is required.' });
    }

    const meeting = await meetingService.rescheduleMeeting({
      id: req.params.id,
      user: req.user,
      data: req.body,
      organizationId
    });

    res.json({
      success: true,
      message: 'Meeting rescheduled successfully.',
      meeting
    });
  } catch (error) {
    res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Failed to reschedule meeting.'
    });
  }
};

/**
 * Cancel a meeting.
 */
const cancelMeeting = async (req, res) => {
  try {
    const organizationId = getEffectiveOrgId(req);
    if (!organizationId) {
      return res.status(400).json({ success: false, message: 'Organization scope is required.' });
    }

    const meeting = await meetingService.cancelMeeting({
      id: req.params.id,
      user: req.user,
      reason: req.body.reason,
      organizationId
    });

    res.json({
      success: true,
      message: 'Meeting cancelled successfully.',
      meeting
    });
  } catch (error) {
    res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Failed to cancel meeting.'
    });
  }
};

/**
 * Mark a meeting as completed.
 */
const completeMeeting = async (req, res) => {
  try {
    const organizationId = getEffectiveOrgId(req);
    if (!organizationId) {
      return res.status(400).json({ success: false, message: 'Organization scope is required.' });
    }

    const meeting = await meetingService.completeMeeting({
      id: req.params.id,
      user: req.user,
      organizationId
    });

    res.json({
      success: true,
      message: 'Meeting marked as completed.',
      meeting
    });
  } catch (error) {
    res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Failed to complete meeting.'
    });
  }
};

module.exports = {
  listMeetings,
  getMeetingById,
  createMeeting,
  updateMeeting,
  rescheduleMeeting,
  cancelMeeting,
  completeMeeting
};
