const meetingService = require('../services/meetingService');
const { getEffectiveOrgId } = require('../utils/organizationScope');

/**
 * Fetch report for a meeting.
 */
const getReport = async (req, res) => {
  try {
    const organizationId = getEffectiveOrgId(req);
    if (!organizationId) {
      return res.status(400).json({ success: false, message: 'Organization scope is required.' });
    }

    const report = await meetingService.getMeetingReport({
      meetingId: req.params.id,
      user: req.user,
      organizationId
    });

    res.json({
      success: true,
      report
    });
  } catch (error) {
    res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Failed to load meeting report.'
    });
  }
};

/**
 * Create or update meeting report (Idempotent).
 */
const saveReport = async (req, res) => {
  try {
    const organizationId = getEffectiveOrgId(req);
    if (!organizationId) {
      return res.status(400).json({ success: false, message: 'Organization scope is required.' });
    }

    const report = await meetingService.upsertMeetingReport({
      meetingId: req.params.id,
      user: req.user,
      data: req.body,
      organizationId
    });

    res.json({
      success: true,
      message: 'Meeting report recorded successfully.',
      report
    });
  } catch (error) {
    res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Failed to save meeting report.'
    });
  }
};

module.exports = {
  getReport,
  saveReport
};
