/**
 * The Central Bank's question bank, inside the platform console rather than
 * behind a jump into `/admin`.
 *
 * It used to be reached by pushing `/admin/questions?spaceId=<public>` from the
 * Central bank screen, which left the operator standing in the ORGANIZATION
 * console: the sidebar changed under them to rows about students, batches and
 * invite codes that a platform account has no space for, and every one of those
 * rows dropped the spaceId on the way. See `app/super/topics.jsx`.
 */
export { default } from '../admin/questions.jsx';
