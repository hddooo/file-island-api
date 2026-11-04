import { SourceBlankProgressService } from './source-blank-progress';
import { Module } from '@nestjs/common';
import { TextbookController } from './textbook.controller';
import { TextbookMemberGuard } from './textbook-member.guard';
import { TextbookService } from './textbook.service';
import { JoseonScriptController, ScriptHeadersGuard } from './joseon-script.controller';
import { JoseonScriptService } from './joseon-script.service';

import { GoryeoScriptController } from './goryeo-script.controller';
import { GoryeoScriptService } from './goryeo-script.service';

import { OpeningScriptController } from './opening-script.controller';
import { OpeningScriptService } from './opening-script.service';

@Module({ controllers: [TextbookController, JoseonScriptController, GoryeoScriptController, OpeningScriptController], providers: [TextbookMemberGuard, TextbookService, SourceBlankProgressService, JoseonScriptService, ScriptHeadersGuard, GoryeoScriptService, OpeningScriptService] })
export class TextbookModule {}
