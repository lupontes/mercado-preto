import { describe, expect, it } from 'vitest'
import { orderStatusBadge } from '../order-status'

describe('orderStatusBadge', () => {
  it('shows the shipping status of a paid order', () => {
    expect(orderStatusBadge('pending', 'awaiting_shipment').label).toBe('Aguardando envio')
    expect(orderStatusBadge('pending', 'shipped').label).toBe('Enviado')
    expect(orderStatusBadge('completed', 'delivered').label).toBe('Entregue')
  })

  it('shows Cancelado for a canceled order, whatever its shipping status', () => {
    expect(orderStatusBadge('canceled', 'awaiting_shipment').label).toBe('Cancelado')
    expect(orderStatusBadge('cancelled', null).label).toBe('Cancelado')
  })

  it('falls back to the order status label for orders without a shipping status', () => {
    expect(orderStatusBadge('pending', null).label).toBe('Pendente')
    expect(orderStatusBadge('pending', undefined).label).toBe('Pendente')
    expect(orderStatusBadge('requires_action', null).label).toBe('Ação necessária')
  })

  it('shows unknown statuses as-is instead of hiding them', () => {
    expect(orderStatusBadge('archived', null).label).toBe('archived')
    expect(orderStatusBadge('pending', 'returned').label).toBe('returned')
  })
})
