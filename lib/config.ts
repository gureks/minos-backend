// Agent configuration
export const AGENT_CONFIG = {
  name: process.env.AGENT_NAME || 'HeuristicsAgent',
  mentionPatterns: (process.env.AGENT_MENTION_PATTERNS || '@heuristicsagent,@heuristics agent,heuristics agent')
    .split(',')
    .map(p => p.trim().toLowerCase()),
};

// API URLs
export const API_CONFIG = {
  backendUrl: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
};
