-- Retain access to existing mixed-era catalog notes alongside era cards.
ALTER TABLE hanq.replays DROP CONSTRAINT replays_part_check;
ALTER TABLE hanq.replays ADD CONSTRAINT replays_part_check CHECK(part IN('ancient','prehistory','gojoseon','samguk','nambuk','goryeo','joseon','joseon-early','joseon-late','opening','colonial','modern','islands','comprehensive'));
