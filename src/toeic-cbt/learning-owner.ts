import type {Queryable} from '../db/db.service';
/** One explicitly published content owner. The authenticated viewer still owns every submitted answer. */
export async function learningOwner(q:Queryable,viewer:string):Promise<string>{
 return (await q.query<{owner_id:string}>('SELECT owner_id FROM hanq.toeic_member_notebook WHERE singleton=true')).rows[0]?.owner_id||viewer;
}
