/**
 * course: the course shell of Stoipath Learn L1 (LEARN.md §4 "course", §5.1, §5.2 "Open step", D6, D23; contracts §10
 * CourseService). A feature module for the learner and preview modes: install() provides `course` and exposes
 * `window.__learn.tools.course()` (a read-only snapshot for the checks). The integrator then calls `course.load()`,
 * `course.initialModule()` and `course.openModule(id, reason)` (LEARN-QUESTIONS host conventions 1).
 *
 *   course.ts    the CourseService: load (course, `?module=`, draft preview), status, the initial and next module,
 *                openModule (fetch once, the entry's id, the catalogue build of every slide, then player.open)
 *   outline.ts   the course outline the player mounts on the Open card (`Modules · {done} of {total} done`)
 *   routing.ts   pure: the default course URL, entries, status and lock rules, initial / next module, plate reasons
 *   text.ts      strings                         course.css   design final 239–244 and 267–268, scoped
 *
 * The course never imports another Learn module (LEARN.md §4.4): it uses `format` (load, parse, hashes), `progress`
 * (`course()`), `player` (`open`, its live record) and, in a preview, `drafts`, all through `learn.service()`.
 */
import './course.css';
import type { LearnApi } from '../contracts';
import { LearnCourse } from './course';

export { LearnCourse, type CourseKind } from './course';
export { Outline, outlineModel, statusLine, type OutlineModel, type OutlineRow } from './outline';
export { courseStatuses, DEFAULT_COURSE_PATH, defaultCourseUrl, fileNameOf, firstOpen, liveProgress, moduleStarted, pickInitial, pickNext, reasonOf, resolveEntries, storedProgress, type LockReason, type ProgressStatus, type ProgressView, type ResolvedEntry } from './routing';
export { TEXT } from './text';

export const name = 'course';

export function install(learn: LearnApi): void {
  // The studio drives its own task card and has no course (LEARN.md §3: not in the studio's install order).
  if (learn.mode === 'studio') return;
  const course = new LearnCourse(learn);
  learn.provide('course', course);
  learn.debug.expose('course', () => course.view());
  course.attach();
}
