CREATE TABLE IF NOT EXISTS public.meeting_vote_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  documents JSONB NOT NULL DEFAULT '[]'::jsonb,
  votes JSONB NOT NULL DEFAULT '{}'::jsonb,
  current_doc_id TEXT,
  templates JSONB NOT NULL DEFAULT '[]'::jsonb,
  version BIGINT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.meeting_vote_state
  ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS public.meeting_vote_voters (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  pin_salt TEXT NOT NULL,
  pin_hash TEXT NOT NULL
);

ALTER TABLE public.meeting_vote_voters
  ADD COLUMN IF NOT EXISTS pin_salt TEXT NOT NULL DEFAULT '';

ALTER TABLE public.meeting_vote_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_vote_voters ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.meeting_vote_state FROM anon, authenticated;
REVOKE ALL ON TABLE public.meeting_vote_voters FROM anon, authenticated;
GRANT ALL ON TABLE public.meeting_vote_state TO service_role;
GRANT ALL ON TABLE public.meeting_vote_voters TO service_role;

INSERT INTO public.meeting_vote_state (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;