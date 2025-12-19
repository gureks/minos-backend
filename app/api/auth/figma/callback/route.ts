import { NextRequest, NextResponse } from 'next/server';
import { exchangeFigmaCode, getFigmaUser } from '@/lib/figma';
import { supabase } from '@/lib/supabaseClient';
import { signSession } from '@/lib/jwt';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const state = searchParams.get('state');

  if (!code || !state) {
    return NextResponse.json({ error: 'Missing code or state' }, { status: 400 });
  }

  try {
    // 1. Exchange Code
    const tokenData = await exchangeFigmaCode(code);
    const { access_token, refresh_token } = tokenData;

    // 2. Get User Profile
    const figmaUser = await getFigmaUser(access_token);

    // 3. Upsert User in DB
    const { data: user, error: userError } = await supabase
      .from('users')
      .upsert({
        figma_id: figmaUser.id,
        email: figmaUser.email,
        full_name: figmaUser.handle,
        avatar_url: figmaUser.img_url,
        access_token,
        refresh_token,
      }, { onConflict: 'figma_id' })
      .select()
      .single();

    if (userError || !user) {
      console.error('DB Upsert Error:', userError);
      throw new Error('Database error creating user');
    }

    // 4. Update the Auth Code with the User ID
    const { error: codeError } = await supabase
      .from('auth_codes')
      .update({ user_id: user.id })
      .eq('code', state);

    if (codeError) {
      throw new Error('Failed to update polling state');
    }

    return NextResponse.json({ success: true, message: 'You can close this window now.' });

  } catch (err: any) {
    console.error('Auth Callback Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
