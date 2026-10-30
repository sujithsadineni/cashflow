-- ===========================================================
-- cashflow :: migration 050 — questions asked of the assistant (D332)
--
-- The owner asks money questions in words from the corner panel, and
-- wants every one kept with the time it was asked. Some are answered on
-- the spot (on this computer, or by Claude when asked: steps 3 and 4);
-- others are saved for Claude Code, which answers them in a later session
-- at no cost and writes the answer back here to be read in the panel.
--
-- seen_at: when the person opened an answer, so the corner button can
-- say an answer is waiting. Never deleted: a question no longer wanted
-- is dismissed (dismissed_at) and audited.
-- ===========================================================

BEGIN;

CREATE TABLE assistant_question (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  question      TEXT NOT NULL CHECK (char_length(btrim(question)) BETWEEN 1 AND 500),
  asked_via     TEXT NOT NULL CHECK (asked_via IN ('local', 'claude', 'claude_code')),
  status        TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'answered', 'dismissed')),
  answer        TEXT CHECK (char_length(answer) <= 20000),
  answered_by   TEXT CHECK (answered_by IN ('local', 'claude', 'claude_code')),
  asked_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  answered_at   TIMESTAMPTZ,
  seen_at       TIMESTAMPTZ,
  dismissed_at  TIMESTAMPTZ,
  -- An answer comes with who gave it and when; a waiting question has none.
  CHECK ((answer IS NULL) = (answered_at IS NULL) AND (answer IS NULL) = (answered_by IS NULL)),
  CHECK (status <> 'answered' OR answer IS NOT NULL),
  CHECK ((status = 'dismissed') = (dismissed_at IS NOT NULL))
);

CREATE INDEX assistant_question_asked ON assistant_question (asked_at DESC);

COMMIT;
