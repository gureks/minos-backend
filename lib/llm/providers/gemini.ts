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

      // If we have an image URL, fetch it and include in the request
      if (context?.imageUrl) {
        console.log('[Gemini] Using vision analysis with image');
        
        // Fetch the image
        const imageResponse = await fetch(context.imageUrl);
        const imageBuffer = await imageResponse.arrayBuffer();
        const base64Image = Buffer.from(imageBuffer).toString('base64');

        const result = await model.generateContent({
          contents: [{
            role: 'user',
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: 'image/png',
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
        return response.text();
      } else {
        // Text-only analysis
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
      }
    } catch (error: any) {
      console.error('[Gemini] Generation error:', error);
      throw new Error(`Gemini API error: ${error.message}`);
    }
  }
}
