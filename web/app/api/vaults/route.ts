import { NextResponse } from 'next/server';

export async function GET() {
  const vault = {
    id: process.env.VAULT_ID ?? 'default',
    name: process.env.VAULT_ID ?? 'default',
    bucket: process.env.VAULT_BUCKET ?? '',
    prefix: process.env.VAULT_PREFIX ?? '',
    region: process.env.VAULT_REGION ?? 'us-east-1',
  };
  return NextResponse.json([vault]);
}
