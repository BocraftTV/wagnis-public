CREATE TABLE rooms (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('lobby','playing','finished')),
  state_json TEXT,
  version INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE players (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  seat INTEGER NOT NULL,
  is_host INTEGER NOT NULL DEFAULT 0,
  UNIQUE (room_id, seat)
);
CREATE UNIQUE INDEX players_room_name ON players (room_id, lower(name));
CREATE TABLE schema_meta (version INTEGER NOT NULL);
