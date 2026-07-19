import { loadEnv, defineConfig } from '@medusajs/framework/utils'
import { validateEnv } from './src/utils/validate-env'

loadEnv(process.env.NODE_ENV || 'development', process.cwd())

validateEnv()

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    redisUrl: process.env.REDIS_URL,
    http: {
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      authCors: process.env.AUTH_CORS!,
      jwtSecret: process.env.JWT_SECRET!,
      cookieSecret: process.env.COOKIE_SECRET!,
    },
  },

  modules: [
    // Afro-entrepreneur seller module
    {
      resolve: "./src/modules/seller",
    },

    // Commission and payout module
    {
      resolve: "./src/modules/commission",
    },

    // Seller payout module
    {
      resolve: "./src/modules/payout",
    },

    // Fiscal module — NF-e/NFS-e issuance via Focus NFe
    {
      resolve: "./src/modules/fiscal",
    },

    // File storage — migrated product images re-hosted locally
    {
      resolve: "@medusajs/medusa/file",
      options: {
        providers: [
          {
            resolve: "@medusajs/file-local",
            id: "local",
            options: {
              // Falls back to the local dev URL so images keep working when
              // BACKEND_URL is unset/empty (production deploys must set it).
              backend_url: `${process.env.BACKEND_URL || "http://localhost:9000"}/static`,
            },
          },
        ],
      },
    },

    // Manual (flat-rate) fulfillment — base for admin shipping options
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

    // MercadoPago payment provider registered on the native payment module
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
