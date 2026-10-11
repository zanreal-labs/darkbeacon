import {
  actorRef,
  ConflictError,
  mapStream,
  newEvent,
  newId,
  NotFoundError,
  requireMapRole,
  ValidationError,
  type Actor,
  type Clock,
  type EventLog,
  type MapAccess,
  type UnitOfWork,
} from '@wormwright/core';
import type { AccessRuleDto, CreateAccessRuleRequest, EventPayloads } from '@wormwright/shared';
import { parseSubject, toAccessRuleDto, type AccessRule } from '../domain/access-rule.js';
import type { AccessRuleRepository } from '../ports/access-rule-repository.js';

export interface AccessRulesDeps {
  rules: AccessRuleRepository;
  access: MapAccess;
  uow: UnitOfWork;
  events: EventLog;
  clock: Clock;
}

/** Managing the access rules of a map (map admins only). */
export class AccessRules {
  constructor(private readonly deps: AccessRulesDeps) {}

  async list(actor: Actor | null, mapId: string): Promise<AccessRuleDto[]> {
    await requireMapRole(this.deps.access, actor, mapId, 'admin');
    return (await this.deps.rules.listForMap(mapId)).map(toAccessRuleDto);
  }

  async add(actor: Actor | null, mapId: string, request: CreateAccessRuleRequest): Promise<AccessRuleDto> {
    await requireMapRole(this.deps.access, actor, mapId, 'admin');
    const subject = parseSubject(request);
    if (!subject.ok) {
      throw new ValidationError(`Invalid subject: ${subject.error}`);
    }
    const author = actor!;
    return this.deps.uow.transaction(async () => {
      const existing = await this.deps.rules.listForMap(mapId);
      if (
        existing.some((r) => r.subjectKind === request.subjectKind && r.subjectId === subject.value.subjectId)
      ) {
        throw new ConflictError('This map already has a rule for that subject; remove it first');
      }
      const rule: AccessRule = {
        id: newId(),
        mapId,
        subjectKind: request.subjectKind,
        ...subject.value,
        role: request.role,
        createdAt: this.deps.clock.now(),
        createdBy: author.id,
      };
      await this.deps.rules.insert(rule);
      const dto = toAccessRuleDto(rule);
      await this.append(author, mapId, 'access.rule_added', dto);
      return dto;
    });
  }

  async remove(actor: Actor | null, mapId: string, ruleId: string): Promise<void> {
    await requireMapRole(this.deps.access, actor, mapId, 'admin');
    await this.deps.uow.transaction(async () => {
      const rule = await this.deps.rules.findById(ruleId);
      if (rule?.mapId !== mapId) throw new NotFoundError('Access rule');
      await this.deps.rules.delete(ruleId);
      await this.append(actor!, mapId, 'access.rule_removed', { id: ruleId });
    });
  }

  private async append<K extends 'access.rule_added' | 'access.rule_removed'>(
    actor: Actor,
    mapId: string,
    type: K,
    data: EventPayloads[K],
  ): Promise<void> {
    await this.deps.events.append([
      newEvent({
        stream: mapStream(mapId),
        type,
        actor: actorRef(actor),
        data,
        occurredAt: this.deps.clock.now(),
      }),
    ]);
  }
}
