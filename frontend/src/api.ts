export type Column = { name: string; type: 'VARCHAR' | 'BIGINT' | 'DOUBLE' | 'BOOLEAN' }
export type Dataset = {
  id: string
  name: string
  description: string
  source_filename: string
  source_type: string
  row_count: number
  columns: Column[]
  created_at: string
}
export type RecordRow = { _record_id: string; [column: string]: unknown }
export type Condition = { column: string; operator: string; value?: unknown }
export type FilterGroup = { logic: 'and' | 'or'; conditions: Array<Condition | FilterGroup> }
export type Configuration = {
  id: string
  dataset_id: string
  kind: 'filter' | 'table' | 'detail'
  name: string
  description: string
  definition: Record<string, unknown>
  schema_version: number
}
export type PageResult = {
  records: RecordRow[]
  total: number
  page: number
  page_size: number
  pages: number
}
export type Preview = {
  filename: string
  sheets: string[]
  columns: Column[]
  row_count: number
  preview: Record<string, unknown>[]
}

const baseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:8000/api'

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, options)
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.detail ?? `Request failed (${response.status})`)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export const api = {
  datasets: () => request<Dataset[]>('/datasets'),
  preview: (file: File, sheet?: string) => {
    const form = new FormData()
    form.append('file', file)
    if (sheet) form.append('sheet_name', sheet)
    return request<Preview>('/import/preview', { method: 'POST', body: form })
  },
  import: (file: File, name: string, description: string, sheet?: string) => {
    const form = new FormData()
    form.append('file', file)
    form.append('name', name)
    form.append('description', description)
    if (sheet) form.append('sheet_name', sheet)
    return request<Dataset>('/datasets/import', { method: 'POST', body: form })
  },
  records: (datasetId: string, options: {
    page: number
    pageSize: number
    search: string
    sortBy: string
    sortDirection: 'asc' | 'desc'
    filters: FilterGroup | null
  }) => {
    const query = new URLSearchParams({
      page: String(options.page),
      page_size: String(options.pageSize),
      search: options.search,
      sort_direction: options.sortDirection,
    })
    if (options.sortBy) query.set('sort_by', options.sortBy)
    if (options.filters?.conditions.length) query.set('filters', JSON.stringify(options.filters))
    return request<PageResult>(`/datasets/${datasetId}/records?${query}`)
  },
  saveRecord: (datasetId: string, values: Record<string, unknown>, id?: string) =>
    request<RecordRow>(
      `/datasets/${datasetId}/records${id ? `/${id}` : ''}`,
      { method: id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values }) },
    ),
  deleteRecord: (datasetId: string, id: string) =>
    request<void>(`/datasets/${datasetId}/records/${id}`, { method: 'DELETE' }),
  configurations: (datasetId: string, kind: Configuration['kind']) =>
    request<Configuration[]>(`/datasets/${datasetId}/configurations?kind=${kind}`),
  saveConfiguration: (datasetId: string, kind: Configuration['kind'], name: string, definition: Record<string, unknown>) =>
    request<Configuration>(`/datasets/${datasetId}/configurations?kind=${kind}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, definition, schema_version: 1 }),
    }),
  updateConfiguration: (datasetId: string, id: string, name: string, definition: Record<string, unknown>) =>
    request<Configuration>(`/datasets/${datasetId}/configurations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, definition, schema_version: 1 }),
    }),
  deleteConfiguration: (datasetId: string, id: string) =>
    request<void>(`/datasets/${datasetId}/configurations/${id}`, { method: 'DELETE' }),
  export: (datasetId: string, format: 'csv' | 'xlsx', search: string, filters: FilterGroup | null, columns: string[]) =>
    fetch(`${baseUrl}/datasets/${datasetId}/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format, search, filters, columns }),
    }).then(async (response) => {
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        throw new Error(body?.detail ?? `Export failed (${response.status})`)
      }
      return response.blob()
    }),
}
