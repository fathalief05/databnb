import type { Dataset, FilterGroup, RecordRow, SavedConfiguration } from '../types'

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8000/api'

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, options)
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.detail ?? `Request failed (${response.status})`)
  }
  return response.json() as Promise<T>
}

function json(method: string, value: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) }
}

export const api = {
  datasets: () => request<Dataset[]>('/datasets'),
  records: (datasetId: string, page: number, search: string, sortBy: string | null, sortDir: string, filters: FilterGroup | null) => {
    const query = new URLSearchParams({ page: String(page), page_size: '50', search, sort_dir: sortDir })
    if (sortBy) query.set('sort_by', sortBy)
    if (filters) query.set('filters', JSON.stringify(filters))
    return request<{ items: RecordRow[]; total: number; page: number; page_size: number }>(
      `/datasets/${datasetId}/records?${query}`,
    )
  },
  configurations: (datasetId: string, kind?: string) =>
    request<SavedConfiguration[]>(`/datasets/${datasetId}/configurations${kind ? `?kind=${kind}` : ''}`),
  saveConfiguration: (datasetId: string, value: Partial<SavedConfiguration>, id?: string) =>
    request<SavedConfiguration>(
      `/datasets/${datasetId}/configurations${id ? `/${id}` : ''}`,
      json(id ? 'PUT' : 'POST', value),
    ),
  deleteConfiguration: (datasetId: string, id: string) =>
    request<{ deleted: boolean }>(`/datasets/${datasetId}/configurations/${id}`, { method: 'DELETE' }),
  saveRecord: (datasetId: string, values: Record<string, unknown>, id?: string) =>
    request<RecordRow>(
      `/datasets/${datasetId}/records${id ? `/${id}` : ''}`,
      json(id ? 'PUT' : 'POST', { values }),
    ),
  deleteRecord: (datasetId: string, id: string) =>
    request<{ deleted: boolean }>(`/datasets/${datasetId}/records/${id}`, { method: 'DELETE' }),
}
