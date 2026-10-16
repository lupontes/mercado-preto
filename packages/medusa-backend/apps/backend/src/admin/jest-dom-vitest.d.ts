// Teaches the type checker about the jest-dom matchers that vitest.setup.ts
// registers with expect.extend. jest-dom ships this augmentation in
// "@testing-library/jest-dom/vitest", but that file lives at the workspace root
// and its `declare module "vitest"` resolves from there, where there is no
// vitest (the backend's vitest 3 is nested under apps/backend/node_modules).
// Declaring it here resolves to the copy the admin tests run on. The interface
// is augmented on "@vitest/expect", where vitest 3 defines Assertion; augmenting
// it through vitest's CommonJS re-export entry does not reach the original.
import type { TestingLibraryMatchers } from "@testing-library/jest-dom/matchers"

declare module "@vitest/expect" {
  interface Assertion<T = any> extends TestingLibraryMatchers<any, T> {}
  interface AsymmetricMatchersContaining extends TestingLibraryMatchers<any, any> {}
}
