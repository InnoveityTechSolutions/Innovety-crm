import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import { reverseGeocodeCoordinates } from '../../utils/geolocationHelper';
import {
  MapPin,
  Clock,
  AlertTriangle,
  CheckCircle2,
  X,
  RefreshCw,
  ShieldCheck,
  Calendar,
  Sparkles,
  Info
} from 'lucide-react';

export default function CompOffLoginModal({ isOpen, onClose, onSuccess, onError, permission }) {
  const [geoState, setGeoState] = useState('IDLE'); // 'IDLE' | 'DETECTING' | 'INSIDE' | 'OUTSIDE' | 'ERROR'
  const [coords, setCoords] = useState({ latitude: null, longitude: null });
  const [distanceMeters, setDistanceMeters] = useState(null);
  const [matchedLocation, setMatchedLocation] = useState(null);
  const [locationReason, setLocationReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (isOpen) {
      setLocationReason('');
      setErrorMsg('');
      setMatchedLocation(null);
      setDistanceMeters(null);
      requestGPSAndVerify();
    }
  }, [isOpen]);

  const requestGPSAndVerify = () => {
    setGeoState('DETECTING');
    setErrorMsg('');

    if (!navigator.geolocation) {
      setGeoState('OUTSIDE');
      setErrorMsg('Geolocation is not supported by your browser. Please provide a reason below.');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = parseFloat(position.coords.latitude.toFixed(6));
        const lon = parseFloat(position.coords.longitude.toFixed(6));
        setCoords({ latitude: lat, longitude: lon });

        try {
          const res = await api.post('/attendance/verify-location', { latitude: lat, longitude: lon });
          const evalData = res.data;

          if (evalData.status === 'INSIDE') {
            setGeoState('INSIDE');
            setMatchedLocation(evalData.matchedLocation || null);
            setDistanceMeters(evalData.distanceMeters ?? null);
          } else {
            setGeoState('OUTSIDE');
            setMatchedLocation(evalData.matchedLocation || null);
            setDistanceMeters(evalData.distanceMeters ?? null);
          }
        } catch (err) {
          console.warn('Geofence verification error:', err);
          // If server evaluation fails, default to OUTSIDE so reason can be collected safely
          setGeoState('OUTSIDE');
        }
      },
      (error) => {
        console.warn('GPS location error:', error);
        setGeoState('OUTSIDE');
        setErrorMsg('Could not detect GPS location. A location reason is required.');
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
    );
  };

  const handleStartSession = async (e) => {
    e?.preventDefault();
    setErrorMsg('');

    if (geoState === 'OUTSIDE' && (!locationReason || !locationReason.trim())) {
      setErrorMsg('Please provide a reason for logging in outside the permitted office location.');
      return;
    }

    try {
      setLoading(true);

      let address = null;
      let locationStr = null;
      if (coords.latitude && coords.longitude) {
        address = await reverseGeocodeCoordinates(coords.latitude, coords.longitude);
        locationStr = address
          ? `${address} (Lat: ${coords.latitude}, Lon: ${coords.longitude})`
          : `Lat: ${coords.latitude}, Lon: ${coords.longitude}`;
      }

      const payload = {
        latitude: coords.latitude,
        longitude: coords.longitude,
        locationReason: geoState === 'OUTSIDE' ? locationReason.trim() : null,
        address: address || null,
        location: locationStr || null
      };

      const res = await api.post('/comp-off/sessions/login', payload);
      const sessionData = res.data;

      if (onSuccess) {
        onSuccess(sessionData);
      }
      onClose();
    } catch (err) {
      console.error('Comp-Off Login Error:', err);
      const message = err.response?.data?.message || err.message || 'Failed to start Comp-Off session.';
      setErrorMsg(message);
      if (onError) {
        onError(message);
      }
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg bg-card border border-border/80 rounded-3xl shadow-2xl overflow-hidden text-foreground">
        {/* Header */}
        <div className="relative bg-gradient-to-r from-violet-600 via-purple-600 to-indigo-600 p-6 text-white text-left">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-2xl bg-white/10 backdrop-blur-md border border-white/20">
                <Sparkles className="w-6 h-6 text-yellow-300" />
              </div>
              <div>
                <h3 className="text-lg font-black tracking-tight">Comp-Off Login</h3>
                <p className="text-xs text-white/80 font-medium">Record Off-Day Work Session</p>
              </div>
            </div>
            <button
              onClick={onClose}
              disabled={loading}
              className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Approved Permission Info Card */}
          {permission && (
            <div className="mt-4 p-3 rounded-2xl bg-black/20 border border-white/10 backdrop-blur-md flex items-center gap-3 text-xs">
              <Calendar className="w-4 h-4 text-white/80 shrink-0" />
              <div className="overflow-hidden">
                <span className="font-bold text-white block truncate">
                  Approved Request: {permission.holidayTitle || 'Company Holiday / Weekly Off'}
                </span>
                <span className="text-[11px] text-white/70 block truncate">
                  Reason: {permission.reason || 'Off-day assignment'}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Body Content */}
        <div className="p-6 space-y-5 text-left">
          {/* Key Guideline Pill */}
          <div className="p-3.5 rounded-2xl bg-violet-500/10 border border-violet-500/20 text-xs text-violet-700 dark:text-violet-300 flex items-start gap-2.5">
            <Info className="w-4 h-4 text-violet-600 dark:text-violet-400 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <p className="font-bold">Independent Session Notice</p>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                This Comp-Off work session is tracked independently from normal attendance. Starting now will <strong className="text-foreground">never mark you late</strong>, and your actual working hours will be logged for review.
              </p>
            </div>
          </div>

          {/* Geolocation Verification Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs font-bold text-muted-foreground">
              <span>Location Verification</span>
              <button
                type="button"
                onClick={requestGPSAndVerify}
                disabled={loading || geoState === 'DETECTING'}
                className="flex items-center gap-1 text-primary hover:underline cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${geoState === 'DETECTING' ? 'animate-spin' : ''}`} />
                <span>Re-verify</span>
              </button>
            </div>

            {geoState === 'DETECTING' && (
              <div className="p-4 rounded-2xl border border-border/60 bg-muted/30 flex items-center gap-3 text-xs">
                <RefreshCw className="w-5 h-5 text-primary animate-spin shrink-0" />
                <div>
                  <p className="font-bold text-foreground">Detecting & Verifying Location...</p>
                  <p className="text-[11px] text-muted-foreground">Checking geofence coordinates with office policies</p>
                </div>
              </div>
            )}

            {geoState === 'INSIDE' && (
              <div className="p-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 flex items-center justify-between text-xs">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-xl bg-emerald-500/20 text-emerald-600 dark:text-emerald-400">
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="font-extrabold text-foreground">Inside Permitted Geofence</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {matchedLocation?.name ? `At ${matchedLocation.name}` : 'Office radius verified successfully'}
                      {distanceMeters !== null && ` (${Math.round(distanceMeters)}m from center)`}
                    </p>
                  </div>
                </div>
                <span className="px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-black text-[10px] tracking-wider uppercase">
                  Verified
                </span>
              </div>
            )}

            {geoState === 'OUTSIDE' && (
              <div className="space-y-3">
                <div className="p-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300 flex items-center gap-3 text-xs">
                  <div className="p-2 rounded-xl bg-amber-500/20 text-amber-600 dark:text-amber-400 shrink-0">
                    <AlertTriangle className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="font-extrabold text-foreground">Outside Office Geofence</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      You are outside the designated office premises. A location reason is required and will be flagged for Admin review.
                    </p>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-foreground flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-amber-500" />
                    <span>Location Reason <span className="text-rose-500">*</span></span>
                  </label>
                  <textarea
                    rows={2}
                    value={locationReason}
                    onChange={(e) => setLocationReason(e.target.value)}
                    placeholder="e.g. Working remotely from client site / home with supervisor approval..."
                    className="w-full text-xs p-3 rounded-2xl border border-border/80 bg-background focus:outline-none focus:ring-2 focus:ring-violet-500/50 resize-none"
                    disabled={loading}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Error Message */}
          {errorMsg && (
            <div className="p-3 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 text-xs font-semibold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-2 border-t border-border/40">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2.5 rounded-2xl border border-border/80 text-xs font-bold text-muted-foreground hover:bg-muted/50 transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleStartSession}
              disabled={loading || geoState === 'DETECTING' || (geoState === 'OUTSIDE' && !locationReason.trim())}
              className="flex items-center gap-2 px-6 py-2.5 rounded-2xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white text-xs font-black shadow-lg shadow-violet-600/25 transition active:scale-95 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Logging In...</span>
                </>
              ) : (
                <>
                  <Clock className="w-4 h-4" />
                  <span>Start Comp-Off Session</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
