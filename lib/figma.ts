export const FIGMA_OAUTH_URL = 'https://www.figma.com/oauth';
export const FIGMA_API_URL = 'https://api.figma.com/v1';

export function getFigmaAuthUrl(state: string) {
  const clientId = process.env.FIGMA_CLIENT_ID;
  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/auth/figma/callback`;

  // Ensure the scope matches what is configured in your Figma App (Developer Console)
  const scope = 'file_content:read file_comments:read file_comments:write current_user:read';

  if (!clientId) throw new Error('FIGMA_CLIENT_ID not set');

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope,
    state,
    response_type: 'code',
  });

  return `${FIGMA_OAUTH_URL}?${params.toString()}`;
}

export async function exchangeFigmaCode(code: string) {
  const clientId = process.env.FIGMA_CLIENT_ID;
  const clientSecret = process.env.FIGMA_CLIENT_SECRET;
  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/auth/figma/callback`;


  if (!clientId || !clientSecret) throw new Error('Figma Credentials missing');

  const res = await fetch(`${FIGMA_API_URL}/oauth/token`, {
    method: 'POST',
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code,
      grant_type: 'authorization_code',
    }),
    headers: { 'Content-Type': 'application/json' },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to exchange token: ${err}`);
  }

  return res.json(); // { access_token, refresh_token, user_id, ... }
}

export async function getFigmaUser(accessToken: string) {
  console.log('Fetching user with token:', accessToken);
  const res = await fetch(`${FIGMA_API_URL}/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  
  if (!res.ok) {
    const txt = await res.text();
    console.error('Figma User Error:', res.status, txt);
    throw new Error(`Failed to fetch user: ${txt}`);
  }
  
  return res.json();
}

export async function getFileComments(fileKey: string, accessToken: string) {
  const res = await fetch(`${FIGMA_API_URL}/files/${fileKey}/comments?as_md=1`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const txt = await res.text();
    console.error('Figma Comments Error:', res.status, txt);
    throw new Error(`Failed to fetch comments: ${txt}`);
  }

  return res.json();
}

export async function postCommentReply(fileKey: string, commentId: string, message: string, accessToken: string) {
  const res = await fetch(`${FIGMA_API_URL}/files/${fileKey}/comments`, {
    method: 'POST',
    headers: { 
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message,
      comment_id: commentId,
    }),
  });

  if (!res.ok) {
    const txt = await res.text();
    console.error('Figma Post Comment Error:', res.status, txt);
    throw new Error(`Failed to post comment: ${txt}`);
  }

  return res.json();
}
