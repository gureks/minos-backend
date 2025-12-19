-- Add figma_user_id column to analysis_requests
ALTER TABLE public.analysis_requests 
ADD COLUMN figma_id text;
