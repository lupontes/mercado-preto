import { NextRequest, NextResponse } from 'next/server'

const MEDUSA_URL = process.env.NEXT_PUBLIC_MEDUSA_URL ?? 'http://localhost:9000'
const PUB_KEY = process.env.NEXT_PUBLIC_PUBLISHABLE_KEY ?? ''

export async function POST(req: NextRequest) {
  const body = await req.json()
  console.log('[api/checkout/payment] received body:', JSON.stringify(body))

  const upstream = await fetch(`${MEDUSA_URL}/store/checkout/payment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-publishable-api-key': PUB_KEY,
    },
    body: JSON.stringify(body),
  })

  const data = await upstream.json()
  console.log('[api/checkout/payment] upstream status:', upstream.status, 'body:', JSON.stringify(data))

  return NextResponse.json(data, { status: upstream.status })
}
