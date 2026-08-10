/**
 * Bulk CSV import into the Central Bank. See `app/super/topics.jsx`.
 *
 * Rows land in review unless the operator publishes them on the way in, which
 * is why `/super/review` exists beside this route: an import with no queue
 * behind it writes questions nobody can reach.
 */
export { default } from '../admin/import.jsx';
