-- Full-text search over message text (SQLite FTS5). An *external-content*
-- index: it stores only the search index, reading the text back from
-- `messages` itself, so it costs index space, not a second copy of every
-- message. Three triggers keep it in step with every insert, edit and
-- delete — including deletes cascaded from a removed channel or server.
--
-- `unicode61` with `remove_diacritics` makes "cafe" find "café" and
-- handles non-English text; searching is by whole word (with prefix
-- matching on the last word the user is still typing — see
-- `api::search`).

CREATE VIRTUAL TABLE messages_fts USING fts5(
    content,
    content = 'messages',
    content_rowid = 'id',
    tokenize = 'unicode61 remove_diacritics 2'
);

-- Index everything that already exists.
INSERT INTO messages_fts (messages_fts) VALUES ('rebuild');

CREATE TRIGGER messages_fts_insert AFTER INSERT ON messages BEGIN
    INSERT INTO messages_fts (rowid, content) VALUES (new.id, new.content);
END;

CREATE TRIGGER messages_fts_delete AFTER DELETE ON messages BEGIN
    INSERT INTO messages_fts (messages_fts, rowid, content) VALUES ('delete', old.id, old.content);
END;

CREATE TRIGGER messages_fts_update AFTER UPDATE OF content ON messages BEGIN
    INSERT INTO messages_fts (messages_fts, rowid, content) VALUES ('delete', old.id, old.content);
    INSERT INTO messages_fts (rowid, content) VALUES (new.id, new.content);
END;
