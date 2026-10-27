import React, { useState, useEffect, useCallback, useRef, forwardRef, useImperativeHandle } from 'react';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useCompanyScope } from '../../context/CompanyScopeContext';
import LeafletMapPicker from '../common/LeafletMapPicker';
import {
  MapPin,
  Plus,
  Edit2,
  Trash2,
  CheckCircle2,
  XCircle,
  Users,
  Search,
  X,
  Loader2,
  AlertCircle,
  ToggleLeft,
  ToggleRight,
  ShieldCheck,
  Building2,
  Check,
  AlertTriangle
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const RECOMMENDED_RADIUS_OPTIONS = [
  { value: 50, label: '50 meters', sublabel: 'Small Office' },
  { value: 100, label: '100 meters', sublabel: 'Standard Office' },
  { value: 200, label: '200 meters', sublabel: 'Campus / Large Office' },
  { value: 500, label: '500 meters', sublabel: 'Industrial Complex' }
];

const AttendanceLocationsSection = forwardRef(function AttendanceLocationsSection(props, ref) {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

  const {
    selectedOrgId,
    effectiveOrgId,
    loading: orgsLoading,
    selectedCompany
  } = useCompanyScope();

  const targetOrg = isSuperAdmin
    ? selectedOrgId
    : (effectiveOrgId || user?.organizationId);

  const isScopeAll = isSuperAdmin && (!targetOrg || targetOrg === 'all');

  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);

  // Authoritative active locations for attendance geofencing
  const activeLocations = locations.filter(loc => Boolean(loc.isActive));
  const activeCount = activeLocations.length;
  const [alert, setAlert] = useState(null);
  const [gpsCapturing, setGpsCapturing] = useState(false);

  // Modal states
  const [modalOpen, setModalOpen] = useState(false);
  const [editingLocation, setEditingLocation] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [modalError, setModalError] = useState('');

  // Form state - Default name must be "MCC MRF Innovation Park"
  const [form, setForm] = useState({
    name: 'MCC MRF Innovation Park',
    address: 'MCC MRF Innovation Park, East Tambaram, Chennai, Tamil Nadu, 600059',
    latitude: 12.920490,
    longitude: 80.121647,
    radiusMeters: 200,
    isActive: true
  });

  // Assign Members Modal
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [selectedLocForAssign, setSelectedLocForAssign] = useState(null);
  const [orgMembers, setOrgMembers] = useState([]);
  const [selectedMemberIds, setSelectedMemberIds] = useState([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [assignSubmitting, setAssignSubmitting] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');

  // Delete Confirmation Modal states
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [selectedLocForDelete, setSelectedLocForDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const showAlert = (type, message) => {
    setAlert({ type, message });
    setTimeout(() => setAlert(null), 4500);
  };

  const fetchLocations = useCallback(async () => {
    try {
      setLoading(true);
      const params = {};
      if (targetOrg && targetOrg !== 'all') params.organizationId = targetOrg;
      else if (isSuperAdmin && targetOrg === 'all') params.organizationId = 'all';

      const res = await api.get('/attendance-locations', { params });
      setLocations(res.data.locations || []);
    } catch (err) {
      console.error('Failed to load attendance locations:', err);
      showAlert('error', err.response?.data?.message || 'Failed to load attendance locations.');
    } finally {
      setLoading(false);
    }
  }, [targetOrg, isSuperAdmin]);

  useEffect(() => {
    setLocations([]);
    if (orgsLoading) return;
    fetchLocations();
  }, [targetOrg, orgsLoading, fetchLocations]);

  // Capture Current Device GPS and populate Add Attendance Location form
  const captureCurrentGPS = useCallback(() => {
    if (!navigator.geolocation) {
      showAlert('error', 'Geolocation is not supported by your browser.');
      return;
    }

    setGpsCapturing(true);

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = parseFloat(position.coords.latitude.toFixed(6));
        const lon = parseFloat(position.coords.longitude.toFixed(6));

        let detectedAddress = '';

        // Reverse geocoding via OpenStreetMap / Nominatim
        try {
          const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`, {
            headers: { Accept: 'application/json' }
          });
          if (res.ok) {
            const data = await res.json();
            if (data && data.display_name) {
              detectedAddress = data.display_name;
            }
          }
        } catch (geoErr) {
          console.warn('[ReverseGeocode] Reverse geocoding notice:', geoErr);
        }

        // Graceful fallback without blocking the form
        if (!detectedAddress) {
          detectedAddress = `Location (${lat.toFixed(6)}, ${lon.toFixed(6)})`;
        }

        // Populate modal with coordinates and address without overwriting existing name
        setForm(prev => ({
          ...prev,
          name: prev.name || '',
          address: detectedAddress,
          latitude: lat,
          longitude: lon,
          radiusMeters: prev.radiusMeters || 200,
          isActive: prev.isActive !== undefined ? prev.isActive : true
        }));
        setModalError('');
        setModalOpen(true);
        setGpsCapturing(false);

        // Notify parent SiteSettings if callback provided
        if (props.onGpsCaptured) {
          props.onGpsCaptured({
            latitude: lat,
            longitude: lon,
            address: detectedAddress,
            name: form.name || 'Office Location'
          });
        }

        showAlert('success', 'Captured current GPS coordinates successfully.');
      },
      (error) => {
        setGpsCapturing(false);
        let errorMsg = 'Unable to detect your current location. Please try again.';
        if (error.code === 1) { // PERMISSION_DENIED
          errorMsg = 'Location permission was denied. Please allow location access in your browser.';
        } else if (error.code === 2) { // POSITION_UNAVAILABLE
          errorMsg = 'Unable to detect your current location. Please check your device location settings.';
        } else if (error.code === 3) { // TIMEOUT
          errorMsg = 'Location request timed out. Please try again.';
        }
        showAlert('error', errorMsg);
        if (props.onGpsError) {
          props.onGpsError(errorMsg);
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }, [props, showAlert, form.name]);

  // Expose captureCurrentGPS to parent component (SiteSettings)
  useImperativeHandle(ref, () => ({
    captureCurrentGPS,
    openCreateModal: () => handleOpenCreateModal()
  }), [captureCurrentGPS]);

  // Open modal for Create
  const handleOpenCreateModal = () => {
    if (isScopeAll) {
      showAlert('error', 'Please select a specific company using the company switcher above before adding an attendance location.');
      return;
    }
    setEditingLocation(null);
    setForm({
      name: '',
      address: '',
      latitude: 12.920490,
      longitude: 80.121647,
      radiusMeters: 200,
      isActive: true
    });
    setModalError('');
    setModalOpen(true);
  };

  // Open modal for Edit
  const handleOpenEditModal = (loc) => {
    setEditingLocation(loc);
    setForm({
      name: loc.name || '',
      address: loc.address || '',
      latitude: loc.latitude != null ? Number(loc.latitude) : 12.920490,
      longitude: loc.longitude != null ? Number(loc.longitude) : 80.121647,
      radiusMeters: loc.radiusMeters || 200,
      isActive: Boolean(loc.isActive)
    });
    setModalError('');
    setModalOpen(true);
  };

  // Handle location picker changes from LeafletMapPicker
  const handleMapPickerChange = ({ latitude, longitude, address, name }) => {
    setForm(prev => ({
      ...prev,
      latitude,
      longitude,
      address: address || prev.address,
      name: prev.name ? prev.name : (name || prev.name)
    }));
  };

  // Save location (Create or Update)
  const handleSubmitLocation = async (e) => {
    if (e) {
      e.preventDefault();
      if (e.stopPropagation) e.stopPropagation();
    }
    if (!form.name.trim()) {
      setModalError('Location Name is required.');
      return;
    }

    const radius = parseFloat(form.radiusMeters);
    if (isNaN(radius) || radius < 10 || radius > 5000) {
      setModalError('Allowed radius must be a valid number between 10 and 5,000 meters.');
      return;
    }

    if (isSuperAdmin && !editingLocation && (!targetOrg || targetOrg === 'all')) {
      setModalError('Please select a specific company from the company switcher at the top to save this location.');
      return;
    }

    const lat = parseFloat(form.latitude);
    const lon = parseFloat(form.longitude);
    if (isNaN(lat) || lat < -90 || lat > 90) {
      setModalError('A valid latitude between -90 and 90 is required.');
      return;
    }
    if (isNaN(lon) || lon < -180 || lon > 180) {
      setModalError('A valid longitude between -180 and 180 is required.');
      return;
    }

    try {
      setSubmitting(true);
      setModalError('');

      const payload = {
        name: form.name.trim(),
        address: form.address ? form.address.trim() : null,
        latitude: lat,
        longitude: lon,
        radiusMeters: radius,
        isActive: Boolean(form.isActive)
      };

      if (targetOrg && targetOrg !== 'all') {
        payload.organizationId = targetOrg;
      }

      if (editingLocation) {
        await api.put(`/attendance-locations/${editingLocation.id}`, payload);
        showAlert('success', `Attendance location "${form.name}" updated successfully.`);
      } else {
        await api.post('/attendance-locations', payload);
        showAlert('success', `Attendance location "${form.name}" created successfully.`);
      }

      setModalOpen(false);
      await fetchLocations();
    } catch (err) {
      console.error('Failed to save attendance location:', err);
      setModalError(err.response?.data?.message || err.message || 'Failed to save attendance location.');
    } finally {
      setSubmitting(false);
    }
  };

  // Toggle Active/Inactive status directly from table
  const handleToggleStatus = async (loc) => {
    try {
      const newStatus = !loc.isActive;
      await api.put(`/attendance-locations/${loc.id}`, { isActive: newStatus });
      setLocations(prev =>
        prev.map(l => (l.id === loc.id ? { ...l, isActive: newStatus } : l))
      );
      showAlert('success', `Location "${loc.name}" is now ${newStatus ? 'Active' : 'Inactive'}.`);
    } catch (err) {
      showAlert('error', 'Failed to update location status.');
    }
  };

  // Escape key handler for Delete modal
  useEffect(() => {
    if (!deleteModalOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && !deleting) {
        setDeleteModalOpen(false);
        setSelectedLocForDelete(null);
        setDeleteError('');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [deleteModalOpen, deleting]);

  // Open Delete Confirmation Modal
  const handleOpenDeleteModal = (loc) => {
    setSelectedLocForDelete(loc);
    setDeleteError('');
    setDeleteModalOpen(true);
  };

  // Close Delete Confirmation Modal
  const handleCloseDeleteModal = () => {
    if (deleting) return; // Prevent closing while API request in flight
    setDeleteModalOpen(false);
    setSelectedLocForDelete(null);
    setDeleteError('');
  };

  // Confirm Delete Location
  const handleConfirmDelete = async () => {
    if (!selectedLocForDelete || deleting) return;

    try {
      setDeleting(true);
      setDeleteError('');
      const res = await api.delete(`/attendance-locations/${selectedLocForDelete.id}`);
      showAlert('success', res.data.message || `Attendance location "${selectedLocForDelete.name}" deleted successfully.`);
      setDeleteModalOpen(false);
      setSelectedLocForDelete(null);
      fetchLocations();
    } catch (err) {
      console.error('Failed to delete attendance location:', err);
      const errMsg = err.response?.data?.message || 'Failed to delete attendance location.';
      setDeleteError(errMsg);
      // Keep confirmation modal open so the user can retry or cancel
    } finally {
      setDeleting(false);
    }
  };

  // Open Assign Members Modal
  const handleOpenAssignModal = async (loc) => {
    setSelectedLocForAssign(loc);
    setAssignModalOpen(true);
    setMembersLoading(true);
    setMemberSearch('');

    try {
      const params = {};
      if (targetOrg) params.organizationId = targetOrg;

      // 1. Fetch organization members
      const usersRes = await api.get('/users', { params: { ...params, limit: 100 } });
      const rawUsers = usersRes.data.users || [];
      const eligibleUsers = rawUsers.filter(u =>
        ['EMPLOYEE', 'INTERN', 'TEAM_LEADER'].includes(u.role)
      );
      setOrgMembers(eligibleUsers);

      // 2. Fetch already assigned members for this location
      const assignedRes = await api.get(`/attendance-locations/${loc.id}/members`);
      const assignedUserIds = (assignedRes.data.members || []).map(u => u.id);
      setSelectedMemberIds(assignedUserIds);
    } catch (err) {
      console.error('Failed to load members for location:', err);
      showAlert('error', 'Failed to load organization members.');
    } finally {
      setMembersLoading(false);
    }
  };

  // Save Member Assignments
  const handleSaveMemberAssignments = async () => {
    if (!selectedLocForAssign) return;

    try {
      setAssignSubmitting(true);
      await api.post(`/attendance-locations/${selectedLocForAssign.id}/members`, {
        userIds: selectedMemberIds
      });
      showAlert('success', `Assigned ${selectedMemberIds.length} member(s) to "${selectedLocForAssign.name}".`);
      setAssignModalOpen(false);
      fetchLocations();
    } catch (err) {
      showAlert('error', 'Failed to update member assignments.');
    } finally {
      setAssignSubmitting(false);
    }
  };

  const toggleMemberSelection = (userId) => {
    setSelectedMemberIds(prev =>
      prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]
    );
  };

  const filteredMembers = orgMembers.filter(m =>
    m.name?.toLowerCase().includes(memberSearch.toLowerCase()) ||
    m.employeeId?.toLowerCase().includes(memberSearch.toLowerCase()) ||
    m.role?.toLowerCase().includes(memberSearch.toLowerCase())
  );

  const displayedCount = filteredMembers.length;
  const displayedSelectedCount = filteredMembers.filter(m =>
    selectedMemberIds.includes(m.id)
  ).length;

  const isAllDisplayedSelected = displayedCount > 0 && displayedSelectedCount === displayedCount;
  const isIndeterminate = displayedSelectedCount > 0 && displayedSelectedCount < displayedCount;

  const selectAllRef = useRef(null);

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = isIndeterminate;
    }
  }, [isIndeterminate]);

  const handleToggleSelectAll = () => {
    if (displayedCount === 0) return;

    if (isAllDisplayedSelected) {
      // Deselect all members currently displayed by active search filter
      const displayedIds = new Set(filteredMembers.map(m => m.id));
      setSelectedMemberIds(prev => prev.filter(id => !displayedIds.has(id)));
    } else {
      // Select all members currently displayed by active search filter
      const newIds = filteredMembers.map(m => m.id);
      setSelectedMemberIds(prev => Array.from(new Set([...prev, ...newIds])));
    }
  };

  return (
    <div className="rounded-2xl border border-border/40 bg-card p-6 shadow-premium space-y-6">
      {/* Alert Banner */}
      <AnimatePresence>
        {alert && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className={`p-3.5 rounded-2xl flex items-center justify-between text-xs font-semibold ${
              alert.type === 'success'
                ? 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20'
                : 'bg-rose-500/10 text-rose-600 border border-rose-500/20'
            }`}
          >
            <div className="flex items-center gap-2">
              {alert.type === 'success' ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
              ) : (
                <AlertCircle className="h-4 w-4 shrink-0 text-rose-500" />
              )}
              <span>{alert.message}</span>
            </div>
            <button onClick={() => setAlert(null)} className="p-1 hover:bg-black/5 rounded-lg">
              <X className="h-3.5 w-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header & Add Button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/30 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-primary" />
            <h2 className="text-sm font-bold uppercase tracking-tight text-foreground">
              Attendance Locations
            </h2>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Configure multiple physical office sites, campuses, or client facilities where members can clock in.
            {selectedCompany ? ` (Active Scope: ${selectedCompany.name})` : ''}
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          {!loading && (
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${
                activeCount > 0
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                  : 'bg-muted/50 text-muted-foreground border-border/60'
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  activeCount > 0 ? 'bg-emerald-500' : 'bg-muted-foreground/40'
                }`}
              />
              <span>
                {activeCount === 1 ? '1 Active Location' : `${activeCount} Active Locations`}
              </span>
            </span>
          )}

          <button
            type="button"
            onClick={handleOpenCreateModal}
            className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-primary text-xs font-bold text-primary-foreground shadow-sm hover:bg-primary/90 active:scale-95 transition-all shrink-0 cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            <span>Add Location</span>
          </button>
        </div>
      </div>

      {/* Super Admin Notice: All Companies Scope */}
      {isScopeAll && (
        <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-800 dark:text-amber-300 text-xs font-semibold flex items-center gap-2.5">
          <Building2 className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <span>
            <strong>Company Scope: All Companies.</strong> Attendance locations must belong to a specific company. Please select a specific company using the company switcher at the top to add or configure locations.
          </span>
        </div>
      )}

      {/* Locations Table / Cards */}
      {loading ? (
        <div className="py-12 flex flex-col items-center justify-center gap-2 text-muted-foreground text-xs font-semibold">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <span>Loading attendance locations...</span>
        </div>
      ) : locations.length === 0 ? (
        <div className="py-10 text-center rounded-2xl border border-dashed border-border/80 bg-muted/10 p-8 space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary mx-auto flex items-center justify-center">
            <MapPin className="h-6 w-6" />
          </div>
          <p className="text-xs font-bold text-foreground">No Attendance Locations Configured</p>
          <p className="text-[11px] text-muted-foreground max-w-md mx-auto">
            Add locations such as "MRF Innovation Park", "Chennai Office", or "Client Site". Members will be authorized to clock in when inside their assigned location radius.
          </p>
          <div className="flex items-center justify-center gap-2.5 flex-wrap">
            <button
              type="button"
              onClick={handleOpenCreateModal}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-xs font-bold text-primary-foreground hover:bg-primary/90 transition-all cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Create First Location</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Desktop Table View */}
          <div className="hidden lg:block overflow-x-auto rounded-2xl border border-border/60 bg-card">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/40 border-b border-border/60 text-muted-foreground font-bold uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="py-3 px-4">Location Name</th>
                  <th className="py-3 px-4">Address</th>
                  <th className="py-3 px-4">Allowed Radius</th>
                  <th className="py-3 px-4">Assigned Members</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40 font-medium">
                {locations.map((loc) => (
                  <tr key={loc.id} className="hover:bg-muted/20 transition-colors">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <div className="p-2 rounded-xl bg-primary/10 text-primary shrink-0">
                          <MapPin className="h-4 w-4" />
                        </div>
                        <span className="font-bold text-foreground text-xs">{loc.name}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4 max-w-xs truncate text-muted-foreground">
                      {loc.address || '—'}
                    </td>
                    <td className="py-3 px-4">
                      <span className="px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-muted text-foreground border border-border/60">
                        {loc.radiusMeters} meters
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <button
                        type="button"
                        onClick={() => handleOpenAssignModal(loc)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-primary/10 text-primary border border-primary/20 text-[11px] font-bold hover:bg-primary/20 transition-all cursor-pointer"
                        title="Manage assigned members"
                      >
                        <Users className="h-3.5 w-3.5" />
                        <span>{loc.assignedUserCount || 0} members</span>
                      </button>
                    </td>
                    <td className="py-3 px-4">
                      <button
                        type="button"
                        onClick={() => handleToggleStatus(loc)}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-extrabold transition-all cursor-pointer ${
                          loc.isActive
                            ? 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20'
                            : 'bg-muted text-muted-foreground border border-border'
                        }`}
                      >
                        {loc.isActive ? (
                          <>
                            <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                            <span>● Active</span>
                          </>
                        ) : (
                          <>
                            <XCircle className="h-3 w-3 text-muted-foreground" />
                            <span>○ Inactive</span>
                          </>
                        )}
                      </button>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleOpenEditModal(loc)}
                          className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-all cursor-pointer"
                          title="Edit Location"
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenDeleteModal(loc)}
                          className="p-1.5 rounded-lg text-muted-foreground hover:bg-rose-500/10 hover:text-rose-500 transition-all cursor-pointer"
                          title="Delete Location"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Responsive Cards View (Mobile & Tablet) */}
          <div className="lg:hidden grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {locations.map((loc) => (
              <div key={loc.id} className="rounded-2xl border border-border/70 bg-card p-4 space-y-3 shadow-xs">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="p-2 rounded-xl bg-primary/10 text-primary shrink-0">
                      <MapPin className="h-4 w-4" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-foreground">{loc.name}</h4>
                      <p className="text-[11px] text-muted-foreground font-medium">Allowed Radius: {loc.radiusMeters} meters</p>
                    </div>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold border ${
                    loc.isActive
                      ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
                      : 'bg-muted text-muted-foreground border-border'
                  }`}>
                    {loc.isActive ? '● Active' : '○ Inactive'}
                  </span>
                </div>

                <p className="text-xs text-muted-foreground line-clamp-2 font-normal">
                  {loc.address || '—'}
                </p>

                <div className="pt-2 border-t border-border/40 flex items-center justify-between text-xs">
                  <button
                    type="button"
                    onClick={() => handleOpenAssignModal(loc)}
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-primary hover:underline cursor-pointer"
                  >
                    <Users className="h-3.5 w-3.5" />
                    <span>{loc.assignedUserCount || 0} members</span>
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleOpenEditModal(loc)}
                      className="px-2.5 py-1 rounded-xl border border-border text-[11px] font-bold text-foreground hover:bg-muted cursor-pointer"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleStatus(loc)}
                      className={`px-2.5 py-1 rounded-xl border text-[11px] font-bold cursor-pointer ${
                        loc.isActive
                          ? 'border-amber-500/30 text-amber-600 hover:bg-amber-500/10'
                          : 'border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10'
                      }`}
                    >
                      {loc.isActive ? 'Disable' : 'Enable'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleOpenDeleteModal(loc)}
                      className="p-1.5 rounded-xl border border-border text-muted-foreground hover:bg-rose-500/10 hover:text-rose-500 hover:border-rose-500/30 transition-all cursor-pointer"
                      title="Delete Location"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* ADD / EDIT ATTENDANCE LOCATION MODAL */}
      {/* ========================================================= */}
      <AnimatePresence>
        {modalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-xl max-h-[90vh] flex flex-col rounded-3xl bg-card border border-border shadow-2xl overflow-hidden"
            >
              {/* Modal Header */}
              <div className="p-5 border-b border-border/40 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-xl bg-primary/10 text-primary">
                    <MapPin className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-foreground">
                      {editingLocation ? 'Edit Attendance Location' : 'Add Attendance Location'}
                    </h3>
                    <p className="text-[11px] text-muted-foreground">
                      Define place boundaries via interactive Leaflet & OpenStreetMap
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="p-1.5 rounded-xl hover:bg-muted text-muted-foreground cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Modal Body (Scrollable) */}
              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                {modalError && (
                  <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 text-xs font-semibold flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span>{modalError}</span>
                  </div>
                )}

                {isScopeAll && !editingLocation && (
                  <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-800 dark:text-amber-300 text-xs font-semibold flex items-center gap-2">
                    <Building2 className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                    <span>Attendance locations belong to a single company. Please select a specific company from the company switcher at the top before saving.</span>
                  </div>
                )}

                {/* 1. Location Name */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-foreground block">Location Name *</label>
                  <input
                    type="text"
                    required
                    value={form.name}
                    onChange={(e) => {
                      const val = e.target.value;
                      setForm(prev => ({ ...prev, name: val }));
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleSubmitLocation(e);
                      }
                    }}
                    placeholder="e.g. MRF Innovation Park"
                    className="w-full px-3.5 py-2.5 text-xs font-semibold rounded-2xl border border-border bg-muted/20 focus:bg-background focus:ring-2 focus:ring-primary/20 outline-none text-foreground"
                  />
                </div>

                {/* 2 & 3 & 4. Leaflet OpenStreetMap Search & Interactive Map Picker */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-foreground block">
                    Location / Address
                  </label>
                  <LeafletMapPicker
                    latitude={form.latitude}
                    longitude={form.longitude}
                    address={form.address}
                    radiusMeters={form.radiusMeters}
                    onLocationChange={handleMapPickerChange}
                    onCaptureGps={captureCurrentGPS}
                    gpsCapturing={gpsCapturing}
                  />
                </div>

                {/* 5. Address (Auto-populated, editable) */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-foreground block">Selected Address</label>
                  <textarea
                    rows={2}
                    value={form.address}
                    onChange={(e) => {
                      const val = e.target.value;
                      setForm(prev => ({ ...prev, address: val }));
                    }}
                    placeholder="Physical street address..."
                    className="w-full px-3.5 py-2 text-xs font-medium rounded-2xl border border-border bg-muted/20 focus:bg-background focus:ring-2 focus:ring-primary/20 outline-none text-foreground resize-none"
                  />
                </div>

                {/* 6. Allowed Radius (Recommended Chips + Custom Input) & Status */}
                <div className="space-y-3 pt-1">
                  {/* Recommended Radius Presets */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold text-foreground block">
                        Recommended Radius
                      </label>
                      <span className="text-[11px] text-muted-foreground font-medium">
                        Click preset to apply
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {RECOMMENDED_RADIUS_OPTIONS.map((rec) => {
                        const isSelected = Number(form.radiusMeters) === rec.value;
                        return (
                          <button
                            key={rec.value}
                            type="button"
                            onClick={() => setForm((prev) => ({ ...prev, radiusMeters: rec.value }))}
                            className={`p-2.5 rounded-2xl border text-left transition-all cursor-pointer flex flex-col justify-between gap-1 ${
                              isSelected
                                ? 'bg-primary text-primary-foreground border-primary shadow-xs ring-2 ring-primary/20'
                                : 'bg-muted/20 hover:bg-muted/40 border-border text-foreground'
                            }`}
                          >
                            <div className="flex items-center justify-between w-full">
                              <span className="text-xs font-extrabold">{rec.label}</span>
                              {isSelected && <Check className="h-3.5 w-3.5 shrink-0" />}
                            </div>
                            <span
                              className={`text-[10px] leading-tight ${
                                isSelected ? 'text-primary-foreground/90 font-medium' : 'text-muted-foreground'
                              }`}
                            >
                              {rec.sublabel}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Custom Radius Input & Clock-In Availability Status */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold text-foreground block">
                          Custom Radius
                        </label>
                        {form.radiusMeters !== '' && !RECOMMENDED_RADIUS_OPTIONS.some((o) => o.value === Number(form.radiusMeters)) ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-primary/10 text-primary border border-primary/20">
                            Custom: {form.radiusMeters}m
                          </span>
                        ) : form.radiusMeters ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-muted text-muted-foreground">
                            Preset Active
                          </span>
                        ) : null}
                      </div>
                      <div className="relative flex items-center">
                        <input
                          type="number"
                          min="10"
                          max="5000"
                          value={form.radiusMeters === '' ? '' : form.radiusMeters}
                          onChange={(e) => {
                            const val = e.target.value;
                            setForm((prev) => ({
                              ...prev,
                              radiusMeters: val === '' ? '' : Number(val)
                            }));
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleSubmitLocation(e);
                            }
                          }}
                          placeholder="e.g. 275"
                          className="w-full pl-3.5 pr-14 py-2.5 text-xs font-bold rounded-2xl border border-border bg-card text-foreground focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                        />
                        <span className="absolute right-3.5 text-xs font-bold text-muted-foreground pointer-events-none">
                          meters
                        </span>
                      </div>
                      <p className="text-[10px] text-muted-foreground">
                        Enter any valid distance (10m – 5,000m)
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-foreground block">Status</label>
                      <button
                        type="button"
                        onClick={() => setForm(prev => ({ ...prev, isActive: !prev.isActive }))}
                        className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-2xl border text-xs font-bold transition-all cursor-pointer h-[42px] ${
                          form.isActive
                            ? 'bg-primary/10 border-primary/30 text-primary'
                            : 'bg-muted/40 border-border text-muted-foreground'
                        }`}
                      >
                        <span>{form.isActive ? 'Active (Ready for Clock-In)' : 'Inactive (Disabled)'}</span>
                        {form.isActive ? (
                          <ToggleRight className="h-5 w-5 text-primary" />
                        ) : (
                          <ToggleLeft className="h-5 w-5" />
                        )}
                      </button>
                      <p className="text-[10px] text-muted-foreground">
                        Inactive locations are hidden from clock-in
                      </p>
                    </div>
                  </div>
                </div>

                {/* Modal Footer */}
                <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-border/40">
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    className="px-4 py-2.5 rounded-2xl border border-border text-xs font-bold text-muted-foreground hover:bg-muted cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSubmitLocation}
                    disabled={submitting || (isScopeAll && !editingLocation)}
                    className="flex items-center gap-2 px-6 py-2.5 rounded-2xl bg-primary text-xs font-bold text-primary-foreground hover:bg-primary/90 shadow-md transition-all cursor-pointer disabled:opacity-50"
                  >
                    {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    <span>{editingLocation ? 'Update Location' : 'Save Location'}</span>
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ========================================================= */}
      {/* ASSIGN MEMBERS MODAL */}
      {/* ========================================================= */}
      <AnimatePresence>
        {assignModalOpen && selectedLocForAssign && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-lg max-h-[85vh] flex flex-col rounded-3xl bg-card border border-border shadow-2xl overflow-hidden"
            >
              {/* Header */}
              <div className="p-5 border-b border-border/40 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-xl bg-primary/10 text-primary">
                    <Users className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-foreground">
                      Assign Members: {selectedLocForAssign.name}
                    </h3>
                    <p className="text-[11px] text-muted-foreground">
                      Authorized members will be permitted to clock in at this location
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setAssignModalOpen(false)}
                  className="p-1.5 rounded-xl hover:bg-muted text-muted-foreground cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto p-5 space-y-3">
                {/* Search */}
                <div className="relative">
                  <Search className="absolute left-3 top-3 h-3.5 w-3.5 text-muted-foreground" />
                  <input
                    type="text"
                    value={memberSearch}
                    onChange={(e) => setMemberSearch(e.target.value)}
                    placeholder="Search by name, employee ID, role..."
                    className="w-full pl-9 pr-3 py-2 text-xs font-semibold rounded-2xl border border-border bg-muted/20 outline-none focus:bg-background focus:ring-1 focus:ring-primary text-foreground"
                  />
                </div>

                {/* Select All Members Toolbar */}
                {!membersLoading && (
                  <div className="flex items-center justify-between p-2.5 px-3 rounded-2xl bg-muted/30 border border-border/50 text-xs select-none">
                    <label
                      className={`flex items-center gap-2.5 font-bold text-foreground ${
                        filteredMembers.length === 0 ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                      }`}
                    >
                      <input
                        ref={selectAllRef}
                        type="checkbox"
                        checked={isAllDisplayedSelected}
                        onChange={handleToggleSelectAll}
                        disabled={filteredMembers.length === 0}
                        className="h-4 w-4 rounded-md border-border text-primary focus:ring-primary/20 cursor-pointer disabled:cursor-not-allowed"
                      />
                      <span>Select All Members</span>
                    </label>
                    <span className="text-[11px] font-semibold text-muted-foreground">
                      {selectedMemberIds.length} of {orgMembers.length} members selected
                    </span>
                  </div>
                )}

                {membersLoading ? (
                  <div className="py-8 flex flex-col items-center justify-center text-xs text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin text-primary mb-1" />
                    <span>Loading members...</span>
                  </div>
                ) : orgMembers.length === 0 ? (
                  <p className="text-center py-6 text-xs text-muted-foreground font-semibold">
                    No members available in organization.
                  </p>
                ) : filteredMembers.length === 0 ? (
                  <p className="text-center py-6 text-xs text-muted-foreground font-semibold">
                    No matching members found.
                  </p>
                ) : (
                  <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                    {filteredMembers.map((member) => {
                      const isSelected = selectedMemberIds.includes(member.id);
                      return (
                        <div
                          key={member.id}
                          onClick={() => toggleMemberSelection(member.id)}
                          className={`p-3 rounded-2xl border flex items-center justify-between cursor-pointer transition-all ${
                            isSelected
                              ? 'bg-primary/10 border-primary/40 text-foreground'
                              : 'bg-card border-border/60 hover:bg-muted/30 text-muted-foreground'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => {}} // Handled by container onClick
                              className="h-4 w-4 rounded-md border-border text-primary focus:ring-primary/20 cursor-pointer"
                            />
                            <div>
                              <p className="text-xs font-bold text-foreground">{member.name}</p>
                              <p className="text-[10px] text-muted-foreground">
                                {member.employeeId} • {member.role}
                              </p>
                            </div>
                          </div>
                          {isSelected && (
                            <span className="text-[10px] font-extrabold text-primary px-2 py-0.5 rounded-full bg-primary/10">
                              Assigned
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="p-4 border-t border-border/40 flex items-center justify-between shrink-0 bg-muted/10">
                <span className="text-xs text-muted-foreground font-semibold">
                  {selectedMemberIds.length} of {orgMembers.length} members selected
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setAssignModalOpen(false)}
                    className="px-4 py-2 rounded-xl border border-border text-xs font-bold text-muted-foreground hover:bg-muted cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveMemberAssignments}
                    disabled={assignSubmitting}
                    className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-primary text-xs font-bold text-primary-foreground hover:bg-primary/90 transition-all cursor-pointer disabled:opacity-50"
                  >
                    {assignSubmitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    <span>Save Assignments</span>
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ========================================================= */}
      {/* DELETE ATTENDANCE LOCATION CONFIRMATION MODAL             */}
      {/* ========================================================= */}
      <AnimatePresence>
        {deleteModalOpen && selectedLocForDelete && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200"
            onClick={(e) => {
              if (e.target === e.currentTarget && !deleting) {
                handleCloseDeleteModal();
              }
            }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              className="w-full max-w-md rounded-3xl bg-card border border-border shadow-2xl p-6 space-y-5 overflow-hidden text-left"
            >
              {/* Header with Trash Icon and Title */}
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-2xl bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 shrink-0">
                    <Trash2 className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-foreground">
                      Delete Attendance Location?
                    </h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Confirm permanent removal of this site
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleCloseDeleteModal}
                  disabled={deleting}
                  className="p-1.5 rounded-xl hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer disabled:opacity-50"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Selected Location Card */}
              <div className="p-3.5 rounded-2xl bg-muted/40 border border-border/60 space-y-1.5">
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-rose-500 shrink-0" />
                  <span className="font-bold text-foreground text-xs truncate">
                    {selectedLocForDelete.name}
                  </span>
                </div>
                {selectedLocForDelete.address && (
                  <p className="text-[11px] text-muted-foreground line-clamp-2 pl-6">
                    {selectedLocForDelete.address}
                  </p>
                )}
                <div className="flex items-center gap-2 pt-1 pl-6 text-[10px] text-muted-foreground font-semibold">
                  <span className="px-2 py-0.5 rounded-md bg-muted border border-border/50">
                    Radius: {selectedLocForDelete.radiusMeters}m
                  </span>
                  <span>•</span>
                  <span>{selectedLocForDelete.assignedUserCount || 0} assigned member(s)</span>
                </div>
              </div>

              {/* Warning message with subtle warning indicator */}
              <div className="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-start gap-2.5 text-xs text-amber-800 dark:text-amber-300 font-medium">
                <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <p className="leading-relaxed">
                  Are you sure you want to delete this attendance location? This action cannot be undone.
                </p>
              </div>

              {/* Error message if deletion fails */}
              {deleteError && (
                <div className="p-3 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-start gap-2.5 text-xs text-rose-600 dark:text-rose-400 font-semibold animate-in fade-in duration-150">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <div className="space-y-0.5 flex-1">
                    <p className="font-bold">Deletion Blocked</p>
                    <p className="text-[11px] font-normal leading-relaxed">{deleteError}</p>
                  </div>
                </div>
              )}

              {/* Modal Actions */}
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleCloseDeleteModal}
                  disabled={deleting}
                  className="px-4 py-2.5 rounded-xl border border-border/70 text-xs font-bold text-foreground hover:bg-muted transition-all disabled:opacity-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDelete}
                  disabled={deleting}
                  className="px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-md shadow-rose-600/20 flex items-center gap-2 transition-all disabled:opacity-50 active:scale-95 cursor-pointer"
                >
                  {deleting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Deleting...</span>
                    </>
                  ) : (
                    <>
                      <Trash2 className="h-4 w-4" />
                      <span>Delete Location</span>
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
});

export default AttendanceLocationsSection;
