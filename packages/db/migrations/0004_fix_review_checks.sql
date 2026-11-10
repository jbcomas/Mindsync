-- 0004: los CHECK de 0003 dejaban pasar NULL (reviewed_by_kind = 'user' es NULL cuando la columna es NULL, y un CHECK
-- acepta NULL). Se compara con coalesce para que "sin revisar por un usuario" sea FALSE.
ALTER TABLE entities DROP CONSTRAINT review_requires_user;
ALTER TABLE entities ADD CONSTRAINT review_requires_user CHECK (
  (validation_state = 'unreviewed' AND epistemic_status <> 'decision_confirmed') OR coalesce(reviewed_by_kind, '') = 'user');
ALTER TABLE relations DROP CONSTRAINT relation_review_requires_user;
ALTER TABLE relations ADD CONSTRAINT relation_review_requires_user CHECK (
  validation_state = 'unreviewed' OR coalesce(reviewed_by_kind, '') = 'user');
