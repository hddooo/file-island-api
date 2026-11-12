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
import { OpeningStructureService } from './opening-structure.service';
import { History81Controller } from './history81.controller';
import { History81Service } from './history81.service';

@Module({ controllers: [TextbookController, JoseonScriptController, GoryeoScriptController, OpeningScriptController, History81Controller], providers: [TextbookMemberGuard, TextbookService, SourceBlankProgressService, JoseonScriptService, ScriptHeadersGuard, GoryeoScriptService, OpeningScriptService, OpeningStructureService, History81Service] })
export class TextbookModule {}
