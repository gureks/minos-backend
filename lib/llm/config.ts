// LLM Service - Swappable provider architecture

export interface LLMProvider {
  name: string;
  generateResponse(prompt: string, context?: any): Promise<string>;
}

export interface DesignContext {
  nodeId?: string;
  nodeName?: string;
  nodeType?: string;
  nodeProperties?: any;
  imageUrl?: string;
  imageBase64?: string; // Optimized cropped image
  commentText: string;
  fileKey: string;
}

export const LLM_CONFIG = {
  provider: (process.env.LLM_PROVIDER || 'gemini') as 'gemini' | 'openai' | 'claude',
  apiKey: process.env.LLM_API_KEY || '',
  model: process.env.LLM_MODEL || 'gemini-2.0-flash-exp',
  temperature: parseFloat(process.env.LLM_TEMPERATURE || '0.7'),
  maxTokens: parseInt(process.env.LLM_MAX_TOKENS || '2048'),
};

// Validate LLM configuration
export function validateLLMConfig(): { valid: boolean; error?: string } {
  if (!LLM_CONFIG.apiKey) {
    return { valid: false, error: 'LLM_API_KEY not configured' };
  }
  return { valid: true };
}
