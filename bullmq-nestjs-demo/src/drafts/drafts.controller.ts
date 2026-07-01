import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { DraftsService } from './drafts.service';
import { CreateDraftDto } from './dto/create-draft.dto';

@Controller('drafts')
export class DraftsController {
  constructor(private readonly draftsService: DraftsService) {}

  /** Accepts a draft request and returns immediately — generation happens off the request thread. */
  @Post()
  create(@Body() dto: CreateDraftDto) {
    return this.draftsService.enqueue(dto);
  }

  /** Clients poll this to find out when generation finishes (or how it failed). */
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.draftsService.findById(id);
  }
}
