import { useEffect, useMemo, useRef, useState } from "react";
import L, { type GeoJSON as LeafletGeoJSON, type LayerGroup, type Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";
import Papa from "papaparse";

interface PowerPlant {
  Vattenkraftverk: string;
  Huvudavrinningsområde: string;
  "Prövningsgrupp ID": string;
  Prövningsgrupp: string;
  "Datum för inlämning ansökan": string;
  "Status samverkansprocess": string;
  Län: string;
  Domstol: string;
  Beslut: string;
  "Vattenkraftverk storlek": string;
  Latitude: number;
  Longitude: number;
}

const DEFAULT_CENTER: [number, number] = [62.5, 15.5];
const DEFAULT_ZOOM = 5;

const statusColors: Record<string, string> = {
  "Pågår": "hsl(205 80% 50%)",
  "Ej påbörjad": "hsl(210 10% 60%)",
  "Avslutad": "hsl(170 60% 40%)",
};

const sizeRadius: Record<string, number> = {
  "Storskaliga >10 MW": 8,
  "Medelstora 1,5 - 10 MW": 6,
  "Småskaliga < 1,5 MW": 4,
  "Okänd effekt": 4,
};

function getStatusColor(status: string) {
  return statusColors[status] || "hsl(210 8% 55%)";
}

function getRadius(size: string) {
  return sizeRadius[size] || 4;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function popupContent(plant: PowerPlant) {
  return `
    <div style="min-width:220px;font:13px/1.45 system-ui,sans-serif;color:#0f172a;">
      <div style="font-weight:700;font-size:16px;margin-bottom:8px;">${escapeHtml(plant.Vattenkraftverk)}</div>
      <div><strong>Prövningsgrupp:</strong> ${escapeHtml(plant.Prövningsgrupp || "-")}</div>
      <div><strong>Status:</strong> ${escapeHtml(plant["Status samverkansprocess"] || "-")}</div>
      <div><strong>Storlek:</strong> ${escapeHtml(plant["Vattenkraftverk storlek"] || "-")}</div>
      <div><strong>Län:</strong> ${escapeHtml(plant.Län || "-")}</div>
      <div><strong>Ansökan:</strong> ${escapeHtml(plant["Datum för inlämning ansökan"] || "-")}</div>
      <div><strong>Beslut:</strong> ${escapeHtml(plant.Beslut || "-")}</div>
    </div>
  `;
}

export default function MapView() {
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const plantsLayerRef = useRef<LayerGroup | null>(null);
  const polygonsLayerRef = useRef<LeafletGeoJSON | null>(null);

  const [plants, setPlants] = useState<PowerPlant[]>([]);
  const [geojson, setGeojson] = useState<any>(null);
  const [activeStatus, setActiveStatus] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    if (!mapElementRef.current || mapRef.current) return;

    const map = L.map(mapElementRef.current, {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      zoomControl: true,
    });

    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

    plantsLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    requestAnimationFrame(() => map.invalidateSize());

    return () => {
      polygonsLayerRef.current = null;
      plantsLayerRef.current = null;
      mapRef.current = null;
      map.remove();
    };
  }, []);

  useEffect(() => {
    fetch("/data/NAP_data_med_koordinater.csv")
      .then((response) => response.text())
      .then((text) => {
        const result = Papa.parse<PowerPlant>(text, {
          header: true,
          skipEmptyLines: true,
          transformHeader: (header) => header.replace(/^\uFEFF/, "").trim(),
        });

        const valid = result.data
          .map((row) => ({
            ...row,
            Latitude: Number(row.Latitude),
            Longitude: Number(row.Longitude),
          }))
          .filter((row) => Number.isFinite(row.Latitude) && Number.isFinite(row.Longitude));

        setPlants(valid);
      });

    fetch("/data/NAP_provningsgrupper_simplified.geojson")
      .then((response) => response.json())
      .then(setGeojson);
  }, []);

  const filteredPlants = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    return plants.filter((plant) => {
      if (activeStatus && plant["Status samverkansprocess"] !== activeStatus) return false;
      if (normalizedSearch && !plant.Vattenkraftverk?.toLowerCase().includes(normalizedSearch)) return false;
      return true;
    });
  }, [activeStatus, plants, searchTerm]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    polygonsLayerRef.current?.remove();
    polygonsLayerRef.current = null;

    if (!geojson) return;

    const layer = L.geoJSON(geojson, {
      style: () => ({
        color: "hsl(205 80% 35%)",
        weight: 1.5,
        fillColor: "hsl(205 80% 60%)",
        fillOpacity: 0.08,
      }),
      onEachFeature: (feature, leafletLayer) => {
        const name = feature.properties?.Prövnings;
        if (name) {
          leafletLayer.bindTooltip(String(name), { sticky: true, opacity: 0.95 });
        }
      },
    }).addTo(map);

    polygonsLayerRef.current = layer;
  }, [geojson]);

  useEffect(() => {
    const map = mapRef.current;
    const plantsLayer = plantsLayerRef.current;
    if (!map || !plantsLayer) return;

    plantsLayer.clearLayers();

    const bounds: [number, number][] = [];

    filteredPlants.forEach((plant) => {
      const center: [number, number] = [plant.Latitude, plant.Longitude];
      bounds.push(center);

      L.circleMarker(center, {
        radius: getRadius(plant["Vattenkraftverk storlek"]),
        color: getStatusColor(plant["Status samverkansprocess"]),
        fillColor: getStatusColor(plant["Status samverkansprocess"]),
        fillOpacity: 0.72,
        weight: 1.5,
      })
        .bindPopup(popupContent(plant))
        .addTo(plantsLayer);
    });

    requestAnimationFrame(() => {
      map.invalidateSize();
      if (bounds.length > 0) {
        map.fitBounds(bounds, { padding: [30, 30], maxZoom: 12 });
      } else {
        map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
      }
    });
  }, [filteredPlants]);

  const statuses = ["Pågår", "Ej påbörjad", "Avslutad"];

  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border bg-card px-6 py-4">
        <div>
          <h1 className="text-xl font-bold text-foreground">NAP Vattenkraftverk</h1>
          <p className="text-sm text-muted-foreground">{filteredPlants.length} kraftverk visas</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <input
            type="text"
            placeholder="Sök kraftverk..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            className="w-48 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />

          <div className="flex flex-wrap gap-1.5">
            {statuses.map((status) => (
              <button
                key={status}
                onClick={() => setActiveStatus(activeStatus === status ? null : status)}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                  activeStatus === status
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-foreground hover:bg-secondary"
                }`}
              >
                <span
                  className="mr-1.5 inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: getStatusColor(status) }}
                />
                {status}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="relative min-h-0 flex-1">
        <div ref={mapElementRef} className="h-full w-full" />

        <div className="absolute bottom-6 left-6 z-[1000] rounded-xl border border-border bg-card/95 p-4 shadow-lg backdrop-blur">
          <p className="mb-2 text-xs font-semibold text-foreground">Storlek</p>
          <div className="space-y-1.5">
            {Object.entries(sizeRadius).map(([label, radius]) => (
              <div key={label} className="flex items-center gap-2 text-xs text-muted-foreground">
                <span
                  className="inline-block rounded-full bg-primary"
                  style={{ width: radius * 2.5, height: radius * 2.5 }}
                />
                {label}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
