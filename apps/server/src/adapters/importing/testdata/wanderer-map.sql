-- A Wanderer database for the database import tests, shaped like the real one (our fork's
-- tables, values as the app stores them): the map's own label list (WH-ST, WH1...), statuses
-- in the app's numbering (0 clear, 1 home, 2 friendly, 3 looking for, 4 warning, 5 target,
-- 6 dangerous), labels JSON with a custom label and an empty id (`[""]`), systems taken off
-- the map (visible false) with their intel, custom signatures and anomalies, a deleted
-- signature, structures and comments on a hidden system, passages, ACLs, hubs, a webhook.
-- Times are UTC without a zone, as Wanderer keeps them.

insert into character_v1 (id, eve_id, name, encrypted_access_token, encrypted_refresh_token) values
  ('c0000000-0000-4000-8000-000000000001', '2112625428', 'CCP Bartender', '\x7365637265742d746f6b656e', '\x7365637265742d726566726573680a'),
  ('c0000000-0000-4000-8000-000000000002', '2116161001', 'Scout Alt', null, null);

insert into maps_v1 (id, name, slug, description, scope, scopes, hubs, owner_id, public_api_key, system_labels) values
  ('a0000000-0000-4000-8000-000000000001', 'SHCK-WH', 'shck', 'Our chain', 'wormholes', array['wormholes', 'low'],
   array['31001269', '30000142', '30002187'], 'c0000000-0000-4000-8000-000000000001', 'never-read-key',
   '[{"id":"a","name":"WH-ST","color":"#2d803b"},{"id":"b","name":"WH1","color":"#3d94af"},{"id":"c","name":"WH2","color":"#3d94af"},{"id":"1","name":"WH3","color":"#563daf"},{"id":"2","name":"WH4","color":"#8f3daf"},{"id":"3","name":"WH5","color":"#3d65af"},{"id":"d","name":"WH6","color":"#3d65af"},{"id":"g","name":"WH-HS","color":"#3d65af","description":"exit to high-sec"}]'),
  ('a0000000-0000-4000-8000-000000000002', 'zanreal', 'zanreal', null, 'wormholes', array['wormholes'], array[]::text[],
   'c0000000-0000-4000-8000-000000000001', null, '[{"id":"a","name":"A","color":"#2d803b"}]'),
  ('a0000000-0000-4000-8000-000000000003', 'Old one', 'old-one', null, 'wormholes', array['wormholes'], array[]::text[],
   'c0000000-0000-4000-8000-000000000001', null, '[]');
update maps_v1 set deleted = true where slug = 'old-one';

-- shck: 6 shown systems, 3 hidden (two with intel, one bare)
insert into map_system_v1 (id, map_id, solar_system_id, name, custom_name, description, tag, labels, status, visible, locked, position_x, position_y, temporary_name, inserted_at, updated_at) values
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 31002531, 'Home sweet home', null, 'Our home', 'HQ', '{"customLabel":"HOME","labels":["b"]}', 1, true, true, 0, 0, null, '2026-10-01 10:00:00', '2026-10-10 12:00:00.123456'),
  ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 31000399, 'J130256', null, null, null, '{"customLabel":"","labels":["a","1"]}', 4, true, false, 180, 0, '1a', '2026-10-02 10:00:00', '2026-10-11 12:00:00'),
  ('b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001', 31001924, 'J130026', 'Farm', 'Hostile C5 residents', 'FARM', '{"customLabel":"","labels":[""]}', 6, true, false, 180, 75, null, '2026-10-03 10:00:00', '2026-10-11 13:00:00'),
  ('b0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000001', 30000142, 'Jita', null, null, null, '', 2, true, false, 360, 0, null, '2026-10-04 10:00:00', '2026-10-12 08:00:00'),
  ('b0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000001', 31000005, 'Thera', null, null, null, null, 3, true, false, 360, 75, null, '2026-10-04 10:00:00', '2026-10-12 08:00:00'),
  ('b0000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000001', 30002187, 'Amarr', null, null, null, null, 5, true, false, 540, 0, null, '2026-10-04 10:00:00', '2026-10-12 08:00:00'),
  ('b0000000-0000-4000-8000-000000000007', 'a0000000-0000-4000-8000-000000000001', 31002385, 'Dead end', null, 'Old static, Sansha fleet lives here', 'OLD', '{"customLabel":"OLD","labels":["d",""]}', 6, false, false, 720, 300, null, '2026-09-01 10:00:00', '2026-09-05 10:00:00'),
  ('b0000000-0000-4000-8000-000000000008', 'a0000000-0000-4000-8000-000000000001', 31002404, 'J110834', 'Gas', null, null, '{"customLabel":"","labels":["g"]}', 2, false, false, 900, 300, null, '2026-09-02 10:00:00', '2026-09-03 10:00:00'),
  ('b0000000-0000-4000-8000-000000000009', 'a0000000-0000-4000-8000-000000000001', 31000220, 'J121158', null, null, null, null, 0, false, false, 0, 0, null, '2026-09-02 10:00:00', '2026-09-02 10:00:00'),
  -- zanreal: 3 shown, 1 hidden
  ('b0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000002', 31002531, 'J014348', null, null, null, null, 0, true, false, 0, 0, null, '2026-10-01 10:00:00', '2026-10-01 10:00:00'),
  ('b0000000-0000-4000-8000-000000000012', 'a0000000-0000-4000-8000-000000000002', 30000142, 'Jita', null, null, null, null, 0, true, false, 0, 0, null, '2026-10-01 10:00:00', '2026-10-01 10:00:00'),
  ('b0000000-0000-4000-8000-000000000013', 'a0000000-0000-4000-8000-000000000002', 30000144, 'Perimeter', null, null, null, null, 0, true, false, 0, 0, null, '2026-10-01 10:00:00', '2026-10-01 10:00:00'),
  ('b0000000-0000-4000-8000-000000000014', 'a0000000-0000-4000-8000-000000000002', 31000005, 'Thera', null, null, null, null, 0, false, false, 0, 0, null, '2026-10-01 10:00:00', '2026-10-01 10:00:00');

insert into map_chain_v1 (id, map_id, solar_system_source, solar_system_target, mass_status, time_status, ship_size_type, type, wormhole_type, count_of_passage, locked, custom_info, dangerous, bubbled, locked_at, mass_status_updated_at, inserted_at, updated_at) values
  ('d0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 31002531, 31000399, 1, 4, 2, 0, 'H296', 2, true, 'Rolled once', true, 2, '2026-10-11 09:00:00', '2026-10-11 08:30:00', '2026-10-11 08:00:00', '2026-10-11 09:00:00'),
  ('d0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 31002531, 31001924, 2, 1, 3, 0, null, 0, false, null, false, 0, null, null, '2026-10-11 10:00:00', '2026-10-11 10:30:00'),
  ('d0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001', 31000399, 30000142, 0, 0, 4, 0, null, 0, null, null, false, 3, null, null, '2026-10-12 07:00:00', '2026-10-12 07:00:00'),
  ('d0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000001', 30000142, 30002187, 0, 0, 2, 1, null, 0, null, null, false, 0, null, null, '2026-10-12 07:00:00', '2026-10-12 07:00:00');

insert into map_system_signatures_v1 (id, system_id, eve_id, character_eve_id, name, description, kind, "group", type, custom_info, linked_system_id, temporary_name, deleted, inserted_at, updated_at) values
  ('e0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'ABC-123', '2112625428', null, 'to the C5', 'Cosmic Signature', 'Wormhole', 'H296', '{"time_status":4,"mass_status":1,"bookmark_index":"1a"}', 31000399, '1a', false, '2026-10-11 08:00:00', '2026-10-11 08:05:00'),
  ('e0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 'XYZ-987', '2112625428', 'Unsecured Frontier Enclave Relay', null, 'Cosmic Signature', 'Data Site', null, null, null, null, false, '2026-10-11 08:10:00', '2026-10-11 08:10:00'),
  ('e0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000001', 'QQQ-111', '2112625428', 'Forgotten Perimeter Gateway', null, 'Cosmic Anomaly', 'Combat Site', null, null, null, null, false, '2026-10-11 08:20:00', '2026-10-11 08:20:00'),
  ('e0000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000001', 'DEL-000', '2112625428', null, null, 'Cosmic Signature', 'Gas Site', null, null, null, null, true, '2026-10-10 08:20:00', '2026-10-10 08:20:00'),
  ('e0000000-0000-4000-8000-000000000005', 'b0000000-0000-4000-8000-000000000002', 'bookmark-x', '2116161001', 'Fleet warp-in', 'custom entry', 'Cosmic Signature', 'Unknown', null, null, null, null, false, '2026-10-11 09:20:00', '2026-10-11 09:20:00'),
  ('e0000000-0000-4000-8000-000000000006', 'b0000000-0000-4000-8000-000000000007', 'HID-001', '2116161001', null, 'Static to C5, rolled', 'Cosmic Signature', 'Wormhole', 'H296', '{"time_status":1}', null, null, false, '2026-09-01 11:00:00', '2026-09-01 12:00:00');

insert into map_system_structures_v1 (id, system_id, solar_system_id, solar_system_name, structure_type_id, structure_type, character_eve_id, name, notes, owner_name, owner_ticker, owner_id, status, end_time, inserted_at, updated_at) values
  ('f0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 31002531, 'J014348', '35833', 'Fortizar', '2112625428', 'Home Fort', 'Main staging', 'Wormhole Rescue Ltd', 'RESQ', '98000001', 'Powered', null, '2026-10-05 10:00:00', '2026-10-05 10:00:00'),
  ('f0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000003', 31001924, 'J130026', '35832', 'Astrahus', '2112625428', 'Hostile Astra', 'Armor timer', 'Hard Knocks Inc.', 'HKINC', '98000002', 'Reinforced', '2026-10-14 18:30:00', '2026-10-11 10:00:00', '2026-10-11 11:00:00'),
  ('f0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000007', 31002385, 'J152550', '35832', 'Astrahus', '2116161001', 'Sansha Tower', 'Seen from the hole', 'Sansha Remnants', 'SAN', null, 'Powered', null, '2026-09-01 10:00:00', '2026-09-01 10:00:00');

insert into map_system_comments_v1 (id, system_id, character_id, text, inserted_at, updated_at) values
  ('70000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'Rolled the static at 18:00', '2026-10-11 18:00:00', '2026-10-11 18:00:00'),
  ('70000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000007', 'c0000000-0000-4000-8000-000000000002', 'Do not jump in solo', '2026-09-03 10:00:00', '2026-09-03 10:00:00');

insert into map_chain_passages_v1 (id, map_id, character_id, ship_type_id, ship_name, mass, solar_system_source_id, solar_system_target_id, inserted_at, updated_at) values
  ('71000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 29984, 'Tengu', 12900000, 31002531, 31000399, '2026-10-11 08:40:00', '2026-10-11 08:40:00'),
  ('71000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 605, null, null, 31000399, 31002531, '2026-10-11 08:45:00', '2026-10-11 08:45:00');

insert into access_lists_v1 (id, name, description, owner_id, api_key) values
  ('72000000-0000-4000-8000-000000000001', 'Corp', 'members', 'c0000000-0000-4000-8000-000000000001', 'acl-key-never-read'),
  ('72000000-0000-4000-8000-000000000002', 'Blues', null, 'c0000000-0000-4000-8000-000000000001', null),
  ('72000000-0000-4000-8000-000000000003', 'Other map', null, 'c0000000-0000-4000-8000-000000000001', null);
insert into access_list_members_v1 (access_list_id, name, eve_character_id, eve_corporation_id, eve_alliance_id, role) values
  ('72000000-0000-4000-8000-000000000001', 'CCP Bartender', '2112625428', null, null, 'admin'),
  ('72000000-0000-4000-8000-000000000001', 'C C P', null, '109299958', null, 'member'),
  ('72000000-0000-4000-8000-000000000002', 'C C P Alliance', null, null, '434243723', 'viewer'),
  ('72000000-0000-4000-8000-000000000002', 'Known Awoxer', '2116161002', null, null, 'blocked'),
  ('72000000-0000-4000-8000-000000000003', 'Elsewhere', '2116161009', null, null, 'admin');
insert into map_access_lists_v1 (map_id, access_list_id) values
  ('a0000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001'),
  ('a0000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000002'),
  ('a0000000-0000-4000-8000-000000000002', '72000000-0000-4000-8000-000000000003');

insert into map_user_settings_v1 (map_id, user_id, settings, hubs, main_character_eve_id) values
  ('a0000000-0000-4000-8000-000000000001', '73000000-0000-4000-8000-000000000001', '{}', array['30002187', '30002659'], '2112625428'),
  ('a0000000-0000-4000-8000-000000000001', '73000000-0000-4000-8000-000000000002', '{}', array['30002187'], null),
  ('a0000000-0000-4000-8000-000000000002', '73000000-0000-4000-8000-000000000001', '{}', array['30002510'], '2112625428');

insert into map_character_settings_v1 (map_id, character_id, tracked) values
  ('a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', true),
  ('a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', false);

insert into map_webhook_subscriptions_v1 (map_id, url, events, "active?", encrypted_secret) values
  ('a0000000-0000-4000-8000-000000000001', 'https://hooks.example.com/wanderer', array['add_system', 'map_kill'], false, '\x736563726574');
