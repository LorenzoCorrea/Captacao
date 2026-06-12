import { useCallback, useMemo, useState } from 'react';
import SearchBar from './components/SearchBar.jsx';
import MapPanel from './components/MapPanel.jsx';
import LeadList from './components/LeadList.jsx';
import KanbanBoard from './components/KanbanBoard.jsx';
import { leadScore } from './lib/score.js';
import { useEnrichmentStream } from './hooks/useEnrichmentStream.js';

const CENTRO_PADRAO = [-30.0427211, -51.1626625]; // Porto Alegre (bairro Bom Jesus)

export default function App() {
  const [search, setSearch] = useState(null); // { searchId, query, stats }
  const [leads, setLeads] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState('map'); // 'map' | 'kanban'
  const [sortBy, setSortBy] = useState('score'); // 'score' | 'nome'
  const [filters, setFilters] = useState({ phone: false, instagram: false, email: false });
  const toggleFilter = (k) => setFilters((f) => ({ ...f, [k]: !f[k] }));

  // FASE 1 — busca síncrona: pinos e cards aparecem de imediato
  const runSearch = useCallback(async (params) => {
    setLoading(true);
    setSelectedId(null);
    try {
      const r = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? 'Falha na busca');
      const data = await r.json();
      setSearch(data);
      setLeads(data.leads);
    } catch (e) {
      alert(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // FASE 2 — eventos SSE atualizam cards e pinos conforme chegam
  useEnrichmentStream(
    search?.searchId,
    useCallback((evt) => {
      setLeads((prev) =>
        prev.map((l) =>
          l.id === evt.leadId ? { ...l, enrichmentStatus: evt.status, enrichment: evt.enrichment } : l
        )
      );
    }, [])
  );

  // Fonte única de verdade da seleção: mapa e lista chamam o MESMO handler
  const selectLead = useCallback(
    (id) => {
      setSelectedId(id);
      const lead = leads.find((l) => l.id === id);
      if (lead?.enrichmentStatus === 'pending' && search) {
        // enriquecimento sob demanda: interagiu → fura a fila
        fetch(`/api/search/${search.searchId}/leads/${id}/prioritize`, { method: 'POST' }).catch(() => {});
      }
    },
    [leads, search]
  );

  // Kanban: move o lead de estágio (otimista no front + PATCH no back)
  const moveLead = useCallback(
    (leadId, stage) => {
      setLeads((prev) => prev.map((l) => (l.id === leadId ? { ...l, stage } : l)));
      if (search) {
        fetch(`/api/search/${search.searchId}/leads/${leadId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stage }),
        }).catch(() => {});
      }
    },
    [search]
  );

  const enriched = useMemo(() => leads.filter((l) => l.enrichmentStatus !== 'pending').length, [leads]);

  // Lista exibida = filtrada + ordenada (vale p/ mapa, lista e Kanban)
  const visibleLeads = useMemo(() => {
    const arr = leads.filter((l) => {
      if (filters.phone && !l.phone) return false;
      if (filters.instagram && !l.enrichment?.instagram) return false;
      if (filters.email && !l.enrichment?.email) return false;
      return true;
    });
    if (sortBy === 'score') return [...arr].sort((a, b) => leadScore(b) - leadScore(a));
    if (sortBy === 'nome') return [...arr].sort((a, b) => a.name.localeCompare(b.name));
    return arr;
  }, [leads, filters, sortBy]);

  return (
    <div className="app">
      <aside className="sidebar">
        <header className="sidebar-header">
          <h1>
            Captação<span>.app</span>
          </h1>
          <SearchBar onSearch={runSearch} loading={loading} />
          <div className="view-toggle">
            <button type="button" className={view === 'map' ? 'active' : ''} onClick={() => setView('map')}>
              🗺 Mapa
            </button>
            <button type="button" className={view === 'kanban' ? 'active' : ''} onClick={() => setView('kanban')}>
              🗂 Kanban
            </button>
          </div>
          {search && (
            <>
              <p className="stats">
                <strong>{visibleLeads.length}</strong>
                {visibleLeads.length !== leads.length ? ` de ${leads.length}` : ''} sem site (de{' '}
                {search.stats.found} no raio) · <strong>{enriched}/{leads.length}</strong> enriquecidos
              </p>
              {leads.length > 0 && (
                <>
                  <div className="exports">
                    <span>Exportar:</span>
                    <a href={`/api/search/${search.searchId}/export?format=csv`} download>
                      CSV
                    </a>
                    <a href={`/api/search/${search.searchId}/export?format=xlsx`} download>
                      Excel
                    </a>
                  </div>
                  <div className="controls">
                    <label className="sort">
                      Ordenar
                      <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                        <option value="score">Relevância (score)</option>
                        <option value="nome">Nome</option>
                      </select>
                    </label>
                    <div className="filter-chips">
                      <button type="button" className={filters.phone ? 'on' : ''} onClick={() => toggleFilter('phone')}>
                        📞 WhatsApp
                      </button>
                      <button type="button" className={filters.instagram ? 'on' : ''} onClick={() => toggleFilter('instagram')}>
                        📷 Instagram
                      </button>
                      <button type="button" className={filters.email ? 'on' : ''} onClick={() => toggleFilter('email')}>
                        ✉️ E-mail
                      </button>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </header>
        <LeadList leads={visibleLeads} selectedId={selectedId} onSelect={selectLead} loading={loading} />
      </aside>

      <main className="map-wrap">
        {view === 'map' ? (
          <MapPanel
            center={search ? [search.query.lat, search.query.lng] : CENTRO_PADRAO}
            radiusKm={search?.query.radiusKm}
            leads={visibleLeads}
            selectedId={selectedId}
            onSelect={selectLead}
            searchId={search?.searchId}
          />
        ) : (
          <KanbanBoard leads={visibleLeads} selectedId={selectedId} onSelect={selectLead} onMove={moveLead} />
        )}
      </main>
    </div>
  );
}
