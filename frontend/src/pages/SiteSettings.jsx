import React, { useState, useEffect, useRef } from 'react';
import api from '../services/api';
import { Save, Shield, Clock, Mail, Building, CheckCircle2, AlertCircle, ToggleLeft, ToggleRight, Check, Sparkles, DollarSign } from 'lucide-react';
import CompanyScopeSelector from '../components/common/CompanyScopeSelector';
import { useCompanyScope } from '../context/CompanyScopeContext';
import AttendanceLocationsSection from '../components/attendance/AttendanceLocationsSection';

const SiteSettings = () => {
  const { selectedOrgId, loading: orgsLoading, selectedCompany } = useCompanyScope();
  const selectedOrgIdRef = useRef(selectedOrgId);
  const [settings, setSettings] = useState({
    companyName: '',
    senderEmail: 'no-reply@enterprise-crm.com',
    clockInTime: '09:00',
    clockOutTime: '18:00',
    autoClockOutEnabled: true,
    internShiftStart: '09:00',
    internShiftEnd: '18:00',
    tlShiftStart: '09:00',
    tlShiftEnd: '18:00',
    officeLatitude: 12.971598,
    officeLongitude: 77.594562,
    allowedRadiusMeters: 200,
    officeLocationName: 'Company Headquarters',
    earlyWindowMinutes: 30,
    gracePeriodMinutes: 15,
    enableOvertimePay: false,
    enableHolidayPay: false
  });

  const [loading, setLoading] = useState(false);
  const [alert, setAlert] = useState(null);

  const fetchSettings = async () => {
    try {
      setLoading(true);
      const targetOrg = selectedOrgIdRef.current || selectedOrgId;
      const params = {};
      if (targetOrg) params.organizationId = targetOrg;

      const res = await api.get('/settings', { params });
      if (res.data) {
        setSettings({
          ...res.data,
          companyName: selectedCompany?.name || res.data.companyName || 'Company Workspace',
          clockInTime: res.data.clockInTime || res.data.internShiftStart || '09:00',
          clockOutTime: res.data.clockOutTime || res.data.internShiftEnd || '18:00',
          autoClockOutEnabled: res.data.autoClockOutEnabled !== undefined ? res.data.autoClockOutEnabled : true,
          enableOvertimePay: Boolean(res.data.enableOvertimePay),
          enableHolidayPay: Boolean(res.data.enableHolidayPay)
        });
      }
      setLoading(false);
    } catch (err) {
      console.error('Failed to load settings:', err);
      setAlert({ type: 'error', message: 'Failed to load system attendance settings.' });
      setLoading(false);
    }
  };

  useEffect(() => {
    selectedOrgIdRef.current = selectedOrgId;
    if (orgsLoading) return;
    fetchSettings();
  }, [selectedOrgId, orgsLoading]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setSettings(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handleToggleAutoClockOut = () => {
    setSettings(prev => ({
      ...prev,
      autoClockOutEnabled: !prev.autoClockOutEnabled
    }));
  };

  const handleToggleOvertimePay = () => {
    setSettings(prev => ({
      ...prev,
      enableOvertimePay: !prev.enableOvertimePay
    }));
  };

  const handleToggleHolidayPay = () => {
    setSettings(prev => ({
      ...prev,
      enableHolidayPay: !prev.enableHolidayPay
    }));
  };


  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    try {
      setLoading(true);
      setAlert(null);

      const targetOrg = selectedOrgIdRef.current || selectedOrgId;
      const earlyWin = parseInt(settings.earlyWindowMinutes, 10);
      const gracePer = parseInt(settings.gracePeriodMinutes, 10);
      const lat = parseFloat(settings.officeLatitude);
      const lon = parseFloat(settings.officeLongitude);
      const radius = parseFloat(settings.allowedRadiusMeters);

      if (isNaN(lat) || lat < -90 || lat > 90) {
        setAlert({ type: 'error', message: 'Office Latitude must be a valid number between -90 and 90.' });
        setLoading(false);
        return;
      }

      if (isNaN(lon) || lon < -180 || lon > 180) {
        setAlert({ type: 'error', message: 'Office Longitude must be a valid number between -180 and 180.' });
        setLoading(false);
        return;
      }

      if (isNaN(radius) || radius <= 0) {
        setAlert({ type: 'error', message: 'Allowed Radius must be a positive number greater than 0.' });
        setLoading(false);
        return;
      }

      if (isNaN(earlyWin) || earlyWin < 0 || earlyWin > 120) {
        setAlert({ type: 'error', message: 'Early Clock-In Window must be between 0 and 120 minutes.' });
        setLoading(false);
        return;
      }
      if (isNaN(gracePer) || gracePer < 0 || gracePer > 120) {
        setAlert({ type: 'error', message: 'Grace Period must be between 0 and 120 minutes.' });
        setLoading(false);
        return;
      }

      // Validate clock out time > clock in time
      const [inH, inM] = (settings.clockInTime || '09:00').split(':').map(Number);
      const [outH, outM] = (settings.clockOutTime || '18:00').split(':').map(Number);
      if (outH * 60 + outM <= inH * 60 + inM) {
        setAlert({ type: 'error', message: 'Clock-Out Time must be chronologically later than Clock-In Time.' });
        setLoading(false);
        return;
      }
      
      const payload = {
        ...settings,
        organizationId: targetOrg,
        companyName: selectedCompany?.name || settings.companyName || 'Company Workspace',
        officeLatitude: lat,
        officeLongitude: lon,
        allowedRadiusMeters: radius,
        earlyWindowMinutes: earlyWin,
        gracePeriodMinutes: gracePer,
        internShiftStart: settings.clockInTime,
        internShiftEnd: settings.clockOutTime,
        tlShiftStart: settings.clockInTime,
        tlShiftEnd: settings.clockOutTime,
        enableOvertimePay: Boolean(settings.enableOvertimePay),
        enableHolidayPay: Boolean(settings.enableHolidayPay)
      };

      const res = await api.put('/settings', payload);
      setSettings(prev => ({
        ...prev,
        ...res.data,
        companyName: selectedCompany?.name || res.data.companyName || 'Company Workspace'
      }));
      window.dispatchEvent(new CustomEvent('settings_updated', { detail: res.data }));
      setAlert({ type: 'success', message: `Attendance settings for ${selectedCompany?.name || 'Company'} updated successfully.` });
      setLoading(false);
    } catch (err) {
      console.error(err);
      setAlert({ type: 'error', message: err.response?.data?.message || 'Failed to update settings.' });
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-[1400px] mx-auto space-y-6 animate-in fade-in duration-300 text-left pt-2 pb-10 px-2 sm:px-4 font-sans">
      {/* Company Scope Selector */}
      <CompanyScopeSelector />

      {alert && (
        <div className={`p-4 rounded-xl border text-xs font-semibold flex items-center gap-3 ${
          alert.type === 'error' 
            ? 'bg-destructive/10 border-destructive/30 text-destructive' 
            : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
        }`}>
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{alert.message}</span>
        </div>
      )}

      {loading ? (
        <div className="skeleton h-96 w-full rounded-2xl" />
      ) : (
        <div className="space-y-6">
          <form id="site-settings-form" onSubmit={handleSubmit} className="space-y-6">
          {/* Section 1: Company & Communication Identity */}
          <div className="rounded-2xl border border-border/40 bg-card p-6 shadow-premium">
            <div className="flex items-center gap-2 border-b border-border/30 pb-4 mb-6">
              <Building className="h-5 w-5 text-primary" />
              <h2 className="text-sm font-bold uppercase tracking-tight">Organization Identity ({selectedCompany?.name || 'Company'})</h2>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-muted-foreground">Company Name (Read-Only Scope)</label>
                <input
                  type="text"
                  name="companyName"
                  value={selectedCompany?.name || settings.companyName || ''}
                  disabled
                  className="bg-muted/40 border border-border rounded-xl p-3 text-xs font-bold text-foreground cursor-not-allowed opacity-80"
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-muted-foreground">System Sender Email</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
                  <input
                    type="email"
                    name="senderEmail"
                    value={settings.senderEmail || ''}
                    onChange={handleChange}
                    className="w-full pl-10 bg-muted/20 border border-border rounded-xl p-3 text-xs font-semibold text-foreground"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Section 2: Attendance & Shift Configurations */}
          <div className="rounded-2xl border border-border/40 bg-card p-6 shadow-premium">
            <div className="flex items-center gap-2 border-b border-border/30 pb-4 mb-6">
              <Clock className="h-5 w-5 text-primary" />
              <h2 className="text-sm font-bold uppercase tracking-tight">Attendance & Shift Timing Rules</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-muted-foreground">Default Clock-In Time</label>
                <input
                  type="time"
                  name="clockInTime"
                  value={settings.clockInTime || '09:00'}
                  onChange={handleChange}
                  className="bg-muted/20 border border-border rounded-xl p-3 text-xs font-bold text-foreground"
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-muted-foreground">Default Clock-Out Time</label>
                <input
                  type="time"
                  name="clockOutTime"
                  value={settings.clockOutTime || '18:00'}
                  onChange={handleChange}
                  className="bg-muted/20 border border-border rounded-xl p-3 text-xs font-bold text-foreground"
                />
              </div>

              <div className="flex flex-col gap-2 justify-center">
                <label className="text-xs font-semibold text-muted-foreground">Auto Clock-Out Engine</label>
                <button
                  type="button"
                  onClick={handleToggleAutoClockOut}
                  className={`flex items-center justify-between p-3 rounded-xl border text-xs font-bold transition-all ${
                    settings.autoClockOutEnabled
                      ? 'bg-primary/10 border-primary/40 text-primary'
                      : 'bg-muted/30 border-border text-muted-foreground'
                  }`}
                >
                  <span>{settings.autoClockOutEnabled ? 'ENABLED (Auto Clock-Out Active)' : 'DISABLED (Manual Only)'}</span>
                  {settings.autoClockOutEnabled ? <ToggleRight className="h-5 w-5 text-primary" /> : <ToggleLeft className="h-5 w-5" />}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-muted-foreground">Early Clock-In Window (Minutes)</label>
                <input
                  type="number"
                  name="earlyWindowMinutes"
                  value={settings.earlyWindowMinutes || 30}
                  onChange={handleChange}
                  className="bg-muted/20 border border-border rounded-xl p-3 text-xs font-semibold text-foreground"
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-muted-foreground">Grace Period Window (Minutes)</label>
                <input
                  type="number"
                  name="gracePeriodMinutes"
                  value={settings.gracePeriodMinutes || 15}
                  onChange={handleChange}
                  className="bg-muted/20 border border-border rounded-xl p-3 text-xs font-semibold text-foreground"
                />
              </div>
            </div>
          </div>

          {/* Section 4: Payroll Compensation Policies */}
          <div className="rounded-2xl border border-border/40 bg-card p-6 shadow-premium">
            <div className="flex items-center gap-2 border-b border-border/30 pb-4 mb-6">
              <DollarSign className="h-5 w-5 text-primary" />
              <h2 className="text-sm font-bold uppercase tracking-tight">Payroll Compensation Settings</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Toggle 1: Enable Overtime Pay */}
              <div className="flex flex-col gap-2 justify-center p-4 rounded-xl border border-border/40 bg-muted/10">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <label className="text-xs font-bold text-foreground block">Enable Overtime Pay</label>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Calculate and disburse overtime pay for hours worked beyond assigned shift schedule.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleToggleOvertimePay}
                    className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-bold transition-all shrink-0 ${
                      settings.enableOvertimePay
                        ? 'bg-primary/10 border-primary/40 text-primary'
                        : 'bg-muted/30 border-border text-muted-foreground'
                    }`}
                  >
                    <span>{settings.enableOvertimePay ? 'ENABLED' : 'DISABLED'}</span>
                    {settings.enableOvertimePay ? <ToggleRight className="h-5 w-5 text-primary" /> : <ToggleLeft className="h-5 w-5" />}
                  </button>
                </div>
              </div>

              {/* Toggle 2: Enable Holiday Pay */}
              <div className="flex flex-col gap-2 justify-center p-4 rounded-xl border border-border/40 bg-muted/10">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <label className="text-xs font-bold text-foreground block">Enable Holiday Pay</label>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Calculate and disburse holiday compensation when employees work on scheduled shift or official holidays.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleToggleHolidayPay}
                    className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-bold transition-all shrink-0 ${
                      settings.enableHolidayPay
                        ? 'bg-primary/10 border-primary/40 text-primary'
                        : 'bg-muted/30 border-border text-muted-foreground'
                    }`}
                  >
                    <span>{settings.enableHolidayPay ? 'ENABLED' : 'DISABLED'}</span>
                    {settings.enableHolidayPay ? <ToggleRight className="h-5 w-5 text-primary" /> : <ToggleLeft className="h-5 w-5" />}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </form>

        {/* Section: Attendance Locations */}
        <AttendanceLocationsSection />

        {/* Bottom Action Bar: Save Configuration */}
        <div className="flex justify-end pt-2">
          <button
            type="submit"
            form="site-settings-form"
            disabled={loading}
            className="flex items-center gap-2 px-6 py-3 rounded-xl bg-primary text-xs font-bold text-primary-foreground shadow-md hover:bg-primary-hover active:scale-95 transition-all disabled:opacity-50 cursor-pointer"
          >
            <Save className="h-4 w-4" />
            <span>Save Configuration ({selectedCompany?.name || 'Company Scope'})</span>
          </button>
        </div>
      </div>
    )}
    </div>
  );
};

export default SiteSettings;
