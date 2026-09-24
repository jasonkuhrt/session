import { Settings } from 'lucide-react'

import { changeSettings, useSettings } from '../lib/settings'
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
        </DropdownMenuGroup>
        {problem === null ? null : <p className="px-1.5 py-1 text-xs text-destructive wrap-anywhere">{problem}</p>}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
