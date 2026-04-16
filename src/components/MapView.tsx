import { useEffect, useMemo, useRef, useState } from "react";
import L, { type GeoJSON as LeafletGeoJSON, type Map as LeafletMap } from "leaflet";
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

interface GroupInfo {
  name: string;
  id: string;
  total: number;
  datum: string;
  statuses: Record<string, number>;
  dominantStatus: string;
}

const DEFAULT_CENTER: [number, number] = [63.0, 16.0];
const DEFAULT_ZOOM = 5;

const statusColors: Record<string, { fill: string; stroke: string }> = {
  Pågår:            { fill: "hsl(210, 70%, 55%)", stroke: "hsl(210, 70%, 35%)" },
  "Ej påbörjad":    { fill: "hsl(15, 70%, 60%)",  stroke: "hsl(15, 70%, 40%)" },
  Avslutad:         { fill: "hsl(150, 50%, 45%)", stroke: "hsl(150, 50%, 30%)" },
  "Ingen deadline": { fill: "hsl(260, 30%, 72%)", stroke: "hsl(260, 30%, 52%)" },
  Mixed:            { fill: "hsl(35, 70%, 55%)",  stroke: "hsl(35, 70%, 35%)" },
};

function getGroupColor(dominantStatus: string) {
  return statusColors[dominantStatus] || statusColors.Mixed;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function tooltipContent(group: GroupInfo) {
  const statusLines = Object.entries(group.statuses)
    .filter(([, count]) => count > 0)
    .map(([status, count]) => {
      const color = statusColors[status]?.fill || "hsl(210, 8%, 55%)";
      return `<div style="display:flex;align-items:center;gap:6px;margin-top:3px;">
        <span style="width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0;"></span>
        <span>${escapeHtml(status)}: ${count}</span>
      </div>`;
    })
    .join("");

  return `
    <div style="min-width:200px;font:12px/1.5 system-ui,sans-serif;color:#1e293b;padding:2px;">
      <div style="font-weight:700;font-size:14px;margin-bottom:2px;">${escapeHtml(group.name)}</div>
      <div style="color:#64748b;font-size:11px;margin-bottom:6px;">${escapeHtml(group.id)} · Ansökan: ${escapeHtml(group.datum || "–")}</div>
      <div style="font-size:12px;font-weight:600;margin-bottom:4px;">Totalt: ${group.total} kraftverk</div>
      ${statusLines}
    </div>
  `;
}

export default function MapView() {
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const polygonsLayerRef = useRef<LeafletGeoJSON | null>(null);

  const [plants, setPlants] = useState<PowerPlant[]>([]);
  const [geojson, setGeojson] = useState<any>(null);
  const [activeStatus, setActiveStatus] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  // Init map
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

    mapRef.current = map;
    requestAnimationFrame(() => map.invalidateSize());

    return () => {
      polygonsLayerRef.current = null;
      mapRef.current = null;
      map.remove();
    };
  }, []);

  // Load data
  useEffect(() => {
    fetch("/data/NAP_data_med_koordinater.csv")
      .then((r) => r.text())
      .then((text) => {
        const result = Papa.parse<PowerPlant>(text, {
          header: true,
          skipEmptyLines: true,
          transformHeader: (h) => h.replace(/^\uFEFF/, "").trim(),
        });
        setPlants(result.data);
      });

    fetch("/data/NAP_provningsgrupper_simplified.geojson")
      .then((r) => r.json())
      .then(setGeojson);
  }, []);

  // Build group lookup from CSV
  const groupLookup = useMemo(() => {
    const lookup: Record<string, GroupInfo> = {};
    for (const plant of plants) {
      const gid = plant["Prövningsgrupp ID"];
      if (!gid) continue;
      if (!lookup[gid]) {
        lookup[gid] = {
          name: plant.Prövningsgrupp || gid,
          id: gid,
          total: 0,
          datum: plant["Datum för inlämning ansökan"] || "",
          statuses: {},
          dominantStatus: "",
        };
      }
      const g = lookup[gid];
      g.total++;
      const status = plant["Status samverkansprocess"] || "Okänd";
      g.statuses[status] = (g.statuses[status] || 0) + 1;
    }
    // Determine dominant status per group
    for (const g of Object.values(lookup)) {
      let max = 0;
      let dominant = "Ej påbörjad";
      for (const [status, count] of Object.entries(g.statuses)) {
        if (count > max) {
          max = count;
          dominant = status;
        }
      }
      g.dominantStatus = dominant;
    }
    return lookup;
  }, [plants]);

  // Collect all GeoJSON IDs (including those without CSV data)
  const allGeojsonIds = useMemo(() => {
    if (!geojson) return new Set<string>();
    const ids = new Set<string>();
    for (const feature of geojson.features || []) {
      const fid = feature.properties?.Id_nummer;
      if (fid) ids.add(fid);
    }
    return ids;
  }, [geojson]);

  // Filter groups
  const visibleGroupIds = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    const ids = new Set<string>();

    for (const gid of allGeojsonIds) {
      const group = groupLookup[gid];
      const dominantStatus = group?.dominantStatus || "Ingen deadline";
      if (activeStatus && dominantStatus !== activeStatus) continue;
      if (normalizedSearch) {
        const name = group?.name?.toLowerCase() || gid.toLowerCase();
        if (!name.includes(normalizedSearch)) continue;
      }
      ids.add(gid);
    }
    return ids;
  }, [allGeojsonIds, groupLookup, activeStatus, searchTerm]);

  const totalPlants = useMemo(() => {
    let count = 0;
    for (const gid of visibleGroupIds) {
      count += groupLookup[gid]?.total || 0;
    }
    return count;
  }, [visibleGroupIds, groupLookup]);

  // Render polygons
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !geojson) return;

    polygonsLayerRef.current?.remove();
    polygonsLayerRef.current = null;

    const layer = L.geoJSON(geojson, {
      filter: (feature) => {
        const fid = feature.properties?.Id_nummer;
        return visibleGroupIds.has(fid);
      },
      style: (feature) => {
        const fid = feature?.properties?.Id_nummer;
        const group = groupLookup[fid];
        const dominant = group?.dominantStatus || "Ingen deadline";
        const colors = getGroupColor(dominant);
        return {
          color: colors.stroke,
          weight: 1.5,
          fillColor: colors.fill,
          fillOpacity: 0.35,
        };
      },
      onEachFeature: (feature, leafletLayer) => {
        const fid = feature.properties?.Id_nummer;
        const group = groupLookup[fid];
        const name = group?.name || feature.properties?.Namn || fid || "Okänd";
        const info: GroupInfo = group || {
          name,
          id: fid || "",
          total: 0,
          datum: "",
          statuses: {},
          dominantStatus: "Ingen deadline",
        };
        leafletLayer.bindTooltip(tooltipContent(info), {
          sticky: true,
          opacity: 0.97,
          className: "custom-tooltip",
        });

        leafletLayer.on("mouseover", function (this: any) {
          this.setStyle({ fillOpacity: 0.55, weight: 2.5 });
        });
        leafletLayer.on("mouseout", function (this: any) {
          layer.resetStyle(this);
        });
      },
    }).addTo(map);

    polygonsLayerRef.current = layer;
  }, [geojson, visibleGroupIds, groupLookup]);

  const statuses = ["Pågår", "Ej påbörjad", "Avslutad", "Ingen deadline"];

  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border bg-card px-6 py-4">
        <div>
          <h1 className="text-xl font-bold text-foreground">NAP Vattenkraftverk</h1>
          <p className="text-sm text-muted-foreground">
            {visibleGroupIds.size} prövningsgrupper · {totalPlants} kraftverk
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <input
            type="text"
            placeholder="Sök prövningsgrupp..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-52 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />

          <div className="flex flex-wrap gap-1.5">
            {statuses.map((status) => {
              const colors = getGroupColor(status);
              return (
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
                    style={{ backgroundColor: colors.fill }}
                  />
                  {status}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      <div className="relative min-h-0 flex-1">
        <div ref={mapElementRef} style={{ height: "100%", width: "100%" }} />

        <div className="absolute bottom-6 left-6 z-[1000] rounded-xl border border-border bg-card/95 p-4 shadow-lg backdrop-blur">
          <p className="mb-2 text-xs font-semibold text-foreground">Status</p>
          <div className="space-y-1.5">
            {statuses.map((status) => {
              const colors = getGroupColor(status);
              return (
                <div key={status} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span
                    className="inline-block h-3 w-5 rounded-sm"
                    style={{ backgroundColor: colors.fill, border: `1px solid ${colors.stroke}` }}
                  />
                  {status}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
