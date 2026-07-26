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
  sessionId?: string;
}

interface SessionBody {
  workspace?: string;
  sessionId?: string;
}

@Controller('api/agent')
export class AgentController {
  constructor(
    private readonly agent: AgentService,
    private readonly workspaces: WorkspaceService,
  ) {}

  @Get('status')
  status() {
    return this.agent.status();
  }

  @Get('sessions')
  async sessions(@Query('workspace') workspaceQuery?: string) {
    if (!workspaceQuery?.trim()) throw new BadRequestException('A workspace path is required');
    const workspace = this.workspaces.resolvePath(workspaceQuery);
    await this.workspaces.assertDirectory(workspace);
    return this.agent.listSessions(workspace);
  }

  @Post('sessions')
  async createSession(@Body() body: SessionBody, @Res() response: Response): Promise<void> {
    if (!body?.workspace?.trim()) throw new BadRequestException('A workspace path is required');
    const workspace = this.workspaces.resolvePath(body.workspace);
    await this.workspaces.assertDirectory(workspace);
    this.writeSse(response);
    let closed = false;
    response.on('close', () => { closed = true; });
    const send = (event: AgentEvent) => {
      if (closed || response.writableEnded) return;
      response.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    try {
      const result = await this.agent.createSession(workspace, send);
      send({ type: 'session', sessionId: result.sessionId });
      send({ type: 'done' });
    } catch (error) {
      send({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    } finally {
      closed = true;
      if (!response.writableEnded) response.end();
    }
  }

  @Post('sessions/load')
  async loadSession(@Body() body: SessionBody, @Res() response: Response): Promise<void> {
    if (!body?.workspace?.trim()) throw new BadRequestException('A workspace path is required');
    if (!body?.sessionId?.trim()) throw new BadRequestException('A sessionId is required');
    const workspace = this.workspaces.resolvePath(body.workspace);
    await this.workspaces.assertDirectory(workspace);
    this.writeSse(response);
    let closed = false;
    response.on('close', () => { closed = true; });
    const send = (event: AgentEvent) => {
      if (closed || response.writableEnded) return;
      response.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    try {
      await this.agent.loadSession(workspace, body.sessionId, send);
    } catch (error) {
      send({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    } finally {
      closed = true;
      if (!response.writableEnded) response.end();
    }
  }

  @Post('sessions/close')
  async closeSession(@Body() body: SessionBody) {
    if (!body?.workspace?.trim()) throw new BadRequestException('A workspace path is required');
    if (!body?.sessionId?.trim()) throw new BadRequestException('A sessionId is required');
    const workspace = this.workspaces.resolvePath(body.workspace);
    await this.workspaces.assertDirectory(workspace);
    await this.agent.closeSession(workspace, body.sessionId);
    return { ok: true };
  }

  @Post('cancel')
  async cancel(@Body() body: SessionBody) {
    if (!body?.workspace?.trim()) throw new BadRequestException('A workspace path is required');
    const workspace = this.workspaces.resolvePath(body.workspace);
    await this.workspaces.assertDirectory(workspace);
    await this.agent.cancel(workspace, body.sessionId);
    return { ok: true };
  }

  @Post('message')
  async message(
    @Body() body: MessageBody,
    @Res() response: Response,
  ): Promise<void> {
    if (!body?.workspace?.trim()) throw new BadRequestException('A workspace path is required');
    if (!body?.text?.trim()) throw new BadRequestException('A message is required');

    const workspace = this.workspaces.resolvePath(body.workspace);
    await this.workspaces.assertDirectory(workspace);

    this.writeSse(response);

    let closed = false;
    response.on('close', () => { closed = true; });
    const send = (event: AgentEvent) => {
      if (closed || response.writableEnded) return;
      response.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    try {
      await this.agent.prompt(workspace, body.text, send, body.sessionId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      send({ type: 'error', message });
    } finally {
      closed = true;
      if (!response.writableEnded) response.end();
    }
  }

  private writeSse(response: Response): void {
    response.status(200);
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders?.();
  }
}
