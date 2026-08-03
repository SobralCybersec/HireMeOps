-- Store hiring-manager name and LinkedIn URL on the task row so the cockpit
-- can surface them in the review panel without re-parsing payload_json.
ALTER TABLE automation_tasks ADD COLUMN hr_name TEXT;
ALTER TABLE automation_tasks ADD COLUMN hr_link TEXT;
