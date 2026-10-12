import { json, type Database } from '@darkbeacon/db';
import type { Comment, CommentRepository, Structure, StructureRepository } from '@darkbeacon/mapping';
import type { AuthorDto, StructureOwnerDto } from '@darkbeacon/shared';

/** Comments and structures: what a map knows about its systems beside the notes. */
export interface IntelTables {
  map_comments: {
    id: string;
    map_id: string;
    solar_system_id: number;
    text: string;
    /** JSON `AuthorDto`. */
    author: string | null;
    created_at: number;
  };
  map_structures: {
    id: string;
    map_id: string;
    solar_system_id: number;
    type_id: number | null;
    type_name: string;
    name: string;
    /** JSON `StructureOwnerDto`. */
    owner: string | null;
    status: string;
    ends_at: number | null;
    notes: string;
    created_by: string | null;
    updated_by: string | null;
    created_at: number;
    updated_at: number;
  };
}

type CommentRow = IntelTables['map_comments'];
type StructureRow = IntelTables['map_structures'];

abstract class Repository {
  constructor(private readonly database: Database) {}

  protected get db() {
    return this.database.db<IntelTables>();
  }
}

export class KyselyCommentRepository extends Repository implements CommentRepository {
  async listForSystem(mapId: string, solarSystemId: number): Promise<Comment[]> {
    const rows = await this.db
      .selectFrom('map_comments')
      .selectAll()
      .where('map_id', '=', mapId)
      .where('solar_system_id', '=', solarSystemId)
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .execute();
    return rows.map(commentFromRow);
  }

  async countsForMap(mapId: string): Promise<Map<number, number>> {
    const rows = await this.db
      .selectFrom('map_comments')
      .select(['solar_system_id', (eb) => eb.fn.countAll<number>().as('n')])
      .where('map_id', '=', mapId)
      .groupBy('solar_system_id')
      .execute();
    return new Map(rows.map((r) => [Number(r.solar_system_id), Number(r.n)]));
  }

  async findById(mapId: string, id: string): Promise<Comment | null> {
    const row = await this.db
      .selectFrom('map_comments')
      .selectAll()
      .where('map_id', '=', mapId)
      .where('id', '=', id)
      .executeTakeFirst();
    return row ? commentFromRow(row) : null;
  }

  async insert(comment: Comment): Promise<void> {
    await this.db
      .insertInto('map_comments')
      .values({
        id: comment.id,
        map_id: comment.mapId,
        solar_system_id: comment.solarSystemId,
        text: comment.text,
        author: comment.author ? json.encode(comment.author) : null,
        created_at: comment.createdAt,
      })
      .execute();
  }

  async delete(mapId: string, id: string): Promise<void> {
    await this.db.deleteFrom('map_comments').where('map_id', '=', mapId).where('id', '=', id).execute();
  }
}

export class KyselyStructureRepository extends Repository implements StructureRepository {
  async listForSystem(mapId: string, solarSystemId: number): Promise<Structure[]> {
    const rows = await this.db
      .selectFrom('map_structures')
      .selectAll()
      .where('map_id', '=', mapId)
      .where('solar_system_id', '=', solarSystemId)
      .orderBy('created_at')
      .orderBy('id')
      .execute();
    return rows.map(structureFromRow);
  }

  async listForMap(mapId: string): Promise<Structure[]> {
    const rows = await this.db
      .selectFrom('map_structures')
      .selectAll()
      .where('map_id', '=', mapId)
      .orderBy('created_at')
      .orderBy('id')
      .execute();
    return rows.map(structureFromRow);
  }

  async findById(mapId: string, id: string): Promise<Structure | null> {
    const row = await this.db
      .selectFrom('map_structures')
      .selectAll()
      .where('map_id', '=', mapId)
      .where('id', '=', id)
      .executeTakeFirst();
    return row ? structureFromRow(row) : null;
  }

  async insert(structure: Structure): Promise<void> {
    await this.db.insertInto('map_structures').values(structureToRow(structure)).execute();
  }

  async update(structure: Structure): Promise<void> {
    const { id, map_id, ...row } = structureToRow(structure);
    await this.db
      .updateTable('map_structures')
      .set(row)
      .where('map_id', '=', map_id)
      .where('id', '=', id)
      .execute();
  }

  async delete(mapId: string, id: string): Promise<void> {
    await this.db.deleteFrom('map_structures').where('map_id', '=', mapId).where('id', '=', id).execute();
  }
}

function commentFromRow(row: CommentRow): Comment {
  return {
    id: row.id,
    mapId: row.map_id,
    solarSystemId: Number(row.solar_system_id),
    text: row.text,
    author: json.decode<AuthorDto>(row.author),
    createdAt: Number(row.created_at),
  };
}

function structureToRow(s: Structure): StructureRow {
  return {
    id: s.id,
    map_id: s.mapId,
    solar_system_id: s.solarSystemId,
    type_id: s.typeId,
    type_name: s.typeName,
    name: s.name,
    owner: s.owner ? json.encode(s.owner) : null,
    status: s.status,
    ends_at: s.endsAt,
    notes: s.notes,
    created_by: s.createdBy ? json.encode(s.createdBy) : null,
    updated_by: s.updatedBy ? json.encode(s.updatedBy) : null,
    created_at: s.createdAt,
    updated_at: s.updatedAt,
  };
}

function structureFromRow(row: StructureRow): Structure {
  return {
    id: row.id,
    mapId: row.map_id,
    solarSystemId: Number(row.solar_system_id),
    typeId: row.type_id == null ? null : Number(row.type_id),
    typeName: row.type_name,
    name: row.name,
    owner: json.decode<StructureOwnerDto>(row.owner),
    status: row.status as Structure['status'],
    endsAt: row.ends_at == null ? null : Number(row.ends_at),
    notes: row.notes,
    createdBy: json.decode<AuthorDto>(row.created_by),
    updatedBy: json.decode<AuthorDto>(row.updated_by),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}
