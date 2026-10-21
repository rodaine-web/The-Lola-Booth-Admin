import {query} from '../db/pool.js';
import {AppError} from '../utils/errors.js';
export async function dropboxGalleryActor(id) {
 const row=(await query(`SELECT u.id FROM users u WHERE u.id=$1 AND u.active AND u.deleted_at IS NULL AND NOT EXISTS (
 SELECT need.key FROM unnest(ARRAY['write:operations','write:integrations']) need(key) WHERE NOT EXISTS (
 SELECT 1 FROM (SELECT p.key FROM user_permissions up JOIN permissions p ON p.id=up.permission_id WHERE up.user_id=u.id
 UNION SELECT p.key FROM user_roles ur JOIN role_permissions rp ON rp.role_id=ur.role_id JOIN permissions p ON p.id=rp.permission_id WHERE ur.user_id=u.id) grants WHERE grants.key IN ('*',need.key)))`,[id])).rows[0];
 if(!row)throw new AppError('Current operations and integration permissions are required.',403,'FORBIDDEN');return row;
}
