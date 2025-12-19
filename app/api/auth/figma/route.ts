import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { code } = body;

    if (!code) {
      return NextResponse.json({ error: 'Missing code' }, { status: 400 });
    }

    // TODO: Exchange code for token with Figma
    // const token = await exchangeFigmaToken(code);

    return NextResponse.json({ success: true, message: 'Auth endpoint ready' });
  } catch (error) {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
