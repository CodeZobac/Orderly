CREATE TABLE project_rates (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), project_id TEXT NOT NULL REFERENCES projects(id), rate INTEGER NOT NULL CHECK(rate>=0), at INTEGER NOT NULL);
INSERT INTO project_rates SELECT id,user_id,id,rate,0 FROM projects;
CREATE INDEX project_rate_owner ON project_rates(user_id,project_id,at);
