import { NextRequest, NextResponse } from 'next/server';
import { verifySession } from '@/lib/jwt';
import { supabase } from '@/lib/supabaseClient';
import { getFileComments, postCommentReply, getFigmaUser } from '@/lib/figma';
import { AGENT_CONFIG } from '@/lib/config';
import { analyzeDesign } from '@/lib/llm';
import { extractDesignContext } from '@/lib/designParser';

// Helper for retry logic
async function withRetry<T>(fn: () => Promise<T>, retries: number = 3, delay: number = 1000): Promise<T> {
  let lastError;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      console.warn(`[Retry] Attempt ${i+1}/${retries} failed:`, e);
      if (i < retries - 1) await new Promise(res => setTimeout(res, delay));
    }
  }
  throw lastError;
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    console.log('[Analyze Comments] Auth header:', authHeader ? 'present' : 'missing');
    
    if (!authHeader) {
      console.error('[Analyze Comments] Missing Authorization header');
      return NextResponse.json({ error: 'Missing Authorization header' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    console.log('[Analyze Comments] Token length:', token.length);
    
    const session = await verifySession(token);
    
    if (!session) {
      console.error('[Analyze Comments] Invalid session');
      console.log('[Analyze Comments] Session verification returned null');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    console.log('[Analyze Comments] Session: valid');

    const { fileKey } = await request.json();

    if (!fileKey) {
      return NextResponse.json({ error: 'Missing fileKey' }, { status: 400 });
    }

    // Retrieve current user's Figma Access Token from Supabase (for reading comments)
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('figma_id', session.sub)
      .single();

    if (userError || !user || !user.access_token) {
      console.error('[Analyze Comments] User not found:', userError);
      return NextResponse.json({ error: 'User not found or not connected to Figma' }, { status: 404 });
    }

    // Retrieve bot user's token for posting replies
    const botFigmaUserId = process.env.BOT_USER_ID;
    if (!botFigmaUserId) {
      console.error('[Analyze Comments] BOT_USER_ID not configured');
      return NextResponse.json({ error: 'Bot account not configured' }, { status: 500 });
    }

    const { data: botUser, error: botError } = await getFigmaUser(botFigmaUserId);

    if (botError || !botUser || !botUser.access_token) {
      console.error('[Analyze Comments] Bot user not found or not authenticated. Please log in with the bot account once.');
      return NextResponse.json({ 
        error: 'Bot account not authenticated. Please log in with the bot account through the plugin.' 
      }, { status: 500 });
    }

    console.log('[Analyze Comments] Using user token for reading, bot token for posting');

    // Fetch Comments from Figma (using current user's token) with Retry
    let commentsData;
    try {
      commentsData = await withRetry(() => getFileComments(fileKey, user.access_token), 3, 1000);
    } catch (err: any) {
       console.error('[Analyze Comments] Failed to fetch comments after retries:', err);
       return NextResponse.json({ error: 'Failed to fetch comments from Figma' }, { status: 502 });
    }

    const comments = commentsData.comments || [];
    console.log(`[Analyze Comments] Total comments received: ${comments.length}`);
    
    // Log first comment structure for debugging
    const agentMentions = comments.filter((comment: any) => {
      // Skip if comment is resolved
      if (comment.resolved_at) {
        console.log(`Skipping resolved comment ${comment.id}`);
        return false;
      }

      // Check if the comment message contains a mention of our agent
      // The message might be in different fields depending on the API response
      const messageText = (comment.message || comment.text || comment.content || '').toLowerCase();
      
      if (!messageText) {
        console.log(`Comment ${comment.id} has no message text`);
        return false;
      }
      
      const hasMention = AGENT_CONFIG.mentionPatterns.some(pattern => {
        const found = messageText.includes(pattern);
        if (found) {
          console.log(`Found mention in comment ${comment.id}: pattern "${pattern}" in "${messageText.substring(0, 100)}..."`);
        }
        return found;
      });
      
      if (!hasMention) return false;

      // Check if we've already replied to this comment
      // Look for any comment in the list that has this comment as its parent and is from our bot
      const hasReply = comments.some((c: any) => 
        c.parent_id === comment.id && c.user?.id === botFigmaUserId
      );
      
      if (hasReply) {
        console.log(`Skipping comment ${comment.id} - already has a reply from bot`);
        return false;
      }

      // Check if the comment itself is from our bot (to avoid replying to our own comments)
      if (comment.user?.id === botFigmaUserId) {
        console.log(`Skipping comment ${comment.id} - it's from our bot`);
        return false;
      }

      return true;
    });

    console.log(`Found ${agentMentions.length} comments mentioning the agent out of ${comments.length} total comments`);

    // Reply to each comment that mentions the agent (using bot's token)
    const replies = [];
    const skipped = [];
    
    for (const comment of agentMentions) {
      try {
        console.log(`[Analyze Comments] Processing comment ${comment.id}`);
        
        // Extract design context from the comment
        const designContext = await extractDesignContext(comment, fileKey, user.access_token);
        
        // Generate LLM analysis
        let replyMessage: string;
        let analysisStatus = 'success';
        let analysisError = null;

        try {
          // Retry analysis 3 times
          const analysis = await withRetry(async () => {
             return await analyzeDesign({
               ...designContext,
               commentText: comment.message,
               fileKey,
             });
          }, 3, 2000); // 2s delay between retries
          
          replyMessage = analysis;
          console.log(`[Analyze Comments] Generated LLM analysis for comment ${comment.id}`);
        } catch (llmError: any) {
          console.error(`[Analyze Comments] LLM error for comment ${comment.id}:`, llmError);
          // Fallback to a friendly error message
          replyMessage = `👋 I'm having trouble analyzing this right now (Error: ${llmError.message}). Please try again later.`;
          analysisStatus = 'error';
          analysisError = llmError.message;
        }

        // LOGGING: Store everything in Supabase
        try {
           const logData = {
              user_id: (user as any).id,      // Internal UUID
              figma_id: (user as any).figma_id, // Figma's User ID
              file_key: fileKey,
              comment_id: comment.id,
              comment_text: comment.message,
              node_id: designContext.nodeId || null,
              node_image: designContext.imageBase64 || null, // Logs the optimized image
              llm_response: replyMessage,
              status: analysisStatus,
              error_message: analysisError,
              metadata: {
                 node_name: designContext.nodeName,
                 node_type: designContext.nodeType,
                 node_properties: designContext.nodeProperties,
                 client_meta: comment.client_meta
              }
           };

           const { error: logError } = await supabase
              .from('analysis_requests')
              .insert(logData);

           if (logError) {
              console.error('[Analyze Comments] Failed to log request to Supabase:', logError);
           } else {
              console.log('[Analyze Comments] Successfully logged request to Supabase');
           }
        } catch (e) {
           console.error('[Analyze Comments] Logging exception:', e);
        }
        
        const replyResult = await postCommentReply(
          fileKey,
          comment.id,
          replyMessage,
          botUser.access_token  // Use bot's token instead of user's token
        );
        
        replies.push({
          originalCommentId: comment.id,
          reply: replyResult
        });
        
        console.log(`Replied to comment ${comment.id}`);
      } catch (replyError: any) {
        console.error(`Failed to reply to comment ${comment.id}:`, replyError.message);
        skipped.push({
          commentId: comment.id,
          error: replyError.message
        });
      }
    }

    return NextResponse.json({ 
      message: 'Comments analyzed successfully',
      totalComments: commentsData.comments.length,
      mentionsFound: agentMentions.length,
      repliesSent: replies.length,
      skipped: skipped.length,
      comments: commentsData.comments,
      replies,
      skippedDetails: skipped
    });

  } catch (err: any) {
    console.error('Analyze Comments Error:', err);
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
