import { SourceBlankProgressService } from './source-blank-progress';
import { Module } from '@nestjs/common';
import { TextbookController } from './textbook.controller';
import { TextbookMemberGuard } from './textbook-member.guard';
import { TextbookService } from './textbook.service';
import { JoseonScriptController, ScriptHeadersGuard } from './joseon-script.controller';
import { JoseonScriptService } from './joseon-script.service';

import { GoryeoScriptController } from './goryeo-script.controller';
import { GoryeoScriptService } from './goryeo-script.service';

@Module({ controllers: [TextbookController, JoseonScriptController, GoryeoScriptController], providers: [TextbookMemberGuard, TextbookService, SourceBlankProgressService, JoseonScriptService, ScriptHeadersGuard, GoryeoScriptService] })
export class TextbookModule {}
