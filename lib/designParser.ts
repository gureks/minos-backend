import { FIGMA_API_URL } from './figma';

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
    `${FIGMA_API_URL}/images/${fileKey}?ids=${nodeId}&format=png&scale=2`,
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

    // Extract relevant properties (keeping for reference, but image is primary)
    const nodeProperties = {
      width: node.absoluteBoundingBox?.width,
      height: node.absoluteBoundingBox?.height,
      x: node.absoluteBoundingBox?.x,
      y: node.absoluteBoundingBox?.y,
    };

    // Always fetch image for visual analysis
    let imageUrl;
    try {
      console.log('[Design Parser] Fetching node image...');
      imageUrl = await getNodeImage(fileKey, nodeId, accessToken);
      console.log('[Design Parser] Image URL obtained:', imageUrl ? 'success' : 'failed', imageUrl);
    } catch (imgError) {
      console.error('[Design Parser] Failed to fetch image:', imgError);
    }

    return {
      nodeId,
      nodeName: node.name,
      nodeType: node.type,
      nodeProperties,
      imageUrl,
    };
  } catch (error: any) {
    console.error('[Design Parser] Error extracting context:', error);
    return {};
  }
}
