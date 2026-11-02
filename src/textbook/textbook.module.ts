import { SourceBlankProgressService } from './source-blank-progress';
import { Module } from '@nestjs/common';
import { TextbookController } from './textbook.controller';
import { TextbookMemberGuard } from './textbook-member.guard';
import { TextbookService } from './textbook.service';

@Module({ controllers: [TextbookController], providers: [TextbookMemberGuard, TextbookService, SourceBlankProgressService] })
export class TextbookModule {}
