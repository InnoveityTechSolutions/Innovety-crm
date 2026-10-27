/**
 * InnovEity CRM - Geolocation Helper Suite
 * Standardizes browser GPS capture, error states, and reverse geocoding
 */

export const captureDeviceCoordinates = () => {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !navigator.geolocation) {
      return reject(new Error('Geolocation is not supported by your browser.'));
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = parseFloat(position.coords.latitude.toFixed(6));
        const lon = parseFloat(position.coords.longitude.toFixed(6));
        resolve({ latitude: lat, longitude: lon, lat, lon });
      },
      (error) => {
        console.warn('[Geolocation] Position error:', error);
        if (error.code === 1) { // PERMISSION_DENIED
          reject(new Error('Location permission is required to verify your location before Clock-Out. Please allow location access in your browser.'));
        } else if (error.code === 2) { // POSITION_UNAVAILABLE
          reject(new Error('GPS location is unavailable. Please enable device location services and retry.'));
        } else if (error.code === 3) { // TIMEOUT
          reject(new Error('Location request timed out. Please check your GPS signal and retry.'));
        } else {
          reject(new Error(error.message || 'Unable to determine your current location. Please retry.'));
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  });
};

export const reverseGeocodeCoordinates = async (lat, lon) => {
  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`, {
      headers: {
        'User-Agent': 'InnovEity-CRM/1.0'
      }
    });
    if (response.ok) {
      const data = await response.json();
      if (data && data.display_name) {
        return data.display_name;
      }
    }
  } catch (err) {
    console.warn('[ReverseGeocode] Geocoding lookup failed:', err);
  }
  return null;
};
