import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Palette, Upload, Image as ImageIcon, Trash2, CheckCircle2,
  Building2, Save, Sun, Moon, Sparkles, RefreshCw, AlertCircle,
  MessageSquare, MessageCircle, Shield, Users, Info, Loader2,
  Sliders, Undo2
} from 'lucide-react';
import api, { getUploadUrl } from '../../../services/api';
import { useTheme } from '../../../context/ThemeContext';
import CompanyScopeSelector from '../../../components/common/CompanyScopeSelector';
import { useCompanyScope } from '../../../context/CompanyScopeContext';

const THEME_PRESETS = [
  {
    id: 'emerald',
    name: 'Default Green',
    description: 'Classic emerald green enterprise palette',
    sidebarColor: 'bg-emerald-950',
    headerColor: 'bg-emerald-600',
    buttonColor: 'bg-emerald-600 text-white',
    accentColor: 'bg-emerald-500',
    cardBorder: 'border-emerald-500/40'
  },
  {
    id: 'blue',
    name: 'Royal Blue',
    description: 'Professional royal blue corporate design',
    sidebarColor: 'bg-blue-950',
    headerColor: 'bg-blue-600',
    buttonColor: 'bg-blue-600 text-white',
    accentColor: 'bg-blue-500',
    cardBorder: 'border-blue-500/40'
  },
  {
    id: 'purple',
    name: 'Vibrant Purple',
    description: 'Modern violet & deep purple theme',
    sidebarColor: 'bg-purple-950',
    headerColor: 'bg-purple-600',
    buttonColor: 'bg-purple-600 text-white',
    accentColor: 'bg-purple-500',
    cardBorder: 'border-purple-500/40'
  },
  {
    id: 'orange',
    name: 'Warm Orange',
    description: 'Energetic tangerine & amber tone',
    sidebarColor: 'bg-stone-900',
    headerColor: 'bg-orange-600',
    buttonColor: 'bg-orange-600 text-white',
    accentColor: 'bg-orange-500',
    cardBorder: 'border-orange-500/40'
  },
  {
    id: 'dark-corporate',
    name: 'Dark Corporate',
    description: 'Sleek dark slate with sky cyan accents',
    sidebarColor: 'bg-primary-dark',
    headerColor: 'bg-card',
    buttonColor: 'bg-sky-500 text-foreground',
    accentColor: 'bg-cyan-400',
    cardBorder: 'border-sky-500/40'
  },
  {
    id: 'maroon',
    name: 'Maroon',
    description: 'Professional maroon enterprise theme with elegant burgundy accents.',
    sidebarColor: 'bg-rose-950',
    headerColor: 'bg-rose-900',
    buttonColor: 'bg-rose-900 text-white',
    accentColor: 'bg-rose-600',
    cardBorder: 'border-rose-900/40'
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

const BrandingSkeleton = () => (
  <div className="space-y-6 text-left max-w-6xl mx-auto animate-pulse">
    {/* Page Header Skeleton */}
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border/30 pb-4">
      <div className="space-y-2">
        <div className="h-5 w-48 bg-muted rounded-full" />
        <div className="h-8 w-72 bg-muted rounded-xl" />
        <div className="h-4 w-96 bg-muted rounded-lg" />
      </div>
      <div className="h-10 w-44 bg-muted rounded-xl shrink-0" />
    </div>

    {/* Scope Selector Skeleton */}
    <div className="h-14 w-full bg-muted/60 rounded-2xl border border-border/40" />

    {/* Module 1 Skeleton: Company Branding */}
    <div className="rounded-2xl border border-border/40 bg-card p-6 space-y-6">
      <div className="h-6 w-40 bg-muted rounded-lg" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-2">
          <div className="h-4 w-28 bg-muted rounded" />
          <div className="h-10 w-full bg-muted rounded-xl" />
        </div>
        <div className="space-y-2">
          <div className="h-4 w-28 bg-muted rounded" />
          <div className="h-16 w-full bg-muted rounded-xl" />
        </div>
      </div>
    </div>

    {/* Module 2 Skeleton: Theme Cards */}
    <div className="rounded-2xl border border-border/40 bg-card p-6 space-y-6">
      <div className="h-6 w-48 bg-muted rounded-lg" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="h-40 bg-muted/40 rounded-2xl border border-border/40" />
        ))}
      </div>
    </div>
  </div>
);

const BrandingTheme = () => {
  const {
    companyName: ctxName,
    companyLogo: ctxLogo,
    selectedTheme: ctxTheme,
    themeMode: ctxMode,
    updateThemeSettings
  } = useTheme();

  const { selectedOrgId } = useCompanyScope();

  const [companyName, setCompanyName] = useState(ctxName || 'Innoviety Enterprise');
  const [selectedTheme, setSelectedTheme] = useState(ctxTheme || 'emerald');
  const [themeMode, setThemeMode] = useState(ctxMode || 'light');
  const [chatEnabledForAdmins, setChatEnabledForAdmins] = useState(true);
  const [chatEnabledForUsers, setChatEnabledForUsers] = useState(true);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [pendingToggleRole, setPendingToggleRole] = useState(null); // 'ADMIN' or 'USER'

  const [logoFile, setLogoFile] = useState(null);
  const [logoPreview, setLogoPreview] = useState(ctxLogo ? getUploadUrl(ctxLogo) : null);
  const [removeLogo, setRemoveLogo] = useState(false);

  // Login Page Theme Customization State
  const [loginPrimaryColor, setLoginPrimaryColor] = useState('#F97316');

  const [saving, setSaving] = useState(false);
  const [loadingBranding, setLoadingBranding] = useState(true);
  const [message, setMessage] = useState({ type: '', text: '' });

  const fetchCompanyBranding = async (orgId = selectedOrgId) => {
    try {
      setLoadingBranding(true);
      const params = (orgId && orgId !== 'all') ? { organizationId: orgId } : {};
      const res = await api.get('/super-admin/branding', { params });
      if (res.data) {
        setCompanyName(res.data.companyName || '');
        setSelectedTheme(res.data.selectedTheme || 'emerald');
        setThemeMode(res.data.themeMode || 'light');
        setLogoPreview(res.data.companyLogo ? getUploadUrl(res.data.companyLogo) : null);
        setLogoFile(null);
        setRemoveLogo(false);

        const adminVal = res.data.organization?.chatEnabledForAdmins ?? res.data.chatEnabledForAdmins ?? true;
        const userVal = res.data.organization?.chatEnabledForUsers ?? res.data.chatEnabledForUsers ?? true;
        setChatEnabledForAdmins(adminVal);
        setChatEnabledForUsers(userVal);

        // Login Page Theme customization fields
        const fetchedLoginColor = res.data.loginPrimaryColor || '#F97316';
        setLoginPrimaryColor(fetchedLoginColor);
        try {
          localStorage.setItem('mrf_login_primary_color', fetchedLoginColor);
          if (orgId && orgId !== 'all') {
            localStorage.setItem(`mrf_login_theme_${orgId}`, fetchedLoginColor);
          }
        } catch (e) {
          // ignore localStorage error
        }

        updateThemeSettings({
          companyName: res.data.companyName,
          companyLogo: res.data.companyLogo,
          selectedTheme: res.data.selectedTheme,
          themeMode: res.data.themeMode,
          platform: res.data.platform,
          organization: res.data.organization,
          chatEnabledForAdmins: adminVal,
          chatEnabledForUsers: userVal
        });
      }
    } catch (err) {
      console.error('Failed to fetch company branding:', err);
    } finally {
      setLoadingBranding(false);
    }
  };

  useEffect(() => {
    fetchCompanyBranding(selectedOrgId);
  }, [selectedOrgId]);

  useEffect(() => {
    if (!loadingBranding) {
      if (ctxName && companyName !== ctxName) setCompanyName(ctxName);
      if (ctxTheme && selectedTheme !== ctxTheme) setSelectedTheme(ctxTheme);
      if (ctxMode && themeMode !== ctxMode) setThemeMode(ctxMode);
    }
  }, [ctxName, ctxTheme, ctxMode]);

  const handleLogoFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setLogoFile(file);
      setRemoveLogo(false);
      setLogoPreview(URL.createObjectURL(file));
    }
  };

  const handleBgImageChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setLoginBgFile(file);
      setRemoveBgImage(false);
      setLoginBgPreview(URL.createObjectURL(file));
    }
  };

  const handleRemoveBgImage = () => {
    setLoginBgFile(null);
    setLoginBgPreview(null);
    setRemoveBgImage(true);
  };

  const handleResetLoginTheme = () => {
    const defaultColor = '#F97316';
    setLoginPrimaryColor(defaultColor);
    try {
      localStorage.setItem('mrf_login_primary_color', defaultColor);
      if (selectedOrgId && selectedOrgId !== 'all') {
        localStorage.setItem(`mrf_login_theme_${selectedOrgId}`, defaultColor);
      }
      window.dispatchEvent(new CustomEvent('mrf_login_theme_changed', {
        detail: { primaryColor: defaultColor, organizationId: selectedOrgId }
      }));
    } catch (e) {
      // ignore localStorage error
    }
    setMessage({ type: 'success', text: 'Login theme reset to Innoveity Orange (Default). Click "Save Theme" to persist.' });
    setTimeout(() => setMessage({ type: '', text: '' }), 4000);
  };

  const handleSave = async (e) => {
    if (e) e.preventDefault();
    setSaving(true);
    setMessage({ type: '', text: '' });

    try {
      const formData = new FormData();
      formData.append('companyName', companyName);
      formData.append('selectedTheme', selectedTheme);
      formData.append('themeMode', themeMode);
      formData.append('chatEnabledForAdmins', String(chatEnabledForAdmins));
      formData.append('chatEnabledForUsers', String(chatEnabledForUsers));
      if (selectedOrgId) {
        formData.append('organizationId', selectedOrgId);
      }
      if (removeLogo) {
        formData.append('removeLogo', 'true');
      }
      if (logoFile) {
        formData.append('logo', logoFile);
      }

      // Append Login Page Theme Primary Color
      formData.append('loginPrimaryColor', loginPrimaryColor);

      const res = await api.put('/super-admin/branding', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      updateThemeSettings({
        companyName: res.data.companyName,
        companyLogo: res.data.companyLogo,
        selectedTheme: res.data.selectedTheme,
        themeMode: res.data.themeMode,
        chatEnabledForAdmins: res.data.chatEnabledForAdmins,
        chatEnabledForUsers: res.data.chatEnabledForUsers
      });

      // Sync login theme to localStorage and dispatch event
      try {
        localStorage.setItem('mrf_login_primary_color', loginPrimaryColor);
        if (selectedOrgId && selectedOrgId !== 'all') {
          localStorage.setItem(`mrf_login_theme_${selectedOrgId}`, loginPrimaryColor);
        }
        window.dispatchEvent(new CustomEvent('mrf_login_theme_changed', {
          detail: { primaryColor: loginPrimaryColor, organizationId: selectedOrgId }
        }));
      } catch (e) {
        // ignore localStorage error
      }

      setMessage({ type: 'success', text: 'Branding, login theme, and feature settings saved successfully!' });
      setTimeout(() => setMessage({ type: '', text: '' }), 4000);
    } catch (err) {
      console.error('Failed to save branding settings:', err);
      setMessage({ type: 'error', text: err.response?.data?.message || 'Failed to save settings.' });
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveLogo = () => {
    setLogoFile(null);
    setLogoPreview(null);
    setRemoveLogo(true);
  };

  const handleThemeCardClick = (themeId) => {
    setSelectedTheme(themeId);
    // Apply immediately to current viewport for live preview!
    updateThemeSettings({ selectedTheme: themeId });
  };

  const handleModeToggle = (mode) => {
    setThemeMode(mode);
    updateThemeSettings({ themeMode: mode });
  };

  const [toggling, setToggling] = useState(false);

  const handleToggleClick = (targetRole) => {
    setPendingToggleRole(targetRole);
    setShowConfirmModal(true);
  };

  const confirmToggleChange = async () => {
    if (!pendingToggleRole) return;
    setToggling(true);
    setMessage({ type: '', text: '' });

    try {
      const prevVal = pendingToggleRole === 'ADMIN' ? chatEnabledForAdmins : chatEnabledForUsers;
      const nextVal = !prevVal;
      const newAdmins = pendingToggleRole === 'ADMIN' ? nextVal : chatEnabledForAdmins;
      const newUsers = pendingToggleRole === 'USER' ? nextVal : chatEnabledForUsers;

      console.log('[TRACE F1] Confirm clicked', { pendingToggleRole, nextVal });
      console.log('[TRACE F2] Current React state before request', { chatEnabledForAdmins, chatEnabledForUsers, selectedOrgId });

      const payload = {
        organizationId: (selectedOrgId && selectedOrgId !== 'all') ? selectedOrgId : null,
        companyName,
        selectedTheme,
        themeMode,
        chatEnabledForAdmins: newAdmins,
        chatEnabledForUsers: newUsers
      };

      console.log('[TRACE F3] Payload being sent:', payload);

      let res;
      if (logoFile) {
        const formData = new FormData();
        Object.keys(payload).forEach(k => {
          if (payload[k] !== null && payload[k] !== undefined) formData.append(k, String(payload[k]));
        });
        formData.append('logo', logoFile);
        res = await api.put('/super-admin/branding', formData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });
      } else {
        res = await api.put('/super-admin/branding', payload);
      }

      console.log('[TRACE F4] Await returned');
      console.log('[TRACE F5] Response status:', res.status);
      console.log('[TRACE F6] Response body:', res.data);

      setChatEnabledForAdmins(newAdmins);
      setChatEnabledForUsers(newUsers);

      console.log('[TRACE F7] State after update', { newAdmins, newUsers });

      updateThemeSettings({
        companyName: res.data.companyName || companyName,
        companyLogo: res.data.companyLogo,
        selectedTheme: res.data.selectedTheme || selectedTheme,
        themeMode: res.data.themeMode || themeMode,
        chatEnabledForAdmins: newAdmins,
        chatEnabledForUsers: newUsers,
        platform: res.data.platform || { chatEnabledForAdmins: newAdmins, chatEnabledForUsers: newUsers },
        organization: res.data.organization || null
      });

      setMessage({
        type: 'success',
        text: `Chat access for ${pendingToggleRole === 'ADMIN' ? 'Admins' : 'Users'} successfully ${(pendingToggleRole === 'ADMIN' ? newAdmins : newUsers) ? 'enabled' : 'disabled'}!`
      });

      setShowConfirmModal(false);
      setPendingToggleRole(null);
    } catch (err) {
      console.error('[TRACE F8] Catch block:', err.response?.data || err.message || err);
      setMessage({ type: 'error', text: err.response?.data?.message || err.message || 'Failed to update chat access settings.' });
    } finally {
      console.log('[TRACE F9] Finally block');
      setToggling(false);
    }
  };

  if (loadingBranding) {
    return <BrandingSkeleton />;
  }

  return (
    <div className="space-y-6 text-left max-w-6xl mx-auto">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border/30 pb-4">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary border border-primary/20 mb-2">
            <Palette className="h-3.5 w-3.5" />
            <span>Platform Branding & Theme Module</span>
          </div>
          <h1 className="text-2xl font-extrabold text-foreground tracking-tight">
            Company Branding & Theme Management
          </h1>
          <p className="text-xs text-muted-foreground">
            Configure platform branding details and select predefined visual themes that instantly apply across the enterprise app.
          </p>
        </div>

        <button
          onClick={handleSave}
          disabled={saving || loadingBranding}
          className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-xs font-bold text-white hover:bg-primary-hover shadow-md transition-all shrink-0 disabled:opacity-50"
        >
          {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          <span>{saving ? 'Saving...' : 'Save Branding & Theme'}</span>
        </button>
      </div>

      {/* Shared Company Selector Bar */}
      <CompanyScopeSelector onScopeChange={(newId) => fetchCompanyBranding(newId)} />

      {message.text && (
        <div className={`p-4 rounded-xl text-xs font-bold flex items-center gap-2 ${message.type === 'success' ? 'bg-primary/10 text-primary border border-primary/30' : 'bg-red-500/10 text-red-500 border border-red-500/30'}`}>
          {message.type === 'success' ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
          <span>{message.text}</span>
        </div>
      )}

      {/* Module 1: Company Branding Card */}
      <div className="rounded-2xl border border-border/40 bg-card p-6 shadow-sm space-y-6">
        <div className="border-b border-border/30 pb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" />
            <h3 className="text-base font-bold text-foreground">Company Branding</h3>
          </div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">App Header & Sidebar</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Company Name */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-foreground block">
              Company Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="e.g. Innoviety Enterprise"
              className="w-full rounded-xl border border-border/60 bg-background px-4 py-2.5 text-xs font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            <p className="text-[10px] text-muted-foreground">
              Displayed in the navigation sidebar, login page, and application headers.
            </p>
          </div>

          {/* Company Logo Upload & Preview */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-foreground block">
              Company Logo
            </label>

            <div className="flex items-center gap-4 p-3 rounded-xl border border-border/60 bg-muted/20">
              <div className="h-14 w-14 rounded-xl border border-border/50 bg-card flex items-center justify-center overflow-hidden shrink-0 shadow-2xs">
                {logoPreview ? (
                  <img
                    src={getUploadUrl(logoPreview)}
                    alt="Company Logo Preview"
                    className="h-full w-full object-contain p-1"
                    onError={(e) => {
                      e.target.onerror = null;
                      e.target.src = '/logo.png';
                    }}
                  />
                ) : (
                  <ImageIcon className="h-6 w-6 text-muted-foreground" />
                )}
              </div>

              <div className="flex-1 space-y-2">
                <div className="flex items-center gap-2">
                  <label className="cursor-pointer inline-flex items-center gap-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 px-3 py-1.5 text-xs font-bold transition-all">
                    <Upload className="h-3.5 w-3.5" />
                    <span>{logoPreview ? 'Replace Logo' : 'Upload Logo'}</span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleLogoFileChange}
                      className="hidden"
                    />
                  </label>

                  {logoPreview && (
                    <button
                      type="button"
                      onClick={handleRemoveLogo}
                      className="inline-flex items-center gap-1 rounded-lg bg-rose-500/10 text-rose-600 hover:bg-rose-500/20 px-2.5 py-1.5 text-xs font-bold transition-all"
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

      {/* Module 2: Theme Management Card */}
      <div className="rounded-2xl border border-border/40 bg-card p-6 shadow-sm space-y-6">
        <div className="border-b border-border/30 pb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <h3 className="text-base font-bold text-foreground">Theme Palette Selector</h3>
          </div>

          <div className="flex items-center gap-1 bg-muted/40 p-1 rounded-xl border border-border/30">
            <button
              type="button"
              onClick={() => handleModeToggle('light')}
              className={`flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-bold transition-all ${themeMode === 'light' ? 'bg-card text-foreground shadow-2xs' : 'text-muted-foreground'}`}
            >
              <Sun className="h-3.5 w-3.5 text-amber-500" />
              <span>Light Mode</span>
            </button>
            <button
              type="button"
              onClick={() => handleModeToggle('dark')}
              className={`flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-bold transition-all ${themeMode === 'dark' ? 'bg-card text-foreground shadow-2xs' : 'text-muted-foreground'}`}
            >
              <Moon className="h-3.5 w-3.5 text-indigo-400" />
              <span>Dark Mode</span>
            </button>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Select a predefined enterprise theme. Clicking a card updates the application's appearance immediately.
        </p>

        {/* Theme Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {THEME_PRESETS.map((preset) => {
            const isSelected = selectedTheme === preset.id;

            return (
              <div
                key={preset.id}
                onClick={() => handleThemeCardClick(preset.id)}
                className={`cursor-pointer rounded-2xl border-2 p-5 transition-all relative overflow-hidden flex flex-col justify-between space-y-4 hover:shadow-md ${isSelected ? `${preset.cardBorder} bg-primary/5 ring-2 ring-primary/30` : 'border-border/40 bg-card hover:border-border'}`}
              >
                {isSelected && (
                  <div className="absolute top-3 right-3 text-primary">
                    <CheckCircle2 className="h-5 w-5 fill-primary text-white" />
                  </div>
                )}

                <div className="space-y-1">
                  <h4 className="text-sm font-bold text-foreground">{preset.name}</h4>
                  <p className="text-[11px] text-muted-foreground">{preset.description}</p>
                </div>

                {/* Color Swatches Preview Component */}
                <div className="space-y-2 bg-muted/30 p-3 rounded-xl border border-border/30">
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
                      <div className={`h-6 w-6 rounded-md shadow-2xs ${preset.accentColor}`} />
                      <span className="text-[8px] text-muted-foreground">Accent</span>
                    </div>

                    {/* Button Sample */}
                    <div className="flex flex-col items-center gap-1 ml-auto">
                      <span className={`px-2 py-1 rounded text-[9px] font-bold ${preset.buttonColor}`}>
                        Button
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ─── MODULE: LOGIN PAGE THEME (COLOR THEME ONLY) ─── */}
      <div className="rounded-2xl border border-border/40 bg-card p-6 shadow-sm space-y-6">
        <div className="border-b border-border/30 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center shrink-0">
              <Sliders className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-foreground">Login Page Theme</h3>
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
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold border border-border/80 hover:bg-muted text-foreground transition-all"
              title="Reset login screen customizations to default"
            >
              <Undo2 className="h-3.5 w-3.5" />
              <span>Reset to Default</span>
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-primary text-white hover:bg-primary-hover shadow-md transition-all disabled:opacity-50"
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

      {/* ─── CHAT ACCESS CONTROLS (SUPER ADMIN FEATURE TOGGLES) ─── */}
      <div className="bg-card border border-border/70 rounded-3xl p-6 shadow-sm space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/40 pb-5">
          <div className="flex items-center gap-3.5">
            <div className="h-11 w-11 rounded-full bg-primary/10 border border-primary/20 text-primary flex items-center justify-center shrink-0">
              <MessageCircle className="h-[22px] w-[22px]" />
            </div>
            <div>
              <h3 className="text-xl md:text-2xl font-semibold text-foreground tracking-tight">
                Chat Access Controls
              </h3>
              <p className="text-sm text-muted-foreground mt-0.5">
                Manage Chat availability for Admins and Users.
              </p>
            </div>
          </div>
          <span className="self-start sm:self-auto inline-flex items-center text-xs font-semibold uppercase tracking-wider px-3 py-1 rounded-full bg-primary/10 text-primary border border-primary/20 shrink-0">
            Feature Controls
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
          {/* Switch 1: Admin Chat */}
          <div className="flex items-center justify-between p-5 rounded-[20px] border border-border/60 bg-background/50 hover:bg-background/80 hover:border-primary/30 transition-all duration-200 ease-in-out hover:-translate-y-[2px] hover:shadow-sm group">
            <div className="flex items-center gap-3.5 pr-3 min-w-0">
              <div className="h-10 w-10 rounded-xl bg-primary/10 border border-primary/15 text-primary flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform duration-200">
                <Shield className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h4 className="text-base font-medium text-foreground truncate">Admin Chat</h4>
                  <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${chatEnabledForAdmins ? 'bg-primary/10 text-primary border border-primary/20' : 'bg-muted text-muted-foreground'}`}>
                    {chatEnabledForAdmins ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
                <p className="text-xs md:text-[13px] text-muted-foreground mt-0.5 truncate">
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
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md border border-black/10 dark:border-white/10 ring-0 transition duration-200 ease-in-out ${
                  chatEnabledForAdmins ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Switch 2: User Chat */}
          <div className="flex items-center justify-between p-5 rounded-[20px] border border-border/60 bg-background/50 hover:bg-background/80 hover:border-primary/30 transition-all duration-200 ease-in-out hover:-translate-y-[2px] hover:shadow-sm group">
            <div className="flex items-center gap-3.5 pr-3 min-w-0">
              <div className="h-10 w-10 rounded-xl bg-primary/10 border border-primary/15 text-primary flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform duration-200">
                <Users className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h4 className="text-base font-medium text-foreground truncate">User Chat</h4>
                  <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${chatEnabledForUsers ? 'bg-primary/10 text-primary border border-primary/20' : 'bg-muted text-muted-foreground'}`}>
                    {chatEnabledForUsers ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
                <p className="text-xs md:text-[13px] text-muted-foreground mt-0.5 truncate">
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
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md border border-black/10 dark:border-white/10 ring-0 transition duration-200 ease-in-out ${
                  chatEnabledForUsers ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>

        {/* Softer callout information note */}
        <div className="flex items-start gap-3 p-4 rounded-2xl bg-primary/5 dark:bg-primary/10 border border-primary/20 text-xs md:text-[13px] text-muted-foreground leading-relaxed">
          <Info className="h-5 w-5 text-primary shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p className="font-medium text-foreground">Super Admin always retains Chat access.</p>
            <p>Disabling Chat hides it from the UI and blocks API access without deleting any message history.</p>
          </div>
        </div>
      </div>

      {/* Confirmation Modal */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-200">
          <div className="bg-card border border-border rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-primary">
              <AlertCircle className="h-6 w-6 shrink-0" />
              <h3 className="text-lg font-bold text-foreground">Confirm Feature Toggle</h3>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">
              {pendingToggleRole === 'ADMIN' ? (
                chatEnabledForAdmins ? (
                  <span>Are you sure you want to <strong>disable</strong> Chat for Admins? Admins will no longer see the Chat menu, access <code className="bg-muted px-1 rounded">/chat</code>, or connect to chat rooms.</span>
                ) : (
                  <span>Are you sure you want to <strong>enable</strong> Chat for Admins? Admins will immediately regain access to their existing Chat history.</span>
                )
              ) : (
                chatEnabledForUsers ? (
                  <span>Are you sure you want to <strong>disable</strong> Chat for Team Leaders, Employees, and Interns? Chat menus and direct URL access will be removed immediately.</span>
                ) : (
                  <span>Are you sure you want to <strong>enable</strong> Chat for Team Leaders, Employees, and Interns? User chat access will be restored immediately.</span>
                )
              )}
            </p>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                disabled={toggling}
                onClick={() => { setShowConfirmModal(false); setPendingToggleRole(null); }}
                className="px-4 py-2 rounded-xl text-xs font-semibold border border-border/80 hover:bg-muted text-foreground transition-all disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={toggling}
                onClick={confirmToggleChange}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-primary text-white hover:bg-primary-hover shadow-md transition-all flex items-center gap-2 disabled:opacity-50"
              >
                {toggling ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Saving...</span>
                  </>
                ) : (
                  <span>Confirm Toggle</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BrandingTheme;
