import { useEffect, useMemo, useState } from 'react'
import { api, type Column, type Configuration, type Condition, type Dataset, type FilterGroup, type PageResult, type Preview, type RecordRow } from './api'
import './App.css'

const PAGE_SIZE = 50
const noFilters: FilterGroup = { logic: 'and', conditions: [] }

function showValue(value: unknown) {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'True' : 'False'
  return String(value)
}

function filterOperators(column?: Column) {
  const general = [['is_null', 'Is null'], ['is_not_null', 'Is not null']]
  if (column?.type === 'BOOLEAN') return [['true', 'Is true'], ['false', 'Is false'], ...general]
  if (column?.type === 'DATE' || column?.type === 'TIMESTAMP') {
    return [['on', 'On'], ['before', 'Before'], ['after', 'After'], ['between', 'Between'], ...general]
  }
  if (column?.type === 'BIGINT' || column?.type === 'DOUBLE') {
    return [
      ['equals', 'Equals'], ['not_equals', 'Does not equal'],
      ['greater_than', 'Greater than'], ['greater_than_or_equal', 'At least'],
      ['less_than', 'Less than'], ['less_than_or_equal', 'At most'],
      ['between', 'Between'], ...general,
    ]
  }
  return [
    ['equals', 'Equals'], ['not_equals', 'Does not equal'],
    ['contains', 'Contains'], ['does_not_contain', 'Does not contain'],
    ['starts_with', 'Starts with'], ['ends_with', 'Ends with'],
    ['is_empty', 'Is empty'], ['is_not_empty', 'Is not empty'], ...general,
  ]
}

function filterColumns(node: Condition | FilterGroup): string[] {
  if ('conditions' in node) return node.conditions.flatMap((condition) => filterColumns(condition))
  return [node.column]
}

function App() {
  const [datasets, setDatasets] = useState<Dataset[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [result, setResult] = useState<PageResult | null>(null)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState('')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
  const [appliedFilter, setAppliedFilter] = useState<FilterGroup>(noFilters)
  const [draftConditions, setDraftConditions] = useState<Condition[]>([])
  const [filterLogic, setFilterLogic] = useState<'and' | 'or'>('and')
  const [visibleColumns, setVisibleColumns] = useState<string[]>([])
  const [detailFields, setDetailFields] = useState<string[]>([])
  const [detailLabels, setDetailLabels] = useState<Record<string, string>>({})
  const [detailSection, setDetailSection] = useState('Record details')
  const [detailColumns, setDetailColumns] = useState<1 | 2>(2)
  const [filterConfigs, setFilterConfigs] = useState<Configuration[]>([])
  const [tableConfigs, setTableConfigs] = useState<Configuration[]>([])
  const [detailConfigs, setDetailConfigs] = useState<Configuration[]>([])
  const [activeConfig, setActiveConfig] = useState<Record<Configuration['kind'], string>>({
    filter: '', table: '', detail: '',
  })
  const [record, setRecord] = useState<RecordRow | null>(null)
  const [draftRecord, setDraftRecord] = useState<Record<string, unknown>>({})
  const [editing, setEditing] = useState(false)
  const [creating, setCreating] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [sheet, setSheet] = useState('')
  const [importName, setImportName] = useState('')
  const [description, setDescription] = useState('')
  const [filterName, setFilterName] = useState('')
  const [tableName, setTableName] = useState('')
  const [detailName, setDetailName] = useState('')
  const [loading, setLoading] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const selected = datasets.find((dataset) => dataset.id === selectedId) ?? null
  const activeConditions = useMemo(
    () => appliedFilter.conditions.length,
    [appliedFilter],
  )
  const shownColumns = selected
    ? visibleColumns.map((name) => selected.columns.find((column) => column.name === name))
      .filter((column): column is Column => column !== undefined)
    : []

  const reportError = (reason: unknown) => {
    setError(reason instanceof Error ? reason.message : 'Something went wrong')
    setMessage('')
  }

  const reloadDatasets = async (preferredId?: string) => {
    const items = await api.datasets()
    setDatasets(items)
    const nextId = preferredId ?? (items.some((item) => item.id === selectedId) ? selectedId : items[0]?.id ?? '')
    const nextDataset = items.find((item) => item.id === nextId)
    if (nextDataset && nextId !== selectedId) {
      setVisibleColumns(nextDataset.columns.map((column) => column.name))
      setDetailFields(nextDataset.columns.map((column) => column.name))
      setDetailLabels({})
      setDetailSection('Record details')
      setSortBy('')
      setSortDirection('asc')
      setPage(1)
      setAppliedFilter(noFilters)
      setDraftConditions([])
    }
    setSelectedId(nextId)
    if (nextId) localStorage.setItem('databnb:selected-dataset', nextId)
  }

  useEffect(() => {
    api.datasets().then((items) => {
      setDatasets(items)
      const preferredId = localStorage.getItem('databnb:selected-dataset')
      const first = items.find((item) => item.id === preferredId) ?? items[0]
      if (first) {
        setVisibleColumns(first.columns.map((column) => column.name))
        setDetailFields(first.columns.map((column) => column.name))
        setSelectedId(first.id)
        localStorage.setItem('databnb:selected-dataset', first.id)
      } else {
        setLoading(false)
      }
    }).catch(reportError)
  }, [])

  useEffect(() => {
    if (!selectedId) return
    let cancelled = false
    api.records(selectedId, {
      page, pageSize: PAGE_SIZE, search, sortBy, sortDirection,
      filters: appliedFilter.conditions.length ? appliedFilter : null,
    }).then((data) => {
      if (!cancelled) setResult(data)
    }).catch((reason: unknown) => {
      if (!cancelled) reportError(reason)
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [selectedId, page, search, sortBy, sortDirection, appliedFilter, refresh])

  useEffect(() => {
    if (!selected) return
    let cancelled = false
    Promise.all([
      api.configurations(selected.id, 'filter'),
      api.configurations(selected.id, 'table'),
      api.configurations(selected.id, 'detail'),
    ]).then(([filters, tables, details]) => {
      if (cancelled) return
      setFilterConfigs(filters)
      setTableConfigs(tables)
      setDetailConfigs(details)
      let preferred: Partial<Record<Configuration['kind'], string>> = {}
      try {
        preferred = JSON.parse(localStorage.getItem(`databnb:views:${selectedId}`) ?? '{}')
      } catch {
        preferred = {}
      }
      const preferredFilter = filters.find((item) => item.id === preferred.filter)
      const preferredTable = tables.find((item) => item.id === preferred.table)
      const preferredDetail = details.find((item) => item.id === preferred.detail)
      setActiveConfig({
        filter: preferredFilter?.id ?? '',
        table: preferredTable?.id ?? '',
        detail: preferredDetail?.id ?? '',
      })
      setFilterName(preferredFilter?.name ?? '')
      setTableName(preferredTable?.name ?? '')
      setDetailName(preferredDetail?.name ?? '')
      if (preferredFilter) {
        const definition = preferredFilter.definition as unknown as FilterGroup
        const existing = new Set(selected.columns.map((column) => column.name))
        const missing = filterColumns(definition).filter((column) => !existing.has(column))
        if (missing.length) reportError(new Error(`Saved filter references missing columns: ${[...new Set(missing)].join(', ')}`))
        setAppliedFilter(definition)
        setFilterLogic(definition.logic ?? 'and')
        setDraftConditions(definition.conditions.filter((item): item is Condition => 'column' in item))
      }
      if (preferredTable) {
        const definition = preferredTable.definition as { visibleColumns?: string[]; sortBy?: string; sortDirection?: 'asc' | 'desc' }
        const available = new Set(selected.columns.map((column) => column.name))
        const missing = (definition.visibleColumns ?? []).filter((column) => !available.has(column))
        if (missing.length) reportError(new Error(`Saved table view has missing columns: ${missing.join(', ')}`))
        setVisibleColumns((definition.visibleColumns ?? []).filter((column) => available.has(column)))
        setSortBy(definition.sortBy ?? '')
        setSortDirection(definition.sortDirection ?? 'asc')
      }
      if (preferredDetail) {
        const definition = preferredDetail.definition as {
          fields?: string[]; labels?: Record<string, string>; section?: string; columns?: 1 | 2
        }
        const available = new Set(selected.columns.map((column) => column.name))
        const missing = (definition.fields ?? []).filter((field) => !available.has(field))
        if (missing.length) reportError(new Error(`Saved detail view has missing fields: ${missing.join(', ')}`))
        setDetailFields((definition.fields ?? []).filter((field) => available.has(field)))
        setDetailLabels(definition.labels ?? {})
        setDetailSection(definition.section ?? 'Record details')
        setDetailColumns(definition.columns ?? 2)
      }
    }).catch(reportError)
    return () => { cancelled = true }
  }, [selectedId, selected])

  const resetResult = () => {
    setPage(1)
    setRefresh((value) => value + 1)
  }

  const chooseDataset = (id: string) => {
    const dataset = datasets.find((item) => item.id === id)
    setSelectedId(id)
    if (id) localStorage.setItem('databnb:selected-dataset', id)
    if (dataset) {
      setVisibleColumns(dataset.columns.map((column) => column.name))
      setDetailFields(dataset.columns.map((column) => column.name))
      setDetailLabels({})
      setDetailSection('Record details')
    }
    setSortBy('')
    setSortDirection('asc')
    setPage(1)
    setAppliedFilter(noFilters)
    setDraftConditions([])
    setActiveConfig({ filter: '', table: '', detail: '' })
    setResult(null)
    setRecord(null)
    setCreating(false)
    setLoading(true)
    setError('')
    setMessage('')
  }

  const selectFile = async (nextFile: File | null) => {
    setFile(nextFile)
    setPreview(null)
    setSheet('')
    if (!nextFile) return
    setImportName(nextFile.name.replace(/\.(csv|xlsx)$/i, ''))
    try {
      const nextPreview = await api.preview(nextFile)
      setPreview(nextPreview)
      setSheet(nextPreview.sheets[0] ?? '')
    } catch (reason) {
      reportError(reason)
    }
  }

  const changeSheet = async (nextSheet: string) => {
    setSheet(nextSheet)
    if (!file) return
    try {
      setPreview(await api.preview(file, nextSheet))
    } catch (reason) {
      reportError(reason)
    }
  }

  const importFile = async () => {
    if (!file || !importName.trim()) return
    setLoading(true)
    try {
      const dataset = await api.import(file, importName.trim(), description, sheet || undefined)
      await reloadDatasets(dataset.id)
      setShowImport(false)
      setFile(null)
      setPreview(null)
      setMessage(`“${dataset.name}” imported successfully.`)
      setError('')
    } catch (reason) {
      reportError(reason)
    } finally {
      setLoading(false)
    }
  }

  const addCondition = () => {
    const first = selected?.columns[0]
    if (!first) return
    setDraftConditions((items) => [...items, {
      column: first.name,
      operator: filterOperators(first)[0][0],
      value: '',
    }])
  }

  const changeCondition = (index: number, update: Partial<Condition>) => {
    setDraftConditions((items) => items.map((condition, itemIndex) => {
      if (itemIndex !== index) return condition
      const next = { ...condition, ...update }
      if (update.column) next.operator = filterOperators(selected?.columns.find((column) => column.name === update.column))[0][0]
      return next
    }))
  }

  const applyFilters = () => {
    setLoading(true)
    setAppliedFilter({
      logic: filterLogic,
      conditions: draftConditions.filter((condition) => condition.column && condition.operator)
        .map((condition) => condition.operator === 'between'
          ? { ...condition, value: String(condition.value ?? '').split(',').map((value) => value.trim()) }
          : condition),
    })
    setPage(1)
  }

  const draftFilterDefinition = {
    logic: filterLogic,
    conditions: draftConditions.map((condition) => condition.operator === 'between'
      ? { ...condition, value: String(condition.value ?? '').split(',').map((value) => value.trim()) }
      : condition),
  }

  const saveConfiguration = async (
    kind: Configuration['kind'],
    name: string,
    definition: Record<string, unknown>,
    existingId?: string,
  ) => {
    if (!selected || !name.trim()) return
    try {
      const saved = existingId
        ? await api.updateConfiguration(selected.id, existingId, name.trim(), definition)
        : await api.saveConfiguration(selected.id, kind, name.trim(), definition)
      const configs = await api.configurations(selected.id, kind)
      if (kind === 'filter') setFilterConfigs(configs)
      if (kind === 'table') setTableConfigs(configs)
      if (kind === 'detail') setDetailConfigs(configs)
      setActiveConfig((current) => ({ ...current, [kind]: saved.id }))
      const key = `databnb:views:${selected.id}`
      let active: Partial<Record<Configuration['kind'], string>> = {}
      try {
        active = JSON.parse(localStorage.getItem(key) ?? '{}')
      } catch {
        active = {}
      }
      localStorage.setItem(key, JSON.stringify({ ...active, [kind]: saved.id }))
      if (kind === 'filter') setFilterName('')
      if (kind === 'table') setTableName('')
      if (kind === 'detail') setDetailName('')
      setMessage(`${kind[0].toUpperCase()}${kind.slice(1)} view saved.`)
      setError('')
    } catch (reason) {
      reportError(reason)
    }
  }

  const loadConfiguration = (kind: Configuration['kind'], id: string) => {
    setActiveConfig((current) => ({ ...current, [kind]: id }))
    if (selected) {
      const key = `databnb:views:${selected.id}`
      let active: Partial<Record<Configuration['kind'], string>> = {}
      try {
        active = JSON.parse(localStorage.getItem(key) ?? '{}')
      } catch {
        active = {}
      }
      if (id) active[kind] = id
      else delete active[kind]
      localStorage.setItem(key, JSON.stringify(active))
    }
    const config = [...filterConfigs, ...tableConfigs, ...detailConfigs].find((item) => item.id === id)
    if (!config) {
      if (kind === 'filter') setFilterName('')
      if (kind === 'table') setTableName('')
      if (kind === 'detail') setDetailName('')
      if (kind === 'filter') {
        setAppliedFilter(noFilters)
        setDraftConditions([])
        setFilterLogic('and')
        setPage(1)
      }
      if (kind === 'table' && selected) {
        setVisibleColumns(selected.columns.map((column) => column.name))
        setSortBy('')
        setSortDirection('asc')
        resetResult()
      }
      if (kind === 'detail' && selected) {
        setDetailFields(selected.columns.map((column) => column.name))
        setDetailLabels({})
        setDetailSection('Record details')
        setDetailColumns(2)
      }
      return
    }
    if (kind === 'filter') setFilterName(config.name)
    if (kind === 'table') setTableName(config.name)
    if (kind === 'detail') setDetailName(config.name)
    if (kind === 'filter') {
      const definition = config.definition as unknown as FilterGroup
      const available = new Set(selected?.columns.map((column) => column.name))
      const missing = filterColumns(definition).filter((column) => !available?.has(column))
      if (missing.length) reportError(new Error(`Saved filter references missing columns: ${[...new Set(missing)].join(', ')}`))
      setAppliedFilter(definition)
      setFilterLogic(definition.logic ?? 'and')
      setDraftConditions(definition.conditions.filter((item): item is Condition => 'column' in item))
      setPage(1)
    }
    if (kind === 'table') {
      const definition = config.definition as { visibleColumns?: string[]; sortBy?: string; sortDirection?: 'asc' | 'desc' }
      const available = new Set(selected?.columns.map((column) => column.name))
      const missing = (definition.visibleColumns ?? []).filter((column) => !available?.has(column))
      if (missing.length) reportError(new Error(`Saved table view has missing columns: ${missing.join(', ')}`))
      setVisibleColumns((definition.visibleColumns ?? []).filter((column) => available.has(column)))
      setSortBy(definition.sortBy ?? '')
      setSortDirection(definition.sortDirection ?? 'asc')
      resetResult()
    }
    if (kind === 'detail') {
      const definition = config.definition as {
        fields?: string[]; labels?: Record<string, string>; section?: string; columns?: 1 | 2
      }
      const available = new Set(selected?.columns.map((column) => column.name))
      const missing = (definition.fields ?? []).filter((field) => !available?.has(field))
      if (missing.length) reportError(new Error(`Saved detail view has missing fields: ${missing.join(', ')}`))
      setDetailFields((definition.fields ?? []).filter((field) => available.has(field)))
      setDetailLabels(definition.labels ?? {})
      setDetailSection(definition.section ?? 'Record details')
      setDetailColumns(definition.columns ?? 2)
    }
  }

  const removeConfiguration = async (kind: Configuration['kind'], id: string) => {
    if (!selected || !window.confirm('Delete this saved view?')) return
    try {
      await api.deleteConfiguration(selected.id, id)
      if (kind === 'filter') setFilterConfigs((items) => items.filter((item) => item.id !== id))
      if (kind === 'table') setTableConfigs((items) => items.filter((item) => item.id !== id))
      if (kind === 'detail') setDetailConfigs((items) => items.filter((item) => item.id !== id))
      if (activeConfig[kind] === id) {
        setActiveConfig((current) => ({ ...current, [kind]: '' }))
        if (selected) {
          const key = `databnb:views:${selected.id}`
          let active: Partial<Record<Configuration['kind'], string>> = {}
          try {
            active = JSON.parse(localStorage.getItem(key) ?? '{}')
          } catch {
            active = {}
          }
          delete active[kind]
          localStorage.setItem(key, JSON.stringify(active))
        }
      }
    } catch (reason) {
      reportError(reason)
    }
  }

  const openRecord = (row: RecordRow) => {
    setRecord(row)
    setDraftRecord(Object.fromEntries(selected?.columns.map((column) => [column.name, row[column.name]]) ?? []))
    setEditing(false)
    setCreating(false)
  }

  const startCreateRecord = () => {
    if (!selected) return
    setRecord(null)
    setDraftRecord(Object.fromEntries(selected.columns.map((column) => [column.name, null])))
    setEditing(false)
    setCreating(true)
  }

  const moveColumn = (columnName: string, distance: -1 | 1) => {
    setVisibleColumns((items) => {
      const index = items.indexOf(columnName)
      const nextIndex = index + distance
      if (index < 0 || nextIndex < 0 || nextIndex >= items.length) return items
      const reordered = [...items]
      ;[reordered[index], reordered[nextIndex]] = [reordered[nextIndex], reordered[index]]
      return reordered
    })
  }

  const moveDetailField = (fieldName: string, distance: -1 | 1) => {
    setDetailFields((items) => {
      const index = items.indexOf(fieldName)
      const nextIndex = index + distance
      if (index < 0 || nextIndex < 0 || nextIndex >= items.length) return items
      const reordered = [...items]
      ;[reordered[index], reordered[nextIndex]] = [reordered[nextIndex], reordered[index]]
      return reordered
    })
  }

  const navigateRecord = (distance: -1 | 1) => {
    const index = result?.records.findIndex((item) => item._record_id === record?._record_id) ?? -1
    const next = result?.records[index + distance]
    if (next) openRecord(next)
  }

  const closeDetail = () => {
    const changed = JSON.stringify(draftRecord) !== JSON.stringify(
      Object.fromEntries(selected?.columns.map((column) => [column.name, record?.[column.name]]) ?? []),
    )
    if (editing && changed && !window.confirm('Discard your unsaved changes?')) return
    setRecord(null)
    setCreating(false)
    setEditing(false)
  }

  const saveRecord = async () => {
    if (!selected) return
    try {
      const saved = await api.saveRecord(selected.id, draftRecord, creating ? undefined : record?._record_id)
      setRecord(saved)
      setDraftRecord(Object.fromEntries(selected.columns.map((column) => [column.name, saved[column.name]])))
      setEditing(false)
      setCreating(false)
      setMessage(creating ? 'Record added.' : 'Record changes saved.')
      setError('')
      resetResult()
      await reloadDatasets(selected.id)
    } catch (reason) {
      reportError(reason)
    }
  }

  const deleteRecord = async () => {
    if (!selected || !record || !window.confirm('Permanently delete this record?')) return
    try {
      await api.deleteRecord(selected.id, record._record_id)
      closeDetail()
      setRecord(null)
      setMessage('Record deleted.')
      resetResult()
      await reloadDatasets(selected.id)
    } catch (reason) {
      reportError(reason)
    }
  }

  const deleteDataset = async () => {
    if (!selected || !window.confirm(`Delete “${selected.name}” and its saved views? This cannot be undone.`)) return
    try {
      const removedId = selected.id
      await api.deleteDataset(removedId)
      localStorage.removeItem(`databnb:views:${removedId}`)
      setResult(null)
      setRecord(null)
      await reloadDatasets()
      if (!datasets.some((item) => item.id !== removedId)) {
        localStorage.removeItem('databnb:selected-dataset')
      }
      setMessage(`“${selected.name}” was deleted.`)
      setError('')
    } catch (reason) {
      reportError(reason)
    }
  }

  const exportRecords = async (format: 'csv' | 'xlsx') => {
    if (!selected) return
    try {
      const blob = await api.export(
        selected.id, format, search,
        appliedFilter.conditions.length ? appliedFilter : null,
        shownColumns.map((column) => column.name),
      )
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${selected.name}.${format}`
      link.click()
      URL.revokeObjectURL(url)
      setMessage(`Exported all ${result?.total ?? 0} matching records as ${format.toUpperCase()}.`)
      setError('')
    } catch (reason) {
      reportError(reason)
    }
  }

  const renderEditor = (column: Column, value: unknown, onChange: (value: unknown) => void) => {
    if (column.type === 'BOOLEAN') {
      return (
        <select value={value === true ? 'true' : value === false ? 'false' : ''} onChange={(event) => onChange(event.target.value === '' ? null : event.target.value === 'true')}>
          <option value="">Empty</option><option value="true">True</option><option value="false">False</option>
        </select>
      )
    }
    return (
      <input
        type={column.type === 'BIGINT' || column.type === 'DOUBLE' ? 'number' : 'text'}
        step={column.type === 'DOUBLE' ? 'any' : undefined}
        value={value === null || value === undefined ? '' : String(value)}
        onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
      />
    )
  }

  return (
    <div className="workspace">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="DataBNB home">
          <span className="brand-mark">D</span>
          <span>DataBNB<small>Multiple sources. One workspace.</small></span>
        </a>
        <div className="sidebar-heading">
          <span>YOUR DATA</span>
          <button className="icon-button" aria-label="Import a dataset" onClick={() => setShowImport(true)}>＋</button>
        </div>
        <button className="primary sidebar-import" onClick={() => setShowImport(true)}>＋ &nbsp;Import data</button>
        <div className="dataset-list" aria-label="Datasets">
          {datasets.map((dataset) => (
            <button
              key={dataset.id}
              className={`dataset-item ${selectedId === dataset.id ? 'selected' : ''}`}
              onClick={() => chooseDataset(dataset.id)}
            >
              <span className="dataset-icon">▦</span>
              <span className="dataset-copy"><strong>{dataset.name}</strong><small>{dataset.row_count.toLocaleString()} rows · {dataset.columns.length} columns</small></span>
            </button>
          ))}
          {!datasets.length && <p className="sidebar-empty">Your imported datasets will appear here.</p>}
        </div>
        <div className="sidebar-footer"><span className="status-dot" /> Local workspace</div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="breadcrumbs"><span>Workspace</span><span className="crumb-divider">/</span><strong>{selected?.name ?? 'Overview'}</strong></div>
          <div className="top-actions"><span className="local-badge"><span className="status-dot" /> Stored locally</span><button className="primary" onClick={() => setShowImport(true)}>＋ Import data</button></div>
        </header>

        {!selected ? (
          <section className="welcome">
            <div className="welcome-mark">D</div>
            <p className="eyebrow">A calm place for your data</p>
            <h1>Bring your data together.</h1>
            <p>Import a CSV or Excel file to start exploring your data in one simple workspace.</p>
            <button className="primary" onClick={() => setShowImport(true)}>＋ &nbsp;Import your first file</button>
            <span>CSV and XLSX · Up to 25 MB · Stored on this computer</span>
          </section>
        ) : (
          <div className="content">
            <div className="page-heading">
              <div><p className="eyebrow">DATASET</p><h1>{selected.name}</h1><p className="dataset-description">{selected.description || `Imported from ${selected.source_filename}`}</p></div>
              <div className="heading-actions"><button className="text-button danger" onClick={() => void deleteDataset()}>Delete dataset</button><button className="secondary" onClick={() => setShowImport(true)}>＋ Add dataset</button></div>
            </div>
            <div className="dataset-stats">
              <div><strong>{selected.row_count.toLocaleString()}</strong><span>records</span></div>
              <div><strong>{selected.columns.length}</strong><span>columns</span></div>
              <div><strong>{selected.source_type.toUpperCase()}</strong><span>source type</span></div>
              <div><strong>{new Date(selected.created_at).toLocaleDateString()}</strong><span>imported</span></div>
            </div>

            <section className="toolbar" aria-label="Table controls">
              <label className="searchbox"><span aria-hidden="true">⌕</span><input aria-label="Search all records" placeholder="Search all records…" value={search} onChange={(event) => { setLoading(true); setSearch(event.target.value); setPage(1) }} /><kbd>↵</kbd></label>
              <button className={`secondary ${activeConditions ? 'active-button' : ''}`} onClick={() => document.getElementById('filter-builder')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>☷ &nbsp;Filter{activeConditions ? ` · ${activeConditions}` : ''}</button>
              <button className="secondary" onClick={startCreateRecord}>＋ Add record</button>
              <details className="menu">
                <summary className="secondary">Export &nbsp;⌄</summary>
                <div className="menu-popover"><button onClick={() => void exportRecords('csv')}>Export matching records · CSV</button><button onClick={() => void exportRecords('xlsx')}>Export matching records · Excel</button></div>
              </details>
            </section>

            <div className="view-controls">
              <div className="saved-control"><label htmlFor="saved-filter">Saved filters</label><select id="saved-filter" value={activeConfig.filter} onChange={(event) => loadConfiguration('filter', event.target.value)}><option value="">Choose a filter…</option>{filterConfigs.map((config) => <option key={config.id} value={config.id}>{config.name}</option>)}</select>{activeConfig.filter && <button className="text-button danger" onClick={() => void removeConfiguration('filter', activeConfig.filter)}>Delete</button>}</div>
              <div className="saved-control"><label htmlFor="saved-table">Table views</label><select id="saved-table" value={activeConfig.table} onChange={(event) => loadConfiguration('table', event.target.value)}><option value="">Choose a view…</option>{tableConfigs.map((config) => <option key={config.id} value={config.id}>{config.name}</option>)}</select>{activeConfig.table && <button className="text-button danger" onClick={() => void removeConfiguration('table', activeConfig.table)}>Delete</button>}</div>
            </div>

            <section id="filter-builder" className="filter-builder">
              <div className="filter-heading"><div><span className="section-icon">☷</span><strong>Filter this dataset</strong><span className="muted">Conditions apply across all records</span></div><div className="logic-toggle" aria-label="Combine filter conditions">{(['and', 'or'] as const).map((logic) => <button key={logic} className={filterLogic === logic ? 'chosen' : ''} onClick={() => setFilterLogic(logic)}>{logic.toUpperCase()}</button>)}</div></div>
              {draftConditions.map((condition, index) => {
                const operators = filterOperators(selected.columns.find((column) => column.name === condition.column))
                const noValue = ['is_null', 'is_not_null', 'is_empty', 'is_not_empty', 'true', 'false'].includes(condition.operator)
                return <div className="condition-row" key={`${index}-${condition.column}`}>
                  <span className="condition-number">{index + 1}</span>
                  <select aria-label={`Filter ${index + 1} column`} value={condition.column} onChange={(event) => changeCondition(index, { column: event.target.value })}>{selected.columns.map((column) => <option key={column.name} value={column.name}>{column.name}</option>)}</select>
                  <select aria-label={`Filter ${index + 1} operator`} value={condition.operator} onChange={(event) => changeCondition(index, { operator: event.target.value })}>{operators.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
                  {!noValue && <input aria-label={`Filter ${index + 1} value`} type="text" placeholder={condition.operator === 'between' ? 'Value 1, value 2' : 'Enter a value'} value={Array.isArray(condition.value) ? condition.value.join(', ') : String(condition.value ?? '')} onChange={(event) => changeCondition(index, { value: event.target.value })} />}
                  <button className="icon-button remove-condition" aria-label={`Remove filter ${index + 1}`} onClick={() => setDraftConditions((items) => items.filter((_, itemIndex) => itemIndex !== index))}>×</button>
                </div>
              })}
              <div className="filter-footer"><button className="text-button" onClick={addCondition}>＋ Add condition</button><div><button className="text-button" onClick={() => { setDraftConditions([]); setAppliedFilter(noFilters); setPage(1) }}>Clear</button><button className="primary small" onClick={applyFilters}>Apply filters</button></div></div>
              {draftConditions.length > 0 && <div className="save-view-row"><input aria-label="Saved filter name" placeholder="Name this filter…" value={filterName} onChange={(event) => setFilterName(event.target.value)} /><button className="secondary small" disabled={!filterName.trim()} onClick={() => void saveConfiguration('filter', filterName, draftFilterDefinition, activeConfig.filter || undefined)}>{activeConfig.filter ? 'Update filter' : 'Save filter'}</button>{activeConfig.filter && <button className="text-button" disabled={!filterName.trim()} onClick={() => void saveConfiguration('filter', filterName, draftFilterDefinition)}>Save as new</button>}</div>}
              {result && <p className="match-count">{result.total.toLocaleString()} matching {result.total === 1 ? 'record' : 'records'}</p>}
            </section>

            <div className="table-settings">
              <details className="column-menu"><summary className="text-button">Columns ({visibleColumns.length}/{selected.columns.length})</summary><div className="column-popover">{selected.columns.map((column) => <div className="column-option" key={column.name}><label><input type="checkbox" checked={visibleColumns.includes(column.name)} onChange={(event) => setVisibleColumns((items) => event.target.checked ? [...items, column.name] : items.filter((item) => item !== column.name))} />{column.name}</label><span><button aria-label={`Move ${column.name} earlier`} disabled={!visibleColumns.includes(column.name) || visibleColumns.indexOf(column.name) === 0} onClick={() => moveColumn(column.name, -1)}>↑</button><button aria-label={`Move ${column.name} later`} disabled={!visibleColumns.includes(column.name) || visibleColumns.indexOf(column.name) === visibleColumns.length - 1} onClick={() => moveColumn(column.name, 1)}>↓</button></span></div>)}<button className="text-button" onClick={() => loadConfiguration('table', '')}>Restore defaults</button></div></details>
              <div className="saved-control inline"><label htmlFor="detail-layout">Record layout</label><select id="detail-layout" value={activeConfig.detail} onChange={(event) => loadConfiguration('detail', event.target.value)}><option value="">Default layout</option>{detailConfigs.map((config) => <option key={config.id} value={config.id}>{config.name}</option>)}</select></div>
              <span className="scope-note">Showing {result?.records.length ?? 0} of {result?.total ?? 0} matching records</span>
            </div>

            <div className="table-frame">
              {loading && <div className="loading-bar" />}
              <div className="table-scroll"><table><thead><tr><th className="row-number">#</th>{shownColumns.map((column) => <th key={column.name}><button className="sort-button" onClick={() => { setLoading(true); setSortBy(column.name); setSortDirection(sortBy === column.name && sortDirection === 'asc' ? 'desc' : 'asc'); setPage(1) }}>{column.name}{sortBy === column.name ? sortDirection === 'asc' ? ' ↑' : ' ↓' : ''}</button></th>)}<th className="row-action" /></tr></thead>
                <tbody>
                  {result?.records.map((row, index) => <tr key={row._record_id} onClick={() => openRecord(row)} onKeyDown={(event) => { if (event.key === 'Enter') openRecord(row) }} tabIndex={0} aria-label={`Open record ${index + 1}`}>
                    <td className="row-number">{(page - 1) * PAGE_SIZE + index + 1}</td>{shownColumns.map((column) => <td key={column.name} title={showValue(row[column.name])}>{showValue(row[column.name])}</td>)}<td className="row-action">›</td>
                  </tr>)}
                  {!loading && result?.records.length === 0 && <tr><td className="empty-cell" colSpan={shownColumns.length + 2}>No records match this view. Try another search or clear your filters.</td></tr>}
                </tbody>
              </table></div>
              <footer className="table-footer"><span>{result?.total.toLocaleString() ?? '—'} records</span><div className="pagination"><button className="secondary page-button" aria-label="Previous page" disabled={page <= 1} onClick={() => { setLoading(true); setPage((value) => Math.max(1, value - 1)) }}>‹</button><span>Page {page} of {Math.max(1, result?.pages ?? 1)}</span><button className="secondary page-button" aria-label="Next page" disabled={page >= (result?.pages ?? 1)} onClick={() => { setLoading(true); setPage((value) => value + 1) }}>›</button></div></footer>
            </div>

            <section className="view-editor">
              <div><strong>Save table view</strong><p>Keep your visible columns and sort order ready for next time.</p></div>
              <input aria-label="Table view name" placeholder="Name this table view…" value={tableName} onChange={(event) => setTableName(event.target.value)} />
              <button className="secondary small" disabled={!tableName.trim()} onClick={() => void saveConfiguration('table', tableName, { visibleColumns, sortBy, sortDirection }, activeConfig.table || undefined)}>{activeConfig.table ? 'Update view' : 'Save table view'}</button>
              {activeConfig.table && <button className="text-button" disabled={!tableName.trim()} onClick={() => void saveConfiguration('table', tableName, { visibleColumns, sortBy, sortDirection })}>Save as new</button>}
            </section>

            <section className="view-editor detail-editor">
              <div><strong>Record detail layout</strong><p>Choose the fields and labels shown when you open a record.</p></div>
              <input aria-label="Detail layout name" placeholder="Name this layout…" value={detailName} onChange={(event) => setDetailName(event.target.value)} />
              <input aria-label="Detail section name" placeholder="Section name" value={detailSection} onChange={(event) => setDetailSection(event.target.value)} />
              <select aria-label="Detail layout columns" value={detailColumns} onChange={(event) => setDetailColumns(Number(event.target.value) as 1 | 2)}><option value={1}>One column</option><option value={2}>Two columns</option></select>
              <button className="secondary small" disabled={!detailName.trim()} onClick={() => void saveConfiguration('detail', detailName, { fields: detailFields, labels: detailLabels, section: detailSection, columns: detailColumns }, activeConfig.detail || undefined)}>{activeConfig.detail ? 'Update layout' : 'Save layout'}</button>
              {activeConfig.detail && <button className="text-button" disabled={!detailName.trim()} onClick={() => void saveConfiguration('detail', detailName, { fields: detailFields, labels: detailLabels, section: detailSection, columns: detailColumns })}>Save as new</button>}
              <div className="detail-field-editor">{selected.columns.map((column) => <div className="detail-field-option" key={column.name}><label><input type="checkbox" checked={detailFields.includes(column.name)} onChange={(event) => setDetailFields((items) => event.target.checked ? [...items, column.name] : items.filter((item) => item !== column.name))} /><span>{column.name}</span></label><span className="field-order"><button aria-label={`Move ${column.name} earlier`} disabled={!detailFields.includes(column.name) || detailFields.indexOf(column.name) === 0} onClick={() => moveDetailField(column.name, -1)}>↑</button><button aria-label={`Move ${column.name} later`} disabled={!detailFields.includes(column.name) || detailFields.indexOf(column.name) === detailFields.length - 1} onClick={() => moveDetailField(column.name, 1)}>↓</button></span><input aria-label={`Display label for ${column.name}`} placeholder={column.name} value={detailLabels[column.name] ?? ''} onChange={(event) => setDetailLabels((labels) => ({ ...labels, [column.name]: event.target.value }))} /></div>)}<button className="text-button" onClick={() => { setDetailFields(selected.columns.map((column) => column.name)); setDetailLabels({}); setDetailSection('Record details'); setDetailColumns(2); loadConfiguration('detail', '') }}>Restore defaults</button></div>
            </section>
          </div>
        )}
      </main>

      {(record || creating) && selected && <div className="overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDetail() }}>
        <section className="detail-panel" role="dialog" aria-modal="true" aria-labelledby="detail-title">
          <header><div><p className="eyebrow">{creating ? 'NEW RECORD' : 'RECORD DETAILS'}</p><h2 id="detail-title">{creating ? 'Add a record' : 'Record'}</h2></div><button className="icon-button" aria-label="Close details" onClick={closeDetail}>×</button></header>
          {!creating && <div className="detail-section-heading"><strong>{detailSection}</strong><span>{detailColumns === 2 ? 'Two columns' : 'One column'}</span><div className="record-navigation"><button className="text-button" onClick={() => navigateRecord(-1)} disabled={!result || result.records.findIndex((item) => item._record_id === record?._record_id) <= 0}>Previous</button><button className="text-button" onClick={() => navigateRecord(1)} disabled={!result || result.records.findIndex((item) => item._record_id === record?._record_id) >= result.records.length - 1}>Next</button></div></div>}
          <div className={`detail-fields columns-${detailColumns}`}>{(creating ? selected.columns : detailFields.map((name) => selected.columns.find((column) => column.name === name)).filter((column): column is Column => column !== undefined)).map((column) => <label className="detail-field" key={column.name}><span>{detailLabels[column.name] || column.name}<small>{column.type.toLowerCase()}</small></span>{editing || creating ? renderEditor(column, draftRecord[column.name], (value) => setDraftRecord((current) => ({ ...current, [column.name]: value }))) : <output>{showValue(record?.[column.name])}</output>}</label>)}</div>
          <footer>
            {!creating && !editing && <button className="text-button danger" onClick={() => void deleteRecord()}>Delete record</button>}
            <span className="panel-spacer" />
            <button className="secondary" onClick={closeDetail}>{editing || creating ? 'Cancel' : 'Close'}</button>
            {editing || creating ? <button className="primary" onClick={() => void saveRecord()}>Save record</button> : <button className="primary" onClick={() => { setEditing(true); setDraftRecord(Object.fromEntries(selected.columns.map((column) => [column.name, record?.[column.name]]))) }}>Edit record</button>}
          </footer>
        </section>
      </div>}

      {showImport && <div className="overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowImport(false) }}>
        <section className="import-dialog" role="dialog" aria-modal="true" aria-labelledby="import-title">
          <header><div><p className="eyebrow">ADD A SOURCE</p><h2 id="import-title">Import a file</h2><p>Bring a CSV or Excel spreadsheet into your local workspace.</p></div><button className="icon-button" aria-label="Close import" onClick={() => setShowImport(false)}>×</button></header>
          <label className="file-drop"><span className="upload-icon">↑</span><strong>{file?.name ?? 'Choose a CSV or Excel file'}</strong><small>CSV or XLSX · Maximum 25 MB</small><input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => void selectFile(event.target.files?.[0] ?? null)} /></label>
          {preview && <div className="preview-summary"><strong>Preview</strong><span>{preview.row_count.toLocaleString()} records · {preview.columns.length} columns</span></div>}
          {preview && preview.sheets.length > 0 && <label className="field-label">Worksheet<select value={sheet} onChange={(event) => void changeSheet(event.target.value)}>{preview.sheets.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>}
          {preview && <div className="preview-table"><table><thead><tr>{preview.columns.map((column) => <th key={column.name}>{column.name}<small>{column.type}</small></th>)}</tr></thead><tbody>{preview.preview.slice(0, 5).map((row, index) => <tr key={index}>{preview.columns.map((column) => <td key={column.name}>{showValue(row[column.name])}</td>)}</tr>)}</tbody></table></div>}
          <div className="import-fields"><label className="field-label">Dataset name<input value={importName} onChange={(event) => setImportName(event.target.value)} placeholder="e.g. Quarterly sales" maxLength={120} /></label><label className="field-label">Description <span className="optional">optional</span><input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="A note about this dataset" maxLength={500} /></label></div>
          <footer><button className="secondary" onClick={() => setShowImport(false)}>Cancel</button><button className="primary" disabled={!file || !preview || !importName.trim() || loading} onClick={() => void importFile()}>{loading ? 'Importing…' : 'Import dataset'}</button></footer>
        </section>
      </div>}

      {(message || error) && <div className={`toast ${error ? 'toast-error' : ''}`} role={error ? 'alert' : 'status'}><span>{error || message}</span><button aria-label="Dismiss message" onClick={() => { setError(''); setMessage('') }}>×</button></div>}
    </div>
  )
}

export default App
