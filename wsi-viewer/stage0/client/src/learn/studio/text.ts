/**
 * studio · strings (LEARN.md §7, §8.3; ux-copy §13.7 author strings verbatim where one exists: `Author · {n} {stage}`,
 * `Record a tour on {slide} N`, `Stop and edit steps N`, `Add items N`, `Check and publish N`, `Publish checks`; the last
 * CTA is `Export module file` (D26), not `Publish to collection`). The stage strings are LEARN.md §7's; every other string
 * is new (N). Keycaps are never typed into these sentences: the card renders them from the command registry (ux-copy
 * tone rule 7). No DOM.
 */
import type { AuthorStage, Audience, ItemKind, Phase, StepKind } from '../contracts';
import type { ToolId } from '../../shell/contracts';

/** The studio's rail (design PHASE_LABELS.author). */
export const STAGES: readonly { id: AuthorStage; label: string }[] = [
  { id: 'collect', label: 'Collect' },
  { id: 'record', label: 'Record' },
  { id: 'edit', label: 'Edit' },
  { id: 'items', label: 'Items' },
  { id: 'publish', label: 'Publish' },
];

export function stageLabel(s: AuthorStage): string {
  return STAGES.find((x) => x.id === s)?.label ?? s;
}
export function stageNumber(s: AuthorStage): number {
  return STAGES.findIndex((x) => x.id === s) + 1;
}

export const AUDIENCES: readonly { id: Audience; label: string }[] = [
  { id: 'undergraduate', label: 'Undergraduates' },
  { id: 'medical-student', label: 'Medical students' },
  { id: 'resident', label: 'Residents' },
  { id: 'cme', label: 'Faculty and CME' },
];

export const PHASE_NAMES: Record<Phase, string> = { open: 'Open', screen: 'Screen', examine: 'Examine', decide: 'Decide', complete: 'Complete' };

export const STEP_KIND_NAMES: Record<StepKind, string> = { tour: 'Tour step', item: 'Item step', reveal: 'Reveal step' };

/** ux-copy §13.7 item kinds (LEARN.md §7 step 4). */
export const ITEM_KIND_NAMES: Record<ItemKind, string> = { mcq: 'Multiple choice', multi: 'Select all', region: 'Region marking' };

export const TOOL_NAMES: Record<ToolId, string> = {
  select: 'Select / pan',
  point: 'Point',
  polygon: 'Polygon',
  brush: 'Brush',
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  measure: 'Measure',
};
export const TOOL_ORDER: readonly ToolId[] = ['select', 'point', 'polygon', 'brush', 'rect', 'ellipse', 'measure'];

/** `{cmd:<id>}` helper chips of the step text (LEARN.md D21): the commands a tour usually names. */
export const CMD_CHIPS: readonly string[] = ['step:next', 'zoomin', 'zoomout', 'fit', 'pan.viewport', 'nav', 'mag:20'];

export const TEXT = {
  // ---------------------------------------------------------------- head and rail (ux-copy §13.7)
  studioTitle: 'Author studio',
  /** ux-copy §13.7 `Author · {n} {stage}`. */
  stageMeta: (s: AuthorStage): string => `Author · ${stageNumber(s)} ${stageLabel(s)}`,
  /** N: the draft list's meta. */
  draftsMeta: 'Author · Drafts',
  untitled: 'Untitled module',
  railNoDraft: 'Open a draft or start a new module first.',
  notYet: 'Not yet',

  // ---------------------------------------------------------------- stems (context bar, peek bar)
  stem: {
    drafts: 'Drafts are kept in this browser. Start a new module, open a draft or import a module file.',
    collect: 'Name the module, choose its audience and add its slides.',
    record: 'Move to a view you want to teach from, then add it as a tour step.',
    edit: "Write each step's text, phase and tools; add item and reveal steps.",
    items: 'Write the questions: multiple choice, select all, or region marking.',
    publish: 'Fix every error, preview the module as a learner, then export the module file.',
  } as Record<AuthorStage | 'drafts', string>,

  // ---------------------------------------------------------------- CTAs (ux-copy §13.7; D26)
  ctaNew: 'New module',
  ctaRecordOn: (label: string): string => `Record a tour on ${label}`,
  ctaRecord: 'Record a tour',
  ctaEditSteps: 'Stop and edit steps',
  ctaAddItems: 'Add items',
  ctaCheck: 'Check and publish',
  ctaExport: 'Export module file',
  allDrafts: 'All drafts',
  noteAddSlide: 'Add a slide first: a tour is recorded on one of the module’s slides.',
  noteExportBlocked: 'Export is blocked until every error below is fixed.',
  noteExportChecking: 'Checking the module…',
  noteAutosave: 'Your draft is saved in this browser as you work.',
  lastStage: 'This is the last stage. Export the module file to publish it.',
  openDraftFirst: 'Open a draft or start a new module first.',

  // ---------------------------------------------------------------- status line
  saving: 'Saving the draft in this browser…',
  saved: (time: string): string => `Draft saved in this browser · ${time}`,
  unsaved: 'Not saved yet',
  memoryOnly: 'Not saved: this browser blocks storage here. Export the module file to keep it.',
  saveError: 'Not saved (the browser refused the write). Export the module file to keep it.',
  checking: 'Checking…',
  lintCounts: (e: number, w: number): string => `${e === 0 ? 'No errors' : `${e} ${e === 1 ? 'error' : 'errors'}`} · ${w} ${w === 1 ? 'warning' : 'warnings'}`,

  // ---------------------------------------------------------------- draft list (LEARN.md §7)
  draftsTitle: 'Drafts',
  draftsList: 'Drafts in this browser',
  draftsEmpty: 'No drafts yet. Start a new module or import a module file.',
  draftUpdated: (t: string): string => `updated ${t}`,
  draftErrors: (n: number | null): string => (n === null ? 'not checked' : n === 0 ? 'no errors' : `${n} lint ${n === 1 ? 'error' : 'errors'}`),
  open: 'Open',
  openDraft: (title: string): string => `Open ${title}`,
  deleteDraft: (title: string): string => `Delete ${title}`,
  delete: 'Delete',
  pressAgainDelete: 'Press again to delete',
  draftDeleted: (title: string): string => `${title} deleted from this browser.`,
  draftOpened: (title: string): string => `${title} opened in the author studio.`,
  draftCreated: 'New module started. Give it a title.',
  draftMissing: 'That draft is no longer in this browser.',

  // ---------------------------------------------------------------- Collect (LEARN.md §7 step 1)
  metadata: 'Module details',
  title: 'Title',
  moduleId: 'Module id',
  moduleIdHint: 'Suggested from the title. Lowercase letters, digits and hyphens; it names the module file.',
  moduleIdError: 'Use 3 to 64 lowercase letters, digits or hyphens, starting with a letter or a digit.',
  summary: 'Summary',
  audience: 'Audience',
  objectives: 'Objectives',
  objective: (n: number): string => `Objective ${n}`,
  addObjective: 'Add objective',
  removeObjective: (n: number): string => `Remove objective ${n}`,
  organ: 'Organ tags',
  stain: 'Stain tags',
  topics: 'Topic tags',
  tagsHint: 'Separate tags with commas.',
  difficulty: 'Difficulty',
  difficultyItem: (n: number): string => `Difficulty ${n} of 5`,
  authors: 'Authors',
  authorName: (n: number): string => `Author ${n} name`,
  authorRole: (n: number): string => `Author ${n} role`,
  addAuthor: 'Add author',
  removeAuthor: (n: number): string => `Remove author ${n}`,
  roles: { author: 'Author', editor: 'Editor', reviewer: 'Reviewer' } as Record<'author' | 'editor' | 'reviewer', string>,
  language: 'Language',
  languageHint: 'A language tag such as en or en-GB.',
  languageError: 'Use a language tag such as en or en-GB.',
  minutes: 'Estimated minutes',
  minutesError: 'Use a number of minutes above 0 and up to 600.',
  review: 'Review',
  reviewDraft: 'Draft',
  reviewReviewed: (who: string, date: string): string => `Reviewed by ${who} on ${date}`,
  reviewNote: 'Only a reviewer can mark this module reviewed, in the module file.',
  textLicence: 'Text licence',
  slides: 'Slides',
  slidesList: 'Slides in this module',
  slidesEmpty: 'No slides yet. Add one from the slide catalogue.',
  addSlide: 'Add slide',
  addSlideClose: 'Close the slide list',
  catalogueList: 'Slides in the catalogue',
  catalogueEmpty: 'The slide catalogue could not be read, so no slide can be added.',
  catalogueHint: 'Arrow keys move, Enter adds the slide.',
  slideLabel: (n: number): string => `Slide ${n} label`,
  slideRef: (n: number): string => `Slide ${n} reference`,
  slideRefHint: 'Lowercase letters, digits and hyphens; steps and items name the slide by it.',
  slideRefError: 'Use up to 32 lowercase letters, digits or hyphens, starting with a letter, not used by another slide.',
  slideMeta: (dataset: string, licence: string): string => `${dataset} · ${licence}`,
  moveUp: (what: string): string => `Move ${what} up`,
  moveDown: (what: string): string => `Move ${what} down`,
  removeSlide: (label: string): string => `Remove ${label}`,
  slideAdded: (label: string): string => `${label} added to the module.`,
  slideRemoved: (label: string): string => `${label} removed from the module.`,
  slideInUse: (label: string, n: number): string => `${label} is used by ${n} ${n === 1 ? 'part' : 'parts'} of the module (steps, hotspots, items or keys); remove those first.`,
  slideAlready: (label: string): string => `${label} is already in the module.`,
  moved: (what: string, n: number): string => `${what} moved to position ${n}.`,

  // ---------------------------------------------------------------- Record (LEARN.md §7 step 2)
  recordTitle: 'Record a tour',
  recordIntro: 'Navigate the slide as you would at the microscope. Each view you add becomes a tour step with this camera; you write its text in Edit.',
  captureBtn: 'Add tour step from this view',
  hotspotsBtn: 'Make hotspots from the selection',
  hotspotsHint: 'Select points or regions in the Annotations tab, then make them hotspots of the current step.',
  slideOnScreen: 'Slide on screen',
  openSlide: (label: string): string => `Open ${label}`,
  openingSlide: (label: string): string => `Opening ${label}…`,
  stepsCaptured: 'Steps captured so far',
  stepsNone: 'No steps yet.',
  stepRowSub: (phase: string, view: string, hotspots: number): string => `${phase} · ${view}${hotspots > 0 ? ` · ${hotspots} ${hotspots === 1 ? 'hotspot' : 'hotspots'}` : ''}`,
  viewFit: 'whole slide',
  viewKeep: 'keeps the learner’s view',
  viewKey: 'fits the answer key',
  viewAt: (mag: string): string => `view at ${mag}`,
  stepTitleDefault: (n: number): string => `Step ${n}`,
  captured: (n: number, mag: string): string => `Step ${n} added from this view at ${mag}.`,
  captureNoDraft: 'Open a draft first; a tour step is added to a draft.',
  captureNoSlide: 'Open one of the module’s slides first.',
  captureNotModuleSlide: 'The slide on screen is not one of the module’s slides; add it in Collect first.',
  captureOpening: 'The slide is still opening; add the step once it shows.',
  hotspotsNone: 'Select one or more points or regions in the Annotations tab first.',
  hotspotsNoStep: 'Add a tour step first; hotspots are shown on a step.',
  hotspotsItemStep: 'The current step is an item step, which shows no hotspots; choose a tour or reveal step in Edit.',
  hotspotsMade: (n: number, step: number): string => `${n} ${n === 1 ? 'hotspot' : 'hotspots'} added to step ${step}.`,
  hotspotsSkipped: (n: number): string => ` ${n} selected ${n === 1 ? 'annotation was' : 'annotations were'} not a point or a region and ${n === 1 ? 'was' : 'were'} skipped.`,
  hotspotDefault: (n: number): string => `Hotspot ${n}`,

  // ---------------------------------------------------------------- Edit (LEARN.md §7 step 3)
  editTitle: (n: number): string => `Edit step ${n}`,
  editTitleNone: 'Edit steps',
  editSteps: 'Steps',
  stepsCount: (n: number): string => `${n} ${n === 1 ? 'step' : 'steps'}`,
  selectStep: (n: number, title: string): string => `Step ${n}: ${title}`,
  stepTitle: 'Title',
  stepPhase: 'Phase',
  phaseTourDecide: 'A tour step cannot be in Decide: questions are item steps. Add an item step instead.',
  phaseBackwards: 'Phases never go backwards along the steps; the checks will say where.',
  stepText: 'Text',
  stepTextHint: 'Shortcut chips insert a shortcut that the learner sees as its keys.',
  insertCmd: (label: string): string => `Insert the shortcut for ${label}`,
  transition: 'Transition',
  transitionHint: 'Reduced-motion learners always get an instant jump',
  fly: 'Fly',
  cut: 'Cut',
  tools: 'Tools disclosed',
  toolsHint: 'The step rail shows these tools on this step; learners can still open All tools.',
  highlights: 'Highlights',
  highlightsNone: 'No hotspots on this slide yet. Make them in Record.',
  camera: 'Camera',
  cameraCaptured: 'The captured view',
  cameraFit: 'The whole slide',
  cameraKeep: 'Keep the learner’s view',
  cameraKey: 'Fit the answer key',
  recapture: 'Re-capture view',
  recaptured: (n: number, mag: string): string => `Step ${n} now uses this view at ${mag}.`,
  item: 'Item',
  itemNone: 'No item yet',
  revealItems: 'Items revealed',
  revealItemsNone: 'No item is asked before this step.',
  showExpert: 'Offer the expert’s view on this step',
  deleteStep: 'Delete step',
  stepDeleted: (n: number): string => `Step ${n} deleted.`,
  addItemStep: 'Add item step',
  addRevealStep: 'Add reveal step',
  addTourStep: 'Add tour step from this view',
  itemStepAdded: (n: number): string => `Item step ${n} added.`,
  revealStepAdded: (n: number): string => `Reveal step ${n} added.`,
  noFreeItem: 'Every item already has a step; add an item in Items first.',
  noAskedItem: 'Add an item step before a reveal step: a reveal step shows answers of items asked before it.',
  revealTitleDefault: 'Compare with the answer',
  stepFor: (kind: string, n: number): string => `${kind} ${n}`,

  // ---------------------------------------------------------------- Items (LEARN.md §7 step 4)
  itemsTitle: 'Item editor',
  itemsList: 'Items',
  itemsNone: 'No items yet.',
  itemRow: (title: string, kind: string): string => `${title} · ${kind}`,
  itemErrors: (n: number): string => (n === 0 ? 'no errors' : `${n} ${n === 1 ? 'error' : 'errors'}`),
  selectItem: (title: string): string => `Edit ${title}`,
  addItem: 'Add item',
  addItemKind: 'Kind of item',
  itemAdded: (title: string): string => `${title} added, with its item step.`,
  deleteItem: 'Delete item',
  itemDeleted: (title: string): string => `${title} deleted, with its item step.`,
  noItemEditor: 'The item editor is not part of this build, so items cannot be edited here. Items in an imported module file are kept as they are.',
  itemUntitled: (n: number): string => `Item ${n}`,

  // ---------------------------------------------------------------- Publish (LEARN.md §7 step 5; ux-copy §13.7)
  publishTitle: 'Publish checks',
  checksMeta: (n: number): string => `${n} ${n === 1 ? 'check' : 'checks'}`,
  checksList: 'Publish checks (lint)',
  pass: 'pass',
  warning: 'warning',
  fix: 'Fix',
  fixLabel: (message: string): string => `Fix: ${message}`,
  blocker: (first: string): string => `Publishing is blocked: ${first}. This is a blocker, not a warning.`,
  preview: 'Preview as learner',
  previewBlocked: 'Preview is blocked until every error is fixed.',
  previewOpened: 'The preview opened in a new tab. Progress there is not kept.',
  previewPopup: 'The browser did not open a new tab. Allow pop-ups for this page, or open the address in a new tab yourself.',
  publishNote: 'Publishing: commit the file to stage0/data/learn/modules/ with its facts file, add it to a course file, and deploy. Nothing is uploaded from here.',
  exported: (name: string): string => `${name} downloaded.`,
  exportBlocked: 'Export is blocked until every error is fixed.',
  exportFailed: (why: string): string => `The module file could not be written (${why}).`,
  lintFailed: (why: string): string => `The checks could not run (${why}).`,

  // ---------------------------------------------------------------- Import (LEARN.md §7 step 5)
  importTitle: 'Import a module file…',
  importInput: 'Module file to import',
  importDrop: 'Drop a module file here, or press Enter to choose one',
  importDropShort: 'Drop a .module.json file here or choose one',
  importBad: (name: string): string => `${name} could not be imported:`,
  importNotJson: 'it is not a JSON file',
  importTooBig: 'it is larger than 5 MB',
  importRead: 'the browser could not read it',
  imported: (title: string): string => `${title} imported as a new draft.`,
} as const;
