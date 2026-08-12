import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '@fiscaliza/shared';
import type { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CreateConversationDto, SendMessageDto } from './dto/conversation.dto';
import { ConversationsService } from './conversations.service';

@ApiTags('conversations')
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  @Get()
  @ApiOkResponse({ description: 'Conversas web do usuário autenticado.' })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.conversations.list(user);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ description: 'Conversa criada e ativada na sessão Redis.' })
  create(
    @Body() dto: CreateConversationDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request & { id?: string },
  ) {
    return this.conversations.create(dto, user, request.id);
  }

  @Get(':id')
  @ApiOkResponse({ description: 'Conversa com mensagens e fontes validadas.' })
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.conversations.get(id, user);
  }

  @Post(':id/messages')
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ description: 'Mensagem deduplicada aceita e resposta enfileirada.' })
  sendMessage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendMessageDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request & { id?: string },
  ) {
    return this.conversations.sendMessage(id, dto, user, request.id);
  }

  @Post(':id/sources/:documentId/download')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({
    description: 'URL assinada para um documento citado como fonte desta conversa.',
  })
  downloadSource(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request & { id?: string },
  ) {
    return this.conversations.downloadSource(id, documentId, user, request.id);
  }
}
