import React, { useState, useEffect } from 'react';
import {
  X, UserPlus, Shield, Building2, Eye, EyeOff, CheckCircle2,
  AlertCircle, Lock, Mail, Phone, Calendar, Briefcase, RefreshCw
} from 'lucide-react';
import api from '../../../services/api';

const RegisterTemplateUserModal = ({
  isOpen,
  onClose,
  onSuccess,
  template
}) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [phone, setPhone] = useState('');
  const [dob, setDob] = useState('');
  const [department, setDepartment] = useState('');
  const [designation, setDesignation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successInfo, setSuccessInfo] = useState(null);

  useEffect(() => {
    if (isOpen) {
      setName('');
      setEmail('');
      setPassword('TempUserPass@123');
      setShowPassword(false);
      setPhone('');
      setDob('');
      setDepartment('');
      setDesignation('');
      setErrorMessage('');
      setSuccessInfo(null);
    }
  }, [isOpen, template]);

  if (!isOpen || !template) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage('');
    setSuccessInfo(null);

    if (!name.trim()) {
      setErrorMessage('Full name is required.');
      return;
    }
    if (!email.trim()) {
      setErrorMessage('Email address is required.');
      return;
    }
    if (!password || password.length < 6) {
      setErrorMessage('Initial password must be at least 6 characters.');
      return;
    }

    const payload = {
      name: name.trim(),
      email: email.trim().toLowerCase(),
      password,
      phone: phone.trim() || undefined,
      dob: dob || undefined,
      department: department.trim() || undefined,
      designation: designation.trim() || undefined,
      status: 'ACTIVE'
    };

    try {
      setSubmitting(true);
      const res = await api.post(`/super-admin/access-templates/${template.id}/register-user`, payload);

      if (res.data?.success && res.data?.user) {
        setSuccessInfo({
          name: res.data.user.name,
          email: res.data.user.email,
          employeeId: res.data.user.employeeId,
          role: res.data.user.role
        });
        // Immediately wipe plaintext password from memory
        setPassword('');

        if (onSuccess) {
          onSuccess(res.data.user);
        }
      }
    } catch (err) {
      console.error('Registration failed:', err);
      const msg = err.response?.data?.message || 'Failed to register user from template.';
      setErrorMessage(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-background/80 backdrop-blur-md overflow-y-auto">
      <div className="relative w-full max-w-xl my-6 bg-card border border-border/80 shadow-2xl rounded-3xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-5 border-b border-border/60 flex items-center justify-between bg-muted/20">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-primary/10 text-primary border border-primary/20">
              <UserPlus className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-black tracking-tight text-foreground">
                Register User with Template
              </h2>
              <p className="text-xs text-muted-foreground font-medium">
                Create and bind a new account to '{template.name}'
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-2xl text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Success Notice View */}
        {successInfo ? (
          <div className="p-8 text-center space-y-5">
            <div className="h-16 w-16 mx-auto rounded-3xl bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 flex items-center justify-center">
              <CheckCircle2 className="h-8 w-8" />
            </div>
            <div className="space-y-1.5">
              <h3 className="text-lg font-black text-foreground">Registration Successful!</h3>
              <p className="text-xs text-muted-foreground">
                The user account has been registered and assigned to template <strong>'{template.name}'</strong>.
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-muted/30 border border-border/60 text-left space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground font-bold">Employee ID:</span>
                <span className="font-mono font-black text-primary">{successInfo.employeeId}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground font-bold">Full Name:</span>
                <span className="font-black text-foreground">{successInfo.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground font-bold">Email:</span>
                <span className="font-medium text-foreground">{successInfo.email}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground font-bold">Role:</span>
                <span className="px-2 py-0.5 rounded-md bg-primary/10 text-primary font-black">{successInfo.role}</span>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="w-full py-2.5 rounded-2xl bg-primary text-primary-foreground text-xs font-black shadow transition hover:bg-primary/90"
            >
              Done & Return to Templates
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto max-h-[80vh]">
            {errorMessage && (
              <div className="p-3.5 rounded-2xl bg-destructive/10 border border-destructive/20 text-destructive flex items-center gap-2.5 text-xs font-bold">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Read-Only Template Context Card */}
            <div className="p-4 rounded-2xl bg-primary/5 border border-primary/20 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-black text-primary flex items-center gap-1.5">
                  <Shield className="h-3.5 w-3.5" />
                  Bound Access Template
                </span>
                <span className="px-2 py-0.5 rounded-md bg-primary/20 text-primary font-black text-[10px]">
                  {template.baseRole}
                </span>
              </div>
              <p className="font-extrabold text-foreground text-sm">{template.name}</p>
              <div className="flex items-center gap-2 text-muted-foreground text-[11px] pt-1">
                <Building2 className="h-3 w-3 text-primary" />
                <span>Organization: <strong className="text-foreground">{template.organization?.name || 'Selected Tenant'}</strong></span>
                <span>•</span>
                <span>Role and tenant are strictly locked to this template</span>
              </div>
            </div>

            {/* Inputs Grid */}
            <div className="space-y-3.5">
              {/* Full Name */}
              <div className="space-y-1">
                <label className="text-xs font-extrabold text-foreground">
                  Full Name <span className="text-destructive">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Rahul Sharma"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-xs font-medium rounded-2xl border border-border/60 bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary/50 outline-none transition"
                />
              </div>

              {/* Email Address */}
              <div className="space-y-1">
                <label className="text-xs font-extrabold text-foreground flex items-center gap-1">
                  <Mail className="h-3 w-3 text-primary" />
                  Work Email <span className="text-destructive">*</span>
                </label>
                <input
                  type="email"
                  required
                  placeholder="name@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-xs font-medium rounded-2xl border border-border/60 bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary/50 outline-none transition"
                />
              </div>

              {/* Initial Password */}
              <div className="space-y-1">
                <label className="text-xs font-extrabold text-foreground flex items-center justify-between">
                  <span className="flex items-center gap-1">
                    <Lock className="h-3 w-3 text-primary" />
                    Initial Password <span className="text-destructive">*</span>
                  </span>
                  <span className="text-[10px] text-muted-foreground font-normal">Min 6 characters</span>
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    placeholder="Enter secure initial password..."
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full pl-3.5 pr-10 py-2.5 text-xs font-medium rounded-2xl border border-border/60 bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary/50 outline-none transition"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Hashed with bcrypt upon submission; never stored or logged in plaintext.
                </p>
              </div>

              {/* Phone & DOB */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-extrabold text-foreground flex items-center gap-1">
                    <Phone className="h-3 w-3 text-primary" />
                    Phone Number
                  </label>
                  <input
                    type="tel"
                    placeholder="10-digit mobile"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full px-3.5 py-2 text-xs font-medium rounded-2xl border border-border/60 bg-background focus:ring-2 focus:ring-primary/20 outline-none transition"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-extrabold text-foreground flex items-center gap-1">
                    <Calendar className="h-3 w-3 text-primary" />
                    Date of Birth
                  </label>
                  <input
                    type="date"
                    value={dob}
                    onChange={(e) => setDob(e.target.value)}
                    className="w-full px-3.5 py-2 text-xs font-medium rounded-2xl border border-border/60 bg-background focus:ring-2 focus:ring-primary/20 outline-none transition"
                  />
                </div>
              </div>

              {/* Department & Designation */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-extrabold text-foreground flex items-center gap-1">
                    <Briefcase className="h-3 w-3 text-primary" />
                    Department
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Engineering"
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    className="w-full px-3.5 py-2 text-xs font-medium rounded-2xl border border-border/60 bg-background focus:ring-2 focus:ring-primary/20 outline-none transition"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-extrabold text-foreground">
                    Designation
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Associate Developer"
                    value={designation}
                    onChange={(e) => setDesignation(e.target.value)}
                    className="w-full px-3.5 py-2 text-xs font-medium rounded-2xl border border-border/60 bg-background focus:ring-2 focus:ring-primary/20 outline-none transition"
                  />
                </div>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="pt-3 border-t border-border/60 flex items-center justify-between">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="px-4 py-2 rounded-2xl text-xs font-bold text-muted-foreground hover:bg-muted/50 transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-6 py-2.5 rounded-2xl bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-black shadow-lg shadow-primary/20 transition-all disabled:opacity-50 flex items-center gap-2"
              >
                {submitting ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    Registering Account...
                  </>
                ) : (
                  <>
                    <UserPlus className="h-4 w-4" />
                    Register User
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

export default RegisterTemplateUserModal;
