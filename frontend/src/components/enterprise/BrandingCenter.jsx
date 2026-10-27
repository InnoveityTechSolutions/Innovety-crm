import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Palette, Image as ImageIcon, CheckCircle2,
  AlertCircle, RefreshCw, RotateCcw, Save,
  Sparkles, Shield, MessageCircle, Users, Info, Building2,
  Upload, Trash2, Sliders, Undo2
} from 'lucide-react';
import api, { getUploadUrl } from '../../services/api';
import { useTheme } from '../../context/ThemeContext';
import { useCompanyScope } from '../../context/CompanyScopeContext';
import CompanyScopeSelector from '../common/CompanyScopeSelector';

const THEME_PRESETS = [
  {
    id: 'emerald',
    name: 'Emerald Horizon',
    description: 'Classic emerald green enterprise palette with clean mint accents',
    themeColor: '#10B981',
    accentColor: '#064E3B',
    sidebarColor: 'bg-emerald-950',
    headerColor: 'bg-emerald-600',
    accentColorClass: 'bg-emerald-500',
    buttonColor: 'bg-emerald-600 text-white',
    cardBorder: 'border-emerald-500/50'
  },
  {
    id: 'blue',
    name: 'Cyber Blue',
    description: 'Professional royal blue corporate design with cyan highlights',
    themeColor: '#3B82F6',
    accentColor: '#1E3A8A',
    sidebarColor: 'bg-blue-950',
    headerColor: 'bg-blue-600',
    accentColorClass: 'bg-blue-500',
    buttonColor: 'bg-blue-600 text-white',
    cardBorder: 'border-blue-500/50'
  },
  {
    id: 'purple',
    name: 'Electric Purple',
    description: 'Modern violet & deep purple theme with radiant illumination',
    themeColor: '#8B5CF6',
    accentColor: '#4C1D95',
    sidebarColor: 'bg-purple-950',
    headerColor: 'bg-purple-600',
    accentColorClass: 'bg-purple-500',
    buttonColor: 'bg-purple-600 text-white',
    cardBorder: 'border-purple-500/50'
  },
  {
    id: 'orange',
    name: 'Sunset Amber',
    description: 'Warm and energetic tangerine & amber tone for high vibrancy',
    themeColor: '#F59E0B',
    accentColor: '#78350F',
    sidebarColor: 'bg-stone-900',
    headerColor: 'bg-orange-600',
    accentColorClass: 'bg-orange-500',
    buttonColor: 'bg-orange-600 text-white',
    cardBorder: 'border-orange-500/50'
  },
  {
    id: 'rose',
    name: 'Rose Titanium',
    description: 'Elegant rose & ruby executive palette with sleek titanium finish',
    themeColor: '#F43F5E',
    accentColor: '#881337',
    sidebarColor: 'bg-rose-950',
    headerColor: 'bg-rose-600',
    accentColorClass: 'bg-rose-500',
    buttonColor: 'bg-rose-600 text-white',
    cardBorder: 'border-rose-500/50'
  },
  {
    id: 'slate',
    name: 'Slate Enterprise',
    description: 'Sleek dark slate with sky cyan accents for modern corporate ops',
    themeColor: '#64748B',
    accentColor: '#0F172A',
    sidebarColor: 'bg-slate-950',
    headerColor: 'bg-slate-800',
    accentColorClass: 'bg-cyan-400',
    buttonColor: 'bg-slate-700 text-white',
    cardBorder: 'border-slate-500/50'
  }
];

const LOGIN_COLOR_THEMES = [
  {
    id: 'orange',
    name: 'Innoveity Orange (Default)',
    description: 'Energetic brand signature with vivid warm orange highlights',
    primaryColor: '#F97316',
    accentColor: '#EA580C',
    buttonColor: 'bg-orange-500 text-white',
    cardBorder: 'border-orange-500/50'
  },
  {
    id: 'emerald',
    name: 'Emerald Green',
    description: 'Clean mint and deep emerald tones for natural corporate poise',
    primaryColor: '#10B981',
    accentColor: '#059669',
    buttonColor: 'bg-emerald-600 text-white',
    cardBorder: 'border-emerald-500/50'
  },
  {
    id: 'blue',
    name: 'Royal Blue',
    description: 'Authoritative royal blue palette with dynamic blue undertones',
    primaryColor: '#2563EB',
    accentColor: '#1D4ED8',
    buttonColor: 'bg-blue-600 text-white',
    cardBorder: 'border-blue-500/50'
  },
  {
    id: 'purple',
    name: 'Modern Violet',
    description: 'Contemporary deep violet with radiant purple energy',
    primaryColor: '#8B5CF6',
    accentColor: '#7C3AED',
    buttonColor: 'bg-purple-600 text-white',
    cardBorder: 'border-purple-500/50'
  },
  {
    id: 'rose',
    name: 'Rose Red',
    description: 'Sophisticated ruby rose theme tailored for high-contrast clarity',
    primaryColor: '#F43F5E',
    accentColor: '#E11D48',
    buttonColor: 'bg-rose-600 text-white',
    cardBorder: 'border-rose-500/50'
  },
  {
    id: 'amber',
    name: 'Warm Amber',
    description: 'Rich amber and warm ochre tones for an inviting aesthetic',
    primaryColor: '#D97706',
    accentColor: '#B45309',
    buttonColor: 'bg-amber-600 text-white',
    cardBorder: 'border-amber-500/50'
  },
  {
    id: 'cyan',
    name: 'Deep Cyan',
    description: 'Crisp turquoise and deep ocean cyan for tech-forward enterprises',
    primaryColor: '#06B6D4',
    accentColor: '#0891B2',
    buttonColor: 'bg-cyan-600 text-white',
    cardBorder: 'border-cyan-500/50'
  },
  {
    id: 'slate',
    name: 'Charcoal Slate',
    description: 'Refined dark slate and minimalist charcoal executive styling',
    primaryColor: '#334155',
    accentColor: '#1E293B',
    buttonColor: 'bg-slate-700 text-white',
    cardBorder: 'border-slate-500/50'
  }
];

const BrandingCenter = () => {
  const { selectedOrgId, companies } = useCompanyScope();
  const { updateThemeSettings } = useTheme();

  const activeTenantId = (selectedOrgId && selectedOrgId !== 'all')
    ? selectedOrgId
    : (companies && companies.length > 0 ? (companies[0].id || companies[0]._id) : null);

  const [branding, setBranding] = useState({
    companyName: 'Innoveity CRM',
    logo: '',
    themeColor: '#10B981',
    accentColor: '#064E3B',
    selectedTheme: 'emerald',
    loginBackground: 'linear-gradient(135deg, #064E3B 0%, #0F172A 100%)',
    emailBranding: {
      headerTitle: 'Innoveity Enterprise Notification',
      footerNotes: 'Confidential corporate communication. Powered by Innoveity CRM.',
      supportEmail: 'support@innovety.com',
      showCompanyLogo: true
    },
    pdfBranding: {
      primaryColor: '#10B981',
      headerHtml: '<h3>INNOVEITY CRM ENTERPRISE HRMS</h3>',
      footerHtml: '<p>Generated via Innoveity Automated HR Engine. All rights reserved.</p>',
      showWatermark: true,
      watermarkText: 'CONFIDENTIAL'
    }
  });

  const [logoFile, setLogoFile] = useState(null);
  const [logoPreview, setLogoPreview] = useState(null);
  const [removeLogo, setRemoveLogo] = useState(false);

  // Login Page Theme Customization State
  const [loginPrimaryColor, setLoginPrimaryColor] = useState('#F97316');

  const [chatEnabledForAdmins, setChatEnabledForAdmins] = useState(true);
  const [chatEnabledForUsers, setChatEnabledForUsers] = useState(true);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [pendingToggleRole, setPendingToggleRole] = useState(null); // 'ADMIN' or 'USER'
  const [toggling, setToggling] = useState(false);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);

  const fetchAllSettings = async (orgId = activeTenantId) => {
    const targetOrgId = (orgId && orgId !== 'all') ? orgId : activeTenantId;
    setLoading(true);
    setErrorMsg(null);
    try {
      const params = (targetOrgId && targetOrgId !== 'all') ? { organizationId: targetOrgId } : {};

      const [enterpriseRes, superAdminRes] = await Promise.all([
        api.get('/enterprise/branding', { params }).catch(() => null),
        api.get('/super-admin/branding', { params }).catch(() => null)
      ]);

      let updatedBranding = {
        companyName: 'Innoveity CRM',
        logo: '',
        themeColor: '#10B981',
        accentColor: '#064E3B',
        selectedTheme: 'emerald',
        loginBackground: 'linear-gradient(135deg, #064E3B 0%, #0F172A 100%)',
        emailBranding: {
          headerTitle: 'Innoveity Enterprise Notification',
          footerNotes: 'Confidential corporate communication. Powered by Innoveity CRM.',
          supportEmail: 'support@innovety.com',
          showCompanyLogo: true
        },
        pdfBranding: {
          primaryColor: '#10B981',
          headerHtml: '<h3>INNOVEITY CRM ENTERPRISE HRMS</h3>',
          footerHtml: '<p>Generated via Innoveity Automated HR Engine. All rights reserved.</p>',
          showWatermark: true,
          watermarkText: 'CONFIDENTIAL'
        }
      };

      if (enterpriseRes?.data?.success && enterpriseRes.data.branding) {
        updatedBranding = {
          ...updatedBranding,
          ...enterpriseRes.data.branding,
          emailBranding: {
            ...updatedBranding.emailBranding,
            ...(enterpriseRes.data.branding.emailBranding || {})
          },
          pdfBranding: {
            ...updatedBranding.pdfBranding,
            ...(enterpriseRes.data.branding.pdfBranding || {})
          }
        };
      }

      let fetchedLogo = null;
      if (enterpriseRes?.data?.success && enterpriseRes.data.branding?.logo) {
        fetchedLogo = enterpriseRes.data.branding.logo;
      }

      if (superAdminRes?.data) {
        if (superAdminRes.data.companyName) {
          updatedBranding.companyName = superAdminRes.data.companyName;
        }
        if (superAdminRes.data.companyLogo !== undefined) {
          fetchedLogo = superAdminRes.data.companyLogo;
        }
        if (superAdminRes.data.selectedTheme) {
          updatedBranding.selectedTheme = superAdminRes.data.selectedTheme;
          const matchingPreset = THEME_PRESETS.find(p => p.id === superAdminRes.data.selectedTheme);
          if (matchingPreset) {
            updatedBranding.themeColor = matchingPreset.themeColor;
            updatedBranding.accentColor = matchingPreset.accentColor;
          }
        }
        const adminVal = superAdminRes.data.organization?.chatEnabledForAdmins ?? superAdminRes.data.chatEnabledForAdmins ?? true;
        const userVal = superAdminRes.data.organization?.chatEnabledForUsers ?? superAdminRes.data.chatEnabledForUsers ?? true;
        setChatEnabledForAdmins(adminVal);
        setChatEnabledForUsers(userVal);

        // Login Page Theme fields
        const fetchedLoginColor = superAdminRes.data.loginPrimaryColor || '#F97316';
        setLoginPrimaryColor(fetchedLoginColor);
        localStorage.setItem('mrf_login_primary_color', fetchedLoginColor);
        if (targetOrgId && targetOrgId !== 'all') {
          localStorage.setItem(`mrf_login_theme_${targetOrgId}`, fetchedLoginColor);
        }
      }

      setLogoPreview(fetchedLogo || null);
      setLogoFile(null);
      setRemoveLogo(false);
      setBranding(updatedBranding);

      if (updatedBranding.selectedTheme) {
        updateThemeSettings({
          selectedTheme: updatedBranding.selectedTheme,
          primaryColor: updatedBranding.themeColor,
          accentColor: updatedBranding.accentColor,
          companyName: updatedBranding.companyName,
          companyLogo: fetchedLogo
        }, targetOrgId);
      }
    } catch (err) {
      console.error('Error fetching settings:', err);
      setErrorMsg(err.response?.data?.message || 'Failed to load company branding');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (activeTenantId) {
      fetchAllSettings(activeTenantId);
    }
  }, [activeTenantId]);

  const handleSelectTheme = (preset) => {
    setBranding(prev => ({
      ...prev,
      selectedTheme: preset.id,
      themeColor: preset.themeColor,
      accentColor: preset.accentColor
    }));

    // Instantly update context for this tenant so app reflects selection immediately
    updateThemeSettings({
      selectedTheme: preset.id,
      primaryColor: preset.themeColor,
      accentColor: preset.accentColor
    }, activeTenantId);
  };

  const handleLogoFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 10 * 1024 * 1024) {
        setErrorMsg('Selected image exceeds 10MB limit. Please select a smaller file.');
        return;
      }
      setLogoFile(file);
      setRemoveLogo(false);
      setLogoPreview(URL.createObjectURL(file));
      setErrorMsg(null);
    }
  };

  const handleRemoveLogo = () => {
    setLogoFile(null);
    setLogoPreview(null);
    setRemoveLogo(true);
    setBranding(prev => ({ ...prev, logo: '' }));
  };

  const handleResetLoginTheme = () => {
    const defaultColor = '#F97316';
    setLoginPrimaryColor(defaultColor);
    localStorage.setItem('mrf_login_primary_color', defaultColor);
    if (activeTenantId && activeTenantId !== 'all') {
      localStorage.setItem(`mrf_login_theme_${activeTenantId}`, defaultColor);
    }
    window.dispatchEvent(new Event('mrf_login_theme_changed'));
    setSuccessMsg('Login page theme reset to Innoveity Orange (Default). Click "Save Theme" to persist.');
    setTimeout(() => setSuccessMsg(null), 4000);
  };

  const handleSaveBranding = async (e) => {
    if (e) e.preventDefault();
    setSaving(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const orgIdParam = activeTenantId || undefined;

      const formData = new FormData();
      if (orgIdParam) {
        formData.append('organizationId', orgIdParam);
      }
      formData.append('companyName', branding.companyName || '');
      formData.append('selectedTheme', branding.selectedTheme || 'emerald');
      formData.append('chatEnabledForAdmins', String(chatEnabledForAdmins));
      formData.append('chatEnabledForUsers', String(chatEnabledForUsers));

      // Append Login Page Theme Primary Color
      formData.append('loginPrimaryColor', loginPrimaryColor);

      if (removeLogo) {
        formData.append('removeLogo', 'true');
      } else if (logoFile) {
        formData.append('logo', logoFile);
      }

      const superAdminRes = await api.put('/super-admin/branding', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      const updatedLogo = superAdminRes.data?.companyLogo !== undefined
        ? superAdminRes.data.companyLogo
        : (removeLogo ? null : (logoPreview || branding.logo));

      const enterprisePayload = {
        ...branding,
        logo: updatedLogo,
        organizationId: orgIdParam,
        loginPrimaryColor
      };

      await api.put('/enterprise/branding', enterprisePayload);

      // Save to localStorage so login page immediately reflects the change
      localStorage.setItem('mrf_login_primary_color', loginPrimaryColor);
      if (orgIdParam && orgIdParam !== 'all') {
        localStorage.setItem(`mrf_login_theme_${orgIdParam}`, loginPrimaryColor);
      }
      window.dispatchEvent(new Event('mrf_login_theme_changed'));

      setLogoFile(null);
      setRemoveLogo(false);
      setLogoPreview(updatedLogo);
      setBranding(prev => ({ ...prev, logo: updatedLogo || '' }));

      updateThemeSettings({
        companyName: branding.companyName,
        companyLogo: updatedLogo,
        selectedTheme: branding.selectedTheme || 'emerald',
        primaryColor: branding.themeColor,
        accentColor: branding.accentColor,
        chatEnabledForAdmins,
        chatEnabledForUsers
      }, orgIdParam);

      setSuccessMsg('Branding and login page theme saved successfully!');
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err) {
      setErrorMsg(err.response?.data?.message || 'Failed to save branding preferences');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!window.confirm('Reset branding to default enterprise theme?')) return;
    setSaving(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const orgIdParam = activeTenantId || undefined;
      const res = await api.post('/enterprise/branding/reset', { organizationId: orgIdParam });

      const resetFormData = new FormData();
      if (orgIdParam) resetFormData.append('organizationId', orgIdParam);
      resetFormData.append('companyName', 'Innoveity CRM');
      resetFormData.append('selectedTheme', 'emerald');
      resetFormData.append('removeLogo', 'true');
      await api.put('/super-admin/branding', resetFormData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      }).catch(() => null);

      setLogoFile(null);
      setLogoPreview(null);
      setRemoveLogo(false);

      const defaultEmerald = THEME_PRESETS[0];

      if (res.data?.success && res.data?.branding) {
        setBranding({
          ...res.data.branding,
          logo: null,
          selectedTheme: 'emerald'
        });
      } else {
        setBranding(prev => ({
          ...prev,
          logo: null,
          themeColor: defaultEmerald.themeColor,
          accentColor: defaultEmerald.accentColor,
          selectedTheme: 'emerald'
        }));
      }

      updateThemeSettings({
        companyName: 'Innoveity CRM',
        companyLogo: null,
        selectedTheme: 'emerald',
        themeMode: 'light'
      }, orgIdParam);

      setSuccessMsg('Branding restored to system defaults.');
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err) {
      setErrorMsg(err.response?.data?.message || 'Failed to reset branding');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleClick = (targetRole) => {
    setPendingToggleRole(targetRole);
    setShowConfirmModal(true);
  };

  const confirmToggleChange = async () => {
    if (!pendingToggleRole) return;
    setToggling(true);
    setErrorMsg(null);
    try {
      const prevVal = pendingToggleRole === 'ADMIN' ? chatEnabledForAdmins : chatEnabledForUsers;
      const nextVal = !prevVal;
      const newAdmins = pendingToggleRole === 'ADMIN' ? nextVal : chatEnabledForAdmins;
      const newUsers = pendingToggleRole === 'USER' ? nextVal : chatEnabledForUsers;

      const orgIdParam = activeTenantId || null;

      const payload = {
        organizationId: orgIdParam,
        companyName: branding.companyName,
        selectedTheme: branding.selectedTheme || 'emerald',
        chatEnabledForAdmins: newAdmins,
        chatEnabledForUsers: newUsers
      };

      const res = await api.put('/super-admin/branding', payload);

      setChatEnabledForAdmins(newAdmins);
      setChatEnabledForUsers(newUsers);

      updateThemeSettings({
        chatEnabledForAdmins: newAdmins,
        chatEnabledForUsers: newUsers,
        platform: res.data?.platform || { chatEnabledForAdmins: newAdmins, chatEnabledForUsers: newUsers },
        organization: res.data?.organization || null
      }, orgIdParam);

      setSuccessMsg(`Chat access for ${pendingToggleRole === 'ADMIN' ? 'Admins' : 'Users'} successfully ${(pendingToggleRole === 'ADMIN' ? newAdmins : newUsers) ? 'enabled' : 'disabled'}!`);
      setTimeout(() => setSuccessMsg(null), 4000);

      setShowConfirmModal(false);
      setPendingToggleRole(null);
    } catch (err) {
      setErrorMsg(err.response?.data?.message || 'Failed to update chat access settings.');
    } finally {
      setToggling(false);
    }
  };

  const currentDisplayLogo = removeLogo
    ? null
    : (logoPreview
      ? (logoPreview.startsWith('blob:') ? logoPreview : getUploadUrl(logoPreview))
      : (branding.logo ? (branding.logo.startsWith('blob:') ? branding.logo : getUploadUrl(branding.logo)) : null));

  return (
    <div className="space-y-6 text-left max-w-7xl mx-auto p-6">
      {/* ─── 1. PAGE HEADER & ACTIONS ─── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border/40 pb-4">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary border border-primary/20 mb-2">
            <Palette className="h-3.5 w-3.5" />
            <span>Platform Branding & Theme Module</span>
          </div>
          <h1 className="text-2xl font-extrabold text-foreground tracking-tight">
            Company Branding & Theme Management
          </h1>
          <p className="text-xs text-muted-foreground">
            Configure platform branding details, theme palettes, and chat access controls.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleReset}
            disabled={saving || loading}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground text-xs font-bold rounded-xl border border-border/60 transition shadow-2xs shrink-0 disabled:opacity-50"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset Defaults</span>
          </button>

          <button
            type="button"
            onClick={handleSaveBranding}
            disabled={saving || loading}
            className="flex items-center gap-2 px-5 py-2 bg-primary hover:bg-primary-hover disabled:opacity-50 text-white text-xs font-extrabold rounded-xl shadow-md shadow-primary/20 transition shrink-0"
          >
            {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            <span>{saving ? 'Saving...' : 'Save Changes'}</span>
          </button>
        </div>
      </div>

      {/* Scope Selector */}
      <CompanyScopeSelector onScopeChange={(newId) => fetchAllSettings(newId)} />

      {/* Alerts */}
      {successMsg && (
        <div className="p-3.5 bg-primary/10 border border-primary/30 rounded-xl text-primary text-xs font-bold flex items-center gap-2 animate-in fade-in duration-200">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div className="p-3.5 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-600 dark:text-rose-400 text-xs font-bold flex items-center gap-2 animate-in fade-in duration-200">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* ─── 2. COMPANY IDENTITY & BRANDING CARD ─── */}
      <div className="bg-card rounded-2xl border border-border/70 shadow-sm p-6 space-y-6">
        <div className="border-b border-border/40 pb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">Identity & Assets</h3>
          </div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Company Overview</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Company Display Name */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-foreground">Company Display Name</label>
            <input
              type="text"
              value={branding.companyName || ''}
              onChange={(e) => setBranding({ ...branding, companyName: e.target.value })}
              placeholder="e.g. Innoveity Enterprise"
              className="w-full px-3.5 py-2.5 bg-background border border-border/70 rounded-xl text-xs font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition shadow-2xs"
            />
            <p className="text-[10px] text-muted-foreground">
              Displayed on logins, navigation headers, and notifications.
            </p>
          </div>

          {/* Company Logo Upload & Preview */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-foreground">Company Logo</label>
            <div className="flex items-center gap-4 p-3 rounded-xl border border-border/70 bg-muted/20">
              <div className="h-14 w-14 rounded-xl border border-border/70 bg-card flex items-center justify-center overflow-hidden shrink-0 shadow-2xs">
                {currentDisplayLogo ? (
                  <img
                    src={currentDisplayLogo}
                    alt="Company Logo Preview"
                    className="h-full w-full object-contain p-1"
                    onError={(e) => { e.target.style.display = 'none'; }}
                  />
                ) : (
                  <ImageIcon className="h-6 w-6 text-muted-foreground" />
                )}
              </div>

              <div className="flex-1 space-y-2">
                <div className="flex items-center gap-2">
                  <label className="cursor-pointer inline-flex items-center gap-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 px-3 py-1.5 text-xs font-bold transition-all border border-primary/20 shadow-2xs">
                    <Upload className="h-3.5 w-3.5" />
                    <span>{currentDisplayLogo ? 'Replace Logo' : 'Upload Logo'}</span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/svg+xml,image/webp"
                      onChange={handleLogoFileChange}
                      className="hidden"
                    />
                  </label>

                  {currentDisplayLogo && (
                    <button
                      type="button"
                      onClick={handleRemoveLogo}
                      className="inline-flex items-center gap-1 rounded-lg bg-rose-500/10 text-rose-600 hover:bg-rose-500/20 px-2.5 py-1.5 text-xs font-bold transition-all border border-rose-500/20 shadow-2xs"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>Remove</span>
                    </button>
                  )}
                </div>

                <p className="text-[10px] text-muted-foreground">
                  PNG, SVG, or JPG (Max 10MB). Reverts to default logo if removed.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ─── 3. THEME PALETTE SECTION (6 SELECTABLE THEME CARDS) ─── */}
      <div className="bg-card rounded-2xl border border-border/70 shadow-sm p-6 space-y-6">
        <div className="border-b border-border/40 pb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">Theme Palette Selector</h3>
          </div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">6 Selectable Enterprise Themes</span>
        </div>

        <p className="text-xs text-muted-foreground">
          Select a predefined enterprise theme. Clicking a card updates the application immediately.
        </p>

        {/* The 6 Theme Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {THEME_PRESETS.map((preset) => {
            const isSelected = branding.selectedTheme === preset.id ||
              (!branding.selectedTheme && branding.themeColor?.toLowerCase() === preset.themeColor.toLowerCase());

            return (
              <div
                key={preset.id}
                onClick={() => handleSelectTheme(preset)}
                className={`cursor-pointer rounded-2xl border-2 p-5 transition-all relative overflow-hidden flex flex-col justify-between space-y-4 hover:shadow-md ${
                  isSelected
                    ? `${preset.cardBorder} bg-primary/5 ring-2 ring-primary/30`
                    : 'border-border/60 bg-card hover:border-border'
                }`}
              >
                {isSelected && (
                  <div className="absolute top-3.5 right-3.5 text-primary">
                    <CheckCircle2 className="h-5 w-5 fill-primary text-white" />
                  </div>
                )}

                <div className="space-y-1 pr-6">
                  <h4 className="text-sm font-bold text-foreground">{preset.name}</h4>
                  <p className="text-[11px] text-muted-foreground line-clamp-2">{preset.description}</p>
                </div>

                {/* Swatches Preview Box */}
                <div className="space-y-2 bg-muted/30 p-3 rounded-xl border border-border/40">
                  <span className="text-[9px] font-extrabold uppercase tracking-wider text-muted-foreground block">
                    Swatches Preview
                  </span>

                  <div className="flex items-center gap-2">
                    {/* Sidebar Swatch */}
                    <div className="flex flex-col items-center gap-1">
                      <div className={`h-6 w-6 rounded-md shadow-2xs ${preset.sidebarColor}`} />
                      <span className="text-[8px] text-muted-foreground">Sidebar</span>
                    </div>

                    {/* Header Swatch */}
                    <div className="flex flex-col items-center gap-1">
                      <div className={`h-6 w-6 rounded-md shadow-2xs ${preset.headerColor}`} />
                      <span className="text-[8px] text-muted-foreground">Header</span>
                    </div>

                    {/* Accent Swatch */}
                    <div className="flex flex-col items-center gap-1">
                      <div className={`h-6 w-6 rounded-md shadow-2xs ${preset.accentColorClass}`} />
                      <span className="text-[8px] text-muted-foreground">Accent</span>
                    </div>

                    {/* Button Sample */}
                    <div className="flex flex-col items-center gap-1 ml-auto">
                      <span className={`px-2 py-1 rounded text-[9px] font-bold shadow-2xs ${preset.buttonColor}`}>
                        Button
                      </span>
                    </div>
                  </div>
                </div>

                {/* Action Row */}
                <div className="pt-1 flex items-center justify-between">
                  <button
                    type="button"
                    className={`text-[11px] font-bold px-3 py-1 rounded-lg transition-all ${
                      isSelected
                        ? 'bg-primary text-white shadow-2xs'
                        : 'bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80'
                    }`}
                  >
                    {isSelected ? 'Active Theme' : 'Preview Theme'}
                  </button>
                  <div className="flex items-center gap-1.5">
                    <div className="w-3.5 h-3.5 rounded-full border border-border/70" style={{ backgroundColor: preset.themeColor }} />
                    <div className="w-3.5 h-3.5 rounded-full border border-border/70" style={{ backgroundColor: preset.accentColor }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Color Hex Overrides */}
        <div className="pt-4 border-t border-border/40 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold text-foreground mb-1.5">Primary Theme Color</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={branding.themeColor || '#10B981'}
                onChange={(e) => setBranding({ ...branding, themeColor: e.target.value })}
                className="w-10 h-10 rounded-xl bg-background border border-border/70 cursor-pointer p-0.5"
              />
              <input
                type="text"
                value={branding.themeColor || '#10B981'}
                onChange={(e) => setBranding({ ...branding, themeColor: e.target.value })}
                className="flex-1 px-3.5 py-2 bg-background border border-border/70 rounded-xl text-xs font-mono text-foreground focus:outline-none focus:border-primary"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-foreground mb-1.5">Accent Shade</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={branding.accentColor || '#064E3B'}
                onChange={(e) => setBranding({ ...branding, accentColor: e.target.value })}
                className="w-10 h-10 rounded-xl bg-background border border-border/70 cursor-pointer p-0.5"
              />
              <input
                type="text"
                value={branding.accentColor || '#064E3B'}
                onChange={(e) => setBranding({ ...branding, accentColor: e.target.value })}
                className="flex-1 px-3.5 py-2 bg-background border border-border/70 rounded-xl text-xs font-mono text-foreground focus:outline-none focus:border-primary"
              />
            </div>
          </div>
        </div>
      </div>

      {/* ─── LOGIN PAGE THEME SECTION (COLOR THEME ONLY) ─── */}
      <div className="bg-card rounded-2xl border border-border/70 shadow-sm p-6 space-y-6">
        <div className="border-b border-border/40 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center shrink-0">
              <Sliders className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">Login Page Theme</h3>
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground bg-muted/60 px-2 py-0.5 rounded-full border border-border/40">
                  Color Theme Only
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Customize the company login screen colors. Select a predefined color theme below.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleResetLoginTheme}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold border border-border/80 hover:bg-muted text-foreground transition-all"
              title="Reset login theme to Innoveity Orange"
            >
              <Undo2 className="h-3.5 w-3.5" />
              <span>Reset to Default</span>
            </button>
            <button
              type="button"
              onClick={handleSaveBranding}
              disabled={saving || loading}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-xs font-bold bg-primary text-white hover:bg-primary-hover shadow-md shadow-primary/20 transition-all disabled:opacity-50"
            >
              {saving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              <span>{saving ? 'Saving...' : 'Save Theme'}</span>
            </button>
          </div>
        </div>

        {/* The 8 Predefined Theme Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {LOGIN_COLOR_THEMES.map((theme) => {
            const isSelected = (loginPrimaryColor || '#F97316').toLowerCase() === theme.primaryColor.toLowerCase();

            return (
              <div
                key={theme.id}
                onClick={() => setLoginPrimaryColor(theme.primaryColor)}
                className={`cursor-pointer rounded-2xl border-2 p-5 transition-all relative overflow-hidden flex flex-col justify-between space-y-4 hover:shadow-md ${
                  isSelected
                    ? `${theme.cardBorder} bg-primary/5 ring-2 ring-primary/30`
                    : 'border-border/60 bg-card hover:border-border'
                }`}
              >
                {isSelected && (
                  <div className="absolute top-3.5 right-3.5 text-primary">
                    <CheckCircle2 className="h-5 w-5 fill-primary text-white" />
                  </div>
                )}

                <div className="space-y-1 pr-6">
                  <h4 className="text-sm font-bold text-foreground">{theme.name}</h4>
                  <p className="text-[11px] text-muted-foreground line-clamp-2">{theme.description}</p>
                </div>

                {/* Swatches Preview Box */}
                <div className="space-y-2 bg-muted/30 p-3 rounded-xl border border-border/40">
                  <span className="text-[9px] font-extrabold uppercase tracking-wider text-muted-foreground block">
                    Swatches Preview
                  </span>

                  <div className="flex items-center gap-2">
                    {/* Primary Color Swatch */}
                    <div className="flex flex-col items-center gap-1">
                      <div
                        className="h-6 w-6 rounded-md shadow-2xs border border-border/40"
                        style={{ backgroundColor: theme.primaryColor }}
                      />
                      <span className="text-[8px] text-muted-foreground">Primary</span>
                    </div>

                    {/* Accent Color Swatch */}
                    <div className="flex flex-col items-center gap-1">
                      <div
                        className="h-6 w-6 rounded-md shadow-2xs border border-border/40"
                        style={{ backgroundColor: theme.accentColor }}
                      />
                      <span className="text-[8px] text-muted-foreground">Accent</span>
                    </div>

                    {/* Login Button Preview */}
                    <div className="flex flex-col items-center gap-1 ml-auto">
                      <span
                        className="px-2.5 py-1 rounded-lg text-[9px] font-bold shadow-2xs text-white"
                        style={{ backgroundColor: theme.primaryColor }}
                      >
                        Log In
                      </span>
                    </div>
                  </div>
                </div>

                {/* Action Row */}
                <div className="pt-1 flex items-center justify-between">
                  <button
                    type="button"
                    className={`text-[11px] font-bold px-3 py-1 rounded-lg transition-all ${
                      isSelected
                        ? 'bg-primary text-white shadow-2xs'
                        : 'bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80'
                    }`}
                  >
                    {isSelected ? 'Active Theme' : 'Select Theme'}
                  </button>
                  <div className="flex items-center gap-1.5">
                    <div
                      className="w-3.5 h-3.5 rounded-full border border-border/70"
                      style={{ backgroundColor: theme.primaryColor }}
                    />
                    <div
                      className="w-3.5 h-3.5 rounded-full border border-border/70"
                      style={{ backgroundColor: theme.accentColor }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ─── 4. CHAT ACCESS CONTROLS (SUPER ADMIN FEATURE TOGGLES) ─── */}
      <div className="bg-card rounded-2xl border border-border/70 shadow-sm p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/40 pb-4">
          <div className="flex items-center gap-3.5">
            <div className="h-10 w-10 rounded-xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center shrink-0">
              <MessageCircle className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-foreground tracking-tight">
                Chat Access Controls
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Manage Chat availability for Admins and Users.
              </p>
            </div>
          </div>
          <span className="self-start sm:self-auto inline-flex items-center text-xs font-semibold uppercase tracking-wider px-3 py-1 rounded-full bg-primary/10 text-primary border border-primary/20 shrink-0">
            Feature Controls
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Switch 1: Admin Chat */}
          <div className="flex items-center justify-between p-4 rounded-xl border border-border/60 bg-background/50 hover:bg-background/80 hover:border-primary/30 transition-all">
            <div className="flex items-center gap-3.5 pr-3 min-w-0">
              <div className="h-9 w-9 rounded-lg bg-primary/10 border border-primary/20 text-primary flex items-center justify-center shrink-0">
                <Shield className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-bold text-foreground truncate">Admin Chat</h4>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${chatEnabledForAdmins ? 'bg-primary/10 text-primary border border-primary/20' : 'bg-muted text-muted-foreground'}`}>
                    {chatEnabledForAdmins ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                  Allow Admins to use Chat
                </p>
              </div>
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={chatEnabledForAdmins}
              onClick={() => handleToggleClick('ADMIN')}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary/40 focus:ring-offset-2 ${
                chatEnabledForAdmins ? 'bg-primary border-primary shadow-xs' : 'bg-slate-300 border-slate-400 dark:bg-slate-700 dark:border-slate-500 shadow-inner'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md border border-black/10 dark:border-white/10 transition duration-200 ease-in-out ${
                  chatEnabledForAdmins ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Switch 2: User Chat */}
          <div className="flex items-center justify-between p-4 rounded-xl border border-border/60 bg-background/50 hover:bg-background/80 hover:border-primary/30 transition-all">
            <div className="flex items-center gap-3.5 pr-3 min-w-0">
              <div className="h-9 w-9 rounded-lg bg-primary/10 border border-primary/20 text-primary flex items-center justify-center shrink-0">
                <Users className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-bold text-foreground truncate">User Chat</h4>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${chatEnabledForUsers ? 'bg-primary/10 text-primary border border-primary/20' : 'bg-muted text-muted-foreground'}`}>
                    {chatEnabledForUsers ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                  Team Leaders, Employees &amp; Interns
                </p>
              </div>
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={chatEnabledForUsers}
              onClick={() => handleToggleClick('USER')}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary/40 focus:ring-offset-2 ${
                chatEnabledForUsers ? 'bg-primary border-primary shadow-xs' : 'bg-slate-300 border-slate-400 dark:bg-slate-700 dark:border-slate-500 shadow-inner'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md border border-black/10 dark:border-white/10 transition duration-200 ease-in-out ${
                  chatEnabledForUsers ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>

        {/* Informational Callout */}
        <div className="flex items-start gap-3 p-4 rounded-xl bg-primary/5 dark:bg-primary/10 border border-primary/20 text-xs text-muted-foreground leading-relaxed">
          <Info className="h-4 w-4 text-primary shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p className="font-semibold text-foreground">Super Admin always retains Chat access.</p>
            <p>Disabling Chat hides it from the UI and blocks API access without deleting any message history.</p>
          </div>
        </div>
      </div>

      {/* ─── 5. BOTTOM ACTION BAR ─── */}
      <div className="flex items-center justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={handleReset}
          disabled={saving || loading}
          className="flex items-center gap-1.5 px-4 py-2.5 bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground text-xs font-bold rounded-xl border border-border/60 transition shadow-2xs shrink-0 disabled:opacity-50"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Reset Defaults</span>
        </button>

        <button
          type="button"
          onClick={handleSaveBranding}
          disabled={saving || loading}
          className="flex items-center gap-2 px-6 py-2.5 bg-primary hover:bg-primary-hover disabled:opacity-50 text-white text-xs font-extrabold rounded-xl shadow-md shadow-primary/20 transition shrink-0"
        >
          {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          <span>{saving ? 'Saving...' : 'Save Changes'}</span>
        </button>
      </div>

      {/* ─── 6. CONFIRMATION MODAL FOR CHAT TOGGLES ─── */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-200">
          <div className="bg-card border border-border/70 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-primary">
              <AlertCircle className="h-6 w-6 shrink-0" />
              <h3 className="text-base font-bold text-foreground">Confirm Feature Toggle</h3>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">
              Are you sure you want to {((pendingToggleRole === 'ADMIN' ? chatEnabledForAdmins : chatEnabledForUsers) ? 'disable' : 'enable')} Chat access for {pendingToggleRole === 'ADMIN' ? 'Admins' : 'Users (Team Leaders, Employees, Interns)'}?
            </p>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => { setShowConfirmModal(false); setPendingToggleRole(null); }}
                disabled={toggling}
                className="px-4 py-2 rounded-xl text-xs font-bold text-muted-foreground hover:text-foreground bg-muted hover:bg-muted/80 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmToggleChange}
                disabled={toggling}
                className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-primary hover:bg-primary-hover shadow-md shadow-primary/20 transition flex items-center gap-1.5"
              >
                {toggling ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : null}
                <span>{toggling ? 'Updating...' : 'Confirm'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BrandingCenter;
