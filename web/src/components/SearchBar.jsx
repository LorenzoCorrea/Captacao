import { useEffect, useRef, useState } from 'react';

// Cidade inicial para o app já funcionar sem digitar nada.
// Centro deslocado p/ o bairro Bom Jesus (leste de Porto Alegre).
const DEFAULT_CITY = { label: 'Porto Alegre, Rio Grande do Sul', lat: -30.0427211, lng: -51.1626625 };

// Nichos agrupados por COBERTURA no OpenStreetMap + encaixe com landing page.
// O OSM depende de mapeamento voluntário e a cobertura varia MUITO por ramo:
// o 1º grupo costuma render lista cheia, o último volta quase vazio porque os
// negócios simplesmente não estão cadastrados. Agrupar evita que você perca
// tempo prospectando num ramo que a fonte de dados não enxerga.
const GRUPOS_NICHO = [
  {
    label: '⭐ Melhores para vender site',
    itens: [
      { label: 'Salão de beleza', value: 'salão de beleza' },
      { label: 'Barbearia', value: 'barbearia' },
      { label: 'Estética', value: 'estética' },
      { label: 'Manicure', value: 'manicure' },
      { label: 'Restaurante', value: 'restaurante' },
      { label: 'Lanchonete', value: 'lanchonete' },
      { label: 'Pizzaria', value: 'pizzaria' },
      { label: 'Padaria', value: 'padaria' },
      { label: 'Pet shop / Veterinária', value: 'pet shop' },
      { label: 'Dentista', value: 'dentista' },
      { label: 'Clínica médica', value: 'clínica médica' },
      { label: 'Academia', value: 'academia' },
    ],
  },
  {
    label: 'Boa cobertura',
    itens: [
      { label: 'Hamburgueria', value: 'hamburgueria' },
      { label: 'Cafeteria', value: 'cafeteria' },
      { label: 'Sorveteria / Açaí', value: 'sorveteria' },
      { label: 'Doceria / Confeitaria', value: 'doceria' },
      { label: 'Pilates / Crossfit', value: 'pilates' },
      { label: 'Psicologia', value: 'psicólogo' },
      { label: 'Nutricionista', value: 'nutricionista' },
      { label: 'Fisioterapia', value: 'fisioterapia' },
      { label: 'Mecânica', value: 'mecânica' },
      { label: 'Ótica', value: 'ótica' },
      { label: 'Floricultura', value: 'floricultura' },
      { label: 'Lavanderia', value: 'lavanderia' },
      { label: 'Pousada / Hotel', value: 'pousada' },
      { label: 'Autoescola', value: 'autoescola' },
      { label: 'Estúdio de tatuagem', value: 'tatuagem' },
      { label: 'Loja de roupas', value: 'loja de roupas' },
      { label: 'Joalheria / Semijoias', value: 'joalheria' },
      { label: 'Imobiliária', value: 'imobiliária' },
      { label: 'Arquitetura', value: 'arquitetura' },
    ],
  },
  {
    label: '⚠️ Cobertura fraca no OpenStreetMap',
    itens: [
      { label: 'Advocacia', value: 'advocacia' },
      { label: 'Contabilidade', value: 'contabilidade' },
      { label: 'Empreiteira', value: 'empreiteira' },
      { label: 'Construtora', value: 'construtora' },
    ],
  },
];

// Ramos do último grupo: avisamos na tela antes de a busca voltar vazia.
const COBERTURA_FRACA = new Set(GRUPOS_NICHO.at(-1).itens.map((i) => i.value));

export default function SearchBar({ onSearch, loading }) {
  const [niche, setNiche] = useState('salão de beleza');
  // 'preset' = um dos atalhos selecionado · 'outros' = input livre · '' = indefinido
  const [preset, setPreset] = useState('salão de beleza');
  const [cityQuery, setCityQuery] = useState(DEFAULT_CITY.label);
  const [selectedCity, setSelectedCity] = useState(DEFAULT_CITY);
  const [suggestions, setSuggestions] = useState([]);
  const [geoLoading, setGeoLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [radiusKm, setRadiusKm] = useState(5);
  const blurTimer = useRef(null);
  useEffect(() => () => clearTimeout(blurTimer.current), []); // limpa no unmount

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

  function chooseNiche(v) {
    setPreset(v);
    if (v !== 'outros') setNiche(v); // preset escolhido = nicho definido
    else setNiche(''); // "Outros" -> limpa pra ele digitar
  }

  return (
    <form className="search-bar" onSubmit={submit} autoComplete="off">
      <select className="niche-select" value={preset} onChange={(e) => chooseNiche(e.target.value)} required>
        <option value="todos">🌐 Todos os nichos</option>
        {GRUPOS_NICHO.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.itens.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </optgroup>
        ))}
        <option value="outros">Outros (digite)</option>
      </select>
      {preset === 'outros' && (
        <input
          value={niche}
          onChange={(e) => setNiche(e.target.value)}
          placeholder='Digite o nicho (ex: "dentista", "academia")'
          autoFocus
          required
        />
      )}
      {COBERTURA_FRACA.has(preset) && (
        <p className="niche-warn">
          ⚠️ Ramo com pouco cadastro no OpenStreetMap — a lista pode vir vazia mesmo com raio grande.
          Aumente o raio ou use <strong>🌐 Todos os nichos</strong> e garimpe na lista.
        </p>
      )}

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
