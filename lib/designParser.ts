import { FIGMA_API_URL } from './figma';
import sharp from 'sharp';

// Constants for image processing
const IMAGE_SCALE = 2; // High res for analysis
const CONTEXT_MARGIN = 400; // px around the pin/region (in scaled pixels)
const MIN_VIEWPORT_SIZE = 800; // Minimum size of the analyzing window

// Get node information from Figma
export async function getNodeInfo(fileKey: string, nodeId: string, accessToken: string) {
  const res = await fetch(`${FIGMA_API_URL}/files/${fileKey}/nodes?ids=${nodeId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const txt = await res.text();
    console.error('Figma Node Error:', res.status, txt);
    throw new Error(`Failed to fetch node: ${txt}`);
  }

  return res.json();
}

// Get image render of a node
// Get image render of a node
export async function getNodeImage(fileKey: string, nodeId: string, accessToken: string, scale: number = IMAGE_SCALE) {
  const res = await fetch(
    `${FIGMA_API_URL}/images/${fileKey}?ids=${nodeId}&format=png&scale=${scale}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (!res.ok) {
    const txt = await res.text();
    console.error(`Figma Image Error (Scale ${scale}):`, res.status, txt);
    throw new Error(`Failed to fetch image: ${txt}`);
  }

  const data = await res.json();
  return data.images?.[nodeId] || null;
}

// Helper to determine safe scale based on dimensions
function getSafeScale(width: number, height: number): number {
  const maxDim = Math.max(width, height);
  if (maxDim > 4000) return 0.5; // Very large node -> 0.5x
  if (maxDim > 2000) return 1;   // Large node -> 1x
  return 2;                      // Normal node -> 2x
}

// Extract design context from comment
export async function extractDesignContext(
  comment: any,
  fileKey: string,
  accessToken: string
): Promise<{
  nodeId?: string;
  nodeName?: string;
  nodeType?: string;
  nodeProperties?: any;
  imageUrl?: string;
  imageBase64?: string;
}> {
  try {
    // Check if comment has client_meta with node information
    const nodeId = comment.client_meta?.node_id;
    
    if (!nodeId) {
      console.log('[Design Parser] No node ID found in comment');
      return {};
    }

    console.log('[Design Parser] Fetching node info for:', nodeId);
    const nodeData = await getNodeInfo(fileKey, nodeId, accessToken);
    
    const node = nodeData.nodes?.[nodeId]?.document;
    if (!node) {
      console.log('[Design Parser] Node not found');
      return { nodeId };
    }

    // Extract relevant properties
    const width = node.absoluteBoundingBox?.width || 0;
    const height = node.absoluteBoundingBox?.height || 0;

    const nodeProperties = {
      width,
      height,
      x: node.absoluteBoundingBox?.x,
      y: node.absoluteBoundingBox?.y,
    };

    // Smart Image Processing
    let imageBase64;
    let imageUrl;
    
    try {
      // Determine initial safe scale
      let currentScale = getSafeScale(width, height);
      console.log(`[Design Parser] Suggesting scale ${currentScale} for node ${width}x${height}`);

      // Attempt verification - usually Scale 2 is fine unless huge
      // But if it's the Page node (0:1) or HUGE, be conservative
      if (node.type === 'CANVAS' || node.type === 'DOCUMENT') {
         currentScale = Math.min(currentScale, 0.5); // Always use low res for full canvas
      }

      console.log(`[Design Parser] Fetching node image at scale ${currentScale}...`);
      
      try {
        imageUrl = await getNodeImage(fileKey, nodeId, accessToken, currentScale);
      } catch (e) {
        console.warn('[Design Parser] Initial fetch failed, retrying with lower scale 0.5...');
        // Retry logic: If failed (timeout), try lowest scale
        imageUrl = await getNodeImage(fileKey, nodeId, accessToken, 0.5);
        currentScale = 0.5;
      }
      
      if (imageUrl) {
        // Download image to buffer
        const imgRes = await fetch(imageUrl);
        const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
        
        // Process and Crop Image
        const meta = comment.client_meta;
        const originalImage = sharp(imgBuffer);
        const metadata = await originalImage.metadata();
        
        if (metadata.width && metadata.height && meta.node_offset) {
          // Calculate coordinates in SCALED image space
          // IMPORTANT: Use the actual scale we fetched at!
          const scale = currentScale; 
          const pinX = meta.node_offset.x * scale;
          const pinY = meta.node_offset.y * scale;
          
          let cropX, cropY, cropWidth, cropHeight;

          // Determine the region of interest
          if (meta.region_width && meta.region_height) {
            // It's a Region comment
            const rWidth = meta.region_width * scale;
            const rHeight = meta.region_height * scale;
            
            // Handle pin corner (defaults to bottom-right according to docs)
            // If bottom-right, the pin (node_offset) is at (right, bottom) of the rect
            const pinCorner = meta.comment_pin_corner || 'bottom-right';
            
            let regionLeft = pinX;
            let regionTop = pinY;
            
            // Adjust based on pin corner to find top-left of region
            // Adjust based on pin corner to find top-left of region
            if (pinCorner === 'bottom-right') {
              regionLeft = pinX - rWidth;
              regionTop = pinY - rHeight;
            } else if (pinCorner === 'bottom-left') {
              regionLeft = pinX;
              regionTop = pinY - rHeight;
            } else if (pinCorner === 'top-right') {
              regionLeft = pinX - rWidth;
              regionTop = pinY;
            } else { // top-left
              regionLeft = pinX;
              regionTop = pinY;
            }

            // Optimize Margin Logic
            // If region is large enough, just use it. If small, expand to MIN_VIEWPORT_SIZE
            if (rWidth >= MIN_VIEWPORT_SIZE || rHeight >= MIN_VIEWPORT_SIZE) {
               // Use Exact Region (rounded to int)
               cropX = Math.round(regionLeft);
               cropY = Math.round(regionTop);
               cropWidth = Math.round(rWidth);
               cropHeight = Math.round(rHeight);
            } else {
               // Too small? Add padding to reach MIN_VIEWPORT_SIZE (centered)
               const centerX = regionLeft + (rWidth / 2);
               const centerY = regionTop + (rHeight / 2);
               
               const viewSize = MIN_VIEWPORT_SIZE;
               cropX = Math.round(centerX - (viewSize / 2));
               cropY = Math.round(centerY - (viewSize / 2));
               cropWidth = viewSize;
               cropHeight = viewSize;
            }
            
          } else {
            // It's a Pin comment (point of interest)
            // Center a view window around the pin
            const viewSize = MIN_VIEWPORT_SIZE;
            cropX = Math.round(pinX - (viewSize / 2));
            cropY = Math.round(pinY - (viewSize / 2));
            cropWidth = viewSize;
            cropHeight = viewSize;
          }

          // Ensure bounds are strictly integers
          cropX = Math.round(Math.max(0, cropX));
          cropY = Math.round(Math.max(0, cropY));
          
          // Clamp width/height so we don't go outside image
          cropWidth = Math.round(Math.min(cropWidth, metadata.width - cropX));
          cropHeight = Math.round(Math.min(cropHeight, metadata.height - cropY));

          // Perform Crop if valid dimensions
          if (cropWidth > 0 && cropHeight > 0) {
            console.log(`[Design Parser] Cropping image to: x=${cropX}, y=${cropY}, w=${cropWidth}, h=${cropHeight}`);
            
            try {
              const croppedBuffer = await originalImage
                .extract({ left: cropX, top: cropY, width: cropWidth, height: cropHeight })
                .resize({ 
                  width: 1024, 
                  height: 1024, 
                  fit: 'inside', // Keep aspect ratio
                  withoutEnlargement: true 
                })
                .toFormat('jpeg', { quality: 80 })
                .toBuffer();
                
              imageBase64 = croppedBuffer.toString('base64');
            } catch (cropError) {
              console.error('[Design Parser] Crop failed, falling back to full image:', cropError);
              throw cropError; // Re-throw to trigger fallback below
            }
          } else {
             throw new Error('Invalid crop dimensions');
          }
        } else {
            throw new Error('Missing metadata or offset');
        }
      }
    } catch (imgError) {
      console.error('[Design Parser] Smart processing failed, falling back to full image optimization:', imgError);
      
      // Fallback: Resize and optimize the original full buffer if possible
      if (imageUrl) {
         try {
           const imgRes = await fetch(imageUrl);
           const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
           const fallbackImage = sharp(imgBuffer);
           
           const optimizedBuffer = await fallbackImage
              .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
              .toFormat('jpeg', { quality: 80 })
              .toBuffer();
              
           imageBase64 = optimizedBuffer.toString('base64');
           console.log('[Design Parser] Fallback optimization successful');
         } catch (fallbackError) {
            console.error('[Design Parser] Fallback failed, using raw URL:', fallbackError);
            // imageBase64 remains undefined, LLM will use imageUrl as last resort
         }
      }
    }

    return {
      nodeId,
      nodeName: node.name,
      nodeType: node.type,
      nodeProperties,
      imageUrl, // Keep URL just in case
      imageBase64, // Preferred optimized image
    };
  } catch (error: any) {
    console.error('[Design Parser] Error extracting context:', error);
    return {};
  }
}
