import { Settings } from 'lucide-react'

import { changeSettings, type Hue, useSettings } from '../lib/settings'
import { HueSwatches } from './hue-swatches'
import { Button } from './ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'

/**
 * The board's own settings, behind one icon at the far end of every page's
 * header. A setting says what it does in the menu itself rather than in a tip,
 * because this menu is where tips are turned on.
 */
export function SettingsMenu({ className }: { className?: string }) {
  const { settings, problem } = useSettings()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" className={className} aria-label="Settings" />}>
        <Settings />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Settings, in this browser</DropdownMenuLabel>
          <DropdownMenuCheckboxItem checked={settings.tips} onCheckedChange={(tips) => changeSettings({ tips })}>
            <span className="block">
              <span className="block">Tips</span>
              <span className="block text-xs text-muted-foreground">
                Hovering or focusing a word or a control says what it means.
              </span>
            </span>
          </DropdownMenuCheckboxItem>
          <ColourSetting
            name="Code colour"
            does="Inline code on every page is drawn in this hue; a code block keeps the text's colour."
            value={settings.codeColor}
            onChange={(codeColor) => changeSettings({ codeColor })}
          />
          <ColourSetting
            name="Term colour"
            does="A term a page's Term | Meaning table defines is drawn in this hue, in the table and wherever the page names it."
            value={settings.termColor}
            onChange={(termColor) => changeSettings({ termColor })}
          />
        </DropdownMenuGroup>
        {problem === null ? null : <p className="px-1.5 py-1 text-xs text-destructive wrap-anywhere">{problem}</p>}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * A setting that holds one of the theme's hues: its name and what it does, as
 * every item here says, over the swatches that change it. A press changes it
 * without closing the menu, so the page behind shows each hue as it is tried.
 */
function ColourSetting({ name, does, value, onChange }: {
  name: string
  does: string
  value: Hue
  onChange: (hue: Hue) => void
}) {
  return (
    <div className="space-y-1.5 px-1.5 py-1 text-sm">
      <span className="block">
        <span className="block">{name}</span>
        <span className="block text-xs text-muted-foreground">{does}</span>
      </span>
      <HueSwatches label={name} value={value} onChange={onChange} />
    </div>
  )
}
