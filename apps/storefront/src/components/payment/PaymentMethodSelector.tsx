export type PaymentMethod = 'mercadopago' | 'test_cash'

type Props = {
  value: PaymentMethod
  onChange: (method: PaymentMethod) => void
}

const OPTIONS: { id: PaymentMethod; label: string; testId: string; testOnly?: boolean }[] = [
  { id: 'mercadopago', label: 'Cartão / Pix (Mercado Pago)', testId: 'payment-method-mp' },
  { id: 'test_cash', label: 'Dinheiro (teste)', testId: 'payment-method-test-cash', testOnly: true },
]

export default function PaymentMethodSelector({ value, onChange }: Props) {
  return (
    <fieldset className="mt-6">
      <legend className="font-display font-bold text-onyx mb-3">Forma de pagamento</legend>
      <div className="space-y-3">
        {OPTIONS.map((option) => (
          <label
            key={option.id}
            className={`flex items-center gap-4 rounded-xl border p-4 cursor-pointer transition-colors ${
              value === option.id ? 'border-amber bg-amber/5' : 'border-sand-dark hover:border-amber/50'
            }`}
          >
            <input
              type="radio"
              name="payment-method"
              checked={value === option.id}
              onChange={() => onChange(option.id)}
              className="accent-amber"
              data-testid={option.testId}
            />
            <span className="flex-1 font-semibold text-onyx">{option.label}</span>
            {option.testOnly && (
              <span className="rounded-full bg-terracotta/10 px-2 py-0.5 text-xs font-bold uppercase text-terracotta">
                Ambiente de teste
              </span>
            )}
          </label>
        ))}
      </div>
    </fieldset>
  )
}
