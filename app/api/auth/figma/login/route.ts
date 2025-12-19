import { NextRequest, NextResponse } from 'next/server';
import { getFigmaAuthUrl } from '@/lib/figma';
import { supabase } from '@/lib/supabaseClient';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const state = searchParams.get('state');

  if (!state) {
    return NextResponse.json({ error: 'Missing state parameter' }, { status: 400 });
  }

  // 1. Create a record in auth_codes to track this request
  const { error } = await supabase
    .from('auth_codes')
    .insert({ code: state });

  if (error) {
    console.error('DB Error:', error);
    return NextResponse.json({ error: 'Failed to initialize auth' }, { status: 500 });
  }

  // 2. Return the Figma OAuth URL
  try {
    const url = getFigmaAuthUrl(state);
    // If the client requested a redirect:
    // return NextResponse.redirect(url);
    // Usually plugins open the URL themselves, so we return the string.
    return NextResponse.json({ url });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
