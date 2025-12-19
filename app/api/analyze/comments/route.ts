import { NextRequest, NextResponse } from 'next/server';
import { verifySession } from '@/lib/jwt';
import { supabase } from '@/lib/supabaseClient';
import { getFileComments, postCommentReply, getFigmaUser } from '@/lib/figma';
import { AGENT_CONFIG } from '@/lib/config';
import { analyzeDesign } from '@/lib/llm';
import { extractDesignContext } from '@/lib/designParser';

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('Authorization');
    console.log('[Analyze Comments] Auth header:', authHeader ? 'present' : 'missing');
    
    if (!authHeader) {
      return NextResponse.json({ error: 'Missing Authorization header' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    console.log('[Analyze Comments] Token length:', token.length);
    
    const session = await verifySession(token);
    console.log('[Analyze Comments] Session:', session ? 'valid' : 'invalid');
    
    if (!session || !session.sub) {
      console.error('[Analyze Comments] Invalid session - session:', session);
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }

    const { fileKey } = await request.json();

    if (!fileKey) {
      return NextResponse.json({ error: 'Missing fileKey' }, { status: 400 });
    }

    // Retrieve current user's Figma Access Token from Supabase (for reading comments)
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('access_token, figma_id')
      .eq('id', session.sub)
      .single();

    if (userError || !user || !user.access_token) {
      return NextResponse.json({ error: 'User not found or not connected to Figma' }, { status: 404 });
    }

    // Retrieve bot user's token for posting replies
    const botUserId = process.env.BOT_USER_ID;
    if (!botUserId) {
      console.error('[Analyze Comments] BOT_USER_ID not configured');
      return NextResponse.json({ error: 'Bot account not configured' }, { status: 500 });
    }

    const { data: botUser, error: botError } = await supabase
      .from('users')
      .select('access_token')
      .eq('figma_id', botUserId)
      .single();

    if (botError || !botUser || !botUser.access_token) {
      console.error('[Analyze Comments] Bot user not found or not authenticated. Please log in with the bot account once.');
      return NextResponse.json({ 
        error: 'Bot account not authenticated. Please log in with the bot account through the plugin.' 
      }, { status: 500 });
    }

    console.log('[Analyze Comments] Using user token for reading, bot token for posting');

    // Fetch Comments from Figma (using current user's token)
    const commentsData = await getFileComments(fileKey, user.access_token);

    // Get the bot user's info to identify bot's replies
    const figmaUser = await getFigmaUser(botUser.access_token);
    const botFigmaUserId = figmaUser.id;

    // Filter comments that mention our agent
    console.log('[Analyze Comments] Total comments received:', commentsData.comments?.length || 0);
    
    // Log first comment structure for debugging
    if (commentsData.comments && commentsData.comments.length > 0) {
      console.log('[Analyze Comments] Sample comment structure:', JSON.stringify(commentsData.comments[0], null, 2));
    }
    
    const agentMentions = commentsData.comments.filter((comment: any) => {
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
      const hasReply = commentsData.comments.some((c: any) => 
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

    console.log(`Found ${agentMentions.length} comments mentioning the agent out of ${commentsData.comments.length} total comments`);

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
        try {
          const analysis = await analyzeDesign({
            ...designContext,
            commentText: comment.message,
            fileKey,
          });
          
          replyMessage = analysis;
          console.log(`[Analyze Comments] Generated LLM analysis for comment ${comment.id}`);
        } catch (llmError: any) {
          console.error(`[Analyze Comments] LLM error for comment ${comment.id}:`, llmError);
          // Fallback to a friendly error message
          replyMessage = `👋 Thanks for tagging me! I encountered an issue generating analysis: ${llmError.message}. Please try again or contact support.`;
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
