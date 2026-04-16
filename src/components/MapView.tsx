import { useEffect, useMemo, useRef, useState } from "react";
import L, { type GeoJSON as LeafletGeoJSON, type Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";
import Papa from "papaparse";

interface GroupRow {
  Id_nummer: string;
  Prövnings: string;
  Deadline: string;
  Coordinates: string;
  Deadlinekategori: string;
  Totalt: string;
  Laga_kraft: string;
  Domstol_ej_laga: string;
  Domstolsprovning: string;
  Samverkan_pagar: string;
  Avslutad_ej_ansökan: string;
  Ej_paborjad: string;
  Län: string;
}

interface GroupInfo {
  name: string;
  id: string;
  total: number;
  deadline: string;
  deadlineKategori: string;
  lan: string;
  breakdown: { label: string; count: number; color: string }[];
  dominantStatus: string;
}

const DEFAULT_CENTER: [number, number] = [63.0, 16.0];
const DEFAULT_ZOOM = 5;

const deadlineColors: Record<string, { fill: string; stroke: string }> = {
  Passerad:                { fill: "hsl(150, 50%, 45%)", stroke: "hsl(150, 50%, 30%)" },
  "Aktuell (2026-2030)":   { fill: "hsl(210, 70%, 55%)", stroke: "hsl(210, 70%, 35%)" },
  "Framtida (efter 2030)": { fill: "hsl(35, 70%, 55%)",  stroke: "hsl(35, 70%, 35%)" },
  Okänd:                   { fill: "hsl(260, 30%, 72%)", stroke: "hsl(260, 30%, 52%)" },
};

const breakdownMeta: { key: keyof GroupRow; label: string; color: string }[] = [
  { key: "Laga_kraft",          label: "Laga kraft",                       color: "hsl(150, 55%, 40%)" },
  { key: "Domstol_ej_laga",     label: "Domstolsbeslut ej laga kraft",     color: "hsl(170, 45%, 45%)" },
  { key: "Domstolsprovning",    label: "Domstolsprövning pågår",           color: "hsl(210, 65%, 55%)" },
  { key: "Samverkan_pagar",     label: "Samverkan pågår",                  color: "hsl(40, 65%, 52%)" },
  { key: "Avslutad_ej_ansökan", label: "Samverkan avslutad, ej ansökan",   color: "hsl(15, 60%, 55%)" },
  { key: "Ej_paborjad",         label: "Ej påbörjad",                      color: "hsl(260, 30%, 65%)" },
];

function getColor(kategori: string) {
  return deadlineColors[kategori] || deadlineColors.Okänd;
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatDate(raw: string) {
  if (!raw) return "–";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  return d.toLocaleDateString("sv-SE");
}

function tooltipContent(g: GroupInfo) {
  const lines = g.breakdown
    .filter((b) => b.count > 0)
    .map(
      (b) =>
        `<div style="display:flex;align-items:center;gap:6px;margin-top:3px;">
          <span style="width:8px;height:8px;border-radius:50%;background:${b.color};flex-shrink:0;"></span>
          <span>${escapeHtml(b.label)}: ${b.count}</span>
        </div>`
    )
    .join("");

  return `
    <div style="min-width:220px;font:12px/1.5 system-ui,sans-serif;color:#1e293b;padding:2px;">
      <div style="font-weight:700;font-size:14px;margin-bottom:2px;">${escapeHtml(g.name)}</div>
      <div style="color:#64748b;font-size:11px;margin-bottom:6px;">${escapeHtml(g.id)} · ${escapeHtml(g.lan || "–")}</div>
      <div style="display:flex;flex-wrap:wrap;gap:4px 14px;font-size:11px;color:#475569;margin-bottom:6px;">
        <span>Deadline: ${escapeHtml(formatDate(g.deadline))}</span>
        <span>${escapeHtml(g.deadlineKategori)}</span>
      </div>
      <div style="font-size:12px;font-weight:600;margin-bottom:4px;">Totalt: ${g.total} kraftverk</div>
      ${lines}
    </div>
  `;
}

export default function MapView() {
  const mapElRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const polyRef = useRef<LeafletGeoJSON | null>(null);

  const [rows, setRows] = useState<GroupRow[]>([]);
  const [geojson, setGeojson] = useState<any>(null);
  const [activeKategori, setActiveKategori] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  // Init map
  useEffect(() => {
    if (!mapElRef.current || mapRef.current) return;
    const map = L.map(mapElRef.current, { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM, zoomControl: true });
    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
    }).addTo(map);
    mapRef.current = map;
    requestAnimationFrame(() => map.invalidateSize());
    return () => { polyRef.current = null; mapRef.current = null; map.remove(); };
  }, []);

  // Load data
  useEffect(() => {
    fetch("/data/provningsgrupper_unika_16_april.csv")
      .then((r) => r.text())
      .then((text) => {
        const result = Papa.parse<GroupRow>(text, {
          header: true,
          skipEmptyLines: true,
          transformHeader: (h) => h.replace(/^\uFEFF/, "").trim(),
        });
        setRows(result.data);
      });
    fetch("/data/NAP_provningsgrupper_simplified.geojson")
      .then((r) => r.json())
      .then(setGeojson);
  }, []);

  // Build lookup
  const groupLookup = useMemo(() => {
    const map: Record<string, GroupInfo> = {};
    for (const r of rows) {
      const id = r.Id_nummer;
      if (!id) continue;
      const bd = breakdownMeta.map((m) => ({
        label: m.label,
        count: parseInt(r[m.key] as string, 10) || 0,
        color: m.color,
      }));
      const kategori = r.Deadlinekategori || "Okänd";
      map[id] = {
        name: r.Prövnings || id,
        id,
        total: parseInt(r.Totalt, 10) || 0,
        deadline: r.Deadline || "",
        deadlineKategori: kategori,
        lan: r.Län || "",
        breakdown: bd,
        dominantStatus: kategori,
      };
    }
    return map;
  }, [rows]);

  const allGeojsonIds = useMemo(() => {
    if (!geojson) return new Set<string>();
    const ids = new Set<string>();
    for (const f of geojson.features || []) {
      const fid = f.properties?.Id_nummer;
      if (fid) ids.add(fid);
    }
    return ids;
  }, [geojson]);

  const visibleGroupIds = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    const ids = new Set<string>();
    for (const gid of allGeojsonIds) {
      const g = groupLookup[gid];
      const kat = g?.deadlineKategori || "Okänd";
      if (activeKategori && kat !== activeKategori) continue;
      if (q) {
        const name = g?.name?.toLowerCase() || gid.toLowerCase();
        if (!name.includes(q)) continue;
      }
      ids.add(gid);
    }
    return ids;
  }, [allGeojsonIds, groupLookup, activeKategori, searchTerm]);

  const totalPlants = useMemo(() => {
    let c = 0;
    for (const gid of visibleGroupIds) c += groupLookup[gid]?.total || 0;
    return c;
  }, [visibleGroupIds, groupLookup]);

  // Render polygons
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !geojson) return;
    polyRef.current?.remove();
    polyRef.current = null;

    const layer = L.geoJSON(geojson, {
      filter: (f) => visibleGroupIds.has(f.properties?.Id_nummer),
      style: (f) => {
        const g = groupLookup[f?.properties?.Id_nummer];
        const colors = getColor(g?.deadlineKategori || "Okänd");
        return { color: colors.stroke, weight: 1.5, fillColor: colors.fill, fillOpacity: 0.35 };
      },
      onEachFeature: (f, lyr) => {
        const fid = f.properties?.Id_nummer;
        const g = groupLookup[fid];
        const info: GroupInfo = g || {
          name: f.properties?.Namn || fid || "Okänd",
          id: fid || "",
          total: 0,
          deadline: "",
          deadlineKategori: "Okänd",
          lan: "",
          breakdown: [],
          dominantStatus: "Okänd",
        };
        lyr.bindTooltip(tooltipContent(info), { sticky: true, opacity: 0.97, className: "custom-tooltip" });
        lyr.on("mouseover", function (this: any) { this.setStyle({ fillOpacity: 0.55, weight: 2.5 }); });
        lyr.on("mouseout", function (this: any) { layer.resetStyle(this); });
      },
    }).addTo(map);
    polyRef.current = layer;
  }, [geojson, visibleGroupIds, groupLookup]);

  const kategorier = ["Passerad", "Aktuell (2026-2030)", "Framtida (efter 2030)", "Okänd"];

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
            {kategorier.map((k) => {
              const colors = getColor(k);
              return (
                <button
                  key={k}
                  onClick={() => setActiveKategori(activeKategori === k ? null : k)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    activeKategori === k
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card text-foreground hover:bg-secondary"
                  }`}
                >
                  <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: colors.fill }} />
                  {k}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      <div className="relative min-h-0 flex-1">
        <div ref={mapElRef} style={{ height: "100%", width: "100%" }} />
        <div className="absolute bottom-6 left-6 z-[1000] rounded-xl border border-border bg-card/95 p-4 shadow-lg backdrop-blur">
          <p className="mb-2 text-xs font-semibold text-foreground">Deadlinekategori</p>
          <div className="space-y-1.5">
            {kategorier.map((k) => {
              const colors = getColor(k);
              return (
                <div key={k} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="inline-block h-3 w-5 rounded-sm" style={{ backgroundColor: colors.fill, border: `1px solid ${colors.stroke}` }} />
                  {k}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
