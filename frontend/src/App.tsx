import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from './services/api'
import type { Column, Dataset, FilterCondition, FilterGroup, RecordRow, SavedConfiguration } from './types'
import './App.css'

const operators: Record<string, string[]> = {
  text: ['equals', 'not_equals', 'contains', 'not_contains', 'starts_with', 'ends_with', 'is_empty', 'is_not_empty', 'is_null', 'is_not_null'],
  integer: ['equals', 'not_equals', 'greater_than', 'greater_or_equal', 'less_than', 'less_or_equal', 'between', 'is_null', 'is_not_null'],
  number: ['equals', 'not_equals', 'greater_than', 'greater_or_equal', 'less_than', 'less_or_equal', 'between', 'is_null', 'is_not_null'],
  date: ['on', 'before', 'after', 'between', 'is_null', 'is_not_null'],
  datetime: ['on', 'before', 'after', 'between', 'is_null', 'is_not_null'],
  boolean: ['equals', 'is_null', 'is_not_null'],
}
const noValue = new Set(['is_empty', 'is_not_empty', 'is_null', 'is_not_null'])
const labels: Record<string, string> = {
  equals: 'is', not_equals: 'is not', contains: 'contains', not_contains: 'does not contain',
  starts_with: 'starts with', ends_with: 'ends with', is_empty: 'is empty', is_not_empty: 'is not empty',
  greater_than: 'greater than', greater_or_equal: 'at least', less_than: 'less than',
  less_or_equal: 'at most', between: 'is between', on: 'is on', before: 'is before', after: 'is after',
  is_null: 'is missing', is_not_null: 'is not missing',
}

function message(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.'
}

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function App() {
  const [datasets, setDatasets] = useState<Dataset[]>([])
  const [datasetId, setDatasetId] = useState('')
  const [rows, setRows] = useState<RecordRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState('asc')
  const [activeFilter, setActiveFilter] = useState<FilterGroup | null>(null)
  const [condition, setCondition] = useState<FilterCondition>({ type: 'condition', column: '', operator: 'contains', value: '' })
  const [logic, setLogic] = useState<'and' | 'or'>('and')
  const [filterOpen, setFilterOpen] = useState(false)
  const [configurations, setConfigurations] = useState<SavedConfiguration[]>([])
  const [selectedRecord, setSelectedRecord] = useState<RecordRow | null>(null)
  const [editing, setEditing] = useState(false)
  const [recordValues, setRecordValues] = useState<Record<string, string>>({})
  const [recordIsNew, setRecordIsNew] = useState(false)
  const [visibleColumns, setVisibleColumns] = useState<string[]>([])
  const [columnOpen, setColumnOpen] = useState(false)
  const [layoutOpen, setLayoutOpen] = useState(false)
  const [layout, setLayout] = useState<Array<{ name: string; label: string; section: string; visible: boolean }>>([])
  const [modal, setModal] = useState<'import' | 'save' | null>(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importName, setImportName] = useState('')
  const [importDescription, setImportDescription] = useState('')
  const [preview, setPreview] = useState<{ headers: string[]; schema: Column[]; rows: unknown[][]; row_count: number; worksheets: string[] } | null>(null)
  const [worksheet, setWorksheet] = useState('')
  const [saveKind, setSaveKind] = useState<'filter' | 'table' | 'detail'>('filter')
  const [saveName, setSaveName] = useState('')

  const dataset = datasets.find((item) => item.id === datasetId)
  const pageCount = Math.max(1, Math.ceil(total / 50))
  const visibleSchema = useMemo(
    () => dataset?.schema.filter((column) => visibleColumns.includes(column.name)) ?? [],
    [dataset, visibleColumns],
  )

  const refreshDatasets = useCallback(async (preferId?: string) => {
    const result = await api.datasets()
    setDatasets(result)
    const nextId = preferId && result.some((item) => item.id === preferId) ? preferId : datasetId && result.some((item) => item.id === datasetId) ? datasetId : result[0]?.id ?? ''
    setDatasetId(nextId)
  }, [datasetId])

  useEffect(() => {
    refreshDatasets().catch((cause) => setError(message(cause)))
  }, [])

  useEffect(() => {
    setPage(1)
    setActiveFilter(null)
    setSelectedRecord(null)
    setVisibleColumns(dataset?.schema.map((column) => column.name) ?? [])
    setLayout(dataset?.schema.map((column) => ({ name: column.name, label: column.name, section: 'Record', visible: true })) ?? [])
  }, [datasetId])

  useEffect(() => {
    if (!datasetId) {
      setRows([])
      setTotal(0)
      return
    }
    let current = true
    const timer = window.setTimeout(() => {
      api.records(datasetId, page, search, sortBy, sortDir, activeFilter)
        .then((result) => {
          if (current) { setRows(result.items); setTotal(result.total) }
        })
        .catch((cause) => { if (current) setError(message(cause)) })
    }, 180)
    return () => { current = false; window.clearTimeout(timer) }
  }, [datasetId, page, search, sortBy, sortDir, activeFilter])

  useEffect(() => {
    if (!datasetId) { setConfigurations([]); return }
    api.configurations(datasetId).then(setConfigurations).catch((cause) => setError(message(cause)))
  }, [datasetId])

  const refreshRecords = () => {
    if (!datasetId) return
    api.records(datasetId, page, search, sortBy, sortDir, activeFilter)
      .then((result) => { setRows(result.items); setTotal(result.total) })
      .catch((cause) => setError(message(cause)))
  }

  async function uploadPreview(file: File, selectedSheet?: string) {
    const body = new FormData()
    body.set('file', file)
    if (selectedSheet) body.set('worksheet', selectedSheet)
    const response = await fetch(`${import.meta.env.VITE_API_URL ?? 'http://localhost:8000/api'}/imports/preview`, { method: 'POST', body })
    const data = await response.json()
    if (!response.ok) throw new Error(data.detail ?? 'Could not preview this file.')
    setPreview(data)
  }

  async function handleFile(file: File) {
    setImportFile(file)
    setImportName(file.name.replace(/\.[^.]+$/, ''))
    setPreview(null)
    setWorksheet('')
    setError('')
    setBusy(true)
    try { await uploadPreview(file) } catch (cause) { setError(message(cause)) } finally { setBusy(false) }
  }

  async function importDataset() {
    if (!importFile || !importName.trim()) return
    const body = new FormData()
    body.set('file', importFile)
    body.set('name', importName)
    body.set('description', importDescription)
    if (worksheet) body.set('worksheet', worksheet)
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL ?? 'http://localhost:8000/api'}/imports`, { method: 'POST', body })
      const imported = await response.json()
      if (!response.ok) throw new Error(imported.detail ?? 'Import failed.')
      setModal(null)
      setPreview(null)
      setImportFile(null)
      await refreshDatasets(imported.id)
      setNotice(`${imported.row_count.toLocaleString()} records imported.`)
    } catch (cause) { setError(message(cause)) } finally { setBusy(false) }
  }

  function applyFilter() {
    if (!condition.column) return
    const nextCondition = { ...condition }
    setActiveFilter({ type: 'group', logic, conditions: [nextCondition] })
    setPage(1)
    setFilterOpen(false)
  }

  function saveConfig() {
    if (!datasetId || !saveName.trim()) return
    const config =
      saveKind === 'filter' ? { filter: activeFilter } :
      saveKind === 'table' ? { visible_columns: visibleColumns, sort_by: sortBy, sort_dir: sortDir } :
      { fields: layout }
    setBusy(true)
    api.saveConfiguration(datasetId, { kind: saveKind, name: saveName, config })
      .then(async () => {
        setNotice(`${saveKind === 'filter' ? 'Filter' : saveKind === 'table' ? 'Table view' : 'Detail layout'} saved.`)
        setModal(null)
        setSaveName('')
        setConfigurations(await api.configurations(datasetId))
      })
      .catch((cause) => setError(message(cause)))
      .finally(() => setBusy(false))
  }

  function loadConfiguration(configuration: SavedConfiguration) {
    if (configuration.kind === 'filter') {
      setActiveFilter((configuration.config.filter as FilterGroup | null) ?? null)
      setPage(1)
    } else if (configuration.kind === 'table') {
      const names = configuration.config.visible_columns as string[]
      setVisibleColumns(names.filter((name) => dataset?.schema.some((column) => column.name === name)))
      setSortBy((configuration.config.sort_by as string | null) ?? null)
      setSortDir((configuration.config.sort_dir as string) ?? 'asc')
    } else {
      setLayout(configuration.config.fields as typeof layout)
    }
    setNotice(`Loaded “${configuration.name}”.`)
  }

  async function deleteConfig(configuration: SavedConfiguration) {
    if (!window.confirm(`Delete saved ${configuration.kind} “${configuration.name}”?`)) return
    try {
      await api.deleteConfiguration(datasetId, configuration.id)
      setConfigurations(await api.configurations(datasetId))
    } catch (cause) { setError(message(cause)) }
  }

  function openRecord(row: RecordRow, isNew = false) {
    setSelectedRecord(row)
    setRecordIsNew(isNew)
    setEditing(isNew)
    setRecordValues(Object.fromEntries((dataset?.schema ?? []).map((column) => [column.name, row[column.name] == null ? '' : String(row[column.name])])))
    setLayoutOpen(false)
  }

  async function saveRecord() {
    if (!datasetId) return
    const values = Object.fromEntries(Object.entries(recordValues).map(([key, value]) => [key, value === '' ? null : value]))
    try {
      const saved = await api.saveRecord(datasetId, values, recordIsNew ? undefined : selectedRecord?._record_id)
      setSelectedRecord(saved)
      setEditing(false)
      setRecordIsNew(false)
      refreshRecords()
      await refreshDatasets(datasetId)
      setNotice('Record saved.')
    } catch (cause) { setError(message(cause)) }
  }

  async function removeSelectedRecord() {
    if (!selectedRecord || !window.confirm('Delete this record permanently?')) return
    try {
      await api.deleteRecord(datasetId, selectedRecord._record_id)
      setSelectedRecord(null)
      refreshRecords()
      await refreshDatasets(datasetId)
      setNotice('Record deleted.')
    } catch (cause) { setError(message(cause)) }
  }

  function exportData(format: 'csv' | 'xlsx') {
    const query = new URLSearchParams({ format, scope: activeFilter || search ? 'filtered' : 'all', search })
    if (activeFilter) query.set('filters', JSON.stringify(activeFilter))
    const url = `${import.meta.env.VITE_API_URL ?? 'http://localhost:8000/api'}/datasets/${datasetId}/export?${query}`
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  function setConditionColumn(name: string) {
    const selected = dataset?.schema.find((column) => column.name === name)
    const options = operators[selected?.type ?? 'text'] ?? operators.text
    setCondition({ type: 'condition', column: name, operator: options[0], value: '' })
  }

  function openSave(kind: 'filter' | 'table' | 'detail') {
    setSaveKind(kind)
    setSaveName('')
    setModal('save')
  }

  function toggleColumn(name: string) {
    setVisibleColumns((current) => current.includes(name) ? current.filter((item) => item !== name) : [...current, name])
  }

  function moveColumn(index: number, step: number) {
    const next = [...visibleColumns]
    const target = index + step
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    setVisibleColumns(next)
  }

  const filterConfigurations = configurations.filter((item) => item.kind === 'filter')
  const tableConfigurations = configurations.filter((item) => item.kind === 'table')
  const detailConfigurations = configurations.filter((item) => item.kind === 'detail')
  const activeCondition = activeFilter?.conditions[0] as FilterCondition | undefined
  const inputType = condition.operator === 'between' ? 'number' : condition.operator === 'on' || condition.operator === 'before' || condition.operator === 'after' ? 'date' : 'text'

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" aria-label="DataBNB home">
          <span className="brand-mark">d</span><span>data<span className="brand-light">bnb</span></span>
        </a>
        <div className="side-section-title">WORKSPACE <span>⌄</span></div>
        <div className="side-label">YOUR DATASETS <span>{datasets.length}</span></div>
        <nav className="dataset-nav" aria-label="Datasets">
          {datasets.map((item) => (
            <button className={`dataset-link ${item.id === datasetId ? 'selected' : ''}`} key={item.id} onClick={() => setDatasetId(item.id)}>
              <span className="dataset-icon">▤</span><span className="dataset-name">{item.name}</span>
              <span className="dataset-count">{item.row_count.toLocaleString()}</span>
            </button>
          ))}
          {datasets.length === 0 && <p className="sidebar-empty">Your data will show up here.</p>}
        </nav>
        <button className="new-source" onClick={() => { setError(''); setModal('import') }}><span>＋</span> Import data</button>
        <div className="sidebar-bottom">
          <span className="local-dot" /> Local workspace
          <div>Your data stays on this device</div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="breadcrumb"><span>Workspace</span><b>/</b><strong>{dataset?.name ?? 'Overview'}</strong></div>
          <div className="topbar-right"><span className="local-badge"><i /> Local only</span><button className="avatar" title="Local workspace">F</button></div>
        </header>

        {error && <div className="notice error-notice" role="alert">{error}<button onClick={() => setError('')}>Dismiss</button></div>}
        {notice && <div className="notice success-notice" role="status">{notice}<button onClick={() => setNotice('')}>×</button></div>}

        {dataset ? (
          <>
            <section className="workspace-heading">
              <div>
                <div className="eyebrow"><span className="source-dot" /> SPREADSHEET · {dataset.source_filename}</div>
                <h1>{dataset.name}</h1>
                <p>{dataset.description || 'Your imported data, ready to explore.'}</p>
                <div className="dataset-stats"><span><b>{dataset.row_count.toLocaleString()}</b> records</span><span className="stat-divider" /><span><b>{dataset.schema.length}</b> fields</span><span className="stat-divider" /><span>Updated just now</span></div>
              </div>
              <div className="heading-actions">
                <button className="button secondary" onClick={() => exportData('csv')} title="Download all records or the filtered results as CSV">↓ Export CSV</button>
                <button className="button secondary" onClick={() => exportData('xlsx')} title="Download all records or the filtered results as Excel">↓ Export Excel</button>
                <button className="button primary" onClick={() => openRecord({}, true)}>＋ Add record</button>
              </div>
            </section>

            <section className="data-panel">
              <div className="panel-title">
                <div><h2>Data table</h2><span className="panel-count">{total.toLocaleString()} {activeFilter || search ? 'matching' : 'total'}</span></div>
                <div className="panel-actions">
                  <div className="saved-select-wrap">
                    <select aria-label="Load saved filter" defaultValue="" onChange={(event) => { const item = filterConfigurations.find((config) => config.id === event.target.value); if (item) loadConfiguration(item); event.target.value = '' }}>
                      <option value="">Saved filters</option>{filterConfigurations.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
                    </select>
                  </div>
                  <div className="saved-select-wrap">
                    <select aria-label="Load table view" defaultValue="" onChange={(event) => { const item = tableConfigurations.find((config) => config.id === event.target.value); if (item) loadConfiguration(item); event.target.value = '' }}>
                      <option value="">Table views</option>{tableConfigurations.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
                    </select>
                  </div>
                  <button className={`icon-button ${filterOpen ? 'active' : ''}`} aria-label="Open filters" onClick={() => setFilterOpen(!filterOpen)}>☷ <span>Filter</span>{activeFilter && <i className="filter-dot" />}</button>
                  <div className="relative">
                    <button className={`icon-button ${columnOpen ? 'active' : ''}`} onClick={() => setColumnOpen(!columnOpen)}>▥ <span>Columns</span></button>
                    {columnOpen && <div className="popover column-popover">
                      <div className="popover-heading">Visible columns</div>
                      {visibleColumns.map((name, index) => <div className="column-row" key={name}>
                        <label><input type="checkbox" checked onChange={() => toggleColumn(name)} />{name}</label>
                        <span><button aria-label={`Move ${name} up`} onClick={() => moveColumn(index, -1)}>↑</button><button aria-label={`Move ${name} down`} onClick={() => moveColumn(index, 1)}>↓</button></span>
                      </div>)}
                      {dataset.schema.filter((column) => !visibleColumns.includes(column.name)).map((column) => <label className="hidden-column" key={column.name}><input type="checkbox" onChange={() => toggleColumn(column.name)} />{column.name}</label>)}
                      <button className="text-button reset-columns" onClick={() => setVisibleColumns(dataset.schema.map((column) => column.name))}>Restore all columns</button>
                    </div>}
                  </div>
                </div>
              </div>

              {filterOpen && <div className="filter-builder">
                <div className="filter-builder-title"><div><strong>Filter records</strong><span>Filters run across all {dataset.row_count.toLocaleString()} records.</span></div><button className="close-button" onClick={() => setFilterOpen(false)}>×</button></div>
                <div className="filter-controls">
                  <select aria-label="Filter logic" value={logic} onChange={(event) => setLogic(event.target.value as 'and' | 'or')}><option value="and">Match all</option><option value="or">Match any</option></select>
                  <select aria-label="Filter field" value={condition.column} onChange={(event) => setConditionColumn(event.target.value)}><option value="">Choose a field…</option>{dataset.schema.map((column) => <option key={column.name} value={column.name}>{column.name}</option>)}</select>
                  <select aria-label="Filter operator" value={condition.operator} onChange={(event) => setCondition({ ...condition, operator: event.target.value })}>{(operators[dataset.schema.find((column) => column.name === condition.column)?.type ?? 'text'] ?? operators.text).map((operator) => <option value={operator} key={operator}>{labels[operator]}</option>)}</select>
                  {!noValue.has(condition.operator) && <input aria-label="Filter value" type={inputType} value={Array.isArray(condition.value) ? condition.value.join(',') : String(condition.value ?? '')} placeholder={condition.operator === 'between' ? 'first, second' : 'Enter a value'} onChange={(event) => setCondition({ ...condition, value: condition.operator === 'between' ? event.target.value.split(',') : event.target.value })} />}
                  <button className="button primary small" onClick={applyFilter} disabled={!condition.column}>Apply</button>
                </div>
                {activeCondition && <div className="active-filter"><span className="filter-chip"><b>{activeCondition.column}</b> {labels[activeCondition.operator]} {!noValue.has(activeCondition.operator) && <b>{Array.isArray(activeCondition.value) ? activeCondition.value.join(' – ') : String(activeCondition.value ?? '')}</b>}<button aria-label="Remove active filter" onClick={() => setActiveFilter(null)}>×</button></span><button className="text-button" onClick={() => setActiveFilter(null)}>Clear filter</button></div>}
                <div className="filter-footer"><span>AND/OR logic is evaluated by the database against the full dataset.</span><button className="text-button" disabled={!activeFilter} onClick={() => openSave('filter')}>Save filter</button></div>
              </div>}

              <div className="table-tools">
                <label className="search-box"><span>⌕</span><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="Search all records…" aria-label="Search all records" /><kbd>⌘ K</kbd></label>
                {activeFilter && <button className="filter-chip applied-chip" onClick={() => setActiveFilter(null)}>Filter applied <span>×</span></button>}
                <div className="table-tool-end"><button className="text-button" onClick={() => openSave('table')}>Save view</button></div>
              </div>

              <div className="table-scroll">
                <table>
                  <thead><tr><th className="row-number">#</th>{visibleSchema.map((column) => <th key={column.name}><button onClick={() => { setSortBy(column.name); setSortDir(sortBy === column.name && sortDir === 'asc' ? 'desc' : 'asc') }}>{column.name}<span>{sortBy === column.name ? sortDir === 'asc' ? ' ↑' : ' ↓' : ' ↕'}</span></button></th>)}</tr></thead>
                  <tbody>
                    {rows.map((row, index) => <tr key={row._record_id} onClick={() => openRecord(row)}>
                      <td className="row-number">{(page - 1) * 50 + index + 1}</td>
                      {visibleSchema.map((column) => <td key={column.name} title={displayValue(row[column.name])}>{displayValue(row[column.name])}</td>)}
                    </tr>)}
                    {rows.length === 0 && <tr><td colSpan={visibleSchema.length + 1} className="empty-table">{total === 0 ? 'No records match. Try a different search or filter.' : 'Loading records…'}</td></tr>}
                  </tbody>
                </table>
              </div>
              <footer className="table-footer"><span>Showing {total ? (page - 1) * 50 + 1 : 0}–{Math.min(page * 50, total)} of {total.toLocaleString()} records</span><div className="pagination"><button disabled={page <= 1} aria-label="Previous page" onClick={() => setPage(page - 1)}>←</button><span>Page <b>{page}</b> of {pageCount}</span><button disabled={page >= pageCount} aria-label="Next page" onClick={() => setPage(page + 1)}>→</button></div></footer>
            </section>
          </>
        ) : (
          <section className="welcome">
            <div className="welcome-mark">▤</div><div className="eyebrow">YOUR LOCAL DATA WORKSPACE</div><h1>Bring your data<br />together.</h1>
            <p>Import a spreadsheet to start exploring your data in one calm, private workspace.</p>
            <button className="button primary" onClick={() => { setError(''); setModal('import') }}>＋ Import your first dataset</button>
            <div className="welcome-note"><span>✓</span> Your files stay on this device</div>
          </section>
        )}
      </main>

      {selectedRecord && <div className="drawer-backdrop" onClick={() => { if (editing && !window.confirm('Discard unsaved changes?')) return; setSelectedRecord(null); setEditing(false) }}>
        <aside className="record-drawer" onClick={(event) => event.stopPropagation()} aria-label="Record details">
          <header><div><div className="eyebrow">RECORD DETAILS</div><h2>{recordIsNew ? 'New record' : `Record ${(page - 1) * 50 + rows.findIndex((item) => item._record_id === selectedRecord._record_id) + 1}`}</h2></div><button className="close-button" aria-label="Close details" onClick={() => { if (editing && !window.confirm('Discard unsaved changes?')) return; setSelectedRecord(null); setEditing(false) }}>×</button></header>
          <div className="drawer-toolbar">{!editing && <><button className="button secondary" onClick={() => { setEditing(true); setRecordIsNew(false) }}>✎ Edit record</button><button className="button danger" onClick={removeSelectedRecord}>Delete</button></>}<select aria-label="Load detail layout" defaultValue="" onChange={(event) => { const config = detailConfigurations.find((item) => item.id === event.target.value); if (config) loadConfiguration(config); event.target.value = '' }}><option value="">Detail layout</option>{detailConfigurations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
          {editing ? <div className="record-fields">{dataset?.schema.map((column) => <label key={column.name}><span>{column.name}<small>{column.type}</small></span><input value={recordValues[column.name] ?? ''} onChange={(event) => setRecordValues({ ...recordValues, [column.name]: event.target.value })} /></label>)}</div> :
            <div className="record-fields">{layout.filter((field) => field.visible && selectedRecord[field.name] !== undefined).map((field) => <div className="record-value" key={field.name}><span>{field.label || field.name}<small>{field.section}</small></span><p>{displayValue(selectedRecord[field.name])}</p></div>)}</div>}
          {layoutOpen && <div className="layout-editor"><div className="popover-heading">Customize record layout</div>{layout.map((field, index) => <div className="layout-row" key={field.name}><label><input type="checkbox" checked={field.visible} onChange={(event) => setLayout(layout.map((item) => item.name === field.name ? { ...item, visible: event.target.checked } : item))} /><input aria-label={`Label for ${field.name}`} value={field.label} onChange={(event) => setLayout(layout.map((item) => item.name === field.name ? { ...item, label: event.target.value } : item))} /></label><input aria-label={`Section for ${field.name}`} value={field.section} onChange={(event) => setLayout(layout.map((item) => item.name === field.name ? { ...item, section: event.target.value } : item))} placeholder="Section" /><span><button aria-label="Move field up" disabled={index === 0} onClick={() => { const next = [...layout]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; setLayout(next) }}>↑</button><button aria-label="Move field down" disabled={index === layout.length - 1} onClick={() => { const next = [...layout]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; setLayout(next) }}>↓</button></span></div>)}<button className="button secondary full" onClick={() => openSave('detail')}>Save detail layout</button></div>}
          <div className="drawer-footer">{editing ? <><button className="button secondary" onClick={() => { setEditing(false); if (recordIsNew) setSelectedRecord(null) }}>Cancel</button><button className="button primary" onClick={saveRecord}>Save record</button></> : <button className="text-button" onClick={() => setLayoutOpen(!layoutOpen)}>{layoutOpen ? 'Close layout editor' : 'Customize layout'}</button>}</div>
        </aside>
      </div>}

      {modal && <div className="modal-backdrop" onClick={() => !busy && setModal(null)}><section className="modal" onClick={(event) => event.stopPropagation()} aria-label={modal === 'import' ? 'Import data' : 'Save configuration'}>
        <header><div><div className="eyebrow">{modal === 'import' ? 'ADD A DATA SOURCE' : 'SAVE FOR LATER'}</div><h2>{modal === 'import' ? 'Import a spreadsheet' : `Save ${saveKind === 'filter' ? 'filter' : saveKind === 'table' ? 'table view' : 'detail layout'}`}</h2></div><button className="close-button" onClick={() => setModal(null)}>×</button></header>
        {modal === 'import' ? <div className="modal-content">
          <label className="field-label">Choose a CSV or Excel file
            <input type="file" accept=".csv,.xlsx" onChange={(event) => { const file = event.target.files?.[0]; if (file) handleFile(file) }} />
          </label>
          {busy && <div className="inline-status">Reading spreadsheet…</div>}
          {preview && <>
            {preview.worksheets.length > 0 && <label className="field-label">Worksheet<select value={worksheet} onChange={(event) => { setWorksheet(event.target.value); if (importFile) { setBusy(true); uploadPreview(importFile, event.target.value).catch((cause) => setError(message(cause))).finally(() => setBusy(false)) } }}><option value="">First worksheet</option>{preview.worksheets.map((sheet) => <option key={sheet} value={sheet}>{sheet}</option>)}</select></label>}
            <label className="field-label">Dataset name<input value={importName} maxLength={120} onChange={(event) => setImportName(event.target.value)} /></label>
            <label className="field-label">Description <span className="optional">Optional</span><textarea value={importDescription} maxLength={1000} onChange={(event) => setImportDescription(event.target.value)} /></label>
            <div className="preview-summary">{preview.row_count.toLocaleString()} records · {preview.headers.length} fields</div>
            <div className="preview-scroll"><table><thead><tr>{preview.headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{preview.rows.slice(0, 5).map((row, index) => <tr key={index}>{row.map((value, cell) => <td key={cell}>{displayValue(value)}</td>)}</tr>)}</tbody></table></div>
          </>}
          <footer><button className="button secondary" onClick={() => setModal(null)}>Cancel</button><button className="button primary" disabled={!preview || !importName.trim() || busy} onClick={importDataset}>{busy ? 'Importing…' : 'Import dataset'}</button></footer>
        </div> : <div className="modal-content">
          <label className="field-label">Name<input autoFocus maxLength={120} placeholder="e.g. High priority customers" value={saveName} onChange={(event) => setSaveName(event.target.value)} /></label>
          <p className="save-explainer">{saveKind === 'filter' ? 'This saves the current filter independently of your table layout.' : saveKind === 'table' ? 'This saves visible columns, order, and sorting for this dataset.' : 'This saves visible fields, labels, sections, and order.'}</p>
          <footer><button className="button secondary" onClick={() => setModal(null)}>Cancel</button><button className="button primary" disabled={!saveName.trim() || busy} onClick={saveConfig}>Save configuration</button></footer>
        </div>}
      </section></div>}
    </div>
  )
}

export default App
