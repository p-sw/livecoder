import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { AgentService, type AgentEvent } from './agent.service.js';
import { WorkspaceService } from '../workspace/workspace.service.js';

interface MessageBody {
  workspace?: string;
  text?: string;
  adapter?: string;
}

@Controller('api/agent')
export class AgentController {
  constructor(
    private readonly agent: AgentService,
    private readonly workspaces: WorkspaceService,
  ) {}

  @Get('status')
  status(@Query('adapter') adapter?: string) {
    return this.agent.status(adapter);
  }

  @Post('message')
  async message(
    @Body() body: MessageBody,
    @Query('adapter') adapterQuery: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    if (!body?.workspace?.trim()) throw new BadRequestException('A workspace path is required');
    if (!body?.text?.trim()) throw new BadRequestException('A message is required');

    // ponytail: query string wins over body so a streaming client can pin the
    // adapter via fetch options without re-serializing the JSON body.
    const adapter = adapterQuery || body.adapter;

    const workspace = this.workspaces.resolvePath(body.workspace);
    await this.workspaces.assertDirectory(workspace);

    response.status(200);
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders?.();

    let closed = false;
    response.on('close', () => { closed = true; });
    const send = (event: AgentEvent) => {
      if (closed || response.writableEnded) return;
      response.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    try {
      await this.agent.prompt(workspace, body.text, send, adapter);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      send({ type: 'error', message });
    } finally {
      closed = true;
      if (!response.writableEnded) response.end();
    }
  }
}
