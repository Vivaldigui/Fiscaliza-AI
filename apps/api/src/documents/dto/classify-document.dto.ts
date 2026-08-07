import { DocumentKind } from '@fiscaliza/database';
import { IsEnum } from 'class-validator';

export class ClassifyDocumentDto {
  @IsEnum(DocumentKind)
  kind: DocumentKind;
}
