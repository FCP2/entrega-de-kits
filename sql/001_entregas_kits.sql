-- Ejecutar una vez en la base del evento. No altera registros ni participantes.
-- La aplicación solo inserta en esta tabla y consulta las tablas existentes.
BEGIN;

CREATE TABLE IF NOT EXISTS entregas_kits (
  id BIGSERIAL PRIMARY KEY,
  registro_id BIGINT NOT NULL UNIQUE,
  entregado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  entregado_por VARCHAR(80) NOT NULL CHECK (LENGTH(TRIM(entregado_por)) BETWEEN 2 AND 80)
);

CREATE INDEX IF NOT EXISTS idx_entregas_kits_entregado_at
  ON entregas_kits (entregado_at DESC);

COMMENT ON TABLE entregas_kits IS
  'Control de kits entregados. Una fila por registro confirmado; sin cambios a registros o participantes.';

COMMIT;
