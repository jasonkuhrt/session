import * as React from 'react'

import { changeSettings, type Hue, useSettings } from '../lib/settings'
import { HueSwatches } from './hue-swatches'
import { Checkbox } from './ui/checkbox'
import { Label } from './ui/label'

/**
 * The board's own settings, as the settings command opens them. Each says
 * what it does in the panel itself rather than in a tip, because this is
 * where tips are turned on.
 */
export function SettingsPanel() {
  const { settings, problem } = useSettings()
  const tipsId = React.useId()
  return (
    <div className="space-y-4 text-sm">
      <div className="flex items-start gap-3">
        <Checkbox id={tipsId} checked={settings.tips} onCheckedChange={(tips) => changeSettings({ tips })} className="mt-0.5" />
        <Label htmlFor={tipsId} className="block space-y-1 font-normal">
          <span className="block font-medium">Tips</span>
          <span className="block text-xs text-muted-foreground">Hovering a word or a control says what it means.</span>
        </Label>
      </div>
      <ColourSetting
        name="Code colour"
        does="Inline code on every page is drawn in this hue; a TypeScript, JSON or shell block is coloured by Tokyo Night, and any other block keeps the text's colour."
        value={settings.codeColor}
        onChange={(codeColor) => changeSettings({ codeColor })}
      />
      <ColourSetting
        name="Term colour"
        does="A term a page's Term | Meaning table defines is drawn in this hue, in the table and wherever the page names it."
        value={settings.termColor}
        onChange={(termColor) => changeSettings({ termColor })}
      />
      {problem === null ? null : <p className="text-xs text-destructive wrap-anywhere">{problem}</p>}
    </div>
  )
}

/**
 * A setting that holds one of the theme's hues: its name and what it does,
 * over the swatches that change it. A press changes it at once, so the page
 * behind shows each hue as it is tried.
 */
function ColourSetting({ name, does, value, onChange }: {
  name: string
  does: string
  value: Hue
  onChange: (hue: Hue) => void
}) {
  return (
    <div className="space-y-1.5">
      <span className="block">
        <span className="block font-medium">{name}</span>
        <span className="block text-xs text-muted-foreground">{does}</span>
      </span>
      <HueSwatches label={name} value={value} onChange={onChange} />
    </div>
  )
}
