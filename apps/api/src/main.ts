import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { attachLspWebSocket } from './lsp/bridge.js';
import { loadSettings } from './settings/settings-store.js';
import { ensurePushReady } from './push/push-store.js';

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? '0.0.0.0';

const app = await NestFactory.create(AppModule);
await app.listen(port, host);
loadSettings();
void ensurePushReady();

// ponytail: piggyback on Nest's HTTP server for the WS upgrade — one port,
// one process. The LSP bridge owns the per-connection lifecycle.
attachLspWebSocket(app.getHttpServer());

console.log(`livecoder API listening on http://${host}:${port}`);
