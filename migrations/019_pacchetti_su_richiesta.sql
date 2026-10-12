-- Pacchetti per ruolo: ogni licenza è «di base» (spetta a tutti quelli del ruolo) o «su richiesta» (si dà solo se
-- serve). Nelle proposte quelle su richiesta partono non spuntate; applicando un pacchetto si danno solo quelle di base.
ALTER TABLE software_package_plans ADD COLUMN on_request BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE software_proposal_items ADD COLUMN on_request BOOLEAN NOT NULL DEFAULT false;
