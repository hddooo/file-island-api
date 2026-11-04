import { SourceBlankProgressService } from './source-blank-progress';
import { Module } from '@nestjs/common';
import { TextbookController } from './textbook.controller';
import { TextbookMemberGuard } from './textbook-member.guard';
import { TextbookService } from './textbook.service';
import { JoseonScriptController, ScriptHeadersGuard } from './joseon-script.controller';
import { JoseonScriptService } from './joseon-script.service';

@Module({ controllers: [TextbookController, JoseonScriptController], providers: [TextbookMemberGuard, TextbookService, SourceBlankProgressService, JoseonScriptService, ScriptHeadersGuard] })
export class TextbookModule {}
