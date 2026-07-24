// ponytail: the controller is a thin shell over the store. GET returns
// the current effective settings (overrides only — env defaults are
// documented in the API but not exposed so the UI can render its own
// "use default" treatment).

import {
  Body,
  Controller,
  Get,
  Put,
} from '@nestjs/common';
import {
  DEFAULT_SETTINGS,
  getSettings,
  saveSettings,
  settingsFilePath,
  type Settings,
} from './settings-store.js';

interface SettingsBody {
  cloneBasePath?: string | null;
  defaultAdapterId?: string | null;
}

@Controller('api/settings')
export class SettingsController {
  @Get()
  list(): { settings: Settings; defaults: Settings; path: string } {
    return {
      settings: getSettings(),
      defaults: DEFAULT_SETTINGS,
      path: settingsFilePath(),
    };
  }

  @Put()
  async update(@Body() body: SettingsBody): Promise<{ settings: Settings }> {
    const next: Settings = {
      cloneBasePath: body?.cloneBasePath ?? null,
      defaultAdapterId: body?.defaultAdapterId ?? null,
    };
    const saved = await saveSettings(next);
    return { settings: saved };
  }
}
