/**
 * draw-tools (TOOLS.md §4, §6.6, D7, D17–D19): the seven ToolControllers on core's ToolHost, and their commands.
 *
 *   select.ts   Select / edit `V` (click-select, move, vertex and box-handle edits, click-pick / click-drop, keyboard carry)
 *   point.ts    Point `T`
 *   box.ts      Rectangle `X`, Ellipse `E` (drag, click-click, Enter · arrows · Enter)
 *   polygon.ts  Polygon `P` (clicks, taps, keyboard-started at the crosshair)
 *   brush.ts    Brush `F` (area painting with pen pressure, merge into the selected region) + trace.ts (the mask trace)
 *   measure.ts  Measure `M` (the Stage-0 tool, moved here; shell-check's strings)
 *   hints.ts    every sentence; edit.ts the pure geometry edits; common.ts what the tools share
 *
 * Commands (group Annotate): `tool:select|point|rect|ellipse|polygon|brush|measure` (V T X E P F M), the alias
 * `tool:freehand`, `tool:area` (⇧M: the §8 sentence pointing at the region tools), `polygon:close`, `brush:larger` /
 * `brush:smaller`, `selection:move:left|right|up|down` (palette rows of the Move pad). Registered at install, so the
 * Stage-0 rows and the "not in this build" fallbacks that main.ts registers afterwards step aside (§15.1 J2), and
 * main.ts's Stage-0 tools are not registered (W1).
 *
 * Feature modules talk through the shell only (§4.4): the annotation store via `shell.service('annotations')`, the
 * overlay via the ViewHandle and the ToolContext. Nothing here writes DOM; notices go through the NoticeSink at rest.
 */
import type { ShellApi, ShellCommand, ToolController, ToolId } from '../contracts';
import { translateShape } from '../geometry';
import { translateGeometry } from '../interop';
import { BoxTool } from './box';
import { BRUSH_DEFAULT, BRUSH_MAX, BRUSH_MIN, BRUSH_PREF, BrushTool } from './brush';
import { createEnv, type ToolEnv } from './common';
import { AREA_REFUSAL, COMMAND_LABEL, INTRO_SELECT, NOTHING_SELECTED, POLYGON_NONE, READ_ONLY, brushRadiusText, introMeasure } from './hints';
import { MeasureTool } from './measure';
import { PointTool } from './point';
import { PolygonTool } from './polygon';
import { SelectTool } from './select';

export const name = 'draw-tools';
const OWNER = 'draw-tools';
/** Move pad step of the palette rows (TOOLS.md §6.5: 10 CSS px per press). */
const MOVE_STEP_CSS = 10;
/** Brush size step of the palette rows (CSS px). */
const BRUSH_STEP_CSS = 4;

export interface DrawTools {
  select: SelectTool;
  point: PointTool;
  rect: BoxTool;
  ellipse: BoxTool;
  polygon: PolygonTool;
  brush: BrushTool;
  measure: MeasureTool;
}

export function install(shell: ShellApi): void {
  const env = createEnv(shell);
  const tools: DrawTools = {
    select: new SelectTool(env),
    point: new PointTool(env),
    rect: new BoxTool(env, 'rect'),
    ellipse: new BoxTool(env, 'ellipse'),
    polygon: new PolygonTool(env),
    brush: new BrushTool(env),
    measure: new MeasureTool(env),
  };
  const order: ToolId[] = ['select', 'point', 'rect', 'ellipse', 'polygon', 'brush', 'measure'];
  const registered = new Set<ToolId>();
  for (const id of order) {
    if (shell.tools.get(id) !== undefined) {
      console.error(`[draw-tools] a "${id}" tool is registered already; draw-tools' is not installed`);
      continue;
    }
    shell.tools.register(tools[id] as ToolController);
    registered.add(id);
  }
  registerCommands(shell, env, tools, registered);

  // A slide switch drops what a tool holds for that pane (core cancels a busy one with its notice, §5.2 step 1).
  shell.bus.on('slideClosing', ({ view }) => {
    for (const id of order) {
      const t = tools[id];
      if (!t.busy) continue;
      if (t.pane === view) t.cancel();
    }
  });

  shell.debug.expose('draw-tools', () => ({
    active: shell.tools.active,
    registered: [...registered],
    brushRadius: tools.brush.radius(),
    tools: {
      select: tools.select.debug(),
      point: tools.point.debug(),
      rect: tools.rect.debug(),
      ellipse: tools.ellipse.debug(),
      polygon: tools.polygon.debug(),
      brush: tools.brush.debug(),
      measure: tools.measure.debug(),
    },
    labels: Object.fromEntries(order.map((id) => [id, tools[id].label])),
    hints: Object.fromEntries(order.map((id) => [id, tools[id].hint()])),
  }));
}

function registerCommands(shell: ShellApi, env: ToolEnv, tools: DrawTools, registered: ReadonlySet<ToolId>): void {
  const w = (key: string, shift = false): { key: string; scope: 'window'; shift?: boolean } => (shift ? { key, scope: 'window', shift: true } : { key, scope: 'window' });
  const choose = (id: ToolId): void => {
    if (!registered.has(id)) return;
    shell.tools.activate(id, shell.commands.source);
    const intro = id === 'select' ? INTRO_SELECT : id === 'measure' ? introMeasure(env.coarse()) : tools[id].hint();
    env.say(intro);
    shell.focusCanvas();
  };
  const toolRow = (id: ToolId, key: string, meta?: string): ShellCommand => ({
    id: `tool:${id}`,
    owner: OWNER,
    group: 'Annotate',
    label: COMMAND_LABEL[id],
    ...(meta !== undefined ? { meta } : {}),
    keys: [[key.toUpperCase()]],
    bindings: [w(key)],
    run: () => choose(id),
  });
  const rows: ShellCommand[] = [
    toolRow('select', 'v'),
    toolRow('point', 't', 'Enter places one at the centre'),
    toolRow('rect', 'x', 'Enter, arrows, Enter from the keyboard'),
    toolRow('ellipse', 'e', 'Enter, arrows, Enter from the keyboard'),
    toolRow('polygon', 'p', 'Enter adds a point at the centre'),
    toolRow('brush', 'f', 'mouse or pen; Polygon is the keyboard alternative'),
    toolRow('measure', 'm'),
    { id: 'tool:freehand', owner: OWNER, group: 'Annotate', label: 'Freehand (the brush)', keymapOnly: true, run: () => choose('brush') },
    {
      id: 'tool:area',
      owner: OWNER,
      group: 'Annotate',
      label: 'Measure area',
      meta: 'draw a region: the Annotations list shows its area',
      keys: [['⇧', 'M']],
      bindings: [w('m', true)],
      run: () => env.refuse(AREA_REFUSAL),
    },
    {
      id: 'polygon:close',
      owner: OWNER,
      group: 'Annotate',
      label: 'Close the polygon in progress',
      meta: 'Enter on the slide, a click on the first point, or a double click',
      keys: [['↵']],
      run: () => {
        if (!tools.polygon.closeNow(shell.commands.source === 'keyboard' ? 'keyboard' : 'command')) env.say(POLYGON_NONE);
      },
    },
    { id: 'brush:larger', owner: OWNER, group: 'Annotate', label: 'Brush size larger', meta: `${BRUSH_STEP_CSS} px a step, up to ${BRUSH_MAX} px`, run: () => setBrush(shell, env, tools.brush.radius() + BRUSH_STEP_CSS) },
    { id: 'brush:smaller', owner: OWNER, group: 'Annotate', label: 'Brush size smaller', meta: `${BRUSH_STEP_CSS} px a step, down to ${BRUSH_MIN} px`, run: () => setBrush(shell, env, tools.brush.radius() - BRUSH_STEP_CSS) },
  ];
  for (const [dir, dx, dy] of [
    ['left', -1, 0],
    ['right', 1, 0],
    ['up', 0, -1],
    ['down', 0, 1],
  ] as const) {
    rows.push({ id: `selection:move:${dir}`, owner: OWNER, group: 'Annotate', label: `Move the selection ${dir}`, meta: `${MOVE_STEP_CSS} px on screen · the Inspector's Move pad`, run: () => moveSelection(shell, env, dx * MOVE_STEP_CSS, dy * MOVE_STEP_CSS) });
  }
  for (const r of rows) {
    if (shell.commands.get(r.id) !== undefined) {
      console.error(`[draw-tools] the command "${r.id}" is registered already`);
      continue;
    }
    shell.commands.register(r);
  }
}

function setBrush(shell: ShellApi, env: ToolEnv, r: number): void {
  const v = Math.max(BRUSH_MIN, Math.min(BRUSH_MAX, Math.round(Number.isFinite(r) ? r : BRUSH_DEFAULT)));
  shell.prefs.set(BRUSH_PREF, v);
  env.say(brushRadiusText(v));
}

/** `selection:move:*`: translate the editable selection of the focused view by CSS px on screen (one undo step). */
function moveSelection(shell: ShellApi, env: ToolEnv, dxCss: number, dyCss: number): void {
  const view = shell.focusedView();
  const st = env.store(view);
  const s = view.viewer?.snapshot;
  if (st === null || s === undefined || !(s.k > 0)) return;
  const sel = [...st.selection];
  if (sel.length === 0) {
    env.say(NOTHING_SELECTED);
    return;
  }
  const ids = sel.filter((id) => st.get(id) !== undefined);
  if (ids.length === 0) {
    env.refuse(READ_ONLY);
    return;
  }
  const dx = (dxCss * s.renderDpr) / s.k;
  const dy = (dyCss * s.renderDpr) / s.k;
  const input = shell.commands.source === 'keyboard' ? 'keyboard' : 'command';
  st.transaction(() => {
    for (const id of ids) {
      const a = st.get(id)!;
      const k = a.properties.stoipath?.kind;
      const sh = a.properties.stoipath?.shape;
      const geometry = translateGeometry(a.geometry, dx, dy);
      st.update(id, sh !== undefined && (k === 'rect' || k === 'ellipse') ? { geometry, shape: translateShape(sh, dx, dy) } : { geometry }, input);
    }
  });
}
