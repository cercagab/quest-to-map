import { useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, GeoJSON, CircleMarker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
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

const statusColors: Record<string, string> = {
  "Pågår": "hsl(205, 80%, 50%)",
  "Ej påbörjad": "hsl(210, 10%, 60%)",
  "Avslutad": "hsl(170, 60%, 40%)",
};

const sizeRadius: Record<string, number> = {
  "Storskaliga >10 MW": 8,
  "Medelstora 1,5 - 10 MW": 6,
  "Småskaliga < 1,5 MW": 4,
  "Okänd effekt": 4,
};

function getStatusColor(status: string) {
  return statusColors[status] || "hsl(0, 0%, 50%)";
}

function getRadius(size: string) {
  return sizeRadius[size] || 4;
}

function FitBounds({ data }: { data: PowerPlant[] }) {
  const map = useMap();
  useEffect(() => {
    if (data.length > 0) {
      const bounds = L.latLngBounds(data.map(d => [d.Latitude, d.Longitude]));
      map.fitBounds(bounds, { padding: [30, 30] });
    }
  }, [data, map]);
  return null;
}

export default function MapView() {
  const [plants, setPlants] = useState<PowerPlant[]>([]);
  const [geojson, setGeojson] = useState<any>(null);
  const [activeStatus, setActiveStatus] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    fetch("/data/NAP_data_med_koordinater.csv")
      .then(r => r.text())
      .then(text => {
        const result = Papa.parse<PowerPlant>(text, { header: true, skipEmptyLines: true });
        const valid = result.data.filter(d => d.Latitude && d.Longitude && !isNaN(+d.Latitude));
        setPlants(valid.map(d => ({ ...d, Latitude: +d.Latitude, Longitude: +d.Longitude })));
      });
    fetch("/data/NAP_provningsgrupper_simplified.geojson")
      .then(r => r.json())
      .then(setGeojson);
  }, []);

  const filtered = plants.filter(p => {
    if (activeStatus && p["Status samverkansprocess"] !== activeStatus) return false;
    if (searchTerm && !p.Vattenkraftverk.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    return true;
  });

  const statuses = ["Pågår", "Ej påbörjad", "Avslutad"];

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card px-6 py-4 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-foreground">NAP Vattenkraftverk</h1>
          <p className="text-sm text-muted-foreground">{filtered.length} kraftverk visas</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <input
            type="text"
            placeholder="Sök kraftverk..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="px-3 py-1.5 text-sm rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring w-48"
          />
          <div className="flex gap-1.5">
            {statuses.map(s => (
              <button
                key={s}
                onClick={() => setActiveStatus(activeStatus === s ? null : s)}
                className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
                  activeStatus === s
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card text-foreground border-border hover:bg-secondary"
                }`}
              >
                <span
                  className="inline-block w-2 h-2 rounded-full mr-1.5"
                  style={{ backgroundColor: getStatusColor(s) }}
                />
                {s}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Map */}
      <div className="flex-1 relative">
        <MapContainer
          center={[63, 16]}
          zoom={5}
          className="h-full w-full"
          zoomControl={false}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          />
          {geojson && (
            <GeoJSON
              data={geojson}
              style={() => ({
                color: "hsl(205, 80%, 35%)",
                weight: 1.5,
                fillColor: "hsl(205, 80%, 60%)",
                fillOpacity: 0.08,
              })}
              onEachFeature={(feature, layer) => {
                if (feature.properties?.Prövnings) {
                  layer.bindTooltip(feature.properties.Prövnings, {
                    sticky: true,
                    className: "!bg-card !text-foreground !border-border !rounded-lg !text-xs !shadow-md",
                  });
                }
              }}
            />
          )}
          {filtered.map((p, i) => (
            <CircleMarker
              key={i}
              center={[p.Latitude, p.Longitude]}
              radius={getRadius(p["Vattenkraftverk storlek"])}
              pathOptions={{
                color: getStatusColor(p["Status samverkansprocess"]),
                fillColor: getStatusColor(p["Status samverkansprocess"]),
                fillOpacity: 0.7,
                weight: 1.5,
              }}
            >
              <Popup>
                <div className="text-sm space-y-1 min-w-[200px]">
                  <p className="font-bold text-base">{p.Vattenkraftverk}</p>
                  <p><span className="text-muted-foreground">Prövningsgrupp:</span> {p.Prövningsgrupp}</p>
                  <p><span className="text-muted-foreground">Status:</span> {p["Status samverkansprocess"]}</p>
                  <p><span className="text-muted-foreground">Storlek:</span> {p["Vattenkraftverk storlek"]}</p>
                  <p><span className="text-muted-foreground">Län:</span> {p.Län}</p>
                  <p><span className="text-muted-foreground">Ansökan:</span> {p["Datum för inlämning ansökan"]}</p>
                  <p><span className="text-muted-foreground">Beslut:</span> {p.Beslut}</p>
                </div>
              </Popup>
            </CircleMarker>
          ))}
          <FitBounds data={filtered} />
        </MapContainer>

        {/* Legend */}
        <div className="absolute bottom-6 left-6 bg-card/95 backdrop-blur border border-border rounded-xl p-4 shadow-lg z-[1000]">
          <p className="text-xs font-semibold text-foreground mb-2">Storlek</p>
          <div className="space-y-1.5">
            {Object.entries(sizeRadius).map(([label, r]) => (
              <div key={label} className="flex items-center gap-2 text-xs text-muted-foreground">
                <span
                  className="inline-block rounded-full bg-primary"
                  style={{ width: r * 2.5, height: r * 2.5 }}
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
