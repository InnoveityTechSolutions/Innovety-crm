import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Building2, Lock, Mail, AlertTriangle, ArrowRight, ShieldCheck, CheckCircle2, RefreshCw, Clock } from 'lucide-react';
import api, { getUploadUrl } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useOrganizationBranding } from '../context/BrandContext';
import { setPlatformBranding } from '../utils/branding';

const CompanyLogin = () => {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, login } = useAuth();
  const { updatePublicBranding } = useOrganizationBranding();

  useEffect(() => {
    return () => {
      setPlatformBranding();
    };
  }, []);

  const [companyBranding, setCompanyBranding] = useState(null);
  const [loadingCompany, setLoadingCompany] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [isSuspended, setIsSuspended] = useState(false);

  // Form State
  const [loginInput, setLoginInput] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [formError, setFormError] = useState('');
  const [serverError, setServerError] = useState('');

  // Detect session expired parameter on mount / URL change
  useEffect(() => {
    if (searchParams.get('expired') === 'true') {
      setSessionExpired(true);
    } else {
      setSessionExpired(false);
    }
  }, [searchParams]);

  // 1. Cross-Tenant Protection (Phase 6.6): If authenticated user opens another company's login, redirect
  useEffect(() => {
    if (user) {
      const userRole = String(user.role).toUpperCase();
      const userSlug = user.organization?.slug || 'innoveity';
      if (userRole === 'SUPER_ADMIN') {
        navigate('/super-admin', { replace: true });
      } else if (user.accessTemplateId) {
        navigate('/profile', { replace: true });
      } else if (slug && userSlug.toLowerCase() !== slug.toLowerCase()) {
        console.warn(`[Cross-Tenant Protect] User from '${userSlug}' attempted to access '/company/${slug}'. Redirecting...`);
        navigate('/', { replace: true });
      } else {
        navigate('/', { replace: true });
      }
    }
  }, [user, slug, navigate]);

  // 2. Fetch Public Company Branding
  useEffect(() => {
    if (!slug) return;
    setLoadingCompany(true);
    setErrorMsg('');
    setIsSuspended(false);

    api.get(`/public/company/${slug}`)
      .then((res) => {
        if (res.data) {
          setCompanyBranding(res.data);
          updatePublicBranding(res.data);
        }
      })
      .catch((err) => {
        if (err.response?.status === 403) {
          setIsSuspended(true);
          setErrorMsg(err.response?.data?.message || 'This company account is currently suspended.');
        } else {
          setErrorMsg(err.response?.data?.message || 'Company not found. Please check the URL slug.');
        }
      })
      .finally(() => setLoadingCompany(false));
  }, [slug]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    setServerError('');
    setSessionExpired(false);

    // Cleanly remove expired parameter from URL if present
    if (searchParams.get('expired')) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('expired');
      setSearchParams(nextParams, { replace: true });
    }

    if (!loginInput.trim() || !password) {
      setFormError('Please enter your email/ID and password.');
      return;
    }

    try {
      setSubmitting(true);
      const res = await login(loginInput.trim(), password, { organizationSlug: slug });
      if (res && res.success) {
        const loggedUser = res.user || user;
        const loggedRole = String(loggedUser?.role || '').toUpperCase();
        if (loggedRole === 'SUPER_ADMIN') {
          navigate('/super-admin/dashboard', { replace: true });
        } else if (loggedUser?.accessTemplateId) {
          navigate('/profile', { replace: true });
        } else {
          navigate('/', { replace: true });
        }
      } else {
        if (res?.isServerError) {
          setServerError(res?.message || 'Login failed. Please try again later.');
        } else {
          setFormError(res?.message || 'Invalid login credentials.');
        }
      }
    } catch (err) {
      const isServer = !err.response || err.response.status >= 500;
      if (isServer) {
        setServerError('Login failed. Please try again later.');
      } else {
        setFormError(err.response?.data?.message || err.message || 'Login failed. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  // Login Theme Variables
  const primaryColor = companyBranding?.loginPrimaryColor || companyBranding?.primaryColor || '#F97316';
  const welcomeTitle = companyBranding?.name || 'Company Portal';
  const welcomeSubtitle = `Sign in to your ${companyBranding?.name || 'enterprise'} portal`;

  if (loadingCompany) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-3 p-4">
        <RefreshCw className="h-8 w-8 animate-spin text-emerald-600" />
        <p className="text-xs font-bold text-muted-foreground">Loading company portal...</p>
      </div>
    );
  }

  if (errorMsg || isSuspended) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-3xl border border-border/80 bg-card p-6 sm:p-8 shadow-xl text-center space-y-5">
          <div className="h-14 w-14 rounded-3xl bg-destructive/10 text-destructive flex items-center justify-center mx-auto">
            <AlertTriangle className="h-7 w-7" />
          </div>
          <div>
            <h2 className="text-xl font-black text-foreground">{isSuspended ? 'Account Suspended' : 'Company Not Found'}</h2>
            <p className="text-xs text-muted-foreground font-medium mt-1">{errorMsg}</p>
          </div>
          <Link
            to="/login"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-primary text-primary-foreground font-bold text-xs hover:opacity-90 transition-all"
          >
            <ArrowRight className="h-4 w-4 rotate-180" />
            <span>Go to Global Login</span>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden transition-all duration-300"
      style={{
        background: 'linear-gradient(135deg, #090D16 0%, #0F172A 50%, #020617 100%)'
      }}
    >
      {/* Background Ambient Glow */}
      <div
        className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 h-96 w-96 rounded-full blur-3xl opacity-25 pointer-events-none transition-all duration-500"
        style={{ backgroundColor: primaryColor }}
      />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md rounded-3xl p-6 sm:p-8 space-y-6 text-left relative z-10 border border-white/15 dark:border-white/10 bg-slate-900/85 backdrop-blur-xl shadow-2xl text-white"
      >
        {/* Header Branding */}
        <div className="text-center space-y-3">
          <div
            className="h-16 w-16 rounded-2xl mx-auto flex items-center justify-center font-extrabold text-white text-xl shadow-lg overflow-hidden transition-colors"
            style={{ backgroundColor: primaryColor }}
          >
            {companyBranding?.logo ? (
              <img
                src={getUploadUrl(companyBranding.logo)}
                alt="Company Logo"
                className="h-full w-full object-contain p-1"
              />
            ) : (
              (companyBranding?.name || 'C').charAt(0).toUpperCase()
            )}
          </div>

          <div>
            <div className="flex items-center justify-center gap-2">
              <h1 className="text-2xl font-black tracking-tight text-white">{welcomeTitle}</h1>
              {companyBranding?.companyCode && (
                <span
                  className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border"
                  style={{
                    borderColor: `${primaryColor}40`,
                    backgroundColor: `${primaryColor}15`,
                    color: primaryColor
                  }}
                >
                  {companyBranding?.companyCode}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-300 font-medium mt-1">
              {welcomeSubtitle}
            </p>
          </div>
        </div>

        {/* State 1: Session Expired (Amber neutral banner) */}
        {sessionExpired && !formError && !serverError && (
          <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs font-semibold flex items-center gap-2.5 animate-in fade-in duration-200">
            <Clock className="h-4 w-4 shrink-0 text-amber-400" />
            <span>Your session has expired. Please log in again.</span>
          </div>
        )}

        {/* State 2: Invalid Credentials (Red banner) */}
        {formError && (
          <div className="p-3.5 rounded-2xl bg-destructive/10 border border-destructive/20 text-red-400 text-xs font-bold flex items-center gap-2 animate-in fade-in duration-200">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{formError}</span>
          </div>
        )}

        {/* State 3: Server Exception Error (Red banner) */}
        {serverError && (
          <div className="p-3.5 rounded-2xl bg-destructive/10 border border-destructive/20 text-red-400 text-xs font-bold flex items-center gap-2 animate-in fade-in duration-200">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{serverError}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-200 mb-1.5 flex items-center gap-1.5">
              <Mail className="h-3.5 w-3.5 text-slate-400" /> Email / Employee ID
            </label>
            <input
              type="text"
              required
              placeholder="e.g. john@company.com or EMP001"
              value={loginInput}
              onChange={(e) => setLoginInput(e.target.value)}
              className="w-full rounded-2xl border border-slate-700 bg-slate-800/80 px-4 py-3 text-xs font-bold text-white placeholder-slate-400 focus:outline-none transition-all"
              onFocus={(e) => {
                e.currentTarget.style.borderColor = primaryColor;
                e.currentTarget.style.boxShadow = `0 0 0 3px ${primaryColor}30`;
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = '';
                e.currentTarget.style.boxShadow = '';
              }}
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-200 mb-1.5 flex items-center gap-1.5">
              <Lock className="h-3.5 w-3.5 text-slate-400" /> Password
            </label>
            <input
              type="password"
              required
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-2xl border border-slate-700 bg-slate-800/80 px-4 py-3 text-xs font-bold text-white placeholder-slate-400 focus:outline-none transition-all"
              onFocus={(e) => {
                e.currentTarget.style.borderColor = primaryColor;
                e.currentTarget.style.boxShadow = `0 0 0 3px ${primaryColor}30`;
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = '';
                e.currentTarget.style.boxShadow = '';
              }}
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 rounded-2xl text-white text-xs font-extrabold transition-all shadow-lg cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50 hover:brightness-110 active:scale-[0.99]"
            style={{
              backgroundColor: primaryColor,
              boxShadow: `0 8px 20px -4px ${primaryColor}50`
            }}
          >
            {submitting ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" />
                <span>Signing in...</span>
              </>
            ) : (
              <>
                <span>Sign In to {companyBranding?.name}</span>
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>
        </form>

        <div className="pt-4 border-t border-slate-800 text-center">
          <Link
            to="/login"
            className="text-xs font-bold hover:underline transition-colors"
            style={{ color: primaryColor }}
          >
            Switch to Global Login Portal
          </Link>
        </div>
      </motion.div>
    </div>
  );
};

export default CompanyLogin;
