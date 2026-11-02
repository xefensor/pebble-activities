#include "pebble-activities.h"

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

static void checksum(uint8_t *packet, size_t length) {
  put16(packet + 6, (unsigned)length);
  put16(packet + 8, pa_packet_crc16(packet, length));
}

static size_t fixture(uint8_t *packet, bool private_value) {
  const char id[] = "timer-1", kind[] = "timer", footer[] = "Tea";
  memset(packet, 0, PA_MAX_PACKET_BYTES);
  memcpy(packet, "ACT1", 4); packet[4] = 1; packet[5] = 1;
  put32(packet + 12, 17); put32(packet + 16, 1); put32(packet + 20, 100);
  uint8_t *r = packet + PA_HEADER_BYTES;
  r[0] = PA_ACTIVE; r[1] = PA_CLOCK_DEADLINE;
  r[2] = private_value ? PA_FLAG_PRIVATE : 0;
  put32(r + 4, 1); put32(r + 8, 100); put32(r + 12, 800);
  put32(r + 16, 700);
  r[36] = sizeof(PROVIDER) - 1; r[37] = sizeof(id) - 1;
  r[38] = sizeof(kind) - 1; r[40] = sizeof(footer) - 1;
  size_t offset = PA_HEADER_BYTES + PA_RECORD_HEADER_BYTES;
  memcpy(packet + offset, PROVIDER, sizeof(PROVIDER) - 1); offset += sizeof(PROVIDER) - 1;
  memcpy(packet + offset, id, sizeof(id) - 1); offset += sizeof(id) - 1;
  memcpy(packet + offset, kind, sizeof(kind) - 1); offset += sizeof(kind) - 1;
  memcpy(packet + offset, footer, sizeof(footer) - 1); offset += sizeof(footer) - 1;
  checksum(packet, offset);
  return offset;
}

static void bad_packet(uint8_t *packet, size_t length) {
  PaSnapshot before, after;
  memset(&before, 0xa5, sizeof(before)); after = before;
  assert(!pa_decode(packet, length, &after));
  assert(!memcmp(&after, &before, sizeof(after)));
}

static void test_decoder(void) {
  uint8_t packet[PA_MAX_PACKET_BYTES], saved[PA_MAX_PACKET_BYTES];
  const size_t length = fixture(packet, false);
  PaSnapshot output;
  assert(pa_decode(packet, length, &output));
  assert(output.session == 17 && output.sequence == 1 && output.sent_at == 100);
  assert(output.count == 1 && output.items[0].revision == 1);
  assert(!strcmp(output.items[0].provider, PROVIDER));
  assert(!strcmp(output.items[0].id, "timer-1"));
  assert(!strcmp(output.items[0].footer, "Tea"));
  assert(output.items[0].deadline == 700);
  memcpy(saved, packet, length);
  assert(!pa_decode(NULL, length, &output));
  assert(pa_decode(packet, length, NULL));

  for (size_t n = 0; n < length; ++n) bad_packet(packet, n);
  packet[0] = 'X'; bad_packet(packet, length); memcpy(packet, saved, length);
  packet[4] = 2; checksum(packet, length); bad_packet(packet, length); memcpy(packet, saved, length);
  packet[5] = 3; checksum(packet, length); bad_packet(packet, length); memcpy(packet, saved, length);
  packet[10] = 1; checksum(packet, length); bad_packet(packet, length); memcpy(packet, saved, length);
  put32(packet + 12, 0); checksum(packet, length); bad_packet(packet, length); memcpy(packet, saved, length);
  put32(packet + 12, 1); checksum(packet, length); bad_packet(packet, length); memcpy(packet, saved, length);
  put32(packet + 16, 0); checksum(packet, length); bad_packet(packet, length); memcpy(packet, saved, length);
  put32(packet + 20, 0); checksum(packet, length); bad_packet(packet, length); memcpy(packet, saved, length);
  packet[length - 1] ^= 1; bad_packet(packet, length); memcpy(packet, saved, length);

  const size_t r = PA_HEADER_BYTES;
  const unsigned bad_offsets[] = {0, 1, 2, 3, 46, 47};
  const uint8_t bad_values[] = {0, 3, 0x80, 1, 1, 1};
  for (unsigned i = 0; i < sizeof(bad_offsets) / sizeof(bad_offsets[0]); ++i) {
    packet[r + bad_offsets[i]] = bad_values[i]; checksum(packet, length);
    bad_packet(packet, length); memcpy(packet, saved, length);
  }
  put32(packet + r + 4, 0); checksum(packet, length); bad_packet(packet, length); memcpy(packet, saved, length);
  put32(packet + r + 8, 0); checksum(packet, length); bad_packet(packet, length); memcpy(packet, saved, length);
  put32(packet + r + 12, 99); checksum(packet, length); bad_packet(packet, length); memcpy(packet, saved, length);
  put32(packet + r + 16, 0); checksum(packet, length); bad_packet(packet, length); memcpy(packet, saved, length);
  put32(packet + r + 20, 1); checksum(packet, length); bad_packet(packet, length); memcpy(packet, saved, length);
  put32(packet + r + 24, 1); checksum(packet, length); bad_packet(packet, length); memcpy(packet, saved, length);
  packet[r + 28] = 1; checksum(packet, length); bad_packet(packet, length); memcpy(packet, saved, length);
  packet[r + 36] = 35; checksum(packet, length); bad_packet(packet, length); memcpy(packet, saved, length);
  packet[r + 37] = 65; checksum(packet, length); bad_packet(packet, length); memcpy(packet, saved, length);
  packet[r + 39] = 193; checksum(packet, length); bad_packet(packet, length); memcpy(packet, saved, length);
  packet[r + 40] = 129; checksum(packet, length); bad_packet(packet, length); memcpy(packet, saved, length);
  packet[r + 41] = 17; checksum(packet, length); bad_packet(packet, length); memcpy(packet, saved, length);
  packet[r + 42] = 1; checksum(packet, length); bad_packet(packet, length); memcpy(packet, saved, length);

  const size_t strings = PA_HEADER_BYTES + PA_RECORD_HEADER_BYTES;
  packet[strings] = 'A'; checksum(packet, length); bad_packet(packet, length); memcpy(packet, saved, length);
  packet[strings + 8] = '_'; checksum(packet, length); bad_packet(packet, length); memcpy(packet, saved, length);
  packet[strings + 36] = 0; checksum(packet, length); bad_packet(packet, length); memcpy(packet, saved, length);
  packet[strings + 36] = 0xc0; checksum(packet, length); bad_packet(packet, length); memcpy(packet, saved, length);
  packet[strings + 36] = 0xed; packet[strings + 37] = 0xa0; packet[strings + 38] = 0x80;
  checksum(packet, length); bad_packet(packet, length); memcpy(packet, saved, length);

  /* Duplicating a run cannot create both a primary and alternate entry. */
  memcpy(packet + length, packet + PA_HEADER_BYTES, length - PA_HEADER_BYTES);
  packet[5] = 2;
  checksum(packet, length * 2 - PA_HEADER_BYTES);
  bad_packet(packet, length * 2 - PA_HEADER_BYTES);

  /* A complete empty snapshot is a valid withdrawal, with no extra bytes. */
  memcpy(packet, saved, length); packet[5] = 0; checksum(packet, PA_HEADER_BYTES);
  assert(pa_decode(packet, PA_HEADER_BYTES, &output) && output.count == 0);
  checksum(packet, length); bad_packet(packet, length);
}

static void test_image_numeric(void) {
  uint8_t packet[PA_MAX_PACKET_BYTES], saved[PA_MAX_PACKET_BYTES];
  size_t length = fixture(packet, false);
  const size_t r = PA_HEADER_BYTES;
  packet[r + 2] = PA_FLAG_IMAGE;
  packet[r + 42] = 3; packet[r + 43] = 2; put16(packet + r + 44, 4);
  memset(packet + length, 0xff, PA_PALETTE_BYTES);
  packet[length + 16] = 0x12; packet[length + 17] = 0x30;
  packet[length + 18] = 0x45; packet[length + 19] = 0x60;
  length += 20;
  checksum(packet, length);
  PaSnapshot output;
  assert(pa_decode(packet, length, &output));
  assert(output.items[0].width == 3 && output.items[0].pixel_bytes == 4);
  assert(output.items[0].pixels[3] == 0x60);
  memcpy(saved, packet, length);
  packet[length - 1] |= 1; checksum(packet, length); bad_packet(packet, length);
  memcpy(packet, saved, length);
  packet[r + 42] = 41; checksum(packet, length); bad_packet(packet, length);
  memcpy(packet, saved, length);
  put16(packet + r + 44, 3); checksum(packet, length); bad_packet(packet, length);

  length = fixture(packet, false);
  packet[r + 2] = PA_FLAG_NUMERIC;
  /* Binary64 6.25, constructed in wire byte order independently of C host. */
  const uint8_t number[8] = {0, 0, 0, 0, 0, 0, 0x19, 0x40};
  memcpy(packet + r + 28, number, 8); checksum(packet, length);
  assert(pa_decode(packet, length, &output) && output.items[0].value == 6.25);
  packet[r + 34] = 0xf0; packet[r + 35] = 0x7f;
  checksum(packet, length); bad_packet(packet, length); /* +infinity */
  packet[r + 28] = 1; checksum(packet, length); bad_packet(packet, length); /* NaN */
}

static void test_reserved_kind_privacy(void) {
  const char *kinds[] = {"music", "notification", "notifications", "MUSIC"};
  for (unsigned i = 0; i < sizeof(kinds) / sizeof(kinds[0]); ++i) {
    uint8_t packet[PA_MAX_PACKET_BYTES];
    const size_t old_length = fixture(packet, false);
    const size_t kind = PA_HEADER_BYTES + PA_RECORD_HEADER_BYTES + PA_PROVIDER_BYTES + 7u;
    const size_t kind_length = strlen(kinds[i]);
    /* The mutation retains a valid packet CRC, so the native privacy boundary
     * is tested independently of the JS normalizer and transport corruption. */
    memmove(packet + kind + kind_length, packet + kind + 5u, old_length - kind - 5u);
    memcpy(packet + kind, kinds[i], kind_length);
    packet[PA_HEADER_BYTES + 38] = (uint8_t)kind_length;
    const size_t length = old_length - 5u + kind_length;
    checksum(packet, length);
    bad_packet(packet, length);
    packet[PA_HEADER_BYTES + 2] |= PA_FLAG_PRIVATE;
    checksum(packet, length);
    PaState state;
    pa_state_init(&state, 17, true);
    assert(pa_state_receive(&state, packet, length, 100));
    assert(pa_state_select(&state, 100, 0) != NULL);
    assert(pa_state_set_connected(&state, false));
    assert(pa_state_select(&state, 100, 0) == NULL);
    assert(!state.snapshot.items[0].provider[0]);
  }
}

static void test_lifecycle(void) {
  uint8_t packet[PA_MAX_PACKET_BYTES];
  const size_t length = fixture(packet, false);
  PaState state;
  pa_state_init(&state, 17, true);
  assert(pa_state_receive(&state, packet, length, 100));
  assert(state.last_sequence == 1);
  assert(pa_state_select(&state, 100, 0) != NULL);
  assert(pa_state_select(&state, 100, 1) == NULL);
  assert(!pa_state_receive(&state, packet, length, 100)); /* duplicate projection */
  put32(packet + 16, 2); put32(packet + 12, 18); checksum(packet, length);
  assert(!pa_state_receive(&state, packet, length, 100));
  assert(state.last_sequence == 1 && state.snapshot.items[0].deadline == 700);
  put32(packet + 12, 17); put32(packet + 16, 2);
  put32(packet + PA_HEADER_BYTES + 4, 2); checksum(packet, length);
  assert(pa_state_receive(&state, packet, length, 100));
  put32(packet + 16, 3); put32(packet + PA_HEADER_BYTES + 4, 1); checksum(packet, length);
  assert(!pa_state_receive(&state, packet, length, 100)); /* source revision rollback */
  assert(state.last_sequence == 2);
  assert(pa_state_set_connected(&state, false));
  assert(!pa_state_set_connected(&state, false));
  assert(pa_state_select(&state, 100, 0) != NULL); /* public last-reported timer */
  assert(state.snapshot.items[0].flags & PA_FLAG_UNCONFIRMED);
  assert(!pa_state_receive(&state, packet, length, 100));
  assert(pa_clock_value(pa_state_select(&state, 100, 0), 101, false).estimated);
  assert(pa_state_set_connected(&state, true));
  assert(pa_clock_value(pa_state_select(&state, 100, 0), 101, true).estimated);
  put32(packet + 16, 3); put32(packet + PA_HEADER_BYTES + 4, 2); checksum(packet, length);
  assert(pa_state_receive(&state, packet, length, 101));
  assert(!pa_clock_value(pa_state_select(&state, 101, 0), 101, true).estimated);
  put32(packet + 16, 4); put32(packet + PA_HEADER_BYTES + 16, 900); checksum(packet, length);
  assert(!pa_state_receive(&state, packet, length, 101)); /* same revision is immutable */
  assert(pa_state_prune(&state, 799) == 800);
  assert(pa_state_prune(&state, 800) == 0);
  assert(pa_state_select(&state, 800, 0) == NULL);
  assert(!state.snapshot.items[0].provider[0]);

  const size_t private_length = fixture(packet, true);
  pa_state_init(&state, 17, true);
  assert(pa_state_receive(&state, packet, private_length, 100));
  assert(pa_state_select(&state, 100, 0) != NULL);
  assert(pa_state_set_connected(&state, false));
  assert(pa_state_select(&state, 100, 0) == NULL);
  assert(!state.snapshot.items[0].provider[0]);
  pa_state_init(&state, 17, true);
  assert(pa_state_receive(&state, packet, private_length, 100));
  packet[0] = '?';
  assert(!pa_state_receive(&state, packet, private_length, 100));
  assert(!state.snapshot.items[0].provider[0]);
  pa_state_set_session(&state, 19);
  assert(state.session_token == 19 && !state.last_sequence && !state.snapshot.count);

  fixture(packet, true);
  packet[PA_HEADER_BYTES] = PA_CANCELLED;
  packet[PA_HEADER_BYTES + 1] = PA_CLOCK_NONE;
  put32(packet + PA_HEADER_BYTES + 16, 0); checksum(packet, length);
  pa_state_init(&state, 17, true);
  assert(pa_state_receive(&state, packet, length, 100));
  assert(!pa_state_select(&state, 100, 0));
  assert(!state.snapshot.items[0].footer[0]); /* no private payload in tombstone */
  put32(packet + 16, 2); checksum(packet, length);
  assert(pa_state_receive(&state, packet, length, 100)); /* repeated tombstone */
  packet[PA_HEADER_BYTES] = PA_ACTIVE;
  packet[PA_HEADER_BYTES + 1] = PA_CLOCK_DEADLINE;
  put32(packet + PA_HEADER_BYTES + 16, 700);
  put32(packet + 16, 3); checksum(packet, length);
  assert(!pa_state_receive(&state, packet, length, 100)); /* same-rev resurrection */
  put32(packet + PA_HEADER_BYTES + 4, 2); checksum(packet, length);
  assert(!pa_state_receive(&state, packet, length, 100)); /* ended run needs new ID */
  const size_t run = PA_HEADER_BYTES + PA_RECORD_HEADER_BYTES + PA_PROVIDER_BYTES;
  memcpy(packet + run, "timer-2", 7); checksum(packet, length);
  assert(pa_state_receive(&state, packet, length, 100));
  assert(pa_state_select(&state, 100, 0) != NULL);
}

static void test_clocks(void) {
  PaActivity a = {0};
  a.state = PA_ACTIVE; a.clock = PA_CLOCK_DEADLINE;
  a.deadline = 700; a.observed_at = 100;
  PaClockValue value = pa_clock_value(&a, 100, true);
  assert(value.seconds == 600 && value.running && !value.due && !value.estimated);
  value = pa_clock_value(&a, 90, true);
  assert(value.seconds == 600 && value.estimated); /* no clock-rollback extension */
  value = pa_clock_value(&a, 700, true);
  assert(!value.seconds && value.due && a.state == PA_ACTIVE);
  a.state = PA_PAUSED; a.deadline = 0; a.base_seconds = 302;
  value = pa_clock_value(&a, 1000, true);
  assert(value.seconds == 302 && !value.running && !value.due);
  a.state = PA_ACTIVE; a.clock = PA_CLOCK_ELAPSED; a.clock_at = 110;
  a.base_seconds = 23;
  value = pa_clock_value(&a, 130, true);
  assert(value.seconds == 43 && value.running && !value.estimated);
  value = pa_clock_value(&a, 105, true);
  assert(value.seconds == 23 && value.estimated);
  a.base_seconds = UINT32_MAX - 1;
  value = pa_clock_value(&a, 200, true);
  assert(value.seconds == UINT32_MAX);
  a.state = PA_COMPLETED;
  value = pa_clock_value(&a, 200, true);
  assert(!value.running && !value.seconds && !value.due);
  char text[32];
  assert(pa_format_duration(83, text, sizeof(text)) && !strcmp(text, "01:23"));
  assert(pa_format_duration(3600, text, sizeof(text)) && !strcmp(text, "1:00:00"));
  assert(!pa_format_duration(3600, text, 4));
  assert(!pa_format_duration(1, NULL, 0));
}

static void test_cross_language(const char *directory) {
  const char *names[] = {"timer-active.bin", "timer-paused.bin", "mixed.bin", "empty.bin"};
  for (unsigned i = 0; i < sizeof(names) / sizeof(names[0]); ++i) {
    char path[1024];
    assert(snprintf(path, sizeof(path), "%s/%s", directory, names[i]) > 0);
    FILE *file = fopen(path, "rb");
    if (file == NULL) { fprintf(stderr, "Missing JS wire fixture: %s\n", path); abort(); }
    uint8_t packet[PA_MAX_PACKET_BYTES + 1];
    const size_t length = fread(packet, 1, sizeof(packet), file);
    assert(!ferror(file) && feof(file)); fclose(file);
    PaSnapshot decoded;
    assert(pa_decode(packet, length, &decoded));
    if (i == 0) {
      assert(decoded.count == 1 && decoded.items[0].state == PA_ACTIVE);
      assert(decoded.items[0].clock == PA_CLOCK_DEADLINE);
    } else if (i == 1) {
      assert(decoded.count == 1 && decoded.items[0].state == PA_PAUSED);
    } else if (i == 2) assert(decoded.count == 2);
    else assert(decoded.count == 0);
  }
}

static void test_publisher(void) {
  PaPublisher publisher;
  PaPublication sent, newer;
  assert(sizeof(publisher) < 256);
  pa_publisher_init(&publisher, 100, false);
  assert(pa_publisher_update(&publisher, "timer:1", 3));
  assert(!pa_publisher_needs_publish(&publisher));
  assert(!pa_publisher_begin(&publisher, &sent));
  assert(pa_publisher_set_connected(&publisher, true));
  assert(pa_publisher_needs_publish(&publisher));
  assert(pa_publisher_begin(&publisher, &sent));
  assert(sent.ticket == 101 && sent.revision == 3 && !strcmp(sent.run_id, "timer:1"));
  assert(!pa_publisher_synchronized(&publisher));

  /* While a transfer is active, only the latest state is retained; it cannot
   * compete for the native SDK outbox or be confirmed by the older receipt. */
  assert(pa_publisher_update(&publisher, "timer:1", 4));
  assert(!pa_publisher_begin(&publisher, &newer));
  assert(pa_publisher_transport_result(&publisher, sent.ticket, true));
  assert(!pa_publisher_receipt(&publisher, sent.run_id, sent.revision, sent.ticket));
  assert(pa_publisher_begin(&publisher, &newer));
  assert(newer.ticket == 102 && newer.revision == 4);
  assert(!pa_publisher_transport_result(&publisher, sent.ticket, true));
  assert(pa_publisher_transport_result(&publisher, newer.ticket, true));
  assert(!pa_publisher_synchronized(&publisher)); /* transport ACK is not storage */
  assert(!pa_publisher_begin(&publisher, &sent)); /* await application receipt */
  assert(!pa_publisher_receipt(&publisher, "wrong-run", 4, 102));
  assert(!pa_publisher_receipt(&publisher, "timer:1", 3, 102));
  assert(!pa_publisher_receipt(&publisher, "timer:1", 4, 101));
  assert(pa_publisher_receipt(&publisher, "timer:1", 4, 102));
  assert(pa_publisher_synchronized(&publisher));
  assert(!pa_publisher_receipt(&publisher, "timer:1", 4, 102));
  assert(!pa_publisher_needs_publish(&publisher));
  assert(!pa_publisher_update(&publisher, "timer:1", 3));
  assert(!pa_publisher_update(&publisher, "", 5));
  assert(!pa_publisher_update(&publisher, "timer:1", 0));
  assert(!pa_publisher_update(&publisher, "timer:\xc0\xaf", 5));
  char too_long[PA_ID_BYTES + 2]; memset(too_long, 'a', sizeof(too_long));
  too_long[sizeof(too_long) - 1] = 0;
  assert(!pa_publisher_update(&publisher, too_long, 5));

  /* The phone can respond before the SDK delivers its outbox-success event. */
  assert(pa_publisher_update(&publisher, "timer:2", 1));
  assert(pa_publisher_begin(&publisher, &sent));
  assert(pa_publisher_receipt(&publisher, sent.run_id, sent.revision, sent.ticket));
  assert(pa_publisher_synchronized(&publisher));
  assert(pa_publisher_transport_result(&publisher, sent.ticket, true));
  assert(!publisher.awaiting_receipt && pa_publisher_synchronized(&publisher));

  /* A phone bootstrap invalidates receipts from the previous handshake even
   * before the next revision has entered the SDK outbox. */
  pa_publisher_resync(&publisher);
  assert(!pa_publisher_synchronized(&publisher));
  assert(!pa_publisher_receipt(&publisher, sent.run_id, sent.revision, sent.ticket));
  assert(pa_publisher_begin(&publisher, &newer));
  pa_publisher_resync(&publisher);
  assert(!pa_publisher_receipt(&publisher, newer.run_id, newer.revision, newer.ticket));
  assert(pa_publisher_transport_result(&publisher, newer.ticket, true));
  assert(!publisher.awaiting_receipt);
  assert(pa_publisher_begin(&publisher, &sent));
  assert(pa_publisher_transport_result(&publisher, sent.ticket, true));
  assert(!pa_publisher_begin(&publisher, &newer));
  pa_publisher_retry(&publisher);
  assert(pa_publisher_begin(&publisher, &newer));
  assert(!pa_publisher_receipt(&publisher, sent.run_id, sent.revision, sent.ticket));
  assert(pa_publisher_transport_result(&publisher, newer.ticket, false));
  assert(pa_publisher_begin(&publisher, &sent));

  assert(pa_publisher_set_connected(&publisher, false));
  assert(!pa_publisher_receipt(&publisher, sent.run_id, sent.revision, sent.ticket));
  assert(pa_publisher_transport_result(&publisher, sent.ticket, true));
  assert(pa_publisher_set_connected(&publisher, true));
  assert(pa_publisher_begin(&publisher, &newer));
  assert(newer.ticket != sent.ticket);
  assert(pa_publisher_receipt(&publisher, newer.run_id, newer.revision, newer.ticket));
  assert(pa_publisher_synchronized(&publisher));

  pa_publisher_init(&publisher, UINT32_MAX, true);
  assert(pa_publisher_update(&publisher, "timer:1", 1));
  assert(pa_publisher_begin(&publisher, &sent) && sent.ticket == 1);
}

static void test_public_reading_disconnect(void) {
  PaState state;
  pa_state_init(&state, 2, true);
  state.snapshot.count = 1;
  PaActivity *reading = &state.snapshot.items[0];
  strcpy(reading->provider, "00112233-4455-6677-8899-aabbccddeeff");
  strcpy(reading->id, "public-reading");
  strcpy(reading->main, "72%");
  reading->state = PA_ACTIVE;
  reading->clock = PA_CLOCK_NONE;
  reading->observed_at = 100;
  reading->valid_until = 200;
  assert(pa_state_select(&state, 101, 0));
  assert(pa_state_set_connected(&state, false));
  assert(!pa_state_select(&state, 101, 0));
  assert(!state.snapshot.items[0].provider[0]);
}

int main(int argc, char **argv) {
  assert(sizeof(PaState) < 3200); /* bounded consumer budget, independent of Core */
  test_decoder(); test_image_numeric(); test_reserved_kind_privacy();
  test_lifecycle(); test_clocks(); test_publisher(); test_public_reading_disconnect();
  if (argc > 1) test_cross_language(argv[1]);
  puts("activity native decode/state/clock suites passed");
  return 0;
}
