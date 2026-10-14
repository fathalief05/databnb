export type Column = { name: string; type: string }
export type Dataset = {
  id: string
  name: string
  description: string
  source_type: string
  source_filename: string
  schema: Column[]
  row_count: number
}
export type RecordRow = { _record_id: string; [key: string]: unknown }
export type FilterCondition = {
  type: 'condition'
  column: string
  operator: string
  value?: unknown
}
export type FilterGroup = {
  type: 'group'
  logic: 'and' | 'or'
  conditions: Array<FilterCondition | FilterGroup>
}
export type SavedConfiguration = {
  id: string
  dataset_id: string
  kind: 'filter' | 'table' | 'detail'
  name: string
  description: string
  config: Record<string, unknown>
}
