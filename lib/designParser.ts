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
export async function getNodeImage(fileKey: string, nodeId: string, accessToken: string) {
  const res = await fetch(
    `${FIGMA_API_URL}/images/${fileKey}?ids=${nodeId}&format=png&scale=${IMAGE_SCALE}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (!res.ok) {
    const txt = await res.text();
    console.error('Figma Image Error:', res.status, txt);
    throw new Error(`Failed to fetch image: ${txt}`);
  }

  const data = await res.json();
  return data.images?.[nodeId] || null;
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

    // Extract relevant properties (keeping for reference)
    const nodeProperties = {
      width: node.absoluteBoundingBox?.width,
      height: node.absoluteBoundingBox?.height,
      x: node.absoluteBoundingBox?.x,
      y: node.absoluteBoundingBox?.y,
    };

    // Smart Image Processing
    let imageBase64;
    let imageUrl;
    
    try {
      console.log('[Design Parser] Fetching node image...');
      imageUrl = await getNodeImage(fileKey, nodeId, accessToken);
      
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
          const scale = IMAGE_SCALE;
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

            // Add Context Margin
            cropX = regionLeft - CONTEXT_MARGIN;
            cropY = regionTop - CONTEXT_MARGIN;
            cropWidth = rWidth + (CONTEXT_MARGIN * 2);
            cropHeight = rHeight + (CONTEXT_MARGIN * 2);
            
          } else {
            // It's a Pin comment (point of interest)
            // Center a view window around the pin
            const viewSize = MIN_VIEWPORT_SIZE;
            cropX = pinX - (viewSize / 2);
            cropY = pinY - (viewSize / 2);
            cropWidth = viewSize;
            cropHeight = viewSize;
          }

          // Ensure bounds are valid (clamp to image size)
          cropX = Math.max(0, Math.floor(cropX));
          cropY = Math.max(0, Math.floor(cropY));
          
          // Clamp width/height so we don't go outside image
          cropWidth = Math.min(cropWidth, metadata.width - cropX);
          cropHeight = Math.min(cropHeight, metadata.height - cropY);

          // Perform Crop if valid dimensions
          if (cropWidth > 0 && cropHeight > 0) {
            console.log(`[Design Parser] Cropping image to: x=${cropX}, y=${cropY}, w=${cropWidth}, h=${cropHeight}`);
            
            const croppedBuffer = await originalImage
              .extract({ left: cropX, top: cropY, width: cropWidth, height: cropHeight })
              .toBuffer();
              
            imageBase64 = croppedBuffer.toString('base64');
          } else {
            // Fallback to full image if calculations fail
            console.log('[Design Parser] Crop calculation invalid, using full image');
            imageBase64 = imgBuffer.toString('base64');
          }
        } else {
            // Fallback: No metadata or offset, use full image
            console.log('[Design Parser] Missing metadata/offset, using full image');
            imageBase64 = imgBuffer.toString('base64');
        }
      }
    } catch (imgError) {
      console.error('[Design Parser] Failed to process image:', imgError);
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
