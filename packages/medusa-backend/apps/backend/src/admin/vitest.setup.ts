import * as jestDomMatchers from "@testing-library/jest-dom/matchers"
import { afterEach, expect } from "vitest"
import { cleanup } from "@testing-library/react"

// Not using "@testing-library/jest-dom/vitest": it imports `vitest` from its own
// location in the pnpm store, which resolves to the hoisted copy (the
// storefront's vitest 4) and extends that instance's `expect` instead of ours.
// The backend is pinned to vitest 3 because Medusa's admin bundler needs vite 5.
expect.extend(jestDomMatchers)

// jsdom doesn't implement the Pointer Events capture APIs that Radix UI's
// Select relies on for its interactions. Polyfill them as no-ops so tests
// that open/select from a Radix Select don't crash with
// "target.hasPointerCapture is not a function".
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false
}
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {}
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {}
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}

afterEach(() => {
  cleanup()
})
