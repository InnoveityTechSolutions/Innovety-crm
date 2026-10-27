import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import CompanyScopeSelector from '../components/common/CompanyScopeSelector';
import { useCompanyScope } from '../context/CompanyScopeContext';
import { usePermissions } from '../hooks/usePermissions';
import { CRM_MODULE_KEYS } from '../config/crmModules';
import api from '../services/api';
import {
  Folder,
  Plus,
  Search,
  Download,
  Eye,
  Trash2,
  FileText,
  FileSpreadsheet,
  Image as ImageIcon,
  File,
  AlertCircle,
  CheckCircle2,
  X,
  Upload,
  Calendar,
  Clock,
  User,
  ExternalLink,
  Loader2
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const CATEGORIES = [
  'Company Documents',
  'Legal Documents',
  'Licenses & Certificates',
  'Agreements',
  'Policies',
  'HR Documents',
  'Financial Documents',
  'Other'
];

const ALLOWED_EXTENSIONS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'jpg', 'jpeg', 'png'];

export default function CompanyDocuments() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

  const {
    selectedOrgId,
    effectiveOrgId,
    loading: orgsLoading
  } = useCompanyScope();

  const targetOrg = isSuperAdmin
    ? selectedOrgId
    : (effectiveOrgId || user?.organizationId);

  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [alert, setAlert] = useState(null);

  // Modals state
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [selectedDocForDelete, setSelectedDocForDelete] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Preview modal state
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [previewDoc, setPreviewDoc] = useState(null);
  const [previewBlobUrl, setPreviewBlobUrl] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Upload Form state
  const [uploadForm, setUploadForm] = useState({
    documentName: '',
    category: '',
    description: '',
    expiryDate: ''
  });
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const fileInputRef = useRef(null);

  // Dynamic Module Permissions
  const { canEdit: canEditPerm, canView: canViewPerm } = usePermissions();
  const canUpload = canEditPerm(CRM_MODULE_KEYS.COMPANY_DOCUMENTS);
  const canDelete = canEditPerm(CRM_MODULE_KEYS.COMPANY_DOCUMENTS);
  const canViewDoc = canViewPerm(CRM_MODULE_KEYS.COMPANY_DOCUMENTS);
  const canDownload = canViewPerm(CRM_MODULE_KEYS.COMPANY_DOCUMENTS);

  // Fetch Documents
  const fetchDocuments = async (overrideSearch) => {
    try {
      setLoading(true);
      const querySearch = overrideSearch !== undefined ? overrideSearch : search;
      const params = {};
      if (querySearch.trim()) params.search = querySearch.trim();
      if (categoryFilter && categoryFilter !== 'All Categories') {
        params.category = categoryFilter;
      }
      if (targetOrg) {
        params.organizationId = targetOrg;
      }

      const res = await api.get('/company-documents', { params });
      setDocuments(res.data.documents || []);
    } catch (err) {
      console.error('Failed to fetch documents:', err);
      showAlert('error', err.response?.data?.message || 'Failed to load company documents.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setDocuments([]);

    if (orgsLoading) return;

    fetchDocuments();
  }, [
    targetOrg,
    categoryFilter,
    user?.organizationId,
    orgsLoading
  ]);

  // Lock background body scroll when any modal is open
  useEffect(() => {
    if (uploadModalOpen || previewModalOpen || deleteModalOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [uploadModalOpen, previewModalOpen, deleteModalOpen]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    fetchDocuments();
  };

  const showAlert = (type, message) => {
    setAlert({ type, message });
    setTimeout(() => {
      setAlert(null);
    }, 4500);
  };

  // Expiry Status Calculation
  const getExpiryStatus = (expiryDate) => {
    if (!expiryDate) {
      return {
        label: 'No Expiry',
        variant: 'default',
        className: 'bg-muted text-muted-foreground border-border/40'
      };
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const expDate = new Date(expiryDate);
    expDate.setHours(0, 0, 0, 0);

    const diffTime = expDate - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
      return {
        label: 'EXPIRED',
        variant: 'destructive',
        className: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30'
      };
    }

    if (diffDays <= 30) {
      return {
        label: 'EXPIRING SOON',
        variant: 'warning',
        className: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30'
      };
    }

    return {
      label: 'ACTIVE',
      variant: 'success',
      className: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
    };
  };

  // Helper to format file size
  const formatFileSize = (bytes) => {
    if (!bytes && bytes !== 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  // Helper to get File Icon based on extension
  const getFileIcon = (fileType) => {
    const ext = (fileType || '').toLowerCase();
    if (ext === 'pdf') {
      return <FileText className="h-5 w-5 text-rose-500" />;
    }
    if (['doc', 'docx'].includes(ext)) {
      return <FileText className="h-5 w-5 text-blue-500" />;
    }
    if (['xls', 'xlsx'].includes(ext)) {
      return <FileSpreadsheet className="h-5 w-5 text-emerald-500" />;
    }
    if (['jpg', 'jpeg', 'png'].includes(ext)) {
      return <ImageIcon className="h-5 w-5 text-purple-500" />;
    }
    return <File className="h-5 w-5 text-muted-foreground" />;
  };

  // Handle File Selection in Upload Modal
  const handleFileChange = (e) => {
    const file = e.target.files[0];
    setUploadError('');
    if (!file) {
      setSelectedFile(null);
      return;
    }

    const ext = file.name.split('.').pop().toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      setUploadError(`Invalid file format ".${ext}". Allowed: PDF, DOC, DOCX, XLS, XLSX, JPG, JPEG, PNG.`);
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    // 15MB file size limit
    if (file.size > 15 * 1024 * 1024) {
      setUploadError('File size exceeds the 15MB limit.');
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setSelectedFile(file);
    // Auto-fill Document Name from file name if empty
    if (!uploadForm.documentName.trim()) {
      const cleanName = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
      setUploadForm((prev) => ({ ...prev, documentName: cleanName }));
    }
  };

  // Handle Upload Submission
  const handleUploadSubmit = async (e) => {
    e.preventDefault();
    setUploadError('');

    if (!uploadForm.documentName.trim()) {
      setUploadError('Document Name is required.');
      return;
    }
    if (!uploadForm.category.trim()) {
      setUploadError('Please select a document Category.');
      return;
    }
    if (!selectedFile) {
      setUploadError('Please choose a document file to upload.');
      return;
    }

    try {
      setUploading(true);
      const formData = new FormData();
      formData.append('documentName', uploadForm.documentName.trim());
      formData.append('category', uploadForm.category.trim());
      if (uploadForm.description.trim()) {
        formData.append('description', uploadForm.description.trim());
      }
      if (uploadForm.expiryDate) {
        formData.append('expiryDate', uploadForm.expiryDate);
      }
      if (targetOrg) {
        formData.append('organizationId', targetOrg);
      }
      formData.append('file', selectedFile);

      await api.post('/company-documents', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      showAlert('success', `Document "${uploadForm.documentName}" uploaded successfully.`);
      setUploadModalOpen(false);
      // Reset form
      setUploadForm({
        documentName: '',
        category: '',
        description: '',
        expiryDate: ''
      });
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';

      fetchDocuments();
    } catch (err) {
      console.error('Upload failed:', err);
      setUploadError(err.response?.data?.message || 'Failed to upload document.');
    } finally {
      setUploading(false);
    }
  };

  // Handle Download
  const handleDownload = async (doc) => {
    try {
      const response = await api.get(`/company-documents/${doc.id}/download`, {
        responseType: 'blob'
      });
      const blob = new Blob([response.data]);
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.setAttribute('download', doc.originalFileName || `${doc.documentName}.${(doc.fileType || 'bin').toLowerCase()}`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(downloadUrl);
    } catch (err) {
      console.error('Download failed:', err);
      showAlert('error', 'Failed to download document.');
    }
  };

  // Handle Preview
  const handleOpenPreview = async (doc) => {
    const ext = (doc.fileType || '').toLowerCase();
    const canInlinePreview = ['pdf', 'jpg', 'jpeg', 'png'].includes(ext);

    setPreviewDoc(doc);
    setPreviewModalOpen(true);
    setPreviewLoading(true);

    if (previewBlobUrl) {
      window.URL.revokeObjectURL(previewBlobUrl);
      setPreviewBlobUrl(null);
    }

    if (canInlinePreview) {
      try {
        const response = await api.get(`/company-documents/${doc.id}/view`, {
          responseType: 'blob'
        });
        const contentType = response.headers['content-type'] || (ext === 'pdf' ? 'application/pdf' : 'image/jpeg');
        const blob = new Blob([response.data], { type: contentType });
        const blobUrl = window.URL.createObjectURL(blob);
        setPreviewBlobUrl(blobUrl);
      } catch (err) {
        console.error('Preview load failed:', err);
        showAlert('error', 'Could not load preview for document.');
      } finally {
        setPreviewLoading(false);
      }
    } else {
      setPreviewLoading(false);
    }
  };

  const handleClosePreview = () => {
    setPreviewModalOpen(false);
    if (previewBlobUrl) {
      window.URL.revokeObjectURL(previewBlobUrl);
      setPreviewBlobUrl(null);
    }
    setPreviewDoc(null);
  };

  // Handle Delete Confirmation
  const handleConfirmDelete = async () => {
    if (!selectedDocForDelete) return;

    try {
      setIsDeleting(true);
      await api.delete(`/company-documents/${selectedDocForDelete.id}`);
      showAlert('success', `Document "${selectedDocForDelete.documentName}" deleted successfully.`);
      setDeleteModalOpen(false);
      setSelectedDocForDelete(null);
      fetchDocuments();
    } catch (err) {
      console.error('Delete failed:', err);
      showAlert('error', err.response?.data?.message || 'Failed to delete document.');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="w-full space-y-5 sm:space-y-6 animate-in fade-in duration-300">
      {/* Super Admin Company Scope Selector */}
      <CompanyScopeSelector />

      {/* Alert Notification */}
      <AnimatePresence>
        {alert && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className={`flex items-center gap-3 p-4 rounded-xl border text-sm font-semibold shadow-sm ${
              alert.type === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                : 'bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400'
            }`}
          >
            {alert.type === 'success' ? <CheckCircle2 className="h-5 w-5 shrink-0" /> : <AlertCircle className="h-5 w-5 shrink-0" />}
            <span>{alert.message}</span>
            <button onClick={() => setAlert(null)} className="ml-auto p-1 hover:opacity-70">
              <X className="h-4 w-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-border/40 pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 rounded-xl bg-primary/10 border border-primary/20 text-primary">
              <Folder className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-black text-foreground tracking-tight">Company Documents</h1>
              <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
                Centralized repository for corporate, legal, and operational documents.
              </p>
            </div>
          </div>
        </div>

        {canUpload && (
          <button
            onClick={() => {
              setUploadError('');
              setUploadModalOpen(true);
            }}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-xs sm:text-sm font-bold shadow-md shadow-primary/20 transition-all active:scale-95"
          >
            <Plus className="h-4 w-4" />
            <span>Upload Document</span>
          </button>
        )}
      </div>

      {/* Toolbar: Search and Filter */}
      <div className="bg-card p-4 rounded-2xl border border-border/60 shadow-sm flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
        {/* Search */}
        <form onSubmit={handleSearchSubmit} className="relative flex-1 max-w-2xl">
          <Search className="absolute left-3.5 top-3 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search documents by name, description..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-8 py-2 bg-background border border-border/70 rounded-xl text-xs sm:text-sm focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
          />
          {search && (
            <button
              type="button"
              onClick={() => {
                setSearch('');
                fetchDocuments('');
              }}
              className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </form>

        {/* Category Filter */}
        <div className="flex items-center gap-2 shrink-0">
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="w-full sm:w-auto min-w-[210px] bg-background border border-border/70 rounded-xl px-3.5 py-2 text-xs sm:text-sm font-medium focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
          >
            <option value="">All Categories</option>
            {CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Documents Table */}
      <div className="bg-card rounded-2xl border border-border/60 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs sm:text-sm">
            <thead>
              <tr className="border-b border-border/60 bg-muted/40 text-[11px] font-black uppercase tracking-wider text-muted-foreground">
                <th className="px-5 py-3.5">Document Name</th>
                <th className="px-4 py-3.5">Category</th>
                <th className="px-4 py-3.5">Uploaded By</th>
                <th className="px-4 py-3.5">Upload Date</th>
                <th className="px-4 py-3.5">Expiry</th>
                <th className="px-4 py-3.5">Status</th>
                <th className="px-5 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-16 text-center text-muted-foreground">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <Loader2 className="h-6 w-6 animate-spin text-primary" />
                      <span className="text-xs font-semibold">Loading documents...</span>
                    </div>
                  </td>
                </tr>
              ) : documents.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-16 text-center text-muted-foreground">
                    <div className="flex flex-col items-center justify-center gap-2 max-w-sm mx-auto">
                      <div className="p-3 rounded-2xl bg-muted/60 text-muted-foreground">
                        <Folder className="h-8 w-8 stroke-[1.5]" />
                      </div>
                      <span className="text-sm font-bold text-foreground mt-1">No company documents found.</span>
                      <p className="text-xs text-muted-foreground">
                        {search || categoryFilter
                          ? 'Try adjusting your search criteria or category filter.'
                          : 'Get started by uploading your first company document.'}
                      </p>
                      {canUpload && !search && !categoryFilter && (
                        <button
                          onClick={() => setUploadModalOpen(true)}
                          className="mt-3 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-bold"
                        >
                          + Upload Document
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                documents.map((doc) => {
                  const status = getExpiryStatus(doc.expiryDate);
                  return (
                    <tr
                      key={doc.id}
                      className="hover:bg-muted/30 transition-colors group"
                    >
                      {/* Document Name */}
                      <td className="px-5 py-3.5">
                        <div className="flex items-start gap-3">
                          <div className="p-2 rounded-xl bg-background border border-border/70 shrink-0 mt-0.5 shadow-xs">
                            {getFileIcon(doc.fileType)}
                          </div>
                          <div className="min-w-0">
                            <span className="font-bold text-foreground block truncate max-w-sm sm:max-w-lg lg:max-w-xl xl:max-w-2xl">
                              {doc.documentName}
                            </span>
                            <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground">
                              <span className="font-mono uppercase font-bold text-primary">{doc.fileType}</span>
                              <span>•</span>
                              <span>{formatFileSize(doc.fileSize)}</span>
                              {doc.description && (
                                <>
                                  <span>•</span>
                                  <span className="truncate max-w-[200px] sm:max-w-[320px] lg:max-w-[480px] text-muted-foreground/80" title={doc.description}>
                                    {doc.description}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Category */}
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold bg-muted/60 text-foreground border border-border/40">
                          {doc.category}
                        </span>
                      </td>

                      {/* Uploaded By */}
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center text-primary font-black text-[10px]">
                            {(doc.uploadedBy?.name || 'U').charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <span className="font-medium text-foreground text-xs block">
                              {doc.uploadedBy?.name || 'Unknown'}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* Upload Date */}
                      <td className="px-4 py-3.5 whitespace-nowrap text-muted-foreground text-xs font-medium">
                        {new Date(doc.createdAt).toLocaleDateString('en-US', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric'
                        })}
                      </td>

                      {/* Expiry */}
                      <td className="px-4 py-3.5 whitespace-nowrap text-xs font-medium">
                        {doc.expiryDate ? (
                          <span className="text-foreground">
                            {new Date(doc.expiryDate).toLocaleDateString('en-US', {
                              year: 'numeric',
                              month: 'short',
                              day: 'numeric'
                            })}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/70">—</span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black tracking-wide border ${status.className}`}
                        >
                          {status.label}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="px-5 py-3.5 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1">
                          {canViewDoc && (
                            <button
                              onClick={() => handleOpenPreview(doc)}
                              className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-all"
                              title="View Document"
                            >
                              <Eye className="h-4 w-4" />
                            </button>
                          )}

                          {canDownload && (
                            <button
                              onClick={() => handleDownload(doc)}
                              className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-all"
                              title="Download Original File"
                            >
                              <Download className="h-4 w-4" />
                            </button>
                          )}

                          {canDelete && (
                            <button
                              onClick={() => {
                                setSelectedDocForDelete(doc);
                                setDeleteModalOpen(true);
                              }}
                              className="p-1.5 rounded-lg hover:bg-rose-500/10 text-muted-foreground hover:text-rose-600 transition-all"
                              title="Delete Document"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ======================================================= */}
      {/* 1. UPLOAD DOCUMENT MODAL                                */}
      {/* ======================================================= */}
      <AnimatePresence>
        {uploadModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-4 overflow-hidden">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-card w-full max-w-lg max-h-[90vh] rounded-2xl border border-border/60 shadow-2xl overflow-hidden flex flex-col"
            >
              {/* Upload Form wrapping flex column */}
              <form onSubmit={handleUploadSubmit} className="flex flex-col flex-1 min-h-0 overflow-hidden">
                {/* 1. Fixed Modal Header */}
                <div className="flex items-center justify-between border-b border-border/40 px-5 sm:px-6 py-3.5 sm:py-4 bg-muted/20 shrink-0">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="p-2 rounded-xl bg-primary/10 text-primary shrink-0">
                      <Upload className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-sm sm:text-base font-bold text-foreground truncate">Upload Company Document</h3>
                      <p className="text-[11px] sm:text-xs text-muted-foreground truncate">Add a new document to the organization repository</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setUploadModalOpen(false)}
                    className="p-1 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground shrink-0 transition-colors"
                    title="Close"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                {/* 2. Scrollable Form Content Body */}
                <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4">
                  {uploadError && (
                    <div className="flex items-center gap-2 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 text-xs font-semibold">
                      <AlertCircle className="h-4 w-4 shrink-0" />
                      <span>{uploadError}</span>
                    </div>
                  )}

                  {/* Document Name */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block">
                      Document Name *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Certificate of Incorporation"
                      value={uploadForm.documentName}
                      onChange={(e) => setUploadForm({ ...uploadForm, documentName: e.target.value })}
                      className="w-full px-3.5 py-2.5 bg-background border border-border/70 rounded-xl text-xs sm:text-sm focus:border-primary focus:ring-2 focus:ring-primary/20"
                    />
                  </div>

                  {/* Category */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block">
                      Category *
                    </label>
                    <select
                      required
                      value={uploadForm.category}
                      onChange={(e) => setUploadForm({ ...uploadForm, category: e.target.value })}
                      className="w-full px-3.5 py-2.5 bg-background border border-border/70 rounded-xl text-xs sm:text-sm focus:border-primary focus:ring-2 focus:ring-primary/20 font-medium"
                    >
                      <option value="">Select Document Category...</option>
                      {CATEGORIES.map((cat) => (
                        <option key={cat} value={cat}>
                          {cat}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Description */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block">
                      Description (optional)
                    </label>
                    <textarea
                      rows={2}
                      placeholder="Brief description or context about this document..."
                      value={uploadForm.description}
                      onChange={(e) => setUploadForm({ ...uploadForm, description: e.target.value })}
                      className="w-full px-3.5 py-2 bg-background border border-border/70 rounded-xl text-xs sm:text-sm focus:border-primary focus:ring-2 focus:ring-primary/20"
                    />
                  </div>

                  {/* Document File Input */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block">
                      Document File *
                    </label>
                    <div className="border-2 border-dashed border-border/70 hover:border-primary/50 rounded-2xl p-4 text-center bg-background/50 transition-colors">
                      <input
                        ref={fileInputRef}
                        type="file"
                        id="doc-file-input"
                        required
                        accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png"
                        onChange={handleFileChange}
                        className="hidden"
                      />
                      <label htmlFor="doc-file-input" className="cursor-pointer flex flex-col items-center justify-center gap-2">
                        <div className="p-2.5 rounded-full bg-primary/10 text-primary">
                          <Upload className="h-5 w-5" />
                        </div>
                        {selectedFile ? (
                          <div>
                            <span className="text-xs font-bold text-foreground block truncate max-w-xs">{selectedFile.name}</span>
                            <span className="text-[11px] text-muted-foreground">{formatFileSize(selectedFile.size)}</span>
                          </div>
                        ) : (
                          <div>
                            <span className="text-xs font-bold text-primary hover:underline block">Choose document file</span>
                            <span className="text-[11px] text-muted-foreground mt-0.5 block">
                              PDF, DOC, DOCX, XLS, XLSX, JPG, JPEG, PNG (Max 15MB)
                            </span>
                          </div>
                        )}
                      </label>
                    </div>
                  </div>

                  {/* Expiry Date */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block">
                      Expiry Date (optional)
                    </label>
                    <input
                      type="date"
                      value={uploadForm.expiryDate}
                      onChange={(e) => setUploadForm({ ...uploadForm, expiryDate: e.target.value })}
                      className="w-full px-3.5 py-2.5 bg-background border border-border/70 rounded-xl text-xs sm:text-sm focus:border-primary focus:ring-2 focus:ring-primary/20"
                    />
                    <p className="text-[11px] text-muted-foreground">Leave blank if the document has no expiration date.</p>
                  </div>
                </div>

                {/* 3. Fixed Modal Footer Action Buttons */}
                <div className="flex items-center justify-end gap-2.5 px-5 sm:px-6 py-3.5 border-t border-border/40 bg-muted/20 shrink-0">
                  <button
                    type="button"
                    onClick={() => setUploadModalOpen(false)}
                    className="px-4 py-2 rounded-xl border border-border/70 text-xs font-bold hover:bg-muted transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={uploading}
                    className="px-4 py-2 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-bold shadow-md shadow-primary/20 flex items-center gap-1.5 transition-all disabled:opacity-50"
                  >
                    {uploading && <Loader2 className="h-4 w-4 animate-spin" />}
                    <span>{uploading ? 'Uploading...' : 'Upload Document'}</span>
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ======================================================= */}
      {/* 2. VIEW / PREVIEW MODAL                                 */}
      {/* ======================================================= */}
      <AnimatePresence>
        {previewModalOpen && previewDoc && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 overflow-y-auto">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-card w-full max-w-4xl rounded-2xl border border-border/60 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b border-border/40 px-5 py-3.5 bg-muted/20">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="p-1.5 rounded-lg bg-background border border-border/60 shrink-0">
                    {getFileIcon(previewDoc.fileType)}
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-bold text-foreground truncate">{previewDoc.documentName}</h3>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {previewDoc.originalFileName} ({formatFileSize(previewDoc.fileSize)})
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => handleDownload(previewDoc)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-bold shadow-sm"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>Download</span>
                  </button>
                  <button
                    onClick={handleClosePreview}
                    className="p-1 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </div>

              {/* Preview Content */}
              <div className="flex-1 p-4 bg-muted/10 overflow-y-auto min-h-[350px] flex items-center justify-center">
                {previewLoading ? (
                  <div className="flex flex-col items-center justify-center gap-2 py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    <span className="text-xs font-bold text-muted-foreground">Loading preview...</span>
                  </div>
                ) : ['jpg', 'jpeg', 'png'].includes((previewDoc.fileType || '').toLowerCase()) && previewBlobUrl ? (
                  <div className="max-h-[70vh] flex items-center justify-center">
                    <img
                      src={previewBlobUrl}
                      alt={previewDoc.documentName}
                      className="max-h-[70vh] max-w-full rounded-xl object-contain shadow-md"
                    />
                  </div>
                ) : (previewDoc.fileType || '').toLowerCase() === 'pdf' && previewBlobUrl ? (
                  <iframe
                    src={previewBlobUrl}
                    title={previewDoc.documentName}
                    className="w-full h-[70vh] rounded-xl border border-border/60 bg-white"
                  />
                ) : (
                  /* Word / Excel or unsupported inline preview */
                  <div className="text-center p-8 max-w-md mx-auto space-y-3">
                    <div className="p-4 rounded-2xl bg-muted/60 inline-flex text-muted-foreground mb-1">
                      {getFileIcon(previewDoc.fileType)}
                    </div>
                    <h4 className="text-base font-bold text-foreground">In-browser preview not supported</h4>
                    <p className="text-xs text-muted-foreground">
                      Document format ({previewDoc.fileType}) cannot be directly previewed in the browser. Please download the file to inspect its contents.
                    </p>
                    <button
                      onClick={() => handleDownload(previewDoc)}
                      className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-bold shadow-md"
                    >
                      <Download className="h-4 w-4" />
                      <span>Download {previewDoc.originalFileName}</span>
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ======================================================= */}
      {/* 3. DELETE CONFIRMATION MODAL                            */}
      {/* ======================================================= */}
      <AnimatePresence>
        {deleteModalOpen && selectedDocForDelete && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-card w-full max-w-md rounded-2xl border border-border/60 shadow-2xl p-6 space-y-4"
            >
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-2xl bg-rose-500/10 text-rose-600 dark:text-rose-400">
                  <Trash2 className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-foreground">Delete Document?</h3>
                  <p className="text-xs text-muted-foreground">Are you sure you want to delete this document?</p>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-muted/40 border border-border/40 text-xs">
                <span className="font-bold text-foreground block truncate">{selectedDocForDelete.documentName}</span>
                <span className="text-muted-foreground block text-[11px] mt-0.5">
                  Category: {selectedDocForDelete.category} • {formatFileSize(selectedDocForDelete.fileSize)}
                </span>
              </div>

              <p className="text-xs text-muted-foreground">
                This action cannot be undone. The database record and the stored file will be permanently deleted from the server.
              </p>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setDeleteModalOpen(false);
                    setSelectedDocForDelete(null);
                  }}
                  className="px-4 py-2 rounded-xl border border-border/70 text-xs font-bold hover:bg-muted transition-all"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={handleConfirmDelete}
                  className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-md shadow-rose-600/20 flex items-center gap-1.5 transition-all disabled:opacity-50"
                >
                  {isDeleting && <Loader2 className="h-4 w-4 animate-spin" />}
                  <span>{isDeleting ? 'Deleting...' : 'Delete Document'}</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
