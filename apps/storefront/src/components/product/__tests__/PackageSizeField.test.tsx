// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import PackageSizeField, { type PackageValue } from '../PackageSizeField'

function Harness({ initial, onChange }: { initial: PackageValue; onChange: (v: PackageValue) => void }) {
  const [v, setV] = useState(initial)
  return <PackageSizeField value={v} onChange={(n) => { setV(n); onChange(n) }} />
}

describe('PackageSizeField', () => {
  it('offers the four sizes with examples', () => {
    render(<Harness initial={{ size: 'medium' }} onChange={vi.fn()} />)
    expect(screen.getByRole('radio', { name: /Pequeno/ })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Médio/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /Grande/ })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Volumoso/ })).toBeInTheDocument()
    expect(screen.queryByLabelText('Comprimento (cm)')).toBeNull()
  })

  it('asks for measures when Volumoso is chosen and reports them', async () => {
    const onChange = vi.fn()
    render(<Harness initial={{ size: 'medium' }} onChange={onChange} />)
    await userEvent.click(screen.getByRole('radio', { name: /Volumoso/ }))
    await userEvent.type(screen.getByLabelText('Comprimento (cm)'), '65')
    await userEvent.type(screen.getByLabelText('Largura (cm)'), '40')
    await userEvent.type(screen.getByLabelText('Altura (cm)'), '50')
    await userEvent.type(screen.getByLabelText('Peso (kg)'), '1,2')
    expect(onChange).toHaveBeenLastCalledWith({ size: 'bulky', dimensions: { length: 65, width: 40, height: 50, weight: 1.2 } })
  })

  it('warns when the measures exceed the Correios limits', async () => {
    render(<Harness initial={{ size: 'bulky', dimensions: { length: 120, width: 35, height: 115, weight: 1.8 } }} onChange={vi.fn()} />)
    expect(screen.getByText(/acima do limite dos Correios/)).toBeInTheDocument()
  })
})
