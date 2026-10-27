import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { setPlatformBranding } from '../utils/branding';
import api, { isManualLogout } from '../services/api';
import { resolveLoginTheme, DEFAULT_LOGIN_THEME } from '../utils/loginTheme';
import loginLogo from '../assets/login_logo.png';
import {
  User,
  Lock,
  Loader2,
  ArrowRight,
  Eye,
  EyeOff,
  CheckSquare,
  Square,
  Mail,
  KeyRound,
  ShieldCheck,
  CheckCircle2,
  X,
  RotateCcw,
  Clock,
  AlertTriangle
} from 'lucide-react';

const Login = () => {
  const { user, login, requestPasswordReset, verifyResetOtp, resetPasswordWithToken } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  // Defer platform branding (DOM manipulation) so it never blocks first paint
  useEffect(() => {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(setPlatformBranding);
    } else {
      setTimeout(setPlatformBranding, 150);
    }
  }, []);

  // Lazy-load non-critical decorative content (heavy blur-3xl divs and complex 3D SVG sphere)
  // after the critical login form is painted and fully interactive
  const [decorativeReady, setDecorativeReady] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      setTimeout(() => setDecorativeReady(true), 60);
    });
    return () => cancelAnimationFrame(id);
  }, []);

  // Dynamic Login Page Theme state with immediate localStorage hydration
  const [loginThemeColor, setLoginThemeColor] = useState(() => {
    try {
      const activeCompanyId = localStorage.getItem('mrf_selected_company_id');
      const tenantTheme = activeCompanyId && activeCompanyId !== 'all' ? localStorage.getItem(`mrf_login_theme_${activeCompanyId}`) : null;
      const globalTheme = localStorage.getItem('mrf_login_primary_color');
      return tenantTheme || globalTheme || DEFAULT_LOGIN_THEME.primaryColor;
    } catch (e) {
      return DEFAULT_LOGIN_THEME.primaryColor;
    }
  });

  // Focus states for input highlight accents
  const [isUserIdFocused, setIsUserIdFocused] = useState(false);
  const [isPasswordFocused, setIsPasswordFocused] = useState(false);
  const [isForgotEmailFocused, setIsForgotEmailFocused] = useState(false);
  const [isNewPassFocused, setIsNewPassFocused] = useState(false);
  const [isConfirmPassFocused, setIsConfirmPassFocused] = useState(false);
  const [focusedOtpIdx, setFocusedOtpIdx] = useState(null);

  // Load and subscribe to active company login theme
  useEffect(() => {
    let isMounted = true;

    const loadActiveTheme = async () => {
      try {
        const activeCompanyId = localStorage.getItem('mrf_selected_company_id');
        const params = {};
        if (activeCompanyId && activeCompanyId !== 'all') {
          params.organizationId = activeCompanyId;
        }
        const res = await api.get('/public/company/branding/active', { params });
        if (isMounted && res.data?.loginPrimaryColor) {
          setLoginThemeColor(res.data.loginPrimaryColor);
          try {
            localStorage.setItem('mrf_login_primary_color', res.data.loginPrimaryColor);
            if (activeCompanyId && activeCompanyId !== 'all') {
              localStorage.setItem(`mrf_login_theme_${activeCompanyId}`, res.data.loginPrimaryColor);
            }
          } catch (e) {}
        }
      } catch (err) {
        console.warn('Failed to fetch active login branding theme:', err);
      }
    };

    // Defer network verification by 1.5s so initial render and form interaction are 100% instant
    const timer = setTimeout(loadActiveTheme, 1500);

    const handleThemeChanged = (e) => {
      if (e.detail?.primaryColor) {
        setLoginThemeColor(e.detail.primaryColor);
      } else {
        loadActiveTheme();
      }
    };

    const handleStorage = (e) => {
      if (e.key === 'mrf_login_primary_color' || e.key?.startsWith('mrf_login_theme_') || e.key === 'mrf_selected_company_id') {
        const activeCompanyId = localStorage.getItem('mrf_selected_company_id');
        const tenantTheme = activeCompanyId && activeCompanyId !== 'all' ? localStorage.getItem(`mrf_login_theme_${activeCompanyId}`) : null;
        const globalTheme = localStorage.getItem('mrf_login_primary_color');
        setLoginThemeColor(tenantTheme || globalTheme || DEFAULT_LOGIN_THEME.primaryColor);
      }
    };

    window.addEventListener('mrf_login_theme_changed', handleThemeChanged);
    window.addEventListener('storage', handleStorage);

    return () => {
      isMounted = false;
      clearTimeout(timer);
      window.removeEventListener('mrf_login_theme_changed', handleThemeChanged);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  // Memoize static theme resolution & style objects to avoid recreating on each render
  const currentTheme = useMemo(() => resolveLoginTheme(loginThemeColor), [loginThemeColor]);

  const buttonStyle = useMemo(() => ({
    backgroundColor: currentTheme.primaryColor,
    boxShadow: `0 10px 25px -5px ${currentTheme.primaryColor}50`
  }), [currentTheme.primaryColor]);

  const headingStyle = useMemo(() => ({
    color: currentTheme.primaryColor
  }), [currentTheme.primaryColor]);

  // Memoized scoped stylesheet to prevent style re-parsing on renders
  const scopedStyleTag = useMemo(() => (
    <style>{`
      .login-theme-container {
        --primary: ${currentTheme.rgb} !important;
        --primary-hover: ${currentTheme.hoverRgb} !important;
        --brand-primary: ${currentTheme.primaryColor} !important;
        --brand-primary-hover: ${currentTheme.hoverColor} !important;
      }
      .login-theme-container .text-primary {
        color: ${currentTheme.primaryColor} !important;
      }
      .login-theme-container .hover\\:text-primary:hover {
        color: ${currentTheme.primaryColor} !important;
      }
      .login-theme-container .hover\\:text-primary-hover:hover {
        color: ${currentTheme.hoverColor} !important;
      }
      .login-theme-container .bg-primary {
        background-color: ${currentTheme.primaryColor} !important;
      }
      .login-theme-container .hover\\:bg-primary-hover:hover {
        background-color: ${currentTheme.hoverColor} !important;
      }
      .login-theme-container .border-primary {
        border-color: ${currentTheme.primaryColor} !important;
      }
      .login-theme-container .focus\\:border-primary:focus {
        border-color: ${currentTheme.primaryColor} !important;
      }
      .login-theme-container .focus\\:ring-primary\\/10:focus {
        --tw-ring-color: ${currentTheme.primaryColor}1a !important;
      }
      .login-theme-container .hover\\:border-primary\\/40:hover {
        border-color: ${currentTheme.primaryColor}66 !important;
      }
      .login-theme-container .shadow-primary\\/25 {
        --tw-shadow-color: ${currentTheme.primaryColor}40 !important;
      }
      .login-theme-container .shadow-primary\\/20 {
        --tw-shadow-color: ${currentTheme.primaryColor}33 !important;
      }
    `}</style>
  ), [currentTheme]);

  // Login form state
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [credentialError, setCredentialError] = useState('');
  const [serverError, setServerError] = useState('');
  // Detect session expired parameter directly on first render without triggering a second render pass
  const [sessionExpired, setSessionExpired] = useState(() => searchParams.get('expired') === 'true');

  useEffect(() => {
    setSessionExpired(searchParams.get('expired') === 'true');
  }, [searchParams]);

  // Forgot Password Overlay Modal State
  const [forgotModalOpen, setForgotModalOpen] = useState(false);
  const [forgotStep, setForgotStep] = useState(1); // 1: Email, 2: OTP, 3: New Password, 4: Success
  const [forgotEmail, setForgotEmail] = useState('');
  const [otpDigits, setOtpDigits] = useState(['', '', '', '', '', '']);
  const [resetToken, setResetToken] = useState('');

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPass, setShowNewPass] = useState(false);
  const [showConfirmPass, setShowConfirmPass] = useState(false);

  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotError, setForgotError] = useState('');
  const [forgotSuccess, setForgotSuccess] = useState('');

  // Timers
  const [resendCooldown, setResendCooldown] = useState(0);
  const [otpExpirySeconds, setOtpExpirySeconds] = useState(300);

  const otpInputRefs = useRef([]);
  const isSubmittingRef = useRef(false);
  const navigate = useNavigate();

  // Redirect if already logged in on mount (skip if manual logout is in progress)
  useEffect(() => {
    if (user && !isSubmittingRef.current && !isManualLogout()) {
      if (user.role === 'SUPER_ADMIN') {
        navigate('/super-admin/dashboard', { replace: true });
      } else if (user.accessTemplateId) {
        navigate('/profile', { replace: true });
      } else {
        navigate('/', { replace: true });
      }
    }
  }, [user, navigate]);

  // Resend cooldown timer
  useEffect(() => {
    let timer;
    if (resendCooldown > 0) {
      timer = setInterval(() => {
        setResendCooldown((prev) => prev - 1);
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [resendCooldown]);

  // OTP Expiry timer (Step 2)
  useEffect(() => {
    let timer;
    if (forgotModalOpen && forgotStep === 2 && otpExpirySeconds > 0) {
      timer = setInterval(() => {
        setOtpExpirySeconds((prev) => prev - 1);
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [forgotModalOpen, forgotStep, otpExpirySeconds]);

  // Handle Login Submit
  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    if (!userId || !password) {
      setCredentialError('Please enter both your User ID and password.');
      setServerError('');
      setSessionExpired(false);
      return;
    }
    setCredentialError('');
    setServerError('');
    setSessionExpired(false);

    // Cleanly remove expired parameter from URL if present
    if (searchParams.get('expired')) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('expired');
      setSearchParams(nextParams, { replace: true });
    }

    isSubmittingRef.current = true;
    setLoading(true);
    const res = await login(userId, password);
    if (res.success) {
      const loggedUser = res.user || user;
      const loggedUserRole = loggedUser?.role;
      if (loggedUserRole === 'SUPER_ADMIN') {
        navigate('/super-admin/dashboard', { replace: true });
      } else if (loggedUser?.accessTemplateId) {
        navigate('/profile', { replace: true });
      } else {
        navigate('/', { replace: true });
      }
    } else {
      isSubmittingRef.current = false;
      setLoading(false);
      if (res.isServerError) {
        setServerError(res.message || 'Login failed. Please try again later.');
      } else {
        setCredentialError(res.message || 'Invalid email or password.');
      }
    }
  };

  // Open Forgot Password Modal
  const openForgotModal = () => {
    setForgotModalOpen(true);
    setForgotStep(1);
    setForgotEmail(userId.includes('@') ? userId : '');
    setOtpDigits(['', '', '', '', '', '']);
    setResetToken('');
    setNewPassword('');
    setConfirmPassword('');
    setForgotError('');
    setForgotSuccess('');
  };

  // Close Forgot Password Modal
  const closeForgotModal = () => {
    setForgotModalOpen(false);
    setForgotStep(1);
    setForgotError('');
    setForgotSuccess('');
  };

  // Step 1: Request Password Reset OTP
  const handleSendOtp = async (e) => {
    e.preventDefault();
    if (!forgotEmail || !forgotEmail.trim()) {
      setForgotError('Please enter your registered email address.');
      return;
    }
    setForgotError('');
    setForgotLoading(true);

    const res = await requestPasswordReset(forgotEmail.trim());
    setForgotLoading(false);

    if (res.success) {
      setForgotSuccess(res.message || 'OTP sent to your email address.');
      setForgotStep(2);
      setResendCooldown(60);
      setOtpExpirySeconds(300);
      setTimeout(() => otpInputRefs.current[0]?.focus(), 100);
    } else {
      setForgotError(res.message);
    }
  };

  // Step 2: Handle OTP Digit Change
  const handleOtpDigitChange = (index, value) => {
    if (!/^\d*$/.test(value)) return;
    const nextDigits = [...otpDigits];
    nextDigits[index] = value.slice(-1);
    setOtpDigits(nextDigits);

    if (value && index < 5) {
      otpInputRefs.current[index + 1]?.focus();
    }
  };

  // Handle OTP Keydown (Backspace navigation)
  const handleOtpKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !otpDigits[index] && index > 0) {
      otpInputRefs.current[index - 1]?.focus();
    }
  };

  // Handle OTP Paste
  const handleOtpPaste = (e) => {
    e.preventDefault();
    const pastedText = e.clipboardData.getData('text').trim();
    if (/^\d{6}$/.test(pastedText)) {
      const nextDigits = pastedText.split('');
      setOtpDigits(nextDigits);
      otpInputRefs.current[5]?.focus();
    }
  };

  // Step 2: Verify OTP
  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    const otp = otpDigits.join('');
    if (otp.length !== 6) {
      setForgotError('Please enter the complete 6-digit OTP.');
      return;
    }
    setForgotError('');
    setForgotLoading(true);

    const res = await verifyResetOtp(forgotEmail.trim(), otp);
    setForgotLoading(false);

    if (res.success) {
      setResetToken(res.resetToken);
      setForgotSuccess('OTP verified successfully! Please set your new password.');
      setForgotStep(3);
    } else {
      setForgotError(res.message);
    }
  };

  // Step 2: Resend OTP
  const handleResendOtp = async () => {
    if (resendCooldown > 0) return;
    setForgotError('');
    setForgotLoading(true);

    const res = await requestPasswordReset(forgotEmail.trim());
    setForgotLoading(false);

    if (res.success) {
      setForgotSuccess('A new 6-digit OTP has been sent to your email.');
      setResendCooldown(60);
      setOtpExpirySeconds(300);
      setOtpDigits(['', '', '', '', '', '']);
      otpInputRefs.current[0]?.focus();
    } else {
      setForgotError(res.message);
    }
  };

  // Step 3: Password Strength Validation
  const passValidation = {
    length: newPassword.length >= 8,
    hasUpper: /[A-Z]/.test(newPassword),
    hasLower: /[a-z]/.test(newPassword),
    hasNumber: /[0-9]/.test(newPassword),
    hasSpecial: /[^A-Za-z0-9]/.test(newPassword),
    matches: newPassword && newPassword === confirmPassword
  };

  const isPasswordValid =
    passValidation.length &&
    passValidation.hasUpper &&
    passValidation.hasLower &&
    passValidation.hasNumber &&
    passValidation.hasSpecial &&
    passValidation.matches;

  // Step 3: Reset Password
  const handleResetPassword = async (e) => {
    e.preventDefault();
    if (!isPasswordValid) {
      setForgotError('Please ensure all password complexity requirements are satisfied.');
      return;
    }
    setForgotError('');
    setForgotLoading(true);

    const res = await resetPasswordWithToken(forgotEmail.trim(), resetToken, newPassword, confirmPassword);
    setForgotLoading(false);

    if (res.success) {
      setForgotStep(4);
    } else {
      setForgotError(res.message);
    }
  };

  const displayName = 'INNOVEITY';

  const formatTimer = (seconds) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div className="login-theme-container relative flex min-h-screen items-center justify-center p-4 sm:p-6 font-sans theme-canvas-bg overflow-hidden transition-colors duration-300">
      {/* Scoped CSS overrides guaranteeing login theme colors take full precedence */}
      {scopedStyleTag}

      {/* Decorative ambient background glows (Lazy loaded after first paint to eliminate compositor lag) */}
      {decorativeReady && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div
            className="absolute -top-40 -left-40 h-[650px] w-[650px] rounded-full blur-3xl opacity-20 transition-all duration-500"
            style={{ backgroundColor: currentTheme.primaryColor }}
          />
          <div
            className="absolute -bottom-40 -right-40 h-[650px] w-[650px] rounded-full blur-3xl opacity-20 transition-all duration-500"
            style={{ backgroundColor: currentTheme.primaryColor }}
          />
        </div>
      )}

      {/* Main 2-Column Enterprise Login Card Container */}
      <div className="relative z-10 w-full max-w-4xl rounded-[32px] bg-card text-card-foreground shadow-2xl shadow-black/10 border border-border/80 overflow-hidden flex flex-col lg:flex-row min-h-[580px] transition-all duration-300">
        {/* LEFT COLUMN: Hero Branding Panel with 3D Clockwise Rolling Node Sphere & Centered Logo */}
        <div className="w-full lg:w-1/2 bg-muted/40 border-b lg:border-b-0 lg:border-r border-border/60 p-8 sm:p-10 flex flex-col justify-between relative overflow-hidden">
          {/* Dynamic Theme Gradient Background Accent */}
          <div
            className="absolute inset-0 pointer-events-none transition-all duration-500 opacity-10"
            style={{
              background: `radial-gradient(circle at 30% 30%, ${currentTheme.primaryColor}, transparent 70%)`
            }}
          />

          {/* Top Brand Tag */}
          <div className="relative z-10 flex items-center gap-2">
            <span
              className="h-2 w-2 rounded-full animate-pulse"
              style={{ backgroundColor: currentTheme.primaryColor }}
            />
            <span className="text-[11px] font-extrabold tracking-widest text-muted-foreground uppercase">
              {displayName}
            </span>
          </div>

          {/* CENTER: 3D Connected Node Sphere Animation (Lazy loaded after form is interactive) */}
          <div className="relative z-10 my-6 flex items-center justify-center min-h-[280px]">
            <div className="relative h-72 w-72 sm:h-80 sm:w-80 flex items-center justify-center">
              {decorativeReady ? (
                <>
                  {/* Ambient backlight glow */}
                  <div
                    className="absolute inset-4 rounded-full blur-2xl opacity-15 pointer-events-none transition-all duration-500"
                    style={{ backgroundColor: currentTheme.primaryColor }}
                  />

                  {/* 3D Rolling Clockwise Wireframe Sphere */}
                  <div className="absolute inset-0 animate-[spin_22s_linear_infinite]">
                    <svg viewBox="0 0 300 300" className="w-full h-full">
                      <defs>
                        <linearGradient id="themeSphereGrad1" x1="0%" y1="0%" x2="100%" y2="100%">
                          <stop offset="0%" stopColor={currentTheme.primaryColor} stopOpacity="0.6" />
                          <stop offset="100%" stopColor={currentTheme.primaryColor} stopOpacity="0.1" />
                        </linearGradient>
                        <linearGradient id="themeSphereGrad2" x1="100%" y1="0%" x2="0%" y2="100%">
                          <stop offset="0%" stopColor={currentTheme.primaryColor} stopOpacity="0.4" />
                          <stop offset="100%" stopColor={currentTheme.primaryColor} stopOpacity="0.15" />
                        </linearGradient>
                      </defs>

                      {/* Outer Boundary Circle */}
                      <circle cx="150" cy="150" r="130" fill="none" stroke={currentTheme.primaryColor} strokeWidth="0.75" strokeDasharray="3 3" opacity="0.4" />

                      {/* 3D Latitude Ellipses */}
                      <ellipse cx="150" cy="150" rx="130" ry="45" fill="none" stroke="url(#themeSphereGrad1)" strokeWidth="1.2" transform="rotate(-15 150 150)" />
                      <ellipse cx="150" cy="150" rx="130" ry="75" fill="none" stroke="url(#themeSphereGrad2)" strokeWidth="1.2" transform="rotate(25 150 150)" />
                      <ellipse cx="150" cy="150" rx="130" ry="105" fill="none" stroke="url(#themeSphereGrad1)" strokeWidth="1" transform="rotate(-45 150 150)" />
                      <ellipse cx="150" cy="150" rx="130" ry="50" fill="none" stroke="url(#themeSphereGrad2)" strokeWidth="1.2" transform="rotate(65 150 150)" />
                      <ellipse cx="150" cy="150" rx="130" ry="120" fill="none" stroke={currentTheme.primaryColor} strokeWidth="0.8" opacity="0.3" transform="rotate(105 150 150)" />

                      {/* Intersecting Network Lines */}
                      <line x1="60" y1="90" x2="150" y2="35" stroke={currentTheme.primaryColor} strokeWidth="0.8" opacity="0.4" />
                      <line x1="150" y1="35" x2="235" y2="85" stroke={currentTheme.primaryColor} strokeWidth="0.8" opacity="0.4" />
                      <line x1="235" y1="85" x2="255" y2="170" stroke={currentTheme.primaryColor} strokeWidth="0.8" opacity="0.4" />
                      <line x1="255" y1="170" x2="190" y2="245" stroke={currentTheme.primaryColor} strokeWidth="0.8" opacity="0.4" />
                      <line x1="190" y1="245" x2="105" y2="255" stroke={currentTheme.primaryColor} strokeWidth="0.8" opacity="0.4" />
                      <line x1="105" y1="255" x2="45" y2="185" stroke={currentTheme.primaryColor} strokeWidth="0.8" opacity="0.4" />
                      <line x1="45" y1="185" x2="60" y2="90" stroke={currentTheme.primaryColor} strokeWidth="0.8" opacity="0.4" />

                      <line x1="95" y1="65" x2="205" y2="105" stroke={currentTheme.primaryColor} strokeWidth="0.7" opacity="0.3" />
                      <line x1="75" y1="135" x2="225" y2="195" stroke={currentTheme.primaryColor} strokeWidth="0.7" opacity="0.3" />
                      <line x1="125" y1="225" x2="175" y2="75" stroke={currentTheme.primaryColor} strokeWidth="0.7" opacity="0.3" />

                      {/* Network Node Dots */}
                      <g>
                        <circle cx="150" cy="35" r="4.5" fill={currentTheme.primaryColor} />
                        <circle cx="150" cy="35" r="8" fill={currentTheme.primaryColor} opacity="0.25" />

                        <circle cx="235" cy="85" r="4" fill={currentTheme.primaryColor} />
                        <circle cx="255" cy="170" r="4.5" fill={currentTheme.primaryColor} />
                        <circle cx="190" cy="245" r="4" fill={currentTheme.primaryColor} opacity="0.8" />
                        <circle cx="105" cy="255" r="4.5" fill={currentTheme.primaryColor} />
                        <circle cx="45" cy="185" r="4" fill={currentTheme.primaryColor} />
                        <circle cx="60" cy="90" r="4.5" fill={currentTheme.primaryColor} />

                        <circle cx="95" cy="65" r="3.5" fill={currentTheme.primaryColor} opacity="0.8" />
                        <circle cx="205" cy="105" r="3.5" fill={currentTheme.primaryColor} />
                        <circle cx="75" cy="135" r="3.5" fill={currentTheme.primaryColor} />
                        <circle cx="225" cy="195" r="3.5" fill={currentTheme.primaryColor} />
                        <circle cx="125" cy="225" r="3.5" fill={currentTheme.primaryColor} opacity="0.8" />
                        <circle cx="175" cy="75" r="3.5" fill={currentTheme.primaryColor} />
                      </g>
                    </svg>
                  </div>
                </>
              ) : null}

              {/* CENTER LOGO: Dynamic Transparent Company Logo */}
              <div className="relative z-20 flex items-center justify-center transition-transform duration-300 hover:scale-105">
                <img
                  src={loginLogo}
                  alt="Innoveity Logo"
                  className="w-[220px] sm:w-[245px] h-auto object-contain drop-shadow-md"
                />
              </div>
            </div>
          </div>

          {/* Bottom Descriptor */}
          <div className="relative z-10 space-y-1 text-center lg:text-left">
            <h3 className="text-lg font-black tracking-tight" style={headingStyle}>
              Enterprise CRM Workspace
            </h3>
            <p className="text-xs text-muted-foreground font-medium leading-relaxed">
              Streamlining team workflows, dynamic builders, and real-time operations.
            </p>
          </div>
        </div>

        {/* RIGHT COLUMN: Original Interactive Login Form Panel */}
        <div className="w-full lg:w-1/2 p-8 sm:p-12 flex flex-col justify-center my-auto text-left">
          <div className="my-auto w-full">
            {/* Title Header (Center Aligned) */}
            <div className="mb-6 space-y-1 text-center">
              <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-center" style={headingStyle}>
                {displayName}
              </h2>
              <p className="text-xs font-semibold text-muted-foreground text-center">
                Enter your enterprise credentials to access your portal.
              </p>
            </div>

            {/* Banner State 1: Session Expired (Amber/Blue neutral info) */}
            {sessionExpired && !credentialError && !serverError && (
              <div className="mb-4 flex items-center gap-2.5 rounded-2xl bg-amber-500/10 border border-amber-500/20 p-3.5 text-xs text-amber-700 dark:text-amber-400 font-semibold animate-in fade-in duration-200">
                <Clock className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <span>Your session has expired. Please log in again.</span>
              </div>
            )}

            {/* Banner State 2: Invalid Credentials Error (Red) */}
            {credentialError && (
              <div className="mb-4 flex items-start gap-2.5 rounded-2xl bg-danger/10 border border-danger/20 p-3.5 text-xs text-danger font-semibold animate-in fade-in duration-200">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-danger" />
                <span>{credentialError}</span>
              </div>
            )}

            {/* Banner State 3: Server Exception Error (Red) */}
            {serverError && (
              <div className="mb-4 flex items-start gap-2.5 rounded-2xl bg-danger/10 border border-danger/20 p-3.5 text-xs text-danger font-semibold animate-in fade-in duration-200">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-danger" />
                <span>{serverError}</span>
              </div>
            )}

            {/* ORIGINAL LOGIN FORM */}
            <form className="space-y-4" onSubmit={handleLoginSubmit}>
              {/* User ID / Email */}
              <div className="space-y-1">
                <div className="relative group">
                  <User
                    className="absolute left-4 top-4 h-4 w-4 transition-colors"
                    style={{ color: isUserIdFocused ? currentTheme.primaryColor : undefined }}
                  />
                  <input
                    type="text"
                    placeholder="Enter Mail or User ID"
                    className="w-full rounded-2xl border border-border/80 bg-muted/20 py-3.5 pl-11 pr-4 text-sm text-foreground font-medium focus:bg-card placeholder:text-muted-foreground/60 transition-all outline-none [&:-webkit-autofill]:shadow-[0_0_0_1000px_rgba(248,250,252,1)_inset] [&:-webkit-autofill]:-webkit-text-fill-color:rgb(30,41,59)"
                    style={isUserIdFocused ? { borderColor: currentTheme.primaryColor, boxShadow: `0 0 0 4px ${currentTheme.primaryColor}20` } : undefined}
                    onFocus={() => setIsUserIdFocused(true)}
                    onBlur={() => setIsUserIdFocused(false)}
                    value={userId}
                    onChange={(e) => setUserId(e.target.value)}
                    autoComplete="username"
                  />
                </div>
              </div>

              {/* Password */}
              <div className="space-y-1">
                <div className="relative group">
                  <Lock
                    className="absolute left-4 top-4 h-4 w-4 transition-colors"
                    style={{ color: isPasswordFocused ? currentTheme.primaryColor : undefined }}
                  />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Enter Password"
                    className="w-full rounded-2xl border border-border/80 bg-muted/20 py-3.5 pl-11 pr-11 text-sm text-foreground font-medium focus:bg-card placeholder:text-muted-foreground/60 transition-all outline-none [&:-webkit-autofill]:shadow-[0_0_0_1000px_rgba(248,250,252,1)_inset] [&:-webkit-autofill]:-webkit-text-fill-color:rgb(30,41,59)"
                    style={isPasswordFocused ? { borderColor: currentTheme.primaryColor, boxShadow: `0 0 0 4px ${currentTheme.primaryColor}20` } : undefined}
                    onFocus={() => setIsPasswordFocused(true)}
                    onBlur={() => setIsPasswordFocused(false)}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    tabIndex={-1}
                    className="absolute right-4 top-4 text-muted-foreground hover:text-foreground transition-colors focus:outline-none cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* Remember Me & Forgot Password Row */}
              <div className="flex items-center justify-between text-xs font-semibold pt-1">
                <label className="flex items-center gap-2 text-muted-foreground cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="hidden"
                  />
                  {rememberMe ? (
                    <CheckSquare className="h-4 w-4" style={{ color: currentTheme.primaryColor }} />
                  ) : (
                    <Square className="h-4 w-4 text-muted-foreground/40" />
                  )}
                  <span>Remember me</span>
                </label>

                <button
                  type="button"
                  onClick={openForgotModal}
                  style={{ color: currentTheme.primaryColor }}
                  className="font-bold hover:underline transition-colors cursor-pointer"
                >
                  Forgot password?
                </button>
              </div>

              {/* Main Submit Button (Dynamic Login Theme) */}
              <button
                type="submit"
                disabled={loading}
                style={buttonStyle}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = currentTheme.hoverColor; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = currentTheme.primaryColor; }}
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl text-white py-3.5 text-sm font-bold transition-all active:scale-[0.98] disabled:opacity-60 cursor-pointer"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <span>Log In to Account</span>
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* SECURE FORGOT PASSWORD EMAIL OTP OVERLAY MODAL */}
      {forgotModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-md rounded-3xl bg-card text-card-foreground border border-border/80 p-6 sm:p-8 shadow-2xl space-y-6 relative overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border/60 pb-4">
              <div className="flex items-center gap-3">
                <div
                  className="p-2.5 rounded-2xl"
                  style={{ backgroundColor: `${currentTheme.primaryColor}1a`, color: currentTheme.primaryColor }}
                >
                  <KeyRound className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-foreground">Password Recovery</h3>
                  <p className="text-xs text-muted-foreground font-medium">
                    {forgotStep === 1 && 'Step 1 of 3: Verification Email'}
                    {forgotStep === 2 && 'Step 2 of 3: Enter 6-Digit OTP'}
                    {forgotStep === 3 && 'Step 3 of 3: Create New Password'}
                    {forgotStep === 4 && 'Recovery Complete'}
                  </p>
                </div>
              </div>
              <button
                onClick={closeForgotModal}
                className="p-2 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Error & Success Feedback Banners */}
            {forgotError && (
              <div className="flex items-start gap-2 rounded-2xl bg-danger/10 border border-danger/20 p-3.5 text-xs text-danger font-semibold">
                <span className="shrink-0 mt-0.5">⚠️</span>
                <span>{forgotError}</span>
              </div>
            )}
            {forgotSuccess && forgotStep !== 4 && (
              <div className="flex items-center gap-2 rounded-2xl bg-success/10 border border-success/20 p-3.5 text-xs text-success font-semibold">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                <span>{forgotSuccess}</span>
              </div>
            )}

            {/* STEP 1: ENTER REGISTERED EMAIL */}
            {forgotStep === 1 && (
              <form onSubmit={handleSendOtp} className="space-y-4">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Enter your registered account email. If the email exists in our records, a secure 6-digit OTP code will be sent.
                </p>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-foreground">Registered Email Address</label>
                  <div className="relative group">
                    <Mail
                      className="absolute left-4 top-3.5 h-4 w-4 transition-colors"
                      style={{ color: isForgotEmailFocused ? currentTheme.primaryColor : undefined }}
                    />
                    <input
                      type="email"
                      required
                      placeholder="name@company.com"
                      value={forgotEmail}
                      onChange={(e) => setForgotEmail(e.target.value)}
                      onFocus={() => setIsForgotEmailFocused(true)}
                      onBlur={() => setIsForgotEmailFocused(false)}
                      style={isForgotEmailFocused ? { borderColor: currentTheme.primaryColor, boxShadow: `0 0 0 4px ${currentTheme.primaryColor}20` } : undefined}
                      className="w-full rounded-2xl border border-border/80 bg-muted/20 py-3 pl-11 pr-4 text-sm font-medium focus:bg-card outline-none transition-all"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={forgotLoading}
                  style={{
                    backgroundColor: currentTheme.primaryColor,
                    boxShadow: `0 10px 25px -5px ${currentTheme.primaryColor}40`
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = currentTheme.hoverColor; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = currentTheme.primaryColor; }}
                  className="w-full flex items-center justify-center gap-2 rounded-2xl text-white py-3 text-sm font-bold transition-all active:scale-[0.98] disabled:opacity-60 cursor-pointer"
                >
                  {forgotLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <span>Send OTP Code</span>}
                </button>
              </form>
            )}

            {/* STEP 2: ENTER 6-DIGIT OTP */}
            {forgotStep === 2 && (
              <form onSubmit={handleVerifyOtp} className="space-y-5">
                <div className="text-center space-y-1">
                  <p className="text-xs text-muted-foreground">
                    Enter the 6-digit verification code sent to:
                  </p>
                  <p className="text-xs font-bold text-foreground font-mono">{forgotEmail}</p>
                </div>

                {/* 6-Digit Inputs */}
                <div className="flex items-center justify-center gap-2" onPaste={handleOtpPaste}>
                  {otpDigits.map((digit, idx) => (
                    <input
                      key={idx}
                      ref={(el) => (otpInputRefs.current[idx] = el)}
                      type="text"
                      maxLength={1}
                      value={digit}
                      onChange={(e) => handleOtpDigitChange(idx, e.target.value)}
                      onKeyDown={(e) => handleOtpKeyDown(idx, e)}
                      onFocus={() => setFocusedOtpIdx(idx)}
                      onBlur={() => setFocusedOtpIdx(null)}
                      style={focusedOtpIdx === idx ? { borderColor: currentTheme.primaryColor, boxShadow: `0 0 0 4px ${currentTheme.primaryColor}20` } : undefined}
                      className="w-11 h-13 text-center text-lg font-black rounded-xl border border-border/80 bg-muted/30 focus:bg-card outline-none transition-all"
                    />
                  ))}
                </div>

                {/* Timers */}
                <div className="flex items-center justify-between text-xs text-muted-foreground px-1 font-medium">
                  <span>Expires in: <strong className="text-foreground font-mono">{formatTimer(otpExpirySeconds)}</strong></span>
                  <button
                    type="button"
                    onClick={handleResendOtp}
                    disabled={resendCooldown > 0 || forgotLoading}
                    style={{ color: currentTheme.primaryColor }}
                    className="hover:underline font-bold disabled:text-muted-foreground/60 disabled:no-underline cursor-pointer flex items-center gap-1"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    <span>{resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend OTP'}</span>
                  </button>
                </div>

                <button
                  type="submit"
                  disabled={forgotLoading || otpDigits.join('').length !== 6}
                  style={{
                    backgroundColor: currentTheme.primaryColor,
                    boxShadow: `0 10px 25px -5px ${currentTheme.primaryColor}40`
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = currentTheme.hoverColor; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = currentTheme.primaryColor; }}
                  className="w-full flex items-center justify-center gap-2 rounded-2xl text-white py-3 text-sm font-bold transition-all active:scale-[0.98] disabled:opacity-60 cursor-pointer"
                >
                  {forgotLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <span>Verify OTP & Continue</span>}
                </button>
              </form>
            )}

            {/* STEP 3: SET NEW PASSWORD */}
            {forgotStep === 3 && (
              <form onSubmit={handleResetPassword} className="space-y-4">
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-foreground">New Password</label>
                    <div className="relative">
                      <Lock
                        className="absolute left-4 top-3.5 h-4 w-4 transition-colors"
                        style={{ color: isNewPassFocused ? currentTheme.primaryColor : undefined }}
                      />
                      <input
                        type={showNewPass ? 'text' : 'password'}
                        required
                        placeholder="••••••••"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        onFocus={() => setIsNewPassFocused(true)}
                        onBlur={() => setIsNewPassFocused(false)}
                        style={isNewPassFocused ? { borderColor: currentTheme.primaryColor, boxShadow: `0 0 0 4px ${currentTheme.primaryColor}20` } : undefined}
                        className="w-full rounded-2xl border border-border/80 bg-muted/20 py-3 pl-11 pr-11 text-sm font-medium focus:bg-card outline-none transition-all"
                      />
                      <button
                        type="button"
                        onClick={() => setShowNewPass(!showNewPass)}
                        className="absolute right-4 top-3.5 text-muted-foreground hover:text-foreground"
                      >
                        {showNewPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-bold text-foreground">Confirm New Password</label>
                    <div className="relative">
                      <Lock
                        className="absolute left-4 top-3.5 h-4 w-4 transition-colors"
                        style={{ color: isConfirmPassFocused ? currentTheme.primaryColor : undefined }}
                      />
                      <input
                        type={showConfirmPass ? 'text' : 'password'}
                        required
                        placeholder="••••••••"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        onFocus={() => setIsConfirmPassFocused(true)}
                        onBlur={() => setIsConfirmPassFocused(false)}
                        style={isConfirmPassFocused ? { borderColor: currentTheme.primaryColor, boxShadow: `0 0 0 4px ${currentTheme.primaryColor}20` } : undefined}
                        className="w-full rounded-2xl border border-border/80 bg-muted/20 py-3 pl-11 pr-11 text-sm font-medium focus:bg-card outline-none transition-all"
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPass(!showConfirmPass)}
                        className="absolute right-4 top-3.5 text-muted-foreground hover:text-foreground"
                      >
                        {showConfirmPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Password Complexity Checklist */}
                <div className="p-3 rounded-2xl bg-muted/40 border border-border/60 space-y-1.5 text-[11px] font-medium">
                  <p className="font-bold text-foreground mb-1">Password Strength Checklist:</p>
                  <div className="grid grid-cols-2 gap-1 text-muted-foreground">
                    <span
                      style={passValidation.length ? { color: currentTheme.primaryColor, fontWeight: 700 } : undefined}
                      className="flex items-center gap-1"
                    >
                      {passValidation.length ? '✓' : '•'} 8+ characters
                    </span>
                    <span
                      style={passValidation.hasUpper ? { color: currentTheme.primaryColor, fontWeight: 700 } : undefined}
                      className="flex items-center gap-1"
                    >
                      {passValidation.hasUpper ? '✓' : '•'} 1 Uppercase
                    </span>
                    <span
                      style={passValidation.hasLower ? { color: currentTheme.primaryColor, fontWeight: 700 } : undefined}
                      className="flex items-center gap-1"
                    >
                      {passValidation.hasLower ? '✓' : '•'} 1 Lowercase
                    </span>
                    <span
                      style={passValidation.hasNumber ? { color: currentTheme.primaryColor, fontWeight: 700 } : undefined}
                      className="flex items-center gap-1"
                    >
                      {passValidation.hasNumber ? '✓' : '•'} 1 Number
                    </span>
                    <span
                      style={passValidation.hasSpecial ? { color: currentTheme.primaryColor, fontWeight: 700 } : undefined}
                      className="flex items-center gap-1"
                    >
                      {passValidation.hasSpecial ? '✓' : '•'} 1 Special char
                    </span>
                    <span
                      style={passValidation.matches ? { color: currentTheme.primaryColor, fontWeight: 700 } : undefined}
                      className="flex items-center gap-1"
                    >
                      {passValidation.matches ? '✓' : '•'} Passwords match
                    </span>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={forgotLoading || !isPasswordValid}
                  style={{
                    backgroundColor: currentTheme.primaryColor,
                    boxShadow: `0 10px 25px -5px ${currentTheme.primaryColor}40`
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = currentTheme.hoverColor; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = currentTheme.primaryColor; }}
                  className="w-full flex items-center justify-center gap-2 rounded-2xl text-white py-3 text-sm font-bold transition-all active:scale-[0.98] disabled:opacity-60 cursor-pointer"
                >
                  {forgotLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <span>Reset Password & Finish</span>}
                </button>
              </form>
            )}

            {/* STEP 4: SUCCESS CONFIRMATION */}
            {forgotStep === 4 && (
              <div className="py-4 text-center space-y-4">
                <div className="mx-auto w-12 h-12 rounded-full bg-success/10 text-success flex items-center justify-center">
                  <ShieldCheck className="h-7 w-7" />
                </div>
                <div className="space-y-1">
                  <h4 className="text-base font-bold text-foreground">Password Reset Successful!</h4>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Your password has been updated and all active login sessions have been invalidated for security. Please log in using your new credentials.
                  </p>
                </div>
                <button
                  onClick={closeForgotModal}
                  style={{
                    backgroundColor: currentTheme.primaryColor,
                    boxShadow: `0 10px 25px -5px ${currentTheme.primaryColor}40`
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = currentTheme.hoverColor; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = currentTheme.primaryColor; }}
                  className="w-full py-3 rounded-2xl text-white text-sm font-bold transition-all cursor-pointer"
                >
                  Return to Sign In
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default Login;
