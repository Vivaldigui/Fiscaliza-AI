import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { RoleCode } from '@fiscaliza/database';
import type { AuthenticatedUser } from '@fiscaliza/shared';
import type { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { IntegrationSignatureGuard } from './whatsapp-signature.guard';
import { WhatsappCallbackService } from './whatsapp-callback.service';
import { WhatsappIdentityService } from './whatsapp-identity.service';
import { WhatsappInboundService } from './whatsapp-inbound.service';
import { WhatsappDeliveryCallbackDto, WhatsappInboundDto } from './dto/whatsapp.dto';

@ApiTags('integrations/whatsapp')
@Controller('integrations/whatsapp')
export class WhatsappController {
  constructor(
    private readonly inbound: WhatsappInboundService,
    private readonly callback: WhatsappCallbackService,
    private readonly identities: WhatsappIdentityService,
  ) {}

  @Post('inbound')
  @Public()
  @UseGuards(IntegrationSignatureGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Recebe mensagem WhatsApp da UAZAPI via n8n (assinada).' })
  receiveInbound(@Body() dto: WhatsappInboundDto, @Req() request: Request & { id?: string }) {
    return this.inbound.receive(dto, request.id);
  }

  @Post('delivery-callback')
  @Public()
  @UseGuards(IntegrationSignatureGuard)
  @ApiOperation({ summary: 'Recebe status de entrega (SENT/DELIVERED/FAILED) enviado pelo n8n.' })
  receiveCallback(
    @Body() dto: WhatsappDeliveryCallbackDto,
    @Req() request: Request & { id?: string },
  ) {
    return this.callback.apply(dto, request.id);
  }

  @Get('identities')
  @Roles(RoleCode.ADMIN, RoleCode.SECRETARIAT, RoleCode.AUDITOR)
  @ApiOperation({ summary: 'Lista identidades WhatsApp com telefones mascarados.' })
  listIdentities() {
    return this.identities.list();
  }

  @Get('overview')
  @Roles(RoleCode.ADMIN, RoleCode.SECRETARIAT, RoleCode.AUDITOR)
  @ApiOperation({ summary: 'Visão operacional: identidades, sessões e respostas pendentes.' })
  overview() {
    return this.inbound.identityOverview();
  }

  @Post('identities/:id/verify')
  @Roles(RoleCode.ADMIN, RoleCode.SECRETARIAT)
  @ApiOperation({ summary: 'Marca uma identidade WhatsApp como verificada e ativa.' })
  verifyIdentity(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.identities.verify(id, user.id);
  }

  @Post('identities/:id/deactivate')
  @Roles(RoleCode.ADMIN, RoleCode.SECRETARIAT)
  @ApiOperation({ summary: 'Desativa uma identidade WhatsApp.' })
  deactivateIdentity(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.identities.deactivate(id, user.id);
  }
}
