export async function writeActivityLog(
  connection,
  { actor, action, entityType, entityId, details = null }
) {
  if (
    !actor ||
    (actor.id !== null && typeof actor.id !== "string" &&
      typeof actor.id !== "number" && typeof actor.id !== "bigint") ||
    typeof actor.role !== "string" ||
    typeof action !== "string" || action.length < 1 || action.length > 100 ||
    typeof entityType !== "string" || entityType.length < 1 || entityType.length > 64 ||
    (typeof entityId !== "string" && typeof entityId !== "number" && typeof entityId !== "bigint")
  ) throw new TypeError("Activity log fields are invalid.");

  const serializedDetails = details === null ? null : JSON.stringify(details);
  if (serializedDetails === undefined) {
    throw new TypeError("Activity log details must be JSON serializable.");
  }
  await connection.execute(
    `INSERT INTO activity_logs (
       actor_user_id, actor_role_code, action, entity_type, entity_id, details, created_at
     ) VALUES (?, ?, ?, ?, ?, CAST(? AS JSON), UTC_TIMESTAMP(6))`,
    [actor.id, actor.role, action, entityType, String(entityId), serializedDetails]
  );
}
