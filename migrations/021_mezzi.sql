-- Parco mezzi aziendale: categorie, anagrafica dei mezzi con QR code, scadenze (assicurazione, bollo, revisione,
-- tagliando…) con promemoria, manutenzioni, costi (carburante, pedaggi, multe…), prenotazioni per categoria con
-- approvazione dei gestori, ritiro e riconsegna (storico di chi ha usato il mezzo, km) e segnalazioni dal QR,
-- che diventano ticket assegnati ai gestori.

-- Categorie (le decide l'azienda: auto, furgoni, mezzi d'opera…). Chi prenota chiede una categoria, non un mezzo.
CREATE TABLE vehicle_categories (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  position    INTEGER NOT NULL DEFAULT 0,
  archived    BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX vehicle_categories_name_uq ON vehicle_categories (lower(name));

-- Gestori del parco: approvano le prenotazioni, assegnano il mezzo, ricevono segnalazioni e scadenze.
CREATE TABLE fleet_managers (
  user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  added_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  added_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE vehicles (
  id              SERIAL PRIMARY KEY,
  category_id     INTEGER NOT NULL REFERENCES vehicle_categories(id),
  code            TEXT NOT NULL,                       -- codice interno, stampato sull'etichetta (es. AUTO-01)
  plate           TEXT,                                -- targa (i mezzi d'opera possono non averla)
  qr_token        TEXT NOT NULL,                       -- parte casuale del link del QR code
  make            TEXT NOT NULL DEFAULT '',
  model           TEXT NOT NULL DEFAULT '',
  year            INTEGER CHECK (year IS NULL OR year BETWEEN 1950 AND 2100),
  fuel            TEXT NOT NULL DEFAULT '' ,           -- benzina, diesel, ibrido, elettrico, gpl, metano…
  seats           INTEGER CHECK (seats IS NULL OR seats BETWEEN 1 AND 99),
  vin             TEXT NOT NULL DEFAULT '',            -- numero di telaio
  ownership       TEXT NOT NULL DEFAULT 'proprieta' CHECK (ownership IN ('proprieta', 'noleggio', 'leasing', 'comodato')),
  lessor          TEXT NOT NULL DEFAULT '',            -- società di noleggio o leasing
  contract_end    DATE,
  location        TEXT NOT NULL DEFAULT '',            -- sede o parcheggio abituale
  km              INTEGER CHECK (km IS NULL OR km >= 0),
  km_at           TIMESTAMPTZ,
  fuel_card       TEXT NOT NULL DEFAULT '',
  telepass        TEXT NOT NULL DEFAULT '',
  assigned_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,  -- assegnazione fissa (auto aziendale di una persona)
  status          TEXT NOT NULL DEFAULT 'attivo' CHECK (status IN ('attivo', 'fuori_servizio', 'dismesso')),
  status_note     TEXT NOT NULL DEFAULT '',
  photo_media_id  INTEGER REFERENCES media(id) ON DELETE SET NULL,
  notes           TEXT NOT NULL DEFAULT '',
  created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX vehicles_code_uq ON vehicles (lower(code));
CREATE UNIQUE INDEX vehicles_plate_uq ON vehicles (upper(plate)) WHERE plate IS NOT NULL AND plate <> '';
CREATE UNIQUE INDEX vehicles_qr_uq ON vehicles (qr_token);
CREATE INDEX vehicles_category ON vehicles (category_id);

-- Scadenze del mezzo, ognuna con i suoi promemoria (giorni prima). Fatta → si propone la successiva.
CREATE TABLE vehicle_deadlines (
  id           SERIAL PRIMARY KEY,
  vehicle_id   INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('assicurazione', 'bollo', 'revisione', 'tagliando', 'gomme', 'noleggio', 'tachigrafo', 'altro')),
  label        TEXT NOT NULL DEFAULT '',
  due_date     DATE,
  due_km       INTEGER CHECK (due_km IS NULL OR due_km >= 0),   -- es. tagliando ogni 30.000 km
  remind_days  INTEGER[] NOT NULL DEFAULT '{30,7,1}',
  repeat_months INTEGER CHECK (repeat_months IS NULL OR repeat_months BETWEEN 1 AND 120), -- per proporre la prossima
  done_at      TIMESTAMPTZ,
  done_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  notes        TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (due_date IS NOT NULL OR due_km IS NOT NULL)
);
CREATE INDEX vehicle_deadlines_open ON vehicle_deadlines (due_date) WHERE done_at IS NULL;

-- Manutenzioni: in officina dal/al (mentre è aperta il mezzo non è prenotabile), costo, officina, km.
CREATE TABLE vehicle_maintenance (
  id           SERIAL PRIMARY KEY,
  vehicle_id   INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('tagliando', 'riparazione', 'gomme', 'carrozzeria', 'revisione', 'altro')),
  start_date   DATE NOT NULL,
  end_date     DATE,                                   -- NULL = ancora in officina
  km           INTEGER CHECK (km IS NULL OR km >= 0),
  supplier     TEXT NOT NULL DEFAULT '',               -- officina, gommista, carrozzeria
  cost         NUMERIC(10, 2) CHECK (cost IS NULL OR cost >= 0),
  description  TEXT NOT NULL DEFAULT '',
  deadline_id  INTEGER REFERENCES vehicle_deadlines(id) ON DELETE SET NULL,
  ticket_id    INTEGER REFERENCES tickets(id) ON DELETE SET NULL,   -- la segnalazione da cui nasce
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR end_date >= start_date)
);
CREATE INDEX vehicle_maintenance_vehicle ON vehicle_maintenance (vehicle_id, start_date DESC);

-- Prenotazioni: si chiede una categoria (con note), il gestore approva e sceglie il mezzo.
-- richiesta → approvata (con mezzo) → in_corso (ritirato) → conclusa (riconsegnato); oppure rifiutata / annullata.
CREATE TABLE vehicle_bookings (
  id            SERIAL PRIMARY KEY,
  requester_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id   INTEGER NOT NULL REFERENCES vehicle_categories(id),
  vehicle_id    INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
  start_at      TIMESTAMPTZ NOT NULL,
  end_at        TIMESTAMPTZ NOT NULL,
  purpose       TEXT NOT NULL DEFAULT '',              -- motivo
  destination   TEXT NOT NULL DEFAULT '',
  notes         TEXT NOT NULL DEFAULT '',              -- note di chi chiede (es. «serve il gancio traino»)
  project_id    INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  status        TEXT NOT NULL DEFAULT 'richiesta' CHECK (status IN ('richiesta', 'approvata', 'rifiutata', 'annullata', 'in_corso', 'conclusa')),
  decided_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  decided_at    TIMESTAMPTZ,
  decision_note TEXT NOT NULL DEFAULT '',
  picked_up_at  TIMESTAMPTZ,
  pickup_km     INTEGER CHECK (pickup_km IS NULL OR pickup_km >= 0),
  pickup_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  returned_at   TIMESTAMPTZ,
  return_km     INTEGER CHECK (return_km IS NULL OR return_km >= 0),
  return_fuel   TEXT NOT NULL DEFAULT '',              -- livello carburante/carica alla riconsegna
  return_notes  TEXT NOT NULL DEFAULT '',              -- danni, pulizia, problemi
  walk_in       BOOLEAN NOT NULL DEFAULT false,        -- uso registrato dal gestore senza richiesta
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_at > start_at),
  CHECK (status NOT IN ('approvata', 'in_corso', 'conclusa') OR vehicle_id IS NOT NULL)
);
CREATE INDEX vehicle_bookings_vehicle ON vehicle_bookings (vehicle_id, start_at);
CREATE INDEX vehicle_bookings_requester ON vehicle_bookings (requester_id, start_at DESC);
CREATE INDEX vehicle_bookings_status ON vehicle_bookings (status);

-- Costi del mezzo: carburante, pedaggi, multe, lavaggi… (le manutenzioni hanno il loro costo).
-- Per una multa si salva l'ora: lo storico dice chi aveva il mezzo.
CREATE TABLE vehicle_costs (
  id           SERIAL PRIMARY KEY,
  vehicle_id   INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('carburante', 'pedaggio', 'multa', 'assicurazione', 'bollo', 'noleggio', 'lavaggio', 'parcheggio', 'altro')),
  occurred_at  TIMESTAMPTZ NOT NULL,
  amount       NUMERIC(10, 2) NOT NULL CHECK (amount >= 0),
  km           INTEGER CHECK (km IS NULL OR km >= 0),
  liters       NUMERIC(8, 2) CHECK (liters IS NULL OR liters >= 0),
  driver_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,   -- per le multe: chi guidava
  booking_id   INTEGER REFERENCES vehicle_bookings(id) ON DELETE SET NULL,
  description  TEXT NOT NULL DEFAULT '',
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX vehicle_costs_vehicle ON vehicle_costs (vehicle_id, occurred_at DESC);

-- Segnalazioni dal QR code: sono ticket (come le RDA), legati al mezzo.
ALTER TABLE tickets ADD COLUMN vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE SET NULL;
CREATE INDEX tickets_vehicle ON tickets (vehicle_id) WHERE vehicle_id IS NOT NULL;

-- Promemoria già mandati (uno per chiave: scadenza+giorni, prenotazione+tipo…), così non si ripetono.
CREATE TABLE fleet_reminder_log (
  key      TEXT PRIMARY KEY,
  sent_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Notifiche del parco mezzi: testo e link già pronti (prenotazioni, riconsegne, scadenze, segnalazioni).
ALTER TABLE notifications ADD COLUMN body TEXT;
ALTER TABLE notifications ADD COLUMN link TEXT;
ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('like', 'comment', 'reply', 'mention', 'comment_like', 'pin', 'note_mention', 'rda_new', 'rda_accepted', 'rda_rejected',
                  'due_tomorrow', 'overdue_project', 'software_proposal', 'mezzi'));
