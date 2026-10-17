/**
 * Seller as returned by admin routes. The password hash is never sent to a
 * client, admin included: it is only useful to someone trying to crack it.
 */
export function toAdminSeller<T extends Record<string, unknown>>(seller: T): Omit<T, "passwordHash"> {
  const { passwordHash: _passwordHash, ...rest } = seller
  return rest
}
