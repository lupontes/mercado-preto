import { Hero } from '@/components/layout/Hero'
import { FeaturedSellers } from '@/components/seller/FeaturedSellers'
import { FeaturedProducts } from '@/components/product/FeaturedProducts'
import { MissionBanner } from '@/components/layout/MissionBanner'

export default function HomePage() {
  return (
    <>
      <Hero />
      <MissionBanner />
      <FeaturedSellers />
      <FeaturedProducts />
    </>
  )
}
