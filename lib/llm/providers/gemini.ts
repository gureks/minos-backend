import { LLMProvider, DesignContext, LLM_CONFIG } from '../config';
import { GoogleGenerativeAI } from '@google/generative-ai';

export class GeminiProvider implements LLMProvider {
  name = 'gemini';
  private client: GoogleGenerativeAI;

  constructor() {
    this.client = new GoogleGenerativeAI(LLM_CONFIG.apiKey);
  }

  async generateResponse(prompt: string, context?: DesignContext): Promise<string> {
    try {
      const model = this.client.getGenerativeModel({ 
        model: LLM_CONFIG.model,
      });

      // If we have an image (either pre-processed base64 or URL)
      if (context?.imageBase64 || context?.imageUrl) {
        console.log('[Gemini] Using vision analysis');
        
        let base64Image = context.imageBase64;

        // Fallback: If no base64 but URL exists (legacy path), fetch it
        if (!base64Image && context.imageUrl) {
           console.log('[Gemini] Fetching image from URL (fallback)...');
           const imageResponse = await fetch(context.imageUrl);
           const imageBuffer = await imageResponse.arrayBuffer();
           base64Image = Buffer.from(imageBuffer).toString('base64');
        }

        if (base64Image) {
          const result = await model.generateContent({
            contents: [{
              role: 'user',
              parts: [
                { text: prompt },
                {
                  inlineData: {
                    mimeType: 'image/jpeg',
                    data: base64Image,
                  },
                },
              ],
            }],
            generationConfig: {
              temperature: LLM_CONFIG.temperature,
              maxOutputTokens: LLM_CONFIG.maxTokens,
            },
          });
  
          const response = result.response;
          console.log('[Gemini] base64Image Response', response.text());
          // console.log('[Gemini] Image', base64Image);
          return response.text();
        }
      } 
      
      // Text-only analysis (else case or if image fetching failed)
      console.log('[Gemini] Using text-only analysis');
      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: LLM_CONFIG.temperature,
          maxOutputTokens: LLM_CONFIG.maxTokens,
        },
      });

      const response = result.response;
      return response.text();
      
    } catch (error: any) {
      console.error('[Gemini] Generation error:', error);
      throw new Error(`Gemini API error: ${error.message}`);
    }
  }
}
