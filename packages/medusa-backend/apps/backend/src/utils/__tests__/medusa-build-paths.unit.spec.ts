import fs from "fs"
import path from "path"

// `medusa build` drops every source file whose path relative to the project
// root merely *contains* one of these chunks (see the backendIgnoreFiles list
// in @medusajs/framework's build-tools/compiler.js). A route such as
// src/api/store/checkout/test-cash/route.ts silently disappears from the
// production build — unit tests run from TypeScript sources and still pass —
// so the endpoint just answers 404 once deployed.
const MEDUSA_BUILD_IGNORED_CHUNKS = ["integration-tests", "test", "unit-tests"]

const projectRoot = path.resolve(__dirname, "../../..")

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      // Test folders and the admin bundle are meant to be excluded from the build.
      if (entry.name === "__tests__" || entry.name === "admin") return []
      return sourceFiles(full)
    }
    if (!/\.(ts|js)$/.test(entry.name) || /\.(spec|test)\.(ts|js)$/.test(entry.name)) return []
    return [path.relative(projectRoot, full)]
  })
}

describe("backend source paths", () => {
  it("never contain a chunk that `medusa build` ignores, so no runtime file is silently dropped", () => {
    const dropped = sourceFiles(path.join(projectRoot, "src")).filter((file) =>
      MEDUSA_BUILD_IGNORED_CHUNKS.some((chunk) => file.includes(chunk))
    )

    expect(dropped).toEqual([])
  })
})
