/**
 * course · strings (LEARN.md §5.2 "Open step", §8.1 plates, §8.2 "course outline status words"; ux-copy §13.1, §13.2).
 * ux-copy strings are verbatim where one exists; every other string is new and marked N (LEARN.md §8).
 */
export const TEXT = {
  // ---------------------------------------------------------------- the outline (ux-copy §13.2 `Modules` + `{done} of {total} done`)
  modules: 'Modules',
  /** The count after `Modules · ` (LEARN.md §5.2 `Modules · {done} of {total} done`). */
  doneOf: (done: number, total: number): string => `${done} of ${total} done`,
  /** N: the list's name. */
  listAria: 'Modules in this course',
  /** LEARN.md §8.2 status words. */
  status: {
    done: 'done',
    inProgress: (n: number, m: number): string => `in progress · step ${n} of ${m}`,
    notStarted: 'not started',
    locked: 'locked',
  },
  /** ux-copy §13.2 row meta (`12 min`). */
  minutes: (n: number): string => `${Number.isInteger(n) ? n : Math.round(n * 10) / 10} min`,
  /** N: the glyph column of a done row (the status word says `done`, so the glyph is hidden from AT). */
  doneGlyph: '✓',

  // ---------------------------------------------------------------- refusals (ux-copy §13.1 toast title `Not yet`)
  notYet: 'Not yet',
  /** N: a module locked by `unlock: after-previous`. */
  completeFirst: (previous: string): string => `Complete ${previous} first.`,
  /** N: the row's reason after `locked · ` for a module locked by `unlock: after-previous`. */
  lockedAfter: (previous: string): string => `opens after ${previous}`,
  /** N: the separators an outline row speaks between its title, status and minutes (visually hidden). */
  sep: ', ',

  // ---------------------------------------------------------------- arrival (LEARN.md §5.1 step 3; CRS-4)
  /** N (CRS-4 verbatim): `#m=` names a module the course does not list. */
  unknownModule: (title: string): string => `This link names a module that is not in this course; opened ${title} instead`,
  /** N: `#m=` names a module of the course that is still locked. */
  lockedModule: (title: string): string => `This link names a module that is still locked; opened ${title} instead`,

  // ---------------------------------------------------------------- failures (LEARN.md §8.1 plates)
  /** LEARN.md §8.1 `{title} could not be opened ({reason}).` (as a notice while another module stays open). */
  couldNotOpen: (title: string, reason: string): string => `${title} could not be opened (${reason}).`,
  /** LEARN.md §8.1 `{title} was written for a different build of {slide}; it was not opened.` */
  differentBuild: (title: string, slide: string): string => `${title} was written for a different build of ${slide}; it was not opened.`,
  /** N: the outline's short form of the sentence above. */
  differentBuildShort: (slide: string): string => `written for a different build of ${slide}`,
  /** The lint rule `slide-catalogue`'s words (LEARN.md §7.1). */
  notInCatalogue: (catalogueId: string): string => `${catalogueId} is not in the slide catalogue`,
  /** N: the course entry names one module id and the file another (contracts CourseEntry.id). */
  idMismatch: (got: string, want: string): string => `the file is module ${got}, not ${want}`,
  /** N: plate reasons. */
  noFormat: 'this build has no module reader',
  noPlayer: 'this build has no player',
  /** N: the plate title of a draft preview whose draft cannot be read. */
  draftTitle: (draftId: string): string => `Draft ${draftId}`,
  /** N. */
  draftMissing: 'it is not among the drafts saved in this browser',
  /** N. */
  noDrafts: 'the author drafts of this browser cannot be read here',
  /** The format module's load warning for a draft (contracts LoadedModule.warnings "review draft"). */
  draftWarning: 'Draft: learners will see "Draft — pending pathologist review"',
} as const;
