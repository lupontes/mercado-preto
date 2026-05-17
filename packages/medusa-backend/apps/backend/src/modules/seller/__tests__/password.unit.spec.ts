// Tests for seller password hashing and verification.
// Uses Node.js crypto — no external dependencies or database.
import crypto from "crypto"

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex")
  const hash = crypto.scryptSync(password, salt, 64).toString("hex")
  return `${salt}:${hash}`
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":")
  if (!salt || !hash) return false
  const computed = crypto.scryptSync(password, salt, 64).toString("hex")
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(computed, "hex"))
}

describe("seller password utilities", () => {
  it("hashes a password into salt:hash format", () => {
    const hashed = hashPassword("Senha@123")
    const parts = hashed.split(":")
    expect(parts).toHaveLength(2)
    expect(parts[0]).toHaveLength(32)  // 16 bytes hex = 32 chars
    expect(parts[1]).toHaveLength(128) // 64 bytes hex = 128 chars
  })

  it("verifies the correct password successfully", () => {
    const password = "Senha@123"
    const hashed = hashPassword(password)
    expect(verifyPassword(password, hashed)).toBe(true)
  })

  it("rejects an incorrect password", () => {
    const hashed = hashPassword("Senha@123")
    expect(verifyPassword("senhaErrada", hashed)).toBe(false)
  })

  it("produces different hashes for the same password (salt randomness)", () => {
    const password = "Senha@123"
    const hash1 = hashPassword(password)
    const hash2 = hashPassword(password)
    expect(hash1).not.toBe(hash2)
    // Both must still verify correctly
    expect(verifyPassword(password, hash1)).toBe(true)
    expect(verifyPassword(password, hash2)).toBe(true)
  })

  it("returns false for malformed stored hash", () => {
    expect(verifyPassword("any", "not-a-valid-hash")).toBe(false)
    expect(verifyPassword("any", "")).toBe(false)
  })
})
