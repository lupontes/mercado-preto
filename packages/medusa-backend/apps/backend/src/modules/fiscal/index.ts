import { Module } from "@medusajs/framework/utils"
import FiscalModuleService from "./service"

export const FISCAL_MODULE = "fiscal"

export default Module(FISCAL_MODULE, { service: FiscalModuleService })
