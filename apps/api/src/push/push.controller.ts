import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
} from '@nestjs/common';
import {
  ensurePushReady,
  getVapidPublicKey,
  removeSubscription,
  saveSubscription,
  type PushSubscriptionJSON,
} from './push-store.js';

@Controller('api/push')
export class PushController {
  @Get('vapid-public-key')
  async vapidPublicKey(): Promise<{ publicKey: string }> {
    const keys = await ensurePushReady();
    return { publicKey: keys.publicKey || getVapidPublicKey() || '' };
  }

  @Post('subscribe')
  async subscribe(@Body() body: PushSubscriptionJSON): Promise<{ ok: boolean }> {
    if (!body?.endpoint || typeof body.endpoint !== 'string') {
      return { ok: false };
    }
    await ensurePushReady();
    await saveSubscription(body);
    return { ok: true };
  }

  @Delete('subscribe')
  async unsubscribe(@Body() body: { endpoint?: string }): Promise<{ ok: boolean }> {
    if (!body?.endpoint) return { ok: false };
    await removeSubscription(body.endpoint);
    return { ok: true };
  }
}
