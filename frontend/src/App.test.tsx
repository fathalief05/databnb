import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

const sampleDataset = {
  id: 'dataset-1',
  name: 'Customers',
  description: 'A small example.',
  source_type: 'spreadsheet',
  source_filename: 'customers.csv',
  row_count: 1,
  schema: [{ name: 'Name', type: 'text' }, { name: 'Amount', type: 'integer' }],
}
const sampleRecord = { _record_id: 'row-1', Name: 'Aster', Amount: 120 }

vi.mock('./services/api', () => ({
  api: {
    datasets: vi.fn(),
    records: vi.fn(),
    configurations: vi.fn(),
    saveConfiguration: vi.fn(),
    deleteConfiguration: vi.fn(),
    saveRecord: vi.fn(),
    deleteRecord: vi.fn(),
  },
}))

import { api } from './services/api'

describe('DataBNB workspace', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.datasets).mockResolvedValue([sampleDataset])
    vi.mocked(api.records).mockResolvedValue({ items: [sampleRecord], total: 1, page: 1, page_size: 50 })
    vi.mocked(api.configurations).mockResolvedValue([])
    vi.mocked(api.saveRecord).mockResolvedValue({ ...sampleRecord, Amount: 240 })
  })

  it('loads full-dataset results and opens a record for editing', async () => {
    const user = userEvent.setup()
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Customers' })).toBeInTheDocument()
    expect(await screen.findByText('Aster')).toBeInTheDocument()
    expect(api.records).toHaveBeenCalledWith('dataset-1', 1, '', null, 'asc', null)

    await user.click(screen.getByText('Aster'))
    const details = screen.getByLabelText('Record details')
    await user.click(within(details).getByRole('button', { name: /edit record/i }))
    const amount = within(details).getByDisplayValue('120')
    await user.clear(amount)
    await user.type(amount, '240')
    await user.click(within(details).getByRole('button', { name: 'Save record' }))

    await waitFor(() => expect(api.saveRecord).toHaveBeenCalledWith('dataset-1', { Name: 'Aster', Amount: '240' }, 'row-1'))
    expect(await within(details).findByText('Record saved.')).toBeInTheDocument()
  })

  it('builds a database-backed filter and submits it with the record query', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: 'Customers' })
    await user.click(screen.getByRole('button', { name: 'Open filters' }))
    await user.selectOptions(screen.getByLabelText('Filter field 1'), 'Amount')
    await user.selectOptions(screen.getByLabelText('Filter operator 1'), 'greater_than')
    fireEvent.change(screen.getByLabelText('Filter value 1'), { target: { value: '100' } })
    await user.click(screen.getByRole('button', { name: '＋ Add condition' }))
    await user.selectOptions(screen.getByLabelText('Filter field 2'), 'Name')
    await user.selectOptions(screen.getByLabelText('Filter operator 2'), 'contains')
    fireEvent.change(screen.getByLabelText('Filter value 2'), { target: { value: 'st' } })
    await user.click(screen.getByRole('button', { name: 'Apply filter' }))

    await waitFor(() => expect(api.records).toHaveBeenLastCalledWith(
      'dataset-1',
      1,
      '',
      null,
      'asc',
      {
        type: 'group',
        logic: 'and',
        conditions: [
          { type: 'condition', column: 'Amount', operator: 'greater_than', value: '100' },
          { type: 'condition', column: 'Name', operator: 'contains', value: 'st' },
        ],
      },
    ))
  })
})
