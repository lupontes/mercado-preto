import { loadEnv, defineConfig } from '@medusajs/framework/utils'

loadEnv(process.env.NODE_ENV || 'development', process.cwd())

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    http: {
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      authCors: process.env.AUTH_CORS!,
      jwtSecret: process.env.JWT_SECRET || "supersecret",
      cookieSecret: process.env.COOKIE_SECRET || "supersecret",
    },
  },

  modules: [
    // Módulo de vendedores afroemprendedores
    {
      resolve: "./src/modules/seller",
    },

    // Módulo de comissão e repasse
    {
      resolve: "./src/modules/commission",
    },

    // Módulo de repasses financeiros para vendedores
    {
      resolve: "./src/modules/payout",
    },

    // Módulo fiscal — emissão de NF-e/NFS-e via Focus NFe
    {
      resolve: "./src/modules/fiscal",
    },

    // Fulfillment manual (flat-rate) — base para shipping options no admin
    {
      resolve: "@medusajs/medusa/fulfillment",
      options: {
        providers: [
          {
            resolve: "@medusajs/fulfillment-manual",
            id: "manual",
          },
        ],
      },
    },

    // Payment provider MercadoPago registrado no módulo de pagamento nativo
    {
      resolve: "@medusajs/medusa/payment",
      options: {
        providers: [
          {
            resolve: "./src/modules/mercadopago",
            id: "mercadopago",
            options: {
              accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN,
            },
          },
        ],
      },
    },
  ],
})
