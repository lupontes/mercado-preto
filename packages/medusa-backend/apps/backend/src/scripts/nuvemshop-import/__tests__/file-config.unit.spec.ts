describe("medusa-config file module", () => {
  it("registers @medusajs/file-local with backend_url built from BACKEND_URL", () => {
    process.env.BACKEND_URL = "https://api.mercadopreto.com.br"
    process.env.DATABASE_URL = "postgres://x"
    process.env.JWT_SECRET = "x"
    process.env.COOKIE_SECRET = "x"
    process.env.STORE_CORS = "x"
    process.env.ADMIN_CORS = "x"
    process.env.AUTH_CORS = "x"

    jest.resetModules()
    // medusa-config.ts uses `module.exports = defineConfig(...)`, so requiring
    // it returns the config object directly (no `.default` wrapper).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const config = require("../../../../medusa-config")

    // `defineConfig` (from @medusajs/framework/utils) remaps the `modules`
    // array we declare into an object keyed by service name (e.g. "file"),
    // merging our entry over its own built-in default file module.
    const fileModule = config.modules.file
    expect(fileModule).toBeDefined()
    expect(fileModule.options.providers[0].resolve).toBe("@medusajs/file-local")
    expect(fileModule.options.providers[0].options.backend_url).toBe(
      "https://api.mercadopreto.com.br/static"
    )
  })
})
