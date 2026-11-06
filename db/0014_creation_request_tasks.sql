-- Nullable: historical snapshots may not include model request counts.
ALTER TABLE pollo_da_creation_overall_daily ADD COLUMN valid_creation_task_cnt INTEGER;
ALTER TABLE pollo_da_creation_function_daily ADD COLUMN valid_creation_task_cnt INTEGER;
ALTER TABLE pollo_da_creation_overall_stage ADD COLUMN valid_creation_task_cnt INTEGER;
ALTER TABLE pollo_da_creation_function_stage ADD COLUMN valid_creation_task_cnt INTEGER;
