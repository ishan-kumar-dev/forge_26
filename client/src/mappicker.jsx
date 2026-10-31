import { CircleMarker, MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import { useEffect } from 'react';

// Default view is India until the citizen shares GPS or taps the map.
const fallbackCenter = [22.5, 79], fallbackZoom = 4;
function ClickToPin({ onPick }) { useMapEvents({ click: e => onPick(e.latlng.lat.toFixed(6), e.latlng.lng.toFixed(6)) }); return null; }
function Follow({ point }) { const map = useMap(); useEffect(() => { if (point) map.setView(point, Math.max(map.getZoom(), 16)); }, [point?.[0], point?.[1]]); return null; }
export default function MapPicker({ latitude, longitude, onPick }) {
 const point = latitude && longitude ? [+latitude, +longitude] : null;
 return <MapContainer className="pickerMap" center={point || fallbackCenter} zoom={point ? 16 : fallbackZoom} scrollWheelZoom={false}><TileLayer attribution="© OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/><ClickToPin onPick={onPick}/><Follow point={point}/>{point && <CircleMarker center={point} radius={9} pathOptions={{ color: '#e96a3d', fillOpacity: .7 }}/>}</MapContainer>;
}
