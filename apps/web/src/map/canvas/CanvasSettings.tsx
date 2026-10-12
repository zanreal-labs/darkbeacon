'use client';

import { Button, Card, CardBody, CardFooter, CardHeader, Field, Segmented, Select, Switch } from '../../ui';
import styles from '../../screens/settings.module.css';
import {
  CORNERS,
  DEFAULT_CANVAS_PREFS,
  setCanvasPrefs,
  useCanvasPrefs,
  type Corner,
  type DotlanTarget,
} from './prefs';

const CORNER_LABEL: Record<Corner, string> = {
  'top-left': 'Top left',
  'top-right': 'Top right',
  'bottom-left': 'Bottom left',
  'bottom-right': 'Bottom right',
};

const DOTLAN_LABEL: Record<DotlanTarget, string> = {
  system: 'The system page',
  sec: 'Region map: security',
  sov: 'Region map: sovereignty',
  const: 'Region map: constellations',
  jumps: 'Region map: jumps',
  kills: 'Region map: kills',
  npc: 'Region map: NPC kills',
  npc_delta: 'Region map: NPC kill change',
};

/**
 * "Map view": how this browser draws the canvas and handles it. Everyone on the map has it; the
 * choices stay in this browser and apply to every map.
 */
export function CanvasSettings() {
  const prefs = useCanvasPrefs();
  return (
    <>
      <Card>
        <CardHeader
          title="Canvas"
          description="How the map looks in this browser, on every map. Nobody else sees these choices."
        />
        <CardBody>
          <div className={styles.formStack}>
            <div className={styles.grid}>
              <Field label="Minimap">
                <Select
                  value={prefs.minimap}
                  onValueChange={(v) => setCanvasPrefs({ minimap: v as Corner | 'off' })}
                  options={[
                    { value: 'off', label: 'Hidden' },
                    ...CORNERS.map((c) => ({ value: c, label: CORNER_LABEL[c] })),
                  ]}
                />
              </Field>
              <Field label="Rally card">
                <Select
                  value={prefs.pings}
                  onValueChange={(v) => setCanvasPrefs({ pings: v as Corner })}
                  options={CORNERS.map((c) => ({ value: c, label: CORNER_LABEL[c] }))}
                />
              </Field>
            </div>
            <Field label="Background">
              <Segmented
                aria-label="Background"
                value={prefs.background}
                onValueChange={(v) => setCanvasPrefs({ background: v as typeof prefs.background })}
                options={[
                  { value: 'dots', label: 'Dots' },
                  { value: 'lines', label: 'Grid' },
                  { value: 'none', label: 'Plain' },
                ]}
              />
            </Field>
            <Switch
              label="Soft background"
              description="A quieter canvas colour, closer to the page around it."
              checked={prefs.softBackground}
              onCheckedChange={(on) => setCanvasPrefs({ softBackground: on })}
            />
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Handling" description="What dragging and jumping do." />
        <CardBody>
          <div className={styles.formStack}>
            <Switch
              label="Snap to grid"
              description="Dragged systems line up on the grid."
              checked={prefs.snapToGrid}
              onCheckedChange={(on) => setCanvasPrefs({ snapToGrid: on })}
            />
            <Switch
              label="Drag to select"
              description="A drag on the empty canvas draws a selection box and the right button pans, as in Pathfinder. Off: drag pans, Shift+drag selects."
              checked={prefs.dragSelects}
              onCheckedChange={(on) => setCanvasPrefs({ dragSelects: on })}
            />
            <Switch
              label="Select the system you jump into"
              description="When one of your characters jumps, the system it lands in is selected and its panel opens."
              checked={prefs.selectOnJump}
              onCheckedChange={(on) => setCanvasPrefs({ selectOnJump: on })}
            />
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Links" description="Where the system menu's Dotlan link goes." />
        <CardBody>
          <Field
            label="Dotlan opens"
            hint="Wormholes always open their system page: Dotlan has no region map for them."
          >
            <Select
              value={prefs.dotlan}
              onValueChange={(v) => setCanvasPrefs({ dotlan: v as DotlanTarget })}
              options={(Object.keys(DOTLAN_LABEL) as DotlanTarget[]).map((t) => ({
                value: t,
                label: DOTLAN_LABEL[t],
              }))}
            />
          </Field>
        </CardBody>
        {JSON.stringify(prefs) !== JSON.stringify(DEFAULT_CANVAS_PREFS) && (
          <CardFooter>
            <span className={styles.footerNote}>Kept in this browser.</span>
            <Button variant="ghost" onClick={() => setCanvasPrefs(DEFAULT_CANVAS_PREFS)}>
              Back to the defaults
            </Button>
          </CardFooter>
        )}
      </Card>
    </>
  );
}
