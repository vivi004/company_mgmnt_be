-- Add area_name column to order_lines table
-- This allows grouping villages under broader area names (e.g., "KOVAI PERIVU")
-- The area_name will be displayed in bills and loading sheets instead of the village name
ALTER TABLE order_lines ADD COLUMN IF NOT EXISTS area_name VARCHAR(255) DEFAULT NULL AFTER name;

-- Backfill: Set area_name = name for all existing order lines that don't have one yet
UPDATE order_lines SET area_name = name WHERE area_name IS NULL OR area_name = '';
