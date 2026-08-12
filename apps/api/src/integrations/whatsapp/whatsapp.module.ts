import { Module } from '@nestjs/common';
import { WhatsappCallbackService } from './whatsapp-callback.service';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappIdentityService } from './whatsapp-identity.service';
import { WhatsappInboundService } from './whatsapp-inbound.service';
import { IntegrationSignatureGuard } from './whatsapp-signature.guard';
import { WhatsappSessionService } from './whatsapp-session.service';

@Module({
  controllers: [WhatsappController],
  providers: [
    IntegrationSignatureGuard,
    WhatsappCallbackService,
    WhatsappIdentityService,
    WhatsappInboundService,
    WhatsappSessionService,
  ],
  exports: [WhatsappSessionService],
})
export class WhatsappModule {}
