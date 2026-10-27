import React from 'react';
import { ExternalLink, MapPinOff } from 'lucide-react';

/**
 * Validates latitude and longitude coordinates.
 * Returns true only if coordinates are valid numbers in range [-90, 90] and [-180, 180],
 * and not (0,0) which indicates an uninitialized GPS coordinate.
 */
export const isValidCoordinate = (latitude, longitude) => {
  if (latitude === null || latitude === undefined || longitude === null || longitude === undefined) {
    return false;
  }
  const lat = typeof latitude === 'number' ? latitude : parseFloat(latitude);
  const lon = typeof longitude === 'number' ? longitude : parseFloat(longitude);
  
  if (isNaN(lat) || isNaN(lon)) return false;
  if (lat < -90 || lat > 90) return false;
  if (lon < -180 || lon > 180) return false;
  if (lat === 0 && lon === 0) return false;
  
  return true;
};

export default function AttendanceMapEmbed({ latitude, longitude, title = 'Location Map', height = 'h-44 sm:h-48' }) {
  const valid = isValidCoordinate(latitude, longitude);

  if (!valid) {
    return (
      <div className={`w-full ${height} rounded-xl border border-border/40 bg-muted/20 flex flex-col items-center justify-center p-4 text-center`}>
        <MapPinOff className="h-6 w-6 text-muted-foreground/60 mb-2" />
        <span className="text-xs font-semibold text-muted-foreground">Location data unavailable</span>
        <span className="text-[10px] text-muted-foreground/75 mt-0.5">No valid GPS coordinates were recorded for this action.</span>
      </div>
    );
  }

  const numLat = typeof latitude === 'number' ? latitude : parseFloat(latitude);
  const numLon = typeof longitude === 'number' ? longitude : parseFloat(longitude);
  const embedUrl = `https://www.google.com/maps?q=${numLat},${numLon}&output=embed`;
  const externalUrl = `https://www.google.com/maps?q=${numLat},${numLon}`;

  return (
    <div className="w-full space-y-2">
      <div className={`relative w-full ${height} rounded-xl overflow-hidden border border-border/40 shadow-sm bg-muted/20`}>
        <iframe
          src={embedUrl}
          title={title}
          loading="lazy"
          className="w-full h-full border-0"
          referrerPolicy="no-referrer-when-downgrade"
        />
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-[11px] font-mono text-muted-foreground">
          {numLat.toFixed(6)}, {numLon.toFixed(6)}
        </span>
        <a
          href={externalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 font-semibold text-primary hover:text-primary/80 hover:underline transition-colors"
          title="Open coordinate location in Google Maps"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          <span>Open in Google Maps</span>
        </a>
      </div>
    </div>
  );
}
