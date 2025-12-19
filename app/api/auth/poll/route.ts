import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabaseClient';
import { signSession } from '@/lib/jwt';

export async function POST(request: NextRequest) {
  try {
    const { state } = await request.json();

    if (!state) return NextResponse.json({ error: 'Missing state' }, { status: 400 });

    // Check if the code has been fulfilled
    const { data, error } = await supabase
      .from('auth_codes')
      .select('user_id')
      .eq('code', state)
      .single();

    if (error || !data) {
      return NextResponse.json({ status: 'pending' });
    }

    if (!data.user_id) {
      return NextResponse.json({ status: 'pending' });
    }

    // Success! Generate JWT
    const token = await signSession({ sub: data.user_id, role: 'user' });

    // Cleanup: Delete the code (optional but good practice)
    await supabase.from('auth_codes').delete().eq('code', state);

    return NextResponse.json({ status: 'complete', token });

  } catch (err) {
    return NextResponse.json({ error: 'Internal Error' }, { status: 500 });
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

