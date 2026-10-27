import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import { Home, MapPin, Clock, AlertTriangle, CheckCircle2, X, RefreshCw, ShieldAlert, Navigation, Sparkles, Calendar, Info } from 'lucide-react';
import { formatLateDuration } from '../../utils/attendanceFormatter';

const calculateHaversineDistance = (lat1, lon1, lat2, lon2) => {
  const numLat1 = parseFloat(lat1);
  const numLon1 = parseFloat(lon1);
  const numLat2 = parseFloat(lat2);
  const numLon2 = parseFloat(lon2);
  if (isNaN(numLat1) || isNaN(numLon1) || isNaN(numLat2) || isNaN(numLon2)) return Infinity;

  const R = 6371000; // Radius of Earth in meters
  const dLat = (numLat2 - numLat1) * (Math.PI / 180);
  const dLon = (numLon2 - numLon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(numLat1 * (Math.PI / 180)) * Math.cos(numLat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in meters
};

const formatDistance = (meters) => {
  if (meters === null || meters === undefined || isNaN(meters)) return 'Unknown';
  const m = Math.round(meters);
  if (m < 1000) {
    return `${m} m`;
  }
  const km = (m / 1000).toFixed(1);
  return `${km} km`;
};

export default function ClockInModal({
  isOpen,
  onClose,
  onSuccess,
  onError,
  user,
  mode = 'NORMAL',
  permission = null
}) {
  const isCompOff = mode === 'COMPOFF';
  // Geofence & Location states: 'IDLE' | 'DETECTING' | 'PERMISSION_DENIED' | 'GPS_ERROR' | 'INSIDE' | 'OUTSIDE'
  const [geoState, setGeoState] = useState('IDLE');
  const [coords, setCoords] = useState({ latitude: null, longitude: null });
  const [distanceMeters, setDistanceMeters] = useState(null);
  const [matchedLocation, setMatchedLocation] = useState(null);
  const [nearestLocation, setNearestLocation] = useState(null);
  
  // Outside form states
  const [outsideWorkLocation, setOutsideWorkLocation] = useState('HOME');
  const [workLocationOther, setWorkLocationOther] = useState('');
  
  const [loading, setLoading] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [clockStatus, setClockStatus] = useState(null);

  // Prevent background page scrolling while modal is open
  useEffect(() => {
    if (isOpen) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      setOutsideWorkLocation('HOME');
      setWorkLocationOther('');
      setErrorMsg('');
      setMatchedLocation(null);
      setNearestLocation(null);
      setDistanceMeters(null);
      fetchClockStatusAndGeofence();
    }
  }, [isOpen]);

  const fetchClockStatusAndGeofence = async () => {
    try {
      setStatusLoading(true);
      const res = await api.get('/attendance/status');
      setClockStatus(res.data);
      requestGPSLocation(res.data);
    } catch (err) {
      console.error('Failed to fetch clock status & geofence:', err);
      requestGPSLocation({
        geofence: {
          officeLatitude: 12.971598,
          officeLongitude: 77.594562,
          allowedRadiusMeters: 200,
          officeLocationName: 'Office'
        }
      });
    } finally {
      setStatusLoading(false);
    }
  };

  const requestGPSLocation = (statusData) => {
    const currentStatus = statusData || clockStatus;
    const assignedLocations = currentStatus?.assignedLocations || [];
    const targetGeofence = currentStatus?.geofence || {
      officeLatitude: 12.971598,
      officeLongitude: 77.594562,
      allowedRadiusMeters: 200,
      officeLocationName: 'Office'
    };

    setGeoState('DETECTING');
    setErrorMsg('');
    setMatchedLocation(null);
    setNearestLocation(null);

    if (!navigator.geolocation) {
      setGeoState('GPS_ERROR');
      setErrorMsg('Unable to get your current location. Please retry.');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = parseFloat(position.coords.latitude.toFixed(6));
        const lon = parseFloat(position.coords.longitude.toFixed(6));
        setCoords({ latitude: lat, longitude: lon });

        try {
          // Authoritative geofence evaluation result from backend
          const res = await api.post('/attendance/verify-location', { latitude: lat, longitude: lon });
          const evalData = res.data;

          if (evalData.status === 'INSIDE') {
            setGeoState('INSIDE');
            setMatchedLocation(evalData.matchedLocation);
            setNearestLocation(evalData.matchedLocation);
            setDistanceMeters(evalData.distanceMeters);
            setErrorMsg('');
          } else if (evalData.status === 'NO_ASSIGNED_LOCATION') {
            setGeoState('NO_ASSIGNED_LOCATION');
            setMatchedLocation(null);
            setNearestLocation(null);
            setDistanceMeters(null);
            setErrorMsg(evalData.message || 'No attendance location has been assigned to your account. Please contact your administrator.');
          } else {
            setGeoState('OUTSIDE');
            setMatchedLocation(null);
            setNearestLocation(evalData.nearestLocation);
            setDistanceMeters(evalData.distanceMeters);
            setErrorMsg(evalData.message || 'You are outside your allowed attendance locations.');
          }
        } catch (verifyErr) {
          console.warn('Backend location verification fallback:', verifyErr);
          // Fallback to evaluating against assignedLocations from status data
          if (assignedLocations && assignedLocations.length > 0) {
            let nearestLoc = null;
            let minDistance = Infinity;
            let matchedLoc = null;
            let matchedDist = Infinity;

            for (const loc of assignedLocations) {
              const dist = calculateHaversineDistance(lat, lon, loc.latitude, loc.longitude);
              if (!isNaN(dist)) {
                if (dist < minDistance) {
                  minDistance = dist;
                  nearestLoc = loc;
                }
                if (dist <= loc.radiusMeters && dist < matchedDist) {
                  matchedDist = dist;
                  matchedLoc = loc;
                }
              }
            }

            if (matchedLoc) {
              setMatchedLocation(matchedLoc);
              setNearestLocation(matchedLoc);
              setDistanceMeters(Math.round(matchedDist));
              setGeoState('INSIDE');
              setErrorMsg('');
            } else {
              setMatchedLocation(null);
              setNearestLocation(nearestLoc);
              setDistanceMeters(Math.round(minDistance));
              setGeoState('OUTSIDE');
              setErrorMsg(nearestLoc
                ? `You are currently outside the permitted location "${nearestLoc.name}" (${formatDistance(minDistance)} away). Allowed radius is ${nearestLoc.radiusMeters}m.`
                : 'You are outside your allowed attendance locations.');
            }
          } else if (currentStatus?.hasOrganizationLocations) {
            setGeoState('NO_ASSIGNED_LOCATION');
            setErrorMsg('No attendance location has been assigned to your account. Please contact your administrator.');
          } else {
            // Legacy single office geofence
            const dist = calculateHaversineDistance(
              lat,
              lon,
              targetGeofence.officeLatitude,
              targetGeofence.officeLongitude
            );
            setDistanceMeters(Math.round(dist));

            if (dist <= targetGeofence.allowedRadiusMeters) {
              setGeoState('INSIDE');
              setErrorMsg('');
            } else {
              setGeoState('OUTSIDE');
              setErrorMsg(`You are currently outside the permitted location (${formatDistance(dist)} away). Allowed radius is ${targetGeofence.allowedRadiusMeters}m.`);
            }
          }
        }
      },
      (error) => {
        console.warn('GPS position error:', error);
        if (error.code === 1) { // PERMISSION_DENIED
          setGeoState('PERMISSION_DENIED');
          setErrorMsg('Location permission is required for office clock-in.');
        } else {
          setGeoState('GPS_ERROR');
          setErrorMsg('Unable to get your current location. Please retry.');
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  if (!isOpen) return null;

  const activeLocation = matchedLocation || nearestLocation || (clockStatus?.assignedLocations?.[0] ?? null);
  const allowedRadius = activeLocation ? activeLocation.radiusMeters : (clockStatus?.geofence?.allowedRadiusMeters ?? 200);
  const officeName = activeLocation ? activeLocation.name : (clockStatus?.geofence?.officeLocationName ?? 'Office');
  const targetOfficeLat = clockStatus?.geofence?.officeLatitude;
  const targetOfficeLon = clockStatus?.geofence?.officeLongitude;

  const isOtherInvalid = (geoState === 'OUTSIDE' || geoState === 'NO_ASSIGNED_LOCATION' || geoState === 'PERMISSION_DENIED' || geoState === 'GPS_ERROR') &&
    outsideWorkLocation === 'OTHER' && !workLocationOther.trim();
  const calculatedStatus = clockStatus?.state === 'OPEN_LATE' ? 'LATE' : 'PRESENT';
  const lateMinutes = clockStatus?.lateMinutes || 0;
  const currentTimeDisplay = clockStatus?.currentTimeFormatted || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (geoState === 'DETECTING') {
      setErrorMsg('Location verification is in progress. Please wait.');
      return;
    }

    const isInside = geoState === 'INSIDE';
    const workLoc = isInside ? 'OFFICE' : outsideWorkLocation;

    if (workLoc === 'OFFICE' && (geoState === 'PERMISSION_DENIED' || geoState === 'GPS_ERROR' || geoState === 'NO_ASSIGNED_LOCATION')) {
      setErrorMsg(geoState === 'NO_ASSIGNED_LOCATION'
        ? 'No attendance location has been assigned to your account. Please contact your administrator.'
        : 'Location permission is required for office clock-in. Please retry location or select Home / Other below.');
      return;
    }

    if (!isCompOff && workLoc === 'OTHER' && !workLocationOther.trim()) {
      setErrorMsg('Location or reason is required when "Other" is selected.');
      return;
    }

    if (isCompOff && !isInside && outsideWorkLocation === 'OTHER' && (!workLocationOther.trim() || workLocationOther.trim().length < 3)) {
      setErrorMsg('Please provide a reason (at least 3 characters) when "Other" is selected.');
      return;
    }

    try {
      setLoading(true);
      setErrorMsg('');

      if (isCompOff) {
        // Compute location reason if outside geofence
        let locationReason = null;
        if (!isInside) {
          if (outsideWorkLocation === 'HOME') {
            locationReason = workLocationOther.trim()
              ? `Home (Remote): ${workLocationOther.trim()}`
              : 'Working remotely from home';
          } else {
            locationReason = workLocationOther.trim();
          }
        }

        const compOffPayload = {
          latitude: coords.latitude,
          longitude: coords.longitude,
          locationReason: locationReason || null,
          address: matchedLocation?.address || null,
          location: matchedLocation?.name || null
        };

        const res = await api.post('/comp-off/sessions/login', compOffPayload);

        if (onSuccess) {
          onSuccess(res.data);
        }
        onClose();
      } else {
        const payload = {
          latitude: coords.latitude,
          longitude: coords.longitude,
          address: matchedLocation?.address || null,
          workLocation: workLoc,
          workLocationOther: workLoc === 'OTHER' ? workLocationOther.trim() : (workLocationOther.trim() || null)
        };

        const res = await api.post('/attendance/clock-in', payload);

        if (onSuccess) {
          onSuccess(res.data);
        }
        onClose();
      }
    } catch (err) {
      console.error(isCompOff ? 'Comp-Off login error:' : 'Clock in error:', err);
      const errRes = err.response?.data;
      const status = err.response?.status;

      let userMessage = '';
      if (status === 401) {
        userMessage = 'Your session has expired. Please log in again.';
      } else if (status === 403) {
        userMessage = errRes?.message || `Access denied: You do not have permission to ${isCompOff ? 'start Comp-Off session' : 'clock in'}.`;
      } else if (status === 429) {
        userMessage = 'Too many requests. Please wait a moment and try again.';
      } else if (status >= 500) {
        userMessage = errRes?.message || 'The server or database is temporarily unavailable. Please retry.';
      } else if (errRes?.isOutsideGeofence || errRes?.reason === 'OUTSIDE_GEOFENCE') {
        setGeoState('OUTSIDE');
        if (errRes.distanceMeters !== undefined && errRes.distanceMeters !== null) {
          setDistanceMeters(errRes.distanceMeters);
        }
        if (errRes.geofence?.distanceMeters !== undefined && errRes.geofence?.distanceMeters !== null) {
          setDistanceMeters(errRes.geofence.distanceMeters);
        }
        if (errRes.nearestLocation) {
          setNearestLocation(errRes.nearestLocation);
        }
        userMessage = errRes.message || 'You are outside your allowed attendance locations.';
      } else if (errRes?.reason === 'NO_ASSIGNED_LOCATION') {
        setGeoState('NO_ASSIGNED_LOCATION');
        userMessage = errRes.message || 'No attendance location has been assigned to your account. Please contact your administrator.';
      } else {
        userMessage = errRes?.message || errRes?.reason || err.message || `${isCompOff ? 'Comp-Off login' : 'Clock in'} failed. Please try again.`;
      }

      setErrorMsg(userMessage);
      if (onError) {
        onError(userMessage);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 z-50 animate-in fade-in duration-150">
      <div
        className="bg-card border border-border rounded-3xl max-w-md w-full shadow-2xl text-left relative flex flex-col max-h-[calc(100dvh-2rem)] sm:max-h-[90vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header - Fixed at top */}
        <div className="shrink-0 p-5 sm:p-6 pb-4 border-b border-border/40 flex items-start justify-between bg-card z-10">
          <div>
            <h2 className="text-xl font-black text-foreground flex items-center gap-2">
              {isCompOff ? (
                <>
                  <Sparkles className="w-5 h-5 text-amber-500" /> Comp-Off Login
                </>
              ) : (
                <>
                  <Clock className="w-5 h-5 text-primary" /> Attendance Clock In
                </>
              )}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5 font-medium">
              {isCompOff
                ? 'Approved off-day work session with GPS location verification.'
                : 'Geofence location verification & shift check-in.'}
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            className="text-muted-foreground hover:text-foreground p-1.5 rounded-lg hover:bg-muted transition-all cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Container with Scrollable Body & Sticky Footer */}
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0 overflow-hidden">
          {/* Scrollable Content Area */}
          <div className="flex-1 min-h-0 overflow-y-auto p-5 sm:p-6 space-y-4">
            {/* Approved Permission Work-Date Banner (CompOff Mode) */}
            {isCompOff && (
              <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-2xl flex items-center justify-between text-xs">
                <div className="flex items-center gap-2.5">
                  <Calendar className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                  <div>
                    <span className="font-bold text-amber-900 dark:text-amber-200 block text-xs">
                      Approved Comp-Off Work Date
                    </span>
                    <span className="text-[11px] text-amber-700 dark:text-amber-300 font-medium">
                      {permission?.workDate
                        ? new Date(permission.workDate).toLocaleDateString(undefined, {
                            weekday: 'short',
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric'
                          })
                        : new Date().toLocaleDateString(undefined, {
                            weekday: 'short',
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric'
                          })}
                    </span>
                  </div>
                </div>
                <span className="px-2 py-0.5 bg-amber-500/20 text-amber-700 dark:text-amber-300 rounded-full font-bold text-[10px] uppercase">
                  Approved
                </span>
              </div>
            )}

            {/* Server Time & Calculated Status Card */}
            <div className="bg-muted/40 border border-border/80 rounded-2xl p-4 grid grid-cols-2 gap-3 text-center">
              <div className="space-y-1">
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">Current Time</span>
                <span className="text-lg font-black font-mono text-foreground block">
                  {statusLoading ? '...' : currentTimeDisplay}
                </span>
              </div>
              <div className="space-y-1 flex flex-col items-center justify-center border-l border-border/60">
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">
                  {isCompOff ? 'Session Type' : 'Attendance Status'}
                </span>
                {isCompOff ? (
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-black uppercase flex items-center gap-1 bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                    <Sparkles className="w-3 h-3 text-amber-500" /> COMP-OFF
                  </span>
                ) : (
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-black uppercase flex items-center gap-1 ${
                    calculatedStatus === 'LATE'
                      ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                      : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                  }`}>
                    {calculatedStatus === 'LATE' ? (
                      <>
                        <AlertTriangle className="w-3 h-3" /> LATE
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-3 h-3" /> PRESENT
                      </>
                    )}
                  </span>
                )}
                {isCompOff ? (
                  <span className="text-[10px] text-muted-foreground font-semibold block">
                    Never marked late
                  </span>
                ) : (
                  calculatedStatus === 'LATE' && lateMinutes > 0 && (
                    <span className="text-[10px] text-amber-600 dark:text-amber-400 font-bold block">
                      {formatLateDuration(lateMinutes)}
                    </span>
                  )
                )}
              </div>
            </div>

          {/* STATE 1: DETECTING LOCATION */}
          {geoState === 'DETECTING' && (
            <div className="p-6 rounded-2xl border border-primary/20 bg-primary/5 text-center space-y-3 animate-in fade-in">
              <div className="flex items-center justify-center">
                <Navigation className="w-8 h-8 text-primary animate-pulse" />
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-bold text-foreground">Detecting your location...</h4>
                <p className="text-xs text-muted-foreground">Verifying GPS coordinates against office geofence.</p>
              </div>
            </div>
          )}

          {/* STATE 2A: GPS PERMISSION DENIED */}
          {geoState === 'PERMISSION_DENIED' && (
            <div className="p-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 text-left space-y-2 animate-in fade-in">
              <div className="flex items-start gap-2.5">
                <ShieldAlert className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <h4 className="text-xs font-black text-rose-600 dark:text-rose-400 uppercase tracking-wider">
                    Location Permission Required
                  </h4>
                  <p className="text-xs text-rose-700 dark:text-rose-300 font-medium">
                    Location permission is required for office clock-in.
                  </p>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Please allow location access in your browser to verify office attendance, or select an offsite location below.
              </p>
              <div className="pt-1 flex justify-end">
                <button
                  type="button"
                  onClick={() => requestGPSLocation()}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Retry Permission
                </button>
              </div>
            </div>
          )}

          {/* STATE 2B: GPS ERROR / TIMEOUT */}
          {geoState === 'GPS_ERROR' && (
            <div className="p-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 text-left space-y-2 animate-in fade-in">
              <div className="flex items-start gap-2.5">
                <Navigation className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <h4 className="text-xs font-black text-amber-600 dark:text-amber-400 uppercase tracking-wider">
                    GPS Unavailable
                  </h4>
                  <p className="text-xs text-amber-700 dark:text-amber-300 font-medium">
                    Unable to get your current location. Please retry.
                  </p>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Ensure device location services are turned on, or select Home / Other below if working offsite.
              </p>
              <div className="pt-1 flex justify-end">
                <button
                  type="button"
                  onClick={() => requestGPSLocation()}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Retry Location
                </button>
              </div>
            </div>
          )}

          {/* STATE 3: INSIDE GEOFENCE (AUTOMATIC LOCATION VERIFIED) */}
          {geoState === 'INSIDE' && (
            <div className="p-5 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 space-y-3 animate-in fade-in text-left">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-emerald-500/20 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <div>
                  <h4 className="text-sm font-extrabold text-emerald-700 dark:text-emerald-400">
                    Location Verified
                  </h4>
                  <p className="text-xs text-emerald-600/90 dark:text-emerald-300/90 font-semibold">
                    You are within the permitted location.
                  </p>
                </div>
              </div>

              <div className="bg-background/80 rounded-xl p-3 text-xs space-y-1.5 border border-emerald-500/20 font-medium">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Office Location:</span>
                  <span className="font-bold text-foreground">{officeName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Distance:</span>
                  <span className="font-bold text-emerald-600 dark:text-emerald-400 font-mono">
                    {formatDistance(distanceMeters)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Allowed Radius:</span>
                  <span className="font-bold text-foreground font-mono">{allowedRadius} m</span>
                </div>
              </div>
            </div>
          )}

          {/* STATE 4: OUTSIDE GEOFENCE CARD */}
          {geoState === 'OUTSIDE' && (
            <div className="p-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 space-y-2.5 text-left animate-in fade-in">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />
                <h4 className="text-xs font-black uppercase text-amber-700 dark:text-amber-300 tracking-wider">
                  Outside Permitted Location
                </h4>
              </div>
              <p className="text-xs text-amber-800/90 dark:text-amber-200/90 font-medium">
                You are outside your allowed attendance locations.
              </p>

              <div className="bg-background/80 rounded-xl p-3 text-xs space-y-1.5 border border-amber-500/20 font-medium">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Nearest Location:</span>
                  <span className="font-bold text-foreground">{officeName}</span>
                </div>
                {distanceMeters !== null && distanceMeters !== Infinity && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Nearest Distance:</span>
                    <span className="font-bold text-amber-600 dark:text-amber-400 font-mono">
                      {formatDistance(distanceMeters)}
                    </span>
                  </div>
                )}
                {allowedRadius !== null && allowedRadius !== undefined && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Allowed Radius:</span>
                    <span className="font-bold text-foreground font-mono">{allowedRadius} m</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* STATE 4b: NO ASSIGNED LOCATION */}
          {geoState === 'NO_ASSIGNED_LOCATION' && (
            <div className="p-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 space-y-2 text-left animate-in fade-in">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0" />
                <h4 className="text-xs font-black uppercase text-rose-700 dark:text-rose-300 tracking-wider">
                  No Location Assigned
                </h4>
              </div>
              <p className="text-xs text-rose-800/90 dark:text-rose-200/90 font-medium">
                No attendance location has been assigned to your account. Please contact your administrator.
              </p>
            </div>
          )}

          {/* OFFSITE WORK LOCATION SELECTOR (WHEN OUTSIDE OR GPS DENIED/UNAVAILABLE) */}
          {(geoState === 'OUTSIDE' || geoState === 'NO_ASSIGNED_LOCATION' || geoState === 'PERMISSION_DENIED' || geoState === 'GPS_ERROR') && (
            <div className="space-y-3 text-left animate-in fade-in">
              <label className="text-xs font-bold text-foreground block">
                Where are you working from? <span className="text-rose-500">*</span>
              </label>
              
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setOutsideWorkLocation('HOME')}
                  className={`p-3.5 rounded-2xl border flex items-center justify-center gap-2 text-center transition-all cursor-pointer ${
                    outsideWorkLocation === 'HOME'
                      ? 'bg-primary/10 border-primary text-primary font-black shadow-sm ring-2 ring-primary/20'
                      : 'bg-background border-border/80 text-muted-foreground hover:bg-muted/50 font-medium'
                  }`}
                >
                  <Home className="w-4 h-4" />
                  <span className="text-xs font-bold">Home (Remote)</span>
                </button>

                <button
                  type="button"
                  onClick={() => setOutsideWorkLocation('OTHER')}
                  className={`p-3.5 rounded-2xl border flex items-center justify-center gap-2 text-center transition-all cursor-pointer ${
                    outsideWorkLocation === 'OTHER'
                      ? 'bg-primary/10 border-primary text-primary font-black shadow-sm ring-2 ring-primary/20'
                      : 'bg-background border-border/80 text-muted-foreground hover:bg-muted/50 font-medium'
                  }`}
                >
                  <MapPin className="w-4 h-4" />
                  <span className="text-xs font-bold">Other</span>
                </button>
              </div>

              {/* Reason Input */}
              <div className="space-y-1 pt-1">
                <label className="text-xs font-bold text-foreground block">
                  Location / Reason {outsideWorkLocation === 'OTHER' && <span className="text-rose-500">*</span>}
                </label>
                <input
                  type="text"
                  value={workLocationOther}
                  onChange={(e) => setWorkLocationOther(e.target.value)}
                  placeholder={outsideWorkLocation === 'OTHER' ? 'Enter specific location or reason (required)' : 'Working remotely / from home today (optional)'}
                  className="w-full bg-background border border-border rounded-xl px-3.5 py-2.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                  required={outsideWorkLocation === 'OTHER'}
                />
              </div>
            </div>
          )}

          {/* Inline Error Message */}
          {errorMsg && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-xs font-bold text-rose-600 dark:text-rose-400">
              {errorMsg}
            </div>
          )}

          </div>

          {/* Action Buttons - Fixed at bottom */}
          <div className="shrink-0 flex items-center justify-end gap-3 p-4 sm:p-5 border-t border-border/40 bg-card/90 backdrop-blur-sm z-10">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2.5 text-xs font-bold border border-border rounded-xl hover:bg-muted text-foreground transition-all cursor-pointer"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={loading || geoState === 'DETECTING' || isOtherInvalid}
              className={`px-5 py-2.5 text-xs font-bold text-white rounded-xl shadow-md transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                isCompOff
                  ? 'bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700'
                  : 'bg-primary hover:bg-primary-hover'
              }`}
            >
              {loading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" /> {isCompOff ? 'Starting Session...' : 'Clocking In...'}
                </>
              ) : geoState === 'DETECTING' ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" /> Verifying Location...
                </>
              ) : (
                isCompOff ? 'Start Comp-Off Session' : 'Confirm Clock In'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
