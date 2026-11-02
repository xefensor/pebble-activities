#include "pebble-activity-view.h"

#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static const char PROVIDER[] = "01234567-89ab-cdef-0123-456789abcdef";

static void put16(uint8_t *p, unsigned value) {
  p[0] = (uint8_t)value; p[1] = (uint8_t)(value >> 8);
}

static void put32(uint8_t *p, uint32_t value) {
  for (unsigned i = 0; i < 4; ++i) p[i] = (uint8_t)(value >> (8u * i));
}

static unsigned get16(const uint8_t *p) { return p[0] | ((unsigned)p[1] << 8); }

static void checksum(uint8_t *packet, size_t length) {
  put16(packet + 6, (unsigned)length);
  put16(packet + 8, pav_packet_crc16(packet, length));
}

static void header(uint8_t *packet, unsigned count) {
  memset(packet, 0, PAV_MAX_PACKET_BYTES);
  memcpy(packet, "ACT2", 4); packet[4] = 2; packet[5] = (uint8_t)count;
  put32(packet + 12, 17); put32(packet + 16, 1); put32(packet + 20, 100);
}

static unsigned append(char *pool, unsigned *length, const char *text) {
  const unsigned offset = *length, n = (unsigned)strlen(text) + 1;
  memcpy(pool + offset, text, n); *length += n; return offset;
}

static void datum(uint8_t *p, unsigned type, unsigned flags, unsigned base,
                    unsigned anchor, unsigned text_offset, unsigned text_length,
                    unsigned label_offset, unsigned label_length) {
  memset(p, 0, PAV_DATUM_BYTES); p[0] = (uint8_t)type; p[1] = (uint8_t)flags;
  put32(p + 4, 100); put32(p + 8, 800);
  put32(p + 12, base); put32(p + 16, anchor);
  put16(p + 20, text_offset); put16(p + 22, text_length);
  put16(p + 24, label_offset); put16(p + 26, label_length);
}

static size_t fixture(uint8_t *packet, bool private_value, bool numeric) {
  header(packet, 1);
  uint8_t *r = packet + PAV_HEADER_BYTES;
  r[2] = PAV_ACTIVE; r[3] = private_value ? PAV_PRIVATE : 0;
  put32(r + 4, 1); put32(r + 8, 100); put32(r + 12, 1000);
  const char id[] = "timer-1";
  r[16] = sizeof(id) - 1;
  memcpy(r + PAV_RECORD_HEADER_BYTES, PROVIDER, PAV_PROVIDER_BYTES);
  memcpy(r + PAV_RECORD_HEADER_BYTES + PAV_PROVIDER_BYTES, id, sizeof(id) - 1);
  char *pool = (char *)r + PAV_RECORD_HEADER_BYTES + PAV_PROVIDER_BYTES + sizeof(id) - 1;
  unsigned pool_length = 0;
  const unsigned empty = append(pool, &pool_length, "");
  const unsigned caption = append(pool, &pool_length, "Tea");
  const char *main_label = numeric ? "Complete" : "Left";
  const unsigned main = append(pool, &pool_length, main_label);
  const unsigned support = append(pool, &pool_length, "Elapsed");
  const unsigned value = append(pool, &pool_length, "72%");
  put16(r + 22, pool_length); put16(r + 24, caption); put16(r + 26, 3);
  if (numeric) {
    datum(r + 32, PAV_VALUE, PAV_RETAIN, 0, 0, value, 3, main, (unsigned)strlen(main_label));
    r[19] = PAV_METER_PROGRESS; put16(r + 28, 47185);
  } else datum(r + 32, PAV_CLOCK, PAV_RUNNING | PAV_RETAIN, 600, 100,
               empty, 0, main, (unsigned)strlen(main_label));
  datum(r + 60, PAV_CLOCK, PAV_RUNNING | PAV_ELAPSED | PAV_RETAIN, 30, 100,
         empty, 0, support, 7);
  put32(r + 60 + 8, 500);
  const size_t length = PAV_HEADER_BYTES + PAV_RECORD_HEADER_BYTES + PAV_PROVIDER_BYTES +
      sizeof(id) - 1 + pool_length;
  put16(r, (unsigned)(length - PAV_HEADER_BYTES)); checksum(packet, length);
  return length;
}

static void bad_packet(const uint8_t *packet, size_t length) {
  PavSnapshot before, after;
  memset(&before, 0xa5, sizeof(before)); after = before;
  assert(!pav_decode(packet, length, &after));
  assert(!memcmp(&before, &after, sizeof(before)));
}

static void test_decode(void) {
  uint8_t packet[PAV_MAX_PACKET_BYTES], saved[PAV_MAX_PACKET_BYTES];
  const size_t length = fixture(packet, false, false);
  PavSnapshot output;
  assert(pav_decode(packet, length, &output));
  assert(pav_decode(packet, length, NULL));
  assert(output.session == 17 && output.view_sequence == 1 && output.sent_at == 100);
  assert(output.count == 1 && output.items[0].source_revision == 1);
  assert(!strcmp(output.items[0].provider, PROVIDER));
  assert(!strcmp(output.items[0].id, "timer-1"));
  assert(!strcmp(pav_caption(&output.items[0]), "Tea"));
  assert(!strcmp(pav_label(&output.items[0], &output.items[0].main), "Left"));
  memcpy(saved, packet, length);
  for (size_t n = 0; n < length; ++n) bad_packet(packet, n);
  assert(!pav_decode(NULL, length, NULL));

  const unsigned offsets[] = {0, 4, 5, 10, 11};
  const uint8_t values[] = {'X', 1, 3, 1, 1};
  for (unsigned i = 0; i < sizeof(offsets) / sizeof(offsets[0]); ++i) {
    packet[offsets[i]] = values[i]; checksum(packet, length); bad_packet(packet, length);
    memcpy(packet, saved, length);
  }
  put32(packet + 12, 1); checksum(packet, length); bad_packet(packet, length); memcpy(packet, saved, length);
  put32(packet + 16, 0); checksum(packet, length); bad_packet(packet, length); memcpy(packet, saved, length);
  put32(packet + 20, 0); checksum(packet, length); bad_packet(packet, length); memcpy(packet, saved, length);
  packet[length - 1] ^= 1; bad_packet(packet, length); memcpy(packet, saved, length);

  const unsigned record_offsets[] = {2, 3, 16, 17, 19, 30, 31, 32, 33, 34, 60, 62};
  const uint8_t record_values[] = {0, 0x80, 65, 1, 3, 2, 1, 0, 0x80, 1, 4, 1};
  for (unsigned i = 0; i < sizeof(record_offsets) / sizeof(record_offsets[0]); ++i) {
    packet[PAV_HEADER_BYTES + record_offsets[i]] = record_values[i]; checksum(packet, length);
    bad_packet(packet, length); memcpy(packet, saved, length);
  }
  uint8_t *r = packet + PAV_HEADER_BYTES;
  put16(r, 87); checksum(packet, length); bad_packet(packet, length); memcpy(packet, saved, length);
  put32(r + 4, 0); checksum(packet, length); bad_packet(packet, length); memcpy(packet, saved, length);
  put32(r + 8, 0); checksum(packet, length); bad_packet(packet, length); memcpy(packet, saved, length);
  put32(r + 12, 99); checksum(packet, length); bad_packet(packet, length); memcpy(packet, saved, length);
  put16(r + 22, 321); checksum(packet, length); bad_packet(packet, length); memcpy(packet, saved, length);
  put16(r + 24, 320); checksum(packet, length); bad_packet(packet, length); memcpy(packet, saved, length);
  put32(r + 32 + 4, 101); checksum(packet, length); bad_packet(packet, length); memcpy(packet, saved, length);
  put32(r + 32 + 8, 1001); checksum(packet, length); bad_packet(packet, length); memcpy(packet, saved, length);
  put32(r + 32 + 16, 101); checksum(packet, length); bad_packet(packet, length); memcpy(packet, saved, length);
  put16(r + 32 + 26, 0); checksum(packet, length); bad_packet(packet, length); memcpy(packet, saved, length);
  r[3] = PAV_PRIVATE | PAV_SOURCE_UNCONFIRMED;
  checksum(packet, length); bad_packet(packet, length); memcpy(packet, saved, length);

  const size_t identity = PAV_HEADER_BYTES + PAV_RECORD_HEADER_BYTES;
  packet[identity] = 'A'; checksum(packet, length); bad_packet(packet, length); memcpy(packet, saved, length);
  packet[identity + PAV_PROVIDER_BYTES] = 0;
  checksum(packet, length); bad_packet(packet, length); memcpy(packet, saved, length);
  const size_t pool = identity + PAV_PROVIDER_BYTES + 7;
  packet[pool + 1] = 0xc0; checksum(packet, length); bad_packet(packet, length); memcpy(packet, saved, length);
  packet[pool + 1] = 0xed; packet[pool + 2] = 0xa0; packet[pool + 3] = 0x80;
  checksum(packet, length); bad_packet(packet, length); memcpy(packet, saved, length);
  packet[pool + 2] = 0;
  checksum(packet, length); bad_packet(packet, length); memcpy(packet, saved, length);

  /* Two identical identities cannot masquerade as two activities. */
  memcpy(packet + length, packet + PAV_HEADER_BYTES, length - PAV_HEADER_BYTES);
  packet[5] = 2; checksum(packet, length * 2 - PAV_HEADER_BYTES);
  bad_packet(packet, length * 2 - PAV_HEADER_BYTES);
  header(packet, 0); checksum(packet, PAV_HEADER_BYTES);
  assert(pav_decode(packet, PAV_HEADER_BYTES, &output) && output.count == 0);
}

static void test_clocks(void) {
  uint8_t packet[PAV_MAX_PACKET_BYTES];
  const size_t length = fixture(packet, false, false);
  PavState state; pav_state_init(&state, 17, true);
  assert(pav_state_receive(&state, packet, length, 100));
  const PavCard *card = pav_state_select(&state, 110, 0);
  assert(card && pav_datum_visible(card, &card->support, 110, true));
  assert(pav_clock_value(card, &card->main, 110, true).seconds == 590);
  assert(pav_clock_value(card, &card->support, 110, true).seconds == 40);
  assert(pav_clock_value(card, &card->main, 90, true).seconds == 600);
  assert(pav_clock_value(card, &card->main, 90, true).estimated);
  char text[32];
  assert(pav_format_item(card, &card->main, 110, true, text, sizeof(text)));
  assert(!strcmp(text, "09:50"));
  PavClockValue due = pav_clock_value(card, &card->main, 700, true);
  assert(due.due && due.running && due.seconds == 0);
  assert(card->source_state == PAV_ACTIVE && card->source_revision == 1);

  /* Pausing the activity does not guess the state of independent clocks. */
  uint8_t *r = packet + PAV_HEADER_BYTES;
  put32(packet + 16, 2); put32(r + 4, 2); r[2] = PAV_PAUSED;
  r[60 + 1] = PAV_ELAPSED | PAV_RETAIN; put32(r + 60 + 16, 0);
  checksum(packet, length);
  assert(pav_state_receive(&state, packet, length, 110));
  card = pav_state_select(&state, 120, 0);
  assert(pav_clock_value(card, &card->main, 120, true).seconds == 580);
  assert(pav_clock_value(card, &card->support, 120, true).seconds == 30);
  assert(!pav_clock_value(card, &card->support, 120, true).running);
  assert(pav_format_duration(86400, text, sizeof(text)) && !strcmp(text, "24:00:00"));
  assert(pav_format_duration(UINT32_MAX, text, sizeof(text)) && !strcmp(text, "1193046:28:15"));
  assert(!pav_format_duration(86400, text, 3));
}

static void test_revision_and_visibility(void) {
  uint8_t packet[PAV_MAX_PACKET_BYTES], saved[PAV_MAX_PACKET_BYTES];
  const size_t length = fixture(packet, false, false);
  PavState state; pav_state_init(&state, 17, true);
  assert(pav_state_receive(&state, packet, length, 100));
  memcpy(saved, packet, length);
  assert(!pav_state_receive(&state, packet, length, 100));
  put32(packet + 12, 18); put32(packet + 16, 2); checksum(packet, length);
  assert(!pav_state_receive(&state, packet, length, 100));
  memcpy(packet, saved, length);

  /* A new projection of the same source revision may format a caption differently. */
  put32(packet + 16, 2);
  const size_t pool = PAV_HEADER_BYTES + PAV_RECORD_HEADER_BYTES + PAV_PROVIDER_BYTES + 7;
  packet[pool + 1] = 'P'; checksum(packet, length);
  assert(pav_state_receive(&state, packet, length, 101));
  assert(!strcmp(pav_caption(&state.snapshot.items[0]), "Pea"));
  assert(state.snapshot.items[0].source_revision == 1 && state.last_sequence == 2);
  put32(packet + 16, 3); put32(packet + PAV_HEADER_BYTES + 8, 101); checksum(packet, length);
  assert(!pav_state_receive(&state, packet, length, 101));
  memcpy(packet, saved, length); put32(packet + 16, 3);
  put32(packet + PAV_HEADER_BYTES + 4, 2); checksum(packet, length);
  assert(pav_state_receive(&state, packet, length, 101));
  put32(packet + 16, 4); put32(packet + PAV_HEADER_BYTES + 4, 1); checksum(packet, length);
  assert(!pav_state_receive(&state, packet, length, 101));
  assert(state.last_sequence == 3);

  put32(packet + PAV_HEADER_BYTES + 4, 3); packet[PAV_HEADER_BYTES + 2] = PAV_COMPLETED;
  packet[PAV_HEADER_BYTES + 3] |= PAV_SHOW_TERMINAL;
  checksum(packet, length);
  assert(pav_state_receive(&state, packet, length, 102));
  assert(pav_state_select(&state, 102, 0));
  assert(state.snapshot.items[0].source_state == PAV_COMPLETED);
  put32(packet + 16, 5); put32(packet + PAV_HEADER_BYTES + 4, 4);
  packet[PAV_HEADER_BYTES + 2] = PAV_ACTIVE; checksum(packet, length);
  assert(!pav_state_receive(&state, packet, length, 102));

  /* Hidden terminal results remain revision tombstones, but no display bytes. */
  put32(packet + PAV_HEADER_BYTES + 4, 4); packet[PAV_HEADER_BYTES + 2] = PAV_COMPLETED;
  packet[PAV_HEADER_BYTES + 3] &= (uint8_t)~PAV_SHOW_TERMINAL; checksum(packet, length);
  assert(pav_state_receive(&state, packet, length, 103));
  assert(!pav_state_select(&state, 103, 0));
  assert(state.snapshot.items[0].provider[0] && !state.snapshot.items[0].strings[1]);
  pav_state_set_session(&state, 18);
  assert(!state.last_sequence && !state.snapshot.count);
  assert(!pav_state_receive(&state, packet, length, 103));
}

static void test_retention_and_expiry(void) {
  uint8_t packet[PAV_MAX_PACKET_BYTES];
  size_t length = fixture(packet, false, true);
  PavState state; pav_state_init(&state, 17, true);
  assert(pav_state_receive(&state, packet, length, 100));
  assert(pav_meter_visible(&state.snapshot.items[0], 100, true));
  assert(pav_state_set_connected(&state, false));
  const PavCard *card = pav_state_select(&state, 110, 0);
  assert(card && (card->flags & PAV_SOURCE_UNCONFIRMED));
  assert(!strcmp(pav_text(card, &card->main), "72%"));
  assert(pav_meter_visible(card, 110, false)); /* Explicit retained value, same quality. */
  assert(pav_clock_value(card, &card->support, 110, false).estimated);
  assert(!pav_state_set_connected(&state, false));
  assert(pav_state_set_connected(&state, true));
  assert(state.snapshot.items[0].flags & PAV_SOURCE_UNCONFIRMED);
  assert(pav_state_prune(&state, 500) == 800);
  assert(!state.snapshot.items[0].support.type);
  assert(pav_state_prune(&state, 800) == 0);
  assert(!pav_state_select(&state, 800, 0));

  length = fixture(packet, true, false); pav_state_init(&state, 17, true);
  assert(pav_state_receive(&state, packet, length, 100));
  assert(pav_state_set_connected(&state, false));
  assert(!pav_state_select(&state, 101, 0) && !state.snapshot.items[0].provider[0]);

  length = fixture(packet, false, true);
  packet[PAV_HEADER_BYTES + 32 + 1] = 0; checksum(packet, length);
  pav_state_init(&state, 17, true);
  assert(pav_state_receive(&state, packet, length, 100));
  assert(pav_state_set_connected(&state, false));
  assert(!pav_state_select(&state, 101, 0)); /* Public does not imply retain. */

  length = fixture(packet, false, false);
  packet[PAV_HEADER_BYTES + 60 + 1] &= (uint8_t)~PAV_RETAIN; checksum(packet, length);
  pav_state_init(&state, 17, true);
  assert(pav_state_receive(&state, packet, length, 100));
  assert(pav_state_set_connected(&state, false));
  assert(pav_state_select(&state, 101, 0) && !state.snapshot.items[0].support.type);

  /* A meter attached to support expires even while main keeps changing. */
  length = fixture(packet, false, true);
  uint8_t *r = packet + PAV_HEADER_BYTES;
  r[60] = PAV_VALUE; r[61] = PAV_RETAIN;
  put32(r + 72, 0); put32(r + 76, 0);
  put16(r + 80, get16(r + 52)); put16(r + 82, 3); r[30] = 1;
  checksum(packet, length); pav_state_init(&state, 17, true);
  assert(pav_state_receive(&state, packet, length, 100));
  assert(pav_meter_visible(&state.snapshot.items[0], 100, true));
  assert(pav_state_prune(&state, 500) == 800);
  assert(!state.snapshot.items[0].meter_kind);

  /* Corruption retracts private content without poisoning a later valid frame. */
  length = fixture(packet, true, false); pav_state_init(&state, 17, true);
  assert(pav_state_receive(&state, packet, length, 100));
  packet[length - 1] ^= 1;
  assert(!pav_state_receive(&state, packet, length, 101));
  assert(state.connected && !pav_state_select(&state, 101, 0));
}

static void test_maximum_images(void) {
  uint8_t packet[PAV_MAX_PACKET_BYTES]; header(packet, 2);
  size_t offset = PAV_HEADER_BYTES;
  for (unsigned i = 0; i < 2; ++i) {
    uint8_t *r = packet + offset;
    const unsigned record_bytes = PAV_RECORD_HEADER_BYTES + PAV_PROVIDER_BYTES + PAV_ID_BYTES +
        PAV_STRING_BYTES + PAV_PALETTE_BYTES + PAV_IMAGE_MAX_BYTES;
    put16(r, record_bytes); r[2] = PAV_ACTIVE; r[3] = PAV_HAS_IMAGE;
    put32(r + 4, 1); put32(r + 8, 100); put32(r + 12, 1000);
    r[16] = 64; r[17] = 40; r[18] = 40;
    put16(r + 20, 800); put16(r + 22, 320); put16(r + 24, 2);
    memcpy(r + 88, PROVIDER, 36); memset(r + 124, i ? 'b' : 'a', 64);
    char *pool = (char *)r + 188; pool[0] = 'L';
    datum(r + 32, PAV_CLOCK, PAV_RUNNING | PAV_RETAIN, 600, 100, 2, 0, 0, 1);
    memset((uint8_t *)pool + 320, 0xff, 16);
    offset += record_bytes;
  }
  assert(offset == PAV_MAX_PACKET_BYTES); checksum(packet, offset);
  PavSnapshot output;
  assert(pav_decode(packet, offset, &output));
  assert(output.count == 2 && output.items[0].pixel_bytes == 800 && output.items[1].width == 40);
  packet[24 + 17] = 41; checksum(packet, offset); bad_packet(packet, offset);

  size_t length = fixture(packet, false, false);
  uint8_t *r = packet + 24;
  r[3] |= PAV_HAS_IMAGE; r[17] = r[18] = 1; put16(r + 20, 1);
  memset(packet + length, 0xff, 16); packet[length + 16] = 0x10;
  length += 17; put16(r, (unsigned)(length - 24)); checksum(packet, length);
  assert(pav_decode(packet, length, &output));
  packet[length - 1] |= 1; checksum(packet, length); bad_packet(packet, length);
}

static void test_projection_changes_and_utf8(void) {
  uint8_t packet[PAV_MAX_PACKET_BYTES];
  size_t length = fixture(packet, false, true);
  PavState state; pav_state_init(&state, 17, true);
  assert(pav_state_receive(&state, packet, length, 100));
  uint8_t *r = packet + 24;
  /* Requesting a fuller view can add artwork at the same source revision. */
  r[3] |= PAV_HAS_IMAGE; r[17] = r[18] = 1; put16(r + 20, 1);
  memset(packet + length, 0xff, 16); packet[length + 16] = 0x10;
  length += 17; put16(r, (unsigned)(length - 24));
  put32(packet + 16, 2); checksum(packet, length);
  assert(pav_state_receive(&state, packet, length, 101));
  assert(state.snapshot.items[0].flags & PAV_HAS_IMAGE);
  assert(state.snapshot.items[0].source_revision == 1);
  put32(packet + 16, 3); r[3] |= PAV_PRIVATE; checksum(packet, length);
  assert(!pav_state_receive(&state, packet, length, 101));
  assert(state.last_sequence == 2);

  length = fixture(packet, false, true); r = packet + 24;
  const size_t pool = 24 + 88 + 36 + 7;
  const size_t value = pool + get16(r + 52);
  packet[value] = 0xc3; packet[value + 1] = 0xa9; packet[value + 2] = 'B';
  checksum(packet, length); pav_state_init(&state, 17, true);
  assert(pav_state_receive(&state, packet, length, 100));
  const PavCard *card = pav_state_select(&state, 100, 0);
  char text[8];
  assert(!pav_format_item(card, &card->main, 100, true, text, 2) && !text[0]);
  assert(!pav_format_item(card, &card->main, 100, true, text, 3) && !strcmp(text, "\xc3\xa9"));
  assert(pav_format_item(card, &card->main, 100, true, text, 4) && !strcmp(text, "\xc3\xa9" "B"));

  length = fixture(packet, false, false);
  put32(packet + 24 + 60 + 12, UINT32_MAX - 5u); checksum(packet, length);
  pav_state_init(&state, 17, true);
  assert(pav_state_receive(&state, packet, length, 100));
  card = pav_state_select(&state, 110, 0);
  assert(pav_clock_value(card, &card->support, 110, true).seconds == UINT32_MAX);
}

static void test_structured_mutations(void) {
  uint8_t packet[PAV_MAX_PACKET_BYTES], original[PAV_MAX_PACKET_BYTES];
  const size_t length = fixture(original, false, true);
  const uint8_t masks[] = {1, 0x80, 0xff};
  for (size_t offset = 0; offset < length; ++offset) {
    for (unsigned i = 0; i < sizeof(masks) / sizeof(masks[0]); ++i) {
      memcpy(packet, original, length); packet[offset] ^= masks[i]; checksum(packet, length);
      PavSnapshot before, after;
      memset(&before, 0xa5, sizeof(before)); after = before;
      if (!pav_decode(packet, length, &after)) assert(!memcmp(&before, &after, sizeof(before)));
      else {
        assert(after.count <= PAV_MAX_CARDS);
        for (unsigned j = 0; j < after.count; ++j) {
          const PavCard *card = &after.items[j];
          assert(pav_caption(card) && pav_text(card, &card->main) && pav_label(card, &card->main));
        }
      }
    }
  }
}

static void test_js_fixture(const char *directory, const char *name, unsigned count) {
  char path[1024];
  assert(snprintf(path, sizeof(path), "%s/%s", directory, name) > 0);
  FILE *input = fopen(path, "rb");
  if (!input) { fprintf(stderr, "missing view fixture: %s\n", path); abort(); }
  uint8_t packet[PAV_MAX_PACKET_BYTES + 1];
  const size_t length = fread(packet, 1, sizeof(packet), input);
  assert(!ferror(input) && feof(input)); fclose(input);
  PavSnapshot output;
  assert(pav_decode(packet, length, &output) && output.count == count);
  if (count) {
    const PavCard *card = &output.items[0];
    assert(card->main.type && pav_label(card, &card->main)[0]);
    if (!strcmp(name, "view-clocks.bin")) {
      assert(card->main.type == PAV_CLOCK && card->support.type == PAV_CLOCK);
      assert(pav_clock_value(card, &card->main, card->source_observed_at + 10, true).seconds == 590);
      assert(pav_clock_value(card, &card->support, card->source_observed_at + 10, true).seconds == 130);
      assert(card->flags & PAV_SOURCE_UNCONFIRMED);
    } else if (!strcmp(name, "view-value.bin")) {
      assert(card->main.type == PAV_VALUE && card->support.type == PAV_CLOCK);
      assert(!strcmp(pav_text(card, &card->main), "72%"));
      assert(card->meter_kind == PAV_METER_PROGRESS && card->meter == 47185);
      assert(card->width == 2 && card->height == 1 && card->pixels[0] == 1);
    } else if (!strcmp(name, "view-max.bin")) {
      assert(length == PAV_MAX_PACKET_BYTES && card->main.text_length == PAV_TEXT_BYTES);
      assert(output.items[1].pixel_bytes == PAV_IMAGE_MAX_BYTES);
    } else if (!strcmp(name, "view-result.bin")) {
      assert(card->source_state == PAV_COMPLETED && (card->flags & PAV_SHOW_TERMINAL));
      assert(pav_card_visible(card, card->source_observed_at, true));
      assert(!strcmp(pav_text(card, &card->main), "Finished"));
      assert(pav_clock_value(card, &card->support, card->source_observed_at, true).seconds == 600);
    }
  }
}

int main(int argc, char **argv) {
  test_decode(); test_clocks(); test_revision_and_visibility();
  test_retention_and_expiry(); test_maximum_images();
  test_projection_changes_and_utf8(); test_structured_mutations();
  if (argc > 1) {
    test_js_fixture(argv[1], "view-clocks.bin", 1);
    test_js_fixture(argv[1], "view-value.bin", 1);
    test_js_fixture(argv[1], "view-empty.bin", 0);
    test_js_fixture(argv[1], "view-max.bin", 2);
    test_js_fixture(argv[1], "view-result.bin", 1);
  }
  puts("ACT2 native wire/state checks passed");
  return 0;
}
