import ProductModule from "@medusajs/product"
import SellerModule from "../modules/seller"
import { defineLink } from "@medusajs/framework/utils"

export default defineLink(
  SellerModule.linkable.seller,
  {
    linkable: ProductModule.linkable.product,
    isList: true,
    deleteCascade: false,
  }
)
