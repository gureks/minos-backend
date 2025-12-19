import { LLMProvider, DesignContext, LLM_CONFIG, validateLLMConfig } from './config';
import { GeminiProvider } from './providers/gemini';

// Factory to get the configured LLM provider
export function getLLMProvider(): LLMProvider {
  const validation = validateLLMConfig();
  if (!validation.valid) {
    throw new Error(`LLM configuration invalid: ${validation.error}`);
  }

  switch (LLM_CONFIG.provider) {
    case 'gemini':
      return new GeminiProvider();
    case 'openai':
      throw new Error('OpenAI provider not yet implemented');
    case 'claude':
      throw new Error('Claude provider not yet implemented');
    default:
      throw new Error(`Unknown LLM provider: ${LLM_CONFIG.provider}`);
  }
}

// Build UX analysis prompt
export function buildUXAnalysisPrompt(context: DesignContext): string {
  const { commentText, nodeName, nodeType, imageUrl } = context;

  if (imageUrl) {
    // Vision-based analysis
    return `You are Minos - a UX expert analyzing a Figma design. A user has requested feedback on a specific design element.

**User's Comment:**
"${commentText}"

**Design Context:**
${nodeName ? `- Element Name: ${nodeName}` : ''}
${nodeType ? `- Element Type: ${nodeType}` : ''}
- An image of the design element is provided below

**Your Task:**
Analyze the visual design in the image and provide constructive UX feedback based on established design principles (Nielsen's Heuristics, Gestalt Principles, WCAG guidelines, etc.).

**Guidelines:**
1. Analyze the visual design (layout, spacing, colors, typography, hierarchy)
2. Be specific and actionable
3. Reference relevant UX principles
4. Suggest concrete improvements
5. Keep the tone friendly and professional
6. Limit response to 2-3 lines, short, direct and concise

Provide your visual analysis:`;
  } else {
    // Text-only analysis
    return `You are a UX expert analyzing a Figma design. A user has requested feedback on a specific design element.

**User's Comment:**
"${commentText}"

**Design Context:**
${nodeName ? `- Element Name: ${nodeName}` : ''}
${nodeType ? `- Element Type: ${nodeType}` : ''}

**Your Task:**
Provide constructive UX feedback based on established design principles (Nielsen's Heuristics, Gestalt Principles, WCAG guidelines, etc.).

**Guidelines:**
1. Be specific and actionable
2. Reference relevant UX principles
3. Suggest concrete improvements
4. Keep the tone friendly and professional
5. Limit response to 2-3 lines, short, direct and concise

Provide your analysis:`;
  }
}

// Main function to analyze design and generate response
export async function analyzeDesign(context: DesignContext): Promise<string> {
  try {
    const provider = getLLMProvider();
    const prompt = buildUXAnalysisPrompt(context);
    
    console.log('[LLM] Generating analysis with provider:', provider.name);
    const response = await provider.generateResponse(prompt, context);
    
    return response;
  } catch (error: any) {
    console.error('[LLM] Analysis error:', error);
    throw error;
  }
}
