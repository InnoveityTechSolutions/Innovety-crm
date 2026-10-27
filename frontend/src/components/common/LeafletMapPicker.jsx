import React, { useEffect, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Search,
  MapPin,
  Navigation,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Compass,
  X,
  Building,
  GraduationCap,
  Briefcase,
  Landmark,
  Map,
  CornerDownLeft
} from 'lucide-react';

// Tile & Geocoding URLs with Photon by Komoot (OpenStreetMap data) & env configurability
const PHOTON_API_URL = (import.meta.env.VITE_PHOTON_API_URL || import.meta.env.VITE_GEOCODE_SEARCH_URL || 'https://photon.komoot.io/api/').trim();
const PHOTON_REVERSE_URL = (import.meta.env.VITE_PHOTON_REVERSE_URL || 'https://photon.komoot.io/reverse').trim();
const NOMINATIM_REVERSE_URL = (import.meta.env.VITE_GEOCODE_REVERSE_URL || 'https://nominatim.openstreetmap.org/reverse').trim();
const OSM_TILE_URL = (import.meta.env.VITE_OSM_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png').trim();
const OSM_ATTRIBUTION = import.meta.env.VITE_OSM_ATTRIBUTION || '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors';

// Custom SVG Leaflet Pin (Emerald theme matching CRM design)
const createCustomPinIcon = () => {
  return L.divIcon({
    className: 'custom-leaflet-marker-pin',
    html: `
      <div style="position: relative; width: 34px; height: 42px; transform: translate(-50%, -100%); cursor: grab;">
        <svg width="34" height="42" viewBox="0 0 34 42" fill="none" xmlns="http://www.w3.org/2000/svg" style="filter: drop-shadow(0 4px 8px rgba(0,0,0,0.35));">
          <path d="M17 0C7.61116 0 0 7.61116 0 17C0 27.5 14.5 40.5 16.14 41.94C16.63 42.37 17.37 42.37 17.86 41.94C19.5 40.5 34 27.5 34 17C34 7.61116 26.3888 0 17 0Z" fill="#10B981" stroke="#FFFFFF" stroke-width="2.5"/>
          <circle cx="17" cy="17" r="6" fill="#FFFFFF"/>
        </svg>
      </div>
    `,
    iconSize: [34, 42],
    iconAnchor: [17, 42],
    popupAnchor: [0, -42]
  });
};

// Format Photon GeoJSON Feature into structured and human-readable place object
function parsePhotonFeature(feature) {
  const p = feature.properties || {};
  const geom = feature.geometry || {};
  const coords = geom.coordinates || [];
  const lon = parseFloat(Number(coords[0]).toFixed(6));
  const lat = parseFloat(Number(coords[1]).toFixed(6));

  // Determine readable title
  const title = p.name || p.street || p.city || p.county || 'Selected Location';

  // Construct structured address components
  const addressParts = [];
  const streetPart = p.housenumber && p.street
    ? `${p.housenumber} ${p.street}`
    : p.street;
  if (streetPart && streetPart !== title) addressParts.push(streetPart);
  if (p.locality && p.locality !== title && !addressParts.includes(p.locality)) addressParts.push(p.locality);
  if (p.district && p.district !== title && !addressParts.includes(p.district)) addressParts.push(p.district);
  if (p.city && p.city !== title && !addressParts.includes(p.city)) addressParts.push(p.city);
  if (p.county && p.county !== title && !addressParts.includes(p.county)) addressParts.push(p.county);
  if (p.state && !addressParts.includes(p.state)) addressParts.push(p.state);
  if (p.postcode && !addressParts.includes(p.postcode)) addressParts.push(p.postcode);
  if (p.country && !addressParts.includes(p.country)) addressParts.push(p.country);

  const readableAddress = addressParts.join(', ');
  const fullDisplayName = addressParts.length > 0 && title !== readableAddress
    ? `${title}, ${readableAddress}`
    : title;

  const category = p.osm_value || p.osm_key || p.type || 'place';

  return {
    id: p.osm_id || `${lat}_${lon}`,
    lat,
    lon,
    name: title,
    address: readableAddress || title,
    fullDisplayName,
    category,
    postcode: p.postcode,
    city: p.city || p.county
  };
}

// Category Icon selector
function getCategoryIcon(category) {
  const cat = String(category || '').toLowerCase();
  if (cat.includes('college') || cat.includes('school') || cat.includes('university')) {
    return <GraduationCap className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />;
  }
  if (cat.includes('office') || cat.includes('commercial') || cat.includes('industrial') || cat.includes('company')) {
    return <Briefcase className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />;
  }
  if (cat.includes('hospital') || cat.includes('building') || cat.includes('hotel')) {
    return <Building className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />;
  }
  if (cat.includes('monument') || cat.includes('historic') || cat.includes('tourism')) {
    return <Landmark className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />;
  }
  return <MapPin className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />;
}

export default function LeafletMapPicker({
  latitude = 12.920490,
  longitude = 80.121647,
  address = '',
  radiusMeters = 200,
  onLocationChange,
  onCaptureGps,
  gpsCapturing = false
}) {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markerInstanceRef = useRef(null);
  const circleInstanceRef = useRef(null);
  const lastReverseTimeRef = useRef(0);
  const abortControllerRef = useRef(null);
  const debounceTimerRef = useRef(null);

  const [searchQuery, setSearchQuery] = useState(address || '');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchNotFound, setSearchNotFound] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [tileError, setTileError] = useState(false);
  const [isSearchingFocused, setIsSearchingFocused] = useState(false);

  const currentLat = Number(latitude) || 12.920490;
  const currentLng = Number(longitude) || 80.121647;

  // Reverse Geocoding: Tries Photon reverse first, with graceful Nominatim fallback
  const performReverseGeocode = useCallback(async (lat, lng) => {
    const now = Date.now();
    const elapsed = now - lastReverseTimeRef.current;
    if (elapsed < 500) {
      await new Promise((r) => setTimeout(r, 500 - elapsed));
    }
    lastReverseTimeRef.current = Date.now();

    // 1. Try Photon reverse
    try {
      const photonRevUrl = `${PHOTON_REVERSE_URL}?lat=${lat}&lon=${lng}`;
      const res = await fetch(photonRevUrl, { headers: { Accept: 'application/json' } });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data?.features) && data.features.length > 0) {
          const parsed = parsePhotonFeature(data.features[0]);
          if (parsed.fullDisplayName) return parsed.fullDisplayName;
        }
      }
    } catch (err) {
      console.warn('[LeafletMapPicker] Photon reverse notice:', err);
    }

    // 2. Fallback to Nominatim reverse
    try {
      const nomUrl = `${NOMINATIM_REVERSE_URL}?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;
      const res = await fetch(nomUrl, { headers: { Accept: 'application/json' } });
      if (res.ok) {
        const data = await res.json();
        if (data && data.display_name) {
          return data.display_name;
        }
      }
    } catch (err) {
      console.warn('[LeafletMapPicker] Nominatim reverse notice:', err);
    }

    return `Selected Location (${lat.toFixed(6)}, ${lng.toFixed(6)})`;
  }, []);

  // Update coordinates & notify parent form
  const handleCoordinateChange = useCallback(async (newLat, newLng, overrideAddress = null, overrideName = null) => {
    let resolvedAddress = overrideAddress;
    if (!resolvedAddress) {
      resolvedAddress = await performReverseGeocode(newLat, newLng);
    }

    setSearchQuery(resolvedAddress);
    if (onLocationChange) {
      onLocationChange({
        latitude: newLat,
        longitude: newLng,
        address: resolvedAddress,
        name: overrideName
      });
    }
  }, [onLocationChange, performReverseGeocode]);

  // 1. Initialize Real Leaflet Map Instance
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    // Create Leaflet Map instance
    const map = L.map(mapContainerRef.current, {
      center: [currentLat, currentLng],
      zoom: 16,
      zoomControl: true,
      attributionControl: true
    });
    mapInstanceRef.current = map;

    // Real OpenStreetMap Tile Layer
    const tileLayer = L.tileLayer(OSM_TILE_URL, {
      attribution: OSM_ATTRIBUTION,
      maxZoom: 19
    }).addTo(map);

    tileLayer.on('tileerror', () => {
      setTileError(true);
    });

    // Real Draggable Marker
    const marker = L.marker([currentLat, currentLng], {
      icon: createCustomPinIcon(),
      draggable: true,
      title: 'Attendance Clock-In Geofence Location'
    }).addTo(map);
    markerInstanceRef.current = marker;

    // Real Geofence Boundary Circle
    const circle = L.circle([currentLat, currentLng], {
      radius: Number(radiusMeters) || 200,
      color: '#10B981',
      fillColor: '#10B981',
      fillOpacity: 0.22,
      weight: 2
    }).addTo(map);
    circleInstanceRef.current = circle;

    // Glide circle seamlessly with marker dragging
    marker.on('drag', () => {
      const latlng = marker.getLatLng();
      circle.setLatLng(latlng);
    });

    // Marker Drag End Listener: capture updated coords & reverse geocode
    marker.on('dragend', () => {
      const latlng = marker.getLatLng();
      const newLat = parseFloat(latlng.lat.toFixed(6));
      const newLng = parseFloat(latlng.lng.toFixed(6));
      circle.setLatLng([newLat, newLng]);
      handleCoordinateChange(newLat, newLng);
    });

    // Map Click Listener: reposition marker & circle to clicked point
    map.on('click', (e) => {
      const newLat = parseFloat(e.latlng.lat.toFixed(6));
      const newLng = parseFloat(e.latlng.lng.toFixed(6));
      marker.setLatLng([newLat, newLng]);
      circle.setLatLng([newLat, newLng]);
      map.panTo([newLat, newLng], { animate: true });
      handleCoordinateChange(newLat, newLng);
    });

    // Responsive invalidation inside modal
    const resizeTimer = setTimeout(() => {
      map.invalidateSize();
    }, 200);

    let resizeObserver = null;
    if (window.ResizeObserver && mapContainerRef.current) {
      resizeObserver = new ResizeObserver(() => {
        if (mapInstanceRef.current) {
          mapInstanceRef.current.invalidateSize();
        }
      });
      resizeObserver.observe(mapContainerRef.current);
    }

    return () => {
      clearTimeout(resizeTimer);
      if (resizeObserver) resizeObserver.disconnect();
      map.remove();
      mapInstanceRef.current = null;
      markerInstanceRef.current = null;
      circleInstanceRef.current = null;
    };
  }, []); // Run once on mount

  // 2. Synchronize circle radius when radiusMeters prop changes
  useEffect(() => {
    if (circleInstanceRef.current) {
      circleInstanceRef.current.setRadius(Number(radiusMeters) || 200);
    }
  }, [radiusMeters]);

  // 3. Synchronize marker and circle position when coordinates change from parent
  useEffect(() => {
    if (!mapInstanceRef.current || !markerInstanceRef.current || !circleInstanceRef.current) return;
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (isNaN(lat) || isNaN(lng)) return;

    const currentPos = markerInstanceRef.current.getLatLng();
    const diff = Math.abs(currentPos.lat - lat) + Math.abs(currentPos.lng - lng);
    if (diff > 0.00001) {
      markerInstanceRef.current.setLatLng([lat, lng]);
      circleInstanceRef.current.setLatLng([lat, lng]);
      mapInstanceRef.current.panTo([lat, lng], { animate: true });
    }
  }, [latitude, longitude]);

  // 4. Synchronize address text when prop changes
  useEffect(() => {
    if (address && !isSearchingFocused) {
      setSearchQuery(address);
    }
  }, [address, isSearchingFocused]);

  // Photon Query Helper with Location Bias
  const executePhotonFetch = async (queryText, centerLat, centerLon, signal) => {
    const url = new URL(PHOTON_API_URL);
    url.searchParams.set('q', queryText);
    url.searchParams.set('limit', '6');
    if (centerLat != null && centerLon != null && !isNaN(centerLat) && !isNaN(centerLon)) {
      url.searchParams.set('lat', centerLat.toFixed(6));
      url.searchParams.set('lon', centerLon.toFixed(6));
    }

    const res = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
      signal
    });

    if (res.status === 429) {
      const err = new Error('RATE_LIMITED');
      err.code = 429;
      throw err;
    }
    if (!res.ok) {
      const err = new Error(`HTTP_${res.status}`);
      err.code = res.status;
      throw err;
    }

    const data = await res.json();
    return Array.isArray(data?.features) ? data.features : [];
  };

  // Execute Search query with Location Bias and Multi-part Fallback
  const performSearch = useCallback(async (textToSearch) => {
    const query = String(textToSearch || '').trim();
    if (!query || query.length < 2) {
      setSearchResults([]);
      setSearchNotFound(false);
      setSearchError('');
      return;
    }

    // Cancel any in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setSearchLoading(true);
    setSearchError('');
    setSearchNotFound(false);

    // Current map center for location proximity bias
    const center = mapInstanceRef.current
      ? mapInstanceRef.current.getCenter()
      : { lat: currentLat, lng: currentLng };

    try {
      // 1. Direct query with location bias
      let rawFeatures = await executePhotonFetch(query, center.lat, center.lng, controller.signal);

      // 2. Intelligent fallback for composite/comma queries e.g. "Madras Christian College, East Tambaram, Chennai"
      if (rawFeatures.length === 0 && query.includes(',')) {
        const segments = query.split(',').map((s) => s.trim()).filter(Boolean);
        // Try Landmark + Suburb
        if (segments.length >= 2) {
          const combo = `${segments[0]} ${segments[1]}`;
          rawFeatures = await executePhotonFetch(combo, center.lat, center.lng, controller.signal);
        }
        // Try Landmark alone with location bias
        if (rawFeatures.length === 0 && segments[0].length >= 3) {
          rawFeatures = await executePhotonFetch(segments[0], center.lat, center.lng, controller.signal);
        }
      }

      // 3. Fallback: if long multi-word query returns 0, try the first 2-3 landmark words
      if (rawFeatures.length === 0) {
        const words = query.split(/\s+/).filter(Boolean);
        if (words.length > 3) {
          const landmarkSubset = words.slice(0, 3).join(' ');
          rawFeatures = await executePhotonFetch(landmarkSubset, center.lat, center.lng, controller.signal);
        }
      }

      if (rawFeatures.length > 0) {
        const parsed = rawFeatures.map(parsePhotonFeature).filter((f) => !isNaN(f.lat) && !isNaN(f.lon));
        setSearchResults(parsed);
        setSearchNotFound(false);
      } else {
        setSearchResults([]);
        setSearchNotFound(true);
      }
    } catch (err) {
      if (err.name === 'AbortError') return;

      console.error('[LeafletMapPicker] Search request notice:', err);
      if (err.code === 429 || err.message === 'RATE_LIMITED') {
        setSearchError('Search request limit reached. Please wait a moment and try again.');
      } else {
        setSearchError('Geocoding service unavailable. You can click anywhere on the map or drag the pin to set coordinates.');
      }
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  }, [currentLat, currentLng]);

  // Debounced auto-search when typing (500ms delay, minimum 3 chars)
  const handleInputChange = (e) => {
    const val = e.target.value;
    setSearchQuery(val);
    setSearchNotFound(false);
    setSearchError('');

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    if (val.trim().length >= 3) {
      debounceTimerRef.current = setTimeout(() => {
        performSearch(val);
      }, 500);
    } else {
      setSearchResults([]);
    }
  };

  // Immediate search on Enter key or button click
  const handleSubmitSearch = (e) => {
    if (e) {
      if (typeof e.preventDefault === 'function') e.preventDefault();
      if (typeof e.stopPropagation === 'function') e.stopPropagation();
    }
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    performSearch(searchQuery);
  };

  // Select place from search results dropdown
  const handleSelectResult = (item) => {
    setSearchQuery(item.fullDisplayName);
    setSearchResults([]);
    setSearchNotFound(false);
    setSearchError('');
    setIsSearchingFocused(false);

    if (mapInstanceRef.current && markerInstanceRef.current && circleInstanceRef.current) {
      markerInstanceRef.current.setLatLng([item.lat, item.lon]);
      circleInstanceRef.current.setLatLng([item.lat, item.lon]);
      mapInstanceRef.current.setView([item.lat, item.lon], 17);
    }

    if (onLocationChange) {
      onLocationChange({
        latitude: item.lat,
        longitude: item.lon,
        address: item.fullDisplayName,
        name: item.name
      });
    }
  };

  return (
    <div className="space-y-3">
      {/* 1. Location Search Input Bar with Photon OSM & Proximity Bias */}
      <div className="relative">
        <div className="relative flex items-center gap-1.5">
          <div className="relative flex-1 flex items-center">
            <Search className="absolute left-3.5 h-4 w-4 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={handleInputChange}
              onFocus={() => setIsSearchingFocused(true)}
              onBlur={() => setTimeout(() => setIsSearchingFocused(false), 250)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.stopPropagation();
                  handleSubmitSearch(e);
                }
              }}
              placeholder="Search place, college, office, landmark, address, or postal code..."
              className="w-full pl-10 pr-9 py-2.5 text-xs font-semibold rounded-2xl border border-border/80 bg-muted/20 focus:bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all outline-none text-foreground shadow-2xs"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setSearchResults([]);
                  setSearchNotFound(false);
                  setSearchError('');
                }}
                className="absolute right-3 p-1 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                title="Clear input"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={handleSubmitSearch}
            disabled={searchLoading || !searchQuery.trim()}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-2xl bg-primary text-xs font-bold text-primary-foreground hover:bg-primary/90 active:scale-95 transition-all cursor-pointer disabled:opacity-50 disabled:pointer-events-none shadow-xs shrink-0"
            title="Search place (Enter)"
          >
            {searchLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <CornerDownLeft className="h-3.5 w-3.5" />
            )}
            <span className="hidden sm:inline">Search</span>
          </button>
        </div>

        {/* Search Results Dropdown List */}
        {searchResults.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-1.5 bg-card border border-border rounded-2xl shadow-xl z-50 overflow-hidden divide-y divide-border/50 max-h-64 overflow-y-auto">
            <div className="px-3.5 py-1.5 bg-muted/40 text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center justify-between">
              <span>Matching Locations ({searchResults.length})</span>
              <button
                type="button"
                onClick={() => setSearchResults([])}
                className="text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
            {searchResults.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelectResult(item)}
                className="w-full text-left p-3 hover:bg-primary/5 transition-colors cursor-pointer flex items-start gap-2.5 group"
              >
                {getCategoryIcon(item.category)}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-bold text-foreground truncate group-hover:text-primary transition-colors">
                      {item.name}
                    </p>
                    {item.category && item.category !== 'place' && (
                      <span className="text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground shrink-0">
                        {item.category.replace('_', ' ')}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5 leading-tight">
                    {item.address}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* No Results Warning */}
        {searchNotFound && (
          <div className="mt-1.5 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400 text-xs flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span className="text-[11px]">
              No places found matching "{searchQuery}". The location might not be indexed in OpenStreetMap yet. Try searching by landmark, street, or city, or click directly on the map.
            </span>
          </div>
        )}

        {/* Search Error / Rate Limit Warning */}
        {searchError && (
          <div className="mt-1.5 p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 text-xs flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span className="text-[11px]">{searchError}</span>
          </div>
        )}
      </div>

      {/* 2. Capture Current GPS Button */}
      {onCaptureGps && (
        <button
          type="button"
          onClick={onCaptureGps}
          disabled={gpsCapturing}
          className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-2xl border border-primary/30 bg-primary/10 text-xs font-bold text-primary hover:bg-primary/20 active:scale-95 transition-all cursor-pointer disabled:opacity-50 shadow-xs"
        >
          <Navigation className={`h-3.5 w-3.5 ${gpsCapturing ? 'animate-spin' : ''}`} />
          <span>{gpsCapturing ? 'Capturing Current GPS...' : 'Capture Current GPS'}</span>
        </button>
      )}

      {/* 3. Real Leaflet + OpenStreetMap Canvas */}
      <div className="relative rounded-2xl border border-border/70 overflow-hidden bg-muted/20 shadow-inner h-72 sm:h-80 w-full">
        {/* Leaflet DOM container */}
        <div ref={mapContainerRef} className="w-full h-full" style={{ zIndex: 1 }} />

        {/* Tile Error Notification */}
        {tileError && (
          <div className="absolute top-2 left-2 right-2 p-2 rounded-xl bg-amber-500/90 text-white text-[11px] font-semibold flex items-center gap-1.5 shadow-md z-20">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            <span>Map tiles taking longer to load. Geofence pin & coordinates remain fully active.</span>
          </div>
        )}

        {/* Real Map Active Overlay Pill */}
        <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between pointer-events-none z-10">
          <div className="px-3 py-1 rounded-xl bg-background/90 backdrop-blur-md border border-border/60 text-[10px] font-semibold text-muted-foreground shadow-xs flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
            <span>OpenStreetMap Active • {radiusMeters}m Geofence</span>
          </div>
          <div className="px-2.5 py-1 rounded-xl bg-background/90 backdrop-blur-md border border-border/60 text-[10px] font-medium text-muted-foreground shadow-xs hidden sm:flex items-center gap-1">
            <Compass className="h-3 w-3 text-primary" />
            <span>Drag pin or click map to move</span>
          </div>
        </div>
      </div>
    </div>
  );
}
