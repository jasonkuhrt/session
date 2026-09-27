import { Schema } from 'effect'

import { type Hue, HueSchema } from '../lib/settings'
import { Tip } from './tip'
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group'

const isHue = Schema.is(HueSchema)

/** A hue's name, as its swatch's tip gives it. */
const nameOf = (hue: Hue) => `${hue.charAt(0).toUpperCase()}${hue.slice(1)}`

/**
 * The theme's hues as a row of swatches, with the one a setting holds
 * pressed. Every colour setting is drawn with it, so each offers the same hues
 * the same way, and a swatch changes the setting as soon as it is pressed.
 */
export function HueSwatches({ label, value, onChange }: {
  /** What the row sets, which names it as a group. */
  label: string
  value: Hue
  onChange: (hue: Hue) => void
}) {
  return (
    <ToggleGroup
      aria-label={label}
      size="sm"
      spacing={1}
      value={[value]}
      onValueChange={([hue]) => {
        // Pressing the pressed swatch would leave none, and a colour setting always holds a hue.
        if (isHue(hue)) onChange(hue)
      }}
    >
      {HueSchema.literals.map((hue) => (
        <Tip key={hue} meaning={nameOf(hue)} render={<ToggleGroupItem value={hue} aria-label={nameOf(hue)} />}>
          {/* The pressed swatch is ringed too, since a swatch under the pointer takes the pressed one's ground. */}
          <span
            className="size-4 rounded-full ring-foreground group-aria-pressed/toggle:ring-2"
            style={{ backgroundColor: `var(--tn-${hue})` }}
          />
        </Tip>
      ))}
    </ToggleGroup>
  )
}
