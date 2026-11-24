-- Alma Energy sul CRM centrale, tappa 2 (ALM2-83, tavole «B · Fondi» e «B · Energivori» approvate da Dante il 24/11/2026).
-- - Il radar energia confluisce nel radar centrale: ogni segnale di energy_signals ha il suo gemello in crm_signals
--   (BU energy, settore = tipo del segnale) e le decisioni prese da una parte valgono anche dall'altra.
-- - Due tipi di segnale in più: «fondo» (fondi infrastrutturali che comprano progetti o raccolgono capitali e devono
--   trovare un EPC) ed «energivoro» (aziende che consumano molta energia con un motivo per chiamarle adesso).
-- - Energivori: il motivo per chiamare adesso (dalle notizie) e «non ora» per 30 giorni, sull'elenco del CRM centrale.

ALTER TABLE energy_signals DROP CONSTRAINT IF EXISTS energy_signals_kind_check;
ALTER TABLE energy_signals ADD CONSTRAINT energy_signals_kind_check
  CHECK (kind IN ('cessione', 'autorizzazione', 'revamping', 'conto_energia', 'asta_fer', 'notizia', 'fondo', 'energivoro'));
ALTER TABLE energy_signals ADD COLUMN IF NOT EXISTS subject_id INTEGER REFERENCES crm_subjects(id) ON DELETE SET NULL;
ALTER TABLE energy_signals ADD COLUMN IF NOT EXISTS crm_signal_id INTEGER REFERENCES crm_signals(id) ON DELETE SET NULL;

ALTER TABLE crm_energivori ADD COLUMN IF NOT EXISTS energy_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE crm_energivori ADD COLUMN IF NOT EXISTS energy_reason_on DATE;
ALTER TABLE crm_energivori ADD COLUMN IF NOT EXISTS energy_reason_url TEXT NOT NULL DEFAULT '';
ALTER TABLE crm_energivori ADD COLUMN IF NOT EXISTS energy_snooze_until DATE;

-- Segnale di Energy → gemello nel radar centrale (nuovo o aggiornato).
CREATE OR REPLACE FUNCTION energy_signals_to_crm() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cid integer;
DECLARE st text := CASE NEW.status WHEN 'preso' THEN 'interessa' WHEN 'scartato' THEN 'scartato' ELSE 'nuovo' END;
DECLARE k text := CASE NEW.kind WHEN 'cessione' THEN 'investimento' WHEN 'fondo' THEN 'investimento' WHEN 'autorizzazione' THEN 'permesso'
                               WHEN 'conto_energia' THEN 'scadenza' WHEN 'revamping' THEN 'scadenza' WHEN 'energivoro' THEN 'cliente' ELSE 'notizia' END;
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  IF NEW.crm_signal_id IS NOT NULL AND EXISTS (SELECT 1 FROM crm_signals WHERE id = NEW.crm_signal_id) THEN
    UPDATE crm_signals SET status = st, discard_reason = NEW.discard_reason, score = NEW.score, subject_id = COALESCE(NEW.subject_id, subject_id),
           decided_by = NEW.decided_by, decided_at = NEW.decided_at
     WHERE id = NEW.crm_signal_id AND (status, discard_reason, score, subject_id) IS DISTINCT FROM (st, NEW.discard_reason, NEW.score, COALESCE(NEW.subject_id, subject_id));
    RETURN NEW;
  END IF;
  INSERT INTO crm_signals (source, external_id, kind, bu, sector, title, summary, why, entity, subject_id, amount, region, place, url,
                           published_on, deadline, score, score_parts, status, discard_reason, cost_eur, created_by)
  VALUES ('energy', 'energy:' || NEW.id, k, 'energy', NEW.kind, NEW.title,
          NEW.summary || CASE WHEN NEW.mw IS NOT NULL THEN ' (' || replace(regexp_replace(NEW.mw::text, '\.?0+$', ''), '.', ',') || ' MW)' ELSE '' END,
          NEW.why, NEW.entity, NEW.subject_id, NEW.amount, NEW.region, NEW.place, NEW.url, NEW.published_on, NEW.deadline,
          NEW.score, NEW.score_parts, st, NEW.discard_reason, NEW.cost_eur, NEW.created_by)
  ON CONFLICT DO NOTHING
  RETURNING id INTO cid;
  IF cid IS NULL THEN SELECT id INTO cid FROM crm_signals WHERE source = 'energy' AND external_id = 'energy:' || NEW.id; END IF;
  UPDATE energy_signals SET crm_signal_id = cid WHERE id = NEW.id;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS energy_signals_to_crm ON energy_signals;
CREATE TRIGGER energy_signals_to_crm AFTER INSERT OR UPDATE ON energy_signals FOR EACH ROW EXECUTE FUNCTION energy_signals_to_crm();

-- Deciso nel radar centrale (scartato, interessa, riaperto) → anche nel radar energia.
CREATE OR REPLACE FUNCTION crm_signals_to_energy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() > 1 OR NEW.source <> 'energy' OR NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  UPDATE energy_signals SET status = CASE NEW.status WHEN 'scartato' THEN 'scartato' WHEN 'nuovo' THEN 'nuovo' ELSE 'preso' END,
         discard_reason = NEW.discard_reason, decided_by = NEW.decided_by, decided_at = NEW.decided_at
   WHERE crm_signal_id = NEW.id;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS crm_signals_to_energy ON crm_signals;
CREATE TRIGGER crm_signals_to_energy AFTER UPDATE ON crm_signals FOR EACH ROW EXECUTE FUNCTION crm_signals_to_energy();

-- I segnali che ci sono già ricevono il loro gemello nel radar centrale.
UPDATE energy_signals SET score = score WHERE crm_signal_id IS NULL;
