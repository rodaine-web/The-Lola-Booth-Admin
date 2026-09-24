-- Explicit additional privileges use the same canonical keys as role permissions.
CREATE TABLE IF NOT EXISTS user_permissions (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, permission_id)
);
-- Super Admin has the existing Admin operational privileges, without root wildcard.
INSERT INTO role_permissions(role_id, permission_id)
SELECT target.id, rp.permission_id
FROM roles target JOIN roles source ON source.name='ADMIN'
JOIN role_permissions rp ON rp.role_id=source.id
JOIN permissions p ON p.id=rp.permission_id
WHERE target.name='SUPER_ADMIN' AND p.key <> '*'
ON CONFLICT DO NOTHING;
