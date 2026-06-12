import { useEffect, useRef, useState } from 'react';

// Cidade inicial para o app já funcionar sem digitar nada.
// Centro deslocado p/ o bairro Bom Jesus (leste de Porto Alegre).
const DEFAULT_CITY = { label: 'Porto Alegre, Rio Grande do Sul', lat: -30.0427211, lng: -51.1626625 };

export default function SearchBar({ onSearch, loading }) {
  const [niche, setNiche] = useState('salão de estética');
  const [cityQuery, setCityQuery] = useState(DEFAULT_CITY.label);
  const [selectedCity, setSelectedCity] = useState(DEFAULT_CITY);
  const [suggestions, setSuggestions] = useState([]);
  const [geoLoading, setGeoLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [radiusKm, setRadiusKm] = useState(5);
  const blurTimer = useRef(null);

  // Autocomplete via Nominatim/OSM (grátis). Debounce de 450ms para respeitar a
  // política de uso (nada de request a cada tecla) e poupar a rede.
  useEffect(() => {
    if (selectedCity && selectedCity.label === cityQuery) return; // já escolhida
    const q = cityQuery.trim();
    if (q.length < 3) {
      setSuggestions([]);
      return;
    }
    setGeoLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
        const { results } = await r.json();
        setSuggestions(results ?? []);
        setOpen(true);
      } catch {
        setSuggestions([]);
      } finally {
        setGeoLoading(false);
      }
    }, 450);
    return () => clearTimeout(t);
  }, [cityQuery, selectedCity]);

  function chooseCity(s) {
    setSelectedCity(s);
    setCityQuery(s.label);
    setSuggestions([]);
    setOpen(false);
  }

  async function submit(e) {
    e.preventDefault();
    let city = selectedCity;
    // Não escolheu na lista? Geocodifica o texto digitado e usa o 1º resultado.
    if (!city || city.label !== cityQuery) {
      try {
        const r = await fetch(`/api/geocode?q=${encodeURIComponent(cityQuery)}`);
        const { results } = await r.json();
        if (!results?.length) return alert('Cidade não encontrada. Tente outro nome.');
        city = results[0];
      } catch {
        return alert('Não consegui localizar a cidade agora. Tente de novo.');
      }
    }
    onSearch({ niche, city: city.label, lat: city.lat, lng: city.lng, radiusKm });
  }

  return (
    <form className="search-bar" onSubmit={submit} autoComplete="off">
      <input value={niche} onChange={(e) => setNiche(e.target.value)} placeholder='Nicho (ex: "escritório de advocacia")' required />

      <div className="city-field">
        <input
          value={cityQuery}
          onChange={(e) => {
            setCityQuery(e.target.value);
            setSelectedCity(null);
          }}
          onFocus={() => suggestions.length && setOpen(true)}
          onBlur={() => (blurTimer.current = setTimeout(() => setOpen(false), 150))}
          placeholder="Cidade ou região"
          required
        />
        {open && (suggestions.length > 0 || geoLoading) && (
          <ul className="suggestions">
            {geoLoading && <li className="suggestion muted">buscando cidades…</li>}
            {suggestions.map((s, i) => (
              <li key={`${s.label}-${i}`} className="suggestion" onMouseDown={() => chooseCity(s)}>
                📍 {s.label}
              </li>
            ))}
          </ul>
        )}
      </div>

      <label className="radius">
        Raio: <strong>{radiusKm} km</strong>
        <input type="range" min="1" max="30" value={radiusKm} onChange={(e) => setRadiusKm(+e.target.value)} />
      </label>

      <button disabled={loading}>{loading ? 'Buscando…' : 'Buscar leads sem site'}</button>
    </form>
  );
}
