/** The start-up gates a process runs before it serves: its role, its schema's tenant fence. */
export { refuseSchemaAlteringRole } from './runtime-role';
export { refuseUnisolatedTenantTables } from './tenant-isolation';
