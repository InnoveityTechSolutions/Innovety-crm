import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { X, ChevronRight, ChevronLeft, UserCheck, CheckCircle2, AlertCircle, UploadCloud, FileText, Trash2, Building2, Clock } from 'lucide-react';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { extractCompanyList } from '../../context/CompanyScopeContext';

const CANDIDATE_TYPES = [
  { id: 'Student', title: 'Student', desc: 'Currently enrolled in college / university' },
  { id: 'Graduated', title: 'Graduated', desc: 'Completed degree, holds final marks / CGPA' },
  { id: 'Fresher', title: 'Fresher', desc: 'Recent graduate, entry-level candidate' },
  { id: 'Professional', title: 'Professional', desc: 'Prior industry employment experience' }
];

const UserWizardModal = ({
  isOpen,
  onClose,
  onSubmit,
  initialData,
  isEdit = false,
  targetRole = 'EMPLOYEE',
  loading = false
}) => {
  const { user } = useAuth();
  const [step, setStep] = useState(1);
  const [orgTree, setOrgTree] = useState(null);
  const [organizations, setOrganizations] = useState([]);
  const [locations, setLocations] = useState([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');

  // Resume upload states
  const [resumeFile, setResumeFile] = useState(null);
  const [resumeError, setResumeError] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef(null);

  // Refs for focus management on error
  const nameRef = useRef(null);
  const emailRef = useRef(null);
  const phoneRef = useRef(null);
  const dobRef = useRef(null);
  const joiningDateRef = useRef(null);
  const collegeRef = useRef(null);
  const degreeRef = useRef(null);
  const gradYearRef = useRef(null);
  const currentYearSemRef = useRef(null);
  const cgpaRef = useRef(null);
  const skillsRef = useRef(null);
  const companyNameRef = useRef(null);
  const totalExpRef = useRef(null);
  const designationRef = useRef(null);
  const noticePeriodRef = useRef(null);

  const [form, setForm] = useState({
    candidateType: 'Student',
    name: '',
    email: '',
    phone: '',
    dob: '',
    joiningDate: '',
    gender: 'Male',
    branchId: '',
    departmentId: '',
    designationId: '',
    positionId: '',
    role: targetRole,
    reportingManagerId: '',
    college: '',
    degree: '',
    currentYearSemester: '',
    graduationYear: '',
    cgpa: '',
    keySkills: '',
    companyName: '',
    designation: '',
    totalExperience: '',
    noticePeriod: '',
    autoClockOutEnabled: true
  });

  const initialId = initialData?.id || initialData?.email || null;

  // Reset & initialize form state on modal open
  useEffect(() => {
    if (isOpen) {
      const data = initialData || {};
      let mappedType = data.candidateType || 'Student';
      if (mappedType === 'Experienced Professional') mappedType = 'Professional';
      if (mappedType === 'Graduate') mappedType = 'Graduated';
      if (!CANDIDATE_TYPES.find(t => t.id === mappedType)) mappedType = 'Student';

      const todayStr = new Date().toISOString().split('T')[0];
      const initialJoining = data.joiningDate
        ? new Date(data.joiningDate).toISOString().split('T')[0]
        : (isEdit ? '' : todayStr);

      setForm({
        candidateType: mappedType,
        name: data.name || '',
        email: data.email || '',
        phone: data.phone || '',
        dob: data.dob ? new Date(data.dob).toISOString().split('T')[0] : '',
        joiningDate: initialJoining,
        gender: data.gender || 'Male',
        organizationId: data.organizationId || data.organization?.id || '',
        branchId: data.branchId || '',
        departmentId: data.departmentId || '',
        designationId: data.designationId || '',
        positionId: data.positionId || '',
        role: data.role || targetRole,
        reportingManagerId: data.reportingManagerId || '',
        college: data.college || '',
        degree: data.degree || '',
        currentYearSemester: data.currentYearSemester || '',
        graduationYear: data.graduationYear || '',
        cgpa: data.customData?.cgpa || data.cgpa || '',
        keySkills: data.keySkills || '',
        companyName: data.companyName || '',
        designation: data.designation || '',
        totalExperience: data.totalExperience || '',
        noticePeriod: data.customData?.noticePeriod || data.noticePeriod || '',
        attendanceLocationIds: data.attendanceLocationIds || (data.assignedLocations ? data.assignedLocations.map(l => l.id) : (data.assignedAttendanceLocations ? data.assignedAttendanceLocations.map(a => a.attendanceLocationId) : [])),
        autoClockOutEnabled: data.autoClockOutEnabled !== undefined ? Boolean(data.autoClockOutEnabled) : true
      });
      setStep(1);
      setErrors({});
      setServerError('');
      setResumeFile(null);
      setResumeError('');
      setDragActive(false);
    }
  }, [isOpen, initialId, targetRole]);

  // Fetch active companies for Super Admin selection
  useEffect(() => {
    if (!isOpen) return;
    const fetchOrgs = async () => {
      try {
        const res = await api.get('/organizations');
        const list = extractCompanyList(res.data);
        setOrganizations(list);
        if (list.length > 0) {
          setForm(prev => {
            if (!prev.organizationId || !list.some(o => o.id === prev.organizationId)) {
              const innoveity = list.find(o => o.slug === 'innoveity');
              return { ...prev, organizationId: innoveity?.id || list[0]?.id || '' };
            }
            return prev;
          });
        }
      } catch (err) {
        console.error('Failed to fetch organizations for wizard:', err);
      }
    };
    fetchOrgs();

    window.addEventListener('organization-updated', fetchOrgs);
    return () => window.removeEventListener('organization-updated', fetchOrgs);
  }, [isOpen]);

  // Fetch attendance locations for target organization
  useEffect(() => {
    if (!isOpen) return;
    const fetchLocs = async () => {
      try {
        const targetOrg = form.organizationId || (user?.role === 'SUPER_ADMIN' ? '' : user?.organizationId);
        const params = {};
        if (targetOrg) params.organizationId = targetOrg;
        const res = await api.get('/attendance-locations', { params });
        setLocations(res.data.locations || []);
      } catch (err) {
        console.warn('Failed to load locations in wizard:', err);
      }
    };
    fetchLocs();
  }, [isOpen, form.organizationId, user]);

  // Fetch dynamic org tree & reporting managers
  useEffect(() => {
    if (!isOpen) return;
    let isMounted = true;

    const fetchTreeData = async () => {
      try {
        setTreeLoading(true);
        const params = new URLSearchParams({
          targetRole: form.role || targetRole
        });
        if (initialData?.id) params.append('excludeUserId', initialData.id);

        const res = await api.get(`/organization/tree?${params.toString()}`);
        if (!isMounted) return;
        setOrgTree(res.data || {});

        setForm(prev => {
          const updates = {};
          if (res.data?.branches?.length > 0 && !prev.branchId) {
            updates.branchId = res.data.branches[0].id;
          }
          if (res.data?.departments?.length > 0 && !prev.departmentId) {
            updates.departmentId = res.data.departments[0].id;
          }
          if (res.data?.positions?.length > 0 && !prev.positionId) {
            const matchPos = res.data.positions.find(p =>
              (prev.role || targetRole) === 'INTERN' ? p.code === 'POS-INT' :
              (prev.role || targetRole) === 'TEAM_LEADER' ? p.code === 'POS-LED' :
              (prev.role || targetRole) === 'ADMIN' ? p.code === 'POS-MGR' : p.code === 'POS-JUN'
            ) || res.data.positions[0];
            if (matchPos) {
              updates.positionId = matchPos.id;
            }
          }
          if (Object.keys(updates).length > 0) {
            return { ...prev, ...updates };
          }
          return prev;
        });
      } catch (err) {
        console.error('Failed to load organization tree in wizard:', err);
      } finally {
        if (isMounted) setTreeLoading(false);
      }
    };

    fetchTreeData();

    return () => {
      isMounted = false;
    };
  }, [isOpen, form.role, targetRole]);

  if (!isOpen) return null;

  const handleChange = (e) => {
    const { name, value } = e.target;
    let sanitizedValue = value;

    if (name === 'phone') {
      // Allow only digits (0-9) and max 10 digits
      sanitizedValue = value.replace(/\D/g, '').slice(0, 10);
    } else if (name === 'graduationYear') {
      // Allow only digits (0-9) and max 4 digits
      sanitizedValue = value.replace(/\D/g, '').slice(0, 4);
    }

    setForm(prev => ({ ...prev, [name]: sanitizedValue }));
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: '' }));
    }
    if (serverError) setServerError('');
  };

  const validateAndSetResumeFile = (file) => {
    if (!file) return;
    const allowedExts = ['.pdf', '.doc', '.docx'];
    const ext = '.' + file.name.split('.').pop().toLowerCase();

    if (!allowedExts.includes(ext)) {
      setResumeError('Only PDF, DOC, or DOCX files are allowed.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setResumeError('Resume size must be less than 5 MB.');
      return;
    }

    setResumeError('');
    setResumeFile(file);
  };

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      validateAndSetResumeFile(file);
    }
  };

  const handleFileDrop = (e) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      validateAndSetResumeFile(file);
    }
  };

  const handleRemoveFile = () => {
    setResumeFile(null);
    setResumeError('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const validateStep1 = () => {
    const newErrors = {};
    if (!form.candidateType) {
      newErrors.candidateType = 'Please select a Candidate Type to proceed.';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const validateStep2 = () => {
    const newErrors = {};
    const currentYear = new Date().getFullYear();
    const maxGradYear = currentYear + 6;

    // Full Name: Minimum 3 characters, letters and spaces only
    const nameRegex = /^[a-zA-Z\s]{3,}$/;
    if (!form.name || !nameRegex.test(form.name.trim())) {
      newErrors.name = 'Full Name must be at least 3 characters and contain letters/spaces only.';
    }

    // Email Address: Valid email format, trimmed
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!form.email || !emailRegex.test(form.email.trim())) {
      newErrors.email = 'Please enter a valid Email Address.';
    }

    // Phone Number: Exactly 10 digits, cannot start with 0
    const phoneDigits = (form.phone || '').replace(/\D/g, '');
    if (!phoneDigits || phoneDigits.length !== 10 || phoneDigits.startsWith('0')) {
      newErrors.phone = 'Phone number must contain exactly 10 digits and cannot start with 0.';
    }

    // Date of Birth: Valid date, not future, age between 16 and 60
    if (!form.dob) {
      newErrors.dob = 'Please enter a valid Date of Birth.';
    } else {
      const dobDate = new Date(form.dob);
      const today = new Date();
      if (isNaN(dobDate.getTime()) || dobDate >= today) {
        newErrors.dob = 'Date of Birth cannot be today or in the future.';
      } else {
        let age = today.getFullYear() - dobDate.getFullYear();
        const m = today.getMonth() - dobDate.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < dobDate.getDate())) {
          age--;
        }
        if (age < 16 || age > 60) {
          newErrors.dob = `Age must be between 16 and 60 years (Calculated age: ${age}).`;
        }
      }
    }

    // Joining Date: Required, valid date
    if (!form.joiningDate) {
      newErrors.joiningDate = 'Please enter a valid Joining Date.';
    } else {
      const jDate = new Date(form.joiningDate);
      if (isNaN(jDate.getTime())) {
        newErrors.joiningDate = 'Please enter a valid Joining Date.';
      }
    }

    // Dynamic validation strictly by candidateType
    const type = form.candidateType;
    if (type === 'Student') {
      if (!form.college || form.college.trim().length < 2) newErrors.college = 'College / Institution name is required.';
      if (!form.degree || form.degree.trim().length < 2) newErrors.degree = 'Degree / Stream is required.';

      const gradYearNum = parseInt(form.graduationYear, 10);
      if (!form.graduationYear || isNaN(gradYearNum) || form.graduationYear.length !== 4 || gradYearNum < 2000 || gradYearNum > maxGradYear) {
        newErrors.graduationYear = `Graduation Year must be a 4-digit year between 2000 and ${maxGradYear}.`;
      }
      if (!form.currentYearSemester || form.currentYearSemester.trim().length < 1) {
        newErrors.currentYearSemester = 'Current Semester / Year is required.';
      }
    } else if (type === 'Graduated') {
      if (!form.college || form.college.trim().length < 2) newErrors.college = 'College / Institution name is required.';
      if (!form.degree || form.degree.trim().length < 2) newErrors.degree = 'Degree / Stream is required.';

      const gradYearNum = parseInt(form.graduationYear, 10);
      if (!form.graduationYear || isNaN(gradYearNum) || form.graduationYear.length !== 4 || gradYearNum < 2000 || gradYearNum > maxGradYear) {
        newErrors.graduationYear = `Graduation Year must be a 4-digit year between 2000 and ${maxGradYear}.`;
      }
      if (!form.cgpa || form.cgpa.trim().length < 1) {
        newErrors.cgpa = 'Percentage / CGPA is required for Graduated candidates.';
      }
      if (!form.keySkills || form.keySkills.trim().length < 2) {
        newErrors.keySkills = 'Skills / Technologies are required.';
      }
    } else if (type === 'Fresher') {
      if (!form.college || form.college.trim().length < 2) newErrors.college = 'College / Institution name is required.';
      if (!form.degree || form.degree.trim().length < 2) newErrors.degree = 'Degree / Stream is required.';

      const gradYearNum = parseInt(form.graduationYear, 10);
      if (!form.graduationYear || isNaN(gradYearNum) || form.graduationYear.length !== 4 || gradYearNum < 2000 || gradYearNum > maxGradYear) {
        newErrors.graduationYear = `Graduation Year must be a 4-digit year between 2000 and ${maxGradYear}.`;
      }
      if (!form.keySkills || form.keySkills.trim().length < 2) {
        newErrors.keySkills = 'Skills / Technologies are required.';
      }
    } else if (type === 'Professional' || type === 'Experienced Professional') {
      if (!form.companyName || form.companyName.trim().length < 2) newErrors.companyName = 'Company Name is required.';

      const expNum = parseFloat(form.totalExperience);
      if (!form.totalExperience || isNaN(expNum) || expNum <= 0) {
        newErrors.totalExperience = 'Total Experience must be a positive number (e.g. 2.5).';
      }
      if (!form.designation || form.designation.trim().length < 2) newErrors.designation = 'Current / Last Designation is required.';
      if (!form.noticePeriod || form.noticePeriod.trim().length < 1) newErrors.noticePeriod = 'Notice Period is required.';
      if (!form.keySkills || form.keySkills.trim().length < 2) newErrors.keySkills = 'Skills / Technologies are required.';
    }

    if (resumeError) {
      newErrors.resume = resumeError;
    }

    setErrors(newErrors);

    // Auto-focus first failing field
    if (newErrors.name) nameRef.current?.focus();
    else if (newErrors.email) emailRef.current?.focus();
    else if (newErrors.phone) phoneRef.current?.focus();
    else if (newErrors.dob) dobRef.current?.focus();
    else if (newErrors.joiningDate) joiningDateRef.current?.focus();
    else if (newErrors.college) collegeRef.current?.focus();
    else if (newErrors.degree) degreeRef.current?.focus();
    else if (newErrors.graduationYear) gradYearRef.current?.focus();
    else if (newErrors.currentYearSemester) currentYearSemRef.current?.focus();
    else if (newErrors.cgpa) cgpaRef.current?.focus();
    else if (newErrors.keySkills) skillsRef.current?.focus();
    else if (newErrors.companyName) companyNameRef.current?.focus();
    else if (newErrors.totalExperience) totalExpRef.current?.focus();
    else if (newErrors.designation) designationRef.current?.focus();
    else if (newErrors.noticePeriod) noticePeriodRef.current?.focus();

    return Object.keys(newErrors).length === 0;
  };

  const handleNext = (e) => {
    e.preventDefault();
    setServerError('');
    if (step === 1) {
      if (!validateStep1()) return;
      setStep(2);
    } else if (step === 2) {
      if (!validateStep2()) return;
      setStep(3);
    }
  };

  const handlePrev = () => {
    setServerError('');
    if (step > 1) setStep(step - 1);
  };

  const handleFinalSubmit = async (e) => {
    e.preventDefault();
    setServerError('');

    if (!validateStep1()) {
      setStep(1);
      return;
    }
    if (!validateStep2()) {
      setStep(2);
      return;
    }

    try {
      const payload = {
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone,
        dob: form.dob,
        joiningDate: form.joiningDate || undefined,
        gender: form.gender,
        candidateType: form.candidateType,
        role: targetRole,
        targetRole,
        organizationId: form.organizationId || null,
        positionId: form.positionId || null,
        branchId: form.branchId || null,
        departmentId: form.departmentId || null,
        reportingManagerId: form.reportingManagerId || null,
        attendanceLocationIds: form.attendanceLocationIds || [],
        autoClockOutEnabled: form.autoClockOutEnabled !== undefined ? Boolean(form.autoClockOutEnabled) : true
      };

      if (resumeFile) {
        payload.resumeFile = resumeFile;
      }

      const type = form.candidateType;
      if (type === 'Student') {
        payload.college = form.college.trim();
        payload.degree = form.degree.trim();
        payload.graduationYear = form.graduationYear;
        payload.currentYearSemester = form.currentYearSemester.trim();
      } else if (type === 'Graduated') {
        payload.college = form.college.trim();
        payload.degree = form.degree.trim();
        payload.graduationYear = form.graduationYear;
        payload.cgpa = form.cgpa.trim();
        payload.keySkills = form.keySkills.trim();
      } else if (type === 'Fresher') {
        payload.college = form.college.trim();
        payload.degree = form.degree.trim();
        payload.graduationYear = form.graduationYear;
        payload.keySkills = form.keySkills.trim();
      } else if (type === 'Professional' || type === 'Experienced Professional') {
        payload.companyName = form.companyName.trim();
        payload.totalExperience = form.totalExperience.trim();
        payload.designation = form.designation.trim();
        payload.noticePeriod = form.noticePeriod.trim();
        payload.keySkills = form.keySkills.trim();
      }

      await onSubmit(payload);
    } catch (err) {
      console.error('Modal onboarding submission error:', err);
      const msg = err.response?.data?.message || err.message || 'Failed to complete onboarding.';
      setServerError(msg);
      if (err.response?.data?.errors) {
        setErrors(err.response.data.errors);
      }
    }
  };

  const selectedPosition = orgTree?.positions?.find(p => p.id === form.positionId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs">
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="relative z-50 pointer-events-auto bg-card border border-border/80 rounded-3xl p-6 sm:p-8 max-w-2xl w-full shadow-2xl space-y-6 text-left"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/60 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-primary/10 text-primary border border-primary/20">
              <UserCheck className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-foreground">
                {isEdit ? (initialData?.name || 'Edit User Details') : `Onboard New ${targetRole === 'INTERN' ? 'Intern' : targetRole === 'TEAM_LEADER' ? 'Team Leader' : 'Employee'}`}
              </h3>
              <p className="text-xs text-muted-foreground font-medium font-mono">
                {isEdit && (initialData?.employeeId || initialData?.id)
                  ? (initialData.employeeId || initialData.id)
                  : '3-Step Dynamic Onboarding Wizard'}
              </p>
            </div>
          </div>

          <button onClick={onClose} className="text-muted-foreground hover:text-foreground cursor-pointer">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Wizard Stepper Progress Bar (3 Steps) */}
        <div className="grid grid-cols-3 gap-2 py-1">
          <button
            type="button"
            onClick={() => setStep(1)}
            className={`p-2 rounded-2xl border text-left transition-all cursor-pointer ${
              step === 1 ? 'border-primary bg-primary/10 text-primary font-bold' : 'border-border/60 text-muted-foreground'
            }`}
          >
            <div className="text-[9px] font-extrabold uppercase tracking-wider">Step 1</div>
            <div className="text-xs font-bold truncate">Candidate Type</div>
          </button>

          <button
            type="button"
            onClick={() => {
              if (!validateStep1()) return;
              setStep(2);
            }}
            className={`p-2 rounded-2xl border text-left transition-all cursor-pointer ${
              step === 2 ? 'border-primary bg-primary/10 text-primary font-bold' : 'border-border/60 text-muted-foreground'
            }`}
          >
            <div className="text-[9px] font-extrabold uppercase tracking-wider">Step 2</div>
            <div className="text-xs font-bold truncate">Personal Details</div>
          </button>

          <button
            type="button"
            onClick={() => {
              if (!validateStep1()) return;
              if (!validateStep2()) return;
              setStep(3);
            }}
            className={`p-2 rounded-2xl border text-left transition-all cursor-pointer ${
              step === 3 ? 'border-primary bg-primary/10 text-primary font-bold' : 'border-border/60 text-muted-foreground'
            }`}
          >
            <div className="text-[9px] font-extrabold uppercase tracking-wider">Step 3</div>
            <div className="text-xs font-bold truncate">Organization</div>
          </button>
        </div>

        {/* In-modal error banner for server/submission failures */}
        {serverError && (
          <div className="p-3 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-500 text-xs font-semibold flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{serverError}</span>
          </div>
        )}

        <form onSubmit={step === 3 ? handleFinalSubmit : handleNext} noValidate className="space-y-4 max-h-[58vh] overflow-y-auto pr-1">
          {/* STEP 1: CANDIDATE TYPE */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <h4 className="text-xs font-bold text-foreground uppercase tracking-wider mb-1">Select Candidate Type *</h4>
                <p className="text-xs text-muted-foreground mb-3 font-medium">Choose the candidate category. Exactly one option must be selected.</p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {CANDIDATE_TYPES.map((item) => {
                    const isSelected = form.candidateType === item.id;
                    return (
                      <div
                        key={item.id}
                        onClick={() => {
                          setForm(prev => ({ ...prev, candidateType: item.id }));
                          if (errors.candidateType) setErrors(prev => ({ ...prev, candidateType: '' }));
                          if (serverError) setServerError('');
                        }}
                        className={`p-4 rounded-2xl border-2 cursor-pointer transition-all flex flex-col justify-between ${
                          isSelected
                            ? 'border-primary bg-primary/5 shadow-xs'
                            : 'border-border/60 hover:border-border bg-card'
                        }`}
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <h5 className="text-xs font-extrabold text-foreground">{item.title}</h5>
                            <p className="text-[11px] text-muted-foreground mt-0.5">{item.desc}</p>
                          </div>
                          <div className={`h-5 w-5 rounded-full border flex items-center justify-center ${isSelected ? 'bg-primary border-primary text-white' : 'border-border'}`}>
                            {isSelected && <CheckCircle2 className="h-3.5 w-3.5" />}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {errors.candidateType && (
                  <p className="text-rose-500 text-[11px] font-semibold flex items-center gap-1 mt-2">
                    <AlertCircle className="h-3.5 w-3.5" />
                    {errors.candidateType}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* STEP 2: PERSONAL & DYNAMIC CANDIDATE DETAILS */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-border/40">
                <span className="text-xs font-extrabold text-foreground">Common Personal Details</span>
                <span className="px-2.5 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-extrabold">{form.candidateType}</span>
              </div>

              {/* 1. Common Personal Fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-foreground mb-1">Full Name *</label>
                  <input
                    ref={nameRef}
                    type="text"
                    name="name"
                    placeholder="John Doe"
                    value={form.name || ''}
                    onChange={handleChange}
                    className={`w-full px-3 py-2 text-xs font-medium rounded-xl border ${
                      errors.name ? 'border-rose-500 focus:border-rose-500 focus:ring-1 focus:ring-rose-500 bg-rose-500/5' : 'border-border bg-muted/30 focus:bg-background'
                    } transition-all`}
                  />
                  {errors.name && (
                    <p className="text-rose-500 text-[11px] font-semibold flex items-center gap-1 mt-1">
                      <AlertCircle className="h-3 w-3 shrink-0" />
                      {errors.name}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-bold text-foreground mb-1">Email Address *</label>
                  <input
                    ref={emailRef}
                    type="email"
                    name="email"
                    placeholder="john@innoveity.com"
                    value={form.email || ''}
                    onChange={handleChange}
                    className={`w-full px-3 py-2 text-xs font-medium rounded-xl border ${
                      errors.email ? 'border-rose-500 focus:border-rose-500 focus:ring-1 focus:ring-rose-500 bg-rose-500/5' : 'border-border bg-muted/30 focus:bg-background'
                    } transition-all`}
                  />
                  {errors.email && (
                    <p className="text-rose-500 text-[11px] font-semibold flex items-center gap-1 mt-1">
                      <AlertCircle className="h-3 w-3 shrink-0" />
                      {errors.email}
                    </p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-foreground mb-1">Phone Number *</label>
                  <input
                    ref={phoneRef}
                    type="text"
                    name="phone"
                    placeholder="9876543210"
                    value={form.phone || ''}
                    onChange={handleChange}
                    className={`w-full px-3 py-2 text-xs font-medium rounded-xl border ${
                      errors.phone ? 'border-rose-500 focus:border-rose-500 focus:ring-1 focus:ring-rose-500 bg-rose-500/5' : 'border-border bg-muted/30 focus:bg-background'
                    } transition-all`}
                  />
                  {errors.phone && (
                    <p className="text-rose-500 text-[11px] font-semibold flex items-center gap-1 mt-1">
                      <AlertCircle className="h-3 w-3 shrink-0" />
                      {errors.phone}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-bold text-foreground mb-1">Gender</label>
                  <select
                    name="gender"
                    value={form.gender || 'Male'}
                    onChange={handleChange}
                    className="w-full px-3 py-2 text-xs font-bold rounded-xl border border-border bg-card cursor-pointer"
                  >
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-foreground mb-1">Date of Birth *</label>
                  <input
                    ref={dobRef}
                    type="date"
                    name="dob"
                    value={form.dob || ''}
                    onChange={handleChange}
                    className={`w-full px-3 py-2 text-xs font-medium rounded-xl border ${
                      errors.dob ? 'border-rose-500 focus:border-rose-500 focus:ring-1 focus:ring-rose-500 bg-rose-500/5' : 'border-border bg-muted/30 focus:bg-background'
                    } transition-all`}
                  />
                  {errors.dob && (
                    <p className="text-rose-500 text-[11px] font-semibold flex items-center gap-1 mt-1">
                      <AlertCircle className="h-3 w-3 shrink-0" />
                      {errors.dob}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-bold text-foreground mb-1">Joining Date *</label>
                  <input
                    ref={joiningDateRef}
                    type="date"
                    name="joiningDate"
                    value={form.joiningDate || ''}
                    onChange={handleChange}
                    className={`w-full px-3 py-2 text-xs font-medium rounded-xl border ${
                      errors.joiningDate ? 'border-rose-500 focus:border-rose-500 focus:ring-1 focus:ring-rose-500 bg-rose-500/5' : 'border-border bg-muted/30 focus:bg-background'
                    } transition-all`}
                  />
                  {errors.joiningDate && (
                    <p className="text-rose-500 text-[11px] font-semibold flex items-center gap-1 mt-1">
                      <AlertCircle className="h-3 w-3 shrink-0" />
                      {errors.joiningDate}
                    </p>
                  )}
                </div>
              </div>

              {/* 2. Dynamic Candidate-Specific Fields */}
              <div className="pt-3 border-t border-border/40">
                <span className="text-xs font-extrabold text-foreground block mb-2">{form.candidateType} Requirements</span>

                {/* STUDENT */}
                {form.candidateType === 'Student' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-foreground mb-1">College / Institution *</label>
                      <input
                        ref={collegeRef}
                        type="text"
                        name="college"
                        placeholder="e.g. MIT / IIT"
                        value={form.college || ''}
                        onChange={handleChange}
                        className={`w-full px-3 py-2 text-xs font-medium rounded-xl border ${
                          errors.college ? 'border-rose-500 bg-rose-500/5' : 'border-border bg-muted/30 focus:bg-background'
                        }`}
                      />
                      {errors.college && <p className="text-rose-500 text-[11px] font-semibold flex items-center gap-1 mt-1"><AlertCircle className="h-3 w-3 shrink-0" />{errors.college}</p>}
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-foreground mb-1">Degree / Stream *</label>
                      <input
                        ref={degreeRef}
                        type="text"
                        name="degree"
                        placeholder="e.g. B.Tech Computer Science"
                        value={form.degree || ''}
                        onChange={handleChange}
                        className={`w-full px-3 py-2 text-xs font-medium rounded-xl border ${
                          errors.degree ? 'border-rose-500 bg-rose-500/5' : 'border-border bg-muted/30 focus:bg-background'
                        }`}
                      />
                      {errors.degree && <p className="text-rose-500 text-[11px] font-semibold flex items-center gap-1 mt-1"><AlertCircle className="h-3 w-3 shrink-0" />{errors.degree}</p>}
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-foreground mb-1">Graduation Year *</label>
                      <input
                        ref={gradYearRef}
                        type="text"
                        name="graduationYear"
                        placeholder="e.g. 2026"
                        value={form.graduationYear || ''}
                        onChange={handleChange}
                        className={`w-full px-3 py-2 text-xs font-medium rounded-xl border ${
                          errors.graduationYear ? 'border-rose-500 bg-rose-500/5' : 'border-border bg-muted/30 focus:bg-background'
                        }`}
                      />
                      {errors.graduationYear && <p className="text-rose-500 text-[11px] font-semibold flex items-center gap-1 mt-1"><AlertCircle className="h-3 w-3 shrink-0" />{errors.graduationYear}</p>}
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-foreground mb-1">Current Semester / Year *</label>
                      <input
                        ref={currentYearSemRef}
                        type="text"
                        name="currentYearSemester"
                        placeholder="e.g. 3rd Year / 6th Sem"
                        value={form.currentYearSemester || ''}
                        onChange={handleChange}
                        className={`w-full px-3 py-2 text-xs font-medium rounded-xl border ${
                          errors.currentYearSemester ? 'border-rose-500 bg-rose-500/5' : 'border-border bg-muted/30 focus:bg-background'
                        }`}
                      />
                      {errors.currentYearSemester && <p className="text-rose-500 text-[11px] font-semibold flex items-center gap-1 mt-1"><AlertCircle className="h-3 w-3 shrink-0" />{errors.currentYearSemester}</p>}
                    </div>
                  </div>
                )}

                {/* GRADUATED */}
                {form.candidateType === 'Graduated' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-foreground mb-1">College / Institution *</label>
                      <input
                        ref={collegeRef}
                        type="text"
                        name="college"
                        placeholder="e.g. Loyola College"
                        value={form.college || ''}
                        onChange={handleChange}
                        className={`w-full px-3 py-2 text-xs font-medium rounded-xl border ${
                          errors.college ? 'border-rose-500 bg-rose-500/5' : 'border-border bg-muted/30 focus:bg-background'
                        }`}
                      />
                      {errors.college && <p className="text-rose-500 text-[11px] font-semibold flex items-center gap-1 mt-1"><AlertCircle className="h-3 w-3 shrink-0" />{errors.college}</p>}
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-foreground mb-1">Degree / Stream *</label>
                      <input
                        ref={degreeRef}
                        type="text"
                        name="degree"
                        placeholder="e.g. M.Sc Information Technology"
                        value={form.degree || ''}
                        onChange={handleChange}
                        className={`w-full px-3 py-2 text-xs font-medium rounded-xl border ${
                          errors.degree ? 'border-rose-500 bg-rose-500/5' : 'border-border bg-muted/30 focus:bg-background'
                        }`}
                      />
                      {errors.degree && <p className="text-rose-500 text-[11px] font-semibold flex items-center gap-1 mt-1"><AlertCircle className="h-3 w-3 shrink-0" />{errors.degree}</p>}
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-foreground mb-1">Graduation Year *</label>
                      <input
                        ref={gradYearRef}
                        type="text"
                        name="graduationYear"
                        placeholder="e.g. 2025"
                        value={form.graduationYear || ''}
                        onChange={handleChange}
                        className={`w-full px-3 py-2 text-xs font-medium rounded-xl border ${
                          errors.graduationYear ? 'border-rose-500 bg-rose-500/5' : 'border-border bg-muted/30 focus:bg-background'
                        }`}
                      />
                      {errors.graduationYear && <p className="text-rose-500 text-[11px] font-semibold flex items-center gap-1 mt-1"><AlertCircle className="h-3 w-3 shrink-0" />{errors.graduationYear}</p>}
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-foreground mb-1">Percentage / CGPA *</label>
                      <input
                        ref={cgpaRef}
                        type="text"
                        name="cgpa"
                        placeholder="e.g. 8.5 CGPA / 85%"
                        value={form.cgpa || ''}
                        onChange={handleChange}
                        className={`w-full px-3 py-2 text-xs font-medium rounded-xl border ${
                          errors.cgpa ? 'border-rose-500 bg-rose-500/5' : 'border-border bg-muted/30 focus:bg-background'
                        }`}
                      />
                      {errors.cgpa && <p className="text-rose-500 text-[11px] font-semibold flex items-center gap-1 mt-1"><AlertCircle className="h-3 w-3 shrink-0" />{errors.cgpa}</p>}
                    </div>

                    <div className="sm:col-span-2">
                      <label className="block text-xs font-bold text-foreground mb-1">Skills / Technologies *</label>
                      <input
                        ref={skillsRef}
                        type="text"
                        name="keySkills"
                        placeholder="e.g. Java, Python, React, SQL"
                        value={form.keySkills || ''}
                        onChange={handleChange}
                        className={`w-full px-3 py-2 text-xs font-medium rounded-xl border ${
                          errors.keySkills ? 'border-rose-500 bg-rose-500/5' : 'border-border bg-muted/30 focus:bg-background'
                        }`}
                      />
                      {errors.keySkills && <p className="text-rose-500 text-[11px] font-semibold flex items-center gap-1 mt-1"><AlertCircle className="h-3 w-3 shrink-0" />{errors.keySkills}</p>}
                    </div>
                  </div>
                )}

                {/* FRESHER */}
                {form.candidateType === 'Fresher' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-foreground mb-1">College / Institution *</label>
                      <input
                        ref={collegeRef}
                        type="text"
                        name="college"
                        placeholder="e.g. Anna University"
                        value={form.college || ''}
                        onChange={handleChange}
                        className={`w-full px-3 py-2 text-xs font-medium rounded-xl border ${
                          errors.college ? 'border-rose-500 bg-rose-500/5' : 'border-border bg-muted/30 focus:bg-background'
                        }`}
                      />
                      {errors.college && <p className="text-rose-500 text-[11px] font-semibold flex items-center gap-1 mt-1"><AlertCircle className="h-3 w-3 shrink-0" />{errors.college}</p>}
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-foreground mb-1">Degree / Stream *</label>
                      <input
                        ref={degreeRef}
                        type="text"
                        name="degree"
                        placeholder="e.g. B.E Computer Science"
                        value={form.degree || ''}
                        onChange={handleChange}
                        className={`w-full px-3 py-2 text-xs font-medium rounded-xl border ${
                          errors.degree ? 'border-rose-500 bg-rose-500/5' : 'border-border bg-muted/30 focus:bg-background'
                        }`}
                      />
                      {errors.degree && <p className="text-rose-500 text-[11px] font-semibold flex items-center gap-1 mt-1"><AlertCircle className="h-3 w-3 shrink-0" />{errors.degree}</p>}
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-foreground mb-1">Graduation Year *</label>
                      <input
                        ref={gradYearRef}
                        type="text"
                        name="graduationYear"
                        placeholder="e.g. 2025"
                        value={form.graduationYear || ''}
                        onChange={handleChange}
                        className={`w-full px-3 py-2 text-xs font-medium rounded-xl border ${
                          errors.graduationYear ? 'border-rose-500 bg-rose-500/5' : 'border-border bg-muted/30 focus:bg-background'
                        }`}
                      />
                      {errors.graduationYear && <p className="text-rose-500 text-[11px] font-semibold flex items-center gap-1 mt-1"><AlertCircle className="h-3 w-3 shrink-0" />{errors.graduationYear}</p>}
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-foreground mb-1">Skills / Technologies *</label>
                      <input
                        ref={skillsRef}
                        type="text"
                        name="keySkills"
                        placeholder="e.g. React, Node.js, SQL"
                        value={form.keySkills || ''}
                        onChange={handleChange}
                        className={`w-full px-3 py-2 text-xs font-medium rounded-xl border ${
                          errors.keySkills ? 'border-rose-500 bg-rose-500/5' : 'border-border bg-muted/30 focus:bg-background'
                        }`}
                      />
                      {errors.keySkills && <p className="text-rose-500 text-[11px] font-semibold flex items-center gap-1 mt-1"><AlertCircle className="h-3 w-3 shrink-0" />{errors.keySkills}</p>}
                    </div>
                  </div>
                )}

                {/* PROFESSIONAL */}
                {(form.candidateType === 'Professional' || form.candidateType === 'Experienced Professional') && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-foreground mb-1">Company Name *</label>
                      <input
                        ref={companyNameRef}
                        type="text"
                        name="companyName"
                        placeholder="e.g. TechCorp Solutions"
                        value={form.companyName || ''}
                        onChange={handleChange}
                        className={`w-full px-3 py-2 text-xs font-medium rounded-xl border ${
                          errors.companyName ? 'border-rose-500 bg-rose-500/5' : 'border-border bg-muted/30 focus:bg-background'
                        }`}
                      />
                      {errors.companyName && <p className="text-rose-500 text-[11px] font-semibold flex items-center gap-1 mt-1"><AlertCircle className="h-3 w-3 shrink-0" />{errors.companyName}</p>}
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-foreground mb-1">Total Experience (Years) *</label>
                      <input
                        ref={totalExpRef}
                        type="text"
                        name="totalExperience"
                        placeholder="e.g. 2.5"
                        value={form.totalExperience || ''}
                        onChange={handleChange}
                        className={`w-full px-3 py-2 text-xs font-medium rounded-xl border ${
                          errors.totalExperience ? 'border-rose-500 bg-rose-500/5' : 'border-border bg-muted/30 focus:bg-background'
                        }`}
                      />
                      {errors.totalExperience && <p className="text-rose-500 text-[11px] font-semibold flex items-center gap-1 mt-1"><AlertCircle className="h-3 w-3 shrink-0" />{errors.totalExperience}</p>}
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-foreground mb-1">Current / Last Designation *</label>
                      <input
                        ref={designationRef}
                        type="text"
                        name="designation"
                        placeholder="e.g. Senior Frontend Engineer"
                        value={form.designation || ''}
                        onChange={handleChange}
                        className={`w-full px-3 py-2 text-xs font-medium rounded-xl border ${
                          errors.designation ? 'border-rose-500 bg-rose-500/5' : 'border-border bg-muted/30 focus:bg-background'
                        }`}
                      />
                      {errors.designation && <p className="text-rose-500 text-[11px] font-semibold flex items-center gap-1 mt-1"><AlertCircle className="h-3 w-3 shrink-0" />{errors.designation}</p>}
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-foreground mb-1">Notice Period *</label>
                      <input
                        ref={noticePeriodRef}
                        type="text"
                        name="noticePeriod"
                        placeholder="e.g. 30 Days / Immediate"
                        value={form.noticePeriod || ''}
                        onChange={handleChange}
                        className={`w-full px-3 py-2 text-xs font-medium rounded-xl border ${
                          errors.noticePeriod ? 'border-rose-500 bg-rose-500/5' : 'border-border bg-muted/30 focus:bg-background'
                        }`}
                      />
                      {errors.noticePeriod && <p className="text-rose-500 text-[11px] font-semibold flex items-center gap-1 mt-1"><AlertCircle className="h-3 w-3 shrink-0" />{errors.noticePeriod}</p>}
                    </div>

                    <div className="sm:col-span-2">
                      <label className="block text-xs font-bold text-foreground mb-1">Skills / Technologies *</label>
                      <input
                        ref={skillsRef}
                        type="text"
                        name="keySkills"
                        placeholder="e.g. React, TypeScript, Node.js, AWS"
                        value={form.keySkills || ''}
                        onChange={handleChange}
                        className={`w-full px-3 py-2 text-xs font-medium rounded-xl border ${
                          errors.keySkills ? 'border-rose-500 bg-rose-500/5' : 'border-border bg-muted/30 focus:bg-background'
                        }`}
                      />
                      {errors.keySkills && <p className="text-rose-500 text-[11px] font-semibold flex items-center gap-1 mt-1"><AlertCircle className="h-3 w-3 shrink-0" />{errors.keySkills}</p>}
                    </div>
                  </div>
                )}
              </div>

              {/* 3. Optional Final Attachment: Resume / CV Upload Dropzone */}
              <div className="pt-3 border-t border-border/40">
                <span className="text-xs font-extrabold text-foreground block mb-2">Resume / CV Attachment (Optional)</span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  onChange={handleFileSelect}
                  className="hidden"
                />

                {!resumeFile ? (
                  <div
                    onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                    onDragLeave={() => setDragActive(false)}
                    onDrop={handleFileDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={`border-2 border-dashed rounded-2xl p-4 text-center cursor-pointer transition-all ${
                      resumeError
                        ? 'border-rose-500 bg-rose-500/5'
                        : dragActive
                        ? 'border-primary bg-primary/10'
                        : 'border-border/80 hover:border-primary/60 bg-muted/20 hover:bg-muted/40'
                    }`}
                  >
                    <div className="flex flex-col items-center justify-center gap-1.5">
                      <div className="p-2 rounded-xl bg-primary/10 text-primary">
                        <UploadCloud className="h-5 w-5" />
                      </div>
                      <p className="text-xs font-bold text-foreground">
                        <span className="text-primary hover:underline">Click to browse</span> or drag and drop candidate resume
                      </p>
                      <p className="text-[11px] text-muted-foreground font-medium">Upload candidate resume (PDF, DOC, DOCX - max 5 MB).</p>
                    </div>
                  </div>
                ) : (
                  <div className="p-3 rounded-2xl bg-card border border-border/80 flex items-center justify-between shadow-xs">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-xl bg-primary/10 text-primary">
                        <FileText className="h-5 w-5" />
                      </div>
                      <div className="text-left">
                        <p className="text-xs font-extrabold text-foreground truncate max-w-[240px]">{resumeFile.name}</p>
                        <p className="text-[11px] text-muted-foreground font-medium">{(resumeFile.size / (1024 * 1024)).toFixed(2)} MB • {resumeFile.name.split('.').pop()?.toUpperCase()}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="px-2.5 py-1 text-[11px] font-bold rounded-lg border border-border text-foreground hover:bg-muted cursor-pointer"
                      >
                        Replace
                      </button>
                      <button
                        type="button"
                        onClick={handleRemoveFile}
                        className="p-1.5 text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10 rounded-lg transition-all cursor-pointer"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                )}

                {resumeError && (
                  <p className="text-rose-500 text-[11px] font-semibold flex items-center gap-1 mt-1.5">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    {resumeError}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* STEP 3: ORGANIZATION & POSITION */}
          {step === 3 && (
            <div className="space-y-4">
              {/* Super Admin Company / Organization Selector */}
              {user?.role === 'SUPER_ADMIN' && (
                <div className="p-3.5 rounded-2xl bg-primary/5 border border-primary/20 space-y-1.5">
                  <label className="block text-xs font-extrabold text-foreground flex items-center gap-1.5">
                    <Building2 className="h-4 w-4 text-primary" />
                    <span>Target Organization / Tenant Company *</span>
                  </label>
                  <select
                    name="organizationId"
                    value={form.organizationId || ''}
                    onChange={handleChange}
                    className="w-full px-3 py-2 text-xs font-bold rounded-xl border border-primary/30 bg-background cursor-pointer focus:ring-2 focus:ring-primary/20"
                  >
                    {organizations.length === 0 ? (
                      <option value="">Loading Companies...</option>
                    ) : (
                      organizations.map(org => (
                        <option key={org.id} value={org.id} disabled={org.status === 'SUSPENDED'}>
                          {org.name} ({org.companyCode}) {org.status === 'SUSPENDED' ? '— [SUSPENDED]' : org.slug === 'innoveity' ? '— Default Tenant' : ''}
                        </option>
                      ))
                    )}
                  </select>
                  <p className="text-[11px] text-muted-foreground font-medium">
                    Super Admin assignment: Assign this employee/user to a tenant company (defaults to INNOVEITY).
                  </p>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-foreground mb-1">Department *</label>
                  <select
                    name="departmentId"
                    value={form.departmentId || ''}
                    onChange={handleChange}
                    className="w-full px-3 py-2 text-xs font-bold rounded-xl border border-border bg-card cursor-pointer"
                  >
                    <option value="">Select Department...</option>
                    {orgTree?.departments?.map(d => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-foreground mb-1">Career Position Level *</label>
                  <select
                    name="positionId"
                    value={form.positionId || ''}
                    onChange={handleChange}
                    className="w-full px-3 py-2 text-xs font-bold rounded-xl border border-border bg-card cursor-pointer"
                  >
                    <option value="">Unassigned (No Position)</option>
                    {orgTree?.positions?.map(pos => (
                      <option key={pos.id} value={pos.id}>
                        Level {pos.level} • {pos.name} ({pos.code})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Position Preview Badge */}
              {selectedPosition && (
                <div className="p-3 rounded-2xl bg-muted/40 border border-border/60 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className="px-3 py-1 rounded-full text-xs font-extrabold shadow-xs"
                      style={{ backgroundColor: selectedPosition.color, color: selectedPosition.textColor || '#FFFFFF' }}
                    >
                      {selectedPosition.name}
                    </span>
                    <span className="text-xs text-muted-foreground font-medium font-mono">({selectedPosition.code})</span>
                  </div>
                  <span className="text-[11px] font-bold text-primary">Hierarchy Rank: Level {selectedPosition.level}</span>
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 pt-2">
                <div>
                  <label className="block text-xs font-bold text-foreground mb-1">Reporting Manager</label>
                  <select
                    name="reportingManagerId"
                    value={form.reportingManagerId || ''}
                    onChange={handleChange}
                    className="w-full px-3 py-2 text-xs font-bold rounded-xl border border-border bg-card cursor-pointer"
                  >
                    <option value="">No Direct Manager (Self)</option>
                    {orgTree?.reportingManagers?.map(mgr => (
                      <option key={mgr.id} value={mgr.id}>
                        {mgr.name} ({mgr.role}) - {mgr.department || 'General'}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Allowed Attendance Locations */}
              <div className="space-y-2 pt-3 border-t border-border/40">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-bold text-foreground">
                    Allowed Attendance Locations
                  </label>
                  <span className="text-[10px] text-muted-foreground font-semibold">
                    {(form.attendanceLocationIds || []).length} assigned
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Select the physical company sites where this member is allowed to clock in:
                </p>

                {locations.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground italic p-2.5 rounded-xl bg-muted/20 border border-border/40">
                    No attendance locations configured for this company. Default office geofence will be used until locations are added in Site Settings.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 max-h-48 overflow-y-auto pr-1">
                    {locations.map((loc) => {
                      const isChecked = (form.attendanceLocationIds || []).includes(loc.id);
                      return (
                        <label
                          key={loc.id}
                          className={`flex items-start gap-2.5 p-2.5 rounded-2xl border cursor-pointer transition-all select-none ${
                            isChecked
                              ? 'bg-primary/10 border-primary/40 text-foreground font-semibold shadow-xs'
                              : 'bg-card border-border/60 hover:bg-muted/30 text-muted-foreground'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setForm(prev => {
                                const current = prev.attendanceLocationIds || [];
                                const updated = checked
                                  ? [...current, loc.id]
                                  : current.filter(id => id !== loc.id);
                                return { ...prev, attendanceLocationIds: updated };
                              });
                            }}
                            className="mt-0.5 h-4 w-4 rounded-md border-border text-primary focus:ring-primary/20 cursor-pointer"
                          />
                          <div className="text-left overflow-hidden">
                            <span className="text-xs font-bold text-foreground block truncate">{loc.name}</span>
                            <span className="text-[10px] text-muted-foreground block truncate">
                              {loc.address || `${loc.radiusMeters}m radius`}
                            </span>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Individual Auto Clock-Out Setting */}
              {['ADMIN', 'SUPER_ADMIN'].includes(user?.role) && (
                <div className="p-4 rounded-2xl border border-border/80 bg-muted/20 space-y-2 mt-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-start sm:items-center gap-2.5">
                      <div className={`p-2 rounded-xl shrink-0 transition-colors ${form.autoClockOutEnabled ? 'bg-orange-500/10 text-orange-600 dark:text-orange-400' : 'bg-slate-500/10 text-slate-500'}`}>
                        <Clock className="h-4 w-4" />
                      </div>
                      <div>
                        <span className="text-xs font-bold text-foreground block">
                          Auto Clock-Out Setting
                        </span>
                        <span className="text-[11px] text-muted-foreground leading-tight block">
                          Automatic shift-end checkout vs. manual device clock-out
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2.5 self-end sm:self-auto shrink-0">
                      <span className={`text-[10px] font-extrabold uppercase px-2.5 py-0.5 rounded-full ${
                        form.autoClockOutEnabled
                          ? 'bg-orange-500/15 text-orange-700 dark:text-orange-400 border border-orange-500/30'
                          : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700'
                      }`}>
                        {form.autoClockOutEnabled ? 'Enabled' : 'Disabled'}
                      </span>
                      <button
                        type="button"
                        id="auto-clock-out-toggle-btn"
                        onClick={() => setForm(prev => ({ ...prev, autoClockOutEnabled: !prev.autoClockOutEnabled }))}
                        className={`relative inline-flex h-6 w-11 p-0.5 shrink-0 items-center rounded-full transition-colors duration-200 ease-in-out cursor-pointer border focus:outline-none focus:ring-2 focus:ring-orange-500/30 ${
                          form.autoClockOutEnabled
                            ? 'bg-orange-500 border-orange-600 hover:bg-orange-600'
                            : 'bg-slate-300 border-slate-400 hover:bg-slate-350 dark:bg-slate-700 dark:border-slate-500 shadow-inner'
                        }`}
                        role="switch"
                        aria-checked={form.autoClockOutEnabled}
                        title={form.autoClockOutEnabled ? 'Disable Auto Clock-Out' : 'Enable Auto Clock-Out'}
                      >
                        <span
                          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-md border border-black/10 transition-transform duration-200 ease-in-out ${
                            form.autoClockOutEnabled ? 'translate-x-5' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed pt-1 border-t border-border/30">
                    {form.autoClockOutEnabled
                      ? 'Employee will be automatically clocked out at scheduled shift end without GPS capture.'
                      : 'Auto clock-out is disabled for this employee. The employee must manually clock out with device GPS location and geofence verification. A shift-end reminder will be sent.'}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Controls Footer */}
          <div className="flex items-center justify-between pt-4 border-t border-border/60">
            {step > 1 ? (
              <button
                type="button"
                onClick={handlePrev}
                className="flex items-center gap-1 px-4 py-2 rounded-xl border border-border text-xs font-bold text-foreground hover:bg-muted cursor-pointer"
              >
                <ChevronLeft className="h-4 w-4" />
                <span>Previous Step</span>
              </button>
            ) : <div />}

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-xs font-bold text-muted-foreground hover:bg-muted cursor-pointer"
              >
                Cancel
              </button>

              {step < 3 ? (
                <button
                  type="submit"
                  className="flex items-center gap-1 px-5 py-2 rounded-xl bg-primary text-white text-xs font-bold hover:bg-primary/90 shadow-md cursor-pointer"
                >
                  <span>Next Step</span>
                  <ChevronRight className="h-4 w-4" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={loading}
                  className="flex items-center gap-1.5 px-6 py-2 rounded-xl bg-primary hover:bg-primary-hover text-white text-xs font-extrabold shadow-md shadow-primary/20 cursor-pointer disabled:opacity-50"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  <span>{isEdit ? 'Save Changes' : 'Complete Onboarding'}</span>
                </button>
              )}
            </div>
          </div>
        </form>
      </motion.div>
    </div>
  );
};

export default UserWizardModal;
