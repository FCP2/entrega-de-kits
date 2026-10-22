const pool = require('./db');
const eventSlug = process.env.KIT_EVENT_SLUG || 'voces-que-corren-2026';

function normalizeSearch(input) {
  const value = String(input || '').trim().replace(/\s+/g, ' ');
  const folioInQr = value.match(/VC-\d{4}-\d{1,8}/i);
  return folioInQr ? folioInQr[0].toUpperCase() : value;
}

function normalizeName(input) {
  return input.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

async function summary() {
  const result = await pool.query(`
    SELECT
      COUNT(*)::integer AS confirmados,
      COUNT(k.registro_id)::integer AS entregados,
      COALESCE((
        SELECT SUM(ce.capacidad)::integer
        FROM cupos_evento ce
        JOIN eventos cupo_evento ON cupo_evento.id = ce.evento_id
        WHERE cupo_evento.slug = $1 AND ce.activo = TRUE
          AND ce.categoria IN ('femenil', 'varonil')
      ), 0) AS capacidad
    FROM registros r
    JOIN eventos e ON e.id = r.evento_id AND e.slug = $1
    LEFT JOIN entregas_kits k ON k.registro_id = r.id
    WHERE r.estatus = 'confirmado' AND r.folio IS NOT NULL
  `, [eventSlug]);
  return result.rows[0];
}

async function search(input) {
  const query = normalizeSearch(input);
  const normalizedName = normalizeName(query);
  const result = await pool.query(`
    SELECT r.id AS registro_id, r.folio, r.talla,
      CONCAT_WS(' ', p.nombres, p.apellido_paterno, p.apellido_materno) AS nombre,
      p.categoria_competencia, p.es_menor_edad,
      k.entregado_at, k.entregado_por
    FROM registros r
    JOIN eventos e ON e.id = r.evento_id AND e.slug = $1
    JOIN participantes p ON p.id = r.participante_id
    LEFT JOIN entregas_kits k ON k.registro_id = r.id
    WHERE r.estatus = 'confirmado' AND r.folio IS NOT NULL
      AND (UPPER(r.folio) = UPPER($2) OR
        TRANSLATE(LOWER(CONCAT_WS(' ', p.nombres, p.apellido_paterno, p.apellido_materno)),
          'áéíóúüñ', 'aeiouun') LIKE $3 ESCAPE '\\')
    ORDER BY CASE WHEN UPPER(r.folio) = UPPER($2) THEN 0 ELSE 1 END,
      r.folio
    LIMIT 15
  `, [eventSlug, query, `%${normalizedName.replace(/[\\%_]/g, '\\$&')}%`]);
  return result.rows;
}

async function deliver(registroId, operator) {
  const inserted = await pool.query(`
    INSERT INTO entregas_kits (registro_id, entregado_por)
    SELECT r.id, $2
    FROM registros r
    JOIN eventos e ON e.id = r.evento_id AND e.slug = $3
    WHERE r.id = $1 AND r.estatus = 'confirmado' AND r.folio IS NOT NULL
    ON CONFLICT (registro_id) DO NOTHING
    RETURNING registro_id, entregado_at, entregado_por
  `, [registroId, operator, eventSlug]);
  if (inserted.rows[0]) return { status: 'delivered', ...inserted.rows[0] };

  const current = await pool.query(`
    SELECT r.id, r.estatus, r.folio, k.entregado_at, k.entregado_por
    FROM registros r
    JOIN eventos e ON e.id = r.evento_id AND e.slug = $2
    LEFT JOIN entregas_kits k ON k.registro_id = r.id
    WHERE r.id = $1
  `, [registroId, eventSlug]);
  const row = current.rows[0];
  if (row?.entregado_at) return { status: 'already_delivered', ...row };
  return { status: 'not_confirmed' };
}

module.exports = { normalizeSearch, summary, search, deliver };
