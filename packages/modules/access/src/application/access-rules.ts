import {
  actorRef,
  ConflictError,
  ForbiddenError,
  hasMapRole,
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
  type MapRole,
  type UnitOfWork,
} from '@darkbeacon/core';
import {
  MANAGER_ASSIGNABLE_ROLES,
  type AccessRuleDto,
  type AccessSubjectKind,
  type CopyAccessRulesResultDto,
  type CreateAccessRuleRequest,
  type EventPayloads,
  type StarterAccessRule,
} from '@darkbeacon/shared';
import { parseSubject, subjectKey, toAccessRuleDto, type AccessRule } from '../domain/access-rule.js';
import type { AccessRuleRepository } from '../ports/access-rule-repository.js';
import type {
  AccessSubjectDirectory,
  AccessSubjectsSource,
  SubjectDescription,
} from '../ports/access-subjects.js';

export interface AccessRulesDeps {
  rules: AccessRuleRepository;
  access: MapAccess;
  uow: UnitOfWork;
  events: EventLog;
  clock: Clock;
  /** Names for the rules list; without it subjects stay undescribed. */
  directory?: AccessSubjectDirectory;
  /** Who the caller is matched by, to check a starter rule names their own group. */
  subjects?: AccessSubjectsSource;
}

/** A rule as it travels between maps (copy, duplicate, export): its subject and role. */
export interface PortableAccessRule {
  subjectKind: AccessSubjectKind;
  subjectId: string;
  guildId: string | null;
  role: MapRole;
}

type RuleEvent = 'access.rule_added' | 'access.rule_removed' | 'access.rule_changed';

/** True for the roles a map manager may give, change and take away. */
export function managerMayAssign(role: MapRole): boolean {
  return (MANAGER_ASSIGNABLE_ROLES as readonly MapRole[]).includes(role);
}

/**
 * Managing the access rules of a map. Admins manage every rule; managers, as in Wanderer, manage
 * the viewer, member and blocked rules but cannot create, change or remove admins and managers.
 */
export class AccessRules {
  constructor(private readonly deps: AccessRulesDeps) {}

  async list(actor: Actor | null, mapId: string): Promise<AccessRuleDto[]> {
    await requireMapRole(this.deps.access, actor, mapId, 'manager');
    return this.described((await this.deps.rules.listForMap(mapId)).map(toAccessRuleDto));
  }

  /** Fills in `subject` (names) where the directory knows them; a failing lookup leaves them out. */
  private async described(rules: AccessRuleDto[]): Promise<AccessRuleDto[]> {
    if (!this.deps.directory || rules.length === 0) return rules;
    const names = await this.deps.directory
      .describe(rules.map((r) => ({ kind: r.subjectKind, id: r.subjectId, guildId: r.guildId })))
      .catch(() => new Map<string, SubjectDescription>());
    return rules.map((r) => ({ ...r, subject: names.get(subjectKey(r.subjectKind, r.subjectId)) ?? null }));
  }

  /** Throws unless the actor may give or take `roles` on the map (admin: any; manager: some). */
  private async requireAssign(actor: Actor | null, mapId: string, ...roles: MapRole[]): Promise<Actor> {
    const own = await requireMapRole(this.deps.access, actor, mapId, 'manager');
    if (!hasMapRole(own, 'admin') && !roles.every(managerMayAssign)) {
      throw new ForbiddenError('Managers can only give, change and take away viewer, member and blocked');
    }
    return actor!;
  }

  async add(actor: Actor | null, mapId: string, request: CreateAccessRuleRequest): Promise<AccessRuleDto> {
    const author = await this.requireAssign(actor, mapId, request.role);
    const subject = parseSubject(request);
    if (!subject.ok) {
      throw new ValidationError(`Invalid subject: ${subject.error}`);
    }
    return this.deps.uow
      .transaction(async () => {
        const existing = await this.deps.rules.listForMap(mapId);
        if (
          existing.some(
            (r) => r.subjectKind === request.subjectKind && r.subjectId === subject.value.subjectId,
          )
        ) {
          throw new ConflictError('This map already has a rule for that subject; change its role instead');
        }
        return this.insert(author, mapId, {
          subjectKind: request.subjectKind,
          ...subject.value,
          role: request.role,
        });
      })
      .then(async (dto) => (await this.described([dto]))[0]!);
  }

  /** Changes the role of a rule in place (its subject stays). */
  async update(actor: Actor | null, mapId: string, ruleId: string, role: MapRole): Promise<AccessRuleDto> {
    const rule = await this.deps.rules.findById(ruleId);
    // Not found before forbidden would leak nothing: the map check comes first either way.
    await requireMapRole(this.deps.access, actor, mapId, 'manager');
    if (rule?.mapId !== mapId) throw new NotFoundError('Access rule');
    const author = await this.requireAssign(actor, mapId, rule.role, role);
    return this.deps.uow
      .transaction(async () => {
        const current = await this.deps.rules.findById(ruleId);
        if (current?.mapId !== mapId) throw new NotFoundError('Access rule');
        if (current.role === role) return toAccessRuleDto(current);
        await this.deps.rules.updateRole(ruleId, role);
        const dto = toAccessRuleDto({ ...current, role });
        await this.append(author, mapId, 'access.rule_changed', dto, toAccessRuleDto(current));
        return dto;
      })
      .then(async (dto) => (await this.described([dto]))[0]!);
  }

  async remove(actor: Actor | null, mapId: string, ruleId: string): Promise<void> {
    await requireMapRole(this.deps.access, actor, mapId, 'manager');
    const found = await this.deps.rules.findById(ruleId);
    if (found?.mapId !== mapId) throw new NotFoundError('Access rule');
    const author = await this.requireAssign(actor, mapId, found.role);
    await this.deps.uow.transaction(async () => {
      const rule = await this.deps.rules.findById(ruleId);
      if (rule?.mapId !== mapId) throw new NotFoundError('Access rule');
      await this.deps.rules.delete(ruleId);
      await this.append(author, mapId, 'access.rule_removed', { id: ruleId }, toAccessRuleDto(rule));
    });
  }

  /**
   * Copies the rules of another map into this one (Wanderer's reusable access lists, done as a
   * copy: rules stay per map). Needs admin here and at least manager there (who can read them).
   */
  async copyFrom(
    actor: Actor | null,
    mapId: string,
    fromMapId: string,
    overwrite = false,
  ): Promise<CopyAccessRulesResultDto> {
    await requireMapRole(this.deps.access, actor, mapId, 'admin');
    await requireMapRole(this.deps.access, actor, fromMapId, 'manager');
    if (fromMapId === mapId) throw new ValidationError('Pick another map to copy the rules from');
    const source = await this.deps.rules.listForMap(fromMapId);
    return this.merge(actor!, mapId, source, overwrite);
  }

  /** The rules of a map as they travel in an export (map admins). */
  async exportRules(actor: Actor | null, mapId: string): Promise<PortableAccessRule[]> {
    await requireMapRole(this.deps.access, actor, mapId, 'admin');
    return (await this.deps.rules.listForMap(mapId)).map(portable);
  }

  /**
   * Adds rules from an export or another map (map admins). Each subject is checked like a new
   * rule; one that is not valid fails the whole import.
   */
  async importRules(
    actor: Actor | null,
    mapId: string,
    rules: readonly PortableAccessRule[],
    overwrite = false,
  ): Promise<CopyAccessRulesResultDto> {
    await requireMapRole(this.deps.access, actor, mapId, 'admin');
    return this.merge(actor!, mapId, rules, overwrite);
  }

  /**
   * The rule made with a new map: the creator's own corporation or alliance (one of their
   * characters'), as member or viewer. Runs as the creator, who owns the map.
   */
  async addStarter(actor: Actor | null, mapId: string, starter: StarterAccessRule): Promise<AccessRuleDto> {
    const author = await this.requireAssign(actor, mapId, 'admin');
    if (author.kind !== 'account' || !this.deps.subjects) throw new ForbiddenError();
    const mine = await this.deps.subjects.subjectsOf(author.id);
    const ids = starter.subjectKind === 'corporation' ? mine.corporationIds : mine.allianceIds;
    if (!ids.some((id) => String(id) === starter.subjectId)) {
      throw new ValidationError(`The starter rule must name your own ${starter.subjectKind}`);
    }
    return this.add(author, mapId, { ...starter, guildId: null });
  }

  private async merge(
    author: Actor,
    mapId: string,
    incoming: readonly PortableAccessRule[],
    overwrite: boolean,
  ): Promise<CopyAccessRulesResultDto> {
    const checked = incoming.map((rule) => {
      const subject = parseSubject(rule);
      if (!subject.ok)
        throw new ValidationError(`Invalid subject ${rule.subjectKind} ${rule.subjectId}: ${subject.error}`);
      return { subjectKind: rule.subjectKind, ...subject.value, role: rule.role };
    });
    return this.deps.uow.transaction(async () => {
      const result = { added: 0, updated: 0, skipped: 0 };
      const existing = await this.deps.rules.listForMap(mapId);
      const seen = new Set<string>();
      for (const rule of checked) {
        const key = subjectKey(rule.subjectKind, rule.subjectId);
        if (seen.has(key)) continue;
        seen.add(key);
        const current = existing.find((r) => subjectKey(r.subjectKind, r.subjectId) === key);
        if (!current) {
          await this.insert(author, mapId, rule);
          result.added++;
        } else if (overwrite && current.role !== rule.role) {
          await this.deps.rules.updateRole(current.id, rule.role);
          await this.append(
            author,
            mapId,
            'access.rule_changed',
            toAccessRuleDto({ ...current, role: rule.role }),
            toAccessRuleDto(current),
          );
          result.updated++;
        } else result.skipped++;
      }
      return result;
    });
  }

  private async insert(author: Actor, mapId: string, subject: PortableAccessRule): Promise<AccessRuleDto> {
    const rule: AccessRule = {
      id: newId(),
      mapId,
      ...subject,
      createdAt: this.deps.clock.now(),
      createdBy: author.id,
    };
    await this.deps.rules.insert(rule);
    const dto = toAccessRuleDto(rule);
    await this.append(author, mapId, 'access.rule_added', dto);
    return dto;
  }

  /** Drops the rules of a deleted map (a reaction to `map.removed`, no authorization). */
  async forgetMap(mapId: string): Promise<void> {
    await this.deps.uow.transaction(async () => {
      for (const rule of await this.deps.rules.listForMap(mapId)) await this.deps.rules.delete(rule.id);
    });
  }

  private async append<K extends RuleEvent>(
    actor: Actor,
    mapId: string,
    type: K,
    data: EventPayloads[K],
    before?: AccessRuleDto,
  ): Promise<void> {
    await this.deps.events.append([
      newEvent({
        stream: mapStream(mapId),
        type,
        actor: actorRef(actor),
        data,
        occurredAt: this.deps.clock.now(),
        ...(before ? { before } : {}),
      }),
    ]);
  }
}

function portable(rule: AccessRule): PortableAccessRule {
  return { subjectKind: rule.subjectKind, subjectId: rule.subjectId, guildId: rule.guildId, role: rule.role };
}
