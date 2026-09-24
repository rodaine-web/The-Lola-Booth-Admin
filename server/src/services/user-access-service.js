import { AppError } from '../utils/errors.js';
import { query } from '../db/pool.js';

export function assertUserManagement(actor, targetRoles = [], targetId) {
  const roles = actor?.roles || [];
  if (targetRoles.includes('ROOT')) throw new AppError('Root accounts cannot be managed here.', 403, 'ROOT_ACCOUNT_PROTECTED');
  if (targetRoles.includes('OWNER') && !roles.includes('OWNER')) throw new AppError('Only the owner can manage owner accounts.', 403, 'OWNER_ACCOUNT_PROTECTED');
  if (targetRoles.some(r => ['ADMIN', 'SUPER_ADMIN'].includes(r)) && !roles.some(r => ['OWNER', 'SUPER_ADMIN'].includes(r))) throw new AppError('Administrative accounts require owner or super admin access.', 403, 'ADMIN_ACCOUNT_PROTECTED');
  if (targetId === actor?.id) throw new AppError('Use another authorized administrator to change your own access.', 409, 'SELF_ACCESS_CHANGE_BLOCKED');
}

export async function assertManagedUser(req, id) {
  const result = await query('SELECT r.name FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=$1', [id]);
  assertUserManagement(req.user, result.rows.map(r => r.name), id);
}

export function assertGrantablePermissions(actor, keys) {
  if (keys.includes('*') || keys.some(k => /root/i.test(k))) throw new AppError('Root privileges cannot be assigned here.', 403, 'ROOT_PRIVILEGE_BLOCKED');
  if (!actor.permissions?.includes('*') && keys.some(k => !actor.permissions?.includes(k))) throw new AppError('You may only grant privileges you hold.', 403, 'PRIVILEGE_ESCALATION_BLOCKED');
}

export async function assignUserPermissions(client, id, keys) {
  const unique = [...new Set(keys)];
  const rows = await client.query('SELECT id FROM permissions WHERE key=ANY($1::text[])', [unique]);
  if (rows.rowCount !== unique.length) throw new AppError('One or more privileges are not configured.', 422, 'PERMISSION_NOT_FOUND');
  await client.query('DELETE FROM user_permissions WHERE user_id=$1', [id]);
  for (const row of rows.rows) await client.query('INSERT INTO user_permissions(user_id,permission_id) VALUES($1,$2)', [id,row.id]);
}
