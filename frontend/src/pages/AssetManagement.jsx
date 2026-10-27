import React, { useState, useEffect, useRef, useCallback } from 'react';
import api, { getUploadUrl } from '../services/api';
import { useAuth } from '../context/AuthContext';
import UserAvatar from '../components/common/UserAvatar';
import CompanyScopeSelector from '../components/common/CompanyScopeSelector';
import { useCompanyScope } from '../context/CompanyScopeContext';
import { usePermissions } from '../hooks/usePermissions';
import { CRM_MODULE_KEYS } from '../config/crmModules';
import { motion } from 'framer-motion';
import CreateEstimateModal from '../components/assets/CreateEstimateModal';
import EstimateHistorySection from '../components/assets/EstimateHistorySection';
import {
  Laptop,
  Plus,
  Search,
  Filter,
  Trash2,
  Download,
  MoreVertical,
  X,
  CheckCircle,
  AlertCircle,
  Edit2,
  Eye,
  UserCheck,
  Building2,
  Calendar,
  Clock,
  ShieldCheck,
  Tag,
  DollarSign,
  MapPin,
  RefreshCw,
  CornerUpLeft,
  FileText,
  Wrench,
  AlertTriangle,
  Upload,
  Image as ImageIcon
} from 'lucide-react';

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.08 } }
};

const itemVariants = {
  hidden: { opacity: 0, y: 15 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.25, ease: 'easeOut' } }
};

const CATEGORY_GROUPS = [
  'Tangible Assets',
  'Intangible Assets',
  'Other'
];

const TANGIBLE_TYPES = [
  'Land',
  'Buildings',
  'Plant and Machinery',
  'Furniture and Fixtures',
  'Vehicles',
  'Office Equipment',
  'Computers and Peripherals',
  'Electrical Installations'
];

const INTANGIBLE_TYPES = [
  'Goodwill',
  'Brands',
  'Trademarks',
  'Computer Software',
  'Patents',
  'Copyrights',
  'Mining Rights'
];

const AssetManagement = () => {
  const { user } = useAuth();
  const { canEdit } = usePermissions();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const canEditAssets = isSuperAdmin || canEdit(CRM_MODULE_KEYS.ASSETS);
  const isManagementRole = ['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(user?.role) && canEditAssets;
  const { selectedOrgId, effectiveOrgId, loading: orgsLoading } = useCompanyScope();
  const targetOrg = isSuperAdmin ? selectedOrgId : (effectiveOrgId || user?.organizationId);
  const selectedOrgIdRef = useRef(targetOrg);

  const [assets, setAssets] = useState([]);
  const [assetStats, setAssetStats] = useState({ totalAssets: 0, availableAssets: 0, assignedAssets: 0, maintenanceAssets: 0 });
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [brandFilter, setBrandFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [alertMsg, setAlertMsg] = useState({ type: '', text: '' });

  // Navigation tab: 'inventory' | 'history'
  const [activeTab, setActiveTab] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('tab') === 'history' ? 'history' : 'inventory';
  });

  // Category selection states
  const [selectedCategoryGroup, setSelectedCategoryGroup] = useState('');
  const [selectedAssetType, setSelectedAssetType] = useState('');
  const [customCategoryInput, setCustomCategoryInput] = useState('');
  const [customCategoriesList, setCustomCategoriesList] = useState([]);
  const [previewAssetId, setPreviewAssetId] = useState('');
  const [bulkSerialNumbers, setBulkSerialNumbers] = useState(['']);
  const [serialNumberErrors, setSerialNumberErrors] = useState({});

  // Users list for assignment dropdown
  const [allUsers, setAllUsers] = useState([]);

  // Modals state
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [returnModalOpen, setReturnModalOpen] = useState(false);
  const [billModalOpen, setBillModalOpen] = useState(false);
  const [detailsModalAsset, setDetailsModalAsset] = useState(null);
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [billFile, setBillFile] = useState(null);

  // Estimate Generation state
  const [selectedAssetIds, setSelectedAssetIds] = useState([]);
  const [estimateModalOpen, setEstimateModalOpen] = useState(false);

  // Form states

  const [assetForm, setAssetForm] = useState({
    name: '',
    category: '',
    quantity: 1,
    brand: '',
    model: '',
    serialNumber: '',
    purchaseDate: '',
    warrantyExpiry: '',
    cost: '',
    vendor: '',
    location: '',
    status: 'AVAILABLE',
    description: ''
  });

  const [assignForm, setAssignForm] = useState({
    userId: '',
    expectedReturn: '',
    notes: ''
  });

  const [returnForm, setReturnForm] = useState({
    returnDate: new Date().toISOString().split('T')[0],
    conditionOnReturn: 'Good',
    remarks: ''
  });

  // Confirmation Modal
  const [confirmModal, setConfirmModal] = useState({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: null
  });

  const toggleSelectAsset = (assetId) => {
    setSelectedAssetIds((prev) =>
      prev.includes(assetId) ? prev.filter((id) => id !== assetId) : [...prev, assetId]
    );
  };

  const toggleSelectAll = () => {
    if (assets.length > 0 && selectedAssetIds.length === assets.length) {
      setSelectedAssetIds([]);
    } else {
      setSelectedAssetIds(assets.map((a) => a.id));
    }
  };

  const clearSelectedAssets = () => {
    setSelectedAssetIds([]);
  };

  const getFinalCategoryToSave = () => {
    if (selectedCategoryGroup === 'Tangible Assets') {
      return selectedAssetType.trim();
    }
    if (selectedCategoryGroup === 'Intangible Assets') {
      return selectedAssetType.trim();
    }
    if (selectedCategoryGroup === 'Other') {
      const trimmed = customCategoryInput.trim();
      if (trimmed) {
        if (!customCategoriesList.includes(trimmed)) {
          setCustomCategoriesList((prev) => [...prev, trimmed]);
        }
        return trimmed;
      }
      return 'Other';
    }
    return assetForm.category || 'Other';
  };

  const fetchAssets = async () => {
    try {
      setLoading(true);
      const targetOrg = selectedOrgIdRef.current || selectedOrgId;
      const res = await api.get('/assets', {
        params: {
          page,
          search,
          category: categoryFilter,
          status: statusFilter,
          brand: brandFilter,
          limit: 15,
          organizationId: targetOrg
        }
      });
      const fetchedAssets = res.data.assets || [];
      setAssets(fetchedAssets);
      setTotalCount(res.data.meta?.totalCount || 0);

      // Collect custom categories from database assets
      const sourceCategories = (res.data.categories && res.data.categories.length > 0)
        ? res.data.categories
        : fetchedAssets.map((a) => a.category);
      const dbCategories = sourceCategories.filter(
        (c) =>
          c &&
          !TANGIBLE_TYPES.some((t) => t.toLowerCase() === c.toLowerCase()) &&
          !INTANGIBLE_TYPES.some((it) => it.toLowerCase() === c.toLowerCase())
      );
      if (dbCategories.length > 0) {
        setCustomCategoriesList((prev) => Array.from(new Set([...prev, ...dbCategories])));
      }

      setLoading(false);
    } catch (err) {
      console.error(err);
      setAlertMsg({ type: 'error', text: err.response?.data?.message || 'Failed to fetch assets.' });
      setLoading(false);
    }
  };

  const fetchUsers = async () => {
    try {
      const targetOrg = selectedOrgIdRef.current || selectedOrgId;
      const params = { limit: 1000, status: 'ACTIVE' };
      if (targetOrg) params.organizationId = targetOrg;
      const res = await api.get('/users', { params });
      setAllUsers(res.data.users || []);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchAssetAnalytics = async () => {
    if (!['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(user?.role)) return;
    try {
      const targetOrg = selectedOrgIdRef.current || selectedOrgId;
      const params = targetOrg ? { organizationId: targetOrg } : {};
      const res = await api.get('/assets/analytics', { params });
      if (res.data) {
        setAssetStats({
          totalAssets: res.data.totalAssets || 0,
          availableAssets: res.data.availableAssets || 0,
          assignedAssets: res.data.assignedAssets || 0
        });
      }
    } catch (err) {
      console.error('Failed to fetch asset analytics:', err);
    }
  };

  const fetchNextAssetId = useCallback(async () => {
    try {
      const target = selectedOrgIdRef.current || selectedOrgId;
      const res = await api.get('/assets/next-id', {
        params: target ? { organizationId: target } : {}
      });
      if (res.data?.nextAssetId) {
        setPreviewAssetId(res.data.nextAssetId);
      }
    } catch (err) {
      console.error('Failed to preview next asset ID:', err);
    }
  }, [selectedOrgId]);

  useEffect(() => {
    selectedOrgIdRef.current = targetOrg;
    setAssets([]);
    if (orgsLoading) return;
    fetchAssets();
    fetchUsers();
    if (isManagementRole) {
      fetchAssetAnalytics();
    }
  }, [page, statusFilter, categoryFilter, brandFilter, targetOrg, user?.organizationId, orgsLoading]);

  useEffect(() => {
    if (createModalOpen) {
      fetchNextAssetId();
    }
  }, [createModalOpen, fetchNextAssetId]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    setPage(1);
    fetchAssets();
  };

  const handleQuantityChange = (val) => {
    setAssetForm((prev) => ({ ...prev, quantity: val }));
    setSerialNumberErrors({});
    const qty = parseInt(val, 10);
    if (!isNaN(qty) && qty >= 1) {
      setBulkSerialNumbers((prev) => {
        const next = [...prev];
        if (qty === 1) {
          const firstVal = next.length > 0 && next[0] ? next[0] : (assetForm.serialNumber || '');
          setAssetForm((f) => ({ ...f, serialNumber: firstVal }));
          return [firstVal];
        }
        while (next.length < qty) {
          next.push('');
        }
        return next.slice(0, qty);
      });
    }
  };

  const handleBulkSerialChange = (index, value) => {
    setBulkSerialNumbers((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
    if (index === 0) {
      setAssetForm((prev) => ({ ...prev, serialNumber: value }));
    }
    setSerialNumberErrors((prev) => {
      const next = { ...prev };
      delete next[index];
      return next;
    });
  };

  const resetForm = () => {
    setSelectedCategoryGroup('');
    setSelectedAssetType('');
    setCustomCategoryInput('');
    setBulkSerialNumbers(['']);
    setSerialNumberErrors({});
    setAssetForm({
      name: '',
      category: '',
      quantity: 1,
      brand: '',
      model: '',
      serialNumber: '',
      purchaseDate: '',
      warrantyExpiry: '',
      cost: '',
      vendor: '',
      location: '',
      status: 'AVAILABLE',
      description: ''
    });
  };

  const handleCreateSubmit = async (e) => {
    e.preventDefault();

    // Category and Asset Type Validation
    if (!selectedCategoryGroup) {
      setAlertMsg({ type: 'error', text: 'Category is required.' });
      return;
    }
    if (selectedCategoryGroup === 'Tangible Assets' && !selectedAssetType) {
      setAlertMsg({ type: 'error', text: 'Asset Type is required for Tangible Assets.' });
      return;
    }
    if (selectedCategoryGroup === 'Intangible Assets' && !selectedAssetType) {
      setAlertMsg({ type: 'error', text: 'Asset Type is required for Intangible Assets.' });
      return;
    }
    if (selectedCategoryGroup === 'Other' && !customCategoryInput.trim()) {
      setAlertMsg({ type: 'error', text: 'Custom category is required for Other.' });
      return;
    }

    const qty = parseInt(assetForm.quantity, 10);
    if (isNaN(qty) || qty < 1 || qty > 500) {
      setAlertMsg({ type: 'error', text: 'Quantity must be a valid integer between 1 and 500.' });
      return;
    }

    if (qty >= 2) {
      const errors = {};
      const trimmedList = bulkSerialNumbers.map((s) => (s || '').trim());

      trimmedList.forEach((s, idx) => {
        if (!s) {
          errors[idx] = 'Required';
        }
      });

      const seen = new Map();
      trimmedList.forEach((s, idx) => {
        if (s) {
          if (seen.has(s)) {
            errors[idx] = 'Duplicate';
            errors[seen.get(s)] = 'Duplicate';
          } else {
            seen.set(s, idx);
          }
        }
      });

      if (Object.keys(errors).length > 0) {
        setSerialNumberErrors(errors);
        const hasDuplicates = Object.values(errors).includes('Duplicate');
        const msg = hasDuplicates
          ? 'Serial numbers must be unique.'
          : 'Every serial number is required.';
        setAlertMsg({ type: 'error', text: msg });
        return;
      }
    }

    try {
      setLoading(true);
      const finalCategory = getFinalCategoryToSave();
      const formData = new FormData();
      Object.keys(assetForm).forEach((key) => {
        if (key === 'category') {
          formData.append('category', finalCategory);
        } else if (key === 'quantity') {
          formData.append('quantity', qty);
        } else if (key !== 'serialNumber') {
          formData.append(key, assetForm[key]);
        }
      });

      if (qty >= 2) {
        const trimmedList = bulkSerialNumbers.map((s) => (s || '').trim());
        formData.append('serialNumbers', JSON.stringify(trimmedList));
      } else {
        const singleSn = (assetForm.serialNumber || bulkSerialNumbers[0] || '').trim();
        formData.append('serialNumber', singleSn);
        formData.append('serialNumbers', JSON.stringify([singleSn]));
      }

      const targetOrg = selectedOrgIdRef.current || selectedOrgId;
      if (targetOrg) {
        formData.append('organizationId', targetOrg);
      }
      if (billFile) {
        formData.append('billPhoto', billFile);
      }

      const res = await api.post('/assets', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      const createdCount = res.data?.created || qty || 1;
      const createdId = res.data?.assetId ? ` (${res.data.assetId})` : '';
      setCreateModalOpen(false);
      resetForm();
      setBillFile(null);
      setAlertMsg({ type: 'success', text: `${createdCount} ${createdCount === 1 ? 'asset' : 'assets'} added successfully${createdId}.` });
      fetchAssets();
      fetchAssetAnalytics();
      fetchNextAssetId();
    } catch (err) {
      setAlertMsg({ type: 'error', text: err.response?.data?.message || 'Failed to create asset.' });
      setLoading(false);
    }
  };

  const openEditModal = (asset) => {
    setSelectedAsset(asset);
    const existingCat = (asset.category || '').trim();

    const matchingTangible = TANGIBLE_TYPES.find(
      (t) => t.toLowerCase() === existingCat.toLowerCase()
    );
    const matchingIntangible = INTANGIBLE_TYPES.find(
      (it) => it.toLowerCase() === existingCat.toLowerCase()
    );

    if (matchingTangible) {
      setSelectedCategoryGroup('Tangible Assets');
      setSelectedAssetType(matchingTangible);
      setCustomCategoryInput('');
    } else if (matchingIntangible) {
      setSelectedCategoryGroup('Intangible Assets');
      setSelectedAssetType(matchingIntangible);
      setCustomCategoryInput('');
    } else if (existingCat.toLowerCase() === 'tangible assets') {
      setSelectedCategoryGroup('Tangible Assets');
      setSelectedAssetType('');
      setCustomCategoryInput('');
    } else if (existingCat.toLowerCase() === 'intangible assets') {
      setSelectedCategoryGroup('Intangible Assets');
      setSelectedAssetType('');
      setCustomCategoryInput('');
    } else {
      // Custom category or legacy category (e.g. LAPTOP, DESKTOP, Camera, CCTV)
      setSelectedCategoryGroup('Other');
      setSelectedAssetType('');
      setCustomCategoryInput(existingCat);
    }

    setAssetForm({
      name: asset.name || '',
      category: existingCat,
      brand: asset.brand || '',
      model: asset.model || '',
      serialNumber: asset.serialNumber || '',
      purchaseDate: asset.purchaseDate ? asset.purchaseDate.split('T')[0] : '',
      warrantyExpiry: asset.warrantyExpiry ? asset.warrantyExpiry.split('T')[0] : '',
      cost: asset.cost ? String(asset.cost) : '',
      vendor: asset.vendor || '',
      location: asset.location || '',
      status: asset.status || 'AVAILABLE',
      description: asset.description || ''
    });
    setEditModalOpen(true);
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();

    // Category and Asset Type Validation
    if (!selectedCategoryGroup) {
      setAlertMsg({ type: 'error', text: 'Category is required.' });
      return;
    }
    if (selectedCategoryGroup === 'Tangible Assets' && !selectedAssetType) {
      setAlertMsg({ type: 'error', text: 'Asset Type is required for Tangible Assets.' });
      return;
    }
    if (selectedCategoryGroup === 'Intangible Assets' && !selectedAssetType) {
      setAlertMsg({ type: 'error', text: 'Asset Type is required for Intangible Assets.' });
      return;
    }
    if (selectedCategoryGroup === 'Other' && !customCategoryInput.trim()) {
      setAlertMsg({ type: 'error', text: 'Custom category is required for Other.' });
      return;
    }

    try {
      setLoading(true);
      const finalCategory = getFinalCategoryToSave();
      const formData = new FormData();
      Object.keys(assetForm).forEach((key) => {
        if (key === 'category') {
          formData.append('category', finalCategory);
        } else {
          formData.append(key, assetForm[key]);
        }
      });
      if (billFile) {
        formData.append('billPhoto', billFile);
      }
      await api.put(`/assets/${selectedAsset.id}`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setEditModalOpen(false);
      setSelectedAsset(null);
      setBillFile(null);
      resetForm();
      setAlertMsg({ type: 'success', text: 'Asset details updated successfully.' });
      fetchAssets();
      fetchAssetAnalytics();
    } catch (err) {
      setAlertMsg({ type: 'error', text: err.response?.data?.message || 'Failed to update asset.' });
      setLoading(false);
    }
  };

  const openBillModal = (asset) => {
    setSelectedAsset(asset);
    setBillFile(null);
    setBillModalOpen(true);
  };

  const handleUploadBillSubmit = async (e) => {
    e.preventDefault();
    if (!billFile) {
      setAlertMsg({ type: 'error', text: 'Please select a bill photo file to upload.' });
      return;
    }

    try {
      setLoading(true);
      const formData = new FormData();
      formData.append('billPhoto', billFile);

      await api.post(`/assets/${selectedAsset.id}/bill-photo`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setBillModalOpen(false);
      setSelectedAsset(null);
      setBillFile(null);
      setAlertMsg({ type: 'success', text: 'Bill photocopy uploaded successfully!' });
      fetchAssets();
    } catch (err) {
      setAlertMsg({ type: 'error', text: err.response?.data?.message || 'Failed to upload bill photocopy.' });
      setLoading(false);
    }
  };

  const handleDeleteBillPhoto = async (assetId) => {
    if (!window.confirm('Are you sure you want to delete this bill photocopy?')) return;
    try {
      setLoading(true);
      await api.delete(`/assets/${assetId}/bill-photo`);
      setAlertMsg({ type: 'success', text: 'Bill photocopy deleted successfully.' });
      if (detailsModalAsset && detailsModalAsset.id === assetId) {
        setDetailsModalAsset((prev) => prev ? { ...prev, billPhoto: null } : null);
      }
      if (selectedAsset && selectedAsset.id === assetId) {
        setSelectedAsset((prev) => prev ? { ...prev, billPhoto: null } : null);
      }
      fetchAssets();
    } catch (err) {
      setAlertMsg({ type: 'error', text: err.response?.data?.message || 'Failed to delete bill photo.' });
    } finally {
      setLoading(false);
    }
  };

  const openAssignModal = (asset) => {
    setSelectedAsset(asset);
    setAssignForm({
      userId: '',
      expectedReturn: '',
      notes: ''
    });
    setAssignModalOpen(true);
  };

  const handleAssignSubmit = async (e) => {
    e.preventDefault();
    try {
      setLoading(true);
      await api.post(`/assets/${selectedAsset.id}/assign`, assignForm);
      setAssignModalOpen(false);
      setSelectedAsset(null);
      setAlertMsg({ type: 'success', text: 'Asset assigned successfully.' });
      fetchAssets();
      fetchAssetAnalytics();
    } catch (err) {
      setAlertMsg({ type: 'error', text: err.response?.data?.message || 'Failed to assign asset.' });
      setLoading(false);
    }
  };

  const openReturnModal = (asset) => {
    setSelectedAsset(asset);
    setReturnForm({
      returnDate: new Date().toISOString().split('T')[0],
      conditionOnReturn: 'Good',
      remarks: ''
    });
    setReturnModalOpen(true);
  };

  const handleReturnSubmit = async (e) => {
    e.preventDefault();
    try {
      setLoading(true);
      await api.post(`/assets/${selectedAsset.id}/return`, returnForm);
      setReturnModalOpen(false);
      setSelectedAsset(null);
      setAlertMsg({ type: 'success', text: 'Asset returned successfully.' });
      fetchAssets();
      fetchAssetAnalytics();
    } catch (err) {
      setAlertMsg({ type: 'error', text: err.response?.data?.message || 'Failed to return asset.' });
      setLoading(false);
    }
  };

  const handleDelete = (asset) => {
    if (asset.status === 'ASSIGNED' || asset.assignedToId) {
      setAlertMsg({
        type: 'error',
        text: `Cannot delete asset "${asset.name}" (${asset.assetId}) because it is currently assigned. Please return the asset first.`
      });
      return;
    }

    setConfirmModal({
      isOpen: true,
      title: 'Delete Asset',
      message: `Are you sure you want to delete asset "${asset.name}" (${asset.assetId})? This action cannot be undone.`,
      onConfirm: async () => {
        try {
          const targetOrg = selectedOrgIdRef.current || selectedOrgId;
          const params = targetOrg ? { organizationId: targetOrg } : {};
          await api.delete(`/assets/${asset.id}`, { params });
          setAlertMsg({ type: 'success', text: `Asset "${asset.name}" (${asset.assetId}) deleted successfully.` });
          fetchAssets();
          fetchAssetAnalytics();
        } catch (err) {
          setAlertMsg({ type: 'error', text: err.response?.data?.message || 'Failed to delete asset.' });
        }
      }
    });
  };

  const confirmDeleteAsset = handleDelete;

  const openDetailsModal = async (asset) => {
    try {
      const res = await api.get(`/assets/${asset.id}`);
      setDetailsModalAsset(res.data);
    } catch (err) {
      console.error(err);
      setDetailsModalAsset(asset);
    }
  };

  const triggerExportCSV = async () => {
    try {
      setLoading(true);
      const res = await api.get('/assets', { params: { limit: 1000, organizationId: selectedOrgId } });
      const exportList = res.data.assets || [];

      const headers = ['Asset ID', 'Name', 'Category', 'Brand', 'Model', 'Serial Number', 'Assigned User', 'Role', 'Department', 'Status', 'Purchase Date', 'Warranty Expiry', 'Cost'];
      const csvRows = exportList.map(a => [
        `"${(a.assetId || '').replace(/"/g, '""')}"`,
        `"${(a.name || '').replace(/"/g, '""')}"`,
        `"${(a.category || '').replace(/"/g, '""')}"`,
        `"${(a.brand || '').replace(/"/g, '""')}"`,
        `"${(a.model || '').replace(/"/g, '""')}"`,
        `"${(a.serialNumber || '').replace(/"/g, '""')}"`,
        `"${(a.assignedTo?.name || 'Unassigned').replace(/"/g, '""')}"`,
        `"${(a.assignedTo?.role || '—').replace(/"/g, '""')}"`,
        `"${(a.assignedTo?.department || '—').replace(/"/g, '""')}"`,
        `"${(a.status || '').replace(/"/g, '""')}"`,
        `"${a.purchaseDate ? new Date(a.purchaseDate).toLocaleDateString() : ''}"`,
        `"${a.warrantyExpiry ? new Date(a.warrantyExpiry).toLocaleDateString() : ''}"`,
        `"${a.cost || ''}"`
      ].join(','));

      const csvContent = '\uFEFF' + [headers.join(','), ...csvRows].join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `asset_inventory_${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      setLoading(false);
      setAlertMsg({ type: 'success', text: `Successfully exported ${exportList.length} asset records.` });
    } catch (err) {
      console.error(err);
      setAlertMsg({ type: 'error', text: 'Failed to export CSV file.' });
      setLoading(false);
    }
  };

  const getStatusBadgeClass = (status) => {
    switch (status) {
      case 'AVAILABLE':
        return 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20';
      case 'ASSIGNED':
        return 'bg-blue-500/10 text-blue-600 border-blue-500/20';
      case 'MAINTENANCE':
        return 'bg-amber-500/10 text-amber-600 border-amber-500/20';
      case 'DAMAGED':
        return 'bg-rose-500/10 text-rose-600 border-rose-500/20';
      case 'LOST':
        return 'bg-purple-500/10 text-purple-600 border-purple-500/20';
      case 'DISPOSED':
        return 'bg-slate-500/10 text-slate-600 border-slate-500/20';
      default:
        return 'bg-slate-500/10 text-slate-600 border-slate-500/20';
    }
  };

  return (
    <motion.div 
      className="space-y-6 pb-8"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      <CompanyScopeSelector />

      {/* Alert Header Banner */}
      {alertMsg.text && (
        <motion.div variants={itemVariants} className={`flex items-center gap-2 p-4 rounded-[20px] border ${alertMsg.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400' : 'bg-red-500/10 border-red-500/20 text-red-500'}`}>
          {alertMsg.type === 'success' ? <CheckCircle className="h-5 w-5" /> : <AlertCircle className="h-5 w-5" />}
          <span className="text-xs font-semibold">{alertMsg.text}</span>
          <button className="ml-auto" onClick={() => setAlertMsg({ type: '', text: '' })}>
            <X className="h-4 w-4" />
          </button>
        </motion.div>
      )}

      {/* Navigation Tabs Bar */}
      {isManagementRole && (
        <motion.div variants={itemVariants} className="flex items-center gap-1.5 bg-muted/40 p-1.5 rounded-2xl border border-border/50 overflow-x-auto dash-scroll">
          <button
            type="button"
            onClick={() => setActiveTab('inventory')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'inventory'
                ? 'bg-primary text-white shadow-xs'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
          >
            <Laptop className="h-4 w-4" />
            <span>Hardware Assets</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'history'
                ? 'bg-primary text-white shadow-xs'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
          >
            <FileText className="h-4 w-4" />
            <span>Estimate History</span>
          </button>
        </motion.div>
      )}

      {activeTab === 'history' && isManagementRole ? (
        <EstimateHistorySection organizationId={targetOrg} />
      ) : (
        <>
          {/* Asset Management Overview Card - Admin, Super Admin & Team Leader Only */}
      {['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(user.role) && (
        <motion.div variants={itemVariants} className="bg-card rounded-2xl border border-border/60 p-6 shadow-md text-left space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-primary/10 p-3 text-primary border border-primary/20">
                <Laptop className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-foreground">Asset Management Overview</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Hardware systems and user allocations.</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1">
            <div className="bg-card p-4 rounded-2xl border border-border/60 shadow-xs">
              <span className="text-[10px] font-extrabold text-muted-foreground uppercase block">Total Assets</span>
              <span className="text-2xl font-black text-foreground mt-1 block">{assetStats.totalAssets}</span>
            </div>

            <div className="bg-card p-4 rounded-2xl border border-border/60 shadow-xs">
              <span className="text-[10px] font-extrabold text-emerald-600 dark:text-emerald-400 uppercase block">Available</span>
              <span className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1 block">{assetStats.availableAssets}</span>
            </div>

            <div className="bg-card p-4 rounded-2xl border border-border/60 shadow-xs">
              <span className="text-[10px] font-extrabold text-blue-600 dark:text-blue-400 uppercase block">Assigned</span>
              <span className="text-2xl font-black text-blue-600 dark:text-blue-400 mt-1 block">{assetStats.assignedAssets}</span>
            </div>
          </div>
        </motion.div>
      )}

      {/* Control Actions Bar */}
      <motion.div variants={itemVariants} className="bg-card p-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border border-border/60 shadow-md rounded-2xl">
        {/* Search */}
        <form onSubmit={handleSearchSubmit} className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by ID, name, brand, S/N..."
            className="w-full pl-9 bg-background text-xs py-2 rounded-xl border border-border/70 focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </form>

        {/* Buttons & Filters */}
        <div className="flex flex-wrap items-center gap-2">
          {isManagementRole && (
            <>
              {selectedAssetIds.length > 0 && (
                <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 rounded-xl">
                  <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                    {selectedAssetIds.length} selected
                  </span>
                  <button
                    onClick={() => setEstimateModalOpen(true)}
                    className="flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1 text-xs font-extrabold shadow-sm transition-all"
                  >
                    <FileText className="h-3.5 w-3.5" />
                    <span>Generate Estimate</span>
                  </button>
                  <button
                    onClick={clearSelectedAssets}
                    className="text-xs text-muted-foreground hover:text-foreground font-semibold px-1"
                    title="Clear selection"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

              <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="bg-background text-xs px-3 py-2 rounded-xl border border-border/70">
                <option value="">All Categories</option>
                <optgroup label="Tangible Assets">
                  {TANGIBLE_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </optgroup>
                <optgroup label="Intangible Assets">
                  {INTANGIBLE_TYPES.map((it) => (
                    <option key={it} value={it}>{it}</option>
                  ))}
                </optgroup>
                {customCategoriesList.length > 0 && (
                  <optgroup label="Other / Existing">
                    {customCategoriesList.map((cc) => (
                      <option key={cc} value={cc}>{cc}</option>
                    ))}
                  </optgroup>
                )}
              </select>

              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="bg-background text-xs px-3 py-2 rounded-xl border border-border/70">
                <option value="">All Statuses</option>
                <option value="AVAILABLE">Available</option>
                <option value="ASSIGNED">Assigned</option>
                <option value="MAINTENANCE">Maintenance</option>
                <option value="DAMAGED">Damaged</option>
                <option value="LOST">Lost</option>
                <option value="DISPOSED">Disposed</option>
              </select>

              <button onClick={triggerExportCSV} className="flex items-center gap-1.5 rounded-xl border border-border/70 bg-background px-3 py-2 text-xs font-semibold hover:bg-muted transition-all">
                <Download className="h-3.5 w-3.5" />
                <span>Export CSV</span>
              </button>

              <button onClick={() => { resetForm(); setCreateModalOpen(true); }} className="flex items-center gap-1.5 rounded-xl bg-primary hover:bg-primary-hover text-white px-4 py-2 text-xs font-extrabold shadow-md shadow-primary/20 transition-all">
                <Plus className="h-3.5 w-3.5" />
                <span>Add Asset</span>
              </button>
            </>
          )}
        </div>
      </motion.div>

      {/* Assets Inventory Table */}
      <motion.div variants={itemVariants} className="w-full min-w-0 overflow-x-auto bg-card border border-border/60 shadow-md rounded-2xl">
        <table className="w-full min-w-[800px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-border/40 bg-muted/40 text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
              {isManagementRole && (
                <th className="px-4 py-4 w-12 text-center whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={assets.length > 0 && selectedAssetIds.length === assets.length}
                    onChange={toggleSelectAll}
                    className="rounded border-border text-primary focus:ring-primary h-4 w-4 cursor-pointer"
                    title="Select / Deselect all visible assets"
                  />
                </th>
              )}
              <th className="px-6 py-4 whitespace-nowrap">Asset ID</th>
              <th className="px-6 py-4 whitespace-nowrap">Asset Name</th>
              <th className="px-6 py-4 whitespace-nowrap">Category</th>
              <th className="px-6 py-4 whitespace-nowrap">Serial Number</th>
              <th className="px-6 py-4 whitespace-nowrap">Assigned To</th>
              <th className="px-6 py-4 whitespace-nowrap">Status</th>
              <th className="px-6 py-4 text-right whitespace-nowrap">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/30">
            {assets.length === 0 ? (
              <tr>
                <td colSpan={isManagementRole ? 8 : 7} className="px-6 py-16 text-center whitespace-nowrap">
                  <div className="mx-auto flex max-w-sm flex-col items-center justify-center text-center">
                    <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary mb-4 shadow-sm border border-primary/20">
                      <Laptop className="h-8 w-8" />
                    </div>
                    <h3 className="text-base font-bold text-foreground">No Assets Found</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {isManagementRole ? 'The asset inventory is currently empty or no items match your filters.' : 'You currently do not have any company assets assigned to your profile.'}
                    </p>
                    {isManagementRole && (
                      <button
                        onClick={() => { resetForm(); setCreateModalOpen(true); }}
                        className="mt-4 inline-flex items-center gap-2 rounded-xl bg-primary hover:bg-primary-hover text-white px-4 py-2 text-xs font-bold shadow-md shadow-primary/20 transition-all"
                      >
                        <Plus className="h-4 w-4" />
                        <span>Add New Asset</span>
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ) : (
              assets.map((item) => (
                <tr
                  key={item.id}
                  className={`hover:bg-muted/40 cursor-pointer transition-all h-16 whitespace-nowrap ${
                    selectedAssetIds.includes(item.id) ? 'bg-primary/5 dark:bg-primary/10' : ''
                  }`}
                  onClick={() => openDetailsModal(item)}
                >
                  {isManagementRole && (
                    <td className="px-4 py-4 text-center whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedAssetIds.includes(item.id)}
                        onChange={() => toggleSelectAsset(item.id)}
                        className="rounded border-border text-primary focus:ring-primary h-4 w-4 cursor-pointer"
                      />
                    </td>
                  )}
                  <td className="px-6 py-4 font-mono font-bold text-xs text-foreground whitespace-nowrap">
                    {item.assetId}
                  </td>
                  <td className="px-6 py-4 font-bold text-foreground whitespace-nowrap">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20">
                        <Laptop className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-foreground leading-none">{item.name}</p>
                        {item.location && <span className="text-[10px] text-muted-foreground mt-0.5 block">{item.location}</span>}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-extrabold px-2.5 py-1 rounded-full border border-slate-200 dark:border-slate-700 uppercase">
                      {item.category}
                    </span>
                  </td>
                  <td className="px-6 py-4 font-mono text-xs text-muted-foreground whitespace-nowrap">
                    {item.serialNumber || 'N/A'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {item.assignedTo ? (
                      <div className="flex items-center gap-2">
                        <UserAvatar src={item.assignedTo.profilePic} name={item.assignedTo.name} className="h-6 w-6 rounded-lg object-cover" />
                        <div>
                          <p className="text-xs font-bold text-foreground leading-none">{item.assignedTo.name}</p>
                          <span className="text-[9px] text-muted-foreground font-mono">{item.assignedTo.employeeId}</span>
                        </div>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground font-semibold">Unassigned</span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`text-[10px] font-extrabold px-2.5 py-1 rounded-full border uppercase ${getStatusBadgeClass(item.status)}`}>
                      {item.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={() => openDetailsModal(item)}
                        className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-all"
                        title="View Asset Details"
                      >
                        <Eye size={15} />
                      </button>

                      {isManagementRole && (
                        <>
                          <button
                            onClick={() => openEditModal(item)}
                            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-all"
                            title="Edit Asset"
                          >
                            <Edit2 size={15} />
                          </button>

                          <button
                            onClick={() => openBillModal(item)}
                            className="p-1.5 rounded-lg hover:bg-blue-50 text-blue-600 transition-all font-bold text-xs flex items-center gap-1"
                            title="Upload Bill Photo Copy"
                          >
                            <Upload size={15} />
                            <span className="hidden xl:inline">Bill</span>
                          </button>

                          {item.status === 'AVAILABLE' ? (
                            <button
                              onClick={() => openAssignModal(item)}
                              className="p-1.5 rounded-lg hover:bg-emerald-50 text-emerald-600 transition-all font-bold text-xs flex items-center gap-1"
                              title="Assign to User"
                            >
                              <UserCheck size={15} />
                              <span className="hidden xl:inline">Assign</span>
                            </button>
                          ) : item.status === 'ASSIGNED' ? (
                            <button
                              onClick={() => openReturnModal(item)}
                              className="p-1.5 rounded-lg hover:bg-amber-50 text-amber-600 transition-all font-bold text-xs flex items-center gap-1"
                              title="Return Asset"
                            >
                              <CornerUpLeft size={15} />
                              <span className="hidden xl:inline">Return</span>
                            </button>
                          ) : null}

                          <button
                            onClick={() => handleDelete(item)}
                            className="p-1.5 rounded-lg hover:bg-red-50 text-red-500 transition-all"
                            title="Delete Asset"
                          >
                            <Trash2 size={15} />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </motion.div>

      {/* Pagination Footer */}
      {totalCount > 15 && (
        <motion.div variants={itemVariants} className="flex items-center justify-between px-2 pt-2">
          <p className="text-xs text-muted-foreground font-semibold">
            Showing <span className="font-bold text-foreground">{(page - 1) * 15 + 1}</span> to{' '}
            <span className="font-bold text-foreground">{Math.min(page * 15, totalCount)}</span> of{' '}
            <span className="font-bold text-foreground">{totalCount}</span> assets
          </p>
          <div className="flex items-center gap-2">
            <button
              disabled={page === 1}
              onClick={() => setPage(page - 1)}
              className="px-3 py-1 text-xs font-bold rounded-xl border border-border bg-card hover:bg-muted disabled:opacity-50 transition-all"
            >
              Previous
            </button>
            <span className="text-xs font-bold text-foreground px-2">Page {page}</span>
            <button
              disabled={page * 15 >= totalCount}
              onClick={() => setPage(page + 1)}
              className="px-3 py-1 text-xs font-bold rounded-xl border border-border bg-card hover:bg-muted disabled:opacity-50 transition-all"
            >
              Next
            </button>
          </div>
        </motion.div>
      )}
        </>
      )}

      {/* Create Asset Modal */}
      {createModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-3xl rounded-2xl border border-border/40 bg-card p-5 shadow-2xl animate-in zoom-in-95 duration-200 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-border/40 pb-2.5">
              <h3 className="text-base font-bold text-foreground">Add New Hardware / System Asset</h3>
              <button className="rounded-lg p-1 hover:bg-muted" onClick={() => setCreateModalOpen(false)}>
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="mt-3 space-y-3 text-left">
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div className="flex flex-col gap-1 sm:col-span-1">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase flex items-center justify-between">
                    <span>Asset ID</span>
                    <span className="text-[9px] text-emerald-500 font-semibold lowercase">auto</span>
                  </label>
                  <div className="flex items-center h-[38px] px-3 bg-muted/40 rounded-xl border border-border/70 text-xs font-mono font-bold text-foreground select-none" title="Auto-generated by system">
                    {previewAssetId || 'Auto-Generated'}
                  </div>
                </div>

                <div className="flex flex-col gap-1 sm:col-span-1">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase">Asset Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. MacBook Pro M3 Max 16-inch"
                    value={assetForm.name}
                    onChange={(e) => setAssetForm({ ...assetForm, name: e.target.value })}
                  />
                </div>

                <div className="flex flex-col gap-1 sm:col-span-1">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase">Category *</label>
                  <select
                    required
                    value={selectedCategoryGroup}
                    onChange={(e) => {
                      const val = e.target.value;
                      setSelectedCategoryGroup(val);
                      setSelectedAssetType('');
                      setCustomCategoryInput('');
                    }}
                  >
                    <option value="">Select Category...</option>
                    {CATEGORY_GROUPS.map((group) => (
                      <option key={group} value={group}>{group}</option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col gap-1 sm:col-span-1">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase">
                    {selectedCategoryGroup === 'Other' ? 'Asset Type (Custom) *' : 'Asset Type *'}
                  </label>
                  {selectedCategoryGroup === 'Tangible Assets' ? (
                    <select
                      required
                      value={selectedAssetType}
                      onChange={(e) => setSelectedAssetType(e.target.value)}
                    >
                      <option value="">Select Asset Type...</option>
                      {TANGIBLE_TYPES.map((type) => (
                        <option key={type} value={type}>{type}</option>
                      ))}
                    </select>
                  ) : selectedCategoryGroup === 'Intangible Assets' ? (
                    <select
                      required
                      value={selectedAssetType}
                      onChange={(e) => setSelectedAssetType(e.target.value)}
                    >
                      <option value="">Select Asset Type...</option>
                      {INTANGIBLE_TYPES.map((type) => (
                        <option key={type} value={type}>{type}</option>
                      ))}
                    </select>
                  ) : selectedCategoryGroup === 'Other' ? (
                    <input
                      type="text"
                      required
                      autoFocus
                      placeholder="e.g. CCTV System"
                      value={customCategoryInput}
                      onChange={(e) => setCustomCategoryInput(e.target.value)}
                      className="w-full text-xs font-semibold py-1.5 px-3 rounded-xl border border-emerald-500 bg-emerald-500/5 focus:bg-background focus:ring-2 focus:ring-emerald-500/20"
                    />
                  ) : (
                    <select disabled className="opacity-60 bg-muted/40 cursor-not-allowed">
                      <option value="">Select Category first...</option>
                    </select>
                  )}
                </div>

                <div className="flex flex-col gap-1 sm:col-span-1">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase">Quantity / Count *</label>
                  <input
                    type="number"
                    min="1"
                    max="500"
                    step="1"
                    required
                    placeholder="1"
                    value={assetForm.quantity}
                    onChange={(e) => handleQuantityChange(e.target.value)}
                    className={`w-full ${
                      (parseInt(assetForm.quantity, 10) < 1 || parseInt(assetForm.quantity, 10) > 500)
                        ? 'border-rose-500 focus:ring-rose-500'
                        : ''
                    }`}
                  />
                  {(parseInt(assetForm.quantity, 10) < 1 || parseInt(assetForm.quantity, 10) > 500 || isNaN(parseInt(assetForm.quantity, 10))) && (
                    <span className="text-[9px] text-rose-500 font-semibold">Quantity must be between 1 and 500.</span>
                  )}
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase">Brand</label>
                  <input
                    type="text"
                    placeholder="e.g. Apple, Dell, Logitech"
                    value={assetForm.brand}
                    onChange={(e) => setAssetForm({ ...assetForm, brand: e.target.value })}
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase">Model</label>
                  <input
                    type="text"
                    placeholder="e.g. XPS 15 9530"
                    value={assetForm.model}
                    onChange={(e) => setAssetForm({ ...assetForm, model: e.target.value })}
                  />
                </div>

                {parseInt(assetForm.quantity, 10) <= 1 && (
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-muted-foreground uppercase">Serial Number (Optional)</label>
                    <input
                      type="text"
                      placeholder="e.g. C02G182PMD6T"
                      value={assetForm.serialNumber}
                      onChange={(e) => {
                        const val = e.target.value;
                        setAssetForm({ ...assetForm, serialNumber: val });
                        setBulkSerialNumbers([val]);
                      }}
                    />
                  </div>
                )}

                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase">Purchase Date</label>
                  <input
                    type="date"
                    value={assetForm.purchaseDate}
                    onChange={(e) => setAssetForm({ ...assetForm, purchaseDate: e.target.value })}
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase">Warranty Expiry</label>
                  <input
                    type="date"
                    value={assetForm.warrantyExpiry}
                    onChange={(e) => setAssetForm({ ...assetForm, warrantyExpiry: e.target.value })}
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase">Cost</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="e.g. ₹2,00,000"
                    value={assetForm.cost}
                    onChange={(e) => setAssetForm({ ...assetForm, cost: e.target.value })}
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase">Vendor</label>
                  <input
                    type="text"
                    placeholder="e.g. Apple Reseller"
                    value={assetForm.vendor}
                    onChange={(e) => setAssetForm({ ...assetForm, vendor: e.target.value })}
                  />
                </div>

                <div className={`flex flex-col gap-1 ${parseInt(assetForm.quantity, 10) >= 2 ? 'sm:col-span-2' : 'sm:col-span-1'}`}>
                  <label className="text-[10px] font-bold text-muted-foreground uppercase">Bill Photo Copy / Invoice</label>
                  <div className="relative flex items-center w-full rounded-xl border border-border bg-background px-2.5 py-1.5 text-xs focus-within:ring-2 focus-within:ring-emerald-500/30">
                    <label className="cursor-pointer px-2 py-0.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-bold text-[11px] shrink-0 mr-2 border border-emerald-500/20 transition-all">
                      Choose
                      <input
                        key={billFile ? billFile.name : 'empty-add'}
                        type="file"
                        accept="image/*,application/pdf"
                        onChange={(e) => setBillFile(e.target.files[0] || null)}
                        className="hidden"
                      />
                    </label>
                    <span className={`text-[11px] truncate flex-1 ${billFile ? 'text-foreground font-semibold' : 'text-muted-foreground'}`}>
                      {billFile ? billFile.name : 'No file chosen'}
                    </span>
                    {billFile && (
                      <button
                        type="button"
                        onClick={() => setBillFile(null)}
                        className="p-0.5 text-muted-foreground hover:text-rose-500 rounded transition-all ml-1"
                        title="Remove selected file"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-1 sm:col-span-4">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase">Asset Description / Technical Specs</label>
                  <textarea
                    rows={2}
                    placeholder="Additional hardware specifications, RAM, SSD size, condition..."
                    value={assetForm.description}
                    onChange={(e) => setAssetForm({ ...assetForm, description: e.target.value })}
                  />
                </div>
              </div>

              {/* Dynamic Serial Numbers Section for Bulk Creation (Quantity >= 2) */}
              {parseInt(assetForm.quantity, 10) >= 2 && (
                <div className="rounded-xl border border-border/70 bg-card/60 p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-foreground flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-emerald-500" />
                      Serial Numbers ({bulkSerialNumbers.length} Required)
                    </label>
                    <span className="text-[10px] text-muted-foreground">
                      Enter a unique serial number for each asset
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 max-h-60 overflow-y-auto pr-1 p-0.5">
                    {bulkSerialNumbers.map((sn, idx) => (
                      <div
                        key={idx}
                        className={`flex flex-col gap-1 p-2.5 rounded-xl border transition-colors ${
                          serialNumberErrors[idx]
                            ? 'border-rose-500/80 bg-rose-500/5'
                            : 'border-border/60 bg-muted/20 hover:border-emerald-500/40'
                        }`}
                      >
                        <label className="text-[10px] font-bold text-muted-foreground uppercase flex items-center justify-between">
                          <span>Serial Number {idx + 1} *</span>
                          {serialNumberErrors[idx] && (
                            <span className="text-[9px] text-rose-500 font-semibold lowercase">
                              {serialNumberErrors[idx]}
                            </span>
                          )}
                        </label>
                        <input
                          type="text"
                          required
                          placeholder={`e.g. SN00${idx + 1}`}
                          value={sn}
                          onChange={(e) => handleBulkSerialChange(idx, e.target.value)}
                          className={`w-full text-xs font-mono font-medium ${
                            serialNumberErrors[idx] ? 'border-rose-500 focus:ring-rose-500/20' : ''
                          }`}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setCreateModalOpen(false)}
                  className="px-4 py-1.5 text-xs font-bold rounded-xl border hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-5 py-1.5 text-xs font-bold rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-md hover:from-emerald-600 hover:to-teal-700"
                >
                  {loading ? 'Creating...' : 'Save Asset'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Asset Modal */}
      {editModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-3xl rounded-2xl border border-border/40 bg-card p-5 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-border/40 pb-2.5">
              <h3 className="text-base font-bold text-foreground">Edit Asset Details ({selectedAsset?.assetId})</h3>
              <button className="rounded-lg p-1 hover:bg-muted" onClick={() => setEditModalOpen(false)}>
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleEditSubmit} className="mt-3 space-y-3 text-left">
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div className="flex flex-col gap-1 sm:col-span-2">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase">Asset Name *</label>
                  <input
                    type="text"
                    required
                    value={assetForm.name}
                    onChange={(e) => setAssetForm({ ...assetForm, name: e.target.value })}
                  />
                </div>

                <div className="flex flex-col gap-1 sm:col-span-1">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase">Category *</label>
                  <select
                    required
                    value={selectedCategoryGroup}
                    onChange={(e) => {
                      const val = e.target.value;
                      setSelectedCategoryGroup(val);
                      setSelectedAssetType('');
                      setCustomCategoryInput('');
                    }}
                  >
                    <option value="">Select Category...</option>
                    {CATEGORY_GROUPS.map((group) => (
                      <option key={group} value={group}>{group}</option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col gap-1 sm:col-span-1">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase">
                    {selectedCategoryGroup === 'Other' ? 'Asset Type (Custom) *' : 'Asset Type *'}
                  </label>
                  {selectedCategoryGroup === 'Tangible Assets' ? (
                    <select
                      required
                      value={selectedAssetType}
                      onChange={(e) => setSelectedAssetType(e.target.value)}
                    >
                      <option value="">Select Asset Type...</option>
                      {TANGIBLE_TYPES.map((type) => (
                        <option key={type} value={type}>{type}</option>
                      ))}
                    </select>
                  ) : selectedCategoryGroup === 'Intangible Assets' ? (
                    <select
                      required
                      value={selectedAssetType}
                      onChange={(e) => setSelectedAssetType(e.target.value)}
                    >
                      <option value="">Select Asset Type...</option>
                      {INTANGIBLE_TYPES.map((type) => (
                        <option key={type} value={type}>{type}</option>
                      ))}
                    </select>
                  ) : selectedCategoryGroup === 'Other' ? (
                    <input
                      type="text"
                      required
                      autoFocus
                      placeholder="e.g. CCTV System"
                      value={customCategoryInput}
                      onChange={(e) => setCustomCategoryInput(e.target.value)}
                      className="w-full text-xs font-semibold py-1.5 px-3 rounded-xl border border-emerald-500 bg-emerald-500/5 focus:bg-background focus:ring-2 focus:ring-emerald-500/20"
                    />
                  ) : (
                    <select disabled className="opacity-60 bg-muted/40 cursor-not-allowed">
                      <option value="">Select Category first...</option>
                    </select>
                  )}
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase">Brand</label>
                  <input
                    type="text"
                    value={assetForm.brand}
                    onChange={(e) => setAssetForm({ ...assetForm, brand: e.target.value })}
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase">Model</label>
                  <input
                    type="text"
                    value={assetForm.model}
                    onChange={(e) => setAssetForm({ ...assetForm, model: e.target.value })}
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase">Serial Number</label>
                  <input
                    type="text"
                    value={assetForm.serialNumber}
                    onChange={(e) => setAssetForm({ ...assetForm, serialNumber: e.target.value })}
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase">Status</label>
                  <select
                    value={assetForm.status}
                    onChange={(e) => setAssetForm({ ...assetForm, status: e.target.value })}
                  >
                    <option value="AVAILABLE">Available</option>
                    <option value="ASSIGNED">Assigned</option>
                    <option value="MAINTENANCE">Maintenance</option>
                    <option value="DAMAGED">Damaged</option>
                    <option value="LOST">Lost</option>
                    <option value="DISPOSED">Disposed</option>
                  </select>
                </div>
              </div>

              {/* Bill Photo Section */}
              {selectedAsset?.billPhoto && (
                <div className="p-2.5 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-700 dark:text-blue-300 text-xs flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileText size={15} />
                    <span className="font-medium">Existing Bill Uploaded</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <a
                      href={getUploadUrl(selectedAsset.billPhoto)}
                      target="_blank"
                      rel="noreferrer"
                      className="font-bold underline text-blue-600 hover:text-blue-800 text-[11px]"
                    >
                      View
                    </a>
                    <button
                      type="button"
                      onClick={() => handleDeleteBillPhoto(selectedAsset.id)}
                      className="px-2 py-0.5 rounded-lg bg-rose-500/10 text-rose-600 hover:bg-rose-500/20 text-[10px] font-bold transition-all"
                    >
                      Delete Bill
                    </button>
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-muted-foreground uppercase">
                  {selectedAsset?.billPhoto ? 'Replace Bill Photo Copy (Optional)' : 'Upload Bill Photo Copy / Invoice'}
                </label>
                <div className="relative flex items-center w-full rounded-xl border border-border bg-background px-2.5 py-1.5 text-xs focus-within:ring-2 focus-within:ring-emerald-500/30">
                  <label className="cursor-pointer px-2 py-0.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-bold text-[11px] shrink-0 mr-2 border border-emerald-500/20 transition-all">
                    Choose
                    <input
                      key={billFile ? billFile.name : 'empty-edit'}
                      type="file"
                      accept="image/*,application/pdf"
                      onChange={(e) => setBillFile(e.target.files[0] || null)}
                      className="hidden"
                    />
                  </label>
                  <span className={`text-[11px] truncate flex-1 ${billFile ? 'text-foreground font-semibold' : 'text-muted-foreground'}`}>
                    {billFile ? billFile.name : 'No file chosen'}
                  </span>
                  {billFile && (
                    <button
                      type="button"
                      onClick={() => setBillFile(null)}
                      className="p-0.5 text-muted-foreground hover:text-rose-500 rounded transition-all ml-1"
                      title="Remove selected file"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setEditModalOpen(false)}
                  className="px-4 py-1.5 text-xs font-bold rounded-xl border hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-5 py-1.5 text-xs font-bold rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-md hover:from-emerald-600 hover:to-teal-700"
                >
                  {loading ? 'Saving...' : 'Update Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Assign Asset Modal */}
      {assignModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-border/40 bg-card p-6 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-border/40 pb-3">
              <h3 className="text-base font-bold text-foreground">Assign Asset ({selectedAsset?.assetId})</h3>
              <button className="rounded-lg p-1 hover:bg-muted" onClick={() => setAssignModalOpen(false)}>
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleAssignSubmit} className="mt-4 space-y-4 text-left">
              <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-xs font-semibold">
                <span>Assigning hardware item: <strong>{selectedAsset?.name}</strong></span>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-muted-foreground uppercase">Assign To User (Intern / Employee / Team Leader) *</label>
                <select
                  required
                  value={assignForm.userId}
                  onChange={(e) => setAssignForm({ ...assignForm, userId: e.target.value })}
                >
                  <option value="">Select a user...</option>
                  {allUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.employeeId} - {u.role})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-muted-foreground uppercase">Expected Return Date (Optional)</label>
                <input
                  type="date"
                  value={assignForm.expectedReturn}
                  onChange={(e) => setAssignForm({ ...assignForm, expectedReturn: e.target.value })}
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-muted-foreground uppercase">Handover Notes / Condition</label>
                <textarea
                  rows={3}
                  placeholder="e.g. Handed over with power adapter and laptop bag."
                  value={assignForm.notes}
                  onChange={(e) => setAssignForm({ ...assignForm, notes: e.target.value })}
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setAssignModalOpen(false)}
                  className="px-4 py-2 text-xs font-bold rounded-xl border hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-5 py-2 text-xs font-bold rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-md hover:from-emerald-600 hover:to-teal-700"
                >
                  {loading ? 'Assigning...' : 'Confirm Assignment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Return Asset Modal */}
      {returnModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-border/40 bg-card p-6 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-border/40 pb-3">
              <h3 className="text-base font-bold text-foreground">Return Asset ({selectedAsset?.assetId})</h3>
              <button className="rounded-lg p-1 hover:bg-muted" onClick={() => setReturnModalOpen(false)}>
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleReturnSubmit} className="mt-4 space-y-4 text-left">
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-300 text-xs font-semibold">
                <span>Returning asset from: <strong>{selectedAsset?.assignedTo?.name || 'User'}</strong></span>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-muted-foreground uppercase">Return Date *</label>
                <input
                  type="date"
                  required
                  value={returnForm.returnDate}
                  onChange={(e) => setReturnForm({ ...returnForm, returnDate: e.target.value })}
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-muted-foreground uppercase">Asset Condition *</label>
                <select
                  value={returnForm.conditionOnReturn}
                  onChange={(e) => setReturnForm({ ...returnForm, conditionOnReturn: e.target.value })}
                >
                  <option value="Good">Good (Re-assignable to Available)</option>
                  <option value="Damaged">Damaged (Mark status as Damaged)</option>
                  <option value="Needs Repair">Needs Repair (Mark status as Maintenance)</option>
                  <option value="Lost">Lost (Mark status as Lost)</option>
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-muted-foreground uppercase">Remarks / Check-in Inspection</label>
                <textarea
                  rows={3}
                  placeholder="Inspection observations upon receiving hardware back..."
                  value={returnForm.remarks}
                  onChange={(e) => setReturnForm({ ...returnForm, remarks: e.target.value })}
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setReturnModalOpen(false)}
                  className="px-4 py-2 text-xs font-bold rounded-xl border hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-5 py-2 text-xs font-bold rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-md hover:from-emerald-600 hover:to-teal-700"
                >
                  {loading ? 'Processing...' : 'Complete Return'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Upload Bill Photo Copy Modal */}
      {billModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-border/40 bg-card p-6 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-border/40 pb-3">
              <div className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                <h3 className="text-base font-bold text-foreground">Upload Bill Photo Copy</h3>
              </div>
              <button className="rounded-lg p-1 hover:bg-muted" onClick={() => setBillModalOpen(false)}>
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleUploadBillSubmit} className="mt-4 space-y-4 text-left">
              <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-xs font-semibold">
                <span>Asset: <strong>{selectedAsset?.name}</strong> ({selectedAsset?.assetId})</span>
              </div>

              {selectedAsset?.billPhoto && (
                <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-700 dark:text-blue-300 text-xs font-medium flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileText size={16} />
                    <span>Current Bill Uploaded</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <a
                      href={getUploadUrl(selectedAsset.billPhoto)}
                      target="_blank"
                      rel="noreferrer"
                      className="font-bold underline text-blue-600 hover:text-blue-800"
                    >
                      View
                    </a>
                    <button
                      type="button"
                      onClick={() => handleDeleteBillPhoto(selectedAsset.id)}
                      className="px-2 py-1 rounded-lg bg-rose-500/10 text-rose-600 hover:bg-rose-500/20 text-[10px] font-bold transition-all"
                    >
                      Delete Bill
                    </button>
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-muted-foreground uppercase">Select Invoice / Bill Photocopy *</label>
                <div className="relative flex items-center w-full rounded-2xl border border-border bg-background px-3 py-2 text-xs transition-all focus-within:ring-2 focus-within:ring-emerald-500/30">
                  <label className="cursor-pointer px-3 py-1 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-bold text-xs shrink-0 mr-3 border border-emerald-500/20 transition-all">
                    Choose File
                    <input
                      key={billFile ? billFile.name : 'empty-upload-modal'}
                      type="file"
                      required
                      accept="image/*,application/pdf"
                      onChange={(e) => setBillFile(e.target.files[0] || null)}
                      className="hidden"
                    />
                  </label>
                  <span className={`text-xs truncate flex-1 ${billFile ? 'text-foreground font-semibold' : 'text-muted-foreground'}`}>
                    {billFile ? billFile.name : 'No file chosen'}
                  </span>
                  {billFile && (
                    <button
                      type="button"
                      onClick={() => setBillFile(null)}
                      className="p-1 text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10 rounded-lg transition-all ml-2"
                      title="Remove selected file"
                    >
                      <X size={15} />
                    </button>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setBillModalOpen(false)}
                  className="px-4 py-2 text-xs font-bold rounded-xl border hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading || !billFile}
                  className="px-5 py-2 text-xs font-bold rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-md hover:from-emerald-600 hover:to-teal-700 disabled:opacity-50"
                >
                  {loading ? 'Uploading...' : 'Upload Bill Photo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Asset Details Drawer Modal */}
      {detailsModalAsset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 text-left">
          <div className="w-full max-w-2xl rounded-2xl border border-border/40 bg-card p-6 shadow-2xl animate-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-border/40 pb-3">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                  <Laptop className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-foreground">{detailsModalAsset.name}</h3>
                  <span className="text-xs text-muted-foreground font-mono">{detailsModalAsset.assetId}</span>
                </div>
              </div>
              <button className="rounded-lg p-1 hover:bg-muted" onClick={() => setDetailsModalAsset(null)}>
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 space-y-6">
              {/* Asset Overview */}
              <div>
                <h4 className="text-xs font-black uppercase tracking-wider text-muted-foreground border-b pb-2 mb-3">Asset Information</h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                  <div className="bg-muted/40 p-3 rounded-xl border border-border/30">
                    <span className="text-[10px] text-muted-foreground uppercase font-bold block">Category</span>
                    <span className="font-extrabold text-foreground mt-0.5 block">{detailsModalAsset.category}</span>
                  </div>
                  <div className="bg-muted/40 p-3 rounded-xl border border-border/30">
                    <span className="text-[10px] text-muted-foreground uppercase font-bold block">Brand & Model</span>
                    <span className="font-extrabold text-foreground mt-0.5 block">{detailsModalAsset.brand || '—'} {detailsModalAsset.model}</span>
                  </div>
                  <div className="bg-muted/40 p-3 rounded-xl border border-border/30">
                    <span className="text-[10px] text-muted-foreground uppercase font-bold block">Serial Number</span>
                    <span className="font-extrabold font-mono text-foreground mt-0.5 block">{detailsModalAsset.serialNumber || 'N/A'}</span>
                  </div>
                  <div className="bg-muted/40 p-3 rounded-xl border border-border/30">
                    <span className="text-[10px] text-muted-foreground uppercase font-bold block">Status</span>
                    <span className={`inline-block mt-0.5 text-[9px] font-extrabold px-2 py-0.5 rounded-full border uppercase ${getStatusBadgeClass(detailsModalAsset.status)}`}>
                      {detailsModalAsset.status}
                    </span>
                  </div>
                </div>
              </div>

              {/* Financial & Warranty Details */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs">
                <div>
                  <span className="text-[10px] text-muted-foreground uppercase font-bold block">Purchase Date</span>
                  <span className="font-semibold text-foreground">{detailsModalAsset.purchaseDate ? new Date(detailsModalAsset.purchaseDate).toLocaleDateString() : 'N/A'}</span>
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground uppercase font-bold block">Warranty Expiry</span>
                  <span className="font-semibold text-foreground">{detailsModalAsset.warrantyExpiry ? new Date(detailsModalAsset.warrantyExpiry).toLocaleDateString() : 'N/A'}</span>
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground uppercase font-bold block">Cost</span>
                  <span className="font-semibold text-foreground">{detailsModalAsset.cost ? `$${detailsModalAsset.cost}` : 'N/A'}</span>
                </div>
              </div>

              {/* Bill Photocopy Attachment Section */}
              <div>
                <h4 className="text-xs font-black uppercase tracking-wider text-muted-foreground border-b pb-2 mb-3">Invoice & Bill Photocopy</h4>
                {detailsModalAsset.billPhoto ? (
                  <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <FileText className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
                      <div>
                        <p className="text-xs font-bold text-foreground">Official Bill Photocopy Uploaded</p>
                        <p className="text-[10px] text-muted-foreground">Original purchase receipt attached</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <a
                        href={getUploadUrl(detailsModalAsset.billPhoto)}
                        target="_blank"
                        rel="noreferrer"
                        className="px-3 py-1.5 rounded-xl bg-emerald-600 text-white text-xs font-bold shadow-md hover:bg-emerald-700 transition-all"
                      >
                        View / Download Bill
                      </a>
                      {isManagementRole && (
                        <button
                          type="button"
                          onClick={() => handleDeleteBillPhoto(detailsModalAsset.id)}
                          className="px-3 py-1.5 rounded-xl bg-rose-500/10 text-rose-600 border border-rose-500/20 hover:bg-rose-500/20 text-xs font-bold transition-all flex items-center gap-1"
                          title="Delete Bill Photocopy"
                        >
                          <Trash2 size={13} />
                          <span>Delete</span>
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="p-3 rounded-xl bg-muted/40 border border-dashed flex items-center justify-between text-xs text-muted-foreground">
                    <span>No bill photocopy uploaded yet.</span>
                    {isManagementRole && (
                      <button
                        onClick={() => { setDetailsModalAsset(null); openBillModal(detailsModalAsset); }}
                        className="text-xs font-bold text-emerald-600 hover:underline"
                      >
                        Upload Now
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Current Assignment Details */}
              <div>
                <h4 className="text-xs font-black uppercase tracking-wider text-muted-foreground border-b pb-2 mb-3">Assignment Details</h4>
                {detailsModalAsset.assignedTo ? (
                  <div className="flex items-center gap-4 bg-emerald-500/10 border border-emerald-500/20 p-4 rounded-2xl">
                    <UserAvatar src={detailsModalAsset.assignedTo.profilePic} name={detailsModalAsset.assignedTo.name} className="h-10 w-10 rounded-xl object-cover" />
                    <div>
                      <h5 className="text-sm font-bold text-foreground">{detailsModalAsset.assignedTo.name}</h5>
                      <p className="text-xs text-muted-foreground font-mono">{detailsModalAsset.assignedTo.employeeId} • {detailsModalAsset.assignedTo.role}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">Assigned Date: {detailsModalAsset.assignedDate ? new Date(detailsModalAsset.assignedDate).toLocaleDateString() : 'Recent'}</p>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground bg-muted/40 p-3 rounded-xl border border-dashed">
                    This asset is currently not assigned to any team member.
                  </p>
                )}
              </div>

              {/* Assignment History */}
              {detailsModalAsset.assignments && detailsModalAsset.assignments.length > 0 && (
                <div>
                  <h4 className="text-xs font-black uppercase tracking-wider text-muted-foreground border-b pb-2 mb-3">Assignment Audit History</h4>
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {detailsModalAsset.assignments.map((asg) => (
                      <div key={asg.id} className="p-3 rounded-xl bg-muted/30 border border-border/30 flex items-center justify-between text-xs">
                        <div>
                          <p className="font-bold text-foreground">{asg.user?.name} ({asg.user?.employeeId})</p>
                          <span className="text-[10px] text-muted-foreground">Assigned: {new Date(asg.assignedDate).toLocaleDateString()}</span>
                        </div>
                        <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase ${asg.status === 'ACTIVE' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-slate-500/10 text-slate-600'}`}>
                          {asg.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {confirmModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl border border-border/40 bg-card p-6 shadow-2xl text-left animate-in zoom-in-95 duration-200">
            <h3 className="text-base font-bold text-foreground">{confirmModal.title}</h3>
            <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{confirmModal.message}</p>
            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => setConfirmModal({ ...confirmModal, isOpen: false })}
                className="px-4 py-2 text-xs font-bold rounded-xl border hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const cb = confirmModal.onConfirm;
                  setConfirmModal({ ...confirmModal, isOpen: false });
                  if (cb) cb();
                }}
                className="px-4 py-2 text-xs font-bold rounded-xl bg-rose-600 text-white hover:bg-rose-700"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Estimate Action Bar */}
      {activeTab === 'inventory' && isManagementRole && selectedAssetIds.length > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-card/95 backdrop-blur-md border border-border shadow-2xl rounded-2xl px-5 py-3 flex items-center gap-4 animate-in slide-in-from-bottom-5 duration-200">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs font-bold text-foreground">
              {selectedAssetIds.length} {selectedAssetIds.length === 1 ? 'Asset' : 'Assets'} Selected
            </span>
          </div>
          <div className="h-4 w-px bg-border" />
          <button
            onClick={() => setEstimateModalOpen(true)}
            className="flex items-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 text-xs font-extrabold shadow-md shadow-emerald-600/20 transition-all cursor-pointer"
          >
            <FileText className="h-4 w-4" />
            <span>Generate Estimate</span>
          </button>
          <button
            onClick={clearSelectedAssets}
            className="text-xs text-muted-foreground hover:text-foreground font-semibold px-2 py-1 rounded-lg hover:bg-muted transition-all cursor-pointer"
          >
            Deselect All
          </button>
        </div>
      )}

      {/* Estimate Generation Modal */}
      <CreateEstimateModal
        isOpen={estimateModalOpen}
        onClose={() => setEstimateModalOpen(false)}
        selectedAssets={assets.filter((a) => selectedAssetIds.includes(a.id))}
        organizationId={targetOrg}
        onEstimateCreated={(savedEstimate) => {
          setAlertMsg({
            type: 'success',
            text: `Estimate ${savedEstimate.estimateNumber} generated and saved successfully!`
          });
          setSelectedAssetIds([]);
        }}
      />
    </motion.div>
  );
};

export default AssetManagement;
