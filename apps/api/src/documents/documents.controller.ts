import { unlink } from 'node:fs/promises';
import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiAcceptedResponse, ApiBody, ApiConsumes, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { RoleCode } from '@fiscaliza/database';
import { DocumentProcessingError } from '@fiscaliza/document-processing';
import type { AuthenticatedUser } from '@fiscaliza/shared';
import type { Request, Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ListDocumentsDto } from './dto/list-documents.dto';
import { DocumentsService } from './documents.service';

@ApiTags('documents')
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Post()
  @Roles(RoleCode.ADMIN, RoleCode.SECRETARIAT)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiAcceptedResponse({ description: 'Documento aceito em quarentena para processamento.' })
  async upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request & { id?: string },
    @Res({ passthrough: true }) response: Response,
  ) {
    if (!file) throw new BadRequestException('Envie um PDF no campo file.');
    try {
      const result = await this.documents.ingestUpload(file, user.id, request.id);
      response.status(result.duplicate ? HttpStatus.OK : HttpStatus.ACCEPTED);
      return result;
    } catch (error) {
      if (error instanceof DocumentProcessingError) throw documentHttpException(error);
      throw error;
    } finally {
      await unlink(file.path).catch(() => undefined);
    }
  }

  @Get()
  @Roles(RoleCode.ADMIN, RoleCode.SECRETARIAT, RoleCode.AUDITOR)
  list(@Query() query: ListDocumentsDto) {
    return this.documents.list(query);
  }

  @Get(':id')
  @Roles(RoleCode.ADMIN, RoleCode.SECRETARIAT, RoleCode.AUDITOR)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.documents.get(id);
  }

  @Get(':id/pages')
  @Roles(RoleCode.ADMIN, RoleCode.SECRETARIAT, RoleCode.AUDITOR)
  pages(@Param('id', ParseUUIDPipe) id: string) {
    return this.documents.pages(id);
  }

  @Get(':id/pages/:pageNumber')
  @Roles(RoleCode.ADMIN, RoleCode.SECRETARIAT, RoleCode.AUDITOR)
  page(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('pageNumber', new ParseIntPipe({ optional: false })) pageNumber: number,
  ) {
    return this.documents.page(id, pageNumber);
  }

  @Post(':id/reprocess')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiAcceptedResponse({ description: 'Reprocessamento aceito e enfileirado.' })
  @Roles(RoleCode.ADMIN, RoleCode.SECRETARIAT)
  reprocess(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request & { id?: string },
  ) {
    return this.documents.reprocess(id, user.id, request.id);
  }

  @Get(':id/download')
  @Roles(RoleCode.ADMIN, RoleCode.SECRETARIAT, RoleCode.AUDITOR)
  @ApiOkResponse({ description: 'URL assinada curta para o original aprovado pelo scanner.' })
  download(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request & { id?: string },
  ) {
    return this.documents.download(id, user.id, request.id);
  }
}

function documentHttpException(error: DocumentProcessingError): HttpException {
  const status =
    error.code === 'DOCUMENT_TOO_LARGE'
      ? HttpStatus.PAYLOAD_TOO_LARGE
      : error.code === 'DOCUMENT_DUPLICATE'
        ? HttpStatus.CONFLICT
        : HttpStatus.BAD_REQUEST;
  return new HttpException(
    { statusCode: status, message: error.message, code: error.code },
    status,
  );
}
