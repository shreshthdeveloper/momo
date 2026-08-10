/**
 * The platform audit trail — the same screen as the organization's own.
 *
 * Mounted here it reads `GET /super/audit`, which is every action on the
 * platform including the ones taken ON a tenant; under `/admin` it reads that
 * organization's slice. See the note in the implementation.
 */
export { default } from '../admin/audit.jsx';
