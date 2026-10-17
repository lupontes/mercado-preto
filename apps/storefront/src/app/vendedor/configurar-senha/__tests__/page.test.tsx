// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const search = vi.hoisted(() => ({ params: new URLSearchParams() }))
const replace = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  useSearchParams: () => search.params,
}))

// Plain stubs: a vi.fn returning a rejected promise is reported by Vitest as unhandled.
const api = vi.hoisted(() => ({
  setCalls: vi.fn(),
  linkCalls: vi.fn(),
  setImpl: async (): Promise<{ message: string }> => ({ message: 'ok' }),
}))
vi.mock('@/lib/seller-api', () => ({
  setSellerPassword: (token: string, password: string) => {
    api.setCalls(token, password)
    return api.setImpl()
  },
  requestSellerPasswordLink: async (email: string) => {
    api.linkCalls(email)
    return { message: 'Se o e-mail estiver cadastrado, você receberá um link para redefinir a senha.' }
  },
}))

import ConfigurarSenhaPage from '../page'

async function fillPasswords(user: ReturnType<typeof userEvent.setup>, password: string, confirm = password) {
  await user.type(screen.getByLabelText('Nova senha'), password)
  await user.type(screen.getByLabelText('Confirmar senha'), confirm)
  await user.click(screen.getByRole('button', { name: 'Salvar senha' }))
}

describe('ConfigurarSenhaPage', () => {
  beforeEach(() => {
    api.setCalls.mockReset()
    api.linkCalls.mockReset()
    api.setImpl = async () => ({ message: 'ok' })
  })
  afterEach(() => replace.mockClear())

  describe('with a token in the link', () => {
    beforeEach(() => { search.params = new URLSearchParams('token=tok') })

    it('sends the token with the new password and shows success', async () => {
      const user = userEvent.setup()
      render(<ConfigurarSenhaPage />)
      await fillPasswords(user, 'senhaNova1')

      expect(await screen.findByText('Senha configurada!')).toBeInTheDocument()
      expect(api.setCalls).toHaveBeenCalledWith('tok', 'senhaNova1')
    })

    it('shows the error and offers a new link when the token is no longer valid', async () => {
      api.setImpl = async () => { throw new Error('Link inválido ou expirado. Peça um novo.') }
      const user = userEvent.setup()
      render(<ConfigurarSenhaPage />)
      await fillPasswords(user, 'senhaNova1')

      expect(await screen.findByText('Link inválido ou expirado. Peça um novo.')).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Pedir um novo link' })).toHaveAttribute('href', '/vendedor/configurar-senha')
    })

    it('does not call the API when the passwords differ', async () => {
      const user = userEvent.setup()
      render(<ConfigurarSenhaPage />)
      await fillPasswords(user, 'senhaNova1', 'outraSenha1')

      expect(screen.getByText('As senhas não coincidem.')).toBeInTheDocument()
      expect(api.setCalls).not.toHaveBeenCalled()
    })
  })

  describe('without a token', () => {
    beforeEach(() => { search.params = new URLSearchParams() })

    it('asks for the e-mail and requests a link', async () => {
      const user = userEvent.setup()
      render(<ConfigurarSenhaPage />)
      await user.type(screen.getByLabelText('E-mail'), 'loja@example.com')
      await user.click(screen.getByRole('button', { name: 'Enviar link' }))

      expect(await screen.findByText('Se o e-mail estiver cadastrado, você receberá um link para redefinir a senha.')).toBeInTheDocument()
      expect(api.linkCalls).toHaveBeenCalledWith('loja@example.com')
      await waitFor(() => expect(replace).not.toHaveBeenCalled())
    })
  })
})
