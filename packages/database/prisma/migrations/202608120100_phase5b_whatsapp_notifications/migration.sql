-- Phase 5B: WhatsApp inbound/identity links, notification channel targeting,
-- append-only delivery attempts and the notification type enum.
--
-- No prior migration is edited. The `Notification.type` column is added with a
-- conservative default so existing rows (if any) remain valid; the application
-- always sets an explicit type on new rows.

-- CreateEnum
CREATE TYPE "public"."NotificationType" AS ENUM ('WHATSAPP_CONVERSATION_REPLY', 'RESPONSE_ANALYSIS_COMPLETED', 'DEADLINE_APPROACHING', 'DEADLINE_EXPIRED');

-- DropForeignKey
ALTER TABLE "public"."notifications" DROP CONSTRAINT "notifications_recipient_id_fkey";

-- AlterTable
ALTER TABLE "public"."conversations" ADD COLUMN     "whatsapp_identity_id" UUID;

-- AlterTable
ALTER TABLE "public"."inbound_messages" ADD COLUMN     "conversation_id" UUID,
ADD COLUMN     "conversation_message_id" UUID,
ADD COLUMN     "identity_id" UUID;

-- AlterTable
ALTER TABLE "public"."notifications" ADD COLUMN     "analysis_id" UUID,
ADD COLUMN     "deadline_id" UUID,
ADD COLUMN     "destination_phone" VARCHAR(20),
ADD COLUMN     "identity_id" UUID,
ADD COLUMN     "template_version" VARCHAR(64),
ADD COLUMN     "type" "public"."NotificationType" NOT NULL DEFAULT 'WHATSAPP_CONVERSATION_REPLY',
ALTER COLUMN "recipient_id" DROP NOT NULL;

-- The column default above only backfills pre-existing rows; the schema does
-- not declare a default (the application always sets an explicit type).
ALTER TABLE "public"."notifications" ALTER COLUMN "type" DROP DEFAULT;

-- CreateTable
CREATE TABLE "public"."notification_delivery_attempts" (
    "id" UUID NOT NULL,
    "notification_id" UUID NOT NULL,
    "attempt" INTEGER NOT NULL,
    "status" "public"."NotificationStatus" NOT NULL,
    "provider" VARCHAR(100) NOT NULL,
    "external_message_id" VARCHAR(255),
    "error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notification_delivery_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notification_delivery_attempts_notification_id_status_idx" ON "public"."notification_delivery_attempts"("notification_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "notification_delivery_attempts_notification_id_attempt_key" ON "public"."notification_delivery_attempts"("notification_id", "attempt");

-- CreateIndex
CREATE INDEX "conversations_whatsapp_identity_id_idx" ON "public"."conversations"("whatsapp_identity_id");

-- CreateIndex
CREATE INDEX "inbound_messages_identity_id_received_at_idx" ON "public"."inbound_messages"("identity_id", "received_at");

-- CreateIndex
CREATE INDEX "inbound_messages_conversation_id_idx" ON "public"."inbound_messages"("conversation_id");

-- CreateIndex
CREATE INDEX "notifications_identity_id_created_at_idx" ON "public"."notifications"("identity_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_type_status_created_at_idx" ON "public"."notifications"("type", "status", "created_at");

-- CreateIndex
CREATE INDEX "notifications_analysis_id_idx" ON "public"."notifications"("analysis_id");

-- CreateIndex
CREATE INDEX "notifications_deadline_id_idx" ON "public"."notifications"("deadline_id");

-- AddForeignKey
ALTER TABLE "public"."conversations" ADD CONSTRAINT "conversations_whatsapp_identity_id_fkey" FOREIGN KEY ("whatsapp_identity_id") REFERENCES "public"."whatsapp_identities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."inbound_messages" ADD CONSTRAINT "inbound_messages_identity_id_fkey" FOREIGN KEY ("identity_id") REFERENCES "public"."whatsapp_identities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."inbound_messages" ADD CONSTRAINT "inbound_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."inbound_messages" ADD CONSTRAINT "inbound_messages_conversation_message_id_fkey" FOREIGN KEY ("conversation_message_id") REFERENCES "public"."conversation_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."notifications" ADD CONSTRAINT "notifications_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."notifications" ADD CONSTRAINT "notifications_identity_id_fkey" FOREIGN KEY ("identity_id") REFERENCES "public"."whatsapp_identities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."notifications" ADD CONSTRAINT "notifications_analysis_id_fkey" FOREIGN KEY ("analysis_id") REFERENCES "public"."analyses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."notifications" ADD CONSTRAINT "notifications_deadline_id_fkey" FOREIGN KEY ("deadline_id") REFERENCES "public"."deadlines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."notification_delivery_attempts" ADD CONSTRAINT "notification_delivery_attempts_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
